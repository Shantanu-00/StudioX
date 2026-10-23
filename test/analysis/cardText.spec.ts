import {
  clip,
  DEFAULT_TEASER,
  displayCase,
  firstSentence,
  headlineOf,
  initialsOf,
  isQuestionable,
  nameLines,
  sourceLine,
  teaserOf,
  uniqueSources,
} from '../../src/analysis/cardText';
import {validateWidget, Widget} from '../../src/analysis/schema';

const claim = (extra: object = {}) =>
  validateWidget({
    id: 'c1',
    type: 'claim',
    claim:
      'Harvard clinical data shows midday sleep cuts cardiovascular strain by 37 percent in elite athletes.',
    speaker: 'Dr. Julian',
    context: 'An observational study. It counted deaths.',
    evidence: [{t0: 6, t1: 11}],
    verdict: 'NUANCED',
    ...extra,
  }) as Widget;

describe('validation of headline and teaser', () => {
  it('keeps bounded values', () => {
    const w = claim({headline: '  Naps and the heart  ', teaser: 'Do naps help?'});
    expect(w.headline).toBe('Naps and the heart');
    expect(w.teaser).toBe('Do naps help?');
  });

  it('drops over-long or malformed values, never the widget', () => {
    const w = claim({headline: 'x'.repeat(71), teaser: 42});
    expect(w).not.toBeNull();
    expect(w.headline).toBeUndefined();
    expect(w.teaser).toBeUndefined();
    expect(claim({teaser: 'y'.repeat(49)}).teaser).toBeUndefined();
    expect(claim({teaser: 'y'.repeat(48)}).teaser).toHaveLength(48);
  });
});

describe('card text', () => {
  it('cuts at a word boundary with an ellipsis', () => {
    const out = clip('one two three four five six', 14);
    expect(out).toBe('one two three…');
    expect(out.length).toBeLessThanOrEqual(14);
    expect(clip('short', 70)).toBe('short');
  });

  it('falls back to the claim, cut to 70 characters', () => {
    const h = headlineOf(claim());
    expect(h.length).toBeLessThanOrEqual(70);
    expect(h.endsWith('…')).toBe(true);
    expect(headlineOf(claim({headline: 'Naps and the heart'}))).toBe(
      'Naps and the heart',
    );
  });

  it('uses a default teaser and flags only questionable verdicts', () => {
    expect(teaserOf(claim())).toBe(DEFAULT_TEASER);
    expect(isQuestionable(claim())).toBe(true);
    expect(isQuestionable(claim({verdict: 'SUPPORTED'}))).toBe(false);
    expect(isQuestionable(claim({verdict: undefined}))).toBe(false);
  });

  it('formats sources and names', () => {
    expect(
      sourceLine({
        title: 'Sleeping your way · news.harvard.edu',
        url: 'https://news.harvard.edu/x',
        date: '2007',
      }),
    ).toBe('Sleeping your way · news.harvard.edu · 2007');
    expect(
      uniqueSources([
        {title: 'a', url: 'https://a.org/1?utm=x'},
        {title: 'a', url: 'https://a.org/1'},
        {title: 'b', url: 'https://b.org/1'},
      ]).map((s) => s.title),
    ).toEqual(['a', 'b']);
    expect(nameLines('Cristiano Ronaldo')).toEqual(['Cristiano', 'Ronaldo']);
    expect(initialsOf('Marcus Vance')).toBe('MV');
    expect(firstSentence('One. Two.')).toBe('One.');
    expect(displayCase('SHADOW FILES · CASE 104')).toBe(
      'Shadow Files · Case 104',
    );
  });
});
