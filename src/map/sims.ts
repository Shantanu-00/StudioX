import {GrowthParams} from '../analysis/schema';

// The maths behind the Map's simulations. The catalog is compiled into the
// TV: the AI picks an engine and its bounded parameters, the TV computes.

// ---- night: sleep in whole cycles ---------------------------------------------

export const BEDTIME_STEP = 15; // minutes per LEFT/RIGHT
export const BEDTIME_MIN = 1200; // 20:00
export const BEDTIME_MAX = 1560; // 02:00 the next day
export const CYCLES_MIN = 3;
export const CYCLES_MAX = 6;
export const CYCLE_LEN_MIN = 60; // contract bounds (CONTRACTS §9)
export const CYCLE_LEN_MAX = 120;
export const CYCLE_LEN_STEP = 5;

const clampTo = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export interface NightPlan {
  bedtime: number; // minutes after midnight (may exceed 1440)
  cycles: number;
  cycleMinutes: number;
  wake: number; // minutes after midnight of the first day
  sleepMinutes: number;
}

export function nightPlan(
  bedtime: number,
  cycles: number,
  cycleMinutes: number,
): NightPlan {
  const bed = clampTo(bedtime, BEDTIME_MIN, BEDTIME_MAX);
  const n = clampTo(Math.round(cycles), CYCLES_MIN, CYCLES_MAX);
  const len = clampTo(Math.round(cycleMinutes), CYCLE_LEN_MIN, CYCLE_LEN_MAX);
  const sleepMinutes = n * len;
  return {
    bedtime: bed,
    cycles: n,
    cycleMinutes: len,
    wake: bed + sleepMinutes,
    sleepMinutes,
  };
}

