import {
  ClaimWidget,
  DossierWidget,
  validatePackage,
  validateWidget,
} from '../../src/analysis/schema';

describe('validateWidget', () => {
  const ok = {
    id: 'w',
    type: 'entity_list',
    title: 'Compounds',
    kind: 'compound',
    evidence: [{t0: 1, t1: 2}],
    items: [
      {
        name: 'Apigenin',
        asSaid: 'quiets neuro-chatter',
        evidence: {t0: 1, t1: 2},
      },
    ],
  };

  it('accepts a well-formed widget', () => {
    expect(validateWidget(ok)).not.toBeNull();
  });

  it('rejects unknown types, missing evidence and oversized text', () => {
    expect(validateWidget({...ok, type: 'script'})).toBeNull();
    expect(validateWidget({...ok, evidence: []})).toBeNull();
    expect(
      validateWidget({
        ...ok,
        items: [{...ok.items[0], asSaid: 'x'.repeat(500)}],
      }),
    ).toBeNull();
  });

  it('rejects graph edges that point at unknown nodes', () => {
    expect(
      validateWidget({
        id: 'g',
        type: 'relation_graph',
        title: 'People',
        evidence: [{t0: 0, t1: 1}],
        nodes: [{id: 'a', label: 'A', kind: 'person', x: 0.5, y: 0.5}],
        edges: [{from: 'a', to: 'ghost', label: 'knows'}],
      }),
    ).toBeNull();
  });
});

describe('optional fields', () => {
  const claim = {
    id: 'c',
    type: 'claim',
    claim: 'Siestas cut heart strain by 37 percent.',
    speaker: 'Dr. Julian',
    context: 'Observational study of deaths.',
    evidence: [{t0: 5, t1: 11}],
  };

  it('keeps a known verdict and drops an unknown one without dropping the card', () => {
    expect(validateWidget({...claim, verdict: 'DEBUNKED'})).toMatchObject({
      verdict: 'DEBUNKED',
    });
    const odd = validateWidget({...claim, verdict: 'PANTS ON FIRE'});
    expect(odd).not.toBeNull();
    expect(odd).not.toHaveProperty('verdict');
  });

  it('keeps only https sources, at most four', () => {
    const sources = [
      {title: 'Naska 2007', url: 'https://jamanetwork.com/a', date: '2007'},
      {title: 'Plain http', url: 'http://example.com/b'},
      {title: 'Script', url: 'javascript:alert(1)'},
      ...[1, 2, 3, 4].map((n) => ({title: `S${n}`, url: `https://x.org/${n}`})),
    ];
    const w = validateWidget({...claim, sources}) as ClaimWidget;
    expect(w.sources?.map((s) => s.title)).toEqual([
      'Naska 2007',
      'S1',
      'S2',
      'S3',
    ]);
  });

  it('drops a non-https dossier portrait but keeps the dossier', () => {
    const dossier = {
      id: 'd',
      type: 'dossier',
      name: 'Cristiano Ronaldo',
      role: 'Footballer',
      facts: [{text: 'Named as the example.'}],
      evidence: [{t0: 0, t1: 3}],
    };
    const ok = validateWidget({
      ...dossier,
      image: {url: 'https://upload.wikimedia.org/p.jpg', credit: 'Wikimedia'},
    }) as DossierWidget;
    expect(ok.image?.credit).toBe('Wikimedia');
    const bad = validateWidget({
      ...dossier,
      image: {url: 'http://x.org/p.jpg', credit: 'x'},
    });
    expect(bad).not.toBeNull();
    expect(bad).not.toHaveProperty('image');
  });
});

describe('validatePackage', () => {
  const pkg = {
    mediaId: 'science-ep42',
    provenance: 'pipeline',
    generatedAt: '2026-10-22T18:00:00Z',
    segments: [{id: 's1', start: 0, end: 11, title: 'R90', genre: 'health'}],
    moments: [
      {t: 5, caption: 'Later'},
      {t: 0, caption: 'First'},
    ],
    widgets: [
      {id: 'bad', type: 'script'},
      {
        id: 'ok',
        type: 'claim',
        claim: 'A claim.',
        speaker: 'Host',
        context: 'Context.',
        evidence: [{t0: 0, t1: 1}],
      },
    ],
    answers: [
      {
        question: 'Real?',
        t: 11,
        text: 'Partly [0:08].',
        cites: [8],
        sources: [],
      },
      {question: '', t: 1, text: 'no question'},
    ],
  };

  it('validates item by item and sorts moments', () => {
    const a = validatePackage(pkg, 'science-ep42')!;
    expect(a.provenance).toBe('pipeline');
    expect(a.widgets.map((w) => w.id)).toEqual(['ok']);
    expect(a.moments.map((m) => m.t)).toEqual([0, 5]);
    expect(a.answers).toHaveLength(1);
    expect(a.transcript).toEqual([]);
  });

  it('rejects another episode, a non-object and a package with no valid widget', () => {
    expect(validatePackage(pkg, 'crime-case104')).toBeNull();
    expect(validatePackage('nope', 'science-ep42')).toBeNull();
    expect(
      validatePackage({...pkg, widgets: [{id: 'bad'}]}, 'science-ep42'),
    ).toBeNull();
  });
});
