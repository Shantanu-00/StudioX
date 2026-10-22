// StudioX companion server: temporary TV↔phone pairing links, phone uploads
// and (next) a relay for phone-side gesture commands. Zero dependencies, Node 22.
//
//   node companion/server.mjs
//   PUBLIC_URL=https://xyz.trycloudflare.com node companion/server.mjs
//
// The TV app only polls this server; the phone talks to it through the page
// served at /s/<id>. Sessions live in memory and vanish on restart.

import {createServer} from 'node:http';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, readFile, rename, rm, stat} from 'node:fs/promises';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {networkInterfaces} from 'node:os';
import {extname, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(ROOT, 'uploads');
// Demo episodes (media/tv, git-ignored). CloudFront replaces this route later.
const MEDIA_DIR = process.env.MEDIA_DIR ?? join(ROOT, '..', 'media', 'tv');

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://${lanAddress()}:${PORT}`)
  .replace(/\/$/, '');

const LINK_TTL_MS = 10 * 60 * 1000; // a QR link is scannable for ten minutes
const SESSION_TTL_MS = 60 * 60 * 1000; // a linked session lives at most an hour
const MAX_SESSIONS = 200;
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 2 * 1024 ** 3);
const MAX_JSON_BYTES = 8 * 1024;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

/** @type {Map<string, Session>} */
const sessions = new Map();
/** @type {Map<string, string>} code -> id */
const codes = new Map();

/**
 * @typedef {{
 *   id: string, tvToken: string, phoneKey?: string, kind: 'upload'|'camera',
 *   code: string, createdAt: number, linkExpiresAt: number,
 *   status: string, device?: string, error?: string,
 *   upload?: {name: string, bytes: number, total: number, file?: string},
 *   uploading?: boolean,
 * }} Session
 */

function lanAddress() {
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (/^(lo|virbr|docker|br-|veth)/.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return '127.0.0.1';
}

const token = (bytes) => randomBytes(bytes).toString('base64url');

function newCode() {
  for (;;) {
    const b = randomBytes(6);
    const raw = [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
    const code = `${raw.slice(0, 3)}-${raw.slice(3)}`;
    if (!codes.has(code)) return code;
  }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---- session lifecycle -------------------------------------------------------

function refresh(s) {
  const now = Date.now();
  if (s.status === 'waiting' && now >= s.linkExpiresAt) s.status = 'expired';
  if (!s.uploading && now >= s.createdAt + SESSION_TTL_MS && s.status !== 'received') {
    s.status = 'expired';
  }
  return s;
}

function drop(s) {
  sessions.delete(s.id);
  codes.delete(s.code);
}

setInterval(() => {
  for (const s of sessions.values()) {
    refresh(s);
    if (s.status === 'expired' && Date.now() > s.linkExpiresAt + 5 * 60 * 1000) drop(s);
  }
}, 30_000).unref();

function tvView(s) {
  refresh(s);
  return {
    status: s.status,
    expiresAt: s.linkExpiresAt,
    device: s.device,
    error: s.error,
    upload: s.upload && {name: s.upload.name, bytes: s.upload.bytes, total: s.upload.total},
  };
}

// ---- http helpers ------------------------------------------------------------

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  const payload = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    ...BASE_HEADERS,
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(payload);
}

const fail = (res, status, message) => send(res, status, {error: message});

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_JSON_BYTES) throw Object.assign(new Error('Body too large'), {status: 413});
    chunks.push(c);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON'), {status: 400});
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const PAGE_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
    "style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(self), microphone=()',
};

async function serveFile(res, name, extra = {}) {
  const path = join(PUBLIC_DIR, name);
  if (!path.startsWith(PUBLIC_DIR)) return fail(res, 404, 'Not found');
  try {
    const data = await readFile(path);
    res.writeHead(200, {
      ...BASE_HEADERS,
      ...PAGE_HEADERS,
      'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
      ...extra,
    });
    res.end(data);
  } catch {
    fail(res, 404, 'Not found');
  }
}

function phoneSession(id, req) {
  const s = sessions.get(id);
  if (!s) return {error: [404, 'Link not found']};
  refresh(s);
  if (s.status === 'expired') return {error: [410, 'Link expired']};
  if (req && s.phoneKey && !safeEqual(req.headers['x-phone-key'] ?? '', s.phoneKey)) {
    return {error: [403, 'This link is already in use on another phone']};
  }
  return {s};
}

