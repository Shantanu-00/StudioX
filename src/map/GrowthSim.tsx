import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import Svg, {Line, Path} from '@amazon-devices/react-native-svg';
import {formatTime} from '../analysis/composer';
import {GrowthParams} from '../analysis/schema';
import {FocusFrame} from '../components/FocusFrame';
import {colors, numeric, space, type} from '../theme';
import {useFocusOnMount} from './focus';
import {
  growthPaths,
  growthSeries,
  money,
  monthlyStep,
  YEARS_MAX,
  YEARS_MIN,
} from './sims';

interface Props {
  title: string;
  params: GrowthParams;
  source: string;
  hasVideo: boolean;
  onDone: () => void;
}

const MONTHLY_MAX = 1e7;

// "See it grow": the same saving started now or later, two curves the
// viewer reshapes with the remote. The maths is in sims.ts.
export const GrowthSim = ({title, params, source, hasVideo, onDone}: Props) => {
  const win = useWindowDimensions();
  const W = Math.round(win.width);
  const H = Math.round(win.height);
  const [years, setYears] = useState(params.years);
  const [monthly, setMonthly] = useState(params.monthly);
  const step = useMemo(() => monthlyStep(params.monthly), [params.monthly]);
  const later = params.laterYears;
  const series = useMemo(
    () =>
      growthSeries(
        {start: params.start, monthly, ratePct: params.ratePct, laterYears: later},
        years,
      ),
    [params.start, params.ratePct, monthly, later, years],
  );
  const chart = useMemo(
    () => ({x: space.safeX, y: 208, w: W - 2 * space.safeX - 168, h: 196}),
    [W],
  );
  const paths = useMemo(
    () => growthPaths(series, chart, later),
    [series, chart, later],
  );
  const end = series[series.length - 1];
  const gap = end.now - end.later;
  const cur = params.currency;

  useTVEventHandler((evt) => {
    if (evt.eventKeyAction === 1) {
      return;
    }
    switch (evt.eventType) {
      case 'left':
        setYears((y) => Math.max(YEARS_MIN, y - 1));
        break;
      case 'right':
        setYears((y) => Math.min(YEARS_MAX, y + 1));
        break;
      case 'up':
        setMonthly((m) => Math.min(MONTHLY_MAX, m + step));
        break;
      case 'down':
        setMonthly((m) => Math.max(0, m - step));
        break;
    }
  });

  const doneRef = useFocusOnMount<View>(true);
  const twoCurves = later > 0;
  const endX = chart.x + chart.w;

  return (
    <View style={styles.root} testID="growth-sim">
      <Text style={styles.source} numberOfLines={1}>
        {`${title} · ${source}`}
      </Text>
      <Text style={styles.sub} numberOfLines={1} accessibilityLiveRegion="polite">
        {`${money(monthly, cur)} a month for ${years} ${
          years === 1 ? 'year' : 'years'
        } at ${params.ratePct}% a year${
          params.start ? `, starting with ${money(params.start, cur)}` : ''
        }`}
      </Text>
      <View style={styles.totals}>
        <Total label="Start now" value={money(end.now, cur)} />
        {twoCurves ? (
          <>
            <Total
              label={`Start in ${later} ${later === 1 ? 'year' : 'years'}`}
              value={end.later > 0 ? money(end.later, cur) : 'Not started'}
            />
            <Total label="The cost of waiting" value={money(gap, cur)} />
          </>
        ) : null}
      </View>

      <Svg width={W} height={H} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Line
          x1={chart.x}
          y1={chart.y + chart.h}
          x2={endX}
          y2={chart.y + chart.h}
          stroke={colors.track}
          strokeWidth={2}
        />
        {twoCurves ? (
          <Path
            d={paths.later}
            stroke={colors.textSecondary}
            strokeWidth={2}
            strokeDasharray="6 6"
            fill="none"
          />
        ) : null}
        <Path d={paths.now} stroke={colors.text} strokeWidth={3} fill="none" />
        {twoCurves && gap > 0 ? (
          <Line
            x1={endX + 8}
            y1={paths.nowEnd}
            x2={endX + 8}
            y2={paths.laterEnd}
            stroke={colors.textSecondary}
            strokeWidth={2}
          />
        ) : null}
      </Svg>
      <Text
        style={[styles.curveLabel, {left: endX + 16, top: paths.nowEnd - 22}]}
        numberOfLines={1}>
        Start now
      </Text>
      {twoCurves ? (
        <Text
          style={[styles.curveLabelQuiet, {left: endX + 16, top: paths.laterEnd + 4}]}
          numberOfLines={1}>
          {`Start in ${later} ${later === 1 ? 'year' : 'years'}`}
        </Text>
      ) : null}
      {twoCurves && paths.laterEnd - paths.nowEnd > 64 ? (
        <Text
          style={[
            styles.curveLabelQuiet,
            {left: endX + 16, top: Math.round((paths.nowEnd + paths.laterEnd) / 2) - 9},
          ]}
          numberOfLines={1}>
          {`Gap ${money(gap, cur)}`}
        </Text>
      ) : null}
      <Text style={[styles.axis, {left: chart.x, top: chart.y + chart.h + 6}]}>
        Today
      </Text>
      <Text
        style={[styles.axis, styles.axisEnd, {left: endX - 120, top: chart.y + chart.h + 6}]}
        numberOfLines={1}>
        {`In ${years} ${years === 1 ? 'year' : 'years'}`}
      </Text>

      <View style={[styles.quoteBlock, {top: chart.y + chart.h + 36}]}>
        {params.quote ? (
          <Text style={styles.quote} numberOfLines={1}>
            {`“${params.quote}”${
              hasVideo && params.quoteT !== null ? `  ${formatTime(params.quoteT)}` : ''
            }`}
          </Text>
        ) : null}
        <Text style={styles.caveat} numberOfLines={1}>
          An illustration at a fixed rate, not financial advice
        </Text>
      </View>

      <Text style={[styles.legend, {top: H - space.safeY - 40 + 11}]} numberOfLines={1}>
        ◀ ▶ Years   ·   ▲ ▼ Monthly amount   ·   OK Done
      </Text>
      <FocusFrame
        ref={doneRef}
        testID="growth-done"
        accessibilityLabel="Done, back to the map"
        variant="button"
        hasTVPreferredFocus
        style={[styles.action, {top: H - space.safeY - 40}]}
        contentStyle={styles.actionInner}
        onPress={onDone}>
        {(focused) => (
          <Text style={[styles.actionText, focused && styles.onFocus]}>Done</Text>
        )}
      </FocusFrame>
    </View>
  );
};

