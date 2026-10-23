import {formatTime} from '../../analysis/composer';
import {ExploreNode} from '../../analysis/schema';
import type {Motif} from '../themes';

// Text and card measurement for the Map, so every box is sized for its words
// and nothing is cut off. There is no text measurement before layout on the
// TV, so widths are estimated at 0.55 × fontSize per character (Amazon Ember
// averages a little under that, so the estimate errs on the roomy side) and
// lines are counted by greedy word wrap. Pure, so tested.

export const CHAR_EM = 0.55;

export const textWidth = (s: string, fontSize: number) =>
  s.length * CHAR_EM * fontSize;

// How many lines `s` takes in `width` dp at `fontSize`.
export function wrapLines(s: string, width: number, fontSize: number): number {
  const words = s.trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return 0;
  }
  const cw = CHAR_EM * fontSize;
  const max = Math.max(cw, width);
  let lines = 1;
  let x = 0;
  for (const word of words) {
    const w = word.length * cw;
    if (x > 0 && x + cw + w <= max) {
      x += cw + w;
      continue;
    }
    if (x > 0) {
      lines++;
    }
    // A word longer than the line breaks across lines.
    x = w;
    while (x > max) {
      lines++;
      x -= max;
    }
  }
  return lines;
}

// Font size and line height of the four sizes (theme.ts `type`).
export const SIZE = {
  title: [24, 30],
  headline: [19, 25],
  body: [15, 21],
  caption: [13, 18],
} as const;
export type SizeName = keyof typeof SIZE;

export const linesHeight = (s: string, width: number, size: SizeName) =>
  wrapLines(s, width, SIZE[size][0]) * SIZE[size][1];

// ---- words shown on a node ---------------------------------------------------

export const KIND_WORD: Record<ExploreNode['kind'], string> = {
  idea: 'Idea',
  step: 'Step',
  claim: 'Claim',
  event: 'Event',
  person: 'Person',
  number: 'Number',
};

// The small line above a node's label: its `when`, else when it was said.
export function nodeMeta(node: ExploreNode, withTime: boolean): string {
  if (node.when) {
    return node.when;
  }
  if (withTime && node.t !== null) {
    return `${KIND_WORD[node.kind]} · ${formatTime(node.t)}`;
  }
  return KIND_WORD[node.kind];
}

// "1,200 %", "37%", "$5,000": a figure as one short string.
export function valueText(v: {n: number; unit: string}): string {
  const n = Math.abs(v.n) >= 1000 ? Math.round(v.n) : Math.round(v.n * 100) / 100;
  const digits = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const unit = v.unit.trim();
  if (!unit) {
    return digits;
  }
  if (/^[$£€₹¥]$/.test(unit)) {
    return `${unit}${digits}`;
  }
  return unit === '%' ? `${digits}%` : `${digits} ${unit}`;
}

// A figure the episode states or works out (§10): shown large, and never with
// a verdict, which belongs to claims only. A node carrying a value is drawn
// as a figure whatever its kind.
export const isNumber = (n: ExploreNode) => n.kind === 'number' || n.value !== null;

// The verdict word shown beside the meta line, if any.
export const showsVerdict = (n: ExploreNode) => !!n.verdict && !isNumber(n);

export const creditText = (credit: string) =>
  /^photo\b/i.test(credit.trim()) ? credit.trim() : `Photo: ${credit.trim()}`;

// The one-line credit under a map card's photo: who and the licence, without
// the host and the photographer's aside ("NASA (Michael Collins) · Public
// domain · Wikimedia Commons" → "Photo: NASA · Public domain"). The full
// credit stays on the step card and the detail sheet.
export const cardCredit = (credit: string) =>
  creditText(
    credit
      .split('·')
      .map((x) => x.replace(/\s*\([^)]*\)/g, '').trim())
      .filter((x) => x && !/wikimedia commons|wikipedia/i.test(x))
      .join(' · '),
  );

// ---- a node's card -------------------------------------------------------------

// What a node's card shows, decided at layout time from the room it has, so
// the renderer draws exactly what was measured. Text blocks stack top to
// bottom with CARD.gap between them: meta row, value, label, bar. With a
// photo, they sit beside a square thumbnail, and the credit runs underneath.
export interface NodeFace {
  pad: number;
  meta: boolean; // the kind/when line, and the verdict for claims
  glyph: boolean; // a line glyph at the start of the meta row
  value: boolean; // the figure, large
  bar: number | null; // ledger: the figure's share of the largest, 0..1
  image: boolean; // the photo, always with its credit
  small: boolean; // the label at caption size (the densest maps)
}

export const CARD = {
  gap: 4,
  thumb: 64, // the photo, square (big enough to read a face at 10 feet)
  thumbGap: 8,
  glyph: 20,
  glyphW: 28, // the glyph and the space after it
  barH: 6,
} as const;

export interface FaceContext {
  motif: Motif;
  // The largest figure on the map, for the ledger bars.
  maxValue: number;
}

export const DENSITIES = [0, 1, 2, 3] as const;

// The meta line at its longest: a time is assumed even when there is no
// video, so the box is never too small for either case.
const metaGuess = (n: ExploreNode) => n.when ?? `${KIND_WORD[n.kind]} · 00:00`;
const VERDICT_GUESS = '  ·  Needs context';

