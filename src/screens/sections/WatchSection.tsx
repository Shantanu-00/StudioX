import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from '@amazon-devices/react-native-reanimated';
import {localPackage} from '../../analysis/packageLoader';
import {cameoMaps} from '../../map/cameos';
import {Backdrop} from '../../components/Backdrop';
import {FocusFrame} from '../../components/FocusFrame';
import {Icon} from '../../components/Icon';
import {EPISODES, Episode} from '../../data/episodes';
import {colors, space, type} from '../../theme';
import {displayCase} from '../../analysis/cardText';

interface Props {
  initialFocus: string;
  onPlay: (episode: Episode) => void;
  // Opens the episode with its Map up (shown only when it has one).
  onMap: (episode: Episode) => void;
  // Opens a cameo map (an example with no video).
  onCameo: (mediaId: string) => void;
  onFocusItem: (id: string) => void;
  onOpenLink: () => void;
}

export const PLAY_ID = 'hero-play';
export const MAP_ID = 'hero-map';
const PAIR_ID = 'tile-pair';
const cameoId = (id: string) => `cameo-${id}`;
// How far the page rises when focus is on the "More maps" row.
const RISE = 150;

// Whether an episode's local package carries a valid, eligible Map.
const hasMap = (id: string) => !!localPackage(id)?.analysis.explore;

