import React from 'react';
import Svg, {Path} from '@amazon-devices/react-native-svg';
import {ExploreNode, NodeIcon} from '../../analysis/schema';

// The 23 node glyphs of CONTRACTS §10 as simple line icons on a 24-unit grid:
// one stroked path each (round caps, so a very short segment draws a dot).
// Drawn, not font-based, so they render the same on every device.
export const GLYPHS: Record<NodeIcon, string> = {
  tv: 'M3 6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z M8 21h8 M12 17v4',
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M11 18.5h2',
  wifi: 'M2.5 9a14 14 0 0 1 19 0 M5.5 12.5a9.5 9.5 0 0 1 13 0 M8.5 16a5 5 0 0 1 7 0 M12 19.5h.01',
  router:
    'M3 14h18v6H3z M7 14V9 M17 14V9 M7 17h.01 M11 17h.01 M9 6.5a4 4 0 0 1 6 0 M6.5 4a7.5 7.5 0 0 1 11 0',
  server: 'M4 4h16v6H4z M4 14h16v6H4z M7.5 7h.01 M7.5 17h.01 M11 7h6 M11 17h6',
  cloud:
    'M7 19h10.5a4.5 4.5 0 0 0 .4-8.98A6.5 6.5 0 0 0 5.4 11.2 4 4 0 0 0 7 19z',
  database:
    'M4 6c0-1.66 3.58-3 8-3s8 1.34 8 3-3.58 3-8 3-8-1.34-8-3z M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6 M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3',
  chip: 'M7 7h10v10H7z M10 10h4v4h-4z M9 3v4 M15 3v4 M9 17v4 M15 17v4 M3 9h4 M3 15h4 M17 9h4 M17 15h4',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4 M12 15v2',
  globe:
    'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  sun: 'M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  pill: 'M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7z M8.5 8.5l7 7',
  thermometer: 'M14 14.8V4.5a2 2 0 0 0-4 0v10.3a4 4 0 1 0 4 0z M12 9v8',
  clock: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 7v5l3 2',
  money: 'M2 6h20v12H2z M9.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0 M6 9h.01 M18 15h.01',
  chart: 'M3 3v18h18 M7 16v1 M11 11v6 M15 7v10 M19 12v5',
  person: 'M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  document: 'M6 2h8l5 5v15H6z M14 2v5h5 M9 13h7 M9 17h7',
  rocket:
    'M12 2c3 2.5 4.5 6 4.5 10l-2 4h-5l-2-4c0-4 1.5-7.5 4.5-10z M7.5 12l-3 3 1 3 3-2 M16.5 12l3 3-1 3-3-2 M10.5 19.5l1.5 2.5 1.5-2.5 M12 9h.01',
  flag: 'M5 21V3 M5 4h12l-2.5 4 2.5 4H5',
  camera: 'M3 8h4l2-3h6l2 3h4v11H3z M9 13a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  footprint:
    'M8 3c1.7 0 2.5 2 2.5 4.5S9.7 13 8 13s-2.5-3-2.5-5.5S6.3 3 8 3z M6 16h4v1.5a2 2 0 0 1-4 0z M16 6c1.7 0 2.5 2 2.5 4.5S17.7 16 16 16s-2.5-3-2.5-5.5S14.3 6 16 6z M14 19h4',
};

// A glyph for a node without one, by what kind of piece it is.
const BY_KIND: Record<ExploreNode['kind'], NodeIcon> = {
  idea: 'globe',
  step: 'chip',
  claim: 'document',
  event: 'clock',
  person: 'person',
  number: 'chart',
};

const BY_PHASE: Record<NonNullable<ExploreNode['phase']>, NodeIcon> = {
  day: 'sun',
  morning: 'sun',
  evening: 'moon',
  night: 'moon',
};

export const glyphFor = (n: ExploreNode): NodeIcon =>
  n.icon ?? (n.phase ? BY_PHASE[n.phase] : BY_KIND[n.kind]);

export const Glyph = ({
  name,
  size = 24,
  color,
  strokeWidth = 1.75,
}: {
  name: NodeIcon;
  size?: number;
  color: string;
  strokeWidth?: number;
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" testID={`glyph-${name}`}>
    <Path
      d={GLYPHS[name]}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </Svg>
);
