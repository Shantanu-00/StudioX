import React, {useEffect, useState} from 'react';
import {Image, Pressable, StyleSheet, Text, View} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from '@amazon-devices/react-native-reanimated';
import Svg, {Path} from '@amazon-devices/react-native-svg';
import {ExploreNode} from '../../analysis/schema';
import {FocusFrame, NextFocus} from '../../components/FocusFrame';
import {Icon} from '../../components/Icon';
import {colors, motion, numeric, radius, space, type} from '../../theme';
import {VerdictWord} from '../../widgets/parts';
import {imageSource} from '../images';
import type {PlacedNode} from '../layout';
import type {MapTheme, Motif} from '../themes';
import {Glyph, glyphFor} from './Glyph';
import {CARD, cardCredit, NodeFace, showsVerdict, valueText} from './measure';

// One piece of the map, drawn in its scene:
// - caseboard: a pinned evidence card; locked, a face-down card taped "Not yet";
// - nightsky / signal / ledger / archive: a card in the scene's colours, with
//   its glyph, figure and bar, or photo and credit;
// - plain: the app's own button look (white fill on focus).
// On a scene, focus is a 2 dp white ring and a small lift with a shadow (a
// translate, never a scale, so nothing reflows and no text is resampled).
// While the story plays, the lit card takes the accent.

interface Props {
  node: ExploreNode;
  placed: PlacedNode;
  theme: MapTheme;
  locked: boolean;
  // Plain timeline: a locked event is a short box hugging the axis.
  compactLock: boolean;
  meta: string;
  lit: boolean;
  focusable: boolean;
  preferred: boolean;
  nextFocus: NextFocus;
  register: (id: string, v: View | null) => void;
  onPress: () => void;
  onFocus: () => void;
}

const LOCK_H = 48;

// Vega's Pressable implements nextFocus*, but its types omit them.
const focusProps = (n: NextFocus): object => ({
  nextFocusUp: n.up,
  nextFocusDown: n.down,
  nextFocusLeft: n.left,
  nextFocusRight: n.right,
});

export function nodeA11y(node: ExploreNode, meta: string, locked: boolean) {
  if (locked) {
    return 'Locked. Keep watching to unlock this piece.';
  }
  const verdict = showsVerdict(node) ? `. Verdict: ${node.verdict!.toLowerCase()}` : '';
  const value = node.value ? `. ${valueText(node.value)}` : '';
  return `${node.label}. ${meta}${verdict}${value}. Select to open.`;
}

export const NodeCard = (p: Props) =>
  p.theme.motif === 'plain' ? <PlainCard {...p} /> : <SceneCard {...p} />;

// ---- plain: the current look --------------------------------------------------

const PlainCard = ({
  node,
  placed,
  theme,
  locked,
  compactLock,
  meta,
  lit,
  focusable,
  preferred,
  nextFocus,
  register,
  onPress,
  onFocus,
}: Props) => {
  const short = locked && compactLock && placed.h > LOCK_H;
  const h = short ? LOCK_H : placed.h;
  const y = short && placed.side === 'above' ? placed.y + placed.h - LOCK_H : placed.y;
  return (
    <FocusFrame
      ref={(v) => register(node.id, v)}
      testID={`map-node-${node.id}`}
      accessibilityLabel={nodeA11y(node, meta, locked)}
      variant="button"
      focusable={focusable}
      hasTVPreferredFocus={preferred}
      nextFocus={nextFocus}
      style={[styles.node, {left: placed.x, top: y, width: placed.w, height: h}]}
      contentStyle={[
        styles.plainInner,
        {padding: placed.face.pad - 2},
        locked && styles.plainLocked,
        lit && {borderColor: theme.accent},
      ]}
      onFocus={onFocus}
      onPress={onPress}>
      {(focused) =>
        locked ? (
          <View style={styles.lockedRow}>
            <Icon name="lock" size={16} color={focused ? colors.onFocus : colors.textSecondary} />
            <Text style={[styles.lockedText, focused && styles.onFocus]}>Keep watching</Text>
          </View>
        ) : (
          <CardBody node={node} face={placed.face} meta={meta} motif="plain" theme={theme} onFill={focused} />
        )
      }
    </FocusFrame>
  );
};

// ---- the scenes -----------------------------------------------------------------

const SHAPE: Record<Exclude<Motif, 'plain'>, {radius: number; border: (t: MapTheme) => string}> = {
  caseboard: {radius: 4, border: () => 'rgba(255,255,255,0.10)'},
  nightsky: {radius: 12, border: (t) => t.line},
  signal: {radius: 10, border: (t) => t.line},
  ledger: {radius: 6, border: (t) => t.line},
  archive: {radius: 3, border: () => 'rgba(232,217,191,0.28)'},
};

