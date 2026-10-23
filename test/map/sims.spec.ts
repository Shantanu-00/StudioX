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
  hypnogram,
  hypnogramY,
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
  nightStages,
  nightStep,
  offsetText,
  percent,
  quoteSpeaker,
  shortDuration,
  signedDuration,
  simForWidget,
  stackLabels,
  stageAt,
  stageReadout,
  stepMarkers,
  valueTicks,
  waveDepth,
  yearTicks,
} from '../../src/map/sims';
import {nightReminderCard, nodeShareCard, valueText} from '../../src/map/mapData';
import {NightSim} from '../../src/map/NightSim';
import {GrowthSim} from '../../src/map/GrowthSim';
import {Explore, ExploreSim, GrowthParams, NightParams, Widget} from '../../src/analysis/schema';

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

describe('night stages', () => {
  it('fills each cycle exactly: deep sleep early, REM late', () => {
    const spans = nightStages(5, 90);
    expect(spans[0]).toEqual({stage: 'light', start: 0, end: spans[0].end, cycle: 0});
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start).toBe(spans[i - 1].end); // contiguous
    }
    expect(spans[spans.length - 1].end).toBe(450);
    const of = (stage: string, c: number) =>
      spans
        .filter((s) => s.stage === stage && s.cycle === c)
        .reduce((n, s) => n + s.end - s.start, 0);
    for (let c = 0; c < 5; c++) {
      expect(spans.filter((s) => s.cycle === c).reduce((n, s) => n + s.end - s.start, 0)).toBe(90);
    }
    expect(of('deep', 0)).toBeGreaterThan(of('deep', 3));
    expect(of('rem', 4)).toBeGreaterThan(of('rem', 0));
    expect(of('deep', 4)).toBe(0);
    // Shorter cycles scale the stages and still fill exactly.
    const short = nightStages(3, 60);
    expect(short[short.length - 1].end).toBe(180);
    expect(short.every((s) => s.end > s.start)).toBe(true);
  });

  it('knows the stage at a minute and says it in one line', () => {
    const spans = nightStages(5, 90);
    const plan = nightPlan(1380, 5, 90);
    expect(stageAt(spans, 0)).toEqual({stage: 'light', cycle: 0});
    const rem = spans.find((s) => s.stage === 'rem' && s.cycle === 2)!;
    expect(stageAt(spans, rem.start)).toEqual({stage: 'rem', cycle: 2});
    expect(stageReadout(spans, rem.start, plan)).toBe('REM · dreaming · cycle 3 of 5');
    expect(stageAt(spans, 450)).toEqual({stage: 'awake', cycle: 4});
    expect(stageReadout(spans, 450, plan)).toBe('Awake at 06:30 · 5 full cycles');
    expect(stageAt([], 10)).toEqual({stage: 'awake', cycle: 0});
  });

  it('draws the hypnogram from awake to awake, and follows it', () => {
    const spans = nightStages(5, 90);
    const g = hypnogram(spans, 800, 24);
    expect(g.path.startsWith('M0 0 L0 48')).toBe(true); // awake, then light
    expect(g.path.endsWith('L800 0')).toBe(true);
    expect(g.xs[0]).toBe(0);
    expect(g.xs[g.xs.length - 1]).toBe(1);
    expect(g.xs).toHaveLength(g.ys.length);
    const deep = spans.find((s) => s.stage === 'deep')!;
    const mid = (deep.start + deep.end) / 2 / 450;
    expect(hypnogramY(g.xs, g.ys, mid)).toBe(72);
    expect(hypnogramY(g.xs, g.ys, 1)).toBe(0);
    expect(hypnogramY(g.xs, g.ys, -1)).toBe(0);
  });
});

