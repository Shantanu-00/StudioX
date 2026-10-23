import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {MediaSource, VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import {useKeplerAppStateManager} from '@amazon-devices/react-native-kepler';
import {playWithMse} from './mseLoader';
import {createPlaybackStore} from './playbackStore';

export type PlayerStatus = 'loading' | 'ready' | 'error';

// Resume positions survive the player being torn down on background (the JS
// runtime keeps running; the surface does not).
const resumeAt = new Map<string, number>();
export const resumePosition = (id: string) => resumeAt.get(id) ?? 0;

// Vega allows one active decoder pipeline per app: the previous player must
// finish `deinitialize()` before the next `initialize()` (media
// troubleshooting docs). Every teardown is chained here and every new player
// waits for it, so moving from one episode to the next cannot overlap.
let teardown: Promise<void> = Promise.resolve();

// A teardown that never settles must not block every later episode.
const RELEASE_TIMEOUT_MS = 3000;
// Metadata arrived but no first frame: the pipeline is stuck at READY (seen
// on the Virtual Device for the episode after another one). Rebuild once.
const STALL_MS = 8000;
const MAX_REBUILDS = 1;

// Pauses and resolves once the pipeline reports `pause` (or after
// `timeoutMs`). Tearing down a pipeline that is still playing (surface
// destroyed or element destroyed mid-decode) left the Virtual Device unable
// to preroll the next episode; a paused one released cleanly.
export function pauseAndWait(p: VideoPlayer, timeoutMs = 800): Promise<void> {
  if (p.paused) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      p.removeEventListener('pause', done);
      if (timer) {
        clearTimeout(timer);
      }
      resolve();
    };
    p.addEventListener('pause', done);
    timer = setTimeout(done, timeoutMs);
    p.pause();
  });
}

// Releases one player completely:
// 1. pause, and wait until it has taken effect;
// 2. detach the MediaSource (the W3C "detach from a media element" steps:
//    SourceBuffers removed, native media source let go);
// 3. clear the surface; 4. `deinitialize()`, bounded by a timeout.
// Without step 2 the MSE pipeline of an episode that had played to the end
// outlived `deinitialize()` on the Virtual Device (no `deinit_pipeline` in
// the log) and kept the decoder, so the next episode stopped at READY.
// Step 2 is the detach alone, not `removeAttribute('src')` + `load()`: the
// empty-src load sometimes built a fresh, empty pipeline just before the
// element was destroyed, after which no later pipeline prerolled.
async function release(
  p: VideoPlayer,
  ms: MediaSource | null,
  handle: string | null,
  label: string,
) {
  const started = Date.now();
  await pauseAndWait(p);
  try {
    p.autoplay = false;
    ms?.resetMediaElementHandle();
  } catch (e) {
    console.warn(`[player] ${label}: detach failed`, e);
  }
  if (handle) {
    p.clearSurfaceHandle(handle);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    p.deinitialize().then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), RELEASE_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
  console.warn(
    `[player] ${label}: released in ${Date.now() - started} ms${
      timedOut ? ' (deinitialize timed out)' : ''
    }`,
  );
}

// MSE reports duration as Infinity until the stream ends; never show that.
const finite = (d: number) => (Number.isFinite(d) && d > 0 ? d : 0);

