import {Answer, EpisodeAnalysis, Segment, Widget} from './schema';

// Fast-path composer: picks what the co-viewer panel shows for the moment the
// viewer paused. The same rules run in the cloud composer before the model
// refines the card (architecture.md §4.3); here they run locally on fixtures.

export const WINDOW_BEFORE = 15;
export const WINDOW_AFTER = 4;
const MAX_WIDGETS = 3;
// The caption when no moment has been reached; the panel never shows it.
export const NOTHING_YET = 'Nothing analysed for this moment yet.';

export interface PanelCard {
  t: number;
  caption: string;
  segment?: Segment;
  widgets: Widget[];
  // True once the live co-viewer has refined this card in place.
  refined?: boolean;
}

const overlap = (a0: number, a1: number, b0: number, b1: number) =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

// Higher score = more relevant to [t - 15, t + 4]. Evidence that has already
// been heard counts more than evidence just ahead of the playhead.
function score(w: Widget, t: number): number {
  const from = t - WINDOW_BEFORE;
  const to = t + WINDOW_AFTER;
  let best = 0;
  for (const e of w.evidence) {
    const heard = overlap(e.t0, e.t1, from, t);
    const ahead = overlap(e.t0, e.t1, t, to) * 0.4;
    const recency = e.t1 <= t ? 1 / (1 + (t - e.t1) / 5) : 1;
    best = Math.max(best, (heard + ahead) * recency);
  }
  return best;
}

export function composeCard(analysis: EpisodeAnalysis, t: number): PanelCard {
  const segment = analysis.segments.find((s) => t >= s.start && t < s.end);
  const moment = [...analysis.moments].reverse().find((m) => m.t <= t + 0.5);
  const widgets = analysis.widgets
    .map((w) => ({w, s: score(w, t)}))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_WIDGETS)
    .map((x) => x.w);
  return {
    t,
    caption: moment?.caption ?? NOTHING_YET,
    segment,
    widgets,
  };
}

export const formatTime = (s: number) => {
  const total = Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0;
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
};

// Merges a live refine reply into the instant local card, in place: the
// caption is replaced, a widget with a known id replaces its twin, a new one
// is appended (never prepended, so the focused row does not move); on a full
// card it takes the last, least relevant slot.
export function mergeRefined(
  card: PanelCard,
  refine: {caption?: string; widget?: Widget} | null,
): PanelCard {
  if (!refine) {
    return card;
  }
  let widgets = card.widgets;
  const w = refine.widget;
  if (w) {
    const at = widgets.findIndex((x) => x.id === w.id);
    widgets =
      at >= 0
        ? widgets.map((x, i) => (i === at ? w : x))
        : [...widgets.slice(0, MAX_WIDGETS - 1), w];
  }
  return {
    ...card,
    caption: refine.caption ?? card.caption,
    widgets,
    refined: true,
  };
}

// Suggested questions for the moment: the latest answers whose question was
// raised by the playhead (+4 s, the same look-ahead as the cards).
export function suggestedQuestions(
  analysis: EpisodeAnalysis,
  t: number,
  max = 2,
): Answer[] {
  return (analysis.answers ?? [])
    .filter((a) => a.t <= t + WINDOW_AFTER)
    .sort((a, b) => b.t - a.t)
    .slice(0, max);
}

// Timestamps an answer points at: its `cites` plus any [m:ss] in the text.
export function answerStamps(text: string, cites: number[], max = 4) {
  const inline: number[] = [];
  const re = /\[(\d{1,3}):([0-5]\d)\]/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    inline.push(Number(m[1]) * 60 + Number(m[2]));
  }
  return [...new Set([...cites, ...inline])]
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b)
    .slice(0, max);
}
