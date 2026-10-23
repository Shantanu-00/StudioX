import * as React from 'react';
import {act, fireEvent, render} from '@testing-library/react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {
  arcPoint,
  clock,
  compactMoney,
  crescentPath,
  futureValue,
  growthChart,
  growthDelta,
  growthInit,
  growthOutcome,
  growthSeries,
  growthSpan,
  growthStep,
  growthTop,
  hoursAndMinutes,
  money,
  moneyArrow,
  moneyChange,
  monthlyStep,
  nextOccurrence,
  niceStep,
  nightDelta,
  nightHeadline,
  nightInit,
  nightLayout,
  nightPlan,
  nightSentence,
  nightStep,
  offsetText,
  percent,
  shortDuration,
  signedDuration,
  stackLabels,
  stepMarkers,
  valueTicks,
  waveDepth,
  yearTicks,
} from '../../src/map/sims';
import {nightReminderCard, nodeShareCard, valueText} from '../../src/map/mapData';
import {NightSim} from '../../src/map/NightSim';
import {GrowthSim} from '../../src/map/GrowthSim';
import {GrowthParams, NightParams} from '../../src/analysis/schema';

describe('night', () => {
  it('wakes at the end of the last whole cycle', () => {
    const p = nightPlan(23 * 60, 5, 90);
    expect(p.wake).toBe(23 * 60 + 450);
    expect(nightHeadline(p)).toBe('Lights out 23:00 → wake 06:30');
    expect(nightSentence(p)).toBe('Lights out 23:00 → wake 06:30: 5 full cycles, 7 h 30 m');
    expect(hoursAndMinutes(p.sleepMinutes)).toBe('7 h 30 min');
    expect(nightHeadline(nightPlan(23 * 60 + 15, 4, 90))).toBe('Lights out 23:15 → wake 05:15');
  });

  it('keeps bedtime within 20:00–02:00, cycles within 3–6 and length within 60–120', () => {
    expect(nightPlan(1000, 5, 90).bedtime).toBe(1200);
    expect(nightPlan(2000, 5, 90).bedtime).toBe(1560);
    expect(nightPlan(1380, 9, 90).cycles).toBe(6);
    expect(nightPlan(1380, 1, 90).cycles).toBe(3);
    expect(nightPlan(1380, 5, 40).cycleMinutes).toBe(60);
    expect(nightPlan(1380, 5, 130).cycleMinutes).toBe(120);
    expect(clock(1470)).toBe('00:30');
    expect(hoursAndMinutes(360)).toBe('6 h');
  });

  it('writes short and signed durations', () => {
    expect(shortDuration(15)).toBe('15 min');
    expect(shortDuration(90)).toBe('1 h 30 m');
    expect(shortDuration(120)).toBe('2 h');
    expect(signedDuration(15)).toBe('+15 min');
    expect(signedDuration(-90)).toBe('−1 h 30 m');
    expect(offsetText(-30)).toBe('−30 min');
    expect(offsetText(0)).toBe('At lights out');
  });

  it('steps one value at a time, with a delta chip, and stops at the bounds', () => {
    let s = nightInit({bedtime: 1380, cycles: 5, cycleMinutes: 90});
    s = nightStep(s, 'bedtime', 1);
    expect(s.plan.bedtime).toBe(1395);
    expect(s.last).toEqual({field: 'bedtime', text: 'Wake 06:30 → 06:45 (+15 min)', seq: 1});
    s = nightStep(s, 'cycles', 1);
    expect(s.last?.text).toBe('5 → 6 cycles · +1 h 30 m sleep');
    const top = nightStep(s, 'cycles', 1); // already 6
    expect(top).toBe(s);
    s = nightStep(s, 'cycleMinutes', -1);
    expect(s.plan.cycleMinutes).toBe(85);
    expect(s.last?.text).toBe('90 → 85 min cycles · −30 min sleep');
    expect(s.last?.seq).toBe(3);
    const a = nightPlan(1380, 5, 90);
    expect(nightDelta('bedtime', a, a)).toBeNull();
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

  it('lays the cycles out as one wave per cycle, scaled to six', () => {
    const opt = {left: 48, width: 864, eveW: 232, depth: 40, skyH: 156, arcH: 96, headroom: 540};
    const L = nightLayout(nightPlan(1380, 5, 90), opt);
    expect(L.bedX).toBe(280);
    expect(L.wakeX).toBeCloseTo(280 + (632 * 450) / 540, 0);
    expect(L.humps.match(/Q/g)).toHaveLength(5);
    expect(L.ghosts.match(/Q/g)).toHaveLength(1); // room for a sixth
    expect(L.junctions).toHaveLength(6);
    expect(L.junctions[5].minute).toBe(450);
    expect(L.centers.map((c) => c.n)).toEqual([1, 2, 3, 4, 5]);
    // One more cycle moves the wake point; six leave no ghosts.
    const six = nightLayout(nightPlan(1380, 6, 90), opt);
    expect(six.wakeX).toBeCloseTo(912, 0);
    expect(six.ghosts).toBe('');
    // A longer cycle than the headroom rescales to fit.
    const long = nightLayout(nightPlan(1380, 6, 120), opt);
    expect(long.wakeX).toBeCloseTo(912, 0);
  });

  it('puts the moon on the arc and the pulse on the wave', () => {
    expect(arcPoint(0, 100, 300, 200, 80)).toEqual({x: 100, y: 200});
    const mid = arcPoint(0.5, 100, 300, 200, 80);
    expect(mid.x).toBeCloseTo(200, 6);
    expect(mid.y).toBeCloseTo(120, 6);
    expect(waveDepth(0, 5, 40)).toBe(0);
    expect(waveDepth(0.1, 5, 40)).toBeCloseTo(40, 6); // the middle of cycle 1
    expect(waveDepth(0.2, 5, 40)).toBeCloseTo(0, 6); // between cycles
    expect(waveDepth(1, 5, 40)).toBe(0);
  });

  it('spaces evening steps before lights out, earliest first', () => {
    const m = stepMarkers(
      [
        {label: 'Magnesium', offsetMin: -30},
        {label: 'Screens off', offsetMin: -60},
        {label: 'Lights low', offsetMin: -25},
      ],
      280,
      232,
      24,
    );
    expect(m.map((x) => x.label)).toEqual(['Screens off', 'Magnesium', 'Lights low']);
    expect(m[2].x).toBeLessThanOrEqual(256);
    expect(m[2].x - m[1].x).toBeGreaterThanOrEqual(24);
    expect(m[1].x - m[0].x).toBeGreaterThanOrEqual(24);
    expect(stepMarkers([], 280, 232, 24)).toEqual([]);
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
    expect(s[40].paid).toBe(96000);
  });

  it('works out the cameo: $300 a month, 7%, 40 years, 10 years late', () => {
    const o = growthOutcome({start: 0, laterYears: 10}, {monthly: 300, ratePct: 7, years: 40});
    expect(Math.round(o.now)).toBe(Math.round(futureValue(0, 300, 7, 480)));
    expect(Math.round(o.later)).toBe(Math.round(futureValue(0, 300, 7, 360)));
    expect(o.gap).toBeCloseTo(o.now - o.later, 6);
    expect(o.paidNow).toBe(144000);
    expect(o.paidLater).toBe(108000);
    expect(money(o.paidNow, 'USD')).toBe('$144,000');
  });

  it('steps one value at a time, with its delta and the outcome before', () => {
    const base = {start: 0, laterYears: 10, monthlyStep: 50, currency: 'USD'};
    let s = growthInit({monthly: 300, ratePct: 7, years: 40});
    s = growthStep(s, 'monthly', 1, base);
    expect(s.monthly).toBe(350);
    expect(s.last?.text).toBe('+$50 a month');
    expect(Math.round(s.last?.before.now ?? 0)).toBe(
      Math.round(futureValue(0, 300, 7, 480)),
    );
    s = growthStep(s, 'ratePct', -1, base);
    expect(s.ratePct).toBe(6.5);
    expect(s.last?.text).toBe('−0.5% a year');
    s = growthStep(s, 'years', 1, base);
    expect(s.last?.text).toBe('+1 year');
    const atMax = growthStep({...s, years: 50}, 'years', 1, base);
    expect(atMax.years).toBe(50);
    expect(atMax.last).toBe(s.last); // unchanged at the bound
    expect(growthDelta('years', 40, 35, null)).toBe('−5 years');
    expect(growthStep(growthInit({monthly: 0, ratePct: 0, years: 1}), 'monthly', -1, base).monthly).toBe(0);
  });

  it('says what changed in money', () => {
    expect(moneyChange(209985, 262481, 'USD')).toBe('+$52,496 (was $209,985)');
    expect(moneyChange(100, 100, 'USD')).toBeNull();
    expect(moneyArrow('Start now', 209985, 262481, 'USD')).toBe(
      'Start now: $209,985 → $262,481 (+$52,496)',
    );
    expect(percent(7)).toBe('7%');
    expect(percent(7.5)).toBe('7.5%');
    expect(compactMoney(250000, 'USD')).toBe('$250k');
    expect(compactMoney(1500000, 'USD')).toBe('$1.5m');
    expect(compactMoney(900, null)).toBe('900');
    expect(compactMoney(2e6, 'CHF')).toBe('CHF 2m');
  });

  it('keeps the chart on a fixed span and top so changes are visible', () => {
    expect(growthSpan(40, 40)).toBe(45);
    expect(growthSpan(40, 47)).toBe(47);
    expect(growthSpan(50, 50)).toBe(50);
    expect(growthTop(1000, 900)).toBe(1150);
    expect(growthTop(1000, 2000)).toBe(2100);
    expect(yearTicks(45)).toEqual([0, 10, 20, 30, 40]);
    expect(yearTicks(8)).toEqual([0, 2, 4, 6, 8]);
    expect(niceStep(230000)).toBe(500000);
    expect(niceStep(180000)).toBe(200000);
    expect(valueTicks(1000000)).toEqual([200000, 400000, 600000, 800000]);
    expect(valueTicks(900000)).toEqual([200000, 400000, 600000, 800000]);
  });

  it('draws both curves, the gap and the paid-in line in the chart box', () => {
    const s = growthSeries({start: 0, monthly: 200, ratePct: 7, laterYears: 10}, 40);
    const box = {x: 0, y: 0, w: 450, h: 200};
    const top = growthTop(s[40].now, s[40].now);
    const c = growthChart(s, box, 10, 45, top);
    expect(c.now.startsWith('M0 200')).toBe(true);
    expect(c.laterStartX).toBe(100);
    expect(c.endX).toBe(400);
    expect(c.nowEnd).toBeCloseTo(200 - 200 / 1.15, 0);
    expect(c.laterEnd).toBeGreaterThan(c.nowEnd);
    expect(c.paidEnd).toBeGreaterThan(c.laterEnd);
    expect(c.gap.endsWith('Z')).toBe(true);
    expect(c.gap).toContain('L100 200 L0 200 Z');
  });

  it('stacks end labels apart within bounds', () => {
    const y = stackLabels(
      [
        {key: 'a', y: 10, h: 18},
        {key: 'b', y: 12, h: 18},
        {key: 'c', y: 190, h: 18},
      ],
      0,
      200,
    );
    expect(y.b - y.a).toBeGreaterThanOrEqual(18);
    expect(y.c).toBeLessThanOrEqual(182);
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

// The kepler preset mocks useTVEventHandler as jest.fn(): drive the handler
// registered last, as the remote would.
const press = (eventType: string) => {
  const calls = (useTVEventHandler as unknown as jest.Mock).mock.calls;
  act(() => {
    calls[calls.length - 1][0]({eventType, eventKeyAction: 0});
  });
};

describe('sim screens', () => {
  beforeAll(() => jest.useFakeTimers());
  afterAll(() => jest.useRealTimers());
  beforeEach(() => (useTVEventHandler as unknown as jest.Mock).mockClear());

  const night: NightParams = {
    cycleMinutes: 90,
    cycles: 5,
    bedtime: 1380,
    quote: 'Five ninety-minute cycles.',
    quoteT: 5,
    steps: [{label: 'Magnesium', offsetMin: -30, icon: 'pill'}],
  };

  it('night: the focused value changes with LEFT/RIGHT and shows its delta', () => {
    const onDone = jest.fn();
    const screen = render(
      React.createElement(NightSim, {
        title: 'Plan your night',
        params: night,
        source: 'Elite Recovery Protocols',
        hasVideo: true,
        paired: false,
        sendStatus: 'idle',
        onSend: jest.fn(),
        onDone,
      }),
    );
    const headline = () => screen.getByTestId('night-headline').props.children;
    expect(headline()).toBe('Lights out 23:00 → wake 06:30: 5 full cycles, 7 h 30 m');
    expect(screen.getByText('Magnesium')).toBeTruthy();
    press('right'); // the first control, lights out, has focus
    expect(headline()).toBe('Lights out 23:15 → wake 06:45: 5 full cycles, 7 h 30 m');
    expect(screen.getByTestId('night-delta').props.children).toBe(
      'Wake 06:30 → 06:45 (+15 min)',
    );
    fireEvent(screen.getByTestId('night-cycles'), 'focus');
    press('left');
    expect(headline()).toBe('Lights out 23:15 → wake 05:15: 4 full cycles, 6 h');
    expect(screen.getByTestId('night-delta').props.children).toBe(
      '5 → 4 cycles · −1 h 30 m sleep',
    );
    fireEvent(screen.getByTestId('night-length'), 'focus');
    press('right');
    expect(screen.getByTestId('night-delta').props.children).toBe(
      '90 → 95 min cycles · +20 min sleep',
    );
    // Play runs once (the Jest mock finishes it at once) and settles back.
    fireEvent(screen.getByTestId('night-play'), 'focus');
    fireEvent.press(screen.getByTestId('night-play'));
    expect(screen.getByText('Play the night')).toBeTruthy();
    press('right'); // on Play, LEFT/RIGHT change nothing
    expect(headline()).toBe('Lights out 23:15 → wake 05:35: 4 full cycles, 6 h 20 m');
    fireEvent.press(screen.getByTestId('night-action'));
    expect(onDone).toHaveBeenCalled();
    expect(screen.getByText('A coaching rule, not medical advice')).toBeTruthy();
  });

  const growth: GrowthParams = {
    start: 0,
    monthly: 300,
    ratePct: 7,
    years: 40,
    laterYears: 10,
    currency: 'USD',
    quote: null,
    quoteT: null,
    labels: null,
    startAges: [25, 35],
  };

  it('growth: tiles change with LEFT/RIGHT, and the outcomes show the change', () => {
    const onDone = jest.fn();
    const screen = render(
      React.createElement(GrowthSim, {
        title: 'Start at 25 or at 35',
        params: growth,
        source: 'Example',
        hasVideo: false,
        onDone,
      }),
    );
    const o = growthOutcome({start: 0, laterYears: 10}, growth);
    expect(screen.getByTestId('growth-headline').props.children).toBe(
      `Waiting 10 years costs ${money(o.gap, 'USD')}`,
    );
    expect(screen.getAllByText('Start in 10 years').length).toBeGreaterThan(0);
    expect(screen.getByText(`Cost of waiting: ${money(o.gap, 'USD')}`)).toBeTruthy();
    expect(screen.getByText('Paid in $144,000')).toBeTruthy();
    press('right'); // monthly has focus first
    expect(screen.getByText('+$20 a month')).toBeTruthy();
    const o2 = growthOutcome({start: 0, laterYears: 10}, {...growth, monthly: 320});
    expect(screen.getByText(moneyChange(o.now, o2.now, 'USD') as string)).toBeTruthy();
    fireEvent(screen.getByTestId('growth-years'), 'focus');
    press('left');
    expect(screen.getByText('−1 year')).toBeTruthy();
    fireEvent.press(screen.getByTestId('growth-play'));
    expect(screen.getByText('Play')).toBeTruthy();
    fireEvent.press(screen.getByTestId('growth-done'));
    expect(onDone).toHaveBeenCalled();
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
        icon: null, image: null, phase: null,
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
