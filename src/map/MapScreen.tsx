import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {
  useKeplerAppStateManager,
  useTVEventHandler,
} from '@amazon-devices/react-native-kepler';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from '@amazon-devices/react-native-reanimated';
import {formatTime} from '../analysis/composer';
import {Answer, Explore, ExploreNode, Widget} from '../analysis/schema';
import {FocusFrame} from '../components/FocusFrame';
import {Icon} from '../components/Icon';
import {Confirm} from '../hooks/useSystemToast';
import {APP_MODE} from '../config';
import {Link} from '../services/api';
import {colors, motion, numeric, space, type} from '../theme';
import {focusSoon} from './focus';
import {GrowthSim} from './GrowthSim';
import {
  firstFocus,
  isLocked,
  layoutMap,
  neighbourMap,
  PLAY_ID,
  stepOrder,
  storyOrder,
  storyPath,
  TOGGLE_ID,
} from './layout';
import {MapCanvas} from './MapCanvas';
import {
  CATEGORY_WORD,
  nodeQuestions,
  nodeShareCard,
  nodeSources,
} from './mapData';
import {NightSim} from './NightSim';
import {NodeSheet, SHEET_W} from './NodeSheet';
import {Backdrop} from './scene/Backdrop';
import {fitCaption, fitHeader, SizeName} from './scene/measure';
import {StepCard} from './scene/StepCard';
import {StoryStatus, useStory} from './scene/story';
import {MapTheme, themeFor} from './themes';
import {useMapAsk, useMapShare} from './useMapActions';

// Where the Player puts the paused video while the Map is open: a small
// frame in the top-left corner, so the episode is still there, nothing is
// drawn over it (the scene leaves a hole), and the decoder keeps its paused
// picture.
export const FRAME = {x: space.safeX, y: space.safeY, w: 128, h: 72} as const;
const BTN_W = 152;
const BTN_H = 40;
const BOX_TOP = FRAME.y + FRAME.h + space.l; // 123
const FOOTER = space.safeY + 18 + space.m; // hint line and its margin
const HEADER_H = BOX_TOP - space.safeY - space.xs; // 88: room for the header

export interface MapScreenProps {
  explore: Explore;
  answers: Answer[];
  widgets: Widget[];
  mediaId: string;
  // The episode it belongs to, or the cameo's label.
  sourceTitle: string;
  // Seconds into the episode; null for a map with no video (a cameo).
  playhead: number | null;
  // Leave the top-left corner to the paused video frame.
  frame: boolean;
  sessionId: string | null;
  link: Link | null;
  confirm: Confirm | null;
  // Seek to a moment and go back to the episode, playing.
  onPlayMoment?: (t: number) => void;
  // Back to the episode, playing from where it paused.
  onKeepWatching?: () => void;
  onClose: () => void;
  // The Map claims BACK: sim → answer → sheet → step mode → story → leave.
  registerBack: (handler: (() => boolean) | null) => void;
}

interface SheetState {
  nodeId: string;
  focusAction: string | null;
}

