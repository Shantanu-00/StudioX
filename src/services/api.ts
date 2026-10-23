import {AsyncStorage} from '@amazon-devices/react-native-kepler';
import {
  ACCESS_CODE,
  API,
  ASK_TIMEOUT_MS,
  DEVICE_NAME,
  REFINE_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
} from '../config';
import {
  Answer,
  validateAnswerBody,
  validateRefine,
  Widget,
} from '../analysis/schema';
import {
  LinkMedia,
  mergeMessages,
  Message,
  parseMediaList,
  parseMessage,
} from './inbox';

// Client for the StudioX AWS API (docs/ARCHITECTURE.md "API contract v1" and
// backend/CONTRACTS.md §6). The TV authenticates as a registered device:
// `Authorization: Device <id>:<secret>`. The secret is kept in the Vega
// AsyncStorage and never logged. Every response is untrusted input.

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

type Signal = AbortController['signal'];

interface Call {
  method: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  auth?: boolean; // send device credentials
  live?: boolean; // a live route: send the access code
  timeoutMs?: number;
  signal?: Signal;
}

interface Device {
  deviceId: string;
  deviceSecret: string;
}

const DEVICE_KEY = 'studiox.device.v1';
const LINK_KEY = 'studiox.link.v1';

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{16,128}$/;

const clip = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;

async function raw(path: string, call: Call, device?: Device) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    call.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
  const onAbort = () => controller.abort();
  call.signal?.addEventListener('abort', onAbort);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (device) {
    headers.Authorization = `Device ${device.deviceId}:${device.deviceSecret}`;
  }
  if (call.live && ACCESS_CODE) {
    headers['x-studiox-access'] = ACCESS_CODE;
  }
  try {
    const res = await fetch(`${API}${path}`, {
      method: call.method,
      headers,
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
      signal: controller.signal,
    });
    if (res.status === 204) {
      return null;
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null; // empty or non-JSON body; the status decides below
    }
    if (!res.ok) {
      const code =
        clip((body as {error?: {code?: unknown}})?.error?.code, 40) ?? 'http';
      throw new ApiError(res.status, code, `HTTP ${res.status} ${code}`);
    }
    return body;
  } catch (e) {
    if (e instanceof ApiError) {
      throw e;
    }
    const timedOut = controller.signal.aborted && !call.signal?.aborted;
    throw new ApiError(
      0,
      timedOut ? 'timeout' : 'unreachable',
      timedOut ? 'Timed out' : 'Unreachable',
    );
  } finally {
    clearTimeout(timer);
    call.signal?.removeEventListener('abort', onAbort);
  }
}

// ---- the link (paired phones) --------------------------------------------------

export interface Link {
  linkId: string;
  phoneName: string;
}

type Listener = () => void;

// The TV's link, persisted so a paired phone survives relaunch. Components
// read it through `useLink` (src/hooks/useLink.ts).
export const linkStore = (() => {
  let current: Link | null = null;
  let loaded: Promise<void> | null = null;
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => current,
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    load() {
      if (!loaded) {
        loaded = readJson(LINK_KEY).then((v) => {
          const l = v as Link | null;
          if (!current && l && ID_RE.test(String(l.linkId))) {
            current = {
              linkId: l.linkId,
              phoneName: clip(l.phoneName, 40) ?? 'Phone',
            };
            emit();
          }
        });
      }
      return loaded;
    },
    async set(l: Link) {
      current = l;
      emit();
      await AsyncStorage.setItem(LINK_KEY, JSON.stringify(l)).catch((e) =>
        console.warn(`[api] could not save the link: ${String(e)}`),
      );
    },
    async clear() {
      if (!current) {
        return;
      }
      current = null;
      emit();
      await AsyncStorage.removeItem(LINK_KEY).catch(() => undefined);
    },
  };
})();

// ---- device registration ------------------------------------------------------

let device: Promise<Device> | null = null;

