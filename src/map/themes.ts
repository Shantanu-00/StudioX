import {ExploreCategory} from '../analysis/schema';

// Genre themes for the Map and its simulations (CONTRACTS §10). The app chrome
// stays monochrome (theme.ts); only the Map's scene takes the genre's colours.
// Each theme has one background, one surface, one accent and one supporting
// colour. Text on a theme is always `ink` / `inkSoft`, never the accent, so
// contrast holds whatever the genre.
//
// Focus on a scene stays the app's white fill for text rows, plus a 2 dp
// `ring` around shapes (portraits, nodes, glyph buttons), so focus never relies
// on colour alone.

export type Motif =
  | 'caseboard' // pinned cards, red string, paper grain
  | 'nightsky' // stars, moon and sun on an arc, slow pulse
  | 'signal' // grid, glowing links, packets travelling along edges
  | 'ledger' // ruled lines, rising bars
  | 'archive' // warm paper, photographs, a date rail
  | 'plain';

export interface MapTheme {
  motif: Motif;
  bg: string; // scene background
  bgDeep: string; // second stop for gradients and the far sky
  surface: string; // a node or card at rest
  line: string; // edges, rules, grid
  accent: string; // the genre colour: string, glow, highlight
  accentSoft: string; // accent at low alpha, fills and halos
  support: string; // second colour: moon, gold, cyan pulse
  ink: string; // primary text
  inkSoft: string; // secondary text
  ring: string; // focus ring around shapes
  mood: string; // one word for the accessibility label, "case board"
}

const INK = '#F5F5F7';
const INK_SOFT = 'rgba(235,235,245,0.66)';

export const THEMES: Record<ExploreCategory, MapTheme> = {
  crime: {
    motif: 'caseboard',
    bg: '#0A0A0A',
    bgDeep: '#1A0606',
    surface: '#161212',
    line: 'rgba(255,69,58,0.55)',
    accent: '#E0182D',
    accentSoft: 'rgba(224,24,45,0.18)',
    support: '#F5F5F7',
    ink: INK,
    inkSoft: INK_SOFT,
    ring: '#FFFFFF',
    mood: 'case board',
  },
  health: {
    motif: 'nightsky',
    bg: '#050814',
    bgDeep: '#0E1530',
    surface: '#121A33',
    line: 'rgba(170,190,255,0.30)',
    accent: '#E0182D', // the first R90 scene's crimson pulse
    accentSoft: 'rgba(224,24,45,0.20)',
    support: '#F2E6C9', // moonlight
    ink: INK,
    inkSoft: INK_SOFT,
    ring: '#FFFFFF',
    mood: 'night sky',
  },
  tech: {
    motif: 'signal',
    bg: '#03070A',
    bgDeep: '#071722',
    surface: '#0B1A24',
    line: 'rgba(100,210,255,0.28)',
    accent: '#64D2FF',
    accentSoft: 'rgba(100,210,255,0.16)',
    support: '#BF5AF2',
    ink: INK,
    inkSoft: INK_SOFT,
    ring: '#FFFFFF',
    mood: 'signal',
  },
  scifi: {
    motif: 'signal',
    bg: '#04030A',
    bgDeep: '#120A26',
    surface: '#151028',
    line: 'rgba(191,90,242,0.30)',
    accent: '#BF5AF2',
    accentSoft: 'rgba(191,90,242,0.18)',
    support: '#64D2FF',
    ink: INK,
    inkSoft: INK_SOFT,
    ring: '#FFFFFF',
    mood: 'deep space',
  },
  finance: {
    motif: 'ledger',
    bg: '#040806',
    bgDeep: '#0A1A12',
    surface: '#0F1F17',
    line: 'rgba(48,209,88,0.25)',
    accent: '#30D158',
    accentSoft: 'rgba(48,209,88,0.16)',
    support: '#FFD60A',
    ink: INK,
    inkSoft: INK_SOFT,
    ring: '#FFFFFF',
    mood: 'ledger',
  },
  history: {
    motif: 'archive',
    bg: '#0D0A07',
    bgDeep: '#1E160D',
    surface: '#221A11',
    line: 'rgba(255,190,110,0.30)',
    accent: '#FF9F0A',
    accentSoft: 'rgba(255,159,10,0.16)',
    support: '#E8D9BF', // old paper
    ink: INK,
    inkSoft: INK_SOFT,
    ring: '#FFFFFF',
    mood: 'archive',
  },
  motivation: {
    motif: 'plain',
    bg: '#000000',
    bgDeep: '#121214',
    surface: '#1C1C1E',
    line: 'rgba(235,235,245,0.22)',
    accent: '#FF9F0A',
    accentSoft: 'rgba(255,159,10,0.14)',
    support: '#F5F5F7',
    ink: INK,
    inkSoft: INK_SOFT,
    ring: '#FFFFFF',
    mood: 'plain',
  },
  other: {
    motif: 'plain',
    bg: '#000000',
    bgDeep: '#121214',
    surface: '#1C1C1E',
    line: 'rgba(235,235,245,0.22)',
    accent: '#F5F5F7',
    accentSoft: 'rgba(235,235,245,0.10)',
    support: '#F5F5F7',
    ink: INK,
    inkSoft: INK_SOFT,
    ring: '#FFFFFF',
    mood: 'plain',
  },
};

export const themeFor = (c: ExploreCategory): MapTheme => THEMES[c] ?? THEMES.other;
