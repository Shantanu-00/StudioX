import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from '@amazon-devices/react-native-reanimated';
import Svg, {Circle, Path} from '@amazon-devices/react-native-svg';
import {formatTime} from '../analysis/composer';
import {NightParams} from '../analysis/schema';
import {FocusFrame} from '../components/FocusFrame';
import {colors, numeric, radius, space, type} from '../theme';
import {useFocusOnMount} from './focus';
import {
  BEDTIME_STEP,
  clock,
  CYCLES_MAX,
  hoursAndMinutes,
  nightHeadline,
  nightPlan,
} from './sims';
import {SendStatus, sendLabel} from './useMapActions';
import {nightReminderCard} from './mapData';
import {PhoneCard} from '../services/api';

interface Props {
  title: string;
  params: NightParams;
  source: string; // the episode or cameo it comes from
  hasVideo: boolean;
  paired: boolean;
  sendStatus: SendStatus;
  onSend: (card: PhoneCard) => void;
  onDone: () => void;
}

const SNAP_MS = 250;
const GAP = 4;
const MOON_R = 14;

// A crescent: the lit disc minus a second disc offset to one side, drawn as
// one path from the two circles' intersection points (outer arc, then the
// inner arc back), so it needs no mask.
export function crescentPath(cx: number, cy: number, r: number) {
  const d = r * 0.62; // centre offset of the shadow disc (same radius)
  // Two equal circles at distance d intersect at x = cx + d/2.
  const ix = cx + d / 2;
  const iy = Math.sqrt(r * r - (d / 2) * (d / 2));
  const f = (n: number) => Math.round(n * 100) / 100;
  return `M${f(ix)} ${f(cy - iy)} A${r} ${r} 0 1 0 ${f(ix)} ${f(cy + iy)} A${r} ${r} 0 0 1 ${f(ix)} ${f(cy - iy)} Z`;
}