export const MapScreen = ({
  explore,
  answers,
  widgets,
  mediaId,
  sourceTitle,
  playhead,
  frame,
  sessionId,
  link,
  confirm,
  onPlayMoment,
  onKeepWatching,
  onClose,
  registerBack,
}: MapScreenProps) => {
  const win = useWindowDimensions();
  const W = Math.round(win.width);
  const H = Math.round(win.height);
  const hasVideo = playhead !== null;
  const theme = useMemo(() => themeFor(explore.category), [explore.category]);
  const hole = useMemo(() => (frame ? {...FRAME} : null), [frame]);

  const box = useMemo(
    () => ({
      x: space.safeX,
      y: BOX_TOP,
      w: W - 2 * space.safeX,
      h: H - BOX_TOP - FOOTER,
    }),
    [W, H],
  );
  const layout = useMemo(
    () => layoutMap(explore, box, theme.motif),
    [explore, box, theme.motif],
  );
  const storyIds = useMemo(
    () => storyOrder(layout, explore, playhead),
    [layout, explore, playhead],
  );
  const hasPlay = storyIds.length >= 2;
  const playRect = useMemo(
    () => ({x: W - space.safeX - BTN_W, y: space.safeY, w: BTN_W, h: BTN_H}),
    [W],
  );
  const toggleRect = useMemo(
    () => ({
      x: W - space.safeX - BTN_W,
      y: hasPlay ? space.safeY + BTN_H + space.xs : space.safeY,
      w: BTN_W,
      h: BTN_H,
    }),
    [W, hasPlay],
  );
  const neighbours = useMemo(
    () => neighbourMap(layout, toggleRect, hasPlay ? playRect : null),
    [layout, toggleRect, hasPlay, playRect],
  );
  const byId = useMemo(
    () => new Map(explore.nodes.map((n) => [n.id, n])),
    [explore],
  );
  const order = useMemo(() => stepOrder(explore), [explore]);

  const [mode, setMode] = useState<'map' | 'step'>('map');
  const [step, setStep] = useState(0);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [simId, setSimId] = useState<string | null>(null);
  // The piece focused last, and the one to focus when the map mounts again.
  // A fresh map starts on Play (or the first piece when there is no story).
  const lastFocus = useRef<string | null>(null);
  const [mountFocus, setMountFocus] = useState<string | null>(() =>
    hasPlay ? PLAY_ID : firstFocus(layout, explore, playhead),
  );

  const {answer, ask, close: closeAnswer} = useMapAsk(sessionId, mediaId, playhead);
  const share = useMapShare(link, mediaId, playhead ?? 0, confirm);

  // The story pauses whenever the map is not what the viewer is looking at.
  const appState = useKeplerAppStateManager();
  const [appActive, setAppActive] = useState(true);
  useEffect(() => {
    const sub = appState.addAppStateListener('change', (next) =>
      setAppActive(next === 'active'),
    );
    return () => sub.remove();
  }, [appState]);
  const storyActive = !sheet && !simId && mode === 'map' && appActive;
  const {state: st, play, pause, stop, onKey} = useStory(storyIds.length, storyActive);
  const litId = st.index >= 0 ? storyIds[st.index] ?? null : null;
  const pulsePath = useMemo(
    () =>
      st.index > 0 && storyIds[st.index - 1] && storyIds[st.index]
        ? storyPath(layout, storyIds[st.index - 1], storyIds[st.index], theme.motif)
        : [],
    [st.index, storyIds, layout, theme.motif],
  );

  // Mounted host instances, for the explicit D-pad neighbours. One render
  // after each mount passes them to the nodes.
  const refs = useRef(new Map<string, View>());
  const register = useCallback((id: string, v: View | null) => {
    if (v) {
      refs.current.set(id, v);
    } else if (refs.current.get(id)) {
      refs.current.delete(id);
    }
  }, []);
  const resolve = useCallback(
    (id: string | undefined) => (id ? refs.current.get(id) : undefined),
    [],
  );
  const [, setTick] = useState(0);
  const sheetOpen = !!sheet;
  useEffect(() => {
    const t = setTimeout(() => setTick((x) => x + 1), 0);
    return () => clearTimeout(t);
  }, [layout, mode, sheetOpen, simId, hasPlay]);

  // Pull focus into the map when it opens (off the Player's trapped seek
  // bar), and back onto the piece that opened a sheet when it closes.
  useEffect(() => {
    if (sheetOpen || mode !== 'map') {
      return; // the sheet and the step card focus their own first action
    }
    const id = mountFocus;
    const t = setTimeout(() => {
      console.warn(`[map] restore ${id} ${id && refs.current.get(id) ? 'ok' : 'missing'}`);
      focusSoon(id ? refs.current.get(id) : undefined);
    }, 0);
    return () => clearTimeout(t);
  }, [mountFocus, mode, simId, sheetOpen]);

  const openNode = useCallback((id: string) => {
    lastFocus.current = id;
    console.warn(`[map] open ${id}`);
    setSheet({nodeId: id, focusAction: null});
  }, []);
  const closeSheet = useCallback(() => {
    closeAnswer();
    setSheet(null);
    setMountFocus(lastFocus.current);
  }, [closeAnswer]);
  const enterStep = useCallback(() => {
    stop();
    const at = order.findIndex((n) => n.id === lastFocus.current);
    setStep(at >= 0 ? at : 0);
    setMode('step');
    console.warn('[map] step through');
  }, [order, stop]);
  const leaveStep = useCallback(() => {
    const n = order[step];
    if (n) {
      lastFocus.current = n.id;
    }
    setMountFocus(n?.id ?? lastFocus.current);
    setMode('map');
  }, [order, step]);
  const openSim = useCallback((id: string) => {
    console.warn(`[map] sim ${id}`);
    setSimId(id);
  }, []);
  const closeSim = useCallback(() => {
    setSimId(null);
    setSheet((s) => (s ? {...s, focusAction: 'try'} : s));
    setMountFocus(lastFocus.current);
  }, []);

  // BACK, and LEFT on the sheet: sim → answer → sheet → step mode → a
  // playing story → leave the map.
  const back = useCallback(() => {
    if (simId) {
      closeSim();
    } else if (answer && sheet) {
      const key = sheet.focusAction;
      closeAnswer();
      setSheet({...sheet, focusAction: key});
    } else if (sheet) {
      closeSheet();
    } else if (mode === 'step') {
      leaveStep();
    } else if (st.status === 'playing') {
      pause();
    } else {
      onClose();
    }
    return true;
  }, [simId, closeSim, answer, sheet, closeAnswer, closeSheet, mode, leaveStep, st.status, pause, onClose]);
  useEffect(() => {
    registerBack(back);
    return () => registerBack(null);
  }, [registerBack, back]);

  useTVEventHandler((evt) => {
    if (evt.eventKeyAction === 1 || simId || evt.eventType === 'back') {
      return; // key-up, a sim's own keys, or BACK (the back chain has it)
    }
    if (sheet) {
      // Every sheet control is in one column, so LEFT is always on its
      // leftmost control: it closes the sheet like BACK.
      if (evt.eventType === 'left') {
        back();
      }
      return;
    }
    if (mode === 'step') {
      if (evt.eventType === 'left') {
        setStep((s) => Math.max(0, s - 1));
      } else if (evt.eventType === 'right') {
        setStep((s) => Math.min(order.length - 1, s + 1));
      }
      return;
    }
    onKey(); // any key pauses the story
  });

  const sim = simId ? explore.sims.find((s) => s.id === simId) : undefined;
  const sheetNode = sheet ? byId.get(sheet.nodeId) : undefined;
  const sheetSim =
    sheetNode?.sim ? explore.sims.find((s) => s.id === sheetNode.sim) ?? null : null;
  const live = APP_MODE === 'live' && !!sessionId && hasVideo;

  if (sim) {
    return sim.engine === 'night' ? (
      <NightSim
        title={sim.title}
        params={sim.params}
        source={sourceTitle}
        hasVideo={hasVideo}
        paired={share.paired}
        sendStatus={share.statusOf(`night-${sim.id}`)}
        onSend={(card) => share.send(`night-${sim.id}`, card)}
        onDone={closeSim}
        theme={theme}
      />
    ) : (
      <GrowthSim
        title={sim.title}
        params={sim.params}
        source={sourceTitle}
        hasVideo={hasVideo}
        onDone={closeSim}
        theme={theme}
      />
    );
  }

  const category = CATEGORY_WORD[explore.category];
  const headerLeft = frame ? FRAME.x + FRAME.w + space.m : space.safeX;
  const headerW = W - space.safeX - BTN_W - space.m - headerLeft;
  const context = hasVideo
    ? `${category} · ${sourceTitle}, paused at ${formatTime(playhead)}`
    : `${category} · ${sourceTitle}`;
  const litNode = litId ? byId.get(litId) : undefined;
  const prevId = st.index > 0 ? storyIds[st.index - 1] : null;
  const via = prevId
    ? explore.edges.find(
        (e) =>
          !!e.label &&
          ((e.from === prevId && e.to === litId) || (e.from === litId && e.to === prevId)),
      )?.label ?? null
    : null;

  return (
    <View style={styles.root} testID="map-screen">
      <Backdrop theme={theme} width={W} height={H} hole={hole} />

      {litNode && st.status !== 'idle' ? (
        <StoryCaption
          node={litNode}
          index={st.index}
          count={storyIds.length}
          via={via}
          status={st.status}
          theme={theme}
          left={headerLeft}
          width={headerW}
        />
      ) : (
        <Header
          context={context}
          title={explore.title}
          summary={explore.summary}
          left={headerLeft}
          width={headerW}
        />
      )}

      {hasPlay && mode === 'map' ? (
        <PlayControl
          rect={playRect}
          status={st.status}
          focusable={!sheet}
          preferred={!sheet && mountFocus === PLAY_ID}
          register={register}
          down={resolve(TOGGLE_ID)}
          onPress={play}
        />
      ) : null}

      <StepToggle
        rect={toggleRect}
        stepping={mode === 'step'}
        focusable={!sheet}
        register={register}
        up={mode === 'map' && hasPlay ? resolve(PLAY_ID) : undefined}
        down={resolve(
          mode === 'step' ? 'step-more' : neighbours[TOGGLE_ID]?.down,
        )}
        onPress={mode === 'step' ? leaveStep : enterStep}
      />

      {mode === 'map' ? (
        <MapCanvas
          explore={explore}
          layout={layout}
          theme={theme}
          width={W}
          height={H}
          playhead={playhead}
          focusable={!sheet}
          preferredId={mountFocus}
          neighbours={neighbours}
          resolve={resolve}
          register={register}
          onSelect={openNode}
          onFocusNode={(id) => {
            lastFocus.current = id;
            console.warn(`[map] focus ${id}`);
          }}
          onSim={openSim}
          story={{
            lit: litId,
            step: st.index,
            path: pulsePath,
            running: st.status === 'playing',
          }}
        />
      ) : (
        <StepCard
          node={order[step]}
          index={step}
          count={order.length}
          explore={explore}
          theme={theme}
          playhead={playhead}
          box={box}
          focusable={!sheet}
          register={register}
          resolve={resolve}
          onOpen={() => order[step] && openNode(order[step].id)}
        />
      )}

      <View style={[styles.footer, {top: H - space.safeY - 18}]} pointerEvents="none">
        <Icon name="back" size={16} color={colors.textSecondary} />
        <Text style={styles.footerText}>
          {hasVideo ? 'Back to the episode' : 'Back to Home'}
        </Text>
      </View>
      <Text style={[styles.footerRight, {top: H - space.safeY - 18}]}>
        {mode === 'step'
          ? '◀ ▶ Previous and next'
          : st.status === 'playing'
          ? 'Any key pauses the story'
          : 'Select a piece to open it'}
      </Text>

      {sheet && sheetNode ? (
        <>
          <View style={[styles.dim, {right: SHEET_W}]} pointerEvents="none" />
          <NodeSheet
            key={sheetNode.id}
            node={sheetNode}
            locked={isLocked(sheetNode, playhead, explore.suspense)}
            sim={sheetSim}
            hasVideo={hasVideo && !!onPlayMoment}
            questions={nodeQuestions(sheetNode, answers, playhead)}
            canAskLive={live}
            paired={share.paired}
            sendStatus={share.statusOf(`node-${sheetNode.id}`)}
            answer={answer && answer.nodeId === sheetNode.id ? answer : null}
            focusAction={sheet.focusAction}
            onBack={back}
            onPlay={() => sheetNode.t !== null && onPlayMoment?.(sheetNode.t)}
            onTry={() => sheetSim && openSim(sheetSim.id)}
            onAsk={(q, prepared, key) => {
              setSheet({nodeId: sheetNode.id, focusAction: key});
              ask(sheetNode, q, prepared);
            }}
            onSend={() =>
              share.send(
                `node-${sheetNode.id}`,
                nodeShareCard(sheetNode, nodeSources(sheetNode, widgets)),
              )
            }
            onKeepWatching={() => onKeepWatching?.()}
            onCloseAnswer={() => {
              closeAnswer();
              setSheet({...sheet});
            }}
          />
        </>
      ) : null}
    </View>
  );
};

