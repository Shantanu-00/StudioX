import {Explore, ExploreEdge, ExploreNode} from '../analysis/schema';
import {
  DENSITIES,
  FaceContext,
  faceFor,
  isNumber,
  NodeFace,
  nodeHeight,
  SIZE,
  textWidth,
  wrapLines,
} from './scene/measure';
import type {Motif} from './themes';

// The Map's geometry, computed in code from the data (CONTRACTS.md §9): no
// coordinates come from the AI. Everything is in integer dp on the 960 x 540
// canvas. Every node is sized for its own words (scene/measure.ts), stepping
// down in density until the map fits its box, so no text is cut off. Pure
// functions, so the layouts, the D-pad neighbour map, the lock rule, the
// story path and the step order are unit-tested.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedNode extends Rect {
  id: string;
  // Position in reading order (also the story order).
  order: number;
  // Timeline only: which side of the axis.
  side?: 'above' | 'below';
  // What the card shows in this box (measured to fit).
  face: NodeFace;
}

export interface PlacedHeading {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  size: 'caption' | 'headline';
}

export interface PlacedEdge {
  from: string;
  to: string;
  kind: ExploreEdge['kind'];
  label: string | null;
  d: string; // SVG path of the connector
  arrow: string | null; // SVG path of the arrowhead (a small triangle)
  labelBox: Rect | null; // where the label sits, sized for its lines
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
  // Timeline: a string from each event's pin to the next one's (the case
  // board draws these instead of the axis).
  chain?: Array<{from: string; to: string; d: string}>;
  // Compare: the launch button of the first sim, under the columns.
  simButton?: Rect & {simId: string};
}

export const LOOKAHEAD_S = 4;

// Spoiler rule (§9, §10): only a suspense story (crime, or flagged) locks,
// and then a node said after the playhead plus 4 s is locked. A map with no
// video (a cameo) has no playhead and shows everything.
export const isLocked = (
  node: ExploreNode,
  playhead: number | null,
  suspense: boolean,
) =>
  suspense &&
  playhead !== null &&
  node.t !== null &&
  node.t > playhead + LOOKAHEAD_S;

const r = Math.round;
const HEADING_H = 26; // a caption line (18) and 8 below it
const CAPTION = SIZE.caption[1];

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

const contextFor = (explore: Explore, motif: Motif): FaceContext => ({
  motif,
  maxValue: Math.max(
    0,
    ...explore.nodes
      .filter((n) => isNumber(n) && n.value)
      .map((n) => Math.abs(n.value!.n)),
  ),
});

export function layoutMap(
  explore: Explore,
  box: Rect,
  motif: Motif = 'plain',
): MapLayout {
  const ctx = contextFor(explore, motif);
  const l = ((): MapLayout => {
    switch (explore.layout) {
      case 'flow':
        return layoutSpine(explore, box, ctx) ?? layoutGrid(explore, box, ctx);
      case 'timeline':
        return layoutTimeline(explore, box, ctx);
      case 'compare':
      case 'cluster':
        return layoutColumns(explore, box, ctx);
    }
  })();
  // An arrowhead means "what comes next", so only sequence links carry one.
  // A claim attached to a step (supports, because, contradicts) is a plain
  // connector: an arrow pointing back at its step read as the story running
  // backwards while the pulse walked forwards.
  return {
    ...l,
    edges: l.edges.map((e) => (e.kind === 'then' ? e : {...e, arrow: null})),
  };
}

// Faces and one shared height for `nodes` at width `w`, at the roomiest
// density whose height passes `fits`; the tightest one otherwise.
function measureAll(
  nodes: ExploreNode[],
  w: number,
  ctx: FaceContext,
  fits: (h: number) => boolean,
) {
  let out = {faces: new Map<string, NodeFace>(), h: 0, ok: false};
  for (const d of DENSITIES) {
    const faces = new Map(nodes.map((n) => [n.id, faceFor(n, w, d, ctx)]));
    const h = Math.max(48, ...nodes.map((n) => nodeHeight(n, w, faces.get(n.id)!)));
    out = {faces, h, ok: fits(h)};
    if (out.ok) {
      break;
    }
  }
  return out;
}

