// The contract between the analysis agents and the TV (docs/product/architecture.md §4.1).
// Agents emit widgets; the TV owns one renderer per type. Everything that
// arrives from the network passes through `validateWidget` first.

export interface Evidence {
  t0: number; // seconds into the episode
  t1: number;
}

interface Base {
  id: string;
  evidence: Evidence[];
  // A short card title written by the curator AI (≤ 70 chars). Absent: the
  // TV cuts one from the title or claim at a word boundary (cardText.ts).
  headline?: string;
  // A curiosity question for a questionable claim (≤ 48 chars), shown in
  // the insight banner during playback.
  teaser?: string;
}

export const HEADLINE_MAX = 70;
export const TEASER_MAX = 48;

// A web source behind a card. Only https URLs survive validation.
export interface Source {
  title: string;
  url: string;
  quote?: string;
  date?: string;
}

// Verdict labels come from the pipeline's rule table (backend/CONTRACTS.md §4).
export const VERDICTS = [
  'SUPPORTED',
  'NUANCED',
  'DISPUTED',
  'DEBUNKED',
  'UNVERIFIED',
] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface DossierWidget extends Base {
  type: 'dossier';
  name: string;
  role: string;
  facts: Array<{text: string; source?: string; evidence?: Evidence}>;
  // A portrait (https only), drawn as a circle with its credit line.
  image?: {url: string; credit: string};
}

export interface TimelineWidget extends Base {
  type: 'timeline';
  title: string;
  events: Array<{
    id: string;
    when: string;
    label: string;
    kind?: 'claim' | 'fact' | 'conflict';
    evidence: Evidence;
  }>;
}

export interface RelationGraphWidget extends Base {
  type: 'relation_graph';
  title: string;
  // x/y are laid out by the backend in a 0..1 box; the TV only scales them.
  nodes: Array<{
    id: string;
    label: string;
    kind: 'person' | 'place' | 'object';
    x: number;
    y: number;
  }>;
  edges: Array<{from: string; to: string; label: string; conflict?: boolean}>;
}

export interface EntityListWidget extends Base {
  type: 'entity_list';
  title: string;
  kind: 'compound' | 'protocol' | 'book' | 'study' | 'other';
  items: Array<{
    name: string;
    dose?: string;
    asSaid: string;
    evidence: Evidence;
  }>;
  disclaimer?: string;
}

export interface ProtocolWidget extends Base {
  type: 'protocol';
  title: string;
  steps: Array<{label: string; detail: string; evidence: Evidence}>;
  disclaimer?: string;
}

export interface TechniqueWidget extends Base {
  type: 'technique';
  title: string;
  // `box` animates a dot around a square (breathing); `bars` fills cycles in turn.
  shape: 'box' | 'bars';
  phases: Array<{label: string; seconds: number}>;
  caption: string;
}

export interface ClaimWidget extends Base {
  type: 'claim';
  claim: string;
  speaker: string;
  context: string;
  source?: string;
  counter?: string;
  verdict?: Verdict;
  sources?: Source[];
}

export type Widget =
  | DossierWidget
  | TimelineWidget
  | RelationGraphWidget
  | EntityListWidget
  | ProtocolWidget
  | TechniqueWidget
  | ClaimWidget;

export interface Segment {
  id: string;
  start: number;
  end: number;
  title: string;
  genre: 'crime' | 'health' | 'science' | 'general';
}

export interface Moment {
  t: number;
  caption: string;
}

export interface TranscriptLine {
  t0: number;
  t1: number;
  speaker: string;
  text: string;
}

// A precomputed answer to a suggested question (package `answers`). `cites`
// are seconds into the episode; the TV draws them as [m:ss] chips that seek.
export interface Answer {
  question: string;
  t: number;
  text: string;
  cites: number[];
  sources: Source[];
  // Set when the question belongs to a Map node (CONTRACTS.md §9).
  mapNode?: string;
}

export interface EpisodeAnalysis {
  mediaId: string;
  provenance: 'demo-fixture' | 'pipeline';
  transcript: TranscriptLine[];
  segments: Segment[];
  moments: Moment[];
  widgets: Widget[];
  // Package fields (backend/CONTRACTS.md §3); optional in fixtures.
  answers?: Answer[];
  generatedAt?: string;
  version?: number;
  // The Map (CONTRACTS.md §9): present only when valid and eligible.
  explore?: Explore;
  // A cameo package: an example map with no video (`title` names it).
  example?: boolean;
  title?: string;
}

