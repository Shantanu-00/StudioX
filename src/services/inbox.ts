import {Source, validateSources} from '../analysis/schema';

// The TV inbox: the link's thread (API contract v1 "Message") and the phone's
// uploads (backend/CONTRACTS.md §8). Everything here is untrusted input from
// the network: parsers drop what they cannot read and bound what they keep.

export const MAX_MESSAGES = 50; // held in memory
export const SHOWN_MESSAGES = 20; // drawn in the thread
export const MAX_MEDIA = 20;

// ---- messages ----------------------------------------------------------------

export type SenderKind = 'phone' | 'tv' | 'ai' | 'system';
export type MessageKind = 'text' | 'question' | 'answer' | 'share' | 'status';

export interface MessageCard {
  type: string; // checklist | list | person | link | reminder (others drawn as list)
  title: string;
  items: string[];
  sources: Source[];
}

export interface Message {
  id: string;
  at: string;
  from: {kind: SenderKind; name: string};
  kind: MessageKind;
  text?: string;
  mediaId?: string;
  t?: number;
  card?: MessageCard;
  status?: {state: string; progress?: number};
}

const SENDERS: SenderKind[] = ['phone', 'tv', 'ai', 'system'];
const KINDS: MessageKind[] = ['text', 'question', 'answer', 'share', 'status'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MEDIA_ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const STATE_RE = /^[A-Z_]{1,20}$/;

const MAX_TEXT = 600;
const MAX_ITEMS = 6;
const MAX_SOURCES = 3;

const clip = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') {
    return undefined;
  }
  const s = v.trim();
  if (!s) {
    return undefined;
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const progressOf = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : Math.min(1, Math.max(0, n));
};

const DEFAULT_NAMES: Record<SenderKind, string> = {
  phone: 'Phone',
  tv: 'TV',
  ai: 'StudioX',
  system: 'StudioX',
};

function parseItem(raw: unknown): string | undefined {
  if (typeof raw === 'string') {
    return clip(raw, 120);
  }
  const o = raw as {text?: unknown; name?: unknown; detail?: unknown};
  if (!o || typeof o !== 'object') {
    return undefined;
  }
  const text = clip(o.text, 120);
  if (text) {
    return text;
  }
  const name = clip(o.name, 60);
  const detail = clip(o.detail, 80);
  return name && detail ? `${name} · ${detail}` : name;
}

function parseCard(raw: unknown): MessageCard | undefined {
  const c = raw as {
    type?: unknown;
    title?: unknown;
    items?: unknown;
    sources?: unknown;
  };
  if (!c || typeof c !== 'object') {
    return undefined;
  }
  const items = Array.isArray(c.items)
    ? c.items
        .slice(0, 16)
        .map(parseItem)
        .filter((x): x is string => !!x)
        .slice(0, MAX_ITEMS)
    : [];
  // The backend clips source titles to 200; the schema keeps up to 140.
  const sources = Array.isArray(c.sources)
    ? validateSources(
        c.sources.slice(0, 16).map((s) => {
          const src = s as {title?: unknown; url?: unknown};
          return src && typeof src === 'object'
            ? {title: clip(src.title, 140), url: src.url}
            : null;
        }),
        MAX_SOURCES,
      )
    : [];
  const title = clip(c.title, 80);
  if (!title && items.length === 0 && sources.length === 0) {
    return undefined;
  }
  return {
    type: clip(c.type, 20) ?? 'list',
    title: title ?? 'Card',
    items,
    sources,
  };
}

// One message, or null if it is not one the TV can draw.
export function parseMessage(raw: unknown): Message | null {
  const m = raw as Record<string, unknown>;
  if (!m || typeof m !== 'object') {
    return null;
  }
  const id = typeof m.id === 'string' && ID_RE.test(m.id) ? m.id : null;
  const at =
    typeof m.at === 'string' && Number.isFinite(Date.parse(m.at)) ? m.at : null;
  const from = m.from as {kind?: unknown; name?: unknown} | undefined;
  const sender = SENDERS.find((s) => s === from?.kind);
  const kind = KINDS.find((k) => k === m.kind);
  if (!id || !at || !sender || !kind) {
    return null;
  }
  const msg: Message = {
    id,
    at,
    from: {kind: sender, name: clip(from?.name, 40) ?? DEFAULT_NAMES[sender]},
    kind,
  };
  const text = clip(m.text, MAX_TEXT);
  if (text) {
    msg.text = text;
  }
  if (typeof m.mediaId === 'string' && MEDIA_ID_RE.test(m.mediaId)) {
    msg.mediaId = m.mediaId;
  }
  const t = num(m.t);
  if (t !== undefined && t >= 0) {
    msg.t = t;
  }
  const card = parseCard(m.card);
  if (card) {
    msg.card = card;
  }
  const st = m.status as {state?: unknown; progress?: unknown} | undefined;
  if (st && typeof st.state === 'string' && STATE_RE.test(st.state)) {
    msg.status = {state: st.state, progress: progressOf(st.progress)};
  }
  // Nothing to draw: drop it rather than show an empty row.
  const drawable =
    !!msg.text || !!msg.card || (kind === 'status' && !!msg.status);
  return drawable ? msg : null;
}

const byTime = (a: Message, b: Message) =>
  a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