// A caption label in a box `w` wide: its height in whole lines.
const labelH = (label: string, w: number) =>
  Math.max(1, wrapLines(label, w, SIZE.caption[0])) * CAPTION;

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

// A flow as a spine: the main sequence left to right in one row, and each
// supporting piece (one linked only by supports / because / contradicts)
// hanging under the piece it explains. Used when the spine has at most four
// pieces and each has at most one supporter; otherwise the grid below.
function layoutSpine(explore: Explore, box: Rect, ctx: FaceContext): MapLayout | null {
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
  const GAP_Y = 48;
  const sups = order.filter((n) => hostOf.has(n.id));
  // Spine and supporters share one density, the roomiest both fit at.
  const at0 = (ns: ExploreNode[], d: number) => {
    const faces = new Map(ns.map((n) => [n.id, faceFor(n, w, d, ctx)]));
    const h = Math.max(48, ...ns.map((n) => nodeHeight(n, w, faces.get(n.id)!)));
    return {faces, h};
  };
  let spineM = at0(spine, 0);
  let supM = at0(sups, 0);
  for (const d of DENSITIES) {
    spineM = at0(spine, d);
    supM = at0(sups, d);
    if (HEADING_H + spineM.h + GAP_Y + supM.h <= box.h) {
      break;
    }
  }
  const total = HEADING_H + spineM.h + GAP_Y + supM.h;
  if (total > box.h) {
    return null;
  }
  const top = box.y + Math.floor((box.h - total) / 2) + HEADING_H;
  const nodes: PlacedNode[] = [];
  let x = box.x;
  spine.forEach((n, i) => {
    nodes.push({id: n.id, order: 0, x: r(x), y: top, w, h: spineM.h, face: spineM.faces.get(n.id)!});
    x += w + (gaps[i] ?? 0);
  });
  const at = new Map(nodes.map((p) => [p.id, p]));
  for (const [host, sup] of hosted) {
    const h = at.get(host)!;
    const p: PlacedNode = {
      id: sup,
      order: 0,
      x: h.x,
      y: top + spineM.h + GAP_Y,
      w,
      h: supM.h,
      face: supM.faces.get(sup)!,
    };
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
    const g = explore.groups.find((gr) => gr.id === n.group);
    if (g) {
      headings.push(heading(`${g.id}-${i}`, g.title, a.x, a.y - HEADING_H, b.x + b.w - a.x, gaps[end] ?? 0));
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
        const lw = r(a.w / 2) + 24;
        const lh = e.label ? labelH(e.label, lw) : 0;
        return {
          from: e.from,
          to: e.to,
          kind: e.kind,
          label: e.label,
          d: `M${cxv} ${y0} L${cxv} ${y1}`,
          arrow: up ? arrowUp(cxv, y1) : arrowDown(cxv, y1),
          labelBox: e.label
            ? {x: cxv + 8, y: r((y0 + y1) / 2 - lh / 2), w: lw, h: lh}
            : null,
          labelAlign: 'left' as const,
        };
      }
      return flowEdge(e, a, b, spineIndex);
    });
  return {kind: 'flow', nodes, headings, edges};
}

// A group heading over a run of nodes; it may run on into the gap after the
// run, and wraps (upwards) if even that is too narrow.
function heading(
  id: string,
  title: string,
  x: number,
  y: number,
  w: number,
  after: number,
): PlacedHeading {
  const width = w + Math.max(0, after - 8);
  const lines = Math.max(1, wrapLines(title, width, SIZE.caption[0]));
  return {id, title, x, y: y - (lines - 1) * CAPTION, w: width, size: 'caption'};
}