// Home: full-bleed key art, the featured episode's details with a Play button,
// and a row of 16:9 tiles. Focusing a tile previews it in the hero.
export const WatchSection = ({
  initialFocus,
  onPlay,
  onMap,
  onCameo,
  onFocusItem,
  onOpenLink,
}: Props) => {
  const [heroId, setHeroId] = useState(
    EPISODES.some((e) => e.id === initialFocus) ? initialFocus : EPISODES[0].id,
  );
  const hero = EPISODES.find((e) => e.id === heroId) ?? EPISODES[0];
  const [focusedTile, setFocusedTile] = useState<string | null>(null);
  const heroMap = useMemo(() => hasMap(hero.id), [hero.id]);
  const cameos = useMemo(() => cameoMaps(), []);
  // The page rises (and the hero text fades) while the maps row has focus,
  // so both rows fit on the 540 dp canvas. 250 ms, UI thread, whole dp.
  const [inMaps, setInMaps] = useState(initialFocus.startsWith('cameo-'));
  const rise = useSharedValue(inMaps ? 1 : 0);
  useEffect(() => {
    rise.value = withTiming(inMaps ? 1 : 0, {
      duration: 250,
      easing: Easing.out(Easing.cubic),
    });
  }, [inMaps, rise]);
  const lift = useAnimatedStyle(() => ({
    transform: [{translateY: Math.round(-RISE * rise.value)}],
  }));
  const fade = useAnimatedStyle(() => ({opacity: 1 - rise.value}));
  // DOWN from Map did not reach the tiles with Cartesian focus alone (VVD):
  // it points at the first tile explicitly, once the tile is mounted.
  const firstTile = useRef<View | null>(null);
  const [, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(t);
  }, []);
  const focusRow = (id: string, maps: boolean) => {
    setInMaps(maps);
    onFocusItem(id);
  };

  return (
    <View style={styles.root}>
      <Backdrop id={hero.id} source={hero.backdrop} />

      <Animated.View style={[styles.hero, fade]} accessibilityLiveRegion="polite">
        <Text style={styles.show} numberOfLines={1}>
          {displayCase(`${hero.show} · ${hero.label}`)}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {hero.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {`${hero.genre} · ${hero.durationSec} sec`}
        </Text>
        <Text style={styles.synopsis} numberOfLines={2}>
          {hero.synopsis}
        </Text>
        <View style={styles.actions}>
        <FocusFrame
          testID={PLAY_ID}
          accessibilityLabel={`Play ${hero.title}`}
          variant="button"
          hasTVPreferredFocus={initialFocus === PLAY_ID}
          style={styles.playWrap}
          contentStyle={styles.play}
          onFocus={() => focusRow(PLAY_ID, false)}
          onPress={() => onPlay(hero)}>
          {(focused) => (
            <>
              <Icon
                name="play"
                size={20}
                color={focused ? colors.onFocus : colors.text}
              />
              <Text
                style={[styles.playText, focused && styles.playTextFocused]}>
                Play
              </Text>
            </>
          )}
        </FocusFrame>
        {heroMap ? (
          <FocusFrame
            testID={MAP_ID}
            accessibilityLabel={`Map of ${hero.title}: the conversation as one picture`}
            variant="button"
            hasTVPreferredFocus={initialFocus === MAP_ID}
            style={styles.mapWrap}
            contentStyle={styles.mapButton}
            nextFocus={{down: firstTile.current ?? undefined}}
            onFocus={() => focusRow(MAP_ID, false)}
            onPress={() => onMap(hero)}>
            {(focused) => (
              <Text
                style={[styles.playText, styles.mapText, focused && styles.playTextFocused]}>
                Map
              </Text>
            )}
          </FocusFrame>
        ) : null}
        </View>
      </Animated.View>

      <Animated.View style={[styles.rowBlock, lift]}>
        <Text style={styles.rowTitle}>Episodes</Text>
        <TVFocusGuideView autoFocus trapFocusRight style={styles.row}>
          {EPISODES.map((ep) => (
            <View key={ep.id} style={styles.tile}>
              <FocusFrame
                ref={ep.id === EPISODES[0].id ? firstTile : undefined}
                testID={`episode-${ep.id}`}
                variant="card"
                accessibilityLabel={`${ep.show}, ${ep.title}. Select to play.`}
                hasTVPreferredFocus={initialFocus === ep.id}
                contentStyle={styles.tileArt}
                onFocus={() => {
                  setHeroId(ep.id);
                  setFocusedTile(ep.id);
                  focusRow(ep.id, false);
                }}
                onBlur={() => setFocusedTile((f) => (f === ep.id ? null : f))}
                onPress={() => onPlay(ep)}>
                {() => <Image source={ep.card} style={styles.tileImage} />}
              </FocusFrame>
              <Caption
                focused={focusedTile === ep.id}
                overline={displayCase(ep.label)}
                title={ep.title}
              />
            </View>
          ))}
          <View style={styles.tile}>
            <FocusFrame
              testID={PAIR_ID}
              variant="card"
              accessibilityLabel="Link a phone to share videos to this TV"
              hasTVPreferredFocus={initialFocus === PAIR_ID}
              contentStyle={[styles.tileArt, styles.pairArt]}
              onFocus={() => {
                setFocusedTile(PAIR_ID);
                focusRow(PAIR_ID, false);
              }}
              onBlur={() => setFocusedTile((f) => (f === PAIR_ID ? null : f))}
              onPress={onOpenLink}>
              {(focused) => (
                <Icon
                  name="phone"
                  size={34}
                  color={focused ? colors.text : colors.textSecondary}
                />
              )}
            </FocusFrame>
            <Caption
              focused={focusedTile === PAIR_ID}
              overline="Share"
              title="Link a phone"
            />
          </View>
        </TVFocusGuideView>
        {cameos.length ? (
          <View style={styles.mapsBlock}>
            <View style={styles.mapsTitleRow}>
              <Text style={styles.rowTitle}>More maps</Text>
              <Text style={styles.mapsNote} numberOfLines={1}>
                Example transcripts written by StudioX
              </Text>
            </View>
            <TVFocusGuideView autoFocus trapFocusRight style={styles.row}>
              {cameos.map((c) => (
                <FocusFrame
                  key={c.mediaId}
                  testID={cameoId(c.mediaId)}
                  accessibilityLabel={`Example map: ${c.title}, ${c.category}. Written by StudioX.`}
                  variant="button"
                  hasTVPreferredFocus={initialFocus === cameoId(c.mediaId)}
                  style={styles.mapCard}
                  contentStyle={styles.mapCardInner}
                  onFocus={() => focusRow(cameoId(c.mediaId), true)}
                  onPress={() => onCameo(c.mediaId)}>
                  {(focused) => (
                    <>
                      <Text
                        style={[styles.mapCardKind, focused && styles.onFocusDim]}
                        numberOfLines={1}>
                        {c.category}
                      </Text>
                      <Text
                        style={[styles.mapCardTitle, focused && styles.playTextFocused]}
                        numberOfLines={2}>
                        {c.title}
                      </Text>
                    </>
                  )}
                </FocusFrame>
              ))}
            </TVFocusGuideView>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
};

// Captions sit below the art, outside the scaled card, so the text is never
// resampled by the focus animation.
const Caption = ({
  focused,
  overline,
  title,
}: {
  focused: boolean;
  overline: string;
  title: string;
}) => (
  <View style={styles.caption}>
    <Text
      style={[styles.tileOverline, focused && styles.tileOverlineOn]}
      numberOfLines={1}>
      {overline}
    </Text>
    <Text
      style={[styles.tileTitle, focused && styles.tileTitleOn]}
      numberOfLines={1}>
      {title}
    </Text>
  </View>
);

const TILE_W = 224;
const TILE_H = 126;

const styles = StyleSheet.create({
  // Rendered full-screen under the nav rail so the art bleeds to the edges.
  root: {...StyleSheet.absoluteFillObject},
  hero: {position: 'absolute', left: space.content, top: 56, width: 440},
  show: {...type.caption, color: colors.textSecondary},
  title: {...type.title, color: colors.text, marginTop: 4},
  meta: {...type.caption, color: colors.textSecondary, marginTop: space.xs},
  synopsis: {...type.body, color: colors.text, marginTop: space.xs},
  actions: {flexDirection: 'row', marginTop: space.l},
  playWrap: {alignSelf: 'flex-start'},
  mapWrap: {alignSelf: 'flex-start', marginLeft: space.s},
  mapButton: {height: 40, paddingHorizontal: space.l, justifyContent: 'center'},
  mapText: {marginLeft: 0},
  mapsBlock: {marginTop: space.l},
  mapsTitleRow: {flexDirection: 'row', alignItems: 'baseline'},
  mapsNote: {...type.caption, color: colors.textTertiary, marginLeft: space.s},
  mapCard: {width: TILE_W, marginRight: space.l},
  mapCardInner: {height: 72, paddingHorizontal: space.s, paddingVertical: space.xs},
  mapCardKind: {...type.caption, color: colors.textSecondary},
  mapCardTitle: {...type.bodyStrong, color: colors.text, marginTop: 2},
  onFocusDim: {color: colors.onFocus, opacity: 0.62},
  play: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    paddingLeft: space.m,
    paddingRight: space.l,
  },
  playText: {...type.bodyStrong, color: colors.text, marginLeft: space.xs},
  playTextFocused: {color: colors.onFocus},
  rowBlock: {position: 'absolute', left: space.content, right: 0, top: 318},
  rowTitle: {...type.headline, color: colors.text, marginBottom: space.s},
  row: {flexDirection: 'row'},
  tile: {width: TILE_W, marginRight: space.l},
  tileArt: {height: TILE_H},
  tileImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: TILE_W,
    height: TILE_H,
  },
  pairArt: {alignItems: 'center', justifyContent: 'center'},
  // Labels sit below the art, outside the scaled layer; the 1.08 lift needs
  // room above them.
  caption: {marginTop: space.m, paddingHorizontal: 2},
  tileOverline: {...type.caption, color: colors.textTertiary},
  tileOverlineOn: {color: colors.textSecondary},
  tileTitle: {...type.bodyStrong, color: colors.textSecondary},
  tileTitleOn: {color: colors.text},
});
