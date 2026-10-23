import {Explore, ExploreEdge, ExploreNode} from '../analysis/schema';

// The Map's geometry, computed in code from the data (CONTRACTS.md §9): no
// coordinates come from the AI. Everything is in integer dp on the 960 x 540
// canvas. Pure functions, so the layouts, the D-pad neighbour map, the lock
// rule and the step order are unit-tested.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedNode extends Rect {
  id: string;
  // Position in reading order (also the step-through order).
  order: number;
  // Timeline only: which side of the axis.
  side?: 'above' | 'below';
  // How many lines the label may take in this box.
  lines: number;
}

export interface PlacedHeading {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
}

export interface PlacedEdge {
  from: string;
  to: string;
  kind: ExploreEdge['kind'];
  label: string | null;
  d: string; // SVG path of the connector
  arrow: string | null; // SVG path of the arrowhead (a small triangle)
  labelBox: Rect | null; // where the label sits, when there is one
  labelAlign?: 'left'; // beside a vertical link rather than centred on it
}

export interface MapLayout {
  kind: 'flow' | 'timeline' | 'columns';
  nodes: PlacedNode[];
  headings: PlacedHeading[];
  edges: PlacedEdge[];
  // Timeline: the axis and the stem of each event.
  axis?: {y: number; x0: number; x1: number};
  stems?: Array<{id: string; x: number; y0: number; y1: number}>;
  // Compare: the launch button of the first sim, under the columns.
  simButton?: Rect & {simId: string};
}

export const LOOKAHEAD_S = 4;

// Spoiler rule (§9): a node said after the playhead plus 4 s is locked. A
// map with no video (a cameo) has no playhead and shows everything.
export const isLocked = (node: ExploreNode, playhead: number | null) =>
  playhead !== null && node.t !== null && node.t > playhead + LOOKAHEAD_S;

const r = Math.round;
const HEADING_H = 26; // a caption line (18) and 8 below it
const LINE = 21; // body line height
const CAPTION = 18;
const PAD = 12;

// Reading order: group by group (in the groups' order), and inside a group
// the order the agent gave, except on a timeline, where time decides.
export function readingOrder(explore: Explore): ExploreNode[] {
  const gi = new Map(explore.groups.map((g, i) => [g.id, i]));
  const byIndex = explore.nodes.map((n, i) => ({n, i}));
  const allTimed = explore.nodes.every((n) => n.t !== null);
  byIndex.sort((a, b) => {
    if (explore.layout === 'timeline' && allTimed) {
      return (a.n.t as number) - (b.n.t as number) || a.i - b.i;
    }
    return (gi.get(a.n.group) ?? 0) - (gi.get(b.n.group) ?? 0) || a.i - b.i;
  });
  return byIndex.map((x) => x.n);
}

// The step-through order: group by group, each group in reading order.
export function stepOrder(explore: Explore): ExploreNode[] {
  const order = readingOrder(explore);
  const out: ExploreNode[] = [];
  explore.groups.forEach((g) =>
    order.filter((n) => n.group === g.id).forEach((n) => out.push(n)),
  );
  return out;
}

export function layoutMap(explore: Explore, box: Rect): MapLayout {
  switch (explore.layout) {
    case 'flow':
      return layoutFlow(explore, box);
    case 'timeline':
      return layoutTimeline(explore, box);
    case 'compare':
    case 'cluster':
      return layoutColumns(explore, box);
  }
}

// ---- flow: left to right, wrapping into rows of at most four ----------------

const rowSizes = (n: number) => {
  const rows = Math.ceil(n / 4);
  const per = Math.ceil(n / rows);
  const out: number[] = [];
  for (let left = n; left > 0; left -= per) {
    out.push(Math.min(per, left));
  }
  return out;
};

function layoutFlow(explore: Explore, box: Rect): MapLayout {
  return layoutSpine(explore, box) ?? layoutGrid(explore, box);
}

