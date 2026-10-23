import React from 'react';
import {StyleSheet} from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Stop,
} from '@amazon-devices/react-native-svg';
import type {MapTheme} from '../themes';
import type {Rect} from '../layout';

// The genre scene behind the Map, one SVG per motif (CONTRACTS §10). Static
// at rest: nothing here animates, it is drawn once per size and memoised.
// Fine detail (grain, stars, grid) is one stroked path each, so the whole
// backdrop is a handful of SVG elements however busy it looks.
//
// `hole` is left transparent: the paused video frame shows through it, and
// nothing is drawn over the episode.

interface Props {
  theme: MapTheme;
  width: number;
  height: number;
  hole?: Rect | null;
}

// A small deterministic PRNG (Park–Miller), so a scene looks the same every
// time it opens.
function rng(seed: number) {
  let a = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => {
    a = (a * 16807) % 2147483647;
    return (a - 1) / 2147483646;
  };
}

const inside = (x: number, y: number, h?: Rect | null, pad = 4) =>
  !!h && x >= h.x - pad && x <= h.x + h.w + pad && y >= h.y - pad && y <= h.y + h.h + pad;

const r1 = (v: number) => Math.round(v * 10) / 10;

// The background fill: the whole canvas less the hole (even-odd).
const fillPath = (w: number, h: number, hole?: Rect | null) =>
  `M0 0H${w}V${h}H0Z` +
  (hole ? ` M${hole.x} ${hole.y}h${hole.w}v${hole.h}h${-hole.w}Z` : '');

// `count` specks as one path of tiny round-capped strokes.
function specks(
  w: number,
  h: number,
  count: number,
  seed: number,
  hole: Rect | null | undefined,
  maxY = h,
  len = 0.6,
) {
  const rand = rng(seed);
  let d = '';
  for (let i = 0; i < count; i++) {
    const x = r1(rand() * w);
    const y = r1(rand() * maxY);
    if (!inside(x, y, hole)) {
      d += `M${x} ${y}h${len}`;
    }
  }
  return d;
}

// Horizontal lines every `step` dp from `y0`, broken around the hole.
function rules(w: number, h: number, step: number, y0: number, hole?: Rect | null) {
  let d = '';
  for (let y = y0; y < h; y += step) {
    if (hole && y >= hole.y - 2 && y <= hole.y + hole.h + 2) {
      d += `M0 ${y}H${hole.x - 4} M${hole.x + hole.w + 4} ${y}H${w} `;
    } else {
      d += `M0 ${y}H${w} `;
    }
  }
  return d;
}

// Vertical lines every `step` dp, broken around the hole.
function columns(w: number, h: number, step: number, x0: number, hole?: Rect | null) {
  let d = '';
  for (let x = x0; x < w; x += step) {
    if (hole && x >= hole.x - 2 && x <= hole.x + hole.w + 2) {
      d += `M${x} 0V${hole.y - 4} M${x} ${hole.y + hole.h + 4}V${h} `;
    } else {
      d += `M${x} 0V${h} `;
    }
  }
  return d;
}

// A crescent of radius `r` at (x, y), lit on the left.
const crescent = (x: number, y: number, r: number) =>
  `M${x} ${y - r} A${r} ${r} 0 1 0 ${x} ${y + r} A${r * 0.72} ${r} 0 1 1 ${x} ${y - r} Z`;

const Gradient = ({id, top, bottom}: {id: string; top: string; bottom: string}) => (
  <Defs>
    <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <Stop offset="0%" stopColor={top} />
      <Stop offset="100%" stopColor={bottom} />
    </LinearGradient>
  </Defs>
);