// Merges a page into what the TV holds: de-duplicated by id (a later copy
// replaces an earlier one), oldest → newest, at most `max` (the newest).
export function mergeMessages(
  held: Message[],
  incoming: Message[],
  max = MAX_MESSAGES,
): Message[] {
  if (incoming.length === 0) {
    return held;
  }
  const byId = new Map<string, Message>();
  held.forEach((m) => byId.set(m.id, m));
  incoming.forEach((m) => byId.set(m.id, m));
  const all = [...byId.values()].sort(byTime);
  return all.length > max ? all.slice(all.length - max) : all;
}

// The rows to draw: the newest `shown`, widened to keep the focused row
// mounted (a focused row that unmounts would drop focus).
export function visibleMessages(
  held: Message[],
  focusedId: string | null,
  shown = SHOWN_MESSAGES,
): Message[] {
  let start = Math.max(0, held.length - shown);
  if (focusedId) {
    const i = held.findIndex((m) => m.id === focusedId);
    if (i >= 0 && i < start) {
      start = i;
    }
  }
  return held.slice(start);
}

// ---- media (uploads) -----------------------------------------------------------

export type MediaStatus =
  | 'UPLOADING'
  | 'PROCESSING'
  | 'ANALYSING'
  | 'READY'
  | 'NOT_A_FIT'
  | 'FAILED';

const STATUSES: MediaStatus[] = [
  'UPLOADING',
  'PROCESSING',
  'ANALYSING',
  'READY',
  'NOT_A_FIT',
  'FAILED',
];

export interface LinkMedia {
  mediaId: string;
  title: string;
  status: MediaStatus;
  progress?: number;
  playable: boolean;
  mediaUrl?: string;
  packageUrl?: string;
  createdAt?: string;
  durationSec?: number; // optional; not in CONTRACTS §8 yet
}

const HTTPS_RE = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\/\S*$/i;
const https = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length <= 1024 && HTTPS_RE.test(v) ? v : undefined;

export function parseMedia(raw: unknown): LinkMedia | null {
  const m = raw as Record<string, unknown>;
  if (!m || typeof m !== 'object') {
    return null;
  }
  const mediaId =
    typeof m.mediaId === 'string' && MEDIA_ID_RE.test(m.mediaId)
      ? m.mediaId
      : null;
  const status = STATUSES.find((s) => s === m.status);
  if (!mediaId || !status) {
    return null;
  }
  const mediaUrl = https(m.mediaUrl);
  const out: LinkMedia = {
    mediaId,
    title: clip(m.title, 60) ?? 'Untitled video',
    status,
    // Playable only with a URL the player can open.
    playable: m.playable === true && !!mediaUrl,
  };
  const progress = progressOf(m.progress);
  if (progress !== undefined) {
    out.progress = progress;
  }
  if (mediaUrl) {
    out.mediaUrl = mediaUrl;
  }
  const packageUrl = https(m.packageUrl);
  if (packageUrl) {
    out.packageUrl = packageUrl;
  }
  const duration = num(m.durationSec);
  if (duration !== undefined && duration > 0 && duration < 86400) {
    out.durationSec = duration;
  }
  if (typeof m.createdAt === 'string' && m.createdAt.length <= 40) {
    out.createdAt = m.createdAt;
  }
  return out;
}

export function parseMediaList(raw: unknown): LinkMedia[] {
  const list = (raw as {media?: unknown})?.media;
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set<string>();
  const out: LinkMedia[] = [];
  for (const item of list.slice(0, MAX_MEDIA * 2)) {
    const m = parseMedia(item);
    if (m && !seen.has(m.mediaId)) {
      seen.add(m.mediaId);
      out.push(m);
    }
    if (out.length >= MAX_MEDIA) {
      break;
    }
  }
  return out;
}

// ---- status lines (sentence case, short) ------------------------------------------

export interface StatusLine {
  text: string;
  // Unused by the TV since the calm redesign; kept for the phone pages.
  cursor: boolean;
  tone: 'live' | 'done' | 'dead';
}

const pct = (p?: number) =>
  p === undefined ? '' : ` ${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;

export function statusLine(state: string, progress?: number): StatusLine {
  switch (state) {
    case 'UPLOADING':
      return {text: `Uploading${pct(progress)}`, cursor: false, tone: 'live'};
    case 'PROCESSING':
      return {text: 'Preparing…', cursor: false, tone: 'live'};
    case 'ANALYSING':
      return {text: 'Analysing', cursor: false, tone: 'live'};
    case 'READY':
      return {text: 'Ready', cursor: false, tone: 'done'};
    case 'NOT_A_FIT':
      return {text: 'Not a fit', cursor: false, tone: 'dead'};
    case 'FAILED':
      return {text: 'Failed', cursor: false, tone: 'dead'};
    default:
      return {
        text: state.replace(/_/g, ' ').slice(0, 20),
        cursor: false,
        tone: 'live',
      };
  }
}

export const uploadStatusLine = (m: LinkMedia) =>
  statusLine(m.status, m.progress);

// ---- small formatters ------------------------------------------------------------

// Local wall-clock time, 24 h: "10:15".
export function clockTime(at: string): string {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) {
    return '--:--';
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

export function domainOf(url: string): string {
  return url
    .replace(/^https?:\/\//i, '')
    .split(/[/?#:]/)[0]
    .replace(/^www\./i, '')
    .toLowerCase();
}

export const sourceLine = (s: Source) => `${s.title} · ${domainOf(s.url)}`;