// A flow as a spine: the main sequence left to right in one row, and each
// supporting piece (one linked only by supports / because / contradicts)
// hanging under the piece it explains. Used when the spine has at most four
// pieces and each has at most one supporter; otherwise the grid below.
function layoutSpine(explore: Explore, box: Rect): MapLayout | null {
  const order = readingOrder(explore);
  const thenIds = new Set<string>();
  explore.edges
    .filter((e) => e.kind === 'then')
    .forEach((e) => {
      thenIds.add(e.from);
      thenIds.add(e.to);
    });
  const linked = (id: string) =>
    explore.edges.filter((e) => e.from === id || e.to === id);
  const hostOf = new Map<string, string>();
  order.forEach((n) => {
    if (thenIds.has(n.id)) {
      return;
    }
    const e = linked(n.id)[0];
    const other = e ? (e.from === n.id ? e.to : e.from) : null;
    if (other && thenIds.has(other)) {
      hostOf.set(n.id, other);
    }
  });
  const spine = order.filter((n) => !hostOf.has(n.id));
  const hosted = new Map<string, string>(); // host → supporter
  for (const [sup, host] of hostOf) {
    if (hosted.has(host)) {
      return null;
    }
    hosted.set(host, sup);
  }
  if (spine.length > 4 || spine.length < 2 || hostOf.size === 0) {
    return null;
  }
  const spineIndex = new Map(spine.map((n, i) => [n.id, i]));
  const labelled = (a: string, b: string) =>
    explore.edges.some(
      (e) =>
        !!e.label &&
        ((e.from === a && e.to === b) || (e.from === b && e.to === a)),
    );
  const gaps = spine
    .slice(1)
    .map((n, i) => (labelled(spine[i].id, n.id) ? 96 : 40));
  const w = Math.min(
    232,
    Math.floor((box.w - gaps.reduce((a, g) => a + g, 0)) / spine.length),
  );
  const SPINE_H = 112;
  const SUP_H = 88;
  const GAP_Y = 48;
  const total = HEADING_H + SPINE_H + GAP_Y + SUP_H;
  if (total > box.h) {
    return null;
  }
  const top = box.y + Math.floor((box.h - total) / 2) + HEADING_H;
  const nodes: PlacedNode[] = [];
  let x = box.x;
  spine.forEach((n, i) => {
    nodes.push({id: n.id, order: 0, x: r(x), y: top, w, h: SPINE_H, lines: 3});
    x += w + (gaps[i] ?? 0);
  });
  const at = new Map(nodes.map((p) => [p.id, p]));
  for (const [host, sup] of hosted) {
    const h = at.get(host)!;
    const p: PlacedNode = {id: sup, order: 0, x: h.x, y: top + SPINE_H + GAP_Y, w, h: SUP_H, lines: 2};
    nodes.push(p);
    at.set(sup, p);
  }
  // Reading order: each spine piece, then the piece under it.
  let k = 0;
  spine.forEach((n) => {
    at.get(n.id)!.order = k++;
    const sup = hosted.get(n.id);
    if (sup) {
      at.get(sup)!.order = k++;
    }
  });
  nodes.sort((a, b) => a.order - b.order);

  const headings: PlacedHeading[] = [];
  spine.forEach((n, i) => {
    if (i > 0 && spine[i - 1].group === n.group) {
      return;
    }
    let end = i;
    while (spine[end + 1] && spine[end + 1].group === n.group) {
      end++;
    }
    const a = at.get(n.id)!;
    const b = at.get(spine[end].id)!;
    const g = explore.groups.find((x) => x.id === n.group);
    if (g) {
      headings.push({id: `${g.id}-${i}`, title: g.title, x: a.x, y: a.y - HEADING_H, w: b.x + b.w - a.x});
    }
  });

  const edges: PlacedEdge[] = explore.edges
    .filter((e) => at.has(e.from) && at.has(e.to))
    .map((e) => {
      const a = at.get(e.from)!;
      const b = at.get(e.to)!;
      if (hostOf.get(e.from) === e.to || hostOf.get(e.to) === e.from) {
        // A supporter and its host: a short vertical link, the label beside it.
        const up = b.y < a.y;
        const cxv = r(a.x + a.w / 2);
        const y0 = up ? a.y - 4 : a.y + a.h + 4;
        const y1 = up ? b.y + b.h + 4 : b.y - 4;
        return {
          from: e.from,
          to: e.to,
          kind: e.kind,
          label: e.label,
          d: `M${cxv} ${y0} L${cxv} ${y1}`,
          arrow: up
            ? `M${cxv} ${y1} L${cxv - ARROW + 1} ${y1 + ARROW} L${cxv + ARROW - 1} ${y1 + ARROW} Z`
            : arrowDown(cxv, y1),
          labelBox: e.label
            ? {x: cxv + 8, y: r((y0 + y1) / 2) - CAPTION, w: r(a.w / 2) + 24, h: 2 * CAPTION}
            : null,
          labelAlign: 'left' as const,
        };
      }
      return flowEdge(e, a, b, spineIndex);
    });
  return {kind: 'flow', nodes, headings, edges};
}