// A flow as a grid: left to right, wrapping into rows of at most four.
function layoutGrid(explore: Explore, box: Rect, ctx: FaceContext): MapLayout {
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
  const MIN_GAP_Y = HEADING_H + 6;
  const m = measureAll(
    order,
    w,
    ctx,
    (h) => HEADING_H + rows * h + (rows - 1) * MIN_GAP_Y <= box.h,
  );
  const nodeH = m.h;
  const gapY =
    rows > 1
      ? Math.max(
          MIN_GAP_Y,
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
      const id = order[k].id;
      nodes.push({id, order: k, x: r(x), y: r(y), w, h: nodeH, face: m.faces.get(id)!});
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
      let after = 0;
      for (let j = i + 1; j < nodes.length; j++) {
        if (nodes[j].y !== n.y) {
          break;
        }
        if (order[j].group !== node.group) {
          after = nodes[j].x - end;
          break;
        }
        end = nodes[j].x + nodes[j].w;
      }
      const g = explore.groups.find((x) => x.id === node.group);
      if (g) {
        headings.push(heading(`${g.id}-${i}`, g.title, n.x, n.y - HEADING_H, end - n.x, after));
      }
    }
  });

  const linked = (a: string, b: string) =>
    explore.edges.some((x) => x.from === a && x.to === b);
  const edges: PlacedEdge[] = explore.edges
    .filter((e) => at.has(e.from) && at.has(e.to))
    .map((e) =>
      flowEdge(e, at.get(e.from)!, at.get(e.to)!, index, linked(e.to, e.from)),
    );
  return {kind: 'flow', nodes, headings, edges};
}

const ARROW = 6;
const arrowRight = (x: number, y: number) =>
  `M${x} ${y} L${x - ARROW} ${y - ARROW + 1} L${x - ARROW} ${y + ARROW - 1} Z`;
const arrowLeft = (x: number, y: number) =>
  `M${x} ${y} L${x + ARROW} ${y - ARROW + 1} L${x + ARROW} ${y + ARROW - 1} Z`;
const arrowDown = (x: number, y: number) =>
  `M${x} ${y} L${x - ARROW + 1} ${y - ARROW} L${x + ARROW - 1} ${y - ARROW} Z`;
const arrowUp = (x: number, y: number) =>
  `M${x} ${y} L${x - ARROW + 1} ${y + ARROW} L${x + ARROW - 1} ${y + ARROW} Z`;