// ---- validation -------------------------------------------------------------

const LIMITS = {
  text: 160,
  items: 12,
  nodes: 12,
  edges: 20,
  events: 20,
  phases: 12,
};

const isStr = (v: unknown, max = LIMITS.text): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isEvidence = (v: unknown): v is Evidence => {
  const e = v as Evidence;
  return !!e && isNum(e.t0) && isNum(e.t1) && e.t1 >= e.t0;
};
const isHttps = (v: unknown): v is string =>
  isStr(v, 500) &&
  /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(v);
const list = <T>(v: unknown, max: number, each: (x: unknown) => boolean) =>
  Array.isArray(v) && v.length > 0 && v.length <= max && v.every(each)
    ? (v as T[])
    : null;

// Returns the widget if it is well-formed and within limits, otherwise null.
// Untrusted input: the caller drops nulls rather than rendering partial data.
// An over-long or malformed `headline`/`teaser` is dropped on its own (the
// card falls back to its title), never the whole widget.
export function validateWidget(raw: unknown): Widget | null {
  const w = validateBody(raw);
  if (!w) {
    return null;
  }
  const {headline, teaser, ...rest} = w;
  const out: Widget = {...rest} as Widget;
  const h = typeof headline === 'string' ? headline.trim() : '';
  const q = typeof teaser === 'string' ? teaser.trim() : '';
  if (isStr(h, HEADLINE_MAX)) {
    out.headline = h;
  }
  if (isStr(q, TEASER_MAX)) {
    out.teaser = q;
  }
  return out;
}

function validateBody(raw: unknown): Widget | null {
  const w = raw as Widget;
  if (!w || !isStr(w.id, 64) || !list(w.evidence, 8, isEvidence)) {
    return null;
  }
  switch (w.type) {
    case 'dossier': {
      if (
        !isStr(w.name, 60) ||
        !isStr(w.role, 80) ||
        !list(w.facts, 6, (f) => isStr((f as {text: string}).text))
      ) {
        return null;
      }
      // An invalid portrait is dropped; the card itself still renders.
      const {image, ...rest} = w;
      return image && isHttps(image.url) && isStr(image.credit, 80)
        ? {...rest, image: {url: image.url, credit: image.credit}}
        : rest;
    }
    case 'timeline':
      return isStr(w.title, 60) &&
        list(w.events, LIMITS.events, (e) => {
          const ev = e as TimelineWidget['events'][number];
          return (
            isStr(ev.id, 32) &&
            isStr(ev.when, 24) &&
            isStr(ev.label) &&
            isEvidence(ev.evidence)
          );
        })
        ? w
        : null;
    case 'relation_graph': {
      const nodes = list<RelationGraphWidget['nodes'][number]>(
        w.nodes,
        LIMITS.nodes,
        (n) => {
          const nd = n as RelationGraphWidget['nodes'][number];
          return (
            isStr(nd.id, 32) &&
            isStr(nd.label, 32) &&
            isNum(nd.x) &&
            nd.x <= 1 &&
            isNum(nd.y) &&
            nd.y <= 1
          );
        },
      );
      if (!isStr(w.title, 60) || !nodes) {
        return null;
      }
      const ids = new Set(nodes.map((n) => n.id));
      return list(w.edges, LIMITS.edges, (e) => {
        const ed = e as RelationGraphWidget['edges'][number];
        return ids.has(ed.from) && ids.has(ed.to) && isStr(ed.label, 32);
      })
        ? w
        : null;
    }
    case 'entity_list':
      return isStr(w.title, 60) &&
        list(w.items, LIMITS.items, (i) => {
          const it = i as EntityListWidget['items'][number];
          return (
            isStr(it.name, 60) && isStr(it.asSaid) && isEvidence(it.evidence)
          );
        })
        ? w
        : null;
    case 'protocol':
      return isStr(w.title, 60) &&
        list(w.steps, 8, (s) => {
          const st = s as ProtocolWidget['steps'][number];
          return (
            isStr(st.label, 40) && isStr(st.detail) && isEvidence(st.evidence)
          );
        })
        ? w
        : null;
    case 'technique':
      return isStr(w.title, 60) &&
        (w.shape === 'box' || w.shape === 'bars') &&
        isStr(w.caption) &&
        list(w.phases, LIMITS.phases, (p) => {
          const ph = p as TechniqueWidget['phases'][number];
          return isStr(ph.label, 24) && isNum(ph.seconds) && ph.seconds > 0;
        })
        ? w
        : null;
    case 'claim': {
      if (!isStr(w.claim) || !isStr(w.speaker, 60) || !isStr(w.context, 280)) {
        return null;
      }
      // Unknown verdicts and non-https sources are not drawn.
      const {verdict, sources, ...rest} = w;
      const clean: ClaimWidget = {...rest};
      if (VERDICTS.includes(verdict as Verdict)) {
        clean.verdict = verdict;
      }
      const srcs = validateSources(sources);
      if (srcs.length) {
        clean.sources = srcs;
      }
      return clean;
    }
    default:
      return null;
  }
}

