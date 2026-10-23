import React, {useEffect, useRef} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from '@amazon-devices/react-native-reanimated';
import {Explore, ExploreNode} from '../../analysis/schema';
import {FocusFrame} from '../../components/FocusFrame';
import {Icon} from '../../components/Icon';
import {colors, motion, numeric, radius, space, type} from '../../theme';
import {VerdictWord} from '../../widgets/parts';
import {useFocusOnMount} from '../focus';
import {imageSource} from '../images';
import {isLocked, Rect, TOGGLE_ID} from '../layout';
import type {MapTheme} from '../themes';
import {Glyph, glyphFor} from './Glyph';
import {
  creditText,
  isNumber,
  linesHeight,
  nodeMeta,
  showsVerdict,
  SizeName,
  valueText,
  wantsImage,
} from './measure';

// Step-through: one piece at a time, large. LEFT/RIGHT move through the
// pieces in order (MapScreen), SELECT opens it, BACK returns to the map.
// The card carries the scene's colour band and the node's photo (with its
// credit) or its large glyph; the full label and detail wrap, sized to fit.

interface Props {
  node: ExploreNode | undefined;
  index: number;
  count: number;
  explore: Explore;
  theme: MapTheme;
  playhead: number | null;
  box: Rect;
  focusable: boolean;
  register: (id: string, v: View | null) => void;
  resolve: (id: string | undefined) => View | undefined;
  onOpen: () => void;
}

const BAND = 6;
const PAD = space.l;
const MEDIA_W = 200;
const GLYPH_TILE = 112;
const PROGRESS_H = 40;

type Media = 'image' | 'glyph' | null;

export function stepMedia(node: ExploreNode, theme: MapTheme): Media {
  if (node.image && (wantsImage(node, theme.motif) || theme.motif === 'archive')) {
    return 'image';
  }
  if (theme.motif === 'signal' || (node.icon && theme.motif !== 'plain')) {
    return 'glyph';
  }
  return null;
}

// Sizes for the label and detail so the whole card fits `maxH`.
export function stepFit(
  node: ExploreNode,
  textW: number,
  maxH: number,
  meta: string,
): {label: SizeName; detail: SizeName} {
  const tries: Array<{label: SizeName; detail: SizeName}> = [
    {label: 'title', detail: 'body'},
    {label: 'headline', detail: 'body'},
    {label: 'headline', detail: 'caption'},
  ];
  for (const f of tries) {
    const h =
      linesHeight(meta, textW, 'caption') +
      (node.value
        ? space.xs + linesHeight(valueText(node.value), textW, 'title') + space.xs + 6
        : 0) +
      space.xs +
      linesHeight(node.label, textW, f.label) +
      (node.detail ? space.s + linesHeight(node.detail, textW, f.detail) : 0);
    if (h <= maxH) {
      return f;
    }
  }
  return tries[tries.length - 1];
}