function flowEdge(
  e: ExploreEdge,
  a: PlacedNode,
  b: PlacedNode,
  index: Map<string, number>,
  // The same two pieces are also linked the other way ("next chunk, again").
  twoWay = false,
): PlacedEdge {
  const base = {from: e.from, to: e.to, kind: e.kind, label: e.label};
  const sameRow = a.y === b.y;
  const adjacent = Math.abs((index.get(a.id) ?? 0) - (index.get(b.id) ?? 0)) === 1;
  if (sameRow && adjacent) {
    // A straight connector across the gap, the label above it. A two-way
    // pair is two parallel lines, forward above and back below, each with
    // its own arrow, never one line with a head at both ends.
    const forward = b.x > a.x;
    const shift = twoWay ? (forward ? -5 : 5) : 0;
    const ay = r(a.y + a.h / 2) + shift;
    const by = r(b.y + b.h / 2) + shift;
    const x0 = forward ? a.x + a.w + 4 : a.x - 4;
    const x1 = forward ? b.x - 4 : b.x + b.w + 4;
    const gap = Math.abs(x1 - x0);
    const lh = e.label ? labelH(e.label, gap) : 0;
    const below = twoWay && !forward;
    return {
      ...base,
      d: `M${x0} ${ay} L${x1} ${by}`,
      arrow: forward ? arrowRight(x1, by) : arrowLeft(x1, by),
      labelBox: e.label
        ? {x: Math.min(x0, x1), y: below ? ay + 6 : ay - 6 - lh, w: gap, h: lh}
        : null,
    };
  }
  if (sameRow) {
    // Not neighbours on a row: a low arc over the nodes in between.
    const x0 = r(a.x + a.w / 2);
    const x1 = r(b.x + b.w / 2);
    const y = a.y - 4;
    const lift = 18;
    const lh = e.label ? labelH(e.label, 120) : 0;
    return {
      ...base,
      d: `M${x0} ${y} C${x0} ${y - lift} ${x1} ${y - lift} ${x1} ${y}`,
      arrow: arrowDown(x1, y),
      labelBox: e.label
        ? {x: r((x0 + x1) / 2) - 60, y: y - lift - lh, w: 120, h: lh}
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
  const lh = e.label ? labelH(e.label, 120) : 0;
  return {
    ...base,
    d: `M${x0} ${y0} C${x0} ${mid} ${x1} ${mid} ${x1} ${y1}`,
    arrow: down ? arrowDown(x1, y1) : arrowUp(x1, y1),
    labelBox: e.label
      ? {x: r((x0 + x1) / 2) - 60, y: r(mid - lh / 2), w: 120, h: lh}
      : null,
  };
}

// ---- timeline: an axis, events alternately above and below -----------------

// Where an event meets the axis band: the middle of its edge nearest the
// axis. The stem starts here; on the case board, the pin.
export const pinPoint = (p: PlacedNode) => ({
  x: r(p.x + p.w / 2),
  y: p.side === 'above' ? p.y + p.h : p.y,
});

function layoutTimeline(explore: Explore, box: Rect, ctx: FaceContext): MapLayout {
  const order = readingOrder(explore);
  const n = order.length;
  // Neighbours sit on opposite sides, so a box may be up to two steps wide.
  const w = Math.min(232, Math.floor((2 * box.w - 16 * (n - 1)) / (n + 1)));
  const step = n > 1 ? (box.w - w) / (n - 1) : 0;
  const axisY = r(box.y + box.h / 2);
  const STEM = 24;
  const room = Math.floor(box.h / 2) - STEM;
  const m = measureAll(order, w, ctx, (h) => h <= room);
  const nodeH = Math.min(room, m.h);
  const nodes: PlacedNode[] = order.map((node, i) => {
    const side = i % 2 === 0 ? 'above' : 'below';
    const x = r(box.x + i * step);
    const y = side === 'above' ? axisY - STEM - nodeH : axisY + STEM;
    return {id: node.id, order: i, side, x, y, w, h: nodeH, face: m.faces.get(node.id)!};
  });
  const at = new Map(nodes.map((p) => [p.id, p]));
  const stems = nodes.map((p) => ({
    id: p.id,
    x: r(p.x + p.w / 2),
    y0: p.side === 'above' ? p.y + p.h : p.y,
    y1: axisY,
  }));
  const chain = nodes.slice(1).map((b, i) => {
    const a = pinPoint(nodes[i]);
    const c = pinPoint(b);
    // A string sags a little under its own weight.
    return {
      from: nodes[i].id,
      to: b.id,
      d: `M${a.x} ${a.y} Q${r((a.x + c.x) / 2)} ${r((a.y + c.y) / 2) + 10} ${c.x} ${c.y}`,
    };
  });
  // Links between events. A contradiction is the axis itself between the
  // two events, drawn in the accent; `then` is what the axis already says,
  // so only its label is drawn. A label is a small tag centred on the axis
  // between the two dots, sized for its lines. Other kinds (rare on a
  // timeline) are quiet arcs through the axis.
  const pos = new Map(order.map((nd, i) => [nd.id, i]));
  const usedGaps = new Set<string>();
  const tag = (ax: number, bx: number, key: string, text: string): Rect | null => {
    if (usedGaps.has(key)) {
      return null;
    }
    usedGaps.add(key);
    const gap = Math.abs(bx - ax) - 16;
    const tw = Math.ceil(textWidth(text, SIZE.caption[0])) + 16;
    const tagW = Math.max(48, Math.min(tw, Math.max(gap, 176), box.w));
    const tagH = labelH(text, tagW - 16) + 4;
    const x = Math.min(
      box.x + box.w - tagW,
      Math.max(box.x, r((ax + bx) / 2 - tagW / 2)),
    );
    return {x, y: axisY - r(tagH / 2), w: tagW, h: tagH};
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
          labelBox: e.label ? tag(ax, bx, key, e.label) : null,
        });
      } else if (e.kind === 'then') {
        if (e.label && Math.abs(pa - pb) === 1) {
          const box1 = tag(ax, bx, key, e.label);
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
          labelBox: e.label ? tag(ax, bx, key, e.label) : null,
        });
      }
    });
  separateTags(
    edges
      .filter((e) => e.labelBox && e.label)
      .map((e) => ({box: e.labelBox!, text: e.label!})),
    box,
  );
  return {
    kind: 'timeline',
    nodes,
    headings: [],
    edges,
    axis: {y: axisY, x0: box.x, x1: box.x + box.w},
    stems,
    chain,
  };
}