// A flow as a grid: left to right, wrapping into rows of at most four.
function layoutGrid(explore: Explore, box: Rect): MapLayout {
  const order = readingOrder(explore);
  const index = new Map(order.map((n, i) => [n.id, i]));
  const sizes = rowSizes(order.length);
  const labelled = (a: string, b: string) =>
    explore.edges.some(
      (e) =>
        !!e.label &&
        ((e.from === a && e.to === b) || (e.from === b && e.to === a)),
    );
  // A gap carries its edge label when there is one, so it is wider.
  const GAP = 40;
  const GAP_LABEL = 96;
  let start = 0;
  const rowGaps: number[][] = sizes.map((size) => {
    const gaps: number[] = [];
    for (let i = 0; i < size - 1; i++) {
      const a = order[start + i].id;
      const b = order[start + i + 1].id;
      gaps.push(labelled(a, b) ? GAP_LABEL : GAP);
    }
    start += size;
    return gaps;
  });
  // One node width for every row (a grid), the widest the busiest row allows.
  const w = Math.min(
    232,
    ...sizes.map((size, ri) =>
      Math.floor(
        (box.w - rowGaps[ri].reduce((s, g) => s + g, 0)) / Math.max(1, size),
      ),
    ),
  );
  const rows = sizes.length;
  const lines = rows >= 3 ? 2 : 3;
  // Padding, the meta line, then the label: 12 + 18 + 4 + 3 × 21 + 12 → 112.
  const nodeH = lines === 3 ? 112 : 88;
  const gapY =
    rows > 1
      ? Math.max(
          HEADING_H + 6,
          Math.min(
            72,
            Math.floor((box.h - HEADING_H - rows * nodeH) / (rows - 1)),
          ),
        )
      : 0;
  const total = HEADING_H + rows * nodeH + (rows - 1) * gapY;
  const top = box.y + Math.max(0, Math.floor((box.h - total) / 2));

  const nodes: PlacedNode[] = [];
  let k = 0;
  sizes.forEach((size, ri) => {
    let x = box.x;
    const y = top + HEADING_H + ri * (nodeH + gapY);
    for (let i = 0; i < size; i++) {
      nodes.push({id: order[k].id, order: k, x: r(x), y: r(y), w, h: nodeH, lines});
      x += w + (rowGaps[ri][i] ?? 0);
      k++;
    }
  });
  const at = new Map(nodes.map((n) => [n.id, n]));

  // A quiet heading above the first node of each run of a group.
  const headings: PlacedHeading[] = [];
  nodes.forEach((n, i) => {
    const node = order[i];
    const prev = order[i - 1];
    const prevPlaced = nodes[i - 1];
    if (!prev || prev.group !== node.group || prevPlaced.y !== n.y) {
      // Runs to the end of the group's nodes on this row.
      let end = n.x + n.w;
      for (let j = i + 1; j < nodes.length; j++) {
        if (order[j].group !== node.group || nodes[j].y !== n.y) {
          break;
        }
        end = nodes[j].x + nodes[j].w;
      }
      const g = explore.groups.find((x) => x.id === node.group);
      if (g) {
        headings.push({id: `${g.id}-${i}`, title: g.title, x: n.x, y: n.y - HEADING_H, w: end - n.x});
      }
    }
  });

  const edges: PlacedEdge[] = explore.edges
    .filter((e) => at.has(e.from) && at.has(e.to))
    .map((e) => flowEdge(e, at.get(e.from)!, at.get(e.to)!, index));
  return {kind: 'flow', nodes, headings, edges};
}