// Glyphs belong to the scenes: every device tile on the signal board, and
// any node with an icon (or, under the night sky, a phase) elsewhere.
export const wantsGlyph = (n: ExploreNode, motif: Motif) =>
  motif === 'signal' ||
  (motif !== 'plain' && (n.icon !== null || (motif === 'nightsky' && n.phase !== null)));
export const wantsImage = (n: ExploreNode, motif: Motif) =>
  n.image !== null && (motif === 'archive' || n.kind === 'person');

// The face of a node at a density: 0 is the roomiest, 3 the tightest.
export function faceFor(
  n: ExploreNode,
  w: number,
  density: number,
  ctx: FaceContext,
): NodeFace {
  const pad = density === 0 ? 12 : 8;
  const inner = w - 2 * pad;
  const value = isNumber(n) && n.value !== null;
  const image =
    density < 3 &&
    wantsImage(n, ctx.motif) &&
    !!n.image &&
    wrapLines(cardCredit(n.image.credit), inner, SIZE.caption[0]) <= 2;
  return {
    pad,
    meta: density < 2 && !value,
    glyph: density < 3 && wantsGlyph(n, ctx.motif),
    value,
    bar:
      ctx.motif === 'ledger' && value && ctx.maxValue > 0
        ? Math.min(1, Math.abs(n.value!.n) / ctx.maxValue)
        : null,
    image,
    small: density === 3,
  };
}

export function metaRowHeight(n: ExploreNode, inner: number, face: NodeFace) {
  const width = inner - (face.glyph ? CARD.glyphW : 0);
  let lines = 0;
  if (face.meta) {
    const meta = metaGuess(n);
    lines = wrapLines(meta, width, SIZE.caption[0]);
    if (showsVerdict(n) && textWidth(meta + VERDICT_GUESS, SIZE.caption[0]) > width) {
      lines += 1;
    }
  }
  return Math.max(lines * SIZE.caption[1], face.glyph ? CARD.glyph : 0);
}

// The width the text blocks have: beside the thumbnail when there is one.
export const textWidthIn = (inner: number, face: NodeFace) =>
  face.image ? inner - CARD.thumb - CARD.thumbGap : inner;

export function nodeHeight(n: ExploreNode, w: number, face: NodeFace): number {
  const inner = w - 2 * face.pad;
  const tw = textWidthIn(inner, face);
  const blocks: number[] = [];
  const metaH = metaRowHeight(n, tw, face);
  if (metaH) {
    blocks.push(metaH);
  }
  if (face.value && n.value) {
    blocks.push(linesHeight(valueText(n.value), tw, 'title'));
  }
  blocks.push(linesHeight(n.label, tw, face.small ? 'caption' : 'body'));
  if (face.bar !== null) {
    blocks.push(CARD.barH);
  }
  let h = blocks.reduce((s, b) => s + b, 0) + CARD.gap * (blocks.length - 1);
  if (face.image && n.image) {
    h =
      Math.max(CARD.thumb, h) +
      CARD.gap +
      linesHeight(cardCredit(n.image.credit), inner, 'caption');
  }
  return Math.ceil(2 * face.pad + h);
}

// ---- the header and the story caption -----------------------------------------

export interface HeaderFit {
  title: 'title' | 'headline';
  summary: 'body' | 'caption';
}

// The Map's header (context, title, summary) in `maxH`: the title steps down
// to the headline size, then the summary to the caption size, so all of it
// wraps in the room above the map.
export function fitHeader(
  width: number,
  maxH: number,
  context: string,
  title: string,
  summary: string,
): HeaderFit {
  const tries: HeaderFit[] = [
    {title: 'title', summary: 'body'},
    {title: 'headline', summary: 'body'},
    {title: 'headline', summary: 'caption'},
  ];
  for (const f of tries) {
    const h =
      linesHeight(context, width, 'caption') +
      linesHeight(title, width, f.title) +
      (summary ? linesHeight(summary, width, f.summary) : 0);
    if (h <= maxH) {
      return f;
    }
  }
  return tries[tries.length - 1];
}

export interface CaptionFit {
  label: 'headline' | 'body';
  detail: 'body' | 'caption';
  // The detail as shown: in full, its first sentence, or nothing (the full
  // text is always one SELECT away, in the node's sheet).
  text: string | null;
}

const firstSentence = (s: string) => {
  const m = s.match(/^.*?[.!?](?=\s|$)/);
  return m && m[0].length < s.length ? m[0] : null;
};

export function fitCaption(
  width: number,
  maxH: number,
  label: string,
  detail: string,
): CaptionFit {
  const META = SIZE.caption[1] + CARD.gap;
  const short = detail ? firstSentence(detail) : null;
  const tries: CaptionFit[] = [
    {label: 'headline', detail: 'body', text: detail || null},
    {label: 'body', detail: 'body', text: detail || null},
    {label: 'body', detail: 'caption', text: detail || null},
    {label: 'body', detail: 'caption', text: short},
    {label: 'body', detail: 'caption', text: null},
  ];
  for (const f of tries) {
    const h =
      META +
      linesHeight(label, width, f.label) +
      (f.text ? CARD.gap + linesHeight(f.text, width, f.detail) : 0);
    if (h <= maxH) {
      return f;
    }
  }
  return tries[tries.length - 1];
}
