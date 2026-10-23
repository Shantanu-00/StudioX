import React, {useCallback, useEffect, useMemo, useReducer, useRef, useState} from 'react';
import {StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from '@amazon-devices/react-native-reanimated';
import Svg, {Line, Path} from '@amazon-devices/react-native-svg';
import {formatTime} from '../analysis/composer';
import {GrowthParams} from '../analysis/schema';
import {numeric, space, type} from '../theme';
import {
  compactMoney,
  GrowthField,
  growthChart,
  growthInit,
  growthOutcome,
  growthSeries,
  growthSpan,
  GrowthState,
  growthStep,
  growthTop,
  money,
  moneyArrow,
  moneyChange,
  monthlyStep,
  percent,
  stackLabels,
  valueTicks,
  yearTicks,
} from './sims';
import {MapTheme, themeFor} from './themes';
import {SimButton, useFocusRefs, useOnBackground, ValueControl} from './sim/controls';
import {withAlpha} from './sim/color';

interface Props {
  title: string;
  params: GrowthParams;
  source: string;
  hasVideo: boolean;
  onDone: () => void;
  theme?: MapTheme;
}

// Layout on the 960 x 540 dp canvas.
const TOP = 112;
const TILE_W = 232;
const TILE_STEP = 90;
const PAD = 8; // room around the curves for strokes and the gap bracket
const PLOT_TOP = 192;
const PLOT_H = 188;
const Y_LABEL_W = 48;
const LABEL_COL = 128; // room right of the plot for the curve names

const SNAP_MS = 250;
const MS_PER_YEAR = 110;
const HOLD_MS = 700;
const SETTLE_MS = 400;

type Key = GrowthField | 'play' | 'done';

const years = (n: number) => `${n} ${n === 1 ? 'year' : 'years'}`;
// A rough line count for a caption in a column, to stack labels apart.
const captionLines = (text: string, w: number) => (text.length * 7.2 > w ? 2 : 1);

// "See it grow": the same saving started now or later. Three values the
// remote changes (UP/DOWN picks, LEFT/RIGHT changes), the outcomes with what
// each change did, and a chart that explains itself: both curves named, the
// gap between them shaded and priced, what was paid in drawn dashed, and a
// marker at the horizon. Play draws the years once, then settles.
export const GrowthSim = ({
  title,
  params,
  source,
  hasVideo,
  onDone,
  theme = themeFor('finance'),
}: Props) => {
  const win = useWindowDimensions();
  const W = Math.round(win.width);
  const cur = params.currency;
  const step = useMemo(() => monthlyStep(params.monthly), [params.monthly]);
  const base = useMemo(
    () => ({start: params.start, laterYears: params.laterYears, monthlyStep: step, currency: cur}),
    [params.start, params.laterYears, step, cur],
  );
  const reducer = useCallback(
    (s: GrowthState, a: {field: GrowthField; dir: 1 | -1}) => growthStep(s, a.field, a.dir, base),
    [base],
  );
  const [state, dispatch] = useReducer(reducer, params, growthInit);
  const later = params.laterYears;
  const twoCurves = later > 0;
  const series = useMemo(
    () =>
      growthSeries(
        {start: params.start, monthly: state.monthly, ratePct: state.ratePct, laterYears: later},
        state.years,
      ),
    [params.start, state.monthly, state.ratePct, later, state.years],
  );
  const out = growthOutcome(base, state);
  const initialEnd = useMemo(() => growthOutcome(base, params).now, [base, params]);
  const span = growthSpan(params.years, state.years);
  const top = growthTop(initialEnd, Math.max(out.now, out.later));

  const rightX = space.safeX + TILE_W + space.l;
  const plot = {
    x: rightX + Y_LABEL_W + 4,
    y: PLOT_TOP,
    w: W - space.safeX - LABEL_COL - (rightX + Y_LABEL_W + 4),
    h: PLOT_H,
  };
  const chart = useMemo(
    () => growthChart(series, {x: PAD, y: PAD, w: plot.w, h: plot.h}, later, span, top),
    [series, plot.w, plot.h, later, span, top],
  );
  const endX = plot.x - PAD + chart.endX; // absolute
  const toAbsY = (y: number) => plot.y - PAD + y;
  const hNow = plot.y + plot.h - toAbsY(chart.nowEnd);

  // ---- motion (UI thread) ---------------------------------------------------
  const g = useSharedValue(1); // through the years: 0 today, 1 the horizon (rest)
  const live = useSharedValue(0);
  const markerX = useSharedValue(endX);
  const height = useSharedValue(hNow);
  const relabel = useSharedValue(1);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const [tick, setTick] = useState(-1);

  useEffect(() => {
    markerX.value = withTiming(endX, {duration: SNAP_MS, easing: Easing.out(Easing.cubic)});
  }, [endX, markerX]);
  useEffect(() => {
    height.value = withTiming(hNow, {duration: SNAP_MS, easing: Easing.out(Easing.cubic)});
  }, [hNow, height]);
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
  }, []);
  const stop = useCallback(() => {
    if (!playingRef.current) {
      return;
    }
    cancelAnimation(g);
    cancelAnimation(live);
    g.value = withTiming(1, {duration: SNAP_MS, easing: Easing.out(Easing.cubic)});
    live.value = withTiming(0, {duration: SNAP_MS});
    finish();
  }, [g, live, finish]);
  const horizon = state.years;
  const start = useCallback(() => {
    playingRef.current = true;
    setPlaying(true);
    setTick(0);
    cancelAnimation(g);
    cancelAnimation(live);
    g.value = 0;
    live.value = withTiming(1, {duration: 200});
    g.value = withTiming(
      1,
      {
        duration: Math.min(5500, Math.max(2500, horizon * MS_PER_YEAR)),
        easing: Easing.linear,
      },
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
  }, [horizon, g, live, finish]);
  useEffect(
    () => () => {
      cancelAnimation(g);
      cancelAnimation(live);
      cancelAnimation(markerX);
      cancelAnimation(height);
      cancelAnimation(relabel);
    },
    [g, live, markerX, height, relabel],
  );
  useOnBackground(stop);
  useAnimatedReaction(
    () => (live.value > 0.01 ? Math.floor(g.value * horizon) : -1),
    (now, prev) => {
      if (now !== prev && now >= 0) {
        runOnJS(setTick)(now);
      }
    },
    [horizon],
  );

  // ---- remote ---------------------------------------------------------------
  const focusKey = useRef<Key>('monthly');
  useTVEventHandler((evt) => {
    if (evt.eventKeyAction === 1) {
      return;
    }
    const t = evt.eventType;
    if (playingRef.current) {
      if (!(t === 'select' && focusKey.current === 'play')) {
        stop();
      }
      return;
    }
    const k = focusKey.current;
    if ((t === 'left' || t === 'right') && k !== 'play' && k !== 'done') {
      dispatch({field: k, dir: t === 'right' ? 1 : -1});
    }
  });
  const {register, next} = useFocusRefs<Key>('monthly');
  const focusOn = (k: Key) => () => {
    focusKey.current = k;
  };

  // ---- animated styles -------------------------------------------------------
  const curveStyle = useAnimatedStyle(() => {
    const s = hNow > 0.5 ? height.value / hNow : 1;
    return {transform: [{translateY: ((1 - s) * PLOT_H) / 2}, {scaleY: s}]};
  });
  const plotX = plot.x;
  const veilStyle = useAnimatedStyle(() => ({
    transform: [{translateX: g.value * (markerX.value - plotX + PAD)}],
  }));
  const headStyle = useAnimatedStyle(() => ({
    opacity: live.value,
    transform: [{translateX: plotX + g.value * (markerX.value - plotX) - 1}],
  }));
  const markerStyle = useAnimatedStyle(() => ({
    transform: [{translateX: markerX.value - 40}],
  }));
  const labelStyle = useAnimatedStyle(() => ({opacity: relabel.value}));

  // ---- words ------------------------------------------------------------------
  const name0 = params.labels?.[0] ?? 'Start now';
  const name1 = params.labels?.[1] ?? `Start in ${years(later)}`;
  const ages = params.startAges;
  const at = playing && tick >= 0 ? series[Math.min(tick, series.length - 1)] : null;
  const shown = at
    ? {now: at.now, later: at.later, gap: at.now - at.later}
    : {now: out.now, later: out.later, gap: out.gap};
  const before = state.last?.before ?? null;
  const change = (k: 'now' | 'later' | 'gap') =>
    !at && before ? moneyChange(before[k], out[k], cur) : null;
  const headline = twoCurves
    ? `Waiting ${years(later)} costs ${money(out.gap, cur)}`
    : `${money(out.now, cur)} after ${years(state.years)}`;
  const sub = `${money(state.monthly, cur)} a month at ${percent(state.ratePct)} a year for ${years(
    state.years,
  )}${params.start ? `, on top of ${money(params.start, cur)}` : ''}. Paid in: ${money(
    out.paidNow,
    cur,
  )}${twoCurves ? ` vs ${money(out.paidLater, cur)}` : ''}; the rest is growth.`;
  const changedSeq = (f: GrowthField) => (state.last?.field === f ? state.last.seq : null);
  const note = (f: GrowthField, rest: string) =>
    state.last?.field === f ? state.last.text : rest;
  const outcomeA11y = before
    ? [
        moneyArrow(name0, before.now, out.now, cur),
        twoCurves ? moneyArrow(name1, before.later, out.later, cur) : null,
        twoCurves ? moneyArrow('Cost of waiting', before.gap, out.gap, cur) : null,
      ]
        .filter(Boolean)
        .join('. ')
    : `${name0}: ${money(out.now, cur)}`;

  // Names at the curves' ends, stacked apart, right of the horizon marker.
  const colX = endX + 12;
  const colW = Math.min(160, W - space.safeX - colX);
  const gapText = `Cost of waiting: ${money(out.gap, cur)}`;
  const paidText = `Paid in ${money(out.paidNow, cur)}`;
  const items = [
    {key: 'now', text: name0, y: toAbsY(chart.nowEnd)},
    ...(twoCurves
      ? [
          {key: 'gap', text: gapText, y: toAbsY((chart.nowEnd + chart.laterEnd) / 2)},
          {key: 'later', text: name1, y: toAbsY(chart.laterEnd)},
        ]
      : []),
    {key: 'paid', text: paidText, y: toAbsY(chart.paidEnd)},
  ].map((i) => {
    const h = captionLines(i.text, colW) * 18;
    return {...i, h, y: i.y - h / 2};
  });
  const slots = stackLabels(items, plot.y - 12, plot.y + plot.h + 20);
  const labelColor: Record<string, string> = {
    now: theme.ink,
    gap: theme.ink,
    later: theme.ink,
    paid: theme.inkSoft,
  };
  const ticks = yearTicks(span).filter((y) => Math.abs(plot.x + (y / span) * plot.w - endX) > 26);
  const X = (y: number) => plot.x + (y / span) * plot.w;
  const gold = theme.support;

  return (
    <View style={[styles.root, {backgroundColor: theme.bg}]} testID="growth-sim">
      <Text style={[styles.source, {color: theme.inkSoft}]} numberOfLines={1}>
        {`${title} · ${source}`}
      </Text>
      <Text style={[styles.headline, {color: theme.ink}]} testID="growth-headline">
        {headline}
      </Text>
      <Text style={[styles.sub, {color: theme.inkSoft}]} accessibilityLiveRegion="polite">
        {sub}
      </Text>

      {/* The three values the remote changes. */}
      <ValueControl
        ref={register('monthly')}
        testID="growth-monthly"
        label="Monthly amount"
        value={money(state.monthly, cur)}
        note={note('monthly', `Steps of ${money(step, cur)}`)}
        noteStrong={state.last?.field === 'monthly'}
        accessibilityLabel={`Monthly amount ${money(state.monthly, cur)}. Left or right changes it by ${money(step, cur)}.`}
        theme={theme}
        size="tile"
        changedSeq={changedSeq('monthly')}
        hasTVPreferredFocus
        nextFocus={next('monthly', {down: 'ratePct'})}
        onFocus={focusOn('monthly')}
        style={[styles.tile, {top: TOP}]}
      />
      <ValueControl
        ref={register('ratePct')}
        testID="growth-rate"
        label="Rate %"
        value={percent(state.ratePct)}
        note={note('ratePct', 'Steps of 0.5% a year')}
        noteStrong={state.last?.field === 'ratePct'}
        accessibilityLabel={`Rate ${percent(state.ratePct)} a year. Left or right changes it by half a percent.`}
        theme={theme}
        size="tile"
        changedSeq={changedSeq('ratePct')}
        nextFocus={next('ratePct', {up: 'monthly', down: 'years'})}
        onFocus={focusOn('ratePct')}
        style={[styles.tile, {top: TOP + TILE_STEP}]}
      />
      <ValueControl
        ref={register('years')}
        testID="growth-years"
        label="Years"
        value={String(state.years)}
        note={note(
          'years',
          ages ? `To age ${ages[0] + state.years}` : 'Steps of 1 year',
        )}
        noteStrong={state.last?.field === 'years'}
        accessibilityLabel={`${years(state.years)}. Left or right changes it by one year.`}
        theme={theme}
        size="tile"
        changedSeq={changedSeq('years')}
        nextFocus={next('years', {up: 'ratePct', down: 'play'})}
        onFocus={focusOn('years')}
        style={[styles.tile, {top: TOP + 2 * TILE_STEP}]}
      />
      <SimButton
        ref={register('play')}
        testID="growth-play"
        label={playing ? 'Stop' : 'Play'}
        icon={playing ? 'pause' : 'play'}
        accessibilityLabel={playing ? 'Stop' : 'Play the years once'}
        nextFocus={next('play', {up: 'years', right: 'done'})}
        onFocus={focusOn('play')}
        onPress={() => (playingRef.current ? stop() : start())}
        style={[styles.abs, {left: space.safeX, top: TOP + 3 * TILE_STEP - 4}]}
      />
      <SimButton
        ref={register('done')}
        testID="growth-done"
        label="Done"
        accessibilityLabel="Done, back to the map"
        nextFocus={next('done', {up: 'years', left: 'play'})}
        onFocus={focusOn('done')}
        onPress={onDone}
        style={[styles.abs, {left: space.safeX + 124, top: TOP + 3 * TILE_STEP - 4}]}
      />

      {/* The outcomes, and what the last change did to each. */}
      <View
        style={[styles.outcomes, {left: rightX, top: TOP}]}
        accessible
        accessibilityLabel={outcomeA11y}
        accessibilityLiveRegion="polite">
        <Outcome
          theme={theme}
          swatch={<View style={[styles.swatchLine, {backgroundColor: theme.accent}]} />}
          label={name0}
          value={money(shown.now, cur)}
          note={change('now')}
        />
        {twoCurves ? (
          <>
            <Outcome
              theme={theme}
              swatch={<View style={[styles.swatchLine, {backgroundColor: theme.ink}]} />}
              label={name1}
              value={shown.later > 0 ? money(shown.later, cur) : 'Not started'}
              note={change('later')}
            />
            <Outcome
              theme={theme}
              swatch={<View style={[styles.swatchBox, {backgroundColor: withAlpha(gold, 0.5)}]} />}
              label="Cost of waiting"
              value={money(shown.gap, cur)}
              note={change('gap')}
            />
          </>
        ) : null}
      </View>

      {/* The chart: the gap, paid-in and both curves, drawn under a veil
          that Play pulls back year by year. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.abs,
          {left: plot.x - PAD, top: plot.y - PAD, width: plot.w + 2 * PAD, height: plot.h + 2 * PAD},
          curveStyle,
        ]}>
        <Svg width={plot.w + 2 * PAD} height={plot.h + 2 * PAD}>
          {twoCurves ? <Path d={chart.gap} fill={withAlpha(gold, 0.22)} /> : null}
          <Path d={chart.paid} stroke={theme.inkSoft} strokeWidth={1.5} strokeDasharray="5 5" fill="none" />
          {twoCurves ? <Path d={chart.later} stroke={theme.ink} strokeWidth={2} fill="none" /> : null}
          <Path d={chart.now} stroke={theme.accent} strokeWidth={3} fill="none" />
          {twoCurves && chart.laterEnd - chart.nowEnd > 4 ? (
            <Line
              x1={chart.endX + 5}
              y1={chart.nowEnd}
              x2={chart.endX + 5}
              y2={chart.laterEnd}
              stroke={gold}
              strokeWidth={2}
            />
          ) : null}
        </Svg>
      </Animated.View>
      <View
        pointerEvents="none"
        style={[
          styles.clip,
          {left: plot.x, top: plot.y - PAD, width: plot.w + 2 * PAD, height: plot.h + PAD + 1},
        ]}>
        <Animated.View
          style={[styles.veil, {width: plot.w + 2 * PAD, height: plot.h + PAD + 1, backgroundColor: theme.bg}, veilStyle]}
        />
      </View>

      {/* Ruled lines and the axes, over the veil. */}
      <Svg
        width={plot.w}
        height={plot.h + 6}
        style={[styles.abs, {left: plot.x, top: plot.y}]}
        pointerEvents="none">
        {valueTicks(top).map((v) => {
          const y = Math.round(plot.h - (v / top) * plot.h);
          return <Line key={v} x1={0} y1={y} x2={plot.w} y2={y} stroke={theme.line} strokeWidth={1} />;
        })}
        <Line x1={0} y1={plot.h} x2={plot.w} y2={plot.h} stroke={theme.line} strokeWidth={1.5} />
        {ticks.map((y) => (
          <Line key={y} x1={X(y) - plot.x} y1={plot.h} x2={X(y) - plot.x} y2={plot.h + 5} stroke={theme.line} strokeWidth={1.5} />
        ))}
        {twoCurves && later < state.years ? (
          <Line
            x1={X(later) - plot.x}
            y1={plot.h - 6}
            x2={X(later) - plot.x}
            y2={plot.h + 6}
            stroke={theme.ink}
            strokeWidth={2}
          />
        ) : null}
      </Svg>
      {valueTicks(top).map((v) => (
        <Text
          key={v}
          style={[
            styles.yLabel,
            {left: rightX, top: Math.round(plot.y + plot.h - (v / top) * plot.h) - 9, color: theme.inkSoft},
          ]}>
          {compactMoney(v, cur)}
        </Text>
      ))}
      <Text style={[styles.yLabel, {left: rightX, top: plot.y + plot.h + 6, color: theme.inkSoft}]}>
        Years
      </Text>
      {ages ? (
        <Text style={[styles.yLabel, {left: rightX, top: plot.y + plot.h + 24, color: theme.inkSoft}]}>
          Age
        </Text>
      ) : null}
      {ticks.map((y) => (
        <React.Fragment key={y}>
          <Text style={[styles.xLabel, {left: X(y) - 20, top: plot.y + plot.h + 6, color: theme.inkSoft}]}>
            {String(y)}
          </Text>
          {ages ? (
            <Text style={[styles.xLabel, {left: X(y) - 20, top: plot.y + plot.h + 24, color: theme.inkSoft}]}>
              {String(ages[0] + y)}
            </Text>
          ) : null}
        </React.Fragment>
      ))}

      {/* The horizon marker, which a Years change slides. */}
      <Animated.View pointerEvents="none" style={[styles.marker, {top: plot.y}, markerStyle]}>
        <View style={[styles.markerLine, {height: plot.h, backgroundColor: theme.inkSoft}]} />
        <Text style={[styles.markerText, {top: plot.h + 6, color: theme.ink}]}>
          {String(state.years)}
        </Text>
        {ages ? (
          <Text style={[styles.markerText, {top: plot.h + 24, color: theme.ink}]}>
            {String(ages[0] + state.years)}
          </Text>
        ) : null}
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[styles.head, {top: plot.y, height: plot.h, backgroundColor: gold}, headStyle]}
      />
      {at ? (
        <Text style={[styles.readout, {left: plot.x + 8, top: plot.y + 2, color: theme.ink}]}>
          {`Year ${at.year}${ages ? ` · age ${ages[0] + at.year}` : ''}`}
        </Text>
      ) : null}

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, labelStyle]}>
        {items.map((i) => (
          <Text
            key={i.key}
            style={[
              i.key === 'now' || i.key === 'gap' ? styles.endLabelStrong : styles.endLabel,
              {left: colX, top: slots[i.key], width: colW, color: labelColor[i.key]},
            ]}>
            {i.text}
          </Text>
        ))}
      </Animated.View>

      <View style={styles.quoteBlock}>
        {params.quote ? (
          <Text style={[styles.quote, {color: theme.ink}]}>
            {`“${params.quote}”${
              hasVideo && params.quoteT !== null ? `  ${formatTime(params.quoteT)}` : ''
            }`}
          </Text>
        ) : null}
        <Text style={[styles.caveat, {color: theme.inkSoft}]}>
          An illustration at a fixed rate, not financial advice
        </Text>
      </View>
    </View>
  );
};