// Tags on the axis never overlap: neighbours are pushed apart along the axis
// (rightwards, then back inside the box), and a tag with no room left
// narrows and wraps onto more lines. Mutates the boxes in place.
function separateTags(items: Array<{box: Rect; text: string}>, box: Rect) {
  const GAP = 8;
  items.sort((a, b) => a.box.x - b.box.x);
  const tags = items.map((it) => it.box);
  for (let i = 1; i < tags.length; i++) {
    const min = tags[i - 1].x + tags[i - 1].w + GAP;
    if (tags[i].x < min) {
      tags[i].x = min;
    }
  }
  let right = box.x + box.w;
  for (let i = tags.length - 1; i >= 0; i--) {
    const t = tags[i];
    if (t.x + t.w > right) {
      t.x = Math.max(right - t.w, i > 0 ? tags[i - 1].x + tags[i - 1].w + GAP : box.x);
      if (t.x + t.w > right) {
        // No room to move: narrow it to what is left and let it wrap.
        const cy0 = t.y + t.h / 2;
        const w = Math.max(48, right - t.x);
        t.h = labelH(items[i].text, w - 16) + 4;
        t.w = w;
        t.y = r(cy0 - t.h / 2);
      }
    }
    right = t.x - GAP;
  }
}

// ---- compare and cluster: one column per group ------------------------------

