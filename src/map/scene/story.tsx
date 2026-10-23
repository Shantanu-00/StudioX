import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from '@amazon-devices/react-native-reanimated';

// "Play the story": a pulse walks the map node by node in story order and
// each node lights up with its caption. It never starts by itself; any key
// pauses it.
//
// One JS timer paces the steps (one state change per node, about every
// 1.6 s, never per frame); the pulse itself is a Reanimated shared value on
// the UI thread. There is at most one timer and one running timing at a
// time, and both stop on pause, when the screen loses focus (sheet, sim,
// step mode, background) and on unmount.

export const STEP_MS = 1600;
export const PULSE_MS = 700;
// A key that arrives this soon after Play is the same press, not a pause.
const DEBOUNCE_MS = 350;

export type StoryStatus = 'idle' | 'playing' | 'paused' | 'done';
export interface StoryState {
  status: StoryStatus;
  index: number; // the lit node in the story order, -1 when idle
}

const IDLE: StoryState = {status: 'idle', index: -1};

export function useStory(count: number, active: boolean) {
  const [state, setState] = useState<StoryState>(IDLE);
  const ref = useRef<StoryState>(IDLE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the viewer last started or paused it: a second event for the same
  // press (the key handler and the button both see it) is ignored.
  const pressedAt = useRef(0);
  const set = useCallback((s: StoryState) => {
    ref.current = s;
    setState(s);
  }, []);
  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const schedule = useCallback(
    (index: number) => {
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        if (index + 1 < count) {
          set({status: 'playing', index: index + 1});
          schedule(index + 1);
        } else {
          set({status: 'done', index});
        }
      }, STEP_MS);
    },
    [clear, count, set],
  );

  const pause = useCallback(() => {
    if (ref.current.status !== 'playing') {
      return;
    }
    clear();
    pressedAt.current = Date.now();
    set({status: 'paused', index: ref.current.index});
  }, [clear, set]);

  const stop = useCallback(() => {
    clear();
    if (ref.current.status !== 'idle') {
      set(IDLE);
    }
  }, [clear, set]);

  // The Play control: start, resume where it paused, or play again.
  const play = useCallback(() => {
    const s = ref.current;
    const since = Date.now() - pressedAt.current;
    if (count === 0 || s.status === 'playing') {
      if (s.status === 'playing' && since > DEBOUNCE_MS) {
        pause();
      }
      return;
    }
    if (s.status === 'paused' && since < DEBOUNCE_MS) {
      return; // this press already paused it (the key arrived first)
    }
    const from = s.status === 'paused' && s.index >= 0 ? s.index : 0;
    pressedAt.current = Date.now();
    set({status: 'playing', index: from});
    schedule(from);
  }, [count, pause, schedule, set]);

  // Any key: pause a playing story; dismiss a finished one.
  const onKey = useCallback(() => {
    const s = ref.current;
    if (Date.now() - pressedAt.current < DEBOUNCE_MS) {
      return;
    }
    if (s.status === 'playing') {
      pause();
    } else if (s.status === 'done') {
      stop();
    }
  }, [pause, stop]);

  useEffect(() => {
    if (!active) {
      pause();
    }
  }, [active, pause]);
  // The story order changed under it (the map relaid out): start over.
  useEffect(() => stop, [count, stop]);
  useEffect(() => clear, [clear]);

  return {state, play, pause, stop, onKey};
}

// The pulse: a dot in the theme accent that travels the path from the
// previous node to the lit one. `path` is flat [x0, y0, x1, y1, …] in dp.
export const StoryPulse = ({
  path,
  step,
  running,
  color,
  halo,
}: {
  path: number[];
  step: number;
  running: boolean;
  color: string;
  halo: string;
}) => {
  const pts = useSharedValue<number[]>(path);
  const t = useSharedValue(0);
  useEffect(() => {
    pts.value = path;
    cancelAnimation(t);
    t.value = 0;
    if (running && path.length >= 4) {
      t.value = withTiming(1, {duration: PULSE_MS, easing: Easing.inOut(Easing.cubic)});
    }
    return () => cancelAnimation(t);
    // `path` is recomputed per step; `step` is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, running]);
  const style = useAnimatedStyle(() => {
    const p = pts.value;
    if (p.length < 4) {
      return {opacity: 0, transform: [{translateX: 0}, {translateY: 0}]};
    }
    let total = 0;
    for (let i = 2; i < p.length; i += 2) {
      total += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    }
    let left = t.value * total;
    let x = p[0];
    let y = p[1];
    for (let i = 2; i < p.length; i += 2) {
      const seg = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
      if (left <= seg || i === p.length - 2) {
        const f = seg > 0 ? Math.min(1, left / seg) : 1;
        x = p[i - 2] + (p[i] - p[i - 2]) * f;
        y = p[i - 1] + (p[i + 1] - p[i - 1]) * f;
        break;
      }
      left -= seg;
    }
    // Fades in as it leaves and out as it arrives.
    const o = Math.min(1, t.value * 6, (1 - t.value) * 6);
    return {
      opacity: o,
      transform: [{translateX: x - HALO / 2}, {translateY: y - HALO / 2}],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.pulse, style]} testID="map-pulse">
      <View style={[styles.halo, {backgroundColor: halo}]} />
      <View style={[styles.dot, {backgroundColor: color}]} />
    </Animated.View>
  );
};

const HALO = 24;
const DOT = 10;

const styles = StyleSheet.create({
  pulse: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: HALO,
    height: HALO,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: HALO,
    height: HALO,
    borderRadius: HALO / 2,
  },
  dot: {width: DOT, height: DOT, borderRadius: DOT / 2},
});