// Keeps up to `max` well-formed https sources; drops the rest.
export function validateSources(raw: unknown, max = 4): Source[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Source[] = [];
  for (const item of raw.slice(0, 16)) {
    const s = item as Source;
    if (out.length >= max) {
      break;
    }
    if (!s || !isStr(s.title, 140) || !isHttps(s.url)) {
      continue;
    }
    const src: Source = {title: s.title, url: s.url};
    if (isStr(s.quote, 240)) {
      src.quote = s.quote;
    }
    if (isStr(s.date, 32)) {
      src.date = s.date;
    }
    out.push(src);
  }
  return out;
}

const validCites = (raw: unknown) =>
  Array.isArray(raw)
    ? [...new Set(raw.filter(isNum).map((n) => Math.floor(n)))].slice(0, 6)
    : [];

// The body of an answer: package `answers[i]` or a live `POST /v1/ask` reply.
export function validateAnswerBody(
  raw: unknown,
): Pick<Answer, 'text' | 'cites' | 'sources'> | null {
  const a = raw as Answer;
  if (!a || !isStr(a.text, 900)) {
    return null;
  }
  return {
    text: a.text,
    cites: validCites(a.cites),
    sources: validateSources(a.sources),
  };
}

export function validateAnswer(raw: unknown): Answer | null {
  const a = raw as Answer;
  const body = validateAnswerBody(raw);
  if (!body || !isStr(a.question, 140) || !isNum(a.t)) {
    return null;
  }
  const out: Answer = {question: a.question, t: a.t, ...body};
  if (isStr(a.mapNode, 32)) {
    out.mapNode = a.mapNode;
  }
  return out;
}

// The live refine reply: a new caption and at most one widget.
export function validateRefine(
  raw: unknown,
): {caption?: string; widget?: Widget} | null {
  const r = raw as {caption?: unknown; widget?: unknown};
  if (!r || typeof r !== 'object') {
    return null;
  }
  const caption = isStr(r.caption, 200) ? r.caption : undefined;
  const widget = r.widget ? validateWidget(r.widget) ?? undefined : undefined;
  return caption || widget ? {caption, widget} : null;
}

export function validateAnalysis(raw: EpisodeAnalysis): EpisodeAnalysis {
  return {
    ...raw,
    widgets: raw.widgets
      .map(validateWidget)
      .filter((w): w is Widget => w !== null),
    answers: (raw.answers ?? [])
      .map(validateAnswer)
      .filter((a): a is Answer => a !== null),
  };
}

const MAX = {
  transcript: 2000,
  segments: 60,
  moments: 300,
  widgets: 80,
  answers: 40,
};

const isSegment = (v: unknown): v is Segment => {
  const s = v as Segment;
  return (
    !!s &&
    isStr(s.id, 32) &&
    isNum(s.start) &&
    isNum(s.end) &&
    s.end >= s.start &&
    isStr(s.title, 80) &&
    ['crime', 'health', 'science', 'general'].includes(s.genre)
  );
};
const isMoment = (v: unknown): v is Moment => {
  const m = v as Moment;
  return !!m && isNum(m.t) && isStr(m.caption, 200);
};
const isLine = (v: unknown): v is TranscriptLine => {
  const l = v as TranscriptLine;
  return (
    !!l &&
    isNum(l.t0) &&
    isNum(l.t1) &&
    l.t1 >= l.t0 &&
    isStr(l.speaker, 60) &&
    isStr(l.text, 400)
  );
};
const arr = (v: unknown, max: number) =>
  Array.isArray(v) ? (v.slice(0, max) as unknown[]) : null;

