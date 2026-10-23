import React, {forwardRef, ReactNode, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleProp,
  StyleSheet,
  ViewStyle,
  View,
} from 'react-native';
import {colors, motion, radius} from '../theme';

type Variant = 'card' | 'button' | 'row';

interface Props {
  testID: string;
  accessibilityLabel: string;
  onPress?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  hasTVPreferredFocus?: boolean;
  // Outer layout (size, margins) on `style`; inner padding/alignment on
  // `contentStyle`. The frame never grows beyond its content.
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  variant?: Variant;
  // False takes the frame out of the focus order (e.g. under a sheet).
  focusable?: boolean;
  // Explicit D-pad neighbours (Vega focus props nextFocusUp/Down/Left/Right):
  // a mounted host instance or a node handle. The frame's own instance
  // blocks that direction.
  nextFocus?: NextFocus;
  children: (focused: boolean) => ReactNode;
}

type FocusTarget = View | number;
export interface NextFocus {
  up?: FocusTarget;
  down?: FocusTarget;
  left?: FocusTarget;
  right?: FocusTarget;
}

// Vega's Pressable implements the nextFocus* props (react-native-kepler
// Pressable.js resolves an instance or a handle to a tag), but its
// TypeScript types omit them, so they are passed through untyped.
const focusProps = (n?: NextFocus): object =>
  n
    ? {
        nextFocusUp: n.up,
        nextFocusDown: n.down,
        nextFocusLeft: n.left,
        nextFocusRight: n.right,
      }
    : {};

// One focus language for the whole app, after tvOS:
// - row:    a text row. No fill at rest; focused it fills solid #F5F5F7 with
//           radius 12 and its text turns black (children read `focused`).
//           Never scaled, so text stays pixel-sharp.
// - button: the same focus as a row, with a quiet resting surface so it
//           reads as an action before it is focused.
// - card:   image-only tiles (posters, portraits): scale 1.08 with a soft
//           shadow. Put only artwork inside; labels sit outside the scaled
//           layer, because the compositor resamples scaled text.
// Scale runs on the native driver, 200 ms ease-out; fills change at once.
export const FocusFrame = forwardRef<View, Props>(
  (
    {
      testID,
      accessibilityLabel,
      onPress,
      onFocus,
      onBlur,
      hasTVPreferredFocus,
      style,
      contentStyle,
      variant = 'row',
      focusable,
      nextFocus,
      children,
    },
    ref,
  ) => {
    const [focused, setFocused] = useState(false);
    const scale = useRef(new Animated.Value(1)).current;
    const to = (v: number) =>
      Animated.timing(scale, {
        toValue: v,
        duration: motion.focusMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    const lift = variant === 'card' ? 1.08 : 1;

    return (
      <Pressable
        ref={ref}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hasTVPreferredFocus={hasTVPreferredFocus}
        focusable={focusable}
        {...focusProps(nextFocus)}
        style={style}
        onPress={onPress}
        onFocus={() => {
          setFocused(true);
          if (lift !== 1) {
            to(lift);
          }
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          if (lift !== 1) {
            to(1);
          }
          onBlur?.();
        }}>
        <Animated.View
          style={[
            styles[variant],
            contentStyle,
            focused && focusedStyles[variant],
            lift !== 1 && {transform: [{scale}]},
          ]}>
          {children(focused)}
        </Animated.View>
      </Pressable>
    );
  },
);

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.row,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  button: {
    borderRadius: radius.row,
    backgroundColor: colors.card,
  },
  row: {
    borderRadius: radius.row,
    backgroundColor: 'transparent',
  },
});

const focusedStyles = StyleSheet.create({
  card: {
    shadowColor: colors.black,
    shadowOpacity: 0.6,
    shadowRadius: 16,
    shadowOffset: {width: 0, height: 8},
    elevation: 8,
  },
  button: {backgroundColor: colors.text},
  row: {backgroundColor: colors.text},
});
