import {
  answerStamps,
  composeCard,
  mergeRefined,
  suggestedQuestions,
} from '../../src/analysis/composer';
import {ANALYSES} from '../../src/analysis/fixtures';

describe('composeCard', () => {
  const science = ANALYSES['science-ep42'];
  const crime = ANALYSES['crime-case104'];

  it('keeps every fixture widget through validation', () => {
    expect(science.widgets).toHaveLength(5);
    expect(crime.widgets).toHaveLength(4);
  });

  it('picks the compound stack when paused at 0:19 in the science episode', () => {
    const card = composeCard(science, 19);
    const ids = card.widgets.map((w) => w.id);
    expect(ids).toContain('compounds');
    expect(ids.length).toBeLessThanOrEqual(3);
    expect(card.segment?.title).toBe('The compound stack');
  });

  it('leads with the alibi conflict at 0:20 in the crime episode', () => {
    const card = composeCard(crime, 20);
    expect(card.widgets.map((w) => w.id)).toContain('chronology');
    expect(card.caption).toMatch(/cameras/);
  });

  it('returns an honest empty card past the analysed range', () => {
    const card = composeCard(science, 500);
    expect(card.widgets).toHaveLength(0);
  });
});

describe('co-viewer helpers', () => {
  const science = ANALYSES['science-ep42'];

  it('merges a refined caption and widget in place, appending new widgets', () => {
    const card = composeCard(science, 19);
    const before = card.widgets.map((w) => w.id);
    const merged = mergeRefined(card, {
      caption: 'Refined caption',
      widget: {...card.widgets[0], id: 'brand-new'} as never,
    });
    expect(merged.caption).toBe('Refined caption');
    expect(merged.refined).toBe(true);
    const ids = merged.widgets.map((w) => w.id);
    expect(ids[0]).toBe(before[0]);
    expect(ids[ids.length - 1]).toBe('brand-new');
    expect(ids.length).toBeLessThanOrEqual(3);
    expect(mergeRefined(card, null)).toBe(card);
  });

  it('suggests at most two questions, none from later in the episode', () => {
    expect(suggestedQuestions(science, 0).map((a) => a.t)).toEqual([]);
    expect(suggestedQuestions(science, 2).map((a) => a.t)).toEqual([5]);
    expect(suggestedQuestions(science, 30).map((a) => a.t)).toEqual([19, 11]);
  });

  it('collects answer stamps from cites and [m:ss] in the text', () => {
    expect(answerStamps('Said at [0:13] and [1:02].', [19, 13])).toEqual([
      13, 19, 62,
    ]);
  });
});