const SceneCard = ({
  node,
  placed,
  theme,
  locked,
  meta,
  lit,
  focusable,
  preferred,
  nextFocus,
  register,
  onPress,
  onFocus,
}: Props) => {
  const [focused, setFocused] = useState(false);
  const lift = useSharedValue(0);
  const glow = useSharedValue(lit ? 1 : 0);
  useEffect(() => {
    glow.value = withTiming(lit ? 1 : 0, {duration: 300, easing: Easing.out(Easing.cubic)});
    return () => cancelAnimation(glow);
  }, [lit, glow]);
  useEffect(() => () => cancelAnimation(lift), [lift]);
  const liftStyle = useAnimatedStyle(() => ({
    transform: [{translateY: Math.round(-4 * lift.value)}],
  }));
  const glowStyle = useAnimatedStyle(() => ({opacity: glow.value}));
  const ease = {duration: motion.focusMs, easing: Easing.out(Easing.cubic)};
  const motif = theme.motif as Exclude<Motif, 'plain'>;
  const shape = SHAPE[motif];
  const caseboard = motif === 'caseboard';
  const faceDown = locked && caseboard;
  const pin = caseboard ? (placed.side === 'above' ? 'bottom' : 'top') : null;
  const border = focused ? theme.ring : lit ? theme.accent : shape.border(theme);
  return (
    <Pressable
      ref={(v: View | null) => register(node.id, v)}
      testID={`map-node-${node.id}`}
      accessibilityRole="button"
      accessibilityLabel={
        faceDown
          ? 'Not yet. A card face down: keep watching to turn it over.'
          : nodeA11y(node, meta, locked)
      }
      focusable={focusable}
      hasTVPreferredFocus={preferred}
      {...focusProps(nextFocus)}
      style={[styles.node, {left: placed.x, top: placed.y, width: placed.w, height: placed.h}]}
      onFocus={() => {
        setFocused(true);
        lift.value = withTiming(1, ease);
        onFocus();
      }}
      onBlur={() => {
        setFocused(false);
        lift.value = withTiming(0, ease);
      }}
      onPress={onPress}>
      <Animated.View
        style={[
          styles.sceneCard,
          {
            borderRadius: shape.radius,
            borderColor: border,
            backgroundColor: faceDown ? FACE_DOWN : theme.surface,
            padding: placed.face.pad - 2,
          },
          focused && styles.raised,
          liftStyle,
        ]}>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {backgroundColor: theme.accentSoft, borderRadius: shape.radius},
            glowStyle,
          ]}
        />
        {faceDown ? (
          <FaceDown theme={theme} w={placed.w} h={placed.h} />
        ) : locked ? (
          <View style={styles.lockedFill}>
            <View style={styles.lockedRow}>
              <Icon name="lock" size={16} color={theme.inkSoft} />
              <Text style={[styles.lockedText, {color: theme.inkSoft}]}>Keep watching</Text>
            </View>
          </View>
        ) : (
          <CardBody node={node} face={placed.face} meta={meta} motif={motif} theme={theme} onFill={false} />
        )}
        {pin ? <Pin at={pin} w={placed.w} h={placed.h} color={theme.accent} /> : null}
      </Animated.View>
    </Pressable>
  );
};

const FACE_DOWN = '#1E0A0C';
const TAPE = '#E9DFC4';

// The back of an evidence card: cross-hatched, with a strip of tape.
const FaceDown = ({theme, w, h}: {theme: MapTheme; w: number; h: number}) => {
  let d = '';
  for (let x = -h; x < w; x += 14) {
    d += `M${x} ${h}L${x + h} 0 `;
  }
  return (
    <>
      <Svg width={w - 4} height={h - 4} style={styles.hatch} pointerEvents="none">
        <Path d={d} stroke={theme.accent} strokeOpacity={0.16} strokeWidth={1} />
      </Svg>
      <View style={styles.tapeWrap} pointerEvents="none">
        <View style={styles.tape}>
          <Text style={styles.tapeText}>Not yet</Text>
        </View>
      </View>
    </>
  );
};

// A red map pin on the card's edge nearest the axis, where the string ties.
const Pin = ({at, w, h, color}: {at: 'top' | 'bottom'; w: number; h: number; color: string}) => (
  <View
    pointerEvents="none"
    style={[
      styles.pin,
      {backgroundColor: color, left: Math.round(w / 2) - PIN / 2 - 2, top: (at === 'top' ? 0 : h) - PIN / 2 - 2},
    ]}>
    <View style={styles.pinShine} />
  </View>
);
const PIN = 14;

// ---- the card's blocks, exactly as measured (scene/measure.ts) ------------------

