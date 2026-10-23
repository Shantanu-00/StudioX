import {Explore, validateExplore} from '../../src/analysis/schema';
import {BUNDLED} from '../../src/analysis/packages';
import {
  firstFocus,
  isLocked,
  layoutMap,
  neighbourMap,
  PLAY_ID,
  stepOrder,
  storyOrder,
  storyPath,
  TOGGLE_ID,
} from '../../src/map/layout';
import {
  fitCaption,
  fitHeader,
  nodeHeight,
  wrapLines,
} from '../../src/map/scene/measure';
import {Motif, themeFor} from '../../src/map/themes';
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
    expect(crime.suspense).toBe(true);
    expect(isLocked(c1, 12, true)).toBe(false);
    expect(isLocked(c2, 12, true)).toBe(false);
    expect(isLocked(c3, 11, true)).toBe(true); // 15.34 > 15
    expect(isLocked(c3, 12, true)).toBe(false); // 15.34 ≤ 16
    expect(isLocked(c4, 12, true)).toBe(true);
    expect(isLocked(c4, null, true)).toBe(false);
    expect(isLocked({...c4, t: null}, 0, true)).toBe(false);
  });

  it('only a suspense story locks: health, finance, tech and history never do', () => {
    expect(sleep.suspense).toBe(false);
    sleep.nodes.forEach((n) => expect(isLocked(n, 0, sleep.suspense)).toBe(false));
    const [, , , c4] = crime.nodes;
    expect(isLocked(c4, 12, false)).toBe(false);
    for (const id of ['science-ep42', 'cameo-finance', 'cameo-tech', 'cameo-history']) {
      const e = validateExplore((BUNDLED[id] as {explore: unknown}).explore)!;
      expect(e.suspense).toBe(false);
      e.nodes.forEach((n) => expect(isLocked(n, 0, e.suspense)).toBe(false));
    }
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

describe('no text is cut off', () => {
  it('estimates wrapped lines at 0.55 × font size per character', () => {
    expect(wrapLines('', 100, 15)).toBe(0);
    expect(wrapLines('Short', 100, 15)).toBe(1);
    // 8.25 dp per character: "Keep the room" (13) fits 120, the rest wraps.
    expect(wrapLines('Keep the room cool', 120, 15)).toBe(2);
    // A word longer than the line breaks across lines.
    expect(wrapLines('x'.repeat(30), 100, 15)).toBe(3);
  });

  const MOTIFS: Motif[] = ['caseboard', 'nightsky', 'signal', 'ledger', 'archive', 'plain'];
  const packaged = Object.keys(BUNDLED)
    .map((id) => validateExplore((BUNDLED[id] as {explore?: unknown}).explore))
    .filter((e): e is Explore => !!e);

  it('every bundled map, in every scene, sizes each node for its words inside the box', () => {
    expect(packaged.length).toBeGreaterThanOrEqual(5);
    for (const e of packaged) {
      for (const motif of MOTIFS) {
        const l = layoutMap(e, BOX, motif);
        const byId = new Map(e.nodes.map((n) => [n.id, n]));
        l.nodes.forEach((p) => {
          expect(isInt(p)).toBe(true);
          expect(inBox(p)).toBe(true);
          expect(p.h).toBeGreaterThanOrEqual(nodeHeight(byId.get(p.id)!, p.w, p.face));
        });
        // Nodes never overlap one another.
        l.nodes.forEach((a, i) =>
          l.nodes.slice(i + 1).forEach((b) => {
            const apart =
              a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
            expect(apart).toBe(true);
          }),
        );
      }
    }
  });

  it('finance: "144,000 USD" is a figure with room for it, and no verdict', () => {
    const fin = validateExplore((BUNDLED['cameo-finance'] as {explore: unknown}).explore)!;
    const l = layoutMap(fin, BOX, themeFor(fin.category).motif);
    const n3 = l.nodes.find((p) => p.id === 'n3')!;
    expect(n3.face.value).toBe(true);
    expect(n3.face.meta).toBe(false); // no "Claim · Unverified" on a figure
    expect(n3.face.bar).toBeCloseTo(144000 / 787000, 3);
    // value (30) + label "Paid in, start at 25" (21) + bar (6), gaps, padding.
    expect(n3.h).toBeGreaterThanOrEqual(30 + 21 + 6 + 2 * 4 + 2 * n3.face.pad);
    expect(l.headings.map((h) => h.title)).toEqual([
      'Ana starts at 25',
      'Ben starts at 35',
      'Why it happens',
    ]);
    // Rows line up across the columns.
    const rowOf = (id: string) => l.nodes.find((p) => p.id === id)!.y;
    expect(rowOf('n3')).toBe(rowOf('n4'));
    expect(rowOf('n5')).toBe(rowOf('n6'));
  });

  it('history: photo cards keep their photo and credit on the timeline', () => {
    const e = validateExplore((BUNDLED['cameo-history'] as {explore: unknown}).explore)!;
    const l = layoutMap(e, BOX, 'archive');
    const withPhoto = l.nodes.filter((p) => p.face.image).map((p) => p.id);
    expect(withPhoto).toEqual(e.nodes.filter((n) => n.image).map((n) => n.id));
    // And the dates stay on the cards.
    expect(l.nodes.every((p) => p.face.meta)).toBe(true);
  });

  it('a timeline label is a tag sized for its lines, centred on the axis', () => {
    const e = validateExplore((BUNDLED['crime-case104'] as {explore: unknown}).explore)!;
    const l = layoutMap(e, BOX, 'caseboard');
    const tag = l.edges.find((x) => x.label === 'phone was at the pier')!.labelBox!;
    expect(tag.h).toBeGreaterThanOrEqual(wrapLines('phone was at the pier', tag.w - 16, 13) * 18);
    expect(Math.abs(tag.y + tag.h / 2 - l.axis!.y)).toBeLessThanOrEqual(1);
    expect(l.chain).toHaveLength(4); // a string from each card to the next
  });

  it('the header and the story caption step down to fit their room', () => {
    expect(fitHeader(552, 88, 'Money · Example', 'Short title', 'A summary')).toEqual({
      title: 'title',
      summary: 'body',
    });
    const long = 'x '.repeat(100);
    expect(fitHeader(552, 88, 'Money', 'A title of forty-eight characters, long enough!!', long).summary).toBe(
      'caption',
    );
    const detail = 'First sentence here. ' + 'And a long second sentence that goes on. '.repeat(5);
    const f = fitCaption(300, 88, 'A label', detail);
    expect(f.text).toBe('First sentence here.');
    expect(fitCaption(552, 88, 'A label', 'Short detail.').text).toBe('Short detail.');
  });
});

describe('the story', () => {
  it('walks the unlocked pieces in reading order, never a locked one', () => {
    const l = layoutMap(crime, BOX, 'caseboard');
    expect(storyOrder(l, crime, 12)).toEqual(['c1', 'c2', 'c3']);
    expect(storyOrder(l, crime, null)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(storyOrder(layoutMap(sleep, BOX), sleep, 0)).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  it('travels pin to pin on the case board, along the axis elsewhere', () => {
    const board = layoutMap(crime, BOX, 'caseboard');
    expect(storyPath(board, 'c1', 'c2', 'caseboard')).toHaveLength(4);
    const plain = layoutMap(crime, BOX, 'plain');
    const p = storyPath(plain, 'c1', 'c2', 'plain');
    expect(p).toHaveLength(8);
    expect(p[3]).toBe(plain.axis!.y);
    expect(p[5]).toBe(plain.axis!.y);
  });

  it('flow: from the right edge of one piece to the left edge of the next', () => {
    const l = layoutMap(sleep, BOX, 'nightsky');
    const [a, b] = l.nodes;
    const p = storyPath(l, a.id, b.id, 'nightsky');
    expect(p[0]).toBe(a.x + a.w + 4);
    expect(p[p.length - 2]).toBe(b.x - 4);
    expect(storyPath(l, a.id, 'missing', 'nightsky')).toEqual([]);
  });

  it('Play sits above the toggle: UP from the toggle, DOWN back to it', () => {
    const PLAY = {x: 760, y: 27, w: 152, h: 40};
    const nb = neighbourMap(layoutMap(sleep, BOX), {...TOGGLE, y: 75}, PLAY);
    expect(nb[TOGGLE_ID]).toEqual({down: 'n4', up: PLAY_ID});
    expect(nb[PLAY_ID]).toEqual({down: TOGGLE_ID});
    expect(nb.n1.up).toBe(TOGGLE_ID);
  });
});

describe('timeline tags', () => {
  it('never overlap one another, and stay inside the box', () => {
    for (const id of ['cameo-history', 'crime-case104']) {
      const e = validateExplore((BUNDLED[id] as {explore: unknown}).explore)!;
      const tags = layoutMap(e, BOX, themeFor(e.category).motif)
        .edges.map((x) => x.labelBox)
        .filter((b): b is NonNullable<typeof b> => !!b)
        .sort((a, b) => a.x - b.x);
      expect(tags.length).toBeGreaterThan(0);
      tags.forEach((t, i) => {
        expect(t.x).toBeGreaterThanOrEqual(BOX.x);
        expect(t.x + t.w).toBeLessThanOrEqual(BOX.x + BOX.w);
        if (i > 0) {
          expect(t.x).toBeGreaterThanOrEqual(tags[i - 1].x + tags[i - 1].w);
        }
      });
    }
  });
});

describe('arrows and the story pulse agree', () => {
  const science = validateExplore((BUNDLED['science-ep42'] as {explore: unknown}).explore) as Explore;
  const tech = validateExplore((BUNDLED['cameo-tech'] as {explore: unknown}).explore) as Explore;

  it('puts arrowheads only on sequence links', () => {
    const l = layoutMap(science, BOX, 'nightsky');
    expect(l.edges.filter((e) => e.kind !== 'then').every((e) => e.arrow === null)).toBe(true);
    expect(l.edges.filter((e) => e.kind === 'then').every((e) => !!e.arrow)).toBe(true);
  });

  it('follows the connectors, through the step, instead of cutting across', () => {
    const l = layoutMap(science, BOX, 'nightsky');
    // n2 hangs under n1; n3 follows n1. From n2 to n3 the pulse climbs back
    // to n1 (passing its centre) and then rides the n1 → n3 connector.
    const n1 = l.nodes.find((n) => n.id === 'n1')!;
    const p = storyPath(l, 'n2', 'n3', 'nightsky');
    const xs = p.filter((_, i) => i % 2 === 0);
    const ys = p.filter((_, i) => i % 2 === 1);
    const centre = xs.findIndex(
      (x, i) => x === Math.round(n1.x + n1.w / 2) && ys[i] === Math.round(n1.y + n1.h / 2),
    );
    expect(centre).toBeGreaterThan(0);
    // After the centre it only moves right, along the arrow.
    for (let i = centre + 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
    }
  });

  it('draws a two-way pair as two parallel lines, not one double arrow', () => {
    const l = layoutMap(tech, BOX, 'signal');
    const fwd = l.edges.find((e) => e.from === 'n7' && e.to === 'n8')!;
    const back = l.edges.find((e) => e.from === 'n8' && e.to === 'n7')!;
    const y = (d: string) => Number(d.split(' ')[1]);
    expect(y(fwd.d)).toBeLessThan(y(back.d));
  });
});