// Columns side by side, rows aligned across them (so "Ana" and "Ben" line up
// figure for figure). A group too tall for one column takes a second.
function layoutColumns(explore: Explore, box: Rect, ctx: FaceContext): MapLayout {
  const order = readingOrder(explore);
  const groups = explore.groups;
  const GAP = 24;
  const ROW_GAP = 8;
  const sim = explore.layout === 'compare' ? explore.sims[0] : undefined;
  const simH = sim ? 56 : 0;
  const members = groups.map((g) => order.filter((n) => n.group === g.id));
  const slots = groups.map(() => 1);
  const MAX_SLOTS = Math.max(4, groups.length);

  interface Attempt {
    colW: number;
    headH: number;
    cols: ExploreNode[][]; // nodes per slot, slot-major
    owner: number[]; // group index of each slot
    faces: Map<string, NodeFace>;
    rowH: number[];
    ok: boolean;
  }
  const attempt = (d: number): Attempt => {
    const S = slots.reduce((a, b) => a + b, 0);
    const colW = Math.floor((box.w - (S - 1) * GAP) / S);
    const span = (gi: number) => slots[gi] * colW + (slots[gi] - 1) * GAP;
    const headH =
      Math.max(
        ...groups.map((g, gi) => wrapLines(g.title, span(gi), SIZE.headline[0])),
      ) *
        SIZE.headline[1] +
      12;
    const cols: ExploreNode[][] = [];
    const owner: number[] = [];
    members.forEach((ns, gi) => {
      const per = Math.ceil(ns.length / slots[gi]);
      for (let s = 0; s < slots[gi]; s++) {
        cols.push(ns.slice(s * per, (s + 1) * per));
        owner.push(gi);
      }
    });
    const faces = new Map(order.map((n) => [n.id, faceFor(n, colW, d, ctx)]));
    const rows = Math.max(1, ...cols.map((c) => c.length));
    const rowH = Array.from({length: rows}, (_, i) =>
      Math.max(
        48,
        ...cols.filter((c) => c[i]).map((c) => nodeHeight(c[i], colW, faces.get(c[i].id)!)),
      ),
    );
    const total = rowH.reduce((a, b) => a + b, 0) + (rows - 1) * ROW_GAP;
    return {colW, headH, cols, owner, faces, rowH, ok: total <= box.h - headH - simH};
  };
  let best: Attempt = attempt(0);
  for (;;) {
    for (const d of DENSITIES) {
      best = attempt(d);
      if (best.ok) {
        break;
      }
    }
    const S = slots.reduce((a, b) => a + b, 0);
    if (best.ok || S >= MAX_SLOTS) {
      break;
    }
    // Give the group with the most nodes per column another column.
    let gi = 0;
    members.forEach((ns, i) => {
      if (ns.length / slots[i] > members[gi].length / slots[gi]) {
        gi = i;
      }
    });
    if (members[gi].length <= slots[gi]) {
      break;
    }
    slots[gi]++;
  }

  const {colW, headH, cols, owner, faces, rowH} = best;
  const rowY = rowH.map((_, i) =>
    rowH.slice(0, i).reduce((a, b) => a + b + ROW_GAP, box.y + headH),
  );
  const nodes: PlacedNode[] = [];
  const headings: PlacedHeading[] = [];
  let k = 0;
  cols.forEach((col, si) => {
    const x = box.x + si * (colW + GAP);
    const gi = owner[si];
    if (si === 0 || owner[si - 1] !== gi) {
      const w = slots[gi] * colW + (slots[gi] - 1) * GAP;
      headings.push({id: groups[gi].id, title: groups[gi].title, x, y: box.y, w, size: 'headline'});
    }
    col.forEach((n, i) => {
      nodes.push({
        id: n.id,
        order: k++,
        x,
        y: rowY[i],
        w: colW,
        h: rowH[i],
        face: faces.get(n.id)!,
      });
    });
  });
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

// ---- the story: the order the Play pulse walks, and its path --------------------

// The pieces the story visits, in reading order, never a locked one.
export function storyOrder(
  layout: MapLayout,
  explore: Explore,
  playhead: number | null,
): string[] {
  const byId = new Map(explore.nodes.map((n) => [n.id, n]));
  return [...layout.nodes]
    .sort((a, b) => a.order - b.order)
    .filter((p) => {
      const n = byId.get(p.id);
      return !!n && !isLocked(n, playhead, explore.suspense);
    })
    .map((p) => p.id);
}

// The pulse's path from one piece to the next, as flat [x0, y0, x1, y1, …]
// in dp: along the axis on a timeline (straight along the string on the case
// board), and an orthogonal route through the gaps elsewhere.
export function storyPath(
  layout: MapLayout,
  fromId: string,
  toId: string,
  motif: Motif,
): number[] {
  const a = layout.nodes.find((p) => p.id === fromId);
  const b = layout.nodes.find((p) => p.id === toId);
  if (!a || !b) {
    return [];
  }
  if (layout.kind === 'timeline' && layout.axis) {
    const pa = pinPoint(a);
    const pb = pinPoint(b);
    if (motif === 'caseboard') {
      return [pa.x, pa.y, pb.x, pb.y];
    }
    const ay = layout.axis.y;
    return [pa.x, pa.y, pa.x, ay, pb.x, ay, pb.x, pb.y];
  }
  // Along the drawn connectors, so the pulse never cuts across empty space
  // or runs against an arrow when a line is there to follow.
  const route = connectorRoute(layout, fromId, toId);
  if (route) {
    return route;
  }
  const acx = r(a.x + a.w / 2);
  const acy = r(a.y + a.h / 2);
  const bcx = r(b.x + b.w / 2);
  const bcy = r(b.y + b.h / 2);
  if (b.x >= a.x + a.w) {
    const mx = r((a.x + a.w + b.x) / 2);
    return [a.x + a.w + 4, acy, mx, acy, mx, bcy, b.x - 4, bcy];
  }
  if (b.x + b.w <= a.x) {
    if (b.y > a.y) {
      const my = r((a.y + a.h + b.y) / 2);
      return [acx, a.y + a.h + 4, acx, my, bcx, my, bcx, b.y - 4];
    }
    const my = r((b.y + b.h + a.y) / 2);
    return [acx, a.y - 4, acx, my, bcx, my, bcx, b.y + b.h + 4];
  }
  return b.y > a.y
    ? [acx, a.y + a.h + 4, bcx, b.y - 4]
    : [acx, a.y - 4, bcx, b.y + b.h + 4];
}

// A connector's SVG path (M, L and C only, as drawn here) as a flat
// polyline; curves are sampled.
export function pathPoints(d: string): number[] {
  const tok = d.match(/[MLC]|-?\d+(?:\.\d+)?/g) ?? [];
  const out: number[] = [];
  let cmd = 'M';
  let x = 0;
  let y = 0;
  for (let i = 0; i < tok.length; ) {
    if (/^[MLC]$/.test(tok[i])) {
      cmd = tok[i++];
      continue;
    }
    if (cmd === 'C') {
      const [x1, y1, x2, y2, x3, y3] = tok.slice(i, i + 6).map(Number);
      i += 6;
      for (const t of [0.25, 0.5, 0.75, 1]) {
        const u = 1 - t;
        out.push(
          u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        );
      }
      x = x3;
      y = y3;
    } else {
      x = Number(tok[i]);
      y = Number(tok[i + 1]);
      i += 2;
      out.push(x, y);
    }
  }
  return out;
}

const reversed = (pts: number[]) => {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) {
    out.push(pts[i], pts[i + 1]);
  }
  return out;
};

