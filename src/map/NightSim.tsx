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
  withRepeat,
  withTiming,
} from '@amazon-devices/react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  Line,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from '@amazon-devices/react-native-svg';
import {formatTime} from '../analysis/composer';
import {NightParams} from '../analysis/schema';
import {numeric, radius, space, type} from '../theme';
import {
  clock,
  crescentPath,
  hypnogram,
  hypnogramY,
  NightField,
  nightInit,
  nightStages,
  NightState,
  nightStep,
  shortDuration,
  STAGE_NAME,
  STAGE_ROW,
  STAGE_ROWS,
  stageAt,
  stageReadout,
} from './sims';
import {SendStatus, sendLabel} from './useMapActions';
import {nightReminderCard} from './mapData';
import {PhoneCard} from '../services/api';
import {MapTheme, themeFor} from './themes';
import {SimButton, useFocusRefs, useOnBackground, ValueTile} from './sim/controls';
import {withAlpha} from './sim/color';

interface Props {
  title: string;
  params: NightParams;
  source: string; // the episode or cameo it comes from
  hasVideo: boolean;
  // Who said the quote, when the package names them.
  speaker?: string | null;
  paired: boolean;
  sendStatus: SendStatus;
  onSend: (card: PhoneCard) => void;
  onDone: () => void;
  // Where Done and BACK lead: the Map, or the episode (opened from the panel).
  backTo?: 'map' | 'episode';
  theme?: MapTheme;
}

// Scene geometry on the 960 x 540 dp canvas (safe margins 48 x 27).
const WIN = {x: space.safeX, y: space.safeY, w: 440, h: 160};
const BED = {x: space.safeX, y: WIN.y + WIN.h + 3, w: WIN.w, h: 46};
const RIGHT_X = WIN.x + WIN.w + space.xl; // 520
const READOUT_TOP = 266;
const CYCLE_TOP = 292;
const CHART_TOP = 316;
const ROW_H = 24;
const CHART_H = 3 * ROW_H;
const LEVEL_W = 56;
const TICK_TOP = CHART_TOP + CHART_H + 6;
const BUTTONS_TOP = 424;
const CAVEAT_TOP = 472;
const MOON = 9;

const SNAP_MS = 250; // a value change settles in this
const MS_PER_CYCLE = 1600; // Play: one cycle in 1.6 s
const TICK_MIN = 10; // the clock and the readout step every 10 minutes (≤ 8 a second)

// The window through the night: dusk, deep night, first light, dawn.
const DUSK = '#1C0A12';
const PREDAWN = '#1A1424';
const DAWN = '#3A2220';

// [x, y, size] inside the window.
const STARS: Array<[number, number, number]> = [
  [34, 20, 2], [88, 56, 1.5], [148, 16, 2], [196, 44, 1.5], [262, 14, 2],
  [318, 60, 1.5], [366, 26, 2], [404, 74, 1.5], [58, 98, 1.5], [244, 96, 1.5],
  [128, 122, 1.5], [346, 116, 1.5], [178, 84, 1.5], [410, 128, 1.5],
];

const CAVEAT =
  'R90 is a coaching method from sleep coach Nick Littlehales, not a clinical standard. Stages are illustrative, not your data. Not medical advice.';

type Key = NightField | 'play' | 'send' | 'done';
type Status = 'rest' | 'playing' | 'paused';

const reducer = (s: NightState, a: {field: NightField; dir: 1 | -1}) =>
  nightStep(s, a.field, a.dir);

const isField = (k: Key): k is NightField =>
  k === 'bedtime' || k === 'cycles' || k === 'cycleMinutes';

