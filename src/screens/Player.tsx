import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {KeplerVideoSurfaceView} from '@amazon-devices/react-native-w3cmedia';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {
  ProgressBar,
  SeekBar,
  SeekBarHandle,
} from '@amazon-devices/kepler-ui-components';
import {
  displayCase,
  isQuestionable,
  peopleAt,
  teaserOf,
} from '../analysis/cardText';
import {
  composeCard,
  formatTime,
  mergeRefined,
  NOTHING_YET,
  suggestedQuestions,
  WINDOW_AFTER,
} from '../analysis/composer';
import {
  PackageSource,
  provenanceLine,
  usePackage,
} from '../analysis/packageLoader';
import {ClaimWidget, EpisodeAnalysis} from '../analysis/schema';
import {FocusFrame} from '../components/FocusFrame';
import {Episode} from '../data/episodes';
import {useLink} from '../hooks/useLink';
import {useSystemToast} from '../hooks/useSystemToast';
import {
  askKey,
  cardKey,
  CoViewPanel,
  LIST,
  PANEL_W,
  PanelView,
} from '../player/CoViewPanel';
import {PlaybackStore, usePlayback} from '../player/playbackStore';
import {SpoilerGate} from '../player/SpoilerGate';
import {
  useAsk,
  useLiveSession,
  useNowPlaying,
  useRefine,
  useShare,
} from '../player/useCoViewer';
import {resumePosition, useVideoPlayer} from '../player/useVideoPlayer';
import {FRAME, MapScreen} from '../map/MapScreen';
import {AccentDot, alarming} from '../widgets/parts';
import {colors, motion, numeric, radius, space, type} from '../theme';

interface Props {
  episode: Episode;
  // Opened from Home's Map button: the Map comes up at once, over a paused
  // episode at its resume position.
  startWithMap?: boolean;
  onExit: () => void;
  // The player claims BACK first: gate → answer → detail → panel → leave.
  registerBack: (handler: (() => boolean) | null) => void;
}

const HIDE_CONTROLS_MS = 4000;
const TRANSPORT_FALLBACK_MS = 350;
// Insight banner: shown for 5 s, at most once a minute, once per claim.
const BANNER_MS = 5000;
const BANNER_GAP_MS = 60000;
// Height of the seek bar block (bar, times, hint) above the bottom margin.
const CONTROLS_H = 72;
const BANNER_H = 76; // a two-line banner: 12 + 25 + 2 + 18 + 12, rounded up

const momentIndex = (a: EpisodeAnalysis, t: number) => {
  let idx = -1;
  a.moments.forEach((m, i) => {
    if (m.t <= t + 0.25) {
      idx = i;
    }
  });
  return idx;
};

// Uploads have no bundled analysis: say plainly what the co-viewer has.
const UPLOAD_NOTE: Partial<
  Record<PackageSource, {caption: string; footer: string}>
> = {
  pending: {
    caption: 'Analysing this video…',
    footer: 'Cards appear here when the analysis is ready',
  },
  none: {
    caption: 'No co-viewer analysis for this video.',
    footer: 'Not analysed',
  },
};

const NONE_CAPTION: Record<string, string> = {
  NOT_A_FIT: 'Not analysed: there is too little speech in this video.',
  FAILED: 'The analysis of this video failed.',
};