const TITLE_STYLE: Record<'title' | 'headline', object> = {
  title: type.title,
  headline: type.headline,
};
const TEXT_STYLE: Partial<Record<SizeName, object>> = {
  body: type.body,
  caption: type.caption,
};

// Context, title and summary, all wrapping: the sizes step down until they
// fit the room above the map.
const Header = ({
  context,
  title,
  summary,
  left,
  width,
}: {
  context: string;
  title: string;
  summary: string;
  left: number;
  width: number;
}) => {
  const fit = fitHeader(width, HEADER_H, context, title, summary);
  return (
    <View style={[styles.header, {left, width}]}>
      <Text style={styles.context}>{context}</Text>
      <Text style={[TITLE_STYLE[fit.title], styles.ink]} testID="map-title">
        {title}
      </Text>
      {summary ? (
        <Text style={[TEXT_STYLE[fit.summary], styles.soft]}>{summary}</Text>
      ) : null}
    </View>
  );
};

// While the story plays, the header becomes its caption band: the lit
// piece's label and short detail beside a bar in the scene's accent.
const StoryCaption = ({
  node,
  index,
  count,
  via,
  status,
  theme,
  left,
  width,
}: {
  node: ExploreNode;
  index: number;
  count: number;
  via: string | null;
  status: StoryStatus;
  theme: MapTheme;
  left: number;
  width: number;
}) => {
  const textW = width - BAR_W - space.s;
  const fit = fitCaption(textW, HEADER_H, node.label, node.detail);
  const fade = useSharedValue(0);
  useEffect(() => {
    fade.value = 0;
    fade.value = withTiming(1, {duration: motion.fadeMs, easing: Easing.out(Easing.cubic)});
    return () => cancelAnimation(fade);
  }, [index, fade]);
  const style = useAnimatedStyle(() => ({opacity: fade.value}));
  const meta = [
    `${index + 1} of ${count}`,
    node.when,
    via,
    status === 'paused' ? 'Paused' : status === 'done' ? 'The end' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Animated.View
      style={[styles.header, styles.caption, {left, width}, style]}
      testID="map-story-caption"
      accessibilityLiveRegion="polite">
      <View style={[styles.captionBar, {backgroundColor: theme.motif === 'plain' ? colors.text : theme.accent}]} />
      <View style={styles.captionText}>
        <Text style={styles.context} testID="map-story-meta">
          {meta}
        </Text>
        <Text
          style={[fit.label === 'headline' ? type.headline : type.bodyStrong, styles.ink]}
          testID="map-story-label">
          {node.label}
        </Text>
        {fit.text ? (
          <Text style={[TEXT_STYLE[fit.detail], styles.soft, styles.captionDetail]}>
            {fit.text}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
};
const BAR_W = 3;

const PLAY_LABEL: Record<StoryStatus, string> = {
  idle: 'Play story',
  playing: 'Pause',
  paused: 'Resume',
  done: 'Play again',
};

const PlayControl = ({
  rect,
  status,
  focusable,
  preferred,
  register,
  down,
  onPress,
}: {
  rect: {x: number; y: number; w: number; h: number};
  status: StoryStatus;
  focusable: boolean;
  preferred: boolean;
  register: (id: string, v: View | null) => void;
  down: View | undefined;
  onPress: () => void;
}) => {
  const self = useRef<View | null>(null);
  return (
    <FocusFrame
      ref={(v) => {
        self.current = v;
        register(PLAY_ID, v);
      }}
      testID="map-play"
      accessibilityLabel={
        status === 'playing'
          ? 'Pause the story'
          : status === 'paused'
          ? 'Resume the story'
          : 'Play the story: a pulse walks the map piece by piece'
      }
      variant="button"
      focusable={focusable}
      hasTVPreferredFocus={preferred}
      nextFocus={{
        up: self.current ?? undefined,
        left: self.current ?? undefined,
        right: self.current ?? undefined,
        down: down ?? self.current ?? undefined,
      }}
      style={[styles.toggle, {left: rect.x, top: rect.y, width: rect.w}]}
      contentStyle={styles.playInner}
      onPress={onPress}>
      {(focused) => (
        <>
          <Icon
            name={status === 'playing' ? 'pause' : 'play'}
            size={16}
            color={focused ? colors.onFocus : colors.text}
          />
          <Text style={[styles.toggleText, styles.playText, focused && styles.onFocus]}>
            {PLAY_LABEL[status]}
          </Text>
        </>
      )}
    </FocusFrame>
  );
};

const StepToggle = ({
  rect,
  stepping,
  focusable,
  register,
  up,
  down,
  onPress,
}: {
  rect: {x: number; y: number; w: number; h: number};
  stepping: boolean;
  focusable: boolean;
  register: (id: string, v: View | null) => void;
  up: View | undefined;
  down: View | undefined;
  onPress: () => void;
}) => {
  const self = useRef<View | null>(null);
  return (
    <FocusFrame
      ref={(v) => {
        self.current = v;
        register(TOGGLE_ID, v);
      }}
      testID="map-step-toggle"
      accessibilityLabel={
        stepping ? 'Show the whole map' : 'Step through the map one piece at a time'
      }
      variant="button"
      focusable={focusable}
      nextFocus={{
        up: up ?? self.current ?? undefined,
        left: self.current ?? undefined,
        right: self.current ?? undefined,
        down: down ?? self.current ?? undefined,
      }}
      style={[styles.toggle, {left: rect.x, top: rect.y, width: rect.w}]}
      contentStyle={styles.toggleInner}
      onPress={onPress}>
      {(focused) => (
        <Text style={[styles.toggleText, focused && styles.onFocus]}>
          {stepping ? 'Show the map' : 'Step through'}
        </Text>
      )}
    </FocusFrame>
  );
};

const styles = StyleSheet.create({
  root: {...StyleSheet.absoluteFillObject},
  header: {position: 'absolute', top: space.safeY},
  context: {...type.caption, ...numeric, color: colors.textSecondary},
  ink: {color: colors.text},
  soft: {color: colors.textSecondary},
  caption: {flexDirection: 'row'},
  captionBar: {width: BAR_W, borderRadius: 2, marginRight: space.s},
  captionText: {flex: 1},
  captionDetail: {marginTop: 4},
  toggle: {position: 'absolute'},
  toggleInner: {height: BTN_H, paddingHorizontal: space.m, justifyContent: 'center'},
  playInner: {
    height: BTN_H,
    paddingHorizontal: space.m,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleText: {...type.bodyStrong, color: colors.text, textAlign: 'center'},
  playText: {marginLeft: space.xs},
  onFocus: {color: colors.onFocus},
  footer: {
    position: 'absolute',
    left: space.safeX,
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerText: {...type.caption, color: colors.textSecondary, marginLeft: space.xs},
  footerRight: {
    ...type.caption,
    position: 'absolute',
    right: space.safeX,
    color: colors.textTertiary,
  },
  dim: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.scrim,
  },
});