// "Plan your night": the guest's R90 rule as a scene the viewer drives, after
// the first prototype. A window onto the night with the sleeper below it, the
// values and the answer on the right, and the night's stages as a hypnogram.
// At rest nothing moves and the scene sits at waking (dawn in the window, the
// playhead at the end). A change settles in 250 ms. Play the night sweeps the
// playhead from lights out to waking, the moon across the panes and the
// sleeper breathing, then rests at dawn; any key pauses, Play resumes. Every
// moving part runs on the UI thread from shared values; the clock and the
// readout change only on 10-minute ticks.
export const NightSim = ({
  title,
  params,
  source,
  hasVideo,
  speaker = null,
  paired,
  sendStatus,
  onSend,
  onDone,
  backTo = 'map',
  theme = themeFor('health'),
}: Props) => {
  const win = useWindowDimensions();
  const W = Math.round(win.width);
  const chartX = space.safeX + LEVEL_W;
  const chartW = W - space.safeX - chartX;
  const [state, dispatch] = useReducer(reducer, params, nightInit);
  const plan = state.plan;
  const cycles = plan.cycles;
  const len = plan.cycleMinutes;
  const total = plan.sleepMinutes;
  const spans = useMemo(() => nightStages(cycles, len), [cycles, len]);
  const graph = useMemo(() => hypnogram(spans, chartW, ROW_H), [spans, chartW]);

  // ---- motion (UI thread) ---------------------------------------------------
  const p = useSharedValue(1); // through the night: 0 lights out, 1 waking (rest)
  const live = useSharedValue(0); // 1 while the night is playing or paused
  const breath = useSharedValue(0);
  const relayout = useSharedValue(1);
  const [status, setStatus] = useState<Status>('rest');
  const statusRef = useRef<Status>('rest');
  const [tick, setTick] = useState(-1);

  const stillBreath = useCallback(() => {
    cancelAnimation(breath);
    breath.value = withTiming(0, {duration: SNAP_MS});
  }, [breath]);

  const ended = useCallback(() => {
    statusRef.current = 'rest';
    setStatus('rest');
    setTick(-1);
    live.value = 0;
    stillBreath();
  }, [live, stillBreath]);

  const pause = useCallback(() => {
    if (statusRef.current !== 'playing') {
      return;
    }
    cancelAnimation(p);
    statusRef.current = 'paused';
    setStatus('paused');
    stillBreath();
  }, [p, stillBreath]);

  const play = useCallback(() => {
    const from = statusRef.current === 'paused' ? p.value : 0;
    statusRef.current = 'playing';
    setStatus('playing');
    cancelAnimation(p);
    if (from === 0) {
      p.value = 0;
      setTick(0);
    }
    live.value = 1;
    breath.value = withRepeat(
      withTiming(1, {duration: 2000, easing: Easing.inOut(Easing.sin)}),
      -1,
      true,
    );
    p.value = withTiming(
      1,
      {duration: Math.max(1, (1 - from) * cycles * MS_PER_CYCLE), easing: Easing.linear},
      (done) => {
        if (done) {
          runOnJS(ended)();
        }
      },
    );
  }, [cycles, p, live, breath, ended]);

  // A change: the playhead goes to waking and the graph settles in.
  const seq = state.last?.seq ?? 0;
  useEffect(() => {
    if (seq === 0) {
      return;
    }
    cancelAnimation(p);
    p.value = withTiming(1, {duration: SNAP_MS, easing: Easing.out(Easing.cubic)});
    live.value = 0;
    statusRef.current = 'rest';
    setStatus('rest');
    setTick(-1);
    stillBreath();
    relayout.value = 0.25;
    relayout.value = withTiming(1, {duration: SNAP_MS});
  }, [seq, p, live, relayout, stillBreath]);

  useEffect(
    () => () => {
      cancelAnimation(p);
      cancelAnimation(breath);
      cancelAnimation(relayout);
    },
    [p, breath, relayout],
  );
  useOnBackground(pause);

  useAnimatedReaction(
    () => (live.value > 0.5 ? Math.floor((p.value * total) / TICK_MIN) : -1),
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
    const k = focusKey.current;
    if (statusRef.current === 'playing') {
      // Any key pauses the night; OK on Play is the button's own toggle.
      if (!(t === 'select' && k === 'play')) {
        pause();
      }
      return;
    }
    if ((t === 'left' || t === 'right') && isField(k)) {
      dispatch({field: k, dir: t === 'right' ? 1 : -1});
    }
  });
  const {register, next} = useFocusRefs<Key>('bedtime');
  const focusOn = (k: Key) => () => {
    focusKey.current = k;
  };
  const right: Key = paired ? 'send' : 'done';

  // ---- animated styles -------------------------------------------------------
  const night = theme.bg;
  const skyStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      p.value,
      [0, 0.12, 0.78, 0.92, 1],
      [DUSK, night, night, PREDAWN, DAWN],
    ),
  }));
  const starStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.12, 0.8, 0.96], [0.4, 1, 1, 0.15], Extrapolation.CLAMP),
  }));
  const dawnStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0.8, 1], [0, 1], Extrapolation.CLAMP),
  }));
  const moonStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0.86, 1], [1, 0.4], Extrapolation.CLAMP),
    transform: [
      {translateX: 18 + p.value * (WIN.w - 36 - 2 * MOON)},
      {translateY: WIN.h * 0.72 - Math.sin(Math.PI * p.value) * WIN.h * 0.52},
    ],
  }));
  const blanketStyle = useAnimatedStyle(() => ({
    transform: [{translateY: -1.6 * breath.value}],
  }));
  const veilStyle = useAnimatedStyle(() => ({
    transform: [{translateX: p.value * chartW}],
  }));
  const headStyle = useAnimatedStyle(() => ({
    transform: [{translateX: chartX + p.value * chartW - 1}],
  }));
  const gx = graph.xs;
  const gy = graph.ys;
  const dotStyle = useAnimatedStyle(() => ({
    transform: [
      {translateX: chartX + p.value * chartW - 5},
      {translateY: CHART_TOP + hypnogramY(gx, gy, p.value) - 5},
    ],
  }));
  const relayoutStyle = useAnimatedStyle(() => ({opacity: relayout.value}));

  // ---- words ------------------------------------------------------------------
  const minute = status === 'rest' || tick < 0 ? total : Math.min(total, tick * TICK_MIN);
  const now = stageAt(spans, minute);
  const readout = stageReadout(spans, minute, plan);
  const changed = (f: NightField) => (state.last?.field === f ? state.last.seq : null);
  const guest = cycles === params.cycles && len === params.cycleMinutes;
  const asleep = `${shortDuration(total)} asleep · ${
    guest ? 'the guest’s rule' : `the guest said ${params.cycles} × ${params.cycleMinutes}`
  }`;
  const who =
    hasVideo && params.quoteT !== null
      ? `${speaker ?? 'The guest'} · ${formatTime(params.quoteT)}`
      : speaker ?? 'From the conversation';
  const quote = params.quote;
  const quoteStyle =
    !quote || quote.length <= 44 ? type.headline : quote.length <= 110 ? type.body : type.caption;
  const playLabel =
    status === 'playing' ? 'Pause' : status === 'paused' ? 'Resume' : 'Play the night';
  const swatch =
    now.stage === 'rem'
      ? theme.accent
      : now.stage === 'deep'
      ? theme.support
      : now.stage === 'light'
      ? theme.inkSoft
      : theme.ink;
  const ink = theme.ink;
  const ticks = Array.from({length: cycles + 1}, (_, i) => i);
  const colX = (i: number) => chartX + (i / cycles) * chartW;
  const leaveTo = backTo === 'episode' ? 'back to the episode' : 'back to the map';

  return (
    <View style={[styles.root, {backgroundColor: theme.bg}]} testID="night-sim">
      {/* The window onto the night, with the clock in its corner. */}
      <View style={[styles.window, {borderColor: theme.line}]} pointerEvents="none">
        <Animated.View style={[StyleSheet.absoluteFill, skyStyle]} />
        <Animated.View style={[StyleSheet.absoluteFill, starStyle]}>
          {STARS.map(([x, y, s], i) => (
            <View
              key={i}
              style={[
                styles.star,
                {left: x, top: y, width: s, height: s, backgroundColor: theme.support},
              ]}
            />
          ))}
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, dawnStyle]}>
          <Svg width={WIN.w} height={WIN.h}>
            <Defs>
              <RadialGradient
                id="dawn"
                cx={WIN.w * 0.62}
                cy={WIN.h}
                rx={WIN.w * 0.62}
                ry={WIN.h * 0.9}
                fx={WIN.w * 0.62}
                fy={WIN.h}
                gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={theme.support} stopOpacity={0.55} />
                <Stop offset="0.45" stopColor={theme.accent} stopOpacity={0.22} />
                <Stop offset="1" stopColor={theme.accent} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x={0} y={0} width={WIN.w} height={WIN.h} fill="url(#dawn)" />
          </Svg>
        </Animated.View>
        <Animated.View style={[styles.moon, moonStyle]}>
          <Svg width={MOON * 2 + 4} height={MOON * 2 + 4}>
            <Path d={crescentPath(MOON + 2, MOON + 2, MOON)} fill={theme.support} />
          </Svg>
        </Animated.View>
        <View style={[styles.mullion, styles.mullionV]} />
        <View style={[styles.mullion, styles.mullionH]} />
        <View style={styles.clockPlate}>
          <Text style={[styles.clock, {color: ink}]} testID="night-clock">
            {clock(plan.bedtime + minute)}
          </Text>
        </View>
      </View>

      {/* The sleeper, still at rest, breathing only while the night plays. */}
      <View style={styles.bed} pointerEvents="none">
        <Svg width={BED.w} height={BED.h}>
          <Rect x={24} y={6} width={6} height={38} fill={theme.line} />
          <Line x1={24} y1={40} x2={BED.w - 16} y2={40} stroke={theme.line} strokeWidth={2} />
          <Rect
            x={36}
            y={24}
            width={52}
            height={12}
            rx={5}
            fill={theme.surface}
            stroke={theme.line}
            strokeWidth={1}
          />
          <Circle cx={70} cy={18} r={9} fill={theme.surface} stroke={theme.support} strokeWidth={1.5} />
        </Svg>
        <Animated.View style={[StyleSheet.absoluteFill, blanketStyle]}>
          <Svg width={BED.w} height={BED.h}>
            <Path
              d="M88 38 C 126 14, 246 12, 296 22 S 396 30, 410 38 Z"
              fill={theme.surface}
              stroke={theme.support}
              strokeWidth={1.5}
            />
          </Svg>
        </Animated.View>
      </View>

      {/* What the guest said, the values, and the answer. */}
      <View style={[styles.right, {left: RIGHT_X}]}>
        <Text style={[styles.source, {color: theme.inkSoft}]}>{`${title} · ${source}`}</Text>
        {quote ? (
          <>
            <Text style={[quoteStyle, styles.quote, {color: ink}]}>{`“${quote}”`}</Text>
            <Text style={[styles.who, {color: theme.inkSoft}]}>{who}</Text>
          </>
        ) : null}
        <View style={styles.tiles}>
          <ValueTile
            ref={register('bedtime')}
            testID="night-bedtime"
            label="Lights out"
            value={clock(plan.bedtime)}
            accessibilityLabel={`Lights out ${clock(plan.bedtime)}. Left or right moves it by 15 minutes.`}
            theme={theme}
            changedSeq={changed('bedtime')}
            hasTVPreferredFocus
            nextFocus={next('bedtime', {down: 'cycles'})}
            onFocus={focusOn('bedtime')}
            style={styles.tileWide}
          />
          <ValueTile
            ref={register('cycles')}
            testID="night-cycles"
            label="Cycles"
            value={`${cycles} × ${len}`}
            accessibilityLabel={`${cycles} cycles of ${len} minutes. Left or right adds or removes one.`}
            theme={theme}
            changedSeq={changed('cycles')}
            nextFocus={next('cycles', {up: 'bedtime', down: 'cycleMinutes'})}
            onFocus={focusOn('cycles')}
            style={styles.tileWide}
          />
          <ValueTile
            ref={register('cycleMinutes')}
            testID="night-length"
            label="Cycle length"
            value={`${len} min`}
            small
            accessibilityLabel={`Cycles of ${len} minutes. Left or right changes it by 5 minutes.`}
            theme={theme}
            changedSeq={changed('cycleMinutes')}
            nextFocus={next('cycleMinutes', {up: 'cycles', down: 'play'})}
            onFocus={focusOn('cycleMinutes')}
            style={styles.tileLast}
          />
        </View>
        <Text
          style={[styles.wake, {color: ink}]}
          accessibilityLiveRegion="polite"
          testID="night-wake">
          {`Wake at ${clock(plan.wake)}`}
        </Text>
        <Text style={[styles.asleep, {color: theme.inkSoft}]} testID="night-asleep">
          {asleep}
        </Text>
        {state.last ? (
          <View style={[styles.chip, {backgroundColor: theme.accentSoft, borderColor: theme.accent}]}>
            <Text
              style={[styles.chipText, {color: ink}]}
              accessibilityLiveRegion="polite"
              testID="night-delta">
              {state.last.text}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Where the night is: the stage under the playhead. */}
      <View style={styles.readoutRow} pointerEvents="none">
        <View style={[styles.swatch, {backgroundColor: swatch}]} />
        <Text style={[styles.readout, {color: ink}]} testID="night-readout">
          {readout}
        </Text>
      </View>

      {/* The night, stage by stage: played white, still to come dim. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, relayoutStyle]}>
        {STAGE_ROWS.map((s) => (
          <Text
            key={s}
            style={[styles.level, {top: CHART_TOP + STAGE_ROW[s] * ROW_H - 9, color: theme.inkSoft}]}>
            {STAGE_NAME[s]}
          </Text>
        ))}
        <View style={[styles.chart, {left: chartX, width: chartW}]}>
          <Svg width={chartW} height={CHART_H + 4}>
            {spans
              .filter((s) => s.stage === 'deep')
              .map((s, i) => (
                <Rect
                  key={`d${i}`}
                  x={(s.start / total) * chartW}
                  y={CHART_H - 10}
                  width={((s.end - s.start) / total) * chartW}
                  height={10}
                  fill={withAlpha(theme.support, 0.14)}
                />
              ))}
            <Path d={graph.path} stroke={ink} strokeWidth={2} fill="none" />
            {spans
              .filter((s) => s.stage === 'rem')
              .map((s, i) => (
                <Line
                  key={`r${i}`}
                  x1={(s.start / total) * chartW}
                  y1={ROW_H}
                  x2={(s.end / total) * chartW}
                  y2={ROW_H}
                  stroke={ink}
                  strokeWidth={4}
                />
              ))}
          </Svg>
          <View style={styles.clip}>
            <Animated.View
              style={[
                styles.veil,
                {width: chartW, backgroundColor: withAlpha(theme.bg, 0.74)},
                veilStyle,
              ]}
            />
          </View>
          <Svg width={chartW} height={CHART_H + 4} style={StyleSheet.absoluteFill}>
            {STAGE_ROWS.map((s) => (
              <Line
                key={s}
                x1={0}
                y1={STAGE_ROW[s] * ROW_H}
                x2={chartW}
                y2={STAGE_ROW[s] * ROW_H}
                stroke={theme.line}
                strokeWidth={1}
              />
            ))}
          </Svg>
        </View>
        {ticks.map((i) => (
          <View
            key={`g${i}`}
            style={[
              styles.column,
              {left: colX(i), backgroundColor: theme.line},
            ]}
          />
        ))}
        {ticks.slice(0, cycles).map((i) => (
          <Text key={`c${i}`} style={[styles.cycleNo, {left: colX(i) + 6, color: theme.inkSoft}]}>
            {`C${i + 1}`}
          </Text>
        ))}
        {ticks.map((i) => {
          const first = i === 0;
          const last = i === cycles;
          return (
            <Text
              key={`t${i}`}
              style={[
                styles.tick,
                first ? styles.tickFirst : last ? styles.tickLast : styles.tickMid,
                {left: first ? colX(i) : last ? colX(i) - 64 : colX(i) - 24},
                {color: first || last ? ink : theme.inkSoft},
                (first || last) && styles.tickStrong,
              ]}>
              {clock(plan.bedtime + i * len)}
            </Text>
          );
        })}
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[styles.head, {backgroundColor: theme.accent}, headStyle]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.dot, {backgroundColor: ink, borderColor: theme.accent}, dotStyle]}
      />

      {/* Play, send, done, and how the remote works. */}
      <View style={styles.buttons}>
        <SimButton
          ref={register('play')}
          testID="night-play"
          label={playLabel}
          icon={status === 'playing' ? 'pause' : 'play'}
          accessibilityLabel={
            status === 'playing'
              ? 'Pause the night'
              : status === 'paused'
              ? 'Resume the night'
              : 'Play the night once, from lights out to waking'
          }
          nextFocus={next('play', {up: 'cycleMinutes', right})}
          onFocus={focusOn('play')}
          onPress={() => (statusRef.current === 'playing' ? pause() : play())}
          style={styles.button}
        />
        {paired ? (
          <SimButton
            ref={register('send')}
            testID="night-send"
            label={sendLabel(sendStatus)}
            accessibilityLabel={`${sendLabel(sendStatus)}: lights out ${clock(plan.bedtime)}, wake ${clock(
              plan.wake,
            )}`}
            nextFocus={next('send', {up: 'cycleMinutes', left: 'play', right: 'done'})}
            onFocus={focusOn('send')}
            onPress={() => {
              if (sendStatus !== 'sending' && sendStatus !== 'sent') {
                onSend(nightReminderCard(plan, new Date()));
              }
            }}
            style={styles.button}
          />
        ) : null}
        <SimButton
          ref={register('done')}
          testID="night-done"
          label="Done"
          accessibilityLabel={`Done, ${leaveTo}`}
          nextFocus={next('done', {up: 'cycleMinutes', left: paired ? 'send' : 'play'})}
          onFocus={focusOn('done')}
          onPress={onDone}
          style={styles.button}
        />
        <Text style={[styles.legend, {color: theme.inkSoft}]}>
          {status === 'playing'
            ? 'Any key pauses'
            : '▲ ▼ picks a value · ◀ ▶ changes it'}
        </Text>
      </View>
      <Text style={[styles.caveat, {color: theme.inkSoft}]} testID="night-caveat">
        {CAVEAT}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {...StyleSheet.absoluteFillObject, overflow: 'hidden'},
  window: {
    position: 'absolute',
    left: WIN.x,
    top: WIN.y,
    width: WIN.w,
    height: WIN.h,
    borderWidth: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  star: {position: 'absolute', borderRadius: 1},
  moon: {position: 'absolute', left: 0, top: 0},
  mullion: {position: 'absolute', backgroundColor: '#000000'},
  mullionV: {left: WIN.w / 2 - 3, top: 0, bottom: 0, width: 4},
  mullionH: {top: WIN.h / 2 - 3, left: 0, right: 0, height: 4},
  clockPlate: {position: 'absolute', right: 8, top: 6},
  clock: {...type.captionStrong, ...numeric},
  bed: {position: 'absolute', left: BED.x, top: BED.y, width: BED.w, height: BED.h},
  right: {position: 'absolute', top: space.safeY, right: space.safeX},
  source: {...type.caption},
  quote: {marginTop: 4},
  who: {...type.caption, ...numeric},
  tiles: {flexDirection: 'row', marginTop: space.s},
  tileWide: {flexGrow: 1, marginRight: space.xs},
  tileLast: {flexGrow: 1},
  wake: {...type.title, ...numeric, marginTop: space.s},
  asleep: {...type.caption, ...numeric},
  chip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.row,
    paddingHorizontal: space.s,
    paddingVertical: 3,
    marginTop: 6,
  },
  chipText: {...type.captionStrong, ...numeric},
  readoutRow: {
    position: 'absolute',
    left: space.safeX,
    top: READOUT_TOP,
    width: WIN.w,
    flexDirection: 'row',
    alignItems: 'center',
  },
  swatch: {width: 8, height: 8, borderRadius: 2, marginRight: space.xs},
  readout: {...type.bodyStrong, ...numeric, flexShrink: 1},
  level: {...type.caption, position: 'absolute', left: space.safeX, width: LEVEL_W - 4},
  chart: {position: 'absolute', top: CHART_TOP, height: CHART_H + 4},
  clip: {...StyleSheet.absoluteFillObject, overflow: 'hidden'},
  veil: {position: 'absolute', left: 0, top: 0, bottom: 0},
  column: {position: 'absolute', top: CYCLE_TOP + 2, width: 1, height: CHART_TOP + CHART_H + 4 - CYCLE_TOP - 2},
  cycleNo: {...type.caption, ...numeric, position: 'absolute', top: CYCLE_TOP},
  tick: {...type.caption, ...numeric, position: 'absolute', top: TICK_TOP},
  tickStrong: {...type.captionStrong},
  tickFirst: {width: 64, textAlign: 'left'},
  tickLast: {width: 64, textAlign: 'right'},
  tickMid: {width: 48, textAlign: 'center'},
  head: {position: 'absolute', left: 0, top: CHART_TOP - 6, width: 2, height: CHART_H + 12, borderRadius: 1},
  dot: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
  },
  buttons: {
    position: 'absolute',
    left: space.safeX,
    right: space.safeX,
    top: BUTTONS_TOP,
    flexDirection: 'row',
    alignItems: 'center',
  },
  button: {marginRight: space.s},
  legend: {...type.caption, flex: 1, textAlign: 'right'},
  caveat: {
    ...type.caption,
    position: 'absolute',
    left: space.safeX,
    right: space.safeX,
    top: CAVEAT_TOP,
  },
});