const cleanName = (name) =>
  String(name ?? 'video')
    .replace(/[^\w.\- ]+/g, '_')
    .slice(0, 80) || 'video';

// ---- routes ------------------------------------------------------------------

async function route(req, res) {
  const url = new URL(req.url ?? '/', 'http://local');
  const parts = url.pathname.split('/').filter(Boolean);
  const m = req.method;

  // TV: create a pairing session.
  if (m === 'POST' && url.pathname === '/api/sessions') {
    const {kind} = await readJson(req);
    if (kind !== 'upload' && kind !== 'camera') return fail(res, 400, 'Unknown kind');
    if (sessions.size >= MAX_SESSIONS) return fail(res, 503, 'Too many active links');
    const now = Date.now();
    const s = {
      id: token(16),
      tvToken: token(24),
      kind,
      code: newCode(),
      createdAt: now,
      linkExpiresAt: now + LINK_TTL_MS,
      status: 'waiting',
    };
    sessions.set(s.id, s);
    codes.set(s.code, s.id);
    return send(res, 201, {
      id: s.id,
      tvToken: s.tvToken,
      kind: s.kind,
      code: s.code,
      phoneUrl: `${PUBLIC_URL}/s/${s.id}`,
      expiresAt: s.linkExpiresAt,
    });
  }

  // TV: poll a session.
  if (m === 'GET' && parts[0] === 'api' && parts[1] === 'sessions' && parts[2]) {
    const s = sessions.get(parts[2]);
    const auth = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!s || !safeEqual(auth, s.tvToken)) return fail(res, 404, 'Not found');
    return send(res, 200, tvView(s));
  }

  // Phone: fallback code entry.
  if (m === 'POST' && url.pathname === '/api/pair') {
    const {code} = await readJson(req);
    const norm = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const id = codes.get(`${norm.slice(0, 3)}-${norm.slice(3, 6)}`);
    const found = id && phoneSession(id);
    if (!found || found.error) return fail(res, 404, 'Code not recognised');
    return send(res, 200, {path: `/s/${id}`});
  }

  // Phone API: /api/phone/:id[/join|/upload|/camera]
  if (parts[0] === 'api' && parts[1] === 'phone' && parts[2]) {
    const action = parts[3];
    if (m === 'GET' && !action) {
      const {s, error} = phoneSession(parts[2]);
      if (error) return fail(res, ...error);
      return send(res, 200, {kind: s.kind, status: s.status, expiresAt: s.linkExpiresAt});
    }
    if (m === 'POST' && action === 'join') {
      const body = await readJson(req);
      const s = sessions.get(parts[2]);
      if (!s) return fail(res, 404, 'Link not found');
      refresh(s);
      if (s.status === 'expired') return fail(res, 410, 'Link expired');
      const key = req.headers['x-phone-key'];
      if (s.phoneKey) {
        if (!key || !safeEqual(key, s.phoneKey)) {
          return fail(res, 409, 'This link is already in use on another phone');
        }
      } else {
        s.phoneKey = token(24);
        s.status = 'linked';
        s.device = String(body.device ?? '').replace(/[^\w .\-()]/g, '').slice(0, 48) || undefined;
      }
      return send(res, 200, {phoneKey: s.phoneKey, kind: s.kind, status: s.status});
    }
    if (m === 'PUT' && action === 'upload') return upload(req, res, parts[2], url);
    if (m === 'POST' && action === 'camera') {
      const {s, error} = phoneSession(parts[2], req);
      if (error) return fail(res, ...error);
      if (s.kind !== 'camera' || !s.phoneKey) return fail(res, 409, 'Not a linked camera session');
      const {state, detail} = await readJson(req);
      if (state === 'ready') {
        s.status = 'camera-ready';
        s.error = undefined;
      } else if (state === 'denied' || state === 'error') {
        s.status = 'failed';
        s.error = String(detail ?? 'Camera unavailable on the phone').slice(0, 120);
      } else {
        return fail(res, 400, 'Unknown camera state');
      }
      return send(res, 200, {status: s.status});
    }
    return fail(res, 404, 'Not found');
  }

  // Pages.
  if (m === 'GET' && parts[0] === 's' && parts[1]) return serveFile(res, 'phone.html');
  if (m === 'GET' && url.pathname === '/pair') return serveFile(res, 'pair.html');
  if (m === 'GET' && parts[0] === 'assets' && parts.length === 2) {
    return serveFile(res, parts[1], {'Cache-Control': 'public, max-age=300'});
  }
  if ((m === 'GET' || m === 'HEAD') && parts[0] === 'media' && parts.length === 2) {
    return serveMedia(req, res, parts[1]);
  }
  if (m === 'GET' && url.pathname === '/health') return send(res, 200, {ok: true});
  return fail(res, 404, 'Not found');
}