const ARROW = 6;
const arrowRight = (x: number, y: number) =>
  `M${x} ${y} L${x - ARROW} ${y - ARROW + 1} L${x - ARROW} ${y + ARROW - 1} Z`;
const arrowLeft = (x: number, y: number) =>
  `M${x} ${y} L${x + ARROW} ${y - ARROW + 1} L${x + ARROW} ${y + ARROW - 1} Z`;
const arrowDown = (x: number, y: number) =>
  `M${x} ${y} L${x - ARROW + 1} ${y - ARROW} L${x + ARROW - 1} ${y - ARROW} Z`;

function flowEdge(
  e: ExploreEdge,
  a: PlacedNode,
  b: PlacedNode,
  index: Map<string, number>,
): PlacedEdge {
  const base = {from: e.from, to: e.to, kind: e.kind, label: e.label};
  const ay = r(a.y + a.h / 2);
  const by = r(b.y + b.h / 2);
  const sameRow = a.y === b.y;
  const adjacent = Math.abs((index.get(a.id) ?? 0) - (index.get(b.id) ?? 0)) === 1;
  if (sameRow && adjacent) {
    // A straight connector across the gap, the label above it.
    const forward = b.x > a.x;
    const x0 = forward ? a.x + a.w + 4 : a.x - 4;
    const x1 = forward ? b.x - 4 : b.x + b.w + 4;
    const gap = Math.abs(x1 - x0);
    return {
      ...base,
      d: `M${x0} ${ay} L${x1} ${by}`,
      arrow: forward ? arrowRight(x1, by) : arrowLeft(x1, by),
      labelBox: e.label
        ? {x: Math.min(x0, x1), y: ay - 4 - 2 * CAPTION, w: gap, h: 2 * CAPTION}
        : null,
    };
  }
  if (sameRow) {
    // Not neighbours on a row: a low arc over the nodes in between.
    const x0 = r(a.x + a.w / 2);
    const x1 = r(b.x + b.w / 2);
    const y = a.y - 4;
    const lift = 18;
    return {
      ...base,
      d: `M${x0} ${y} C${x0} ${y - lift} ${x1} ${y - lift} ${x1} ${y}`,
      arrow: arrowDown(x1, y),
      labelBox: e.label
        ? {x: r((x0 + x1) / 2) - 60, y: y - lift - CAPTION, w: 120, h: CAPTION}
        : null,
    };
  }
  // Across rows: from the bottom of one to the top of the other.
  const down = b.y > a.y;
  const x0 = r(a.x + a.w / 2);
  const x1 = r(b.x + b.w / 2);
  const y0 = down ? a.y + a.h + 4 : a.y - 4;
  const y1 = down ? b.y - 4 : b.y + b.h + 4;
  const mid = r((y0 + y1) / 2);
  return {
    ...base,
    d: `M${x0} ${y0} C${x0} ${mid} ${x1} ${mid} ${x1} ${y1}`,
    arrow: down
      ? arrowDown(x1, y1)
      : `M${x1} ${y1} L${x1 - ARROW + 1} ${y1 + ARROW} L${x1 + ARROW - 1} ${y1 + ARROW} Z`,
    labelBox: e.label
      ? {x: r((x0 + x1) / 2) - 60, y: mid - CAPTION / 2, w: 120, h: CAPTION}
      : null,
  };
}