async function readJson(key: string): Promise<unknown> {
  try {
    const v = await AsyncStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch (e) {
    // Corrupt or unreadable entry: start again from nothing.
    console.warn(`[api] could not read ${key}: ${String(e)}`);
    return null;
  }
}

async function register(): Promise<Device> {
  const stored = (await readJson(DEVICE_KEY)) as Device | null;
  if (
    stored &&
    ID_RE.test(String(stored.deviceId)) &&
    SECRET_RE.test(String(stored.deviceSecret))
  ) {
    return stored;
  }
  const body = (await raw('/devices', {
    method: 'POST',
    body: {name: DEVICE_NAME},
  })) as Device | null;
  if (
    !body ||
    !ID_RE.test(String(body.deviceId)) ||
    !SECRET_RE.test(String(body.deviceSecret))
  ) {
    throw new ApiError(0, 'malformed', 'Malformed device registration');
  }
  const next = {deviceId: body.deviceId, deviceSecret: body.deviceSecret};
  try {
    await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify(next));
  } catch (e) {
    // Still usable for this run; the TV registers again after a relaunch.
    console.warn(`[api] could not store the device: ${String(e)}`);
  }
  console.info(`[api] registered device ${next.deviceId}`);
  return next;
}

// Registers this TV once; later calls reuse the stored credentials.
export function ensureDevice(): Promise<Device> {
  if (!device) {
    device = register().catch((e) => {
      device = null;
      throw e;
    });
  }
  return device;
}

async function forgetDevice() {
  device = null;
  await AsyncStorage.removeItem(DEVICE_KEY).catch(() => undefined);
}

// A device-authenticated call. If the server no longer knows the stored
// credentials (401), register again once and retry.
async function deviceCall(path: string, call: Call) {
  const dev = await ensureDevice();
  try {
    return await raw(path, call, dev);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await forgetDevice();
      await linkStore.clear();
      return raw(path, call, await ensureDevice());
    }
    throw e;
  }
}

// ---- pairing -------------------------------------------------------------------

export interface Pairing {
  code: string;
  url: string;
  expiresAt: number; // ms since epoch
}

export type PairingStatus =
  | {status: 'waiting'}
  | {status: 'linked'; linkId: string; phoneName: string}
  | {status: 'expired'};

const CODE_RE = /^[A-Z0-9]{6}$/;

export async function createPairing(signal?: Signal): Promise<Pairing> {
  const b = (await deviceCall('/pairings', {method: 'POST', signal})) as {
    code?: unknown;
    url?: unknown;
    expiresAt?: unknown;
  } | null;
  const code = typeof b?.code === 'string' ? b.code : '';
  const url = clip(b?.url, 512) ?? '';
  const expiresAt =
    typeof b?.expiresAt === 'string' ? Date.parse(b.expiresAt) : NaN;
  if (
    !CODE_RE.test(code) ||
    !/^https:\/\/[^\s]+$/.test(url) ||
    !Number.isFinite(expiresAt)
  ) {
    throw new ApiError(0, 'malformed', 'Malformed pairing');
  }
  return {code, url, expiresAt};
}

export async function getPairing(
  code: string,
  signal?: Signal,
): Promise<PairingStatus> {
  const b = (await deviceCall(`/pairings/${encodeURIComponent(code)}`, {
    method: 'GET',
    signal,
  })) as {status?: unknown; linkId?: unknown; phoneName?: unknown} | null;
  switch (b?.status) {
    case 'waiting':
      return {status: 'waiting'};
    case 'expired':
      return {status: 'expired'};
    case 'linked':
      if (ID_RE.test(String(b.linkId))) {
        return {
          status: 'linked',
          linkId: String(b.linkId),
          phoneName: clip(b.phoneName, 40) ?? 'Phone',
        };
      }
  }
  throw new ApiError(0, 'malformed', 'Malformed pairing status');
}

// ---- now playing and sharing (paired only) ---------------------------------------

// A 403/404 means the link is gone on the server: forget it locally.
async function onLinkError(e: unknown) {
  if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
    await linkStore.clear();
  }
  throw e;
}

export function putNowPlaying(
  linkId: string,
  now: {mediaId: string; title: string; t: number; playing: boolean},
) {
  return deviceCall(`/links/${encodeURIComponent(linkId)}/now`, {
    method: 'PUT',
    body: now,
  }).catch(onLinkError);
}