export const Player = ({episode, startWithMap, onExit, registerBack}: Props) => {
  const uploadStatus = episode.upload?.status;
  const remote = useMemo(
    () =>
      uploadStatus
        ? {
            url: episode.packageUrl,
            expected: uploadStatus !== 'NOT_A_FIT' && uploadStatus !== 'FAILED',
          }
        : undefined,
    [uploadStatus, episode.packageUrl],
  );
  const {analysis, source} = usePackage(episode.id, remote);
  const note = UPLOAD_NOTE[source];
  const pl = useVideoPlayer(
    episode.id,
    episode.mediaUrl,
    episode.durationSec,
    episode.fallbackMediaUrl,
    !startWithMap,
  );
  const link = useLink();
  const confirm = useSystemToast();
  const sessionId = useLiveSession(episode.id);
  useNowPlaying(pl.store, link, episode.id, episode.title);
  const win = useWindowDimensions();

  const paused = usePlayback(pl.store, (s) => s.paused);
  const moment = usePlayback(pl.store, (s) => momentIndex(analysis, s.t));

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelT, setPanelT] = useState(0);
  const [view, setView] = useState<PanelView>(LIST);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // A card the banner sent the viewer to: kept in the list even if the
  // composer would rank it lower.
  const [pick, setPick] = useState<string | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [controls, setControls] = useState(true);
  // The Map: open over the paused episode; `mapT` is the playhead it opened at.
  const [mapT, setMapT] = useState<number | null>(() =>
    startWithMap ? resumePosition(episode.id) : null,
  );
  const mapOpen = mapT !== null && !!analysis.explore;
  const mapOpenRef = useRef(mapOpen);
  mapOpenRef.current = mapOpen;
  const mapBack = useRef<(() => boolean) | null>(null);
  const panelBeforeMap = useRef(false);
  const seekRef = useRef<SeekBarHandle>(null);
  const leaving = useRef(false);
  const pauseForExit = pl.pauseForExit;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The instant local card, refined in place when the live co-viewer
  // answers for this same moment (pause only; never while playing).
  const refined = useRefine(sessionId, episode.id, panelT, panelOpen && paused);
  const card = useMemo(
    () => mergeRefined(composeCard(analysis, panelT), refined),
    [analysis, panelT, refined],
  );
  const people = useMemo(
    () => peopleAt(analysis.widgets, panelT, WINDOW_AFTER),
    [analysis, panelT],
  );
  const cards = useMemo(() => {
    const inRibbon = new Set(people.map((p) => p.id));
    const list = card.widgets.filter((w) => !inRibbon.has(w.id));
    const picked = pick ? analysis.widgets.find((w) => w.id === pick) : null;
    if (picked && !list.some((w) => w.id === picked.id)) {
      return [picked, ...list].slice(0, 3);
    }
    return list;
  }, [card, people, pick, analysis]);
  const caption = useMemo(() => {
    if (note && cards.length === 0 && people.length === 0) {
      return source === 'none' && uploadStatus && NONE_CAPTION[uploadStatus]
        ? NONE_CAPTION[uploadStatus]
        : note.caption;
    }
    // Never filler: only a real line about this moment.
    return card.caption && card.caption !== NOTHING_YET ? card.caption : null;
  }, [note, cards, people, source, uploadStatus, card.caption]);
  const asks = useMemo(
    () => suggestedQuestions(analysis, panelT),
    [analysis, panelT],
  );
  const {answer, ask, close: closeAnswer} = useAsk(sessionId, episode.id);
  const share = useShare(link, episode.id, pl.store, card.widgets, confirm);

  const openPanel = useCallback(
    (focusCard?: string) => {
      setPanelT(pl.store.get().t);
      setView(LIST);
      setPick(focusCard ?? null);
      setFocusKey(focusCard ? cardKey(focusCard) : null);
      setPanelOpen(true);
      console.warn(`[panel] open list${focusCard ? ` at ${focusCard}` : ''}`);
    },
    [pl.store],
  );
  const closePanel = useCallback(() => {
    closeAnswer();
    setView(LIST);
    setPick(null);
    setPanelOpen(false);
    seekRef.current?.requestTVFocus();
  }, [closeAnswer]);
  const onView = useCallback((v: PanelView, key: string) => {
    // Warning level survives Vega's info-log rate limit (on-device checks).
    console.warn(`[panel] open ${v.kind} ${key}`);
    setFocusKey(key);
    setView(v);
  }, []);
  const onAsk = useCallback(
    (i: number) => {
      const a = asks[i];
      if (a) {
        setFocusKey(askKey(i));
        ask(a, panelT);
      }
    },
    [asks, ask, panelT],
  );

  // The panel follows the player: pausing by any route (Vega Media Controls,
  // the remote, the SeekBar) opens it; resuming closes it.
  // Only a real play → pause transition opens it (not the paused state the
  // player starts in before autoplay begins).
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (pl.status !== 'ready') {
      return;
    }
    if (paused && wasPlaying.current) {
      if (!mapOpenRef.current) {
        openPanel();
      }
    } else if (!paused) {
      setPanelOpen(false);
      setView(LIST);
      setPick(null);
      setGateOpen(false);
      // Playing again by any route (e.g. the remote's play key through
      // Vega Media Controls) leaves the Map.
      setMapT(null);
      closeAnswer();
    }
    wasPlaying.current = !paused;
  }, [paused, pl.status, openPanel, closeAnswer]);

  // Opened while playing: follow the story moment by moment, but never pull
  // the list out from under an open detail or answer.
  const browsing = view.kind !== 'list' || !!answer;
  useEffect(() => {
    if (panelOpen && !paused && !browsing) {
      setPanelT(pl.store.get().t);
    }
  }, [moment, panelOpen, paused, browsing, pl.store]);

  const showControls = useCallback(() => {
    setControls(true);
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    hideTimer.current = setTimeout(() => {
      if (!pl.store.get().paused) {
        setControls(false);
      }
    }, HIDE_CONTROLS_MS);
  }, [pl.store]);
  useEffect(() => {
    showControls();
    return () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
    };
  }, [showControls]);
  useEffect(() => {
    if (paused) {
      setControls(true);
    } else {
      showControls();
    }
  }, [paused, showControls]);

  const banner = useInsightBanner(
    pl.store,
    analysis,
    pl.status === 'ready' && !paused && !panelOpen && !mapOpen,
  );

  // Map: pause first if playing, then open it at the paused playhead.
  const openMap = useCallback(() => {
    panelBeforeMap.current = panelOpen;
    setPanelOpen(false);
    closeAnswer();
    if (!pl.store.get().paused) {
      pl.pause();
    }
    const t = pl.store.get().t;
    console.warn(`[map] open at ${t}`);
    setMapT(t);
  }, [pl, panelOpen, closeAnswer]);
  // BACK out of the Map: the same paused position, with what was there.
  const closeMap = useCallback(() => {
    setMapT(null);
    if (panelBeforeMap.current) {
      openPanel();
    } else {
      setTimeout(() => seekRef.current?.requestTVFocus(), 0);
    }
  }, [openPanel]);
  const playFrom = useCallback(
    (t: number | null) => {
      setMapT(null);
      if (t !== null) {
        pl.seek(t);
      }
      pl.play();
    },
    [pl],
  );
  const registerMapBack = useCallback((h: (() => boolean) | null) => {
    mapBack.current = h;
  }, []);

  useEffect(() => {
    registerBack(() => {
      if (mapOpen) {
        if (!mapBack.current?.()) {
          closeMap();
        }
        return true;
      }
      if (gateOpen) {
        setGateOpen(false);
        return true;
      }
      if (answer) {
        closeAnswer(); // focus returns to the question (focusKey)
        return true;
      }
      if (panelOpen && view.kind !== 'list') {
        setView(LIST); // focus returns to the row that opened it
        return true;
      }
      if (panelOpen) {
        closePanel();
        return true;
      }
      // Leaving: pause and let it take effect before the surface unmounts.
      if (!leaving.current) {
        leaving.current = true;
        pauseForExit().finally(onExit);
      }
      return true;
    });
    return () => registerBack(null);
  }, [
    registerBack,
    mapOpen,
    closeMap,
    gateOpen,
    answer,
    closeAnswer,
    panelOpen,
    view,
    closePanel,
    pauseForExit,
    onExit,
  ]);

  useTVEventHandler((evt) => {
    if (evt.eventKeyAction === 1) {
      return; // key up
    }
    if (mapOpen) {
      // The Map owns the D-pad; transport keys still reach Vega Media
      // Controls, and playing again closes the Map.
      return;
    }
    showControls();
    if (gateOpen) {
      return;
    }
    switch (evt.eventType) {
      case 'menu':
        if (panelOpen) {
          closePanel();
        } else {
          openPanel();
        }
        break;
      case 'down':
        if (!panelOpen) {
          openPanel(banner?.id);
        }
        break;
      case 'playpause':
      case 'play':
      case 'pause': {
        // Vega Media Controls normally handles transport keys. If the state
        // has not changed shortly after, toggle in-app instead.
        const before = pl.store.get().paused;
        setTimeout(() => {
          if (pl.store.get().paused === before) {
            pl.toggle();
          }
        }, TRANSPORT_FALLBACK_MS);
        break;
      }
    }
  });

  const seekTo = useCallback(
    (t: number) => {
      pl.seek(t);
      setPanelT(t);
    },
    [pl],
  );

  // With the panel open the picture shrinks into the area on its left,
  // 16:9 and vertically centred on black: one layout change, no animation
  // per frame, nothing drawn over the video.
  const videoW = win.width - PANEL_W;
  const videoH = Math.round((videoW * 9) / 16);
  const videoTop = Math.round((win.height - videoH) / 2);
  const videoBox = mapOpen
    ? {left: FRAME.x, top: FRAME.y, width: FRAME.w, height: FRAME.h}
    : panelOpen
    ? {left: 0, top: videoTop, width: videoW, height: videoH}
    : {left: 0, top: 0, width: win.width, height: win.height};
  const explore = analysis.explore;
  const sideRight = panelOpen ? PANEL_W + space.l : space.safeX;

  return (
    <View style={styles.root}>
      <View style={[styles.video, videoBox]}>
        <KeplerVideoSurfaceView style={styles.fill} {...pl.surfaceProps} />
      </View>

      {!mapOpen ? (
      <Captions
        store={pl.store}
        analysis={analysis}
        bottom={
          banner
            ? space.safeY + CONTROLS_H + BANNER_H + space.s
            : panelOpen
            ? win.height - (videoTop + videoH) + space.s
            : controls
            ? space.safeY + CONTROLS_H + space.xs
            : space.safeY + space.xs
        }
        left={panelOpen ? space.l : space.safeX + space.xl}
        right={panelOpen ? PANEL_W + space.l : space.safeX + space.xl}
      />
      ) : null}

      {controls && !mapOpen && (
        <>
          <View
            style={[styles.topScrim, panelOpen && {right: PANEL_W}]}
            pointerEvents="none"
          />
          {!panelOpen ? (
            <View style={styles.bottomScrim} pointerEvents="none" />
          ) : null}
          <View style={[styles.top, {right: sideRight}]} pointerEvents="none">
            <Text style={styles.show} numberOfLines={1}>
              {displayCase(`${episode.show} · ${episode.label}`)}
            </Text>
            <Text style={styles.title} numberOfLines={1}>
              {episode.title}
            </Text>
          </View>
          <View style={[styles.bottom, {right: sideRight}]}>
            <Scrubber
              ref={seekRef}
              store={pl.store}
              analysis={analysis}
              episode={episode}
              onSeek={pl.seek}
              onToggle={pl.toggle}
            />
            {!panelOpen ? (
              <Text style={styles.hint} numberOfLines={1}>
                Press ▼ for the co-viewer
              </Text>
            ) : null}
          </View>
        </>
      )}

      <InsightBanner claim={banner} />

      <CoViewPanel
        open={panelOpen}
        title={card.segment?.title ?? episode.title}
        cards={cards}
        people={people}
        caption={caption}
        footer={`${card.refined ? 'Live · ' : ''}${
          note ? note.footer : provenanceLine(analysis)
        }`}
        now={panelT}
        spoilersRevealed={revealed}
        onSeek={seekTo}
        onLocked={() => setGateOpen(true)}
        view={view}
        onView={onView}
        focusKey={focusKey}
        onMap={explore ? openMap : undefined}
        asks={asks}
        onAsk={onAsk}
        answer={answer}
        share={share}
      />

      {mapOpen && explore ? (
        <MapScreen
          explore={explore}
          answers={analysis.answers ?? []}
          widgets={analysis.widgets}
          mediaId={episode.id}
          sourceTitle={episode.title}
          playhead={mapT}
          frame
          sessionId={sessionId}
          link={link}
          confirm={confirm}
          onPlayMoment={playFrom}
          onKeepWatching={() => playFrom(null)}
          onClose={closeMap}
          registerBack={registerMapBack}
        />
      ) : null}

      {pl.status === 'loading' && !mapOpen && (
        <View
          style={[styles.center, panelOpen && {right: PANEL_W}]}
          pointerEvents="none">
          <View
            style={styles.progress}
            accessible
            accessibilityLabel="Loading episode"
            testID="player-loading">
            <ProgressBar
              size="xs"
              indicatorColor={colors.text}
              trackColor={colors.track}
            />
          </View>
        </View>
      )}

      {pl.status === 'error' && !mapOpen && (
        <View style={styles.center}>
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>
              This episode can’t play right now
            </Text>
            <Text style={styles.errorText}>{describeError(pl.error)}</Text>
            <Text style={styles.errorCode}>{pl.error}</Text>
            <View style={styles.errorActions}>
              <FocusFrame
                testID="player-retry"
                accessibilityLabel="Try again"
                variant="button"
                hasTVPreferredFocus
                style={styles.button}
                contentStyle={styles.buttonInner}
                onPress={pl.retry}>
                {(focused) => (
                  <Text
                    style={[
                      styles.buttonText,
                      focused && styles.buttonTextFocused,
                    ]}>
                    Try again
                  </Text>
                )}
              </FocusFrame>
              <FocusFrame
                testID="player-exit"
                accessibilityLabel="Back to Home"
                variant="button"
                style={styles.button}
                contentStyle={styles.buttonInner}
                onPress={() => pauseForExit().finally(onExit)}>
                {(focused) => (
                  <Text
                    style={[
                      styles.buttonText,
                      focused && styles.buttonTextFocused,
                    ]}>
                    Back to Home
                  </Text>
                )}
              </FocusFrame>
            </View>
          </View>
        </View>
      )}

      {gateOpen && (
        <SpoilerGate
          onStay={() => setGateOpen(false)}
          onReveal={() => {
            setRevealed(true);
            setGateOpen(false);
          }}
        />
      )}
    </View>
  );
};