// ---- timeline: an axis, events alternately above and below -----------------

function layoutTimeline(explore: Explore, box: Rect): MapLayout {
  const order = readingOrder(explore);
  const n = order.length;
  // Neighbours sit on opposite sides, so a box may be up to two steps wide.
  const w = Math.min(232, Math.floor((2 * box.w - 16 * (n - 1)) / (n + 1)));
  const step = n > 1 ? (box.w - w) / (n - 1) : 0;
  const axisY = r(box.y + box.h / 2);
  const STEM = 24;
  const room = Math.floor(box.h / 2) - STEM;
  const lines = room >= 112 ? 3 : 2;
  const nodeH = Math.min(room, lines === 3 ? 112 : 88);
  const nodes: PlacedNode[] = order.map((node, i) => {
    const side = i % 2 === 0 ? 'above' : 'below';
    const x = r(box.x + i * step);
    const y = side === 'above' ? axisY - STEM - nodeH : axisY + STEM;
    return {id: node.id, order: i, side, x, y, w, h: nodeH, lines};
  });
  const at = new Map(nodes.map((p) => [p.id, p]));
  const stems = nodes.map((p) => ({
    id: p.id,
    x: r(p.x + p.w / 2),
    y0: p.side === 'above' ? p.y + p.h : p.y,
    y1: axisY,
  }));
  // Links between events. A contradiction is the axis itself between the
  // two events, drawn in the accent; `then` is what the axis already says,
  // so only its label is drawn. A label sits just above the axis, between
  // the two dots, in the 24 dp gap under the boxes. Other kinds (rare on a
  // timeline) are quiet arcs through the axis.
  const pos = new Map(order.map((n, i) => [n.id, i]));
  const usedGaps = new Set<string>();
  const labelAbove = (ax: number, bx: number, key: string) => {
    if (usedGaps.has(key)) {
      return null;
    }
    usedGaps.add(key);
    const x0 = Math.min(ax, bx);
    const w = Math.abs(bx - ax) - 16;
    return w >= 48 ? {x: x0 + 8, y: axisY - CAPTION - 4, w, h: CAPTION} : null;
  };
  const edges: PlacedEdge[] = [];
  explore.edges
    .filter((e) => at.has(e.from) && at.has(e.to))
    .sort((p, q) => (p.kind === 'contradicts' ? -1 : 0) - (q.kind === 'contradicts' ? -1 : 0))
    .forEach((e) => {
      const a = at.get(e.from)!;
      const b = at.get(e.to)!;
      const ax = r(a.x + a.w / 2);
      const bx = r(b.x + b.w / 2);
      const pa = pos.get(e.from) ?? 0;
      const pb = pos.get(e.to) ?? 0;
      const key = `${Math.min(pa, pb)}-${Math.max(pa, pb)}`;
      const base = {from: e.from, to: e.to, kind: e.kind, label: e.label, arrow: null};
      if (e.kind === 'contradicts') {
        edges.push({
          ...base,
          d: `M${ax} ${axisY} L${bx} ${axisY}`,
          labelBox: e.label ? labelAbove(ax, bx, key) : null,
        });
      } else if (e.kind === 'then') {
        if (e.label && Math.abs(pa - pb) === 1) {
          const box1 = labelAbove(ax, bx, key);
          if (box1) {
            edges.push({...base, d: '', labelBox: box1});
          }
        }
      } else {
        const ay = a.side === 'above' ? a.y + a.h + 4 : a.y - 4;
        const by = b.side === 'above' ? b.y + b.h + 4 : b.y - 4;
        edges.push({
          ...base,
          d: `M${ax} ${ay} Q${r((ax + bx) / 2)} ${axisY} ${bx} ${by}`,
          labelBox: e.label ? labelAbove(ax, bx, key) : null,
        });
      }
    });
  return {
    kind: 'timeline',
    nodes,
    headings: [],
    edges,
    axis: {y: axisY, x0: box.x, x1: box.x + box.w},
    stems,
  };
}

