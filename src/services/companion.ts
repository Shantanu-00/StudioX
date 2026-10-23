import {COMPANION_API_URL, REQUEST_TIMEOUT_MS} from '../config';

// Client for the companion server's pairing API. Every response is treated as
// untrusted input and validated before it reaches UI state.

export type SessionKind = 'upload' | 'camera';

export type SessionStatus =
  | 'waiting' // QR shown, no phone yet
  | 'linked' // phone opened the link
  | 'uploading'
  | 'received' // upload finished on the server
  | 'camera-ready' // phone granted camera access and is tracking
  | 'expired'
  | 'failed';

export interface PairingSession {
  id: string;
  tvToken: string;
  kind: SessionKind;
  code: string;
  phoneUrl: string;
  expiresAt: number;
}

export interface SessionSnapshot {
  status: SessionStatus;
  expiresAt: number;
  device?: string;
  upload?: {name: string; bytes: number; total: number};
  error?: string;
}

const STATUSES: readonly SessionStatus[] = [
  'waiting',
  'linked',
  'uploading',
  'received',
  'camera-ready',
  'expired',
  'failed',
];

export const isTerminal = (s: SessionStatus) =>
  s === 'received' || s === 'expired' || s === 'failed';

export class CompanionError extends Error {}

const clip = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' ? v.slice(0, max) : undefined;

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;

type Signal = AbortController['signal'];

interface Init {
  method: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
}

async function request(
  path: string,
  init: Init,
  signal?: Signal,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort);
  try {
    const res = await fetch(`${COMPANION_API_URL}${path}`, {
      ...init,
      headers: {'Content-Type': 'application/json', ...init.headers},
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new CompanionError(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    if (e instanceof CompanionError) {
      throw e;
    }
    throw new CompanionError(
      controller.signal.aborted && !signal?.aborted
        ? 'Timed out'
        : 'Unreachable',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

export async function createSession(
  kind: SessionKind,
  signal?: Signal,
): Promise<PairingSession> {
  const body = (await request(
    '/api/sessions',
    {method: 'POST', body: JSON.stringify({kind})},
    signal,
  )) as Record<string, unknown>;
  const id = clip(body?.id, 64);
  const tvToken = clip(body?.tvToken, 128);
  const code = clip(body?.code, 16);
  const phoneUrl = clip(body?.phoneUrl, 512);
  const expiresAt = num(body?.expiresAt);
  if (
    !id ||
    !tvToken ||
    !code ||
    !phoneUrl ||
    !/^https?:\/\//.test(phoneUrl) ||
    !expiresAt ||
    body.kind !== kind
  ) {
    throw new CompanionError('Malformed session');
  }
  return {id, tvToken, kind, code, phoneUrl, expiresAt};
}

export async function fetchSnapshot(
  session: PairingSession,
  signal?: Signal,
): Promise<SessionSnapshot> {
  const body = (await request(
    `/api/sessions/${encodeURIComponent(session.id)}`,
    {method: 'GET', headers: {Authorization: `Bearer ${session.tvToken}`}},
    signal,
  )) as Record<string, unknown>;
  const status = body?.status as SessionStatus;
  if (!STATUSES.includes(status)) {
    throw new CompanionError('Malformed status');
  }
  const snapshot: SessionSnapshot = {
    status,
    expiresAt: num(body.expiresAt) ?? session.expiresAt,
    device: clip(body.device, 48),
    error: clip(body.error, 120),
  };
  const up = body.upload as Record<string, unknown> | undefined;
  if (up && typeof up === 'object') {
    const name = clip(up.name, 80);
    const bytes = num(up.bytes);
    const total = num(up.total);
    if (name !== undefined && bytes !== undefined && total !== undefined) {
      snapshot.upload = {name, bytes, total};
    }
  }
  return snapshot;
}