// 24-hour clock, wrapping at midnight: 1470 → "00:30".
export const clock = (minutesAfterMidnight: number) => {
  const m = ((Math.round(minutesAfterMidnight) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(
    m % 60,
  ).padStart(2, '0')}`;
};

// "7 h 30 min", "6 h".
export const hoursAndMinutes = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

export const nightHeadline = (p: NightPlan) =>
  `Lights out ${clock(p.bedtime)} → wake ${clock(p.wake)}`;

// Short durations for headlines and deltas: "15 min", "1 h 30 m", "2 h".
export const shortDuration = (minutes: number) => {
  const a = Math.abs(Math.round(minutes));
  const h = Math.floor(a / 60);
  const m = a % 60;
  return h === 0 ? `${m} min` : m ? `${h} h ${m} m` : `${h} h`;
};

// "+15 min", "−1 h 30 m" (a true minus sign).
export const signedDuration = (minutes: number) =>
  `${minutes < 0 ? '−' : '+'}${shortDuration(minutes)}`;

// What the numbers mean, in one sentence.
export const nightSentence = (p: NightPlan) =>
  `${nightHeadline(p)}: ${p.cycles} full cycles, ${shortDuration(p.sleepMinutes)}`;

// ---- night: what the remote changes ---------------------------------------------

export type NightField = 'bedtime' | 'cycles' | 'cycleMinutes';

export interface NightState {
  plan: NightPlan;
  // The last change, kept until the next one: which value, the delta chip,
  // and a counter so the same field changing twice still flashes.
  last: {field: NightField; text: string; seq: number} | null;
}

export const nightInit = (p: {
  bedtime: number;
  cycles: number;
  cycleMinutes: number;
}): NightState => ({
  plan: nightPlan(p.bedtime, p.cycles, p.cycleMinutes),
  last: null,
});

// The delta chip for one change, or null when nothing changed (at a bound).
export function nightDelta(
  field: NightField,
  a: NightPlan,
  b: NightPlan,
): string | null {
  switch (field) {
    case 'bedtime':
      return a.bedtime === b.bedtime
        ? null
        : `Wake ${clock(a.wake)} → ${clock(b.wake)} (${signedDuration(
            b.wake - a.wake,
          )})`;
    case 'cycles':
      return a.cycles === b.cycles
        ? null
        : `${a.cycles} → ${b.cycles} cycles · ${signedDuration(
            b.sleepMinutes - a.sleepMinutes,
          )} sleep`;
    case 'cycleMinutes':
      return a.cycleMinutes === b.cycleMinutes
        ? null
        : `${a.cycleMinutes} → ${b.cycleMinutes} min cycles · ${signedDuration(
            b.sleepMinutes - a.sleepMinutes,
          )} sleep`;
  }
}

// One LEFT (-1) or RIGHT (+1) on a value. Bounded: at a limit the state is
// returned unchanged, so held keys cost nothing.
export function nightStep(
  s: NightState,
  field: NightField,
  dir: 1 | -1,
): NightState {
  const p = s.plan;
  const next =
    field === 'bedtime'
      ? nightPlan(p.bedtime + dir * BEDTIME_STEP, p.cycles, p.cycleMinutes)
      : field === 'cycles'
      ? nightPlan(p.bedtime, p.cycles + dir, p.cycleMinutes)
      : nightPlan(p.bedtime, p.cycles, p.cycleMinutes + dir * CYCLE_LEN_STEP);
  const text = nightDelta(field, p, next);
  if (text === null) {
    return s;
  }
  return {plan: next, last: {field, text, seq: (s.last?.seq ?? 0) + 1}};
}

// ---- night: the scene's geometry ----------------------------------------------

export interface NightLayout {
  bedX: number; // lights out, on the horizon
  wakeX: number; // the end of the last cycle
  pxPerMin: number;
  // Paths in the wave layer's own space: x from 0 at bedX, y from 0 at the
  // horizon, downwards. One quadratic dip per cycle, so a point's depth is
  // exactly 4·depth·t(1−t) (see waveDepth).
  humps: string;
  ghosts: string; // the cycles you could still add, up to CYCLES_MAX
  // The elliptical arc from lights out to waking, in the arc layer's space:
  // x from 0 at bedX, y from 0 at the top of the sky.
  arc: string;
  junctions: {x: number; minute: number}[]; // absolute x, minutes after lights out
  centers: {x: number; n: number}[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

// `headroom` is the span the sleep side of the scene is scaled to, in
// minutes, so one more cycle moves the wake point instead of rescaling.
export function nightLayout(
  plan: NightPlan,
  opt: {
    left: number;
    width: number;
    eveW: number;
    depth: number;
    skyH: number;
    arcH: number;
    headroom: number;
  },
): NightLayout {
  const sleepW = opt.width - opt.eveW;
  const span = Math.max(opt.headroom, plan.sleepMinutes, 1);
  const k = sleepW / span;
  const bedX = opt.left + opt.eveW;
  const cell = plan.cycleMinutes * k;
  const dip = (i: number) =>
    `Q${r1(i * cell + cell / 2)} ${r1(2 * opt.depth)} ${r1((i + 1) * cell)} 0`;
  let humps = 'M0 0';
  const junctions = [{x: bedX, minute: 0}];
  const centers: {x: number; n: number}[] = [];
  for (let i = 0; i < plan.cycles; i++) {
    humps += ` ${dip(i)}`;
    junctions.push({x: r1(bedX + (i + 1) * cell), minute: (i + 1) * plan.cycleMinutes});
    centers.push({x: r1(bedX + i * cell + cell / 2), n: i + 1});
  }
  let ghosts = '';
  for (let i = plan.cycles; i < CYCLES_MAX && (i + 1) * cell <= sleepW + 0.5; i++) {
    ghosts += `${ghosts ? ' ' : ''}M${r1(i * cell)} 0 ${dip(i)}`;
  }
  const rx = (plan.cycles * cell) / 2;
  return {
    bedX,
    wakeX: r1(bedX + plan.cycles * cell),
    pxPerMin: k,
    humps,
    ghosts,
    arc: `M0 ${opt.skyH} A${r1(rx)} ${opt.arcH} 0 0 1 ${r1(2 * rx)} ${opt.skyH}`,
    junctions,
    centers,
  };
}

// A point on the arc at fraction f (0 at lights out, 1 at waking). Runs on
// the UI thread too.
export function arcPoint(
  f: number,
  x0: number,
  x1: number,
  base: number,
  height: number,
): {x: number; y: number} {
  'worklet';
  const cx = (x0 + x1) / 2;
  const rx = (x1 - x0) / 2;
  return {
    x: cx - rx * Math.cos(Math.PI * f),
    y: base - height * Math.sin(Math.PI * f),
  };
}

// How deep the wave is at fraction p of the night, for n cycles.
export function waveDepth(p: number, n: number, depth: number): number {
  'worklet';
  if (p <= 0 || p >= 1 || n <= 0) {
    return 0;
  }
  const f = p * n;
  const t = f - Math.floor(f);
  return 4 * depth * t * (1 - t);
}

// "−30 min", "−1 h 30 m", "At lights out".
export const offsetText = (offsetMin: number) =>
  offsetMin === 0 ? 'At lights out' : signedDuration(offsetMin);

// Evening steps as markers on the horizon before lights out: earliest at the
// left, at least `gap` apart, never on top of the sunset.
export function stepMarkers<T extends {offsetMin: number}>(
  steps: T[],
  bedX: number,
  eveW: number,
  gap: number,
): Array<T & {x: number}> {
  if (steps.length === 0) {
    return [];
  }
  const earliest = Math.min(...steps.map((s) => s.offsetMin));
  const pre = clampTo(Math.ceil(Math.max(60, -earliest) / 30) * 30, 60, 240);
  const usable = eveW - gap;
  const sorted = [...steps].sort((a, b) => a.offsetMin - b.offsetMin);
  const xs = sorted.map((s) => bedX + (s.offsetMin / pre) * usable);
  let limit = bedX - gap;
  for (let i = xs.length - 1; i >= 0; i--) {
    xs[i] = Math.min(xs[i], limit);
    limit = xs[i] - gap;
  }
  return sorted.map((s, i) => ({...s, x: r1(xs[i])}));
}

// A crescent: the lit disc minus a second disc offset to one side, drawn as
// one path from the two circles' intersection points (outer arc, then the
// inner arc back), so it needs no mask.
export function crescentPath(cx: number, cy: number, r: number) {
  const d = r * 0.62; // centre offset of the shadow disc (same radius)
  const ix = cx + d / 2; // two equal circles at distance d meet at x = cx + d/2
  const iy = Math.sqrt(r * r - (d / 2) * (d / 2));
  const f = (n: number) => Math.round(n * 100) / 100;
  return `M${f(ix)} ${f(cy - iy)} A${r} ${r} 0 1 0 ${f(ix)} ${f(cy + iy)} A${r} ${r} 0 0 1 ${f(ix)} ${f(cy - iy)} Z`;
}

// The next calendar occurrence of a clock time after `now`, as an ISO
// string, for the phone's reminder card.
export function nextOccurrence(minutesAfterMidnight: number, now: Date): string {
  const m = ((Math.round(minutesAfterMidnight) % 1440) + 1440) % 1440;
  const at = new Date(now.getTime());
  at.setHours(Math.floor(m / 60), m % 60, 0, 0);
  if (at.getTime() <= now.getTime()) {
    at.setDate(at.getDate() + 1);
  }
  return at.toISOString();
}

// ---- growth: the same saving started now or later -----------------------------

export const YEARS_MIN = 1;
export const YEARS_MAX = 50;
export const RATE_MIN = 0;
export const RATE_MAX = 30;
export const RATE_STEP = 0.5;
export const MONTHLY_MAX = 1e7;

// Value after `months` of saving `monthly` on top of `start`, compounding
// monthly at `ratePct` a year (contributions at the end of each month).
export function futureValue(
  start: number,
  monthly: number,
  ratePct: number,
  months: number,
): number {
  if (months <= 0) {
    return start;
  }
  const i = ratePct / 100 / 12;
  if (i === 0) {
    return start + monthly * months;
  }
  const g = Math.pow(1 + i, months);
  return start * g + (monthly * (g - 1)) / i;
}

export interface GrowthPoint {
  year: number;
  now: number;
  later: number;
  paid: number; // what the "start now" saver has paid in by then
}

// One point a year for both curves. The later curve is nothing until it
// starts, then grows by the same rules for the years that remain.
export function growthSeries(
  p: Pick<GrowthParams, 'start' | 'monthly' | 'ratePct' | 'laterYears'>,
  years: number,
): GrowthPoint[] {
  const out: GrowthPoint[] = [];
  for (let y = 0; y <= years; y++) {
    const laterMonths = (y - p.laterYears) * 12;
    out.push({
      year: y,
      now: futureValue(p.start, p.monthly, p.ratePct, y * 12),
      later:
        laterMonths < 0
          ? 0
          : futureValue(p.start, p.monthly, p.ratePct, laterMonths),
      paid: p.start + p.monthly * 12 * y,
    });
  }
  return out;
}

// A round step for UP/DOWN on the monthly amount: about a tenth of the
// starting amount, on a 1-2-5 scale, at least 10.
export function monthlyStep(initial: number): number {
  const target = Math.max(10, initial / 10);
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  const m = target / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

const SYMBOL: Record<string, string> = {
  USD: '$',
  GBP: '£',
  EUR: '€',
  INR: '₹',
  JPY: '¥',
  AUD: 'A$',
  CAD: 'C$',
};

const grouped = (n: number) =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Whole currency units. Intl when the runtime has it, else a simple form.
export function money(n: number, currency: string | null): string {
  const v = Math.max(0, Math.round(n));
  if (currency) {
    try {
      if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
        return new Intl.NumberFormat('en', {
          style: 'currency',
          currency,
          maximumFractionDigits: 0,
          minimumFractionDigits: 0,
        }).format(v);
      }
    } catch {
      // Hermes without full Intl data: fall through to the simple form.
    }
    const sym = SYMBOL[currency];
    return sym ? `${sym}${grouped(v)}` : `${currency} ${grouped(v)}`;
  }
  return grouped(v);
}


// "7%", "7.5%".
export const percent = (r: number) => `${Math.round(r * 10) / 10}%`;

// "+$50", "−$1,200" (a true minus sign).
export const signedMoney = (n: number, currency: string | null) =>
  `${n < 0 ? '−' : '+'}${money(Math.abs(n), currency)}`;

// Axis money: "$250k", "$1.5m", "900".
export function compactMoney(n: number, currency: string | null): string {
  const v = Math.max(0, Math.round(n));
  const trim = (x: number) => String(x < 10 ? Math.round(x * 10) / 10 : Math.round(x));
  const body = v < 1000 ? String(v) : v < 1e6 ? `${trim(v / 1e3)}k` : `${trim(v / 1e6)}m`;
  if (!currency) {
    return body;
  }
  const sym = SYMBOL[currency];
  return sym ? `${sym}${body}` : `${currency} ${body}`;
}

// The smallest 1-2-5 step at or above x.
export function niceStep(x: number): number {
  if (!(x > 0)) {
    return 1;
  }
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

// ---- growth: what the remote changes --------------------------------------------

export type GrowthField = 'monthly' | 'ratePct' | 'years';

export interface GrowthOutcome {
  now: number;
  later: number;
  gap: number;
  paidNow: number;
  paidLater: number;
}

type GrowthBase = Pick<GrowthParams, 'start' | 'laterYears'>;

export interface GrowthValues {
  monthly: number;
  ratePct: number;
  years: number;
}

export function growthOutcome(base: GrowthBase, v: GrowthValues): GrowthOutcome {
  const now = futureValue(base.start, v.monthly, v.ratePct, v.years * 12);
  const laterMonths = (v.years - base.laterYears) * 12;
  const later =
    laterMonths < 0 ? 0 : futureValue(base.start, v.monthly, v.ratePct, laterMonths);
  return {
    now,
    later,
    gap: now - later,
    paidNow: base.start + v.monthly * 12 * v.years,
    paidLater: laterMonths < 0 ? 0 : base.start + v.monthly * laterMonths,
  };
}

export interface GrowthState extends GrowthValues {
  last: {
    field: GrowthField;
    text: string; // "+$50 a month"
    before: GrowthOutcome; // the outcome before this change, for its deltas
    seq: number;
  } | null;
}

export const growthInit = (p: GrowthValues): GrowthState => ({
  monthly: p.monthly,
  ratePct: p.ratePct,
  years: p.years,
  last: null,
});

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// The tile's delta: "+$50 a month", "−0.5% a year", "+1 year".
export function growthDelta(
  field: GrowthField,
  a: number,
  b: number,
  currency: string | null,
): string | null {
  if (a === b) {
    return null;
  }
  const d = b - a;
  const sign = d < 0 ? '−' : '+';
  const abs = Math.abs(d);
  switch (field) {
    case 'monthly':
      return `${signedMoney(d, currency)} a month`;
    case 'ratePct':
      return `${sign}${percent(abs)} a year`;
    case 'years':
      return `${sign}${abs} ${plural(abs, 'year', 'years')}`;
  }
}

// One LEFT (-1) or RIGHT (+1) on a value, bounded. `monthlyStep` comes from
// the starting amount, so steps stay round.
export function growthStep(
  s: GrowthState,
  field: GrowthField,
  dir: 1 | -1,
  base: GrowthBase & {monthlyStep: number; currency: string | null},
): GrowthState {
  const next: GrowthValues = {monthly: s.monthly, ratePct: s.ratePct, years: s.years};
  if (field === 'monthly') {
    next.monthly = clampTo(s.monthly + dir * base.monthlyStep, 0, MONTHLY_MAX);
  } else if (field === 'ratePct') {
    next.ratePct = clampTo(Math.round((s.ratePct + dir * RATE_STEP) * 10) / 10, RATE_MIN, RATE_MAX);
  } else {
    next.years = clampTo(s.years + dir, YEARS_MIN, YEARS_MAX);
  }
  const text = growthDelta(field, s[field], next[field], base.currency);
  if (text === null) {
    return s;
  }
  return {
    ...next,
    last: {field, text, before: growthOutcome(base, s), seq: (s.last?.seq ?? 0) + 1},
  };
}

// An outcome's change: "+$52,496 (was $209,985)", or null when unchanged.
export function moneyChange(a: number, b: number, currency: string | null): string | null {
  const d = Math.round(b) - Math.round(a);
  return d === 0 ? null : `${signedMoney(d, currency)} (was ${money(a, currency)})`;
}

// The same change as one sentence, for the screen reader:
// "Start now: $209,985 → $262,481 (+$52,496)".
export const moneyArrow = (label: string, a: number, b: number, currency: string | null) =>
  `${label}: ${money(a, currency)} → ${money(b, currency)} (${signedMoney(
    Math.round(b) - Math.round(a),
    currency,
  )})`;

// ---- growth: the chart ----------------------------------------------------------

// The years the x axis spans: some room past the starting horizon, so a
// Years change moves the marker instead of rescaling the chart.
export const growthSpan = (initialYears: number, years: number) =>
  Math.min(YEARS_MAX, Math.max(years, Math.ceil((initialYears + 5) / 5) * 5));

// The top of the y axis: room above the starting curve, growing only when a
// change needs it.
export const growthTop = (initialEnd: number, currentEnd: number) =>
  Math.max(1, initialEnd * 1.15, currentEnd * 1.05);

export const yearTicks = (span: number) => {
  const step = span <= 10 ? 2 : span <= 25 ? 5 : 10;
  const out: number[] = [];
  for (let y = 0; y <= span; y += step) {
    out.push(y);
  }
  return out;
};

export const valueTicks = (top: number) => {
  const step = niceStep(top / 5);
  const out: number[] = [];
  for (let v = step; v < top * 0.97; v += step) {
    out.push(v);
  }
  return out;
};

export interface GrowthChart {
  now: string;
  later: string;
  paid: string;
  gap: string; // closed: the now curve out, the later curve (or zero) back
  nowEnd: number; // y of each curve's end
  laterEnd: number;
  paidEnd: number;
  endX: number; // the Years marker
  laterStartX: number;
  X: (year: number) => number;
  Y: (value: number) => number;
}

// The curves in a chart box, one point a year, on a fixed span and top.
export function growthChart(
  series: GrowthPoint[],
  box: {x: number; y: number; w: number; h: number},
  laterYears: number,
  span: number,
  top: number,
): GrowthChart {
  const X = (year: number) => r1(box.x + (year / Math.max(1, span)) * box.w);
  const Y = (v: number) => r1(box.y + box.h - (Math.min(v, top) / top) * box.h);
  const years = series.length - 1;
  const from = Math.min(laterYears, years);
  const pts = (list: GrowthPoint[], pick: (p: GrowthPoint) => number) =>
    list.map((p) => `${X(p.year)} ${Y(pick(p))}`);
  const tail = series.filter((p) => p.year >= from);
  const line = (list: string[]) => list.map((pt, i) => `${i ? 'L' : 'M'}${pt}`).join(' ');
  const last = series[years];
  const base = r1(box.y + box.h);
  return {
    now: line(pts(series, (p) => p.now)),
    later: line(pts(tail, (p) => p.later)),
    paid: `M${X(0)} ${Y(series[0].paid)} L${X(years)} ${Y(last.paid)}`,
    gap: `${line(pts(series, (p) => p.now))} ${pts([...tail].reverse(), (p) => p.later)
      .map((pt) => `L${pt}`)
      .join(' ')} L${X(from)} ${base} L${X(0)} ${base} Z`,
    nowEnd: Y(last.now),
    laterEnd: Y(last.later),
    paidEnd: Y(last.paid),
    endX: X(years),
    laterStartX: X(from),
    X,
    Y,
  };
}

// Stack labels near their wanted y without overlapping, inside [minY, maxY].
export function stackLabels(
  items: {key: string; y: number; h: number}[],
  minY: number,
  maxY: number,
  gap = 2,
): Record<string, number> {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const ys = sorted.map((i) => i.y);
  for (let i = 0; i < ys.length; i++) {
    const floor = i === 0 ? minY : ys[i - 1] + sorted[i - 1].h + gap;
    ys[i] = Math.max(ys[i], floor);
  }
  for (let i = ys.length - 1; i >= 0; i--) {
    const ceil = i === ys.length - 1 ? maxY - sorted[i].h : ys[i + 1] - sorted[i].h - gap;
    ys[i] = Math.max(minY, Math.min(ys[i], ceil));
  }
  const out: Record<string, number> = {};
  sorted.forEach((it, i) => {
    out[it.key] = Math.round(ys[i]);
  });
  return out;
}
