import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {
  KeplerVideoSurfaceView,
  VideoPlayer,
} from '@amazon-devices/react-native-w3cmedia';
import {
  useKeplerAppStateManager,
  useTVEventHandler,
} from '@amazon-devices/react-native-kepler';
import {
  awaitPlayerTeardown,
  queuePlayerTeardown,
  release,
} from '../player/useVideoPlayer';
import {colors} from '../theme';
import {IntroNative} from './IntroNative';

interface Props {
  onDone: () => void;
  // Test seam; the app always plays the bundled file.
  src?: string;
}

// The opening is the rendered v5 title sequence itself (scripts/intro/
// README-v5.md): the silent 1920 × 1080, 60 fps H.264 export, 10 s, ~790 KB.
// It ships in the package under the root `assets/raw/` folder, which the
// build copies to `/pkg/assets/raw/` (Amazon's advice for media the asset
// APIs do not resolve yet; `/pkg` is a stable path). Played in W3C URL mode:
// a local file needs no network, unlike the episodes (see mseLoader.ts).
export const INTRO_SRC = '/pkg/assets/raw/studiox-intro-v5.mp4';

// No first frame by then: play the native re-creation instead. Measured on
// the Vega Virtual Device at cold start: opening the pipeline alone
// (`setSrcUri`) took 1.53 s on one launch, and `playing` came 0.77-1.8 s
// after mount; the 1.5 s first planned switched that launch to the fallback
// although the video began 0.3 s later. 3 s keeps a bound and lets the real
// v5 render play. Re-measure on hardware.
export const START_TIMEOUT_MS = 3000;
// Hard upper bound, re-armed when the video starts (10 s of picture).
export const SAFETY_MS = 12000;

const SKIP_KEYS = new Set(['select', 'enter', 'playpause', 'play']);

// Milliseconds since the intro mounted, for the start-up log lines (warning
// level: Vega rate-limits info logs during media playback).
let mountedAt = 0;
const since = () => Date.now() - mountedAt;

type Mode = 'video' | 'native';

// One W3C VideoPlayer on a full-screen surface, black underneath. Owns the
// player: initialize after any earlier player is released, attach the surface,
// set `src`; on unmount pause, clear the surface and deinitialize (queued on
// the app-wide teardown chain so an episode player cannot overlap it).
const IntroVideo = ({
  src,
  onStart,
  onEnd,
  onFail,
}: {
  src: string;
  onStart: () => void;
  onEnd: () => void;
  onFail: (why: string) => void;
}) => {
  const cbs = useRef({onStart, onEnd, onFail});
  cbs.current = {onStart, onEnd, onFail};
  const player = useRef<VideoPlayer | null>(null);
  const surface = useRef<string | null>(null);
  const ready = useRef(false);
  const attached = useRef(false);

  const attach = useCallback(() => {
    const p = player.current;
    if (!p || !ready.current || !surface.current || attached.current) {
      return;
    }
    attached.current = true;
    p.setSurfaceHandle(surface.current);
    p.muted = true;
    p.autoplay = true;
    p.src = src;
    console.warn(`[intro] src set at ${since()} ms`);
  }, [src]);

  useEffect(() => {
    let cancelled = false;
    let started = false;
    const p = new VideoPlayer();
    player.current = p;
    const on: Record<string, () => void> = {
      canplay: () => {
        if (p.paused && !started) {
          p.play().catch((e) => console.warn('[intro] play failed', e));
        }
      },
      playing: () => {
        if (!started) {
          started = true;
          console.warn(`[intro] video playing at ${since()} ms`);
          cbs.current.onStart();
        }
      },
      ended: () => cbs.current.onEnd(),
      error: () => {
        const code = p.error?.code;
        console.error(
          `[intro] error code=${code} message=${p.error?.message ?? ''} src=${src}`,
        );
        cbs.current.onFail(code ? `MEDIA_ERR ${code}` : 'playback error');
      },
    };
    const init = (async () => {
      await awaitPlayerTeardown();
      if (cancelled) {
        return;
      }
      await p.initialize();
      if (cancelled) {
        return;
      }
      Object.entries(on).forEach(([type, fn]) => p.addEventListener(type, fn));
      ready.current = true;
      attach();
    })();
    init.catch((e) => {
      if (!cancelled) {
        cbs.current.onFail(String((e as Error)?.message ?? e));
      }
    });
    return () => {
      cancelled = true;
      ready.current = false;
      Object.entries(on).forEach(([type, fn]) =>
        p.removeEventListener(type, fn),
      );
      const handle = surface.current;
      player.current = null;
      // Release only a player whose initialize() ran, and only after it did.
      queuePlayerTeardown(async () => {
        const ok = await init.then(
          () => true,
          () => false,
        );
        if (ok) {
          await release(p, null, attached.current ? handle : null, 'intro');
        }
      });
    };
  }, [src, attach]);

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

  return (
    <KeplerVideoSurfaceView
      style={StyleSheet.absoluteFill}
      onSurfaceViewCreated={onSurfaceViewCreated}
      onSurfaceViewDestroyed={onSurfaceViewDestroyed}
      testID="intro-video"
    />
  );
};

