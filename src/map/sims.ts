import {GrowthParams} from '../analysis/schema';

// The maths behind the Map's simulations. The catalog is compiled into the
// TV: the AI picks an engine and its bounded parameters, the TV computes.

// ---- night: sleep in whole cycles ---------------------------------------------

export const BEDTIME_STEP = 15; // minutes per LEFT/RIGHT
export const BEDTIME_MIN = 1200; // 20:00
export const BEDTIME_MAX = 1560; // 02:00 the next day
export const CYCLES_MIN = 3;
export const CYCLES_MAX = 6;

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
  const bed = Math.min(BEDTIME_MAX, Math.max(BEDTIME_MIN, bedtime));
  const n = Math.min(CYCLES_MAX, Math.max(CYCLES_MIN, Math.round(cycles)));
  const sleepMinutes = n * cycleMinutes;
  return {
    bedtime: bed,
    cycles: n,
    cycleMinutes,
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

// The two curves as SVG paths in a chart box, one point a year. The y scale
// tops out at the larger final value, so the gap reads at the right edge.
export function growthPaths(
  series: GrowthPoint[],
  box: {x: number; y: number; w: number; h: number},
  laterYears: number,
): {now: string; later: string; nowEnd: number; laterEnd: number; laterStartX: number} {
  const years = Math.max(1, series.length - 1);
  const top = Math.max(1, ...series.map((p) => Math.max(p.now, p.later)));
  const X = (year: number) => Math.round((box.x + (year / years) * box.w) * 10) / 10;
  const Y = (v: number) => Math.round((box.y + box.h - (v / top) * box.h) * 10) / 10;
  const line = (pick: (p: GrowthPoint) => number, from: number) =>
    series
      .filter((p) => p.year >= from)
      .map((p, i) => `${i ? 'L' : 'M'}${X(p.year)} ${Y(pick(p))}`)
      .join(' ');
  const last = series[series.length - 1];
  const from = Math.min(laterYears, years);
  return {
    now: line((p) => p.now, 0),
    later: line((p) => p.later, from),
    nowEnd: Y(last.now),
    laterEnd: Y(last.later),
    laterStartX: X(from),
  };
}