const Scene = ({theme, width: w, height: h, hole}: Props) => {
  const id = `sx-bd-${theme.motif}`;
  const fill = fillPath(w, h, hole);
  switch (theme.motif) {
    case 'caseboard':
      // A dark board: a little red in the dark, paper grain and pin holes,
      // and the board's edge.
      return (
        <>
          <Gradient id={id} top={theme.bgDeep} bottom={theme.bg} />
          <Path d={fill} fill={`url(#${id})`} fillRule="evenodd" />
          <Path
            d={specks(w, h, 420, 104, hole, h, 0.8)}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={1.2}
            strokeLinecap="round"
          />
          <Path
            d={specks(w, h, 260, 7, hole, h, 1.6)}
            stroke="rgba(0,0,0,0.45)"
            strokeWidth={1.4}
            strokeLinecap="round"
          />
          <Path
            d={specks(w, h, 28, 33, hole, h, 0.1)}
            stroke="rgba(0,0,0,0.7)"
            strokeWidth={2.4}
            strokeLinecap="round"
          />
          <Path
            d={`M12 12H${w - 12}V${h - 12}H12Z`}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={2}
            fill="none"
          />
        </>
      );
    case 'nightsky': {
      // Stars above a horizon, and the moon's faint arc across the sky.
      const horizon = h - 40;
      const peak = 128;
      const ctrl = 2 * peak - horizon;
      const t = 0.18;
      const mx = (1 - t) ** 2 * 48 + 2 * t * (1 - t) * (w / 2) + t * t * (w - 48);
      const my = (1 - t) ** 2 * horizon + 2 * t * (1 - t) * ctrl + t * t * horizon;
      const rand = rng(42);
      const bright = Array.from({length: 9}, () => ({
        x: r1(48 + rand() * (w - 96)),
        y: r1(16 + rand() * (horizon - 64)),
      })).filter((s) => !inside(s.x, s.y, hole, 8));
      return (
        <>
          <Gradient id={id} top={theme.bg} bottom={theme.bgDeep} />
          <Path d={fill} fill={`url(#${id})`} fillRule="evenodd" />
          <Path
            d={specks(w, h, 110, 90, hole, horizon - 12, 0.1)}
            stroke="rgba(235,235,255,0.42)"
            strokeWidth={1.4}
            strokeLinecap="round"
          />
          {bright.map((s, i) => (
            <Circle key={i} cx={s.x} cy={s.y} r={1.4} fill={theme.support} opacity={0.75} />
          ))}
          <Path
            d={`M48 ${horizon} Q${w / 2} ${ctrl} ${w - 48} ${horizon}`}
            stroke={theme.support}
            strokeOpacity={0.16}
            strokeWidth={1.5}
            strokeDasharray="2 10"
            strokeLinecap="round"
            fill="none"
          />
          <Path d={crescent(r1(mx), r1(my), 13)} fill={theme.support} opacity={0.42} />
          <Path
            d={`M0 ${horizon}H${w}V${h}H0Z`}
            fill="rgba(0,0,0,0.35)"
          />
          <Path
            d={`M0 ${horizon}H${w}`}
            stroke={theme.support}
            strokeOpacity={0.22}
            strokeWidth={1}
          />
        </>
      );
    }
    case 'signal': {
      // A dark grid with a few lit junctions.
      const rand = rng(5);
      const lit = Array.from({length: 10}, () => ({
        x: 48 * Math.round(rand() * Math.floor(w / 48)),
        y: 48 * Math.round(rand() * Math.floor(h / 48)),
      })).filter((p) => !inside(p.x, p.y, hole, 8));
      return (
        <>
          <Gradient id={id} top={theme.bg} bottom={theme.bgDeep} />
          <Path d={fill} fill={`url(#${id})`} fillRule="evenodd" />
          <Path
            d={rules(w, h, 48, 12, hole) + columns(w, h, 48, 0, hole)}
            stroke={theme.line}
            strokeOpacity={0.35}
            strokeWidth={1}
          />
          {lit.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y + 12} r={2} fill={theme.accent} opacity={0.45} />
          ))}
        </>
      );
    }
    case 'ledger':
      // Ruled lines and a double margin rule, as in a ledger book.
      return (
        <>
          <Gradient id={id} top={theme.bgDeep} bottom={theme.bg} />
          <Path d={fill} fill={`url(#${id})`} fillRule="evenodd" />
          <Path d={rules(w, h, 24, 18, hole)} stroke={theme.line} strokeOpacity={0.5} strokeWidth={1} />
          <Path
            d={`M24 0V${h} M29 0V${h}`}
            stroke={theme.accent}
            strokeOpacity={0.22}
            strokeWidth={1}
          />
        </>
      );
    case 'archive':
      // Warm, old paper: grain, a few foxing spots, darker edges.
      return (
        <>
          <Gradient id={id} top={theme.bgDeep} bottom={theme.bg} />
          <Path d={fill} fill={`url(#${id})`} fillRule="evenodd" />
          <Path
            d={specks(w, h, 380, 1969, hole, h, 1.2)}
            stroke={theme.support}
            strokeOpacity={0.06}
            strokeWidth={1.2}
            strokeLinecap="round"
          />
          <Path
            d={specks(w, h, 16, 11, hole, h, 0.1)}
            stroke={theme.accent}
            strokeOpacity={0.05}
            strokeWidth={22}
            strokeLinecap="round"
          />
          <Path
            d={`M0 0H${w}V${h}H0Z`}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={36}
            fill="none"
          />
        </>
      );
    case 'plain':
      return null; // the app's black field, as before
  }
};

export const Backdrop = React.memo((props: Props) =>
  props.theme.motif === 'plain' ? null : (
    <Svg
      width={props.width}
      height={props.height}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      testID={`map-backdrop-${props.theme.motif}`}>
      <Scene {...props} />
    </Svg>
  ),
);
