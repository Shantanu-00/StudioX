import React, {useCallback, useEffect, useMemo, useReducer, useRef, useState} from 'react';
import {StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from '@amazon-devices/react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from '@amazon-devices/react-native-svg';
import {formatTime} from '../analysis/composer';
import {NightParams} from '../analysis/schema';
import {numeric, radius, space, type} from '../theme';
import {
  arcPoint,
  clock,
  crescentPath,
  CYCLE_LEN_MAX,
  CYCLE_LEN_MIN,
  CYCLES_MAX,
  NightField,
  nightInit,
  nightLayout,
  nightSentence,
  NightState,
  nightStep,
  offsetText,
  stepMarkers,
  waveDepth,
} from './sims';
import {SendStatus, sendLabel} from './useMapActions';
import {nightReminderCard} from './mapData';
import {PhoneCard} from '../services/api';
import {MapTheme, themeFor} from './themes';
import {SimButton, useFocusRefs, useOnBackground, ValueControl} from './sim/controls';
import {StepGlyph} from './sim/glyphs';
import {withAlpha} from './sim/color';

interface Props {
  title: string;
  params: NightParams;
  source: string; // the episode or cameo it comes from
  hasVideo: boolean;
  paired: boolean;
  sendStatus: SendStatus;
  onSend: (card: PhoneCard) => void;
  onDone: () => void;
  theme?: MapTheme;
}

// Scene geometry on the 960 x 540 dp canvas.
const SKY_TOP = 88;
const HORIZON = 244;
const SKY_H = HORIZON - SKY_TOP;
const DEPTH = 40; // how far a cycle's wave dips below the horizon
const EVE_W = 232; // the evening, before lights out
const ARC_H = 96;
const MOON = 12;
const CONTROLS_TOP = 326;
const ROW_STEP = 40;
const CONTROLS_W = 352;

const SNAP_MS = 250; // a value change settles in this
const MS_PER_CYCLE = 1600; // Play: one cycle in 1.6 s
const HOLD_MS = 900; // dawn holds, then the scene settles
const SETTLE_MS = 400;
const TICK_MIN = 10; // the clock readout steps in 10-minute ticks

// The night sky through Play: dusk, deep night, first light, dawn.
const DUSK = '#2A0E16';
const PREDAWN = '#231B2B';
const DAWN = '#4A3328';

// [x fraction, y, size] inside the sky.
const STARS: Array<[number, number, number]> = [
  [0.04, 22, 2], [0.11, 64, 1.5], [0.19, 30, 2], [0.27, 84, 1.5], [0.34, 16, 2],
  [0.42, 52, 1.5], [0.5, 26, 2], [0.57, 70, 1.5], [0.64, 14, 2], [0.71, 46, 1.5],
  [0.78, 24, 2], [0.85, 62, 1.5], [0.91, 18, 2], [0.97, 44, 1.5],
];

type Key = NightField | 'play' | 'action';

const reducer = (s: NightState, a: {field: NightField; dir: 1 | -1}) =>
  nightStep(s, a.field, a.dir);

// "Plan your night": the guest's rule as a scene the viewer drives. A sky
// with an arc from lights out to waking, the night's cycles as rolling waves
// under the horizon, and the controls below. At rest nothing moves: a change
// settles in 250 ms (the waves re-lay, the moon slides to the new wake), and
// Play runs the night once, moon across the sky and a crimson pulse through
// each cycle, then settles. Every moving part runs on the UI thread from
// shared values; the clock readout updates only on 10-minute ticks.
export const NightSim = ({
  title,
  params,
  source,
  hasVideo,
  paired,
  sendStatus,
  onSend,
  onDone,
  theme = themeFor('health'),
}: Props) => {
  const win = useWindowDimensions();
  const W = Math.round(win.width);
  const left = space.safeX;
  const width = W - 2 * space.safeX;
  const sleepW = width - EVE_W;
  const [state, dispatch] = useReducer(reducer, params, nightInit);
  const plan = state.plan;
  const headroom =
    CYCLES_MAX * Math.min(CYCLE_LEN_MAX, Math.max(CYCLE_LEN_MIN, params.cycleMinutes));
  const L = useMemo(
    () =>
      nightLayout(plan, {
        left,
        width,
        eveW: EVE_W,
        depth: DEPTH,
        skyH: SKY_H,
        arcH: ARC_H,
        headroom,
      }),
    [plan, left, width, headroom],
  );
  const markers = useMemo(
    () => stepMarkers(params.steps ?? [], L.bedX, EVE_W, 24),
    [params.steps, L.bedX],
  );

  // ---- motion (UI thread) ---------------------------------------------------
  const p = useSharedValue(1); // through the night: 0 lights out, 1 waking (rest)
  const live = useSharedValue(0); // 1 while Play runs
  const breath = useSharedValue(0);
  const wakeX = useSharedValue(L.wakeX);
  const relabel = useSharedValue(1);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const [tick, setTick] = useState(-1);

  useEffect(() => {
    wakeX.value = withTiming(L.wakeX, {duration: SNAP_MS, easing: Easing.out(Easing.cubic)});
  }, [L.wakeX, wakeX]);
  const seq = state.last?.seq ?? 0;
  useEffect(() => {
    if (seq > 0) {
      relabel.value = 0.2;
      relabel.value = withTiming(1, {duration: SNAP_MS});
    }
  }, [seq, relabel]);

  const finish = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    setTick(-1);
    cancelAnimation(breath);
    breath.value = withTiming(0, {duration: SNAP_MS});
  }, [breath]);

  const stop = useCallback(() => {
    if (!playingRef.current) {
      return;
    }
    cancelAnimation(p);
    cancelAnimation(live);
    p.value = withTiming(1, {duration: SNAP_MS, easing: Easing.out(Easing.cubic)});
    live.value = withTiming(0, {duration: SNAP_MS});
    finish();
  }, [p, live, finish]);

  const cycles = plan.cycles;
  const start = useCallback(() => {
    playingRef.current = true;
    setPlaying(true);
    setTick(0);
    cancelAnimation(p);
    cancelAnimation(live);
    p.value = 0;
    live.value = withTiming(1, {duration: 200});
    breath.value = withRepeat(
      withTiming(1, {duration: 2000, easing: Easing.inOut(Easing.sin)}),
      -1,
      true,
    );
    p.value = withTiming(
      1,
      {duration: cycles * MS_PER_CYCLE, easing: Easing.linear},
      (done) => {
        if (done) {
          live.value = withDelay(
            HOLD_MS,
            withTiming(0, {duration: SETTLE_MS}, (settled) => {
              if (settled) {
                runOnJS(finish)();
              }
            }),
          );
        }
      },
    );
  }, [cycles, p, live, breath, finish]);

  useEffect(
    () => () => {
      cancelAnimation(p);
      cancelAnimation(live);
      cancelAnimation(breath);
      cancelAnimation(wakeX);
      cancelAnimation(relabel);
    },
    [p, live, breath, wakeX, relabel],
  );
  useOnBackground(stop);

  const total = plan.sleepMinutes;
  useAnimatedReaction(
    () => (live.value > 0.01 ? Math.floor((p.value * total) / TICK_MIN) : -1),
    (cur, prev) => {
      if (cur !== prev && cur >= 0) {
        runOnJS(setTick)(cur);
      }
    },
    [total],
  );

  // ---- remote ---------------------------------------------------------------
  const focusKey = useRef<Key>('bedtime');
  useTVEventHandler((evt) => {
    if (evt.eventKeyAction === 1) {
      return;
    }
    const t = evt.eventType;
    if (playingRef.current) {
      // Any key stops the night; OK on Play is the button's own toggle.
      if (!(t === 'select' && focusKey.current === 'play')) {
        stop();
      }
      return;
    }
    const k = focusKey.current;
    if ((t === 'left' || t === 'right') && k !== 'play' && k !== 'action') {
      dispatch({field: k, dir: t === 'right' ? 1 : -1});
    }
  });
  const {register, next} = useFocusRefs<Key>('bedtime');
  const focusOn = (k: Key) => () => {
    focusKey.current = k;
  };

  // ---- animated styles -------------------------------------------------------
  const bedX = L.bedX;
  const span = L.wakeX - L.bedX;
  const arcStyle = useAnimatedStyle(() => {
    const s = span > 0 ? (wakeX.value - bedX) / span : 1;
    return {transform: [{translateX: (-(1 - s) * sleepW) / 2}, {scaleX: s}]};
  });
  const waveStyle = useAnimatedStyle(() => {
    const s = span > 0 ? (wakeX.value - bedX) / span : 1;
    return {transform: [{translateX: (-(1 - s) * sleepW) / 2}, {scaleX: s}]};
  });
  const rest = theme.bgDeep;
  const night = theme.bg;
  const skyStyle = useAnimatedStyle(() => {
    const during = interpolateColor(
      p.value,
      [0, 0.1, 0.78, 0.92, 1],
      [DUSK, night, night, PREDAWN, DAWN],
    );
    return {backgroundColor: interpolateColor(live.value, [0, 1], [rest, during])};
  });
  const starStyle = useAnimatedStyle(() => {
    const during = interpolate(p.value, [0, 0.12, 0.8, 0.95], [0.3, 0.9, 0.9, 0.05], Extrapolation.CLAMP);
    return {opacity: 0.7 + (during - 0.7) * live.value};
  });
  const setStyle = useAnimatedStyle(() => ({
    transform: [
      {translateY: live.value * interpolate(p.value, [0, 0.14], [0, 28], Extrapolation.CLAMP)},
    ],
  }));
  const riseStyle = useAnimatedStyle(() => ({
    opacity: live.value * interpolate(p.value, [0.84, 0.97], [0, 1], Extrapolation.CLAMP),
    transform: [{translateY: interpolate(p.value, [0.84, 1], [30, -6], Extrapolation.CLAMP)}],
  }));
  const moonStyle = useAnimatedStyle(() => {
    const pt = arcPoint(0.08 + 0.84 * p.value, bedX, wakeX.value, HORIZON, ARC_H);
    return {
      opacity: 1 - live.value * interpolate(p.value, [0.9, 1], [0, 0.85], Extrapolation.CLAMP),
      transform: [{translateX: pt.x - MOON - 2}, {translateY: pt.y - MOON - 2}],
    };
  });
  const headStyle = useAnimatedStyle(() => ({
    transform: [{translateX: bedX + p.value * (wakeX.value - bedX) - 1}],
  }));
  const dotStyle = useAnimatedStyle(() => ({
    transform: [
      {translateX: bedX + p.value * (wakeX.value - bedX) - 5},
      {translateY: HORIZON + waveDepth(p.value, cycles, DEPTH) - 5},
    ],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: live.value * (0.25 + 0.5 * breath.value),
    transform: [
      {translateX: bedX + p.value * (wakeX.value - bedX) - 11},
      {translateY: HORIZON + waveDepth(p.value, cycles, DEPTH) - 11},
    ],
  }));
  const blanketStyle = useAnimatedStyle(() => ({
    transform: [{translateY: -1.6 * breath.value}],
  }));
  const labelStyle = useAnimatedStyle(() => ({opacity: relabel.value}));

  // ---- words ------------------------------------------------------------------
  const readoutMinute = Math.min(total, tick * TICK_MIN);
  const readout =
    playing && tick >= 0
      ? `${clock(plan.bedtime + readoutMinute)} · cycle ${Math.min(
          cycles,
          Math.floor(readoutMinute / plan.cycleMinutes) + 1,
        )} of ${cycles}`
      : null;
  const changed = (f: NightField) => (state.last?.field === f ? state.last.seq : null);
  const actionLabel = paired ? sendLabel(sendStatus) : 'Done';
  const sunX = L.bedX - left;
  const moonlight = theme.support;

  return (
    <View style={[styles.root, {backgroundColor: theme.bg}]} testID="night-sim">
      <Text style={[styles.source, {color: theme.inkSoft}]} numberOfLines={1}>
        {`${title} · ${source}`}
      </Text>
      <Text
        style={[styles.headline, {color: theme.ink}]}
        accessibilityLiveRegion="polite"
        testID="night-headline">
        {nightSentence(plan)}
      </Text>

      {/* The sky: dusk at lights out, the arc of the night, dawn at waking. */}
      <View
        style={[styles.sky, {left, width, top: SKY_TOP, height: SKY_H}]}
        pointerEvents="none">
        <Animated.View style={[StyleSheet.absoluteFill, skyStyle]} />
        <Svg width={width} height={SKY_H} style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient
              id="dusk"
              cx={sunX}
              cy={SKY_H}
              rx={200}
              ry={120}
              fx={sunX}
              fy={SKY_H}
              gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={theme.accent} stopOpacity={0.32} />
              <Stop offset="1" stopColor={theme.accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={SKY_H} fill="url(#dusk)" />
        </Svg>
        <Animated.View style={[StyleSheet.absoluteFill, starStyle]}>
          {STARS.map(([fx, y, s], i) => (
            <View
              key={i}
              style={[
                styles.star,
                {left: Math.round(fx * width), top: y, width: s, height: s, backgroundColor: moonlight},
              ]}
            />
          ))}
        </Animated.View>
        <Animated.View
          style={[
            styles.disc,
            styles.sunset,
            {left: sunX - 16, top: SKY_H - 16, backgroundColor: theme.accent},
            setStyle,
          ]}
        />
        <Animated.View
          style={[
            styles.disc,
            styles.sunrise,
            {left: L.wakeX - left - 18, top: SKY_H - 18, backgroundColor: moonlight},
            riseStyle,
          ]}
        />
        <Animated.View
          style={[styles.arcLayer, {left: sunX, width: sleepW, height: SKY_H}, arcStyle]}>
          <Svg width={sleepW} height={SKY_H}>
            <Path
              d={L.arc}
              stroke={theme.line}
              strokeWidth={1.5}
              strokeDasharray="3 6"
              fill="none"
            />
          </Svg>
        </Animated.View>
        {markers.length ? (
          <View style={[styles.steps, {width: EVE_W - 16}]}>
            {markers.map((m, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.stepGlyph}>
                  <StepGlyph icon={m.icon} size={14} color={moonlight} />
                </View>
                <Text style={[styles.stepText, {color: theme.ink}]}>{m.label}</Text>
                <Text style={[styles.stepOffset, {color: theme.inkSoft}]}>
                  {offsetText(m.offsetMin)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {readout ? (
          <Text style={[styles.readout, {color: theme.ink}]}>{readout}</Text>
        ) : null}
      </View>

      {/* The horizon, and the night's cycles as waves beneath it. */}
      <View style={[styles.horizon, {left, width, top: HORIZON - 1, backgroundColor: theme.line}]} />
      <Animated.View
        pointerEvents="none"
        style={[styles.abs, {left: L.bedX, top: HORIZON, width: sleepW, height: DEPTH + 4}, waveStyle]}>
        <Svg width={sleepW} height={DEPTH + 4}>
          {L.ghosts ? (
            <Path d={L.ghosts} stroke={theme.line} strokeWidth={1.5} strokeDasharray="4 5" fill="none" />
          ) : null}
          <Path
            d={`${L.humps} Z`}
            fill={withAlpha(moonlight, 0.08)}
            stroke={moonlight}
            strokeWidth={2}
          />
        </Svg>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, labelStyle]}>
        {L.centers.map((c) => (
          <Text
            key={`c${c.n}`}
            style={[styles.cycleNo, {left: c.x - 12, top: HORIZON + 4, color: theme.ink}]}>
            {String(c.n)}
          </Text>
        ))}
        {L.junctions.map((j, i) => {
          const first = i === 0;
          const last = i === L.junctions.length - 1;
          // Near the right edge the wake label ends at the safe margin.
          const atEdge = j.x + 90 > left + width;
          const at = clock(plan.bedtime + j.minute);
          return (
            <Text
              key={`j${i}`}
              style={[
                styles.junction,
                first || (last && atEdge)
                  ? styles.junctionFirst
                  : last
                  ? styles.junctionLast
                  : styles.junctionMid,
                {
                  left: first
                    ? j.x + 22 - 132
                    : last
                    ? atEdge
                      ? left + width - 132
                      : j.x - 22
                    : j.x - 24,
                },
                {top: HORIZON + DEPTH + 8, color: first || last ? theme.ink : theme.inkSoft},
                (first || last) && styles.junctionStrong,
              ]}>
              {first ? `Lights out ${at}` : last ? `Wake ${at}` : at}
            </Text>
          );
        })}
      </Animated.View>

      {/* The sleeper, still at rest, breathing while the night plays. */}
      <View style={[styles.abs, {left: left + 8, top: HORIZON + 10}]} pointerEvents="none">
        <Svg width={150} height={36}>
          <Rect x={4} y={4} width={5} height={30} fill={theme.line} />
          <Path d="M4 30 H146" stroke={theme.line} strokeWidth={2} />
          <Rect x={14} y={16} width={44} height={11} rx={5} fill={theme.surface} stroke={theme.line} strokeWidth={1} />
          <Circle cx={42} cy={12} r={7} fill={theme.surface} stroke={moonlight} strokeWidth={1.5} />
        </Svg>
        <Animated.View style={[StyleSheet.absoluteFill, blanketStyle]}>
          <Svg width={150} height={36}>
            <Path
              d="M52 29 C 76 10, 104 10, 124 17 S 142 25, 146 29 Z"
              fill={theme.surface}
              stroke={moonlight}
              strokeWidth={1.5}
            />
          </Svg>
        </Animated.View>
      </View>

      {markers.map((m, i) => (
        <View
          key={`m${i}`}
          pointerEvents="none"
          style={[
            styles.marker,
            {left: m.x - 11, top: HORIZON - 11, backgroundColor: theme.surface, borderColor: moonlight},
          ]}>
          <StepGlyph icon={m.icon} size={12} color={moonlight} />
        </View>
      ))}

      {/* The crimson pulse: the wake point at rest, the playhead in Play. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.head, {top: HORIZON - 6, height: DEPTH + 12, backgroundColor: theme.accent}, headStyle]}
      />
      <Animated.View pointerEvents="none" style={[styles.halo, {borderColor: theme.accent}, haloStyle]} />
      <Animated.View pointerEvents="none" style={[styles.dot, {backgroundColor: theme.accent}, dotStyle]} />
      <Animated.View pointerEvents="none" style={[styles.moon, moonStyle]}>
        <Svg width={MOON * 2 + 4} height={MOON * 2 + 4}>
          <Path d={crescentPath(MOON + 2, MOON + 2, MOON)} fill={moonlight} />
        </Svg>
      </Animated.View>

      {/* The controls: UP/DOWN picks one, LEFT/RIGHT changes it. */}
      <ValueControl
        ref={register('bedtime')}
        testID="night-bedtime"
        label="Lights out"
        value={clock(plan.bedtime)}
        accessibilityLabel={`Lights out ${clock(plan.bedtime)}. Left or right moves it by 15 minutes.`}
        theme={theme}
        size="row"
        changedSeq={changed('bedtime')}
        hasTVPreferredFocus
        nextFocus={next('bedtime', {down: 'cycles'})}
        onFocus={focusOn('bedtime')}
        style={[styles.control, {left, top: CONTROLS_TOP}]}
      />
      <ValueControl
        ref={register('cycles')}
        testID="night-cycles"
        label="Cycles"
        value={String(plan.cycles)}
        accessibilityLabel={`${plan.cycles} cycles. Left or right adds or removes one.`}
        theme={theme}
        size="row"
        changedSeq={changed('cycles')}
        nextFocus={next('cycles', {up: 'bedtime', down: 'cycleMinutes'})}
        onFocus={focusOn('cycles')}
        style={[styles.control, {left, top: CONTROLS_TOP + ROW_STEP}]}
      />
      <ValueControl
        ref={register('cycleMinutes')}
        testID="night-length"
        label="Cycle length"
        value={`${plan.cycleMinutes} min`}
        accessibilityLabel={`Cycles of ${plan.cycleMinutes} minutes. Left or right changes it by 5 minutes.`}
        theme={theme}
        size="row"
        changedSeq={changed('cycleMinutes')}
        nextFocus={next('cycleMinutes', {up: 'cycles', down: 'play'})}
        onFocus={focusOn('cycleMinutes')}
        style={[styles.control, {left, top: CONTROLS_TOP + 2 * ROW_STEP}]}
      />
      <SimButton
        ref={register('play')}
        testID="night-play"
        label={playing ? 'Stop' : 'Play the night'}
        icon={playing ? 'pause' : 'play'}
        accessibilityLabel={playing ? 'Stop the night' : 'Play the night once'}
        nextFocus={next('play', {up: 'cycleMinutes', right: 'action'})}
        onFocus={focusOn('play')}
        onPress={() => (playingRef.current ? stop() : start())}
        style={[styles.abs, {left, top: CONTROLS_TOP + 3 * ROW_STEP + 8}]}
      />
      <SimButton
        ref={register('action')}
        testID="night-action"
        label={actionLabel}
        accessibilityLabel={
          paired
            ? `${actionLabel}: lights out ${clock(plan.bedtime)}, wake ${clock(plan.wake)}`
            : 'Done, back to the map'
        }
        nextFocus={next('action', {up: 'cycleMinutes', left: 'play'})}
        onFocus={focusOn('action')}
        onPress={() => {
          if (!paired) {
            onDone();
          } else if (sendStatus !== 'sending' && sendStatus !== 'sent') {
            onSend(nightReminderCard(plan, new Date()));
          }
        }}
        style={[styles.abs, {left: left + 184, top: CONTROLS_TOP + 3 * ROW_STEP + 8}]}
      />

      {/* What changed, and what the guest said. */}
      <View style={[styles.words, {left: left + CONTROLS_W + space.l, top: CONTROLS_TOP}]}>
        {state.last ? (
          <View
            style={[styles.chip, {backgroundColor: theme.accentSoft, borderColor: theme.accent}]}>
            <Text
              style={[styles.chipText, {color: theme.ink}]}
              accessibilityLiveRegion="polite"
              testID="night-delta">
              {state.last.text}
            </Text>
          </View>
        ) : (
          <Text style={[styles.hint, {color: theme.inkSoft}]}>
            ▲ ▼ picks a value, ◀ ▶ changes it. Play the night to watch it run.
          </Text>
        )}
        {params.quote ? (
          <>
            <Text style={[styles.quote, {color: theme.ink}]}>{`“${params.quote}”`}</Text>
            <Text style={[styles.quoteBy, {color: theme.inkSoft}]}>
              {hasVideo && params.quoteT !== null
                ? `The guest, at ${formatTime(params.quoteT)}`
                : 'From the conversation'}
            </Text>
          </>
        ) : null}
        <Text style={[styles.caveat, {color: theme.inkSoft}]}>
          A coaching rule, not medical advice
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {...StyleSheet.absoluteFillObject, overflow: 'hidden'},
  abs: {position: 'absolute'},
  source: {
    ...type.caption,
    position: 'absolute',
    left: space.safeX,
    right: space.safeX,
    top: space.safeY,
  },
  headline: {
    ...type.title,
    ...numeric,
    position: 'absolute',
    left: space.safeX,
    right: space.safeX,
    top: space.safeY + 20,
  },
  sky: {position: 'absolute', overflow: 'hidden', borderTopLeftRadius: radius.row, borderTopRightRadius: radius.row},
  star: {position: 'absolute', borderRadius: 1},
  disc: {position: 'absolute'},
  sunset: {width: 32, height: 32, borderRadius: 16},
  sunrise: {width: 36, height: 36, borderRadius: 18},
  arcLayer: {position: 'absolute', top: 0},
  steps: {position: 'absolute', left: 8, top: 8},
  stepRow: {flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2},
  stepGlyph: {marginTop: 2, marginRight: 6},
  stepText: {...type.caption, flexShrink: 1, marginRight: 6},
  stepOffset: {...type.caption, ...numeric},
  readout: {...type.bodyStrong, ...numeric, position: 'absolute', right: space.s, top: space.xs},
  horizon: {position: 'absolute', height: 1.5},
  cycleNo: {...type.captionStrong, position: 'absolute', width: 24, textAlign: 'center'},
  junction: {...type.caption, ...numeric, position: 'absolute'},
  junctionStrong: {...type.captionStrong},
  junctionFirst: {width: 132, textAlign: 'right'},
  junctionLast: {width: 132, textAlign: 'left'},
  junctionMid: {width: 48, textAlign: 'center'},
  marker: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  head: {position: 'absolute', left: 0, width: 2, borderRadius: 1},
  dot: {position: 'absolute', left: 0, top: 0, width: 10, height: 10, borderRadius: 5},
  halo: {position: 'absolute', left: 0, top: 0, width: 22, height: 22, borderRadius: 11, borderWidth: 2},
  moon: {position: 'absolute', left: 0, top: 0},
  control: {position: 'absolute', width: CONTROLS_W},
  words: {position: 'absolute', right: space.safeX},
  chip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.row,
    paddingHorizontal: space.s,
    paddingVertical: 4,
  },
  chipText: {...type.captionStrong, ...numeric},
  hint: {...type.caption},
  quote: {...type.body, marginTop: space.s},
  quoteBy: {...type.caption, marginTop: 2},
  caveat: {...type.caption, marginTop: space.xs},
});