// The shortest chain of drawn connectors from one piece to another (at most
// four), as one polyline. A link drawn in the travel direction wins over
// the same link drawn the other way. Between two connectors the path passes
// through the piece's centre, under its card. Null when nothing links them.
function connectorRoute(layout: MapLayout, fromId: string, toId: string): number[] | null {
  const drawn = layout.edges.filter((e) => e.d);
  const prev = new Map<string, {id: string; pts: number[]}>([[fromId, {id: '', pts: []}]]);
  let frontier = [fromId];
  for (let depth = 0; depth < 4 && !prev.has(toId) && frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      const out = drawn.filter((e) => e.from === id).map((e) => ({to: e.to, pts: pathPoints(e.d)}));
      const back = drawn
        .filter((e) => e.to === id)
        .map((e) => ({to: e.from, pts: reversed(pathPoints(e.d))}));
      for (const step of [...out, ...back]) {
        if (!prev.has(step.to)) {
          prev.set(step.to, {id, pts: step.pts});
          next.push(step.to);
        }
      }
    }
    frontier = next;
  }
  if (!prev.has(toId) || fromId === toId) {
    return null;
  }
  // The chain of pieces, then each leg between neighbours in it.
  const ids = [toId];
  while (ids[0] !== fromId) {
    ids.unshift(prev.get(ids[0])!.id);
  }
  const out: number[] = [];
  ids.slice(1).forEach((id, i) => {
    if (i > 0) {
      const p = layout.nodes.find((n) => n.id === ids[i])!;
      out.push(r(p.x + p.w / 2), r(p.y + p.h / 2));
    }
    out.push(...prev.get(id)!.pts);
  });
  return out.length >= 4 ? out : null;
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
export const PLAY_ID = 'map-play';

// Neighbours for every focusable item of a laid-out map: its nodes, the
// "Step through" toggle (above the map), the Play control (above the
// toggle) and a sim button (below the map).
export function neighbourMap(
  layout: MapLayout,
  toggle: Rect | null,
  play: Rect | null = null,
): Neighbours {
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
    // Flow: at the end of a row RIGHT continues to the next node in reading
    // order, and at the start LEFT goes back to the previous one.
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
    // The toggle only leads down into the map (to its top-right node), and
    // up to Play when there is one.
    const t = out[TOGGLE_ID];
    delete t.left;
    delete t.right;
    delete t.up;
    if (play) {
      t.up = PLAY_ID;
      out[PLAY_ID] = {down: TOGGLE_ID};
    }
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
    return n && !isLocked(n, playhead, explore.suspense);
  });
  return open?.id ?? seq[0]?.id ?? null;
}
