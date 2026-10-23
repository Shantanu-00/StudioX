import React, {useEffect} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from '@amazon-devices/react-native-reanimated';
import {TechniqueWidget} from '../analysis/schema';
import {colors, type} from '../theme';
import {WidgetShell, styles as p} from './parts';

// Demonstrations driven by an agent-written spec, animated on the UI thread
// with Reanimated so the JS thread stays free for remote input.
// `bars`: phases fill one after another (e.g. R90 sleep cycles).
// `box`: a dot travels a square, one edge per phase (e.g. box breathing).

// Real durations are compressed so a cycle is watchable: 15 min → 1 s.
const SECONDS_PER_REAL_SECOND = 900;

export const TechniqueCard = ({w}: {w: TechniqueWidget}) => {
  const progress = useSharedValue(0);
  const n = w.phases.length;
  const loopMs =
    w.shape === 'bars'
      ? w.phases.reduce(
          (s, ph) => s + ph.seconds / SECONDS_PER_REAL_SECOND,
          0,
        ) * 1000
      : w.phases.reduce((s, ph) => s + ph.seconds, 0) * 1000;

  useEffect(() => {
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(n, {duration: Math.max(1000, loopMs), easing: Easing.linear}),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [progress, n, loopMs]);

  return (
    <WidgetShell kind="TECHNIQUE" title={w.title}>
      <View
        style={styles.stage}
        accessible
        accessibilityLabel={`${w.title}. ${w.phases
          .map((ph) => ph.label)
          .join(', ')}. ${w.caption}`}>
        {w.shape === 'bars' ? (
          <View style={styles.bars}>
            {w.phases.map((ph, i) => (
              <Bar
                key={ph.label}
                index={i}
                label={ph.label}
                progress={progress}
              />
            ))}
          </View>
        ) : (
          <BoxPath
            phases={w.phases.map((ph) => ph.label)}
            progress={progress}
          />
        )}
      </View>
      <Text style={[p.secondary, styles.caption]}>{w.caption}</Text>
    </WidgetShell>
  );
};

const Bar = ({
  index,
  label,
  progress,
}: {
  index: number;
  label: string;
  progress: SharedValue<number>;
}) => {
  const fill = useAnimatedStyle(() => ({
    width: `${Math.min(1, Math.max(0, progress.value - index)) * 100}%`,
  }));
  return (
    <View style={styles.barCol}>
      <View style={styles.barTrack}>
        <Animated.View style={[styles.barFill, fill]} />
      </View>
      <Text style={styles.barLabel}>{label.replace('Cycle ', 'C')}</Text>
    </View>
  );
};

const SIDE = 64;

const BoxPath = ({
  phases,
  progress,
}: {
  phases: string[];
  progress: SharedValue<number>;
}) => {
  // Edge order: top (left→right), right (down), bottom (right→left), left (up).
  const dot = useAnimatedStyle(() => {
    const edge = Math.floor(progress.value) % 4;
    const f = progress.value - Math.floor(progress.value);
    const d = f * SIDE;
    const pos =
      edge === 0
        ? {x: d, y: 0}
        : edge === 1
        ? {x: SIDE, y: d}
        : edge === 2
        ? {x: SIDE - d, y: SIDE}
        : {x: 0, y: SIDE - d};
    // Whole dp steps keep the dot's edge crisp.
    return {
      transform: [
        {translateX: Math.round(pos.x) - 4},
        {translateY: Math.round(pos.y) - 4},
      ],
    };
  });
  return (
    <View style={styles.boxWrap}>
      <View style={styles.box} />
      <Animated.View style={[styles.dot, dot]} />
      <Text style={[styles.edge, styles.edgeTop]}>{phases[0]}</Text>
      <Text style={[styles.edge, styles.edgeRight]}>{phases[1]}</Text>
      <Text style={[styles.edge, styles.edgeBottom]}>{phases[2]}</Text>
      <Text style={[styles.edge, styles.edgeLeft]}>{phases[3]}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  stage: {paddingHorizontal: 6, paddingTop: 4},
  bars: {flexDirection: 'row'},
  barCol: {flex: 1, marginRight: 6},
  barTrack: {
    height: 14,
    borderRadius: 3,
    backgroundColor: colors.track,
    overflow: 'hidden',
  },
  barFill: {height: '100%', backgroundColor: colors.text},
  barLabel: {...type.caption, color: colors.textTertiary, marginTop: 4},
  caption: {marginLeft: 6, marginTop: 6},
  boxWrap: {
    width: SIDE + 120,
    height: SIDE + 34,
    alignSelf: 'center',
    paddingLeft: 60,
    paddingTop: 16,
  },
  box: {
    width: SIDE,
    height: SIDE,
    borderWidth: 2,
    borderColor: colors.textTertiary,
    borderRadius: 4,
  },
  dot: {
    position: 'absolute',
    left: 60,
    top: 16,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.text,
  },
  edge: {...type.caption, position: 'absolute', color: colors.textSecondary},
  edgeTop: {top: 0, left: 60, width: SIDE, textAlign: 'center'},
  edgeRight: {top: 16 + SIDE / 2 - 8, left: 60 + SIDE + 6},
  edgeBottom: {top: 16 + SIDE + 2, left: 60, width: SIDE, textAlign: 'center'},
  edgeLeft: {top: 16 + SIDE / 2 - 8, left: 0, width: 54, textAlign: 'right'},
});
