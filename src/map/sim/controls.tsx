import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleProp, StyleSheet, Text, View, ViewStyle} from 'react-native';
import {useKeplerAppStateManager} from '@amazon-devices/react-native-kepler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from '@amazon-devices/react-native-reanimated';
import {FocusFrame, NextFocus} from '../../components/FocusFrame';
import {Icon, IconName} from '../../components/Icon';
import {colors, numeric, radius, space, type} from '../../theme';
import {focusSoon} from '../focus';
import {MapTheme} from '../themes';

// The controls both simulations share: value rows the remote changes with
// LEFT/RIGHT, buttons, explicit D-pad neighbours, and a background hook.

type Dir = 'up' | 'down' | 'left' | 'right';

// Mounted host instances by key, for explicit neighbours (one render after
// mount passes them on), and deterministic first focus.
export function useFocusRefs<K extends string>(first: K) {
  const refs = useRef(new Map<K, View>());
  const setters = useRef(new Map<K, (v: View | null) => void>());
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setTick((x) => x + 1), 0);
    focusSoon(refs.current.get(first));
    return () => clearTimeout(t);
  }, [first]);
  const register = useCallback((k: K) => {
    let f = setters.current.get(k);
    if (!f) {
      f = (v: View | null) => {
        if (v) {
          refs.current.set(k, v);
        } else {
          refs.current.delete(k);
        }
      };
      setters.current.set(k, f);
    }
    return f;
  }, []);
  // Unlisted directions are blocked (the frame's own instance), so LEFT and
  // RIGHT on a value row change the value instead of moving focus.
  const next = (self: K, nb: Partial<Record<Dir, K>>): NextFocus => {
    const get = (k?: K) => (k ? refs.current.get(k) : undefined);
    const s = get(self);
    return {
      up: get(nb.up) ?? s,
      down: get(nb.down) ?? s,
      left: get(nb.left) ?? s,
      right: get(nb.right) ?? s,
    };
  };
  return {register, next};
}

// Calls `onLeave` when the app leaves the foreground.
export function useOnBackground(onLeave: () => void) {
  const appState = useKeplerAppStateManager();
  const cb = useRef(onLeave);
  cb.current = onLeave;
  useEffect(() => {
    const sub = appState.addAppStateListener('change', (next) => {
      if (next !== 'active') {
        cb.current();
      }
    });
    return () => sub.remove();
  }, [appState]);
}

interface ValueProps {
  testID: string;
  label: string;
  value: string;
  // Under the value on a tile: the delta after a change, else a hint.
  note?: string;
  noteStrong?: boolean;
  accessibilityLabel: string;
  theme: MapTheme;
  size: 'row' | 'tile';
  // The last change's counter when this control made it, else null: the
  // control keeps an accent ring and flashes once per change.
  changedSeq: number | null;
  nextFocus: NextFocus;
  hasTVPreferredFocus?: boolean;
  onFocus: () => void;
  style?: StyleProp<ViewStyle>;
}

const FLASH_MS = 300;
const TRANSPARENT = 'transparent';

// A value the remote changes. Focused: the app's white fill with ◀ ▶ beside
// the value. Changed: an accent ring and a short accent flash.
export const ValueControl = React.forwardRef<View, ValueProps>(
  (
    {
      testID,
      label,
      value,
      note,
      noteStrong,
      accessibilityLabel,
      theme,
      size,
      changedSeq,
      nextFocus,
      hasTVPreferredFocus,
      onFocus,
      style,
    },
    ref,
  ) => {
    const flash = useSharedValue(0);
    useEffect(() => {
      if (changedSeq !== null) {
        flash.value = 0.55;
        flash.value = withTiming(0, {duration: FLASH_MS, easing: Easing.out(Easing.quad)});
      }
    }, [changedSeq, flash]);
    const flashStyle = useAnimatedStyle(() => ({opacity: flash.value}));
    const changed = changedSeq !== null;
    const tile = size === 'tile';
    return (
      <FocusFrame
        ref={ref}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        variant="row"
        hasTVPreferredFocus={hasTVPreferredFocus}
        nextFocus={nextFocus}
        onFocus={onFocus}
        style={style}
        contentStyle={[
          tile ? styles.tile : styles.row,
          changed
            ? {backgroundColor: theme.accentSoft, borderColor: theme.accent}
            : {backgroundColor: theme.surface, borderColor: TRANSPARENT},
        ]}>
        {(focused) => {
          const ink = focused ? colors.onFocus : theme.ink;
          const soft = focused ? colors.onFocus : theme.inkSoft;
          const arrows = {color: ink, opacity: focused ? 1 : 0};
          const valueRow = (
            <View style={styles.valueRow}>
              <Text style={[styles.arrow, arrows]}>◀</Text>
              <Text style={[tile ? styles.tileValue : styles.rowValue, {color: ink}]}>
                {value}
              </Text>
              <Text style={[styles.arrow, arrows]}>▶</Text>
            </View>
          );
          return (
            <>
              <Animated.View
                pointerEvents="none"
                style={[styles.flash, {backgroundColor: theme.accent}, flashStyle]}
              />
              {tile ? (
                <>
                  <Text style={[styles.tileLabel, {color: soft}]}>{label}</Text>
                  {valueRow}
                  {note ? (
                    <Text
                      style={[
                        noteStrong ? styles.noteStrong : styles.note,
                        {color: noteStrong ? ink : soft},
                      ]}>
                      {note}
                    </Text>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={[styles.rowLabel, {color: ink}]}>{label}</Text>
                  {valueRow}
                </>
              )}
            </>
          );
        }}
      </FocusFrame>
    );
  },
);

interface ButtonProps {
  testID: string;
  label: string;
  icon?: IconName;
  accessibilityLabel: string;
  nextFocus: NextFocus;
  onFocus: () => void;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export const SimButton = React.forwardRef<View, ButtonProps>(
  ({testID, label, icon, accessibilityLabel, nextFocus, onFocus, onPress, style}, ref) => (
    <FocusFrame
      ref={ref}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      variant="button"
      nextFocus={nextFocus}
      onFocus={onFocus}
      onPress={onPress}
      style={style}
      contentStyle={styles.button}>
      {(focused) => (
        <>
          {icon ? (
            <View style={styles.buttonIcon}>
              <Icon name={icon} size={18} color={focused ? colors.onFocus : colors.text} />
            </View>
          ) : null}
          <Text style={[styles.buttonText, {color: focused ? colors.onFocus : colors.text}]}>
            {label}
          </Text>
        </>
      )}
    </FocusFrame>
  ),
);

const styles = StyleSheet.create({
  row: {
    height: 34,
    paddingHorizontal: space.s,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.row,
    borderWidth: 2,
    overflow: 'hidden',
  },
  tile: {
    paddingHorizontal: space.s,
    paddingVertical: 6,
    borderRadius: radius.row,
    borderWidth: 2,
    overflow: 'hidden',
  },
  flash: {...StyleSheet.absoluteFillObject, borderRadius: radius.row - 2},
  rowLabel: {...type.body},
  rowValue: {...type.bodyStrong, ...numeric, minWidth: 56, textAlign: 'center'},
  tileLabel: {...type.caption},
  tileValue: {...type.title, ...numeric, textAlign: 'center'},
  valueRow: {flexDirection: 'row', alignItems: 'center'},
  arrow: {...type.caption, marginHorizontal: 6},
  note: {...type.caption},
  noteStrong: {...type.captionStrong},
  button: {
    height: 36,
    paddingHorizontal: space.m,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonIcon: {marginRight: 6},
  buttonText: {...type.bodyStrong},
});