// ---- compare and cluster: one column per group ------------------------------

function layoutColumns(explore: Explore, box: Rect): MapLayout {
  const order = readingOrder(explore);
  const groups = explore.groups;
  const k = groups.length;
  const GAP = 24;
  const colW = Math.floor((box.w - (k - 1) * GAP) / k);
  const sim = explore.layout === 'compare' ? explore.sims[0] : undefined;
  const simH = sim ? 56 : 0;
  const HEAD = 25 + 12; // a headline and its margin
  const counts = groups.map((g) => order.filter((n) => n.group === g.id).length);
  const most = Math.max(1, ...counts);
  const avail = box.h - HEAD - simH;
  const nodeH = Math.max(
    48,
    Math.min(112, Math.floor((avail - (most - 1) * 8) / most / 8) * 8),
  );
  const nodes: PlacedNode[] = [];
  const headings: PlacedHeading[] = [];
  let k2 = 0;
  groups.forEach((g, gi) => {
    const x = box.x + gi * (colW + GAP);
    headings.push({id: g.id, title: g.title, x, y: box.y, w: colW});
    order
      .filter((n) => n.group === g.id)
      .forEach((n, i) => {
        const valued = explore.layout === 'compare' && n.value !== null;
        const textRoom = nodeH - 2 * PAD - (valued ? 30 + 2 : 0);
        nodes.push({
          id: n.id,
          order: k2++,
          x,
          y: box.y + HEAD + i * (nodeH + 8),
          w: colW,
          h: nodeH,
          lines: Math.max(1, Math.min(3, Math.floor(textRoom / LINE))),
        });
      });
  });
  // Reading order for columns is column by column.
  nodes.sort((a, b) => a.order - b.order);
  return {
    kind: 'columns',
    nodes,
    headings,
    edges: [],
    simButton: sim
      ? {simId: sim.id, x: box.x, y: box.y + box.h - 40, w: 240, h: 40}
      : undefined,
  };
}

// ---- the D-pad neighbour map --------------------------------------------------

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Neighbours = Record<string, Partial<Record<Dir, string>>>;

interface Item extends Rect {
  id: string;
}

const cx = (a: Rect) => a.x + a.w / 2;
const cy = (a: Rect) => a.y + a.h / 2;

