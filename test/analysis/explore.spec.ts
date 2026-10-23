import {validateExplore, validatePackage} from '../../src/analysis/schema';
import {
  clone,
  crimeExplore,
  financeCameo,
  sleepExplore,
} from '../fixtures/explore';

describe('validateExplore', () => {
  it('accepts the contract example shapes for flow and timeline', () => {
    const flow = validateExplore(sleepExplore)!;
    expect(flow.layout).toBe('flow');
    expect(flow.nodes).toHaveLength(4);
    expect(flow.edges).toHaveLength(3);
    expect(flow.sims[0]).toMatchObject({engine: 'night', params: {cycles: 5, bedtime: 1380}});
    const tl = validateExplore(crimeExplore)!;
    expect(tl.edges[0]).toMatchObject({kind: 'contradicts', label: 'contradicts'});
  });

  it('shows no Map when not eligible, or the header is out of bounds', () => {
    expect(validateExplore({...clone(sleepExplore), eligible: false})).toBeNull();
    expect(validateExplore(null)).toBeNull();
    expect(validateExplore({...clone(sleepExplore), layout: 'radial'})).toBeNull();
    expect(validateExplore({...clone(sleepExplore), title: 'x'.repeat(49)})).toBeNull();
    expect(validateExplore({...clone(sleepExplore), summary: 'x'.repeat(121)})).toBeNull();
    expect(validateExplore({...clone(sleepExplore), groups: []})).toBeNull();
  });

  it('drops invalid nodes one by one, then applies the minimum of three', () => {
    const e = clone(sleepExplore);
    e.nodes[3].label = 'x'.repeat(45); // over 44
    const out = validateExplore(e)!;
    expect(out.nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
    // The edge into the dropped node goes too.
    expect(out.edges.some((x) => x.to === 'n4')).toBe(false);
    e.nodes[2].group = 'nope';
    expect(validateExplore(e)).toBeNull(); // two nodes left
  });

  it('bounds counts: at most 12 nodes and 16 edges', () => {
    const e = clone(sleepExplore);
    e.nodes = Array.from({length: 15}, (_, i) => ({
      ...e.nodes[0],
      id: `m${i}`,
      sim: null,
    }));
    e.edges = Array.from({length: 14}, (_, i) => ({
      from: `m${i}`,
      to: `m${i + 1}`,
      kind: 'then',
      label: null,
    }));
    const out = validateExplore(e)!;
    expect(out.nodes).toHaveLength(12);
    // Only edges between kept nodes survive (m0→m1 … m10→m11).
    expect(out.edges).toHaveLength(11);
  });

  it('needs two edges for flow and cluster, three timed nodes for a timeline', () => {
    const flow = clone(sleepExplore);
    flow.edges = flow.edges.slice(0, 1);
    expect(validateExplore(flow)).toBeNull();
    const tl = clone(crimeExplore);
    tl.edges = [];
    expect(validateExplore(tl)).not.toBeNull(); // timelines need no edges
    tl.nodes = tl.nodes
      .slice(0, 3)
      .map((n) => ({...n, when: null, t: 5})) as unknown as typeof tl.nodes;
    expect(validateExplore(tl)).toBeNull(); // one distinct t, no `when`
  });

  it('rejects edges with unknown kinds, missing ends or long labels', () => {
    const e = clone(sleepExplore);
    e.edges.push({from: 'n1', to: 'n4', kind: 'causes', label: null});
    e.edges.push({from: 'n1', to: 'zz', kind: 'then', label: null});
    e.edges.push({from: 'n1', to: 'n3', kind: 'then', label: 'x'.repeat(25)});
    expect(validateExplore(e)!.edges).toHaveLength(3);
  });

  it('clamps sim params, wraps bedtime past midnight and drops unknown engines', () => {
    const e = clone(sleepExplore);
    e.sims = [
      {
        id: 'night',
        engine: 'night',
        title: 'Plan your night',
        params: {cycleMinutes: 200, cycles: 9, bedtime: 30, quote: 'q', quoteT: 5},
      },
      {id: 'warp', engine: 'warp-drive', title: 'x', params: {}},
    ] as never;
    const out = validateExplore(e)!;
    expect(out.sims).toHaveLength(1);
    expect(out.sims[0].params).toMatchObject({cycleMinutes: 120, cycles: 6, bedtime: 1470});
    const g = validateExplore(clone(financeCameo.explore))!.sims[0];
    expect(g).toMatchObject({engine: 'growth', params: {ratePct: 7, years: 40, laterYears: 10, currency: 'USD'}});
    const wild = clone(financeCameo.explore);
    wild.sims[0].params = {...wild.sims[0].params, ratePct: 90, years: 0, laterYears: 99, currency: 'dollars'};
    expect(validateExplore(wild)!.sims[0].params).toMatchObject({ratePct: 30, years: 1, laterYears: 30, currency: null});
  });

  it('clears a node sim that points at a dropped sim, and keeps only known verdicts', () => {
    const e = clone(sleepExplore);
    e.sims = [];
    e.nodes[1].verdict = 'MAYBE' as never;
    const out = validateExplore(e)!;
    expect(out.nodes[0].sim).toBeNull();
    expect(out.nodes[1].verdict).toBeNull();
  });

  it('keeps questions only for existing nodes, at most four', () => {
    const e = clone(sleepExplore);
    e.questions = [
      {nodeId: 'n1', t: 5, question: 'a?'},
      {nodeId: 'zz', t: 5, question: 'b?'},
      {nodeId: 'n2', t: 5, question: 'c?'},
      {nodeId: 'n2', t: 5, question: 'd?'},
      {nodeId: 'n3', t: 5, question: 'e?'},
      {nodeId: 'n4', t: 5, question: 'f?'},
    ];
    expect(validateExplore(e)!.questions.map((q) => q.question)).toEqual(['a?', 'c?', 'd?', 'e?']);
  });

  it('lets a cameo package with a map and no cards through validatePackage', () => {
    const pkg = validatePackage(clone(financeCameo), 'cameo-finance')!;
    expect(pkg.example).toBe(true);
    expect(pkg.title).toBe('Start now or start later');
    expect(pkg.explore?.layout).toBe('compare');
    const noMap = {...clone(financeCameo), explore: undefined};
    expect(validatePackage(noMap, 'cameo-finance')).toBeNull();
  });
});