const Total = ({label, value}: {label: string; value: string}) => (
  <View style={styles.total}>
    <Text style={styles.totalLabel} numberOfLines={1}>
      {label}
    </Text>
    <Text style={styles.totalValue} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  root: {...StyleSheet.absoluteFillObject, backgroundColor: colors.black},
  source: {
    ...type.caption,
    position: 'absolute',
    left: space.safeX,
    right: space.safeX,
    top: space.safeY,
    color: colors.textSecondary,
  },
  sub: {
    ...type.body,
    position: 'absolute',
    left: space.safeX,
    right: space.safeX,
    top: space.safeY + 24,
    color: colors.text,
  },
  totals: {
    position: 'absolute',
    left: space.safeX,
    right: space.safeX,
    top: space.safeY + 64,
    flexDirection: 'row',
  },
  total: {width: 260, marginRight: space.l},
  totalLabel: {...type.caption, color: colors.textSecondary},
  totalValue: {...type.title, ...numeric, color: colors.text, marginTop: 2},
  curveLabel: {...type.captionStrong, position: 'absolute', color: colors.text, width: 152},
  curveLabelQuiet: {
    ...type.caption,
    ...numeric,
    position: 'absolute',
    color: colors.textSecondary,
    width: 152,
  },
  axis: {...type.caption, position: 'absolute', color: colors.textTertiary},
  axisEnd: {width: 120, textAlign: 'right'},
  quoteBlock: {position: 'absolute', left: space.safeX, right: space.safeX},
  quote: {...type.body, color: colors.text},
  caveat: {...type.caption, color: colors.textTertiary, marginTop: 4},
  legend: {
    ...type.caption,
    position: 'absolute',
    left: space.safeX,
    color: colors.textSecondary,
  },
  action: {position: 'absolute', right: space.safeX},
  actionInner: {height: 40, paddingHorizontal: space.m, justifyContent: 'center'},
  actionText: {...type.bodyStrong, color: colors.text},
  onFocus: {color: colors.onFocus},
});
