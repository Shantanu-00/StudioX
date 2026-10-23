import {
  MediaSource,
  ReadyState,
  SourceBuffer,
  VideoPlayer,
} from '@amazon-devices/react-native-w3cmedia';

// Plays a fragmented MP4 through Media Source Extensions instead of URL mode.
//
// Why: on the Vega Virtual Device, URL mode (`player.src = url`) fails with
// MEDIA_ERR_SRC_NOT_SUPPORTED before any HTTP request is made, while the same
// footage plays when the app fetches the bytes and appends them to a
// MediaSource (community thread 29117; reproduced here: the companion server
// logged no media request from the TV). MSE is also the standard W3C path on
// Fire TV hardware, so this is not an emulator-only hack.
//
// Requirements: fragmented MP4 (`-movflags +frag_keyframe+empty_moov+
// default_base_moof`) and attachment through `srcObject`, not `src`.

export const MP4_MIME = 'video/mp4; codecs="avc1.640029, mp4a.40.2"';
const CHUNK_BYTES = 2 * 1024 * 1024;

type Signal = AbortController['signal'];

// Resolves on the event, or when `signal` aborts: a MediaSource detached at
// teardown never fires `updateend`/`sourceopen`, and the loader must not
// wait for it forever.
const once = (
  target: SourceBuffer | MediaSource,
  type: string,
  signal?: Signal,
) =>
  new Promise<void>((resolve) => {
    const done = () => {
      target.removeEventListener(type, done);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    target.addEventListener(type, done);
    signal?.addEventListener('abort', done);
  });

async function fetchRange(url: string, start: number, signal: Signal) {
  const res = await fetch(url, {
    headers: {Range: `bytes=${start}-${start + CHUNK_BYTES - 1}`},
    signal,
  });
  if (res.status !== 206 && res.status !== 200) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const total = Number(
    /\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1],
  );
  const data = await res.arrayBuffer();
  return {
    data,
    total: Number.isFinite(total) ? total : start + data.byteLength,
  };
}

// Attaches a MediaSource to `player` and streams `url` into it chunk by chunk.
// Resolves when the whole file is appended; rejects on network or append
// errors. Abort `signal` to stop (e.g. on unmount or background).
export async function playWithMse(
  player: VideoPlayer,
  url: string,
  signal: Signal,
  durationHint?: number,
  // Receives the MediaSource as soon as it is attached, so teardown can
  // detach it (useVideoPlayer.ts release()).
  onAttach?: (ms: MediaSource) => void,
) {
  if (!MediaSource.isTypeSupported(MP4_MIME)) {
    throw new Error(`MSE does not support ${MP4_MIME}`);
  }
  const ms = new MediaSource();
  const opened = once(ms, 'sourceopen', signal);
  player.srcObject = ms as unknown as VideoPlayer['srcObject'];
  onAttach?.(ms);
  await opened;
  if (signal.aborted) {
    return;
  }

  const sb = ms.addSourceBuffer(MP4_MIME);
  // Without this, duration stays Infinity until endOfStream().
  if (durationHint && durationHint > 0) {
    ms.duration = durationHint;
  }
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    if (signal.aborted) {
      return;
    }
    const chunk = await fetchRange(url, offset, signal);
    total = chunk.total;
    if (chunk.data.byteLength === 0) {
      break;
    }
    const done = once(sb, 'updateend', signal);
    sb.appendBuffer(chunk.data);
    await done;
    offset += chunk.data.byteLength;
  }
  if (!signal.aborted && ms.readyState === ReadyState.open) {
    ms.endOfStream();
  }
}