// One W3C VideoPlayer following the Vega lifecycle:
// new → setMediaControlFocus (Vega Media Controls: remote + Alexa transport)
// → initialize → listeners → surface handle → media via MSE. Released on
// unmount and on background, as media certification requires.
//
// `fallbackUrl`: if `url` (the CDN copy) fails before the first frame, the
// player is rebuilt once on the fallback (the local companion server).
//
// `autoplay` false: load and show the first frame but stay paused (the Map
// opened from Home starts over a paused episode).
export function useVideoPlayer(
  id: string,
  primaryUrl: string,
  durationHint: number,
  fallbackUrl?: string,
  autoplay = true,
) {
  const autoplayRef = useRef(autoplay);
  const [onFallback, setOnFallback] = useState(false);
  const url = onFallback && fallbackUrl ? fallbackUrl : primaryUrl;
  const appState = useKeplerAppStateManager();
  const store = useMemo(() => createPlaybackStore(), []);
  const [status, setStatus] = useState<PlayerStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [suspended, setSuspended] = useState(false);
  const player = useRef<VideoPlayer | null>(null);
  const surface = useRef<string | null>(null);
  const ready = useRef(false);
  const loader = useRef<AbortController | null>(null);
  const source = useRef<MediaSource | null>(null);
  // Set at the first `canplay`; after that, errors are shown, not retried.
  const started = useRef(false);
  // Rebuilds after a stall, per hook instance (one episode).
  const rebuilds = useRef(0);

  // Before the first frame, one failure on the primary URL moves to the
  // fallback; anything else is a real error for the viewer.
  const fail = useCallback(
    (message: string) => {
      if (!started.current && !onFallback && fallbackUrl) {
        console.warn(
          `[player] ${message} on ${url}; falling back to ${fallbackUrl}`,
        );
        setOnFallback(true);
        return;
      }
      setError(message);
      setStatus('error');
    },
    [onFallback, fallbackUrl, url],
  );

  // Surface first, then feed the media through MSE (see mseLoader.ts for why
  // not URL mode). Runs once per player instance.
  const attach = useCallback(() => {
    const p = player.current;
    if (!p || !ready.current || !surface.current) {
      return;
    }
    p.setSurfaceHandle(surface.current);
    if (loader.current) {
      return;
    }
    const controller = new AbortController();
    loader.current = controller;
    p.autoplay = autoplayRef.current;
    playWithMse(p, url, controller.signal, durationHint, (ms) => {
      if (player.current === p) {
        source.current = ms;
      }
    }).catch((e) => {
      if (!controller.signal.aborted && player.current === p) {
        console.error(`[player] MSE load failed: ${String(e?.message ?? e)}`);
        fail(`Could not load the episode (${String(e?.message ?? e)})`);
      }
    });
  }, [url, durationHint, fail]);

  useEffect(() => {
    if (suspended) {
      return;
    }
    let cancelled = false;
    const p = new VideoPlayer();
    player.current = p;
    ready.current = false;
    started.current = false;
    setStatus('loading');
    setError(null);
    store.set({
      duration: durationHint,
      t: resumeAt.get(id) ?? 0,
      buffering: true,
    });

    let stall: ReturnType<typeof setTimeout> | undefined;
    const on: Record<string, () => void> = {
      loadedmetadata: () => {
        if (!started.current && !stall) {
          stall = setTimeout(() => {
            if (cancelled || started.current) {
              return;
            }
            if (rebuilds.current < MAX_REBUILDS) {
              rebuilds.current += 1;
              console.warn(`[player] ${id}: no first frame, rebuilding`);
              setGeneration((g) => g + 1);
            } else {
              console.warn(`[player] ${id}: no first frame after rebuild`);
              setError('Playback did not start');
              setStatus('error');
            }
          }, STALL_MS);
        }
        const d = finite(p.duration) || durationHint;
        store.set({duration: d});
        const start = resumeAt.get(id) ?? 0;
        if (start > 0 && start < d - 1) {
          p.currentTime = start;
        }
      },
      durationchange: () => {
        const d = finite(p.duration);
        if (d) {
          store.set({duration: d});
        }
      },
      canplay: () => {
        if (!started.current) {
          // Warning level: Vega suppresses info logs above 300 lines/s,
          // which media playback reaches, so this marker survives.
          console.warn(`[player] ${id}: canplay`);
        }
        started.current = true;
        if (stall) {
          clearTimeout(stall);
          stall = undefined;
        }
        setStatus('ready');
        store.set({buffering: false});
      },
      playing: () => {
        autoplayRef.current = true;
        store.set({paused: false, buffering: false});
      },
      play: () => store.set({paused: false}),
      pause: () => store.set({paused: true}),
      waiting: () => store.set({buffering: true}),
      timeupdate: () => {
        // Quarter-second resolution is plenty for the UI and halves updates.
        const t = Math.round(p.currentTime * 4) / 4;
        store.set({t});
        resumeAt.set(id, t);
      },
      ended: () => {
        store.set({paused: true});
        resumeAt.delete(id);
      },
      error: () => {
        const code = p.error?.code;
        console.error(
          `[player] error code=${code} message=${
            p.error?.message ?? ''
          } src=${url}`,
        );
        fail(code ? `MEDIA_ERR ${code}` : 'Unknown playback error');
      },
    };

    (async () => {
      try {
        await teardown;
        if (cancelled) {
          return;
        }
        try {
          await p.setMediaControlFocus(appState.getComponentInstance());
        } catch (e) {
          // Playback still works without KMC; transport keys fall back to the
          // in-app remote handler.
          console.warn('[player] setMediaControlFocus failed', e);
        }
        await p.initialize();
        if (cancelled) {
          return;
        }
        Object.entries(on).forEach(([type, fn]) =>
          p.addEventListener(type, fn),
        );
        ready.current = true;
        attach();
      } catch (e) {
        if (!cancelled) {
          setError(String((e as Error)?.message ?? e));
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (stall) {
        clearTimeout(stall);
      }
      ready.current = false;
      loader.current?.abort();
      loader.current = null;
      Object.entries(on).forEach(([type, fn]) =>
        p.removeEventListener(type, fn),
      );
      const handle = surface.current;
      const ms = source.current;
      source.current = null;
      teardown = teardown
        .then(() => release(p, ms, handle, id))
        .catch((e) => console.warn('[player] deinitialize failed', e));
      if (player.current === p) {
        player.current = null;
      }
    };
    // `fail` changes only together with `url`, so it never rebuilds alone.
  }, [
    id,
    url,
    durationHint,
    generation,
    suspended,
    appState,
    attach,
    store,
    fail,
  ]);

  // Release media in the background (the effect above tears the player down
  // when `suspended` flips); rebuild and resume from `resumeAt` on return.
  useEffect(() => {
    const sub = appState.addAppStateListener('change', (next) => {
      if (next === 'background') {
        player.current?.pause();
        setSuspended(true);
      } else if (next === 'active') {
        setSuspended(false);
      }
    });
    return () => sub.remove();
  }, [appState]);

  const onSurfaceViewCreated = useCallback(
    (handle: string) => {
      surface.current = handle;
      attach();
    },
    [attach],
  );
  const onSurfaceViewDestroyed = useCallback((handle: string) => {
    player.current?.clearSurfaceHandle(handle);
    surface.current = null;
  }, []);

  const play = useCallback(() => {
    autoplayRef.current = true; // later rebuilds (background) resume playing
    player.current
      ?.play()
      .catch((e) => console.warn('[player] play failed', e));
  }, []);
  const pause = useCallback(() => player.current?.pause(), []);
  // Before leaving the player: pause first, so the surface is never torn
  // down under a decoding pipeline.
  const pauseForExit = useCallback(
    () => (player.current ? pauseAndWait(player.current) : Promise.resolve()),
    [],
  );
  const toggle = useCallback(() => {
    if (store.get().paused) {
      play();
    } else {
      pause();
    }
  }, [play, pause, store]);
  const seek = useCallback(
    (seconds: number) => {
      const p = player.current;
      if (!p) {
        return;
      }
      const d = store.get().duration || finite(p.duration);
      const t = Math.max(0, d ? Math.min(seconds, d - 0.25) : seconds);
      p.currentTime = t;
      store.set({t});
    },
    [store],
  );
  // Try again from the primary (CDN) URL.
  const retry = useCallback(() => {
    rebuilds.current = 0;
    setOnFallback(false);
    setGeneration((g) => g + 1);
  }, []);

  return {
    store,
    status,
    error,
    surfaceProps: {onSurfaceViewCreated, onSurfaceViewDestroyed},
    play,
    pause,
    pauseForExit,
    toggle,
    seek,
    retry,
  };
}