// "Plan your night": the guest's rule, paced by the viewer. Nothing moves
// on its own; each press redraws the plan and the wake marker settles at
// the end of the last cycle in 250 ms.
export const NightSim = ({
  title,
  params,
  source,
  hasVideo,
  paired,
  sendStatus,
  onSend,
  onDone,
}: Props) => {
  const win = useWindowDimensions();
  const W = Math.round(win.width);
  const H = Math.round(win.height);
  const [bedtime, setBedtime] = useState(params.bedtime);
  const [cycles, setCycles] = useState(params.cycles);
  const plan = useMemo(
    () => nightPlan(bedtime, cycles, params.cycleMinutes),
    [bedtime, cycles, params.cycleMinutes],
  );

  const barX = space.safeX;
  const barW = W - 2 * space.safeX;
  // Six cycles fill the bar; fewer end earlier, where you wake.
  const cellW = Math.floor((barW - (CYCLES_MAX - 1) * GAP) / CYCLES_MAX);
  const endOf = (n: number) => n * (cellW + GAP) - GAP;
  const width = useSharedValue(endOf(plan.cycles));
  useEffect(() => {
    width.value = withTiming(endOf(plan.cycles), {
      duration: SNAP_MS,
      easing: Easing.out(Easing.cubic),
    });
    // endOf depends only on cellW, which follows the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.cycles, cellW, width]);
  const reveal = useAnimatedStyle(() => ({width: Math.round(width.value)}));
  const follow = useAnimatedStyle(() => ({
    transform: [{translateX: Math.round(width.value)}],
  }));

  useTVEventHandler((evt) => {
    if (evt.eventKeyAction === 1) {
      return;
    }
    switch (evt.eventType) {
      case 'left':
        setBedtime((b) => nightPlan(b - BEDTIME_STEP, cycles, params.cycleMinutes).bedtime);
        break;
      case 'right':
        setBedtime((b) => nightPlan(b + BEDTIME_STEP, cycles, params.cycleMinutes).bedtime);
        break;
      case 'up':
        setCycles((c) => nightPlan(bedtime, c + 1, params.cycleMinutes).cycles);
        break;
      case 'down':
        setCycles((c) => nightPlan(bedtime, c - 1, params.cycleMinutes).cycles);
        break;
    }
  });

  const actionRef = useFocusOnMount<View>(true);
  const SKY_Y = 156;
  const BAR_Y = 224;
  const BAR_H = 48;
  const actionLabel = paired ? sendLabel(sendStatus) : 'Done';
  const legend = `◀ ▶ Bedtime   ·   ▲ ▼ Cycles   ·   OK ${
    paired ? 'Send to phone' : 'Done'
  }`;

  return (
    <View style={styles.root} testID="night-sim">
      <Text style={styles.source} numberOfLines={1}>
        {`${title} · ${source}`}
      </Text>
      <Text
        style={styles.headline}
        numberOfLines={1}
        accessibilityLiveRegion="polite"
        testID="night-headline">
        {nightHeadline(plan)}
      </Text>
      <Text style={styles.sub} numberOfLines={1}>
        {`${plan.cycles} cycles of ${plan.cycleMinutes} minutes · ${hoursAndMinutes(
          plan.sleepMinutes,
        )} of sleep`}
      </Text>

      {/* The sky: the moon over lights out, the sun over waking. */}
      <Svg
        width={MOON_R * 2 + 4}
        height={MOON_R * 2 + 4}
        style={[styles.abs, {left: barX, top: SKY_Y}]}>
        <Path
          d={crescentPath(MOON_R + 2, MOON_R + 2, MOON_R)}
          fill={colors.text}
        />
      </Svg>
      <Animated.View
        style={[styles.abs, {left: barX - 14, top: SKY_Y + 2}, follow]}
        pointerEvents="none">
        <Svg width={28} height={28}>
          <Circle cx={14} cy={14} r={12} fill={colors.text} />
        </Svg>
      </Animated.View>

      {/* The night bar, cut into its cycles. */}
      <Animated.View
        style={[styles.bar, {left: barX, top: BAR_Y, height: BAR_H}, reveal]}>
        {Array.from({length: CYCLES_MAX}, (_, i) => (
          <View
            key={i}
            style={[
              styles.cycle,
              {left: i * (cellW + GAP), width: cellW, height: BAR_H},
            ]}>
            <Text style={styles.cycleText} numberOfLines={1}>
              {`Cycle ${i + 1}`}
            </Text>
          </View>
        ))}
      </Animated.View>
      <Animated.View
        style={[styles.abs, {left: barX - 1, top: BAR_Y - 8}, follow]}
        pointerEvents="none">
        <View style={[styles.marker, {height: BAR_H + 16}]} />
      </Animated.View>
      <Text style={[styles.time, {left: barX, top: BAR_Y + BAR_H + space.s}]}>
        {`Lights out ${clock(plan.bedtime)}`}
      </Text>
      <Animated.View
        style={[styles.abs, {left: barX - 120, top: BAR_Y + BAR_H + space.s}, follow]}
        pointerEvents="none">
        <Text style={styles.wake} numberOfLines={1}>
          {`Wake ${clock(plan.wake)}`}
        </Text>
      </Animated.View>

      <View style={styles.quoteBlock}>
        {params.quote ? (
          <>
            <Text style={styles.quote} numberOfLines={2}>
              {`“${params.quote}”`}
            </Text>
            <Text style={styles.quoteBy} numberOfLines={1}>
              {hasVideo && params.quoteT !== null
                ? `The guest, at ${formatTime(params.quoteT)}`
                : 'From the conversation'}
            </Text>
          </>
        ) : null}
        <Text style={styles.caveat} numberOfLines={1}>
          A coaching rule, not medical advice
        </Text>
      </View>

      <Text style={[styles.legend, {top: H - space.safeY - 40 + 11}]} numberOfLines={1}>
        {legend}
      </Text>
      <FocusFrame
        ref={actionRef}
        testID="night-action"
        accessibilityLabel={
          paired
            ? `${actionLabel}: lights out ${clock(plan.bedtime)}, wake ${clock(plan.wake)}`
            : 'Done, back to the map'
        }
        variant="button"
        hasTVPreferredFocus
        style={[styles.action, {top: H - space.safeY - 40}]}
        contentStyle={styles.actionInner}
        onPress={() => {
          if (!paired) {
            onDone();
          } else if (sendStatus !== 'sending' && sendStatus !== 'sent') {
            onSend(nightReminderCard(plan, new Date()));
          }
        }}>
        {(focused) => (
          <Text style={[styles.actionText, focused && styles.onFocus]}>
            {actionLabel}
          </Text>
        )}
      </FocusFrame>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {...StyleSheet.absoluteFillObject, backgroundColor: colors.black},
  abs: {position: 'absolute'},
  source: {
    ...type.caption,
    position: 'absolute',
    left: space.safeX,
    right: space.safeX,
    top: space.safeY,
    color: colors.textSecondary,
  },
  headline: {
    ...type.title,
    ...numeric,
    position: 'absolute',
    left: space.safeX,
    right: space.safeX,
    top: space.safeY + 24,
    color: colors.text,
  },
  sub: {
    ...type.body,
    position: 'absolute',
    left: space.safeX,
    right: space.safeX,
    top: space.safeY + 58,
    color: colors.textSecondary,
  },
  bar: {position: 'absolute', overflow: 'hidden'},
  cycle: {
    position: 'absolute',
    top: 0,
    borderRadius: radius.row,
    backgroundColor: colors.track,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cycleText: {...type.caption, color: colors.text},
  marker: {width: 2, backgroundColor: colors.text, borderRadius: 1},
  time: {...type.caption, ...numeric, position: 'absolute', color: colors.textSecondary},
  wake: {
    ...type.captionStrong,
    ...numeric,
    width: 120,
    textAlign: 'right',
    color: colors.text,
  },
  quoteBlock: {position: 'absolute', left: space.safeX, right: space.safeX, top: 352},
  quote: {...type.body, color: colors.text},
  quoteBy: {...type.caption, color: colors.textSecondary, marginTop: 2},
  caveat: {...type.caption, color: colors.textTertiary, marginTop: space.s},
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
