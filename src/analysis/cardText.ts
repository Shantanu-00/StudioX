import {
  ClaimWidget,
  DossierWidget,
  HEADLINE_MAX,
  Source,
  TEASER_MAX,
  Verdict,
  Widget,
} from './schema';

// Short, bounded text for the collapsed co-viewer cards and the insight
// banner. Everything here is pure so it is tested without rendering.

// Cuts `text` to at most `max` characters at a word boundary, with an
// ellipsis when anything was cut.
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) {
    return t;
  }
  const room = t.slice(0, max - 1);
  const space = room.lastIndexOf(' ');
  const cut = space > max * 0.5 ? room.slice(0, space) : room;
  return `${cut.replace(/[\s,;:.–-]+$/, '')}…`;
}

// "SHADOW FILES · CASE 104" → "Shadow Files · Case 104": no all-caps labels
// on screen, whatever case the data arrives in.
export const displayCase = (s: string) =>
  s.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a: string, b: string) =>
    a + b.toLowerCase(),
  );

// The first sentence of a passage (whole passage if it has no full stop).
export function firstSentence(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  return m ? m[1] : t;
}

// What a card is, as a small uppercase label.
export const KIND_LABEL: Record<Widget['type'], string> = {
  claim: 'Fact check',
  entity_list: 'Mentioned',
  protocol: 'Routine',
  timeline: 'Timeline',
  dossier: 'Person',
  relation_graph: 'Connections',
  technique: 'Try it',
};

const stripQuotes = (s: string) => s.replace(/^["“]+|["”]+$/g, '');

// The card headline: the curator's `headline`, else the card's own title
// (the claim itself for a fact check), cut to 70 characters.
export function headlineOf(w: Widget): string {
  if (w.headline) {
    return w.headline;
  }
  switch (w.type) {
    case 'claim':
      return clip(stripQuotes(w.claim), HEADLINE_MAX);
    case 'dossier':
      return clip(w.name, HEADLINE_MAX);
    default:
      return clip(w.title, HEADLINE_MAX);
  }
}

export const DEFAULT_TEASER = 'Is that claim true?';

export const teaserOf = (w: Widget) =>
  w.teaser ? clip(w.teaser, TEASER_MAX) : DEFAULT_TEASER;

// Verdicts worth interrupting playback for: anything that did not hold up
// as stated. SUPPORTED claims (and claims with no verdict) stay quiet.
export const isQuestionable = (w: Widget): w is ClaimWidget & {
  verdict: Verdict;
} => w.type === 'claim' && !!w.verdict && w.verdict !== 'SUPPORTED';

// The 1–2 sentence "why" under a verdict: the caveat if there is one, else
// the context, cut to its first sentence.
export const whyOf = (w: ClaimWidget) =>
  firstSentence(w.counter ?? w.context);

export const domainOf = (url: string) =>
  url
    .replace(/^https:\/\//i, '')
    .split(/[/?#:]/)[0]
    .replace(/^www\./i, '')
    .toLowerCase();

// One compact source line, "title · domain · date". Pipeline titles often
// already end in "· domain" or are only the domain; neither is repeated.
export function sourceLine(s: Source): string {
  const domain = domainOf(s.url);
  let title = s.title.trim();
  const suffix = ` · ${domain}`;
  if (title.toLowerCase().endsWith(suffix)) {
    title = title.slice(0, -suffix.length).trim();
  }
  if (title.toLowerCase() === domain) {
    title = '';
  }
  return [title, domain, s.date].filter(Boolean).join(' · ');
}

// Sources without repeats (the same page is often cited twice).
export function uniqueSources(sources: Source[] = [], max = 3): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    const key = s.url.replace(/[?#].*$/, '');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

// "Marcus Vance" → ["Marcus", "Vance"]; longer names keep the rest on line 2.
export function nameLines(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) {
    return [parts[0] ?? '', ''];
  }
  return [parts[0], parts.slice(1).join(' ')];
}

export const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter((p) => /^[A-Za-z]/.test(p))
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');

// The first evidence timestamp a card points at (where "Jump to" goes).
export function jumpTarget(w: Widget): number | null {
  switch (w.type) {
    case 'dossier':
      return w.facts.find((f) => f.evidence)?.evidence?.t0 ?? w.evidence[0]?.t0;
    default:
      return w.evidence[0]?.t0 ?? null;
  }
}

// People in the ribbon: dossiers whose evidence starts at or before `t`
// (relevant now or earlier in the episode), most recent first, at most 4.
export function peopleAt(
  widgets: Widget[],
  t: number,
  lookAhead: number,
  max = 4,
): DossierWidget[] {
  return widgets
    .filter((w): w is DossierWidget => w.type === 'dossier')
    .filter((w) => w.evidence.some((e) => e.t0 <= t + lookAhead))
    .slice(0, max);
}
