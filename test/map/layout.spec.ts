import {Explore, validateExplore} from '../../src/analysis/schema';
import {
  firstFocus,
  isLocked,
  layoutMap,
  neighbourMap,
  stepOrder,
  TOGGLE_ID,
} from '../../src/map/layout';
import {
  clone,
  crimeExplore,
  financeCameo,
  sleepExplore,
  techCameo,
} from '../fixtures/explore';

const BOX = {x: 48, y: 123, w: 864, h: 356};
const TOGGLE = {x: 760, y: 27, w: 152, h: 40};
const sleep = validateExplore(sleepExplore) as Explore;
const crime = validateExplore(crimeExplore) as Explore;

const inBox = (r: {x: number; y: number; w: number; h: number}) =>
  r.x >= BOX.x && r.y >= BOX.y && r.x + r.w <= BOX.x + BOX.w && r.y + r.h <= BOX.y + BOX.h;
const isInt = (r: {x: number; y: number; w: number; h: number}) =>
  [r.x, r.y, r.w, r.h].every(Number.isInteger);

describe('Map layouts', () => {
  it('flow: one row left to right, integer dp, inside the box, with arrows', () => {
    const l = layoutMap(sleep, BOX);
    expect(l.nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(new Set(l.nodes.map((n) => n.y)).size).toBe(1);
    l.nodes.reduce((x, n) => (expect(n.x).toBeGreaterThan(x), n.x), -1);
    l.nodes.forEach((n) => {
      expect(isInt(n)).toBe(true);
      expect(inBox(n)).toBe(true);
    });
    expect(l.edges).toHaveLength(3);
    expect(l.edges.every((e) => e.arrow)).toBe(true);
    // The labelled edge gets a label box in its (wider) gap.
    const labelled = l.edges.find((e) => e.label)!;
    expect(labelled.labelBox!.w).toBeGreaterThanOrEqual(88);
    // One quiet heading per group run.
    expect(l.headings.map((h) => h.title)).toEqual(['At night', 'The promise']);
  });

  it('flow: a spine with supporting pieces hanging under what they explain', () => {
    const e = clone(sleepExplore);
    e.nodes.splice(1, 0, {...e.nodes[0], id: 'c1', kind: 'claim', label: 'Midday sleep', sim: null});
    e.edges.push({from: 'c1', to: 'n1', kind: 'supports', label: 'midday sleep'});
    const l = layoutMap(validateExplore(e)!, BOX);
    const at = (id: string) => l.nodes.find((n) => n.id === id)!;
    // Spine n1 → n2 → n3 → n4 in one row; c1 under n1.
    expect(new Set(['n1', 'n2', 'n3', 'n4'].map((id) => at(id).y)).size).toBe(1);
    expect(at('c1').x).toBe(at('n1').x);
    expect(at('c1').y).toBeGreaterThan(at('n1').y + at('n1').h);
    expect(l.nodes.map((n) => n.id)).toEqual(['n1', 'c1', 'n2', 'n3', 'n4']);
    const link = l.edges.find((x) => x.from === 'c1')!;
    expect(link.labelAlign).toBe('left');
    l.nodes.forEach((n) => expect(inBox(n)).toBe(true));
    const nb = neighbourMap(l, TOGGLE);
    expect(nb.n1.down).toBe('c1');
    expect(nb.c1.up).toBe('n1');
  });

  it('flow: wraps to more rows after four nodes and stays in the box', () => {
    const e = clone(sleepExplore);
    e.nodes = Array.from({length: 10}, (_, i) => ({...e.nodes[0], id: `m${i}`, sim: null}));
    e.edges = e.nodes.slice(1).map((n, i) => ({from: `m${i}`, to: n.id, kind: 'then', label: null}));
    const l = layoutMap(validateExplore(e)!, BOX);
    const rows = [...new Set(l.nodes.map((n) => n.y))];
    expect(rows).toHaveLength(3);
    l.nodes.forEach((n) => expect(inBox(n)).toBe(true));
  });

  it('timeline: events alternate above and below one axis in time order', () => {
    const l = layoutMap(crime, BOX);
    expect(l.axis).toBeDefined();
    expect(l.nodes.map((n) => n.side)).toEqual(['above', 'below', 'above', 'below', 'above']);
    l.nodes.forEach((n) => expect(inBox(n)).toBe(true));
    // `then` is the axis itself; only the contradiction is drawn, labelled.
    expect(l.edges).toHaveLength(1);
    expect(l.edges[0]).toMatchObject({kind: 'contradicts', label: 'contradicts'});
    // Neighbours on the same side never overlap.
    const above = l.nodes.filter((n) => n.side === 'above');
    for (let i = 1; i < above.length; i++) {
      expect(above[i].x).toBeGreaterThanOrEqual(above[i - 1].x + above[i - 1].w);
    }
  });

  it('compare and cluster: one column per group, a sim button under compare', () => {
    const c = layoutMap(validateExplore(financeCameo.explore)!, BOX);
    expect(c.headings.map((h) => h.title)).toEqual(['Start at 25', 'Start at 35']);
    expect(new Set(c.nodes.map((n) => n.x)).size).toBe(2);
    expect(c.simButton?.simId).toBe('growth');
    c.nodes.forEach((n) => expect(inBox(n)).toBe(true));
    const k = layoutMap(validateExplore(techCameo.explore)!, BOX);
    expect(k.simButton).toBeUndefined();
    expect(k.edges).toHaveLength(0);
  });
});

describe('the D-pad neighbour map', () => {
  it('flow: LEFT/RIGHT along the row, UP to the toggle, edges blocked', () => {
    const l = layoutMap(sleep, BOX);
    const nb = neighbourMap(l, TOGGLE);
    expect(nb.n1).toMatchObject({right: 'n2', up: TOGGLE_ID});
    expect(nb.n1.left).toBeUndefined();
    expect(nb.n4.right).toBeUndefined();
    expect(nb.n4.down).toBeUndefined();
    // The toggle leads down to the nearest node (top right) and nowhere else.
    expect(nb[TOGGLE_ID]).toEqual({down: 'n4'});
  });

  it('flow: RIGHT at the end of a row continues to the next row', () => {
    const e = clone(sleepExplore);
    e.nodes = Array.from({length: 6}, (_, i) => ({...e.nodes[0], id: `m${i}`, group: 'g1', sim: null}));
    e.edges = e.nodes.slice(1).map((n, i) => ({from: `m${i}`, to: n.id, kind: 'then', label: null}));
    const l = layoutMap(validateExplore(e)!, BOX);
    const nb = neighbourMap(l, TOGGLE);
    expect(nb.m2.right).toBe('m3'); // 3 + 3: m2 ends row one
    expect(nb.m3.left).toBe('m2');
    expect(nb.m0.down).toBe('m3');
    expect(nb.m4.up).toBe('m1');
  });

  it('timeline: LEFT/RIGHT walk the events in time, UP/DOWN cross the axis', () => {
    const l = layoutMap(crime, BOX);
    const nb = neighbourMap(l, TOGGLE);
    expect(nb.c1.right).toBe('c2');
    expect(nb.c2.right).toBe('c3');
    expect(nb.c2.left).toBe('c1');
    expect(nb.c1.left).toBeUndefined();
    expect(nb.c2.up).toBe('c1'); // closest above; earlier one on a tie
    expect(nb.c1.down).toBe('c2');
    expect(nb.c3.up).toBe(TOGGLE_ID);
  });

  it('compare: across columns by row, down into the sim button', () => {
    const l = layoutMap(validateExplore(financeCameo.explore)!, BOX);
    const nb = neighbourMap(l, TOGGLE);
    expect(nb.a1.right).toBe('b1');
    expect(nb.b2.left).toBe('a2');
    expect(nb.a1.down).toBe('a2');
    expect(nb.a2.down).toBe('sim-growth');
    expect(nb['sim-growth'].up).toBe('a2');
  });

  it('is deterministic', () => {
    const a = neighbourMap(layoutMap(crime, BOX), TOGGLE);
    const b = neighbourMap(layoutMap(crime, BOX), TOGGLE);
    expect(a).toEqual(b);
  });
});

describe('spoiler lock and order', () => {
  it('locks a node said after the playhead plus 4 s; a cameo locks nothing', () => {
    const [c1, c2, c3, c4] = crime.nodes;
    expect(isLocked(c1, 12)).toBe(false);
    expect(isLocked(c2, 12)).toBe(false);
    expect(isLocked(c3, 11)).toBe(true); // 15.34 > 15
    expect(isLocked(c3, 12)).toBe(false); // 15.34 ≤ 16
    expect(isLocked(c4, 12)).toBe(true);
    expect(isLocked(c4, null)).toBe(false);
    expect(isLocked({...c4, t: null}, 0)).toBe(false);
  });

  it('first focus is the first unlocked node', () => {
    const l = layoutMap(crime, BOX);
    expect(firstFocus(l, crime, 0)).toBe('c1');
  });

  it('steps through group by group, in reading order', () => {
    const e = clone(sleepExplore);
    // Nodes listed out of group order: n4 (g2) first.
    e.nodes = [e.nodes[3], ...e.nodes.slice(0, 3)];
    const order = stepOrder(validateExplore(e)!).map((n) => n.id);
    expect(order).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(stepOrder(crime).map((n) => n.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });
});
