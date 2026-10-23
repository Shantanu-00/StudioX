import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import Animated, {
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
import {colors, motion, numeric, radius, space, type} from '../theme';
import {VerdictWord} from '../widgets/parts';
import {focusSoon, useFocusOnMount} from './focus';
import {GrowthSim} from './GrowthSim';
import {
  firstFocus,
  isLocked,
  layoutMap,
  neighbourMap,
  stepOrder,
  TOGGLE_ID,
} from './layout';
import {MapCanvas} from './MapCanvas';
import {
  CATEGORY_WORD,
  nodeMeta,
  nodeQuestions,
  nodeShareCard,
  nodeSources,
  valueText,
} from './mapData';
import {NightSim} from './NightSim';
import {NodeSheet, SHEET_W} from './NodeSheet';
import {useMapAsk, useMapShare} from './useMapActions';

// Where the Player puts the paused video while the Map is open: a small
// frame in the top-left corner, so the episode is still there, nothing is
// drawn over it, and the decoder keeps its paused picture.
export const FRAME = {x: space.safeX, y: space.safeY, w: 128, h: 72} as const;
const TOGGLE_W = 152;
const BOX_TOP = FRAME.y + FRAME.h + space.l; // 123
const FOOTER = space.safeY + 18 + space.m; // hint line and its margin

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
  // The Map claims BACK: sim → answer → sheet → step mode → leave.
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

  const box = useMemo(
    () => ({
      x: space.safeX,
      y: BOX_TOP,
      w: W - 2 * space.safeX,
      h: H - BOX_TOP - FOOTER,
    }),
    [W, H],
  );
  const layout = useMemo(() => layoutMap(explore, box), [explore, box]);
  const toggleRect = useMemo(
    () => ({x: W - space.safeX - TOGGLE_W, y: space.safeY, w: TOGGLE_W, h: 40}),
    [W],
  );
  const neighbours = useMemo(
    () => neighbourMap(layout, toggleRect),
    [layout, toggleRect],
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
  const lastFocus = useRef<string | null>(null);
  const [mountFocus, setMountFocus] = useState<string | null>(() =>
    firstFocus(layout, explore, playhead),
  );

  const {answer, ask, close: closeAnswer} = useMapAsk(sessionId, mediaId, playhead);
  const share = useMapShare(link, mediaId, playhead ?? 0, confirm);

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
  }, [layout, mode, sheetOpen, simId]);

  // Pull focus into the map when it opens (off the Player's trapped seek bar).
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
    const at = order.findIndex((n) => n.id === lastFocus.current);
    setStep(at >= 0 ? at : 0);
    setMode('step');
    console.warn('[map] step through');
  }, [order]);
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

  useEffect(() => {
    registerBack(() => {
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
      } else {
        onClose();
      }
      return true;
    });
    return () => registerBack(null);
  }, [
    registerBack,
    simId,
    closeSim,
    answer,
    sheet,
    closeAnswer,
    closeSheet,
    mode,
    leaveStep,
    onClose,
  ]);

  useTVEventHandler((evt) => {
    if (evt.eventKeyAction === 1 || simId || sheet || mode !== 'step') {
      return;
    }
    if (evt.eventType === 'left') {
      setStep((s) => Math.max(0, s - 1));
    } else if (evt.eventType === 'right') {
      setStep((s) => Math.min(order.length - 1, s + 1));
    }
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
      />
    ) : (
      <GrowthSim
        title={sim.title}
        params={sim.params}
        source={sourceTitle}
        hasVideo={hasVideo}
        onDone={closeSim}
      />
    );
  }

  const category = CATEGORY_WORD[explore.category];
  const headerLeft = frame ? FRAME.x + FRAME.w + space.m : space.safeX;
  const context = hasVideo
    ? `${category} · ${sourceTitle}, paused at ${formatTime(playhead)}`
    : `${category} · ${sourceTitle}`;

  return (
    <View style={styles.root} testID="map-screen">
      <View style={[styles.header, {left: headerLeft, right: space.safeX + TOGGLE_W + space.m}]}>
        <Text style={styles.context} numberOfLines={1}>
          {context}
        </Text>
        <Text style={styles.title} numberOfLines={1} testID="map-title">
          {explore.title}
        </Text>
        {explore.summary ? (
          <Text style={styles.summary} numberOfLines={1}>
            {explore.summary}
          </Text>
        ) : null}
      </View>

      <StepToggle
        rect={toggleRect}
        stepping={mode === 'step'}
        focusable={!sheet}
        register={register}
        down={resolve(
          mode === 'step' ? 'step-more' : neighbours[TOGGLE_ID]?.down,
        )}
        onPress={mode === 'step' ? leaveStep : enterStep}
      />

      {mode === 'map' ? (
        <MapCanvas
          explore={explore}
          layout={layout}
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
        />
      ) : (
        <StepView
          node={order[step]}
          index={step}
          count={order.length}
          explore={explore}
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
        <Text style={styles.footerText} numberOfLines={1}>
          {hasVideo ? 'Back to the episode' : 'Back to Home'}
        </Text>
      </View>
      <Text
        style={[styles.footerRight, {top: H - space.safeY - 18}]}
        numberOfLines={1}>
        {mode === 'step' ? '◀ ▶ Previous and next' : 'Select a piece to open it'}
      </Text>

      {sheet && sheetNode ? (
        <>
          <View style={[styles.dim, {right: SHEET_W}]} pointerEvents="none" />
          <NodeSheet
            key={sheetNode.id}
            node={sheetNode}
            locked={isLocked(sheetNode, playhead)}
            sim={sheetSim}
            hasVideo={hasVideo && !!onPlayMoment}
            questions={nodeQuestions(sheetNode, answers, playhead)}
            canAskLive={live}
            paired={share.paired}
            sendStatus={share.statusOf(`node-${sheetNode.id}`)}
            answer={answer && answer.nodeId === sheetNode.id ? answer : null}
            focusAction={sheet.focusAction}
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

const StepToggle = ({
  rect,
  stepping,
  focusable,
  register,
  down,
  onPress,
}: {
  rect: {x: number; y: number; w: number; h: number};
  stepping: boolean;
  focusable: boolean;
  register: (id: string, v: View | null) => void;
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
        up: self.current ?? undefined,
        left: self.current ?? undefined,
        right: self.current ?? undefined,
        down: down ?? self.current ?? undefined,
      }}
      style={[styles.toggle, {left: rect.x, top: rect.y, width: rect.w}]}
      contentStyle={styles.toggleInner}
      onPress={onPress}>
      {(focused) => (
        <Text
          style={[styles.toggleText, focused && styles.onFocus]}
          numberOfLines={1}>
          {stepping ? 'Show the map' : 'Step through'}
        </Text>
      )}
    </FocusFrame>
  );
};

// One piece at a time, large: LEFT/RIGHT move through the pieces in order,
// SELECT opens it, BACK returns to the whole map.
const StepView = ({
  node,
  index,
  count,
  explore,
  playhead,
  box,
  focusable,
  register,
  resolve,
  onOpen,
}: {
  node: ExploreNode | undefined;
  index: number;
  count: number;
  explore: Explore;
  playhead: number | null;
  box: {x: number; y: number; w: number; h: number};
  focusable: boolean;
  register: (id: string, v: View | null) => void;
  resolve: (id: string | undefined) => View | undefined;
  onOpen: () => void;
}) => {
  const opacity = useSharedValue(1);
  const dx = useSharedValue(0);
  const prev = useRef(index);
  useEffect(() => {
    const dir = index >= prev.current ? 1 : -1;
    prev.current = index;
    opacity.value = 0;
    dx.value = 16 * dir;
    const cfg = {duration: motion.fadeMs, easing: Easing.out(Easing.cubic)};
    opacity.value = withTiming(1, cfg);
    dx.value = withTiming(0, cfg);
  }, [index, opacity, dx]);
  const enter = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{translateX: Math.round(dx.value)}],
  }));
  const moreRef = useFocusOnMount<View>(focusable);
  if (!node) {
    return null;
  }
  const locked = isLocked(node, playhead);
  const group = explore.groups.find((g) => g.id === node.group);
  const cardW = Math.min(640, box.w);
  const left = Math.round(box.x + (box.w - cardW) / 2);
  const value =
    explore.layout === 'compare' && node.value ? valueText(node.value) : null;
  const self = resolve('step-more');
  return (
    <>
      <Animated.View
        style={[styles.stepCard, {left, top: box.y, width: cardW}, enter]}
        testID="map-step-card"
        accessibilityLiveRegion="polite">
        {locked ? (
          <>
            <View style={styles.stepMetaRow}>
              <Icon name="lock" size={16} color={colors.textSecondary} />
              <Text style={[styles.stepMeta, styles.stepMetaLock]} numberOfLines={1}>
                Later in the episode
              </Text>
            </View>
            <Text style={styles.stepTitle} numberOfLines={2}>
              Keep watching
            </Text>
            <Text style={styles.stepBody} numberOfLines={2}>
              This piece unlocks when the episode gets there.
            </Text>
          </>
        ) : (
          <>
            <View style={styles.stepMetaRow}>
              <Text style={styles.stepMeta} numberOfLines={1}>
                {[group?.title, nodeMeta(node, playhead !== null)]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {node.verdict ? (
                <>
                  <Text style={styles.stepMeta}>{'  ·  '}</Text>
                  <VerdictWord verdict={node.verdict} />
                </>
              ) : null}
            </View>
            {value ? (
              <Text style={styles.stepTitle} numberOfLines={1}>
                {value}
              </Text>
            ) : null}
            <Text style={styles.stepTitle} numberOfLines={2}>
              {node.label}
            </Text>
            {node.detail ? (
              <Text style={styles.stepBody} numberOfLines={4}>
                {node.detail}
              </Text>
            ) : null}
          </>
        )}
      </Animated.View>
      <View style={[styles.progress, {left, width: cardW, top: box.y + 252}]}>
        <Text style={styles.progressText} testID="map-step-progress">
          {`${index + 1} of ${count}`}
        </Text>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {width: `${Math.round(((index + 1) / count) * 100)}%`},
            ]}
          />
        </View>
        <FocusFrame
          ref={(v) => {
            (moreRef as React.MutableRefObject<View | null>).current = v;
            register('step-more', v);
          }}
          testID="map-step-more"
          accessibilityLabel={
            locked ? 'Locked piece' : `More on this: ${node.label}`
          }
          variant="button"
          focusable={focusable}
          hasTVPreferredFocus={focusable}
          nextFocus={{
            up: resolve(TOGGLE_ID) ?? self,
            down: self,
            left: self,
            right: self,
          }}
          style={styles.more}
          contentStyle={styles.moreInner}
          onPress={onOpen}>
          {(focused) => (
            <Text style={[styles.moreText, focused && styles.onFocus]} numberOfLines={1}>
              More on this
            </Text>
          )}
        </FocusFrame>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  root: {...StyleSheet.absoluteFillObject},
  header: {position: 'absolute', top: space.safeY},
  context: {...type.caption, ...numeric, color: colors.textSecondary},
  title: {...type.title, color: colors.text},
  summary: {...type.body, color: colors.textSecondary},
  toggle: {position: 'absolute'},
  toggleInner: {height: 40, paddingHorizontal: space.m, justifyContent: 'center'},
  toggleText: {...type.bodyStrong, color: colors.text, textAlign: 'center'},
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
  stepCard: {
    position: 'absolute',
    height: 232,
    padding: space.l,
    borderRadius: radius.banner,
    backgroundColor: colors.card,
  },
  stepMetaRow: {flexDirection: 'row', alignItems: 'center'},
  stepMeta: {...type.caption, ...numeric, color: colors.textSecondary, flexShrink: 1},
  stepMetaLock: {marginLeft: space.xs},
  stepTitle: {...type.title, color: colors.text, marginTop: space.xs},
  stepBody: {...type.body, color: colors.text, marginTop: space.s},
  progress: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressText: {...type.caption, ...numeric, color: colors.textSecondary, width: 64},
  progressTrack: {
    flex: 1,
    height: 2,
    backgroundColor: colors.track,
    borderRadius: 1,
    marginRight: space.m,
  },
  progressFill: {height: 2, backgroundColor: colors.text, borderRadius: 1},
  more: {},
  moreInner: {height: 40, paddingHorizontal: space.m, justifyContent: 'center'},
  moreText: {...type.bodyStrong, color: colors.text},
});