// Cold start only (App.tsx). Every way out (natural end, SELECT/ENTER/PLAY,
// error after the first frame, background, the safety timeout, the end of the
// native fallback) calls `finish`, which reaches `onDone` exactly once. BACK
// is routed by App, which unmounts this screen.
export const Intro = ({onDone, src = INTRO_SRC}: Props) => {
  const appState = useKeplerAppStateManager();
  const [mode, setMode] = useState<Mode>('video');
  const done = useRef(false);
  const mounted = useRef(false);
  const started = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const safety = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const finish = useCallback((why: string) => {
    if (done.current || !mounted.current) {
      return;
    }
    done.current = true;
    console.warn(`[intro] finish: ${why} at ${since()} ms`);
    onDoneRef.current();
  }, []);

  const armSafety = useCallback(() => {
    if (safety.current) {
      clearTimeout(safety.current);
    }
    safety.current = setTimeout(() => finish('safety timeout'), SAFETY_MS);
  }, [finish]);

  const toNative = useCallback((why: string) => {
    if (done.current) {
      return;
    }
    console.warn(`[intro] native fallback: ${why} at ${since()} ms`);
    setMode('native');
  }, []);

  const onStart = useCallback(() => {
    started.current = true;
    armSafety();
  }, [armSafety]);
  const onEnd = useCallback(() => finish('ended'), [finish]);
  const onFail = useCallback(
    (why: string) => (started.current ? finish(why) : toNative(why)),
    [finish, toNative],
  );
  const onNativeDone = useCallback(() => finish('native done'), [finish]);

  // On key-up (eventKeyAction 1), not key-down: finishing on key-down mounted
  // Home under a held SELECT, and its release pressed the focused Play button
  // (seen on the VVD: the skip started episode 1).
  useTVEventHandler((evt) => {
    if (SKIP_KEYS.has(evt.eventType) && evt.eventKeyAction === 1) {
      finish('skip');
    }
  });

  // Safety timeout and background, for the whole screen.
  useEffect(() => {
    mounted.current = true;
    mountedAt = Date.now();
    armSafety();
    const sub = appState.addAppStateListener('change', (next) => {
      if (next === 'background') {
        finish('background');
      }
    });
    return () => {
      sub.remove();
      if (safety.current) {
        clearTimeout(safety.current);
      }
      mounted.current = false; // unmounted (BACK): no late onDone
    };
  }, [appState, armSafety, finish]);

  // Start timeout: no first frame within START_TIMEOUT_MS.
  useEffect(() => {
    if (mode !== 'video') {
      return;
    }
    const t = setTimeout(() => {
      if (!started.current) {
        toNative('start timeout');
      }
    }, START_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [mode, toNative]);

  return (
    <View style={styles.root} accessible accessibilityLabel="StudioX">
      {mode === 'video' ? (
        <IntroVideo
          src={src}
          onStart={onStart}
          onEnd={onEnd}
          onFail={onFail}
        />
      ) : (
        <IntroNative onDone={onNativeDone} />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.black},
});
