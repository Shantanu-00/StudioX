import React, {useEffect, useMemo, useRef} from 'react';
import {
  Animated,
  Easing,
  ImageSourcePropType,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, {
  ClipPath,
  Defs,
  Image as SvgImage,
  Path,
} from '@amazon-devices/react-native-svg';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {colors} from '../theme';

interface Props {
  onDone: () => void;
}

const SKIP_KEYS = new Set(['select', 'enter', 'playpause', 'play']);

// The FALLBACK opening (Intro.tsx plays the rendered v5 video and switches to
// this when the video cannot start): the v5 title (scripts/intro/README-v5.md)
// rebuilt natively and cut from 10 s to about 3.9 s. Scattered fragments decode into STUDIOX, the
// word holds, trembles, a fracture runs right to left, the two glass panes
// break the word's alignment, then the letters fade out in overlapping order,
// the crimson X last.
//
// No video decoder, no audio, no per-frame React work: one timeline of
// Animated opacity and transforms on the native driver. The letters are v5's
// own glyph masks (src/assets/intro); the fracture is drawn here, not traced
// from the reference plate. SELECT skips (Intro.tsx also listens; its finish is
// idempotent); BACK is routed by App.

// v5 layout on its 1920 × 1080 canvas, in dp (÷ 2).
const GLYPHS: Array<{src: ImageSourcePropType; x: number; w: number}> = [
  {src: require('../assets/intro/glyph-0.png'), x: 274.5, w: 62.5},
  {src: require('../assets/intro/glyph-1.png'), x: 335.5, w: 58},
  {src: require('../assets/intro/glyph-2.png'), x: 392, w: 67.5},
  {src: require('../assets/intro/glyph-3.png'), x: 458, w: 67.5},
  {src: require('../assets/intro/glyph-4.png'), x: 524, w: 29.5},
  {src: require('../assets/intro/glyph-5.png'), x: 552, w: 72},
  {src: require('../assets/intro/glyph-6.png'), x: 622.5, w: 63},
];
const GLYPH_Y = 233;
const GLYPH_H = 95;
// The ink band inside each mask (rows 14–140 of 190 px).
const INK_TOP = 6;
const INK_H = 66;
const ROWS = 5;

// The fracture: bottom right to top left across the word, through D, I, O.
const CRACK: Array<[number, number]> = [
  [968, 452], [872, 414], [790, 384], [706, 350], [641, 326], [579, 303],
  [537, 289], [503, 276], [483, 265], [466, 259], [441, 247], [398, 232],
  [331, 205], [251, 175], [171, 143], [87, 111], [-8, 76],
];
const BRANCHES: Array<Array<[number, number]>> = [
  [[537, 289], [521, 301], [499, 318], [471, 331], [433, 343], [404, 349]],
  [[483, 265], [474, 250], [470, 236], [462, 221]],
  [[641, 326], [628, 342], [619, 361]],
  [[398, 232], [380, 241], [361, 246]],
];
// Revealed in four pieces, right to left (indices into CRACK).
const PIECES: Array<[number, number]> = [[0, 4], [4, 8], [8, 12], [12, 16]];
// Rigid pane offsets at impact (dp): above the crack up-left, below down-right.
const SPLIT = {upper: {x: -3, y: -1.5}, lower: {x: 3, y: 1.5}};
// Letter fade order and delays (ms): irregular, X last.
const FADE_AT = [110, 0, 200, 60, 240, 150, 430];

// Timeline (ms).
const T = {
  black: 150,
  decode: 1100,
  hold: 350,
  tremor: 350,
  crack: 140,
  fractured: 800,
  fade: 420,
  xFade: 480,
  tail: 150,
};

// Deterministic fragment scatter (a sine hash), so every launch is the same.
function rng(seed: number) {
  let i = 0;
  return () => {
    const x = Math.sin(seed * 78.233 + ++i * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
}

interface Tile {
  key: string;
  glyph: number;
  x: number; // within the glyph
  y: number;
  w: number;
  h: number;
  start: number; // 0..1 of the decode
  end: number;
  dx: number;
  dy: number;
}

function makeTiles(): Tile[] {
  const r = rng(5);
  const tiles: Tile[] = [];
  const rowH = INK_H / ROWS;
  GLYPHS.forEach((g, gi) => {
    const cols = g.w < 40 ? 1 : 2;
    const colW = g.w / cols;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < cols; col++) {
        const start = r() * 0.55;
        const end = Math.min(0.98, Math.max(start + 0.2, 0.6 + r() * 0.38));
        const sign = r() < 0.5 ? -1 : 1;
        tiles.push({
          key: `${gi}-${row}-${col}`,
          glyph: gi,
          x: Math.round(col * colW),
          y: INK_TOP + Math.round(row * rowH),
          w: Math.ceil(colW) + 1,
          h: Math.ceil(rowH) + 1,
          start,
          end,
          dx: sign * (6 + r() * 34),
          dy: (r() - 0.5) * 10,
        });
      }
    }
  });
  return tiles;
}

const pathOf = (pts: Array<[number, number]>, ox = 0, oy = 0) =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x - ox} ${y - oy}`).join(' ');

// The half-planes either side of the crack, in a letter's local space.
const paneClip = (side: 'upper' | 'lower', ox: number, oy: number) => {
  const edge = side === 'upper' ? -40 : 600;
  const pts: Array<[number, number]> = [...CRACK, [-8, edge], [968, edge]];
  return `${pathOf(pts, ox, oy)} Z`;
};

export const IntroNative = ({onDone}: Props) => {
  const win = useWindowDimensions();
  // The art is authored on the 960 × 540 canvas; centre it on the window.
  const ox = Math.round((win.width - 960) / 2);
  const oy = Math.round((win.height - 540) / 2);
  const tiles = useMemo(makeTiles, []);
  const v = useRef({
    decode: new Animated.Value(0),
    echo: new Animated.Value(0),
    tremor: new Animated.Value(0),
    tilesOn: new Animated.Value(1),
    panesOn: new Animated.Value(0),
    split: new Animated.Value(0),
    flash: new Animated.Value(0),
    pieces: PIECES.map(() => new Animated.Value(0)),
    fades: GLYPHS.map(() => new Animated.Value(1)),
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
    // Key-up, so the release cannot press Home's focused Play (see Intro.tsx).
    if (SKIP_KEYS.has(evt.eventType) && evt.eventKeyAction === 1) {
      finish();
    }
  });

  useEffect(() => {
    const t = (
      val: Animated.Value,
      toValue: number,
      duration: number,
      easing: (x: number) => number = Easing.out(Easing.cubic),
    ) =>
      Animated.timing(val, {toValue, duration, easing, useNativeDriver: true});
    const shake = [1.2, -2.6, 2.2, -1.4, 0.8, 0].map((x, i) =>
      t(v.tremor, x, i === 0 ? 40 : 30, Easing.linear),
    );
    const anim = Animated.sequence([
      Animated.delay(T.black),
      Animated.parallel([
        t(v.decode, 1, T.decode, Easing.linear),
        Animated.sequence([
          Animated.delay(T.decode * 0.5),
          t(v.echo, 1, T.decode * 0.5),
        ]),
      ]),
      Animated.delay(T.hold),
      // A small vibration that builds towards the impact.
      Animated.sequence(
        [0.4, -0.5, 0.7, -0.8, 1, -1.1, 1.3, -1.2].map((x) =>
          t(v.tremor, x, T.tremor / 8, Easing.inOut(Easing.quad)),
        ),
      ),
      // Impact: the panes take over from the fragments under a short flash,
      // the crack runs right to left and the panes shift apart.
      Animated.parallel([
        Animated.sequence([t(v.panesOn, 1, 0), t(v.tilesOn, 0, 0)]),
        Animated.sequence([t(v.flash, 0.08, 40), t(v.flash, 0, 260)]),
        Animated.stagger(
          T.crack / PIECES.length,
          v.pieces.map((p) => t(p, 1, 50, Easing.linear)),
        ),
        t(v.split, 1, 120, Easing.out(Easing.exp)),
        Animated.sequence(shake),
      ]),
      Animated.delay(T.fractured),
      // Overlapping letter fades, the X lingering.
      Animated.parallel(
        v.fades.map((f, i) =>
          Animated.sequence([
            Animated.delay(FADE_AT[i]),
            t(f, 0, i === GLYPHS.length - 1 ? T.xFade : T.fade, Easing.in(Easing.quad)),
          ]),
        ),
      ),
      Animated.delay(T.tail),
    ]);
    anim.start(({finished}) => finished && finish());
    return () => anim.stop();
  }, [v, finish]);

  // The crack fades with the word: as the last letters go, so does the glass.
  const crackFade = v.fades[5];
  const shift = (side: 'upper' | 'lower') => [
    {translateX: Animated.add(v.tremor, v.split.interpolate({inputRange: [0, 1], outputRange: [0, SPLIT[side].x]}))},
    {translateY: v.split.interpolate({inputRange: [0, 1], outputRange: [0, SPLIT[side].y]})},
  ];

  return (
    <View style={styles.root} accessible accessibilityLabel="StudioX" testID="intro-native">
      <View style={[styles.stage, {left: ox, top: oy}]} pointerEvents="none">
        {/* A soft cool echo behind the word, faded in as it resolves. */}
        {GLYPHS.map((g, i) => (
          <Animated.Image
            key={`echo-${i}`}
            source={g.src}
            style={[
              styles.glyph,
              styles.echo,
              {
                left: g.x + 1.5,
                top: GLYPH_Y + 1,
                width: g.w,
                opacity: Animated.multiply(Animated.multiply(v.echo, v.fades[i]), 0.16),
                transform: [{translateX: v.tremor}],
              },
            ]}
          />
        ))}

        {/* Decode: fragments flicker in and slide home. */}
        <Animated.View style={[StyleSheet.absoluteFill, {opacity: v.tilesOn, transform: [{translateX: v.tremor}]}]}>
          {tiles.map((tile) => {
            const g = GLYPHS[tile.glyph];
            const {start: s, end: e} = tile;
            const mid = (s + e) / 2;
            return (
              <Animated.View
                key={tile.key}
                style={[
                  styles.tile,
                  {
                    left: g.x + tile.x,
                    top: GLYPH_Y + tile.y,
                    width: tile.w,
                    height: tile.h,
                    opacity: v.decode.interpolate({
                      inputRange: [s, s + 0.03, s + 0.06, s + 0.1, e],
                      outputRange: [0, 0.9, 0.25, 1, 1],
                      extrapolate: 'clamp',
                    }),
                    transform: [
                      {
                        translateX: v.decode.interpolate({
                          inputRange: [s, mid, e],
                          outputRange: [tile.dx, tile.dx * 0.3, 0],
                          extrapolate: 'clamp',
                        }),
                      },
                      {
                        translateY: v.decode.interpolate({
                          inputRange: [s, mid, e],
                          outputRange: [tile.dy, tile.dy * 0.3, 0],
                          extrapolate: 'clamp',
                        }),
                      },
                    ],
                  },
                ]}>
                <Animated.Image
                  source={g.src}
                  style={[styles.glyph, {left: -tile.x, top: -tile.y, width: g.w}]}
                />
              </Animated.View>
            );
          })}
        </Animated.View>

        {/* The fractured word: each letter as two panes clipped to the crack. */}
        {(['upper', 'lower'] as const).map((side) =>
          GLYPHS.map((g, i) => (
            <Animated.View
              key={`${side}-${i}`}
              style={[
                styles.glyph,
                {
                  left: g.x,
                  top: GLYPH_Y,
                  width: g.w,
                  opacity: Animated.multiply(v.panesOn, v.fades[i]),
                  transform: shift(side),
                },
              ]}>
              <Svg width={g.w} height={GLYPH_H}>
                <Defs>
                  <ClipPath id={`intro-${side}-${i}`}>
                    <Path d={paneClip(side, g.x, GLYPH_Y)} />
                  </ClipPath>
                </Defs>
                <SvgImage
                  href={g.src}
                  width={g.w}
                  height={GLYPH_H}
                  clipPath={`url(#intro-${side}-${i})`}
                />
              </Svg>
            </Animated.View>
          )),
        )}

        {/* The crack, in four pieces revealed right to left. */}
        {PIECES.map(([a, b], i) => (
          <CrackPiece
            key={`crack-${i}`}
            pts={CRACK.slice(a, b + 1)}
            branches={BRANCHES.filter((br) => {
              const [x] = br[0];
              const lo = Math.min(CRACK[a][0], CRACK[b][0]);
              const hi = Math.max(CRACK[a][0], CRACK[b][0]);
              return x >= lo && x < hi;
            })}
            opacity={Animated.multiply(v.pieces[i], crackFade)}
            tremor={v.tremor}
          />
        ))}
      </View>

      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.flash, {opacity: v.flash}]}
      />
    </View>
  );
};