export const StepCard = ({
  node,
  index,
  count,
  explore,
  theme,
  playhead,
  box,
  focusable,
  register,
  resolve,
  onOpen,
}: Props) => {
  const opacity = useSharedValue(1);
  const dx = useSharedValue(0);
  const prev = useRef(index);
  useEffect(() => {
    const dir = index >= prev.current ? 1 : -1;
    prev.current = index;
    opacity.value = 0;
    dx.value = 16 * dir;
    const cfg = {duration: motion.fadeMs, easing: Easing.out(Easing.cubic)};
    opacity.value = withTiming(1, cfg);
    dx.value = withTiming(0, cfg);
    return () => {
      cancelAnimation(opacity);
      cancelAnimation(dx);
    };
  }, [index, opacity, dx]);
  const enter = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{translateX: Math.round(dx.value)}],
  }));
  const moreRef = useFocusOnMount<View>(focusable);
  if (!node) {
    return null;
  }
  const plain = theme.motif === 'plain';
  const ink = plain ? colors.text : theme.ink;
  const soft = plain ? colors.textSecondary : theme.inkSoft;
  const locked = isLocked(node, playhead, explore.suspense);
  const group = explore.groups.find((g) => g.id === node.group);
  const cardW = Math.min(720, box.w);
  const left = Math.round(box.x + (box.w - cardW) / 2);
  const maxH = box.h - PROGRESS_H - space.m;
  const innerH = maxH - BAND - 2 * PAD;
  const media = locked ? null : stepMedia(node, theme);
  const textW = cardW - 2 * PAD - (media ? MEDIA_W + PAD : 0);
  const meta = [group?.title, nodeMeta(node, playhead !== null)].filter(Boolean).join(' · ');
  const fit = stepFit(node, textW, innerH, meta);
  const credit = node.image ? creditText(node.image.credit) : '';
  const imageH = Math.max(
    72,
    Math.min(150, innerH - space.xs - linesHeight(credit, MEDIA_W, 'caption')),
  );
  const self = resolve('step-more');
  const number = isNumber(node) && node.value;
  const bar =
    number && theme.motif === 'ledger'
      ? Math.abs(node.value!.n) /
        Math.max(
          1,
          ...explore.nodes.filter((n) => n.value).map((n) => Math.abs(n.value!.n)),
        )
      : null;
  return (
    <>
      {/* The card sits in the middle of the room above the progress row, not
          pinned under the header: the eye lands on it at 10 feet. */}
      <View
        style={[styles.stage, {left, top: box.y, width: cardW, height: maxH}]}
        pointerEvents="box-none">
        <Animated.View
          style={[
            styles.card,
            {backgroundColor: plain ? colors.card : theme.surface},
            enter,
          ]}
          testID="map-step-card"
          accessibilityLiveRegion="polite">
          <View style={[styles.band, {backgroundColor: plain ? colors.text : theme.accent}]} />
          {locked ? (
            <View style={styles.body}>
              <View style={styles.textCol}>
                <View style={styles.metaRow}>
                  <Icon name="lock" size={16} color={soft} />
                  <Text style={[styles.meta, styles.metaLock, {color: soft}]}>
                    Later in the episode
                  </Text>
                </View>
                <Text style={[styles.title, {color: ink}]}>
                  {theme.motif === 'caseboard' ? 'Not yet' : 'Keep watching'}
                </Text>
                <Text style={[styles.detail, {color: ink}]}>
                  This piece unlocks when the episode gets there.
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.body}>
              {media === 'image' && node.image ? (
                <View style={styles.media}>
                  <Image
                    source={imageSource(node.image.url)}
                    style={[styles.image, {height: imageH}]}
                    resizeMode="cover"
                    accessibilityIgnoresInvertColors
                    testID="map-step-image"
                  />
                  <Text style={[styles.credit, {color: soft}]}>{credit}</Text>
                </View>
              ) : media === 'glyph' ? (
                <View style={styles.media}>
                  <View
                    style={[
                      styles.glyphTile,
                      {borderColor: theme.line, backgroundColor: theme.accentSoft},
                    ]}>
                    <Glyph name={glyphFor(node)} size={72} color={theme.accent} strokeWidth={1.5} />
                  </View>
                </View>
              ) : null}
              <View style={styles.textCol}>
                <View style={styles.metaRow}>
                  <Text style={[styles.meta, {color: soft}]}>{meta}</Text>
                  {showsVerdict(node) ? (
                    <>
                      <Text style={[styles.meta, {color: soft}]}>{'  ·  '}</Text>
                      <VerdictWord verdict={node.verdict ?? undefined} />
                    </>
                  ) : null}
                </View>
                {number && node.value ? (
                  <Text style={[styles.value, {color: ink}]} testID="map-step-value">
                    {valueText(node.value)}
                  </Text>
                ) : null}
                {bar !== null ? (
                  <View style={[styles.barTrack, {backgroundColor: theme.line}]}>
                    <View
                      style={[
                        styles.barFill,
                        {backgroundColor: theme.accent, width: `${Math.max(2, Math.round(bar * 100))}%`},
                      ]}
                    />
                  </View>
                ) : null}
                <Text style={[fit.label === 'title' ? styles.title : styles.headline, {color: ink}]}>
                  {node.label}
                </Text>
                {node.detail ? (
                  <Text style={[fit.detail === 'body' ? styles.detail : styles.detailSmall, {color: ink}]}>
                    {node.detail}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
        </Animated.View>
      </View>
      <View
        style={[
          styles.progress,
          {left, width: cardW, top: box.y + box.h - PROGRESS_H},
        ]}>
        <Text style={[styles.progressText, {color: soft}]} testID="map-step-progress">
          {`${index + 1} of ${count}`}
        </Text>
        <View style={[styles.progressTrack, !plain && {backgroundColor: theme.line}]}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.round(((index + 1) / count) * 100)}%`,
                backgroundColor: plain ? colors.text : theme.accent,
              },
            ]}
          />
        </View>
        <FocusFrame
          ref={(v) => {
            (moreRef as React.MutableRefObject<View | null>).current = v;
            register('step-more', v);
          }}
          testID="map-step-more"
          accessibilityLabel={locked ? 'Locked piece' : `More on this: ${node.label}`}
          variant="button"
          focusable={focusable}
          hasTVPreferredFocus={focusable}
          nextFocus={{
            up: resolve(TOGGLE_ID) ?? self,
            down: self,
            left: self,
            right: self,
          }}
          contentStyle={styles.moreInner}
          onPress={onOpen}>
          {(focused) => (
            <Text style={[styles.moreText, focused && styles.onFocus]}>More on this</Text>
          )}
        </FocusFrame>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  stage: {position: 'absolute', justifyContent: 'center'},
  card: {
    borderRadius: radius.banner,
    overflow: 'hidden',
  },
  band: {height: BAND},
  body: {flexDirection: 'row', padding: PAD},
  media: {width: MEDIA_W, marginRight: PAD},
  image: {width: MEDIA_W, borderRadius: 4},
  credit: {...type.caption, marginTop: space.xs},
  glyphTile: {
    width: GLYPH_TILE,
    height: GLYPH_TILE,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: {flex: 1},
  metaRow: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center'},
  meta: {...type.caption, ...numeric, flexShrink: 1},
  metaLock: {marginLeft: space.xs},
  value: {...type.title, ...numeric, marginTop: space.xs},
  barTrack: {height: 6, borderRadius: 3, overflow: 'hidden', marginTop: space.xs},
  barFill: {height: 6, borderRadius: 3},
  title: {...type.title, marginTop: space.xs},
  headline: {...type.headline, marginTop: space.xs},
  detail: {...type.body, marginTop: space.s},
  detailSmall: {...type.caption, marginTop: space.s},
  progress: {
    position: 'absolute',
    height: PROGRESS_H,
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressText: {...type.caption, ...numeric, width: 64},
  progressTrack: {
    flex: 1,
    height: 2,
    backgroundColor: colors.track,
    borderRadius: 1,
    marginRight: space.m,
  },
  progressFill: {height: 2, borderRadius: 1},
  moreInner: {height: 40, paddingHorizontal: space.m, justifyContent: 'center'},
  moreText: {...type.bodyStrong, color: colors.text},
  onFocus: {color: colors.onFocus},
});
