import React from 'react';
import Svg, {Path} from '@amazon-devices/react-native-svg';

// A few 24-unit glyphs drawn as single SVG paths (shapes after Material Icons,
// Apache-2.0). Drawn, not font-based, so they render the same on every device.
const PATHS = {
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  shared:
    'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z',
  phone:
    'M17 1.01 7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  panel: 'M3 5v14h18V5H3zm11 12H5V7h9v10zm5 0h-3V7h3v10z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
} as const;

export type IconName = keyof typeof PATHS;

export const Icon = ({
  name,
  size = 24,
  color,
}: {
  name: IconName;
  size?: number;
  color: string;
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d={PATHS[name]} fill={color} />
  </Svg>
);