// Byte-range file serving for the TV's media pipeline (seeking needs ranges).
async function serveMedia(req, res, name) {
  // Logged so a failing TV player can be told apart from a request that never arrived.
  console.log(`[media] ${req.method} ${name} range=${req.headers.range ?? '-'} from ${req.socket.remoteAddress} ua=${req.headers['user-agent'] ?? '-'}`);
  if (!/^[\w.-]+\.mp4$/.test(name)) return fail(res, 404, 'Not found');
  const path = join(MEDIA_DIR, name);
  let size;
  try {
    size = (await stat(path)).size;
  } catch {
    return fail(res, 404, 'Not found');
  }
  const headers = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range) {
    if (range[1] === '' && range[2] !== '') {
      start = Math.max(0, size - Number(range[2]));
    } else {
      start = Number(range[1] || 0);
      end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    }
    if (start > end || start >= size) {
      res.writeHead(416, {'Content-Range': `bytes */${size}`});
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(path, {start, end}).on('error', () => res.destroy()).pipe(res);
}

async function upload(req, res, id, url) {
  const {s, error} = phoneSession(id, req);
  if (error) return fail(res, ...error);
  if (s.kind !== 'upload' || !s.phoneKey) return fail(res, 409, 'Not a linked upload session');
  if (s.uploading) return fail(res, 409, 'An upload is already in progress');
  if (s.status === 'received') return fail(res, 409, 'This link has already delivered a video');
  const type = String(req.headers['content-type'] ?? '');
  if (!/^video\/[\w.+-]+$/.test(type)) return fail(res, 415, 'Only video files are accepted');
  const total = Number(req.headers['content-length']);
  if (!Number.isFinite(total) || total <= 0) return fail(res, 411, 'Length required');
  if (total > MAX_UPLOAD_BYTES) return fail(res, 413, 'File is too large');

  const name = cleanName(url.searchParams.get('name'));
  await mkdir(UPLOAD_DIR, {recursive: true});
  const final = join(UPLOAD_DIR, `${s.id}${extname(name) || '.mp4'}`);
  const part = `${final}.part`;
  s.uploading = true;
  s.status = 'uploading';
  s.error = undefined;
  s.upload = {name, bytes: 0, total};

  const out = createWriteStream(part);
  let ok = false;
  try {
    for await (const chunk of req) {
      s.upload.bytes += chunk.length;
      if (s.upload.bytes > total) throw new Error('More data than declared');
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    if (s.upload.bytes !== total) throw new Error('Upload ended early');
    await rename(part, final);
    s.upload.file = final;
    s.status = 'received';
    ok = true;
    send(res, 201, {status: s.status});
  } catch (e) {
    out.destroy();
    await rm(part, {force: true});
    s.status = 'linked'; // the phone can try again on the same link
    s.error = String(e.message ?? e).slice(0, 120);
    s.upload = undefined;
    if (!res.headersSent) fail(res, 400, s.error);
  } finally {
    s.uploading = false;
    if (ok) console.log(`[upload] ${s.code} ${name} ${total} bytes -> ${final}`);
  }
}

const server = createServer((req, res) => {
  route(req, res).catch((e) => {
    if (!res.headersSent) fail(res, e.status ?? 500, e.status ? e.message : 'Server error');
    if (!e.status) console.error(e);
  });
});
server.requestTimeout = 0; // large uploads over slow Wi-Fi
server.headersTimeout = 30_000;
server.listen(PORT, HOST, () => {
  console.log(`StudioX companion on http://${HOST}:${PORT}`);
  console.log(`Phone links use ${PUBLIC_URL}`);
  if (!PUBLIC_URL.startsWith('https://')) {
    console.log('Note: phone camera access needs HTTPS; set PUBLIC_URL to an HTTPS tunnel.');
  }
});
