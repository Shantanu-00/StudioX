import {crescentPath} from '../../src/map/NightSim';
import {
  clock,
  futureValue,
  growthPaths,
  growthSeries,
  hoursAndMinutes,
  money,
  monthlyStep,
  nextOccurrence,
  nightHeadline,
  nightPlan,
} from '../../src/map/sims';
import {nightReminderCard, nodeShareCard, valueText} from '../../src/map/mapData';

describe('night', () => {
  it('wakes at the end of the last whole cycle', () => {
    const p = nightPlan(23 * 60, 5, 90);
    expect(p.wake).toBe(23 * 60 + 450);
    expect(nightHeadline(p)).toBe('Lights out 23:00 → wake 06:30');
    expect(hoursAndMinutes(p.sleepMinutes)).toBe('7 h 30 min');
    expect(nightHeadline(nightPlan(23 * 60 + 15, 4, 90))).toBe('Lights out 23:15 → wake 05:15');
  });

  it('keeps bedtime within 20:00–02:00 and cycles within 3–6', () => {
    expect(nightPlan(1000, 5, 90).bedtime).toBe(1200);
    expect(nightPlan(2000, 5, 90).bedtime).toBe(1560);
    expect(nightPlan(1380, 9, 90).cycles).toBe(6);
    expect(nightPlan(1380, 1, 90).cycles).toBe(3);
    expect(clock(1470)).toBe('00:30');
    expect(hoursAndMinutes(360)).toBe('6 h');
  });

  it('builds a daily reminder for the next lights out', () => {
    const now = new Date(2026, 9, 23, 22, 0);
    expect(new Date(nextOccurrence(1380, now)).getHours()).toBe(23);
    expect(new Date(nextOccurrence(1380, now)).getDate()).toBe(23);
    expect(new Date(nextOccurrence(1260, now)).getDate()).toBe(24); // 21:00 passed
    const card = nightReminderCard(nightPlan(1380, 5, 90), now);
    expect(card.type).toBe('reminder');
    expect(card.title).toBe('Lights out 23:00, wake 06:30');
    expect(card.reminder?.repeat).toBe('daily');
  });

  it('draws the crescent as one closed path of two arcs', () => {
    const d = crescentPath(16, 16, 14);
    expect(d.match(/A/g)).toHaveLength(2);
    expect(d.endsWith('Z')).toBe(true);
  });
});

describe('growth', () => {
  it('compounds monthly, and is linear at 0%', () => {
    expect(futureValue(0, 100, 0, 12)).toBe(1200);
    expect(futureValue(1000, 0, 12, 12)).toBeCloseTo(1126.83, 2);
    // $200 a month at 7% for 40 years ≈ $525k.
    expect(Math.round(futureValue(0, 200, 7, 480))).toBe(524963);
  });

  it('starts the later curve after its delay, and the gap is positive', () => {
    const s = growthSeries({start: 0, monthly: 200, ratePct: 7, laterYears: 10}, 40);
    expect(s).toHaveLength(41);
    expect(s[10].later).toBe(0);
    expect(s[11].later).toBeGreaterThan(0);
    expect(s[40].now - s[40].later).toBeGreaterThan(0);
    const paths = growthPaths(s, {x: 48, y: 200, w: 600, h: 200}, 10);
    expect(paths.now.startsWith('M48 400')).toBe(true);
    expect(paths.laterStartX).toBe(198);
    expect(paths.nowEnd).toBe(200); // the top of the chart
  });

  it('steps the monthly amount on a 1-2-5 scale', () => {
    expect(monthlyStep(200)).toBe(20);
    expect(monthlyStep(50)).toBe(10);
    expect(monthlyStep(3000)).toBe(200);
  });

  it('formats money with or without Intl', () => {
    expect(money(524963, 'USD')).toMatch(/524,963/);
    expect(money(1500, null)).toBe('1,500');
    const intl = globalThis.Intl;
    // @ts-expect-error simulate a runtime without Intl
    globalThis.Intl = undefined;
    try {
      expect(money(1500, 'GBP')).toBe('£1,500');
      expect(money(1500, 'CHF')).toBe('CHF 1,500');
    } finally {
      globalThis.Intl = intl;
    }
  });
});

describe('map words', () => {
  it('formats compare values', () => {
    expect(valueText({n: 200, unit: '$'})).toBe('$200');
    expect(valueText({n: 37, unit: '%'})).toBe('37%');
    expect(valueText({n: 40, unit: 'years'})).toBe('40 years');
    expect(valueText({n: 12500, unit: ''})).toBe('12,500');
  });

  it('shares a node as a list card with its sources', () => {
    const card = nodeShareCard(
      {
        id: 'n1', group: 'g1', kind: 'step', label: 'Keep the room cool', detail: '18 °C',
        t: 29, t1: null, when: null, value: null, verdict: null, refs: [], sim: null,
      },
      [{title: 'NHS', url: 'https://www.nhs.uk/'}],
    );
    expect(card).toEqual({
      type: 'list',
      title: 'Keep the room cool',
      items: [{name: 'Keep the room cool', detail: '18 °C'}],
      sources: [{title: 'NHS', url: 'https://www.nhs.uk/'}],
    });
  });
});