// MEDIA_ERR codes from the W3C HTMLMediaElement spec.
const describeError = (e: string | null) => {
  const code = Number(/MEDIA_ERR (\d)/.exec(e ?? '')?.[1]);
  switch (code) {
    case 2:
      return 'The video could not be downloaded. Check the network connection.';
    case 3:
      return 'The video file could not be decoded.';
    case 4:
      return 'The player could not open this video address or format.';
    default:
      return 'Something went wrong while starting playback.';
  }
};

// ---- insight banner ---------------------------------------------------------

// The claim whose evidence window the playhead is in, if it is one worth a
// banner (anything but SUPPORTED). Shown when playback enters the window, at
// most once a minute and once per claim, for 5 s; hidden at once while the
// panel is open or playback is paused.
export function useInsightBanner(
  store: PlaybackStore,
  analysis: EpisodeAnalysis,
  enabled: boolean,
): ClaimWidget | null {
  const claims = useMemo(
    () => analysis.widgets.filter(isQuestionable),
    [analysis],
  );
  const inWindow = usePlayback(store, (s) => {
    for (const c of claims) {
      const e = c.evidence[0];
      if (e && s.t >= e.t0 && s.t < e.t1) {
        return c.id;
      }
    }
    return null;
  });
  const [shownId, setShownId] = useState<string | null>(null);
  const lastAt = useRef(-Infinity);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) {
      setShownId(null);
      return;
    }
    if (!inWindow || seen.current.has(inWindow)) {
      return;
    }
    const now = Date.now();
    if (now - lastAt.current < BANNER_GAP_MS) {
      return;
    }
    seen.current.add(inWindow);
    lastAt.current = now;
    console.warn(`[banner] ${inWindow}`);
    setShownId(inWindow);
  }, [inWindow, enabled]);

  useEffect(() => {
    if (!shownId) {
      return;
    }
    const t = setTimeout(() => setShownId(null), BANNER_MS);
    return () => clearTimeout(t);
  }, [shownId]);

  return shownId ? claims.find((c) => c.id === shownId) ?? null : null;
}