// The nearest item in a direction: it must lie beyond the current one along
// that axis; among those, the smallest distance along the axis plus twice the
// offset across it wins, and ties go to the earlier item. Deterministic, so
// the same map always moves focus the same way.
export function nearest(items: Item[], from: Item, dir: Dir): Item | null {
  let best: Item | null = null;
  let bestScore = Infinity;
  for (const b of items) {
    if (b.id === from.id) {
      continue;
    }
    const dx = cx(b) - cx(from);
    const dy = cy(b) - cy(from);
    let primary: number;
    let cross: number;
    switch (dir) {
      case 'right':
        primary = dx;
        cross = Math.abs(dy);
        break;
      case 'left':
        primary = -dx;
        cross = Math.abs(dy);
        break;
      case 'down':
        primary = dy;
        cross = Math.abs(dx);
        break;
      case 'up':
        primary = -dy;
        cross = Math.abs(dx);
        break;
    }
    if (primary < 1) {
      continue;
    }
    const score = primary + 2 * cross;
    if (score < bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return best;
}

export const TOGGLE_ID = 'map-step-toggle';

// Neighbours for every focusable item of a laid-out map: its nodes, the
// "Step through" toggle (above the map) and a sim button (below it).
export function neighbourMap(layout: MapLayout, toggle: Rect | null): Neighbours {
  const nodes: Item[] = layout.nodes;
  const extras: Item[] = [];
  if (toggle) {
    extras.push({id: TOGGLE_ID, ...toggle});
  }
  if (layout.simButton) {
    const {simId, ...rect} = layout.simButton;
    extras.push({id: `sim-${simId}`, ...rect});
  }
  const items = [...nodes, ...extras];
  const out: Neighbours = {};
  const dirs: Dir[] = ['up', 'down', 'left', 'right'];
  items.forEach((a) => {
    out[a.id] = {};
    dirs.forEach((d) => {
      const b = nearest(items, a, d);
      if (b) {
        out[a.id][d] = b.id;
      }
    });
  });
  // The toggle above the map is reached only with UP, and a sim button
  // below it only with DOWN.
  const extraIds = new Set(extras.map((x) => x.id));
  nodes.forEach((a) => {
    const o = out[a.id];
    if (o.left && extraIds.has(o.left)) {
      delete o.left;
    }
    if (o.right && extraIds.has(o.right)) {
      delete o.right;
    }
    if (o.down === TOGGLE_ID) {
      delete o.down;
    }
    if (o.up && o.up !== TOGGLE_ID && extraIds.has(o.up)) {
      delete o.up;
    }
  });
  const seq = [...layout.nodes].sort((a, b) => a.order - b.order);
  if (layout.kind === 'timeline') {
    // Timeline: LEFT/RIGHT walk the events in time; UP/DOWN cross the axis
    // to the closest event on the other side (earlier one on a tie).
    seq.forEach((a, i) => {
      const o = out[a.id];
      delete o.left;
      delete o.right;
      if (seq[i - 1]) {
        o.left = seq[i - 1].id;
      }
      if (seq[i + 1]) {
        o.right = seq[i + 1].id;
      }
      const other = (side: 'above' | 'below') =>
        seq
          .filter((b) => b.side === side)
          .sort(
            (p, q) =>
              Math.abs(cx(p) - cx(a)) - Math.abs(cx(q) - cx(a)) ||
              p.order - q.order,
          )[0];
      if (a.side === 'below') {
        const up = other('above');
        if (up) {
          o.up = up.id;
        }
        if (layout.simButton) {
          o.down = `sim-${layout.simButton.simId}`;
        } else {
          delete o.down;
        }
      } else {
        const down = other('below');
        if (down) {
          o.down = down.id;
        }
        if (toggle) {
          o.up = TOGGLE_ID;
        } else {
          delete o.up;
        }
      }
    });
  } else if (layout.kind === 'flow') {
    // Flow and columns: at the end of a row RIGHT continues to the next node
    // in reading order, and at the start LEFT goes back to the previous one.
    seq.forEach((a, i) => {
      const o = out[a.id];
      if (!o.right && seq[i + 1]) {
        o.right = seq[i + 1].id;
      }
      if (!o.left && seq[i - 1]) {
        o.left = seq[i - 1].id;
      }
    });
  }
  if (toggle) {
    // The toggle only leads down into the map (to its top-right node).
    const t = out[TOGGLE_ID];
    delete t.left;
    delete t.right;
    delete t.up;
  }
  return out;
}

// The first piece to focus: the first unlocked node in reading order.
export function firstFocus(
  layout: MapLayout,
  explore: Explore,
  playhead: number | null,
): string | null {
  const byId = new Map(explore.nodes.map((n) => [n.id, n]));
  const seq = [...layout.nodes].sort((a, b) => a.order - b.order);
  const open = seq.find((p) => {
    const n = byId.get(p.id);
    return n && !isLocked(n, playhead);
  });
  return open?.id ?? seq[0]?.id ?? null;
}