describe('sims from the player panel', () => {
  const night: ExploreSim = {
    id: 'night',
    engine: 'night',
    title: 'Plan your night',
    params: {cycleMinutes: 90, cycles: 5, bedtime: 1380, quote: null, quoteT: null, steps: []},
  };
  const growth: ExploreSim = {
    id: 'growth',
    engine: 'growth',
    title: 'See it grow',
    params: {
      start: 0,
      monthly: 300,
      ratePct: 7,
      years: 40,
      laterYears: 10,
      currency: 'USD',
      quote: null,
      quoteT: null,
      labels: null,
      startAges: null,
    },
  };
  const node = (id: string, sim: string | null, refs: string[]) =>
    ({id, sim, refs} as unknown as Explore['nodes'][number]);
  const protocol = (id: string, title: string) =>
    ({id, type: 'protocol', title, steps: [], evidence: []} as unknown as Widget);
  const claim = (id: string, text: string, speaker = 'Dr. Julian', t0 = 0, t1 = 5) =>
    ({id, type: 'claim', claim: text, speaker, context: '', evidence: [{t0, t1}]} as unknown as Widget);

  it('links a card to the sim of a Map node that cites it', () => {
    const explore = {sims: [night], nodes: [node('n1', 'night', ['protocol-1'])]};
    expect(simForWidget(explore, protocol('protocol-1', 'A routine'))?.id).toBe('night');
    // A night sim is only for a protocol; nothing for other cards.
    expect(simForWidget(explore, claim('protocol-1', 'Sleep more'))).toBeNull();
    expect(simForWidget(null, protocol('protocol-1', 'A routine'))).toBeNull();
  });

  it('falls back to a single sim whose card reads like its topic', () => {
    const explore = {sims: [night, growth], nodes: []};
    expect(simForWidget(explore, protocol('p', 'R90 sleep routine'))?.id).toBe('night');
    expect(simForWidget(explore, claim('c', 'Saving early beats investing late'))?.id).toBe(
      'growth',
    );
    expect(simForWidget(explore, protocol('p', 'Cold showers'))).toBeNull();
  });

  it('names the quote’s speaker', () => {
    const widgets = [claim('a', 'x', 'Dr. Julian', 6, 11), claim('b', 'y', 'Host', 1, 4)];
    expect(quoteSpeaker(widgets, 2)).toBe('Host');
    expect(quoteSpeaker(widgets, 30)).toBeNull(); // two speakers, none at that moment
    expect(quoteSpeaker([claim('a', 'x')], 30)).toBe('Dr. Julian');
    expect(quoteSpeaker([], null)).toBeNull();
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
        speaker: 'Dr. Julian',
        paired: false,
        sendStatus: 'idle',
        onSend: jest.fn(),
        onDone,
      }),
    );
    const text = (id: string) => screen.getByTestId(id).props.children;
    // The prototype's layout: quote, tiles, the answer, the readout at waking.
    expect(screen.getByText('“Five ninety-minute cycles.”')).toBeTruthy();
    expect(screen.getByText('Dr. Julian · 0:05')).toBeTruthy();
    expect(text('night-wake')).toBe('Wake at 06:30');
    expect(text('night-asleep')).toBe('7 h 30 m asleep · the guest’s rule');
    expect(text('night-readout')).toBe('Awake at 06:30 · 5 full cycles');
    expect(text('night-clock')).toBe('06:30');
    expect(screen.getByText('5 × 90')).toBeTruthy();
    ['Awake', 'REM', 'Light', 'Deep', 'C1', 'C5', '23:00', '06:30'].forEach((t) =>
      expect(screen.getAllByText(t).length).toBeGreaterThan(0),
    );
    expect(screen.queryByTestId('night-send')).toBeNull(); // not paired
    // Focus shows ◀ ▶ on the focused tile only.
    fireEvent(screen.getByTestId('night-bedtime'), 'focus');
    expect(screen.getByTestId('night-bedtime-keys').props.style).toEqual(
      expect.arrayContaining([{opacity: 1}]),
    );
    expect(screen.getByTestId('night-cycles-keys').props.style).toEqual(
      expect.arrayContaining([{opacity: 0}]),
    );
    press('right'); // the first tile, lights out, has focus
    expect(text('night-wake')).toBe('Wake at 06:45');
    expect(text('night-delta')).toBe('Wake 06:30 → 06:45 (+15 min)');
    fireEvent(screen.getByTestId('night-cycles'), 'focus');
    press('left');
    expect(text('night-wake')).toBe('Wake at 05:15');
    expect(text('night-delta')).toBe('5 → 4 cycles · −1 h 30 m sleep');
    expect(screen.getByText('4 × 90')).toBeTruthy();
    expect(screen.queryByText('C5')).toBeNull(); // the graph re-laid to four
    fireEvent(screen.getByTestId('night-length'), 'focus');
    press('right');
    expect(text('night-delta')).toBe('90 → 95 min cycles · +20 min sleep');
    // Play runs once (the Jest mock finishes it at once) and rests at waking.
    fireEvent(screen.getByTestId('night-play'), 'focus');
    fireEvent.press(screen.getByTestId('night-play'));
    expect(screen.getByText('Play the night')).toBeTruthy();
    expect(text('night-readout')).toBe('Awake at 05:35 · 4 full cycles');
    press('right'); // on Play, LEFT/RIGHT change nothing
    expect(text('night-wake')).toBe('Wake at 05:35');
    fireEvent.press(screen.getByTestId('night-done'));
    expect(onDone).toHaveBeenCalled();
    expect(
      screen.getByText(
        'R90 is a coaching method from sleep coach Nick Littlehales, not a clinical standard. Stages are illustrative, not your data. Not medical advice.',
      ),
    ).toBeTruthy();
  });

  it('night: sends the plan to a paired phone', () => {
    const onSend = jest.fn();
    const screen = render(
      React.createElement(NightSim, {
        title: 'Plan your night',
        params: night,
        source: 'Elite Recovery Protocols',
        hasVideo: false,
        paired: true,
        sendStatus: 'idle',
        onSend,
        onDone: jest.fn(),
      }),
    );
    fireEvent.press(screen.getByTestId('night-send'));
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({type: 'reminder'}));
    expect(screen.getByText('From the conversation')).toBeTruthy();
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
