import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, Text, View} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {colors} from '../theme';

interface Props {
  onDone: () => void;
}

const SKIP_KEYS = new Set(['select', 'enter', 'playpause']);

// Placeholder opening sting (~2.8 s). Pure Animated transforms and opacity on
// the native driver: no video decoder, no images, nothing left running after
// it finishes. SELECT skips; BACK is routed by App.
export const Intro = ({onDone}: Props) => {
  const v = useRef({
    word: new Animated.Value(0),
    ghost: new Animated.Value(0),
    ghostX: new Animated.Value(9),
    x: new Animated.Value(0),
    xScale: new Animated.Value(1.8),
    crack: new Animated.Value(0),
    flash: new Animated.Value(0),
    tag: new Animated.Value(0),
    root: new Animated.Value(1),
  }).current;
  const done = useRef(false);
  const finish = useRef(() => {
    if (!done.current) {
      done.current = true;
      onDone();
    }
  }).current;

  useTVEventHandler((evt) => {
    if (SKIP_KEYS.has(evt.eventType) && evt.eventKeyAction !== 1) {
      finish();
    }
  });

  useEffect(() => {
    const t = (
      val: Animated.Value,
      toValue: number,
      duration: number,
      easing = Easing.out(Easing.cubic),
    ) =>
      Animated.timing(val, {toValue, duration, easing, useNativeDriver: true});

    const anim = Animated.sequence([
      Animated.delay(300),
      Animated.parallel([
        t(v.word, 1, 520),
        Animated.sequence([
          t(v.ghost, 0.85, 40),
          t(v.ghostX, -5, 70, Easing.linear),
          t(v.ghostX, 3, 70, Easing.linear),
          t(v.ghostX, -2, 70, Easing.linear),
          t(v.ghostX, 0, 70, Easing.linear),
          t(v.ghost, 0, 260),
        ]),
      ]),
      Animated.parallel([t(v.x, 1, 60), t(v.xScale, 1, 170)]),
      Animated.parallel([
        t(v.crack, 1, 200, Easing.out(Easing.exp)),
        Animated.sequence([t(v.flash, 0.16, 40), t(v.flash, 0, 220)]),
      ]),
      t(v.tag, 1, 320),
      Animated.delay(700),
      t(v.root, 0, 450, Easing.in(Easing.quad)),
    ]);
    anim.start(({finished}) => finished && finish());
    return () => anim.stop();
  }, [v, finish]);

  return (
    <Animated.View
      style={[styles.root, {opacity: v.root}]}
      accessible
      accessibilityLabel="StudioX">
      <View style={styles.lockup}>
        <View>
          <Animated.Text
            style={[
              styles.word,
              styles.ghost,
              {opacity: v.ghost, transform: [{translateX: v.ghostX}]},
            ]}>
            STUDIO
          </Animated.Text>
          <Animated.Text style={[styles.word, {opacity: v.word}]}>
            STUDIO
          </Animated.Text>
        </View>
        <Animated.Text
          style={[
            styles.word,
            styles.x,
            {opacity: v.x, transform: [{scale: v.xScale}]},
          ]}>
          X
        </Animated.Text>
      </View>
      <Animated.View
        style={[
          styles.crack,
          {transform: [{rotate: '-14deg'}, {scaleX: v.crack}]},
        ]}
      />
      <Animated.Text style={[styles.tag, {opacity: v.tag}]}>
        PODCASTS · WATCHED WITH YOU
      </Animated.Text>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.flash, {opacity: v.flash}]}
      />
      <Text style={styles.skip}>Press OK to skip</Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockup: {flexDirection: 'row', alignItems: 'center'},
  word: {
    color: colors.text,
    fontSize: 64,
    fontWeight: '700',
    letterSpacing: 14,
  },
  ghost: {position: 'absolute', color: colors.brand},
  x: {color: colors.brand, letterSpacing: 0},
  crack: {
    position: 'absolute',
    width: 560,
    height: 1,
    backgroundColor: colors.text,
    opacity: 0.55,
  },
  tag: {
    position: 'absolute',
    bottom: '30%',
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 3,
  },
  flash: {backgroundColor: colors.text},
  skip: {
    position: 'absolute',
    bottom: 27,
    right: 48,
    color: colors.textTertiary,
    fontSize: 12,
  },
});
