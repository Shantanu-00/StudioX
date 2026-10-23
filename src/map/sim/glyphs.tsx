import React from 'react';
import Svg, {Circle, Path} from '@amazon-devices/react-native-svg';
import {NodeIcon} from '../../analysis/schema';
import {crescentPath} from '../sims';

// Small 24-unit glyphs for the night scene's evening steps. Drawn, not
// font-based; anything without its own shape is a dot.
export const StepGlyph = ({
  icon,
  size,
  color,
}: {
  icon: NodeIcon | null;
  size: number;
  color: string;
}) => {
  const stroke = {stroke: color, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const};
  let body: React.ReactNode;
  switch (icon) {
    case 'pill':
      body = (
        <Path
          d="M4.6 19.4a4.5 4.5 0 0 1 0-6.36l8.48-8.48a4.5 4.5 0 0 1 6.36 6.36l-8.48 8.48a4.5 4.5 0 0 1-6.36 0z"
          fill={color}
        />
      );
      break;
    case 'thermometer':
      body = <Path d="M14 14.76V4a2 2 0 0 0-4 0v10.76a4 4 0 1 0 4 0z" fill={color} />;
      break;
    case 'moon':
      body = <Path d={crescentPath(12, 12, 9)} fill={color} />;
      break;
    case 'sun':
      body = (
        <>
          <Circle cx={12} cy={12} r={4.5} fill={color} />
          <Path
            d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"
            {...stroke}
          />
        </>
      );
      break;
    case 'clock':
      body = (
        <>
          <Circle cx={12} cy={12} r={9} {...stroke} />
          <Path d="M12 7v5l3 2" {...stroke} />
        </>
      );
      break;
    case 'phone':
      body = <Path d="M8 3h8v18H8z" {...stroke} />;
      break;
    case 'tv':
      body = <Path d="M3 5h18v11H3zM8 20h8" {...stroke} />;
      break;
    case 'document':
      body = <Path d="M6 3h8l4 4v14H6z" {...stroke} />;
      break;
    default:
      body = <Circle cx={12} cy={12} r={4} fill={color} />;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
};