// Validates a whole episode package fetched from the network (or bundled).
// Returns null unless it is for `mediaId` and keeps at least one widget;
// invalid items inside it are dropped one by one.
export function validatePackage(
  raw: unknown,
  mediaId: string,
): EpisodeAnalysis | null {
  const p = raw as Record<string, unknown>;
  if (!p || typeof p !== 'object' || p.mediaId !== mediaId) {
    return null;
  }
  const widgets = arr(p.widgets, MAX.widgets);
  const segments = arr(p.segments, MAX.segments);
  const moments = arr(p.moments, MAX.moments);
  if (!widgets || !segments || !moments) {
    return null;
  }
  const generatedAt =
    isStr(p.generatedAt, 40) && Number.isFinite(Date.parse(p.generatedAt))
      ? p.generatedAt
      : undefined;
  const explore = validateExplore(p.explore) ?? undefined;
  const example = p.example === true;
  const analysis = validateAnalysis({
    mediaId,
    provenance: p.provenance === 'pipeline' ? 'pipeline' : 'demo-fixture',
    transcript: (arr(p.transcript, MAX.transcript) ?? []).filter(isLine),
    segments: segments.filter(isSegment),
    moments: moments.filter(isMoment).sort((a, b) => a.t - b.t),
    widgets: widgets as Widget[],
    answers: (arr(p.answers, MAX.answers) ?? []) as Answer[],
    generatedAt,
    version: isNum(p.version) ? p.version : undefined,
    explore,
    example: example || undefined,
    title: isStr(p.title, 80) ? p.title : undefined,
  });
  // A cameo carries a map and no cards; every other package needs a card.
  return analysis.widgets.length > 0 || (example && explore) ? analysis : null;
}

// ---- the Map (CONTRACTS.md §9) ----------------------------------------------

export const EXPLORE_CATEGORIES = [
  'health',
  'crime',
  'finance',
  'history',
  'tech',
  'motivation',
  'scifi',
  'other',
] as const;
export type ExploreCategory = (typeof EXPLORE_CATEGORIES)[number];
export const EXPLORE_LAYOUTS = ['flow', 'timeline', 'compare', 'cluster'] as const;
export type ExploreLayout = (typeof EXPLORE_LAYOUTS)[number];
export const NODE_KINDS = [
  'idea',
  'step',
  'claim',
  'event',
  'person',
  'number',
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];
export const EDGE_KINDS = ['then', 'because', 'supports', 'contradicts'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

// Built-in glyphs the TV draws for a node (CONTRACTS §10); unknown names drop.
export const NODE_ICONS = [
  'tv', 'phone', 'wifi', 'router', 'server', 'cloud', 'database', 'chip',
  'lock', 'globe', 'moon', 'sun', 'pill', 'thermometer', 'clock', 'money',
  'chart', 'person', 'document', 'rocket', 'flag', 'camera', 'footprint',
] as const;
export type NodeIcon = (typeof NODE_ICONS)[number];
export const NODE_PHASES = ['day', 'evening', 'night', 'morning'] as const;
export type NodePhase = (typeof NODE_PHASES)[number];

export interface NodeImage {
  url: string; // https only
  credit: string; // always shown with the image
}

export interface ExploreGroup {
  id: string;
  title: string;
}

export interface ExploreNode {
  id: string;
  group: string;
  kind: NodeKind;
  label: string;
  detail: string;
  t: number | null;
  t1: number | null;
  when: string | null;
  value: {n: number; unit: string} | null;
  verdict: Verdict | null;
  refs: string[];
  sim: string | null;
  icon: NodeIcon | null;
  image: NodeImage | null;
  phase: NodePhase | null;
}

export interface ExploreEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  label: string | null;
}

export interface NightParams {
  cycleMinutes: number;
  cycles: number;
  bedtime: number; // minutes after midnight; past midnight is 1440 + m
  quote: string | null;
  quoteT: number | null;
  steps: NightStep[]; // evening steps before bedtime, at most 4
}

export interface NightStep {
  label: string; // <= 32
  offsetMin: number; // minutes relative to bedtime, -240..0
  icon: NodeIcon | null;
}