const Outcome = ({
  theme,
  swatch,
  label,
  value,
  note,
}: {
  theme: MapTheme;
  swatch: React.ReactNode;
  label: string;
  value: string;
  note: string | null;
}) => (
  <View style={styles.outcome}>
    <View style={styles.outcomeHead}>
      {swatch}
      <Text style={[styles.outcomeLabel, {color: theme.inkSoft}]}>{label}</Text>
    </View>
    <Text style={[styles.outcomeValue, {color: theme.ink}]}>{value}</Text>
    {note ? <Text style={[styles.outcomeNote, {color: theme.ink}]}>{note}</Text> : null}
  </View>
);

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
  sub: {
    ...type.body,
    ...numeric,
    position: 'absolute',
    left: space.safeX,
    right: space.safeX,
    top: space.safeY + 52,
  },
  tile: {position: 'absolute', left: space.safeX, width: TILE_W},
  outcomes: {position: 'absolute', right: space.safeX, flexDirection: 'row'},
  outcome: {flex: 1, marginRight: space.s},
  outcomeHead: {flexDirection: 'row', alignItems: 'center'},
  swatchLine: {width: 14, height: 3, borderRadius: 1.5, marginRight: 6},
  swatchBox: {width: 10, height: 10, borderRadius: 2, marginRight: 6},
  outcomeLabel: {...type.caption, flexShrink: 1},
  outcomeValue: {...type.headline, ...numeric},
  outcomeNote: {...type.caption, ...numeric},
  clip: {position: 'absolute', overflow: 'hidden'},
  veil: {position: 'absolute', left: 0, top: 0},
  yLabel: {...type.caption, ...numeric, position: 'absolute', width: Y_LABEL_W, textAlign: 'right'},
  xLabel: {...type.caption, ...numeric, position: 'absolute', width: 40, textAlign: 'center'},
  marker: {position: 'absolute', left: 0, width: 80, alignItems: 'center'},
  markerLine: {width: 1.5},
  markerText: {...type.captionStrong, ...numeric, position: 'absolute', width: 80, textAlign: 'center'},
  head: {position: 'absolute', left: 0, width: 2, borderRadius: 1},
  readout: {...type.bodyStrong, ...numeric, position: 'absolute'},
  endLabel: {...type.caption, ...numeric, position: 'absolute'},
  endLabelStrong: {...type.captionStrong, ...numeric, position: 'absolute'},
  quoteBlock: {position: 'absolute', left: space.safeX, right: space.safeX, top: 436},
  quote: {...type.body},
  caveat: {...type.caption, marginTop: 4},
});