// Bottom-left of the video, just above the seek bar. Its width follows the
// text (240–420 dp); the text column shrinks, it never collapses.
const InsightBanner = ({claim}: {claim: ClaimWidget | null}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const last = useRef<ClaimWidget | null>(null);
  if (claim) {
    last.current = claim;
  }
  useEffect(() => {
    const anim = Animated.timing(opacity, {
      toValue: claim ? 1 : 0,
      duration: claim ? motion.fadeMs : 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [claim, opacity]);
  const c = last.current;
  if (!c) {
    return null;
  }
  return (
    <Animated.View
      testID="insight-banner"
      style={[styles.banner, {opacity}]}
      pointerEvents="none"
      accessibilityLiveRegion="polite">
      {alarming(c.verdict) ? (
        <View style={styles.bannerDot}>
          <AccentDot />
        </View>
      ) : null}
      <View style={styles.bannerText}>
        <Text style={styles.bannerTeaser} numberOfLines={2}>
          {teaserOf(c)}
        </Text>
        <Text style={styles.bannerHint} numberOfLines={1}>
          Press ▼ for details
        </Text>
      </View>
    </Animated.View>
  );
};

// ---- scrubber: the only component that re-renders with the clock ------------

interface ScrubberProps {
  store: PlaybackStore;
  analysis: EpisodeAnalysis;
  episode: Episode;
  onSeek: (t: number) => void;
  onToggle: () => void;
}

const Scrubber = React.forwardRef<SeekBarHandle, ScrubberProps>(
  ({store, analysis, episode, onSeek, onToggle}, ref) => {
    const t = usePlayback(store, (s) => s.t);
    const duration =
      usePlayback(store, (s) => s.duration) ||
      episode.durationSec ||
      // An upload of unknown length (MSE reports it once fully appended):
      // never hand the SeekBar a zero total.
      Math.max(1, Math.ceil(t));
    const thumb = useRef(0);

    const markers = useMemo(
      () =>
        analysis.segments
          .filter((s) => s.start > 0)
          .map((s) => ({position: s.start * 1000, type: 'break' as const})),
      [analysis],
    );
    const segmentColors = useMemo(
      () =>
        Object.fromEntries(
          analysis.segments.map((_, i) => [
            i,
            {
              baseColor: colors.track,
              seekColor: colors.text,
              progressedColor: colors.text,
            },
          ]),
        ),
      [analysis],
    );
    // A text-only label above the thumb: the segment you are scrubbing to.
    // (The SeekBar's image thumbnail is off: we have no per-second previews,
    // and a fixed poster there reads as a frozen frame.)
    const aboveThumb = useCallback(
      ({focused}: {focused: boolean}) => {
        if (!focused) {
          return null;
        }
        const sec = (thumb.current || t * 1000) / 1000;
        const seg = analysis.segments.find(
          (s) => sec >= s.start && sec < s.end,
        );
        return (
          <View style={styles.thumbLabel}>
            <Text style={styles.thumbTime}>{formatTime(sec)}</Text>
            {seg ? (
              <Text style={styles.thumbTitle} numberOfLines={1}>
                {seg.title}
              </Text>
            ) : null}
          </View>
        );
      },
      [analysis, t],
    );

    return (
      <View>
        <SeekBar
          ref={ref}
          hasTVPreferredFocus
          trapFocus
          currentValue={Math.min(t, duration) * 1000}
          totalValue={duration * 1000}
          step={2000}
          markers={markers}
          segmentColors={segmentColors}
          disableThumbnail
          displayAboveThumb={aboveThumb}
          barTrackColor={colors.track}
          partialDisablingConfiguration={{
            playPause: true,
            skipForward: true,
            skipBackward: true,
          }}
          onValueChange={(v) => {
            thumb.current = v;
          }}
          onSlidingEnd={() => onSeek(thumb.current / 1000)}
          onPress={(v) => {
            if (Math.abs(v - t * 1000) > 1500) {
              onSeek(v / 1000);
            } else {
              onToggle();
            }
          }}
        />
        <View style={styles.times}>
          <Text style={styles.time}>{formatTime(t)}</Text>
          <Text style={styles.time}>{formatTime(duration)}</Text>
        </View>
      </View>
    );
  },
);

// ---- captions from the episode transcript (the demo clips are silent) -------

const Captions = ({
  store,
  analysis,
  bottom,
  left,
  right,
}: {
  store: PlaybackStore;
  analysis: EpisodeAnalysis;
  bottom: number;
  left: number;
  right: number;
}) => {
  const idx = usePlayback(store, (s) =>
    analysis.transcript.findIndex((l) => s.t >= l.t0 && s.t < l.t1),
  );
  const line = analysis.transcript[idx];
  if (!line) {
    return null;
  }
  return (
    <View
      pointerEvents="none"
      style={[styles.captions, {bottom, left, right}]}>
      <Text style={styles.captionText} numberOfLines={2}>
        {line.text}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.black},
  video: {position: 'absolute', backgroundColor: colors.black},
  fill: {flex: 1},
  // Flat translucent bands (no gradients): cheap to composite on 1 GB devices.
  topScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 96,
    backgroundColor: colors.scrim,
  },
  bottomScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
    backgroundColor: colors.scrim,
  },
  top: {
    position: 'absolute',
    top: space.safeY,
    left: space.safeX,
  },
  show: {...type.caption, color: colors.textSecondary},
  title: {...type.title, color: colors.text},
  bottom: {
    position: 'absolute',
    left: space.safeX,
    bottom: space.safeY,
  },
  times: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 4},
  time: {...type.caption, ...numeric, color: colors.textSecondary},
  hint: {...type.caption, color: colors.textTertiary, marginTop: 4},
  thumbLabel: {
    alignItems: 'center',
    minWidth: 64,
    maxWidth: 280,
    backgroundColor: colors.card,
    borderRadius: radius.row,
    paddingHorizontal: space.s,
    paddingVertical: 4,
    marginBottom: space.xs,
  },
  thumbTime: {...type.captionStrong, ...numeric, color: colors.text},
  thumbTitle: {...type.caption, color: colors.textSecondary},
  captions: {position: 'absolute', alignItems: 'center'},
  captionText: {
    ...type.headline,
    fontWeight: '400',
    color: colors.text,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: space.s,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  banner: {
    position: 'absolute',
    left: space.safeX,
    bottom: space.safeY + CONTROLS_H,
    minWidth: 240,
    maxWidth: 420,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.banner,
    borderRadius: radius.banner,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
  },
  bannerDot: {marginRight: space.s},
  bannerText: {flexShrink: 1},
  bannerTeaser: {...type.headline, color: colors.text},
  bannerHint: {...type.caption, color: colors.textSecondary, marginTop: 2},
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progress: {width: 180},
  errorCard: {
    width: 440,
    padding: space.l,
    backgroundColor: colors.panel,
    borderRadius: radius.banner,
  },
  errorTitle: {...type.headline, color: colors.text},
  errorText: {...type.body, color: colors.textSecondary, marginTop: space.xs},
  errorCode: {...type.caption, color: colors.textTertiary, marginTop: 4},
  errorActions: {flexDirection: 'row', marginTop: space.l},
  button: {marginRight: space.s},
  buttonInner: {height: 40, paddingHorizontal: space.m, justifyContent: 'center'},
  buttonText: {...type.bodyStrong, color: colors.text},
  buttonTextFocused: {color: colors.onFocus},
});