export interface PhoneCard {
  type: 'checklist' | 'list' | 'reminder' | 'person';
  title: string;
  items: Array<{text: string; time?: string} | {name: string; detail: string}>;
  sources?: Array<{title: string; url: string}>;
  // `reminder` cards (phone-app.md): the phone offers "Add to calendar".
  reminder?: {title: string; start: string; repeat?: 'daily' | 'weekly'};
  // `person` cards (phone-app.md §5): portrait, name, role, up to 3 facts.
  person?: {
    name: string;
    role: string;
    facts: string[];
    imageUrl?: string;
    credit?: string;
  };
}

export function shareCard(
  linkId: string,
  card: PhoneCard,
  at: {mediaId: string; t: number},
) {
  return deviceCall(`/links/${encodeURIComponent(linkId)}/messages`, {
    method: 'POST',
    body: {kind: 'share', card, mediaId: at.mediaId, t: at.t},
  }).catch(onLinkError);
}

// ---- the TV inbox: thread and uploads (CONTRACTS.md §8) ----------------------------

const PAGE = 50; // GET /links/{id}/messages returns at most 50, oldest first
const MAX_PAGES = 6;

// New messages after `cursor` (all of them from the start when it is
// undefined), following full pages so the TV catches up to the newest. Keeps
// the newest MAX_MESSAGES. A 403/404 means the link is gone: it is forgotten.
export async function listMessages(
  linkId: string,
  cursor: string | undefined,
  signal?: Signal,
): Promise<{messages: Message[]; cursor: string | undefined}> {
  let after = cursor;
  let out: Message[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = after ? `?after=${encodeURIComponent(after)}` : '';
    const b = (await deviceCall(
      `/links/${encodeURIComponent(linkId)}/messages${query}`,
      {method: 'GET', signal},
    ).catch(onLinkError)) as {messages?: unknown; cursor?: unknown} | null;
    const items = Array.isArray(b?.messages) ? b!.messages.slice(0, PAGE) : [];
    out = mergeMessages(
      out,
      items.map(parseMessage).filter((m): m is Message => !!m),
    );
    const next =
      typeof b?.cursor === 'string' && ID_RE.test(b.cursor)
        ? b.cursor
        : undefined;
    if (next) {
      after = next;
    }
    if (items.length < PAGE || !next || signal?.aborted) {
      break;
    }
  }
  return {messages: out, cursor: after};
}

// The link's uploads, newest first. The route is new (§8): a 404 here may
// only mean it is not deployed yet, so it never clears the link.
export async function listLinkMedia(
  linkId: string,
  signal?: Signal,
): Promise<LinkMedia[]> {
  const b = await deviceCall(`/links/${encodeURIComponent(linkId)}/media`, {
    method: 'GET',
    signal,
  });
  return parseMediaList(b);
}

// ---- live co-viewer (APP_MODE === 'live') -------------------------------------------

export async function createSession(mediaId: string, signal?: Signal) {
  const b = (await deviceCall('/sessions', {
    method: 'POST',
    body: {mediaId},
    live: true,
    signal,
  })) as {sessionId?: unknown} | null;
  const id = clip(b?.sessionId, 128);
  if (!id || id.length < 33) {
    throw new ApiError(0, 'malformed', 'Malformed session');
  }
  return id;
}

export async function refineCard(
  req: {sessionId: string; mediaId: string; t: number},
  signal?: Signal,
): Promise<{caption?: string; widget?: Widget} | null> {
  const b = await deviceCall('/refine', {
    method: 'POST',
    body: req,
    live: true,
    timeoutMs: REFINE_TIMEOUT_MS,
    signal,
  });
  return validateRefine(b);
}

export async function askLive(
  req: {sessionId: string; mediaId: string; t: number; question: string},
  signal?: Signal,
): Promise<Pick<Answer, 'text' | 'cites' | 'sources'>> {
  const b = await deviceCall('/ask', {
    method: 'POST',
    body: req,
    live: true,
    timeoutMs: ASK_TIMEOUT_MS,
    signal,
  });
  const answer = validateAnswerBody(b);
  if (!answer) {
    throw new ApiError(0, 'malformed', 'Malformed answer');
  }
  return answer;
}

// For tests.
export function resetApiState() {
  device = null;
}
