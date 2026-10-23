// StudioX 10-foot design tokens. Read docs/product/tv-ui-guidelines.md first.
//
// Units are dp on Vega's 960 x 540 dp canvas (scale factor 2 at 1080p: 1 dp =
// 2 px). This is the same coordinate space Android TV uses, so established TV
// type and spacing scales apply 1:1. Never size against 1920 x 1080.
//
// tvOS-grade restraint: monochrome, one family, four sizes. Hierarchy comes
// from size, weight and opacity, never from colour. One accent, used only for
// the insight banner dot and for claims that did not hold (debunked,
// disputed). Crimson exists only in the StudioX wordmark.

export const colors = {
  black: '#000000', // video area and page background
  panel: '#141416', // the co-viewer panel, rails (solid)
  card: '#1C1C1E', // a resting card or row, where a surface is needed
  text: '#F5F5F7', // primary text; also the focus fill
  textSecondary: 'rgba(235,235,245,0.62)',
  textTertiary: 'rgba(235,235,245,0.36)',
  onFocus: '#000000', // text on the focus fill
  accent: '#FF453A', // banner dot, debunked/disputed only
  brand: '#E0182D', // the X in the wordmark, nothing else
  // Functional, not decorative:
  banner: 'rgba(28,28,30,0.92)', // the insight banner surface over video
  scrim: 'rgba(0,0,0,0.55)', // flat bands behind controls over video
  track: 'rgba(235,235,245,0.18)', // progress and seek tracks
  plate: '#F5F5F7', // QR plate: scanners need dark on light
  ink: '#000000', // QR modules
} as const;

// Amazon Ember is Vega's system sans: no fontFamily anywhere means Ember.
// Exactly four sizes; weight changes stay within a size.
export const type = {
  title: {fontSize: 24, lineHeight: 30, fontWeight: '600' as const},
  headline: {fontSize: 19, lineHeight: 25, fontWeight: '600' as const},
  body: {fontSize: 15, lineHeight: 21, fontWeight: '400' as const},
  bodyStrong: {fontSize: 15, lineHeight: 21, fontWeight: '600' as const},
  caption: {fontSize: 13, lineHeight: 18, fontWeight: '400' as const},
  captionStrong: {fontSize: 13, lineHeight: 18, fontWeight: '600' as const},
};

// Timestamps: the same family with tabular figures, so digits do not jitter.
export const numeric = {fontVariant: ['tabular-nums' as const]};

// 8 dp grid. safeX/safeY are the 5% overscan margins of the canvas.
export const space = {
  xs: 8,
  s: 12,
  m: 16,
  l: 24,
  xl: 32,
  xxl: 48,
  safeX: 48,
  safeY: 27,
  rail: 72, // collapsed nav rail width
  content: 96, // left edge of page content
} as const;

export const radius = {row: 12, banner: 16} as const;

export const motion = {
  focusMs: 200, // ease-out, nothing bouncy
  fadeMs: 200,
} as const;