export interface GrowthParams {
  start: number;
  monthly: number;
  ratePct: number;
  years: number;
  laterYears: number;
  currency: string | null;
  quote: string | null;
  quoteT: number | null;
  labels: [string, string] | null; // e.g. "Start at 25", "Start at 35"
  startAges: [number, number] | null;
}

export type ExploreSim =
  | {id: string; engine: 'night'; title: string; params: NightParams}
  | {id: string; engine: 'growth'; title: string; params: GrowthParams};

export interface ExploreQuestion {
  nodeId: string;
  t: number;
  question: string;
}

export interface Explore {
  eligible: true;
  reason: string;
  category: ExploreCategory;
  // Spoiler locks are drawn only for crime or a suspense story (§10).
  suspense: boolean;
  layout: ExploreLayout;
  title: string;
  summary: string;
  groups: ExploreGroup[];
  nodes: ExploreNode[];
  edges: ExploreEdge[];
  sims: ExploreSim[];
  questions: ExploreQuestion[];
}

export const EXPLORE_LIMITS = {
  label: 44,
  detail: 200,
  when: 16,
  title: 48,
  summary: 120,
  reason: 120,
  groupTitle: 32,
  edgeLabel: 24,
  groups: [1, 5],
  nodes: [3, 12],
  edges: 16,
  sims: 2,
  questions: 4,
} as const;