export const CardBody = ({
  node,
  face,
  meta,
  motif,
  theme,
  onFill,
}: {
  node: ExploreNode;
  face: NodeFace;
  meta: string;
  motif: Motif;
  theme: MapTheme;
  // Drawn on the white focus fill (plain): black text.
  onFill: boolean;
}) => {
  const plain = motif === 'plain';
  const ink = onFill ? colors.onFocus : plain ? colors.text : theme.ink;
  const soft = onFill ? colors.onFocus : plain ? colors.textSecondary : theme.inkSoft;
  const glyphColor =
    motif === 'signal' ? theme.accent : motif === 'nightsky' ? theme.support : soft;
  const blocks: React.ReactNode[] = [];
  if (face.meta || face.glyph) {
    blocks.push(
      <View key="meta" style={styles.metaRow}>
        {face.glyph ? (
          <View style={styles.glyph}>
            <Glyph name={glyphFor(node)} size={CARD.glyph} color={glyphColor} />
          </View>
        ) : null}
        {face.meta ? (
          <Text style={[styles.meta, {color: soft}, onFill && styles.dim]}>{meta}</Text>
        ) : null}
        {face.meta && showsVerdict(node) ? (
          <>
            <Text style={[styles.meta, {color: soft}, onFill && styles.dim]}>{'  ·  '}</Text>
            <VerdictWord verdict={node.verdict ?? undefined} onFocus={onFill} />
          </>
        ) : null}
      </View>,
    );
  }
  if (face.value && node.value) {
    blocks.push(
      <Text key="value" style={[styles.value, {color: ink}]}>
        {valueText(node.value)}
      </Text>,
    );
  }
  blocks.push(
    <Text key="label" style={[face.small ? styles.labelSmall : styles.label, {color: ink}]}>
      {node.label}
    </Text>,
  );
  if (face.bar !== null) {
    blocks.push(
      <View key="bar" style={[styles.barTrack, {backgroundColor: theme.line}]}>
        <View
          style={[
            styles.barFill,
            {backgroundColor: theme.accent, width: `${Math.max(2, Math.round(face.bar * 100))}%`},
          ]}
        />
      </View>,
    );
  }
  const text = blocks.map((b, i) => (
    <View key={i} style={i ? styles.gap : null}>
      {b}
    </View>
  ));
  if (!(face.image && node.image)) {
    return <>{text}</>;
  }
  return (
    <>
      <View style={styles.thumbRow}>
        <Image
          source={imageSource(node.image.url)}
          style={styles.thumb}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          testID={`map-node-image-${node.id}`}
        />
        <View style={styles.thumbText}>{text}</View>
      </View>
      <Text style={[styles.credit, styles.gap, {color: soft}]}>
        {cardCredit(node.image.credit)}
      </Text>
    </>
  );
};

const styles = StyleSheet.create({
  node: {position: 'absolute'},
  plainInner: {
    flex: 1,
    borderRadius: radius.row,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  plainLocked: {justifyContent: 'center', backgroundColor: colors.panel},
  sceneCard: {flex: 1, borderWidth: 2},
  raised: {
    shadowColor: '#000000',
    shadowOpacity: 0.7,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 8},
    elevation: 10,
  },
  gap: {marginTop: CARD.gap},
  metaRow: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center'},
  glyph: {width: CARD.glyphW, height: CARD.glyph},
  meta: {...type.caption, ...numeric, flexShrink: 1},
  dim: {opacity: 0.62},
  value: {...type.title, ...numeric},
  label: {...type.bodyStrong},
  labelSmall: {...type.captionStrong},
  credit: {...type.caption},
  thumbRow: {flexDirection: 'row'},
  thumb: {width: CARD.thumb, height: CARD.thumb, borderRadius: 2, marginRight: CARD.thumbGap},
  thumbText: {flex: 1},
  barTrack: {height: CARD.barH, borderRadius: 3, overflow: 'hidden'},
  barFill: {height: CARD.barH, borderRadius: 3},
  lockedFill: {flex: 1, justifyContent: 'center'},
  lockedRow: {flexDirection: 'row', alignItems: 'center'},
  lockedText: {...type.caption, color: colors.textSecondary, marginLeft: space.xs},
  onFocus: {color: colors.onFocus},
  hatch: {position: 'absolute', left: 0, top: 0},
  tapeWrap: {...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center'},
  tape: {backgroundColor: TAPE, paddingHorizontal: space.s, paddingVertical: 3, borderRadius: 2},
  tapeText: {...type.captionStrong, color: '#141414'},
  pin: {
    position: 'absolute',
    width: PIN,
    height: PIN,
    borderRadius: PIN / 2,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.45)',
  },
  pinShine: {
    position: 'absolute',
    left: 3,
    top: 2,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
});
