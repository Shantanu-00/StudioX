import {
  clip,
  DEFAULT_TEASER,
  displayCase,
  firstSentence,
  headlineOf,
  initialsOf,
  isQuestionable,
  isRealStamp,
  jumpTarget,
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

describe('first sentence', () => {
  it('does not stop at a title before a name', () => {
    const fact =
      'Dr. Julian says Ronaldo optimizes recovery with R90 polyphasic sleep cycles.';
    expect(firstSentence(fact)).toBe(fact);
    expect(firstSentence(`${fact} Second sentence.`)).toBe(fact);
    expect(firstSentence('Mr. and Mrs. Smith moved to St. Ives. Then left.')).toBe(
      'Mr. and Mrs. Smith moved to St. Ives.',
    );
    expect(firstSentence('Prof. Lee and Dr Ana spoke. Next.')).toBe(
      'Prof. Lee and Dr Ana spoke.',
    );
  });

  it('does not stop at dotted acronyms, initials, vs. or e.g.', () => {
    expect(firstSentence('The U.S. team won gold. Next.')).toBe(
      'The U.S. team won gold.',
    );
    expect(firstSentence('Some compounds, e.g. apigenin, help. More.')).toBe(
      'Some compounds, e.g. apigenin, help.',
    );
    expect(firstSentence('That is i.e. a test. More.')).toBe(
      'That is i.e. a test.',
    );
    expect(firstSentence('Naps vs. nights is the question. More.')).toBe(
      'Naps vs. nights is the question.',
    );
    expect(firstSentence('J. K. Rowling wrote it. More.')).toBe(
      'J. K. Rowling wrote it.',
    );
  });

  it('does not stop inside a decimal', () => {
    expect(firstSentence('Strain fell 3.5 percent. More.')).toBe(
      'Strain fell 3.5 percent.',
    );
    expect(firstSentence('It costs $1.50 a day.')).toBe('It costs $1.50 a day.');
  });

  it('still ends at a real full stop, ! or ?, with closing quotes', () => {
    expect(firstSentence('One. Two.')).toBe('One.');
    expect(firstSentence('Is it true? Maybe.')).toBe('Is it true?');
    expect(firstSentence('Wow! Yes.')).toBe('Wow!');
    expect(firstSentence('He said “sleep in cycles.” Then left.')).toBe(
      'He said “sleep in cycles.”',
    );
    expect(firstSentence('No full stop here')).toBe('No full stop here');
    expect(firstSentence('  spaced   out.  ')).toBe('spaced out.');
  });
});

describe('jump target', () => {
  const dossier = (facts: object[], evidence = [{t0: 0, t1: 6}]) =>
    validateWidget({
      id: 'd1',
      type: 'dossier',
      name: 'Cristiano Ronaldo',
      role: 'Footballer',
      facts,
      evidence,
    }) as Widget;

  it('treats a missing or sub-second stamp as absent', () => {
    expect(isRealStamp(undefined)).toBe(false);
    expect(isRealStamp(null)).toBe(false);
    expect(isRealStamp(0)).toBe(false);
    expect(isRealStamp(0.6)).toBe(false);
    expect(isRealStamp(Number.NaN)).toBe(false);
    expect(isRealStamp(1)).toBe(true);
  });

  it('skips 0:00 stamps and returns null when nothing real is left', () => {
    expect(
      jumpTarget(
        dossier([
          {text: 'A fact.', evidence: {t0: 0, t1: 5}},
          {text: 'Another fact.', evidence: {t0: 5.41, t1: 6.76}},
        ]),
      ),
    ).toBe(5.41);
    expect(
      jumpTarget(dossier([{text: 'A fact.', evidence: {t0: 0, t1: 5}}])),
    ).toBeNull();
    expect(jumpTarget(dossier([{text: 'A fact.', source: 'Wikipedia'}]))).toBeNull();
    expect(jumpTarget(claim())).toBe(6);
    expect(jumpTarget(claim({evidence: [{t0: 0, t1: 4}]}))).toBeNull();
  });
});
