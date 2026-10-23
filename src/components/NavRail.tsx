import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import Svg, {
  Defs,
  LinearGradient,
  Rect,
  Stop,
} from '@amazon-devices/react-native-svg';
import {Icon, IconName} from './Icon';
import {colors, motion, radius, space, type} from '../theme';

export type Tab = 'watch' | 'shared' | 'link';

const ITEMS: Array<{id: Tab; label: string; icon: IconName}> = [
  {id: 'watch', label: 'Home', icon: 'home'},
  {id: 'shared', label: 'Shared with you', icon: 'shared'},
  {id: 'link', label: 'Link a phone', icon: 'phone'},
];

const EXPANDED_W = 248;

interface Props {
  active: Tab;
  onSelect: (tab: Tab) => void;
}

// Left navigation rail, as on the big TV apps: icons only until the D-pad
// moves into it, then it expands with labels over a dark scrim. Focus always
// enters on the active section; SELECT switches section; RIGHT returns to the
// page without switching. Collapsed, the rail is only 72 dp wide so its
// focus rects never overlap page content (Cartesian focus stays predictable).
export const NavRail = ({active, onSelect}: Props) => {
  const [focusedId, setFocusedId] = useState<Tab | null>(null);
  const expanded = focusedId !== null;
  const reveal = useRef(new Animated.Value(0)).current;
  const activeRef = useRef<View>(null);
  // Moving between items fires blur then focus; defer the collapse so the rail
  // does not flicker shut (and change its focus rects) mid-move.
  const collapse = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusItem = (id: Tab) => {
    if (collapse.current) {
      clearTimeout(collapse.current);
      collapse.current = null;
    }
    setFocusedId(id);
  };
  const blurItem = () => {
    collapse.current = setTimeout(() => setFocusedId(null), 60);
  };
  useEffect(
    () => () => {
      if (collapse.current) {
        clearTimeout(collapse.current);
      }
    },
    [],
  );

  useEffect(() => {
    Animated.timing(reveal, {
      toValue: expanded ? 1 : 0,
      duration: motion.focusMs,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [expanded, reveal]);

  return (
    <>
      {/* Always-on soft shade so the collapsed icons read over bright art. */}
      <View pointerEvents="none" style={styles.scrim}>
        <Fade id="rail-rest" width={170} stops={[0.7, 0.35, 0]} />
      </View>
      {/* Expanded: a deep shade that falls off smoothly into the page. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.scrim, {opacity: reveal}]}>
        <Fade
          id="rail-open"
          width={EXPANDED_W + 260}
          stops={[0.94, 0.86, 0.5, 0]}
        />
      </Animated.View>

      <View style={[styles.rail, expanded && styles.railExpanded]}>
        <View style={styles.logo}>
          <Text style={styles.logoX}>X</Text>
        </View>

        <TVFocusGuideView
          destinations={activeRef.current ? [activeRef.current] : undefined}
          trapFocusUp
          trapFocusDown
          trapFocusLeft
          style={styles.items}>
          {ITEMS.map((item) => {
            const isActive = item.id === active;
            const isFocused = item.id === focusedId;
            const tint = isFocused
              ? colors.onFocus
              : isActive
              ? colors.text
              : colors.textTertiary;
            return (
              <Pressable
                key={item.id}
                ref={isActive ? activeRef : undefined}
                testID={`nav-${item.id}`}
                accessibilityRole="tab"
                accessibilityState={{selected: isActive}}
                accessibilityLabel={item.label}
                onFocus={() => focusItem(item.id)}
                onBlur={blurItem}
                onPress={() => onSelect(item.id)}
                style={[
                  styles.item,
                  expanded && styles.itemExpanded,
                  isFocused && styles.itemFocused,
                ]}>
                <View
                  style={[styles.activeBar, isActive && styles.activeBarOn]}
                />
                <View style={styles.iconBox}>
                  <Icon name={item.icon} size={22} color={tint} />
                </View>
                {expanded && (
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.label,
                      isActive && styles.labelActive,
                      isFocused && styles.labelFocused,
                    ]}>
                    {item.label}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </TVFocusGuideView>
      </View>
    </>
  );
};

// Horizontal black fade drawn as one SVG rect: smooth, no hard band edges.
// `stops` are opacities spread evenly from the left edge to the right edge.
const Fade = ({
  id,
  width,
  stops,
}: {
  id: string;
  width: number;
  stops: number[];
}) => (
  <Svg width={width} height={540}>
    <Defs>
      <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
        {stops.map((o, i) => (
          <Stop
            key={i}
            offset={`${(i / (stops.length - 1)) * 100}%`}
            stopColor="#000000"
            stopOpacity={o}
          />
        ))}
      </LinearGradient>
    </Defs>
    <Rect x={0} y={0} width={width} height={540} fill={`url(#${id})`} />
  </Svg>
);

const styles = StyleSheet.create({
  scrim: {position: 'absolute', top: 0, bottom: 0, left: 0},
  rail: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: space.rail,
    paddingTop: space.safeY + 6,
  },
  railExpanded: {width: EXPANDED_W},
  logo: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingLeft: 26,
    height: 40,
  },
  logoX: {...type.title, fontWeight: '700', color: colors.brand},
  items: {marginTop: 92},
  item: {
    height: 44,
    width: 48,
    marginLeft: 12,
    marginBottom: 8,
    borderRadius: radius.row,
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemExpanded: {width: EXPANDED_W - 24},
  itemFocused: {backgroundColor: colors.text},
  activeBar: {position: 'absolute', left: -12, top: 10, bottom: 10, width: 3},
  activeBarOn: {backgroundColor: colors.text},
  iconBox: {width: 48, alignItems: 'center'},
  label: {...type.bodyStrong, color: colors.textSecondary, marginLeft: 6},
  labelActive: {color: colors.text},
  labelFocused: {color: colors.onFocus},
});