// One piece of the fracture in its own small Svg (never a full-screen layer):
// a faint cool glow, the dark split, and two bright edges either side.
const CrackPiece = ({
  pts,
  branches,
  opacity,
  tremor,
}: {
  pts: Array<[number, number]>;
  branches: Array<Array<[number, number]>>;
  opacity: ReturnType<typeof Animated.multiply>;
  tremor: Animated.Value;
}) => {
  const all = [...pts, ...branches.flat()];
  const pad = 6;
  const x0 = Math.floor(Math.min(...all.map((p) => p[0]))) - pad;
  const y0 = Math.floor(Math.min(...all.map((p) => p[1]))) - pad;
  const w = Math.ceil(Math.max(...all.map((p) => p[0]))) + pad - x0;
  const h = Math.ceil(Math.max(...all.map((p) => p[1]))) + pad - y0;
  const main = pathOf(pts, x0, y0);
  const up = pathOf(pts, x0, y0 + 1.1);
  const down = pathOf(pts, x0, y0 - 1.2);
  return (
    <Animated.View
      style={[
        styles.crack,
        {left: x0, top: y0, width: w, height: h, opacity, transform: [{translateX: tremor}]},
      ]}>
      <Svg width={w} height={h}>
        <Path d={main} stroke="rgba(170,200,255,0.10)" strokeWidth={6} fill="none" strokeLinejoin="round" />
        <Path d={main} stroke="#000000" strokeWidth={2.2} fill="none" strokeLinejoin="round" />
        <Path d={up} stroke="rgba(226,238,255,0.85)" strokeWidth={0.8} fill="none" strokeLinejoin="round" />
        <Path d={down} stroke="rgba(226,238,255,0.38)" strokeWidth={0.6} fill="none" strokeLinejoin="round" />
        {branches.map((br, i) => (
          <React.Fragment key={i}>
            <Path d={pathOf(br, x0, y0)} stroke="#000000" strokeWidth={1.2} fill="none" />
            <Path
              d={pathOf(br, x0, y0 + 0.8)}
              stroke="rgba(226,238,255,0.55)"
              strokeWidth={0.5}
              fill="none"
            />
          </React.Fragment>
        ))}
      </Svg>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.black, overflow: 'hidden'},
  stage: {position: 'absolute', width: 960, height: 540},
  glyph: {position: 'absolute', height: GLYPH_H},
  echo: {tintColor: '#8FB4FF'},
  tile: {position: 'absolute', overflow: 'hidden'},
  crack: {position: 'absolute'},
  flash: {backgroundColor: colors.text},
});
