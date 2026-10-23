import React, {memo, useMemo} from 'react';
import Svg, {Path, Rect} from '@amazon-devices/react-native-svg';
import qrcode from 'qrcode-generator';
import {colors} from '../theme';

interface Props {
  value: string;
  size: number;
}

const QUIET = 4; // modules of light margin required by scanners
const FINDER = 7;

interface Matrix {
  count: number;
  data: string; // data modules as one path
  finders: Array<[number, number]>; // top-left module of each finder
}

// Encodes once per value. Data modules are drawn slightly inset, which gives
// the dot-matrix look while keeping each module's centre dark for scanners.
// Finder patterns stay solid so phones lock on quickly.
function encode(value: string): Matrix {
  const qr = qrcode(0, 'M');
  qr.addData(value, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const finders: Array<[number, number]> = [
    [0, 0],
    [count - FINDER, 0],
    [0, count - FINDER],
  ];
  const inFinder = (r: number, c: number) =>
    finders.some(
      ([fc, fr]) => c >= fc && c < fc + FINDER && r >= fr && r < fr + FINDER,
    );
  const inset = 0.08;
  const s = 1 - inset * 2;
  const parts: string[] = [];
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c) && !inFinder(r, c)) {
        parts.push(
          `M${c + QUIET + inset} ${r + QUIET + inset}h${s}v${s}h-${s}z`,
        );
      }
    }
  }
  return {count, data: parts.join(''), finders};
}

export const QrGlyph = memo(({value, size}: Props) => {
  const m = useMemo(() => encode(value), [value]);
  const span = m.count + QUIET * 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${span} ${span}`}>
      <Rect x={0} y={0} width={span} height={span} fill={colors.plate} />
      <Path d={m.data} fill={colors.ink} />
      {m.finders.map(([c, r]) => (
        <Finder key={`${c}-${r}`} x={c + QUIET} y={r + QUIET} />
      ))}
    </Svg>
  );
});

const Finder = ({x, y}: {x: number; y: number}) => (
  <>
    <Path
      d={`M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5z`}
      fill={colors.ink}
      fillRule="evenodd"
    />
    <Rect x={x + 2} y={y + 2} width={3} height={3} fill={colors.ink} />
  </>
);