const ID_RE = /^[A-Za-z0-9_.:-]{1,32}$/;
const isId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);
const oneOf = <T extends string>(all: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (all as readonly string[]).includes(v);
const optStr = (v: unknown, max: number): string | null | undefined => {
  if (v === null || v === undefined || v === '') {
    return null;
  }
  return isStr(v, max) ? v : undefined; // undefined = invalid
};
const optNum = (v: unknown): number | null | undefined => {
  if (v === null || v === undefined) {
    return null;
  }
  return isNum(v) ? v : undefined;
};
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
// A finite number clamped into [lo, hi]; anything else is `fallback`.
const bounded = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;

function validateNode(raw: unknown, groups: Set<string>): ExploreNode | null {
  const n = raw as Record<string, unknown>;
  if (!n || typeof n !== 'object' || !isId(n.id) || !isId(n.group)) {
    return null;
  }
  if (!groups.has(n.group) || !oneOf(NODE_KINDS, n.kind)) {
    return null;
  }
  if (!isStr(n.label, EXPLORE_LIMITS.label)) {
    return null;
  }
  const detail = optStr(n.detail, EXPLORE_LIMITS.detail);
  const when = optStr(n.when, EXPLORE_LIMITS.when);
  const t = optNum(n.t);
  const t1 = optNum(n.t1);
  if (detail === undefined || when === undefined) {
    return null;
  }
  if (t === undefined || t1 === undefined) {
    return null;
  }
  let value: ExploreNode['value'] = null;
  const v = n.value as {n?: unknown; unit?: unknown} | null | undefined;
  if (v !== null && v !== undefined) {
    if (
      typeof v !== 'object' ||
      typeof v.n !== 'number' ||
      !Number.isFinite(v.n) ||
      !(v.unit === undefined || v.unit === null || typeof v.unit === 'string') ||
      (typeof v.unit === 'string' && v.unit.length > 12)
    ) {
      return null;
    }
    value = {n: v.n, unit: typeof v.unit === 'string' ? v.unit : ''};
  }
  return {
    id: n.id,
    group: n.group,
    kind: n.kind,
    label: n.label,
    detail: detail ?? '',
    t,
    t1: t !== null && t1 !== null && t1 >= t ? t1 : null,
    when,
    value,
    // Copied from a referenced claim upstream; an unknown word is dropped.
    verdict: oneOf(VERDICTS, n.verdict) ? n.verdict : null,
    refs: Array.isArray(n.refs)
      ? n.refs.filter((r): r is string => isStr(r, 64)).slice(0, 8)
      : [],
    sim: isId(n.sim) ? n.sim : null,
    icon: oneOf(NODE_ICONS, n.icon) ? n.icon : null,
    image: validImage(n.image),
    phase: oneOf(NODE_PHASES, n.phase) ? n.phase : null,
  };
}

// An https image with a credit, or nothing: never an image without its credit.
function validImage(raw: unknown): NodeImage | null {
  const im = raw as {url?: unknown; credit?: unknown} | null | undefined;
  if (!im || typeof im !== 'object') {
    return null;
  }
  if (!isStr(im.url, 400) || !/^https:\/\/[^\s]+$/.test(im.url)) {
    return null;
  }
  if (!isStr(im.credit, 120) || !im.credit.trim()) {
    return null;
  }
  return {url: im.url, credit: im.credit};
}

function nightSteps(raw: unknown): NightStep[] {
  const out: NightStep[] = [];
  for (const x of Array.isArray(raw) ? raw.slice(0, 8) : []) {
    const st = x as Record<string, unknown>;
    if (st && isStr(st.label, 32) && isNum(st.offsetMin)) {
      out.push({
        label: st.label,
        offsetMin: Math.round(clamp(st.offsetMin, -240, 0)),
        icon: oneOf(NODE_ICONS, st.icon) ? st.icon : null,
      });
    }
    if (out.length === 4) {
      break;
    }
  }
  return out.sort((a, b) => a.offsetMin - b.offsetMin);
}

function validateSim(raw: unknown): ExploreSim | null {
  const s = raw as Record<string, unknown>;
  if (!s || typeof s !== 'object' || !isId(s.id)) {
    return null;
  }
  const title = isStr(s.title, EXPLORE_LIMITS.title) ? s.title : null;
  const p = (s.params ?? {}) as Record<string, unknown>;
  const quote = isStr(p.quote, 200) ? p.quote : null;
  const quoteT = isNum(p.quoteT) ? p.quoteT : null;
  switch (s.engine) {
    case 'night': {
      // Bedtime is minutes after midnight and wraps at 1440: 00:30 may arrive
      // as 30 or as 1470.
      let bed = typeof p.bedtime === 'number' ? p.bedtime : 1380;
      if (Number.isFinite(bed) && bed >= 0 && bed < 1200 && bed + 1440 <= 1560) {
        bed += 1440;
      }
      return {
        id: s.id,
        engine: 'night',
        title: title ?? 'Plan your night',
        params: {
          cycleMinutes: Math.round(bounded(p.cycleMinutes, 60, 120, 90)),
          cycles: Math.round(bounded(p.cycles, 3, 6, 5)),
          bedtime: Math.round(bounded(bed, 1200, 1560, 1380)),
          quote,
          quoteT,
          steps: nightSteps(p.steps),
        },
      };
    }
    case 'growth':
      return {
        id: s.id,
        engine: 'growth',
        title: title ?? 'See it grow',
        params: {
          start: bounded(p.start, 0, 1e9, 0),
          monthly: bounded(p.monthly, 0, 1e7, 100),
          ratePct: bounded(p.ratePct, 0, 30, 5),
          years: Math.round(bounded(p.years, 1, 50, 30)),
          laterYears: Math.round(bounded(p.laterYears, 0, 30, 0)),
          currency:
            typeof p.currency === 'string' && /^[A-Z]{3}$/.test(p.currency)
              ? p.currency
              : null,
          quote,
          quoteT,
          labels:
            Array.isArray(p.labels) &&
            p.labels.length === 2 &&
            p.labels.every((l) => isStr(l, 20))
              ? [p.labels[0] as string, p.labels[1] as string]
              : null,
          startAges:
            Array.isArray(p.startAges) &&
            p.startAges.length === 2 &&
            p.startAges.every((a) => isNum(a) && a >= 0 && a <= 100)
              ? [p.startAges[0] as number, p.startAges[1] as number]
              : null,
        },
      };
    default:
      return null; // unknown engine: dropped
  }
}

// Ordered events on a timeline need either a `when` or their own moment.
const timedNodes = (nodes: ExploreNode[]) => {
  const ts = new Set<number>();
  let n = 0;
  for (const node of nodes) {
    if (node.when) {
      n++;
    } else if (node.t !== null && !ts.has(node.t)) {
      ts.add(node.t);
      n++;
    }
  }
  return n;
};

// The package's `explore` block, bounded and checked; null means no Map.
// Invalid nodes, edges, sims and questions are dropped one by one, then the
// eligibility rule runs on what is left (an AI can propose a map; code
// decides whether there is one).
export function validateExplore(raw: unknown): Explore | null {
  const e = raw as Record<string, unknown>;
  if (!e || typeof e !== 'object' || e.eligible !== true) {
    return null;
  }
  if (
    !oneOf(EXPLORE_LAYOUTS, e.layout) ||
    !isStr(e.title, EXPLORE_LIMITS.title)
  ) {
    return null;
  }
  const summary = optStr(e.summary, EXPLORE_LIMITS.summary);
  const reason = optStr(e.reason, EXPLORE_LIMITS.reason);
  if (summary === undefined || reason === undefined) {
    return null;
  }
  const groups: ExploreGroup[] = [];
  for (const g of arr(e.groups, EXPLORE_LIMITS.groups[1]) ?? []) {
    const gr = g as ExploreGroup;
    if (
      gr &&
      isId(gr.id) &&
      isStr(gr.title, EXPLORE_LIMITS.groupTitle) &&
      !groups.some((x) => x.id === gr.id)
    ) {
      groups.push({id: gr.id, title: gr.title});
    }
  }
  if (groups.length < EXPLORE_LIMITS.groups[0]) {
    return null;
  }
  const groupIds = new Set(groups.map((g) => g.id));
  const nodes: ExploreNode[] = [];
  for (const n of arr(e.nodes, 24) ?? []) {
    const node = validateNode(n, groupIds);
    if (node && !nodes.some((x) => x.id === node.id)) {
      nodes.push(node);
    }
    if (nodes.length === EXPLORE_LIMITS.nodes[1]) {
      break;
    }
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: ExploreEdge[] = [];
  for (const x of arr(e.edges, 32) ?? []) {
    const ed = x as Record<string, unknown>;
    if (
      !ed ||
      !isId(ed.from) ||
      !isId(ed.to) ||
      ed.from === ed.to ||
      !ids.has(ed.from) ||
      !ids.has(ed.to) ||
      !oneOf(EDGE_KINDS, ed.kind)
    ) {
      continue;
    }
    const label = optStr(ed.label, EXPLORE_LIMITS.edgeLabel);
    if (label === undefined) {
      continue;
    }
    if (edges.some((o) => o.from === ed.from && o.to === ed.to)) {
      continue;
    }
    edges.push({from: ed.from, to: ed.to, kind: ed.kind, label});
    if (edges.length === EXPLORE_LIMITS.edges) {
      break;
    }
  }
  const sims: ExploreSim[] = [];
  for (const x of arr(e.sims, 8) ?? []) {
    const sim = validateSim(x);
    if (sim && !sims.some((o) => o.id === sim.id)) {
      sims.push(sim);
    }
    if (sims.length === EXPLORE_LIMITS.sims) {
      break;
    }
  }
  const simIds = new Set(sims.map((s) => s.id));
  const cleanNodes = nodes.map((n) =>
    n.sim && !simIds.has(n.sim) ? {...n, sim: null} : n,
  );
  const questions: ExploreQuestion[] = [];
  for (const x of arr(e.questions, 8) ?? []) {
    const q = x as ExploreQuestion;
    if (q && isId(q.nodeId) && ids.has(q.nodeId) && isNum(q.t) && isStr(q.question, 140)) {
      questions.push({nodeId: q.nodeId, t: q.t, question: q.question});
    }
    if (questions.length === EXPLORE_LIMITS.questions) {
      break;
    }
  }

  // Eligibility, in code after the agent.
  if (cleanNodes.length < EXPLORE_LIMITS.nodes[0]) {
    return null;
  }
  const layout = e.layout;
  if ((layout === 'flow' || layout === 'cluster') && edges.length < 2) {
    return null;
  }
  if (layout === 'timeline' && timedNodes(cleanNodes) < 3) {
    return null;
  }
  const category = oneOf(EXPLORE_CATEGORIES, e.category) ? e.category : 'other';
  return {
    eligible: true,
    reason: reason ?? '',
    category,
    // Code decides: crime always locks; other genres only if flagged suspense,
    // and never the explainer genres.
    suspense:
      category === 'crime' ||
      (e.suspense === true && (category === 'scifi' || category === 'other')),
    layout,
    title: e.title,
    summary: summary ?? '',
    groups: groups.filter((g) => cleanNodes.some((n) => n.group === g.id)),
    nodes: cleanNodes,
    edges,
    sims,
    questions,
  };
}
