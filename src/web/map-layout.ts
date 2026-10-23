/**
 * The map of the places, drawn on a square grid as in classic role-playing games: each place on a
 * cell, each road along one of the four directions or, only where a place has more than four
 * roads, at 45°. No two roads cross and no road passes over a place. The bot gives no distances,
 * so the length of a road is free and is chosen to make the map fit.
 *
 * The map is the tree of the shortest routes from a root (the village, `startPlace`), drawn in
 * three steps:
 *
 * 1. Directions, by rules alone: at each place, its straight directions go to its biggest
 *    branches, best first (along the main axis, then across it), a branch linked to a bigger
 *    sibling goes beside it, and the rest go diagonally, beside the smallest branches.
 * 2. Lengths, by pushing out: each branch is drawn on its own, then joined to its place as one
 *    block, as it is or mirrored, with the shortest road that lets it fit. Diagonal branches join
 *    first, one cell out, and the straight ones push out past them.
 * 3. Folding: a straight chain of places ending in a dead end turns a right angle, where the map
 *    gets smaller for it, after everything else is drawn.
 *
 * The places that the village does not reach go on free cells along the edge of the map.
 *
 * It uses no browser API: `placeLabels` takes the measure of a text from its caller.
 */

/** A place: its name and the places its exits lead to. */
export interface MapPlace {
  readonly name: string;
  readonly exits: readonly string[];
}

/** The main axis of the map: horizontal (`h`) for a wide screen, vertical (`v`) for a tall one. */
export type Axis = 'h' | 'v';

/** A cell of the grid: x grows to the east, y to the south. */
export type Cell = readonly [number, number];

/** A road between two places: both ways, or from `a` to `b` only. */
export interface MapRoad {
  readonly a: string;
  readonly b: string;
  readonly oneWay: boolean;
}

export interface MapLayout {
  /** The place the map starts from, if there is any place. */
  readonly root: string | undefined;
  /** The cell of every place. */
  readonly cells: ReadonlyMap<string, Cell>;
  readonly roads: readonly MapRoad[];
  /** The places on the shortest route from the root to `name`, both ends included; none if
   * the root does not reach it. */
  route(name: string): string[];
}

export interface MapOptions {
  readonly axis: Axis;
  /** Whether long straight chains turn to make the map smaller (step 3). */
  readonly fold?: boolean;
}

/**
 * The village, where every player starts: the bot calls it "il villaggio" (a refused journey
 * names the item needed "sulla via per tornare al villaggio"). Without one, the place with the
 * most roads.
 */
export function startPlace(places: readonly MapPlace[]): string | undefined {
  const village = places
    .map((p) => p.name)
    .sort()
    .find((n) => /^il villaggio\b/u.test(n));
  if (village) return village;
  const roads = new Map<string, number>();
  const known = new Set(places.map((p) => p.name));
  for (const p of places)
    for (const x of p.exits)
      if (known.has(x) && x !== p.name) {
        roads.set(p.name, (roads.get(p.name) ?? 0) + 1);
        roads.set(x, (roads.get(x) ?? 0) + 1);
      }
  let best: string | undefined;
  for (const n of [...known].sort())
    if (best === undefined || (roads.get(n) ?? 0) > (roads.get(best) ?? 0)) best = n;
  return best;
}

// ---- geometry ---------------------------------------------------------------------------

/** A segment, from (x0, y0) to (x1, y1). */
export type Segment = readonly [number, number, number, number];

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));

/** Whether two segments on the same line overlap for more than a point. */
function overlap(s: Segment, t: Segment): boolean {
  const along = Math.abs(s[2] - s[0]) > Math.abs(s[3] - s[1]);
  const [p0, p1] = along ? [s[0], s[2]] : [s[1], s[3]];
  const [q0, q1] = along ? [t[0], t[2]] : [t[1], t[3]];
  return Math.min(p0, p1) < Math.max(q0, q1) && Math.min(q0, q1) < Math.max(p0, p1);
}

/** Whether two segments cross, or overlap; meeting at an end is not crossing. */
export function crosses(s: Segment, t: Segment): boolean {
  const [ax, ay, bx, by] = s;
  const [cx, cy, dx, dy] = t;
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  const shareEnd =
    (ax === cx && ay === cy) ||
    (ax === dx && ay === dy) ||
    (bx === cx && by === cy) ||
    (bx === dx && by === dy);
  if (shareEnd || (!o1 && !o2 && !o3 && !o4)) return !o1 && !o2 && overlap(s, t);
  return o1 * o2 <= 0 && o3 * o4 <= 0;
}

/** Whether a point lies on a segment, other than at its ends. */
function inside(s: Segment, [px, py]: Cell): boolean {
  const [ax, ay, bx, by] = s;
  return (
    !orient(ax, ay, bx, by, px, py) &&
    Math.min(ax, bx) <= px &&
    px <= Math.max(ax, bx) &&
    Math.min(ay, by) <= py &&
    py <= Math.max(ay, by) &&
    !(px === ax && py === ay) &&
    !(px === bx && py === by)
  );
}

// Directions, counterclockwise from east, y down: E NE N NW W SW S SE.
const D: readonly Cell[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];
const vec = (d: number): Cell => D[((d % 8) + 8) % 8] ?? [1, 0];
const isDiag = (d: number) => d % 2 === 1;
const opp = (d: number) => (d + 4) % 8;
const dirOf = (dx: number, dy: number) =>
  D.findIndex(([a, b]) => a === Math.sign(dx) && b === Math.sign(dy));
/** The mirror image across the line of direction d. */
const MIRROR: readonly ((c: Cell) => Cell)[] = [
  ([x, y]) => [x, -y],
  ([x, y]) => [-y, -x],
  ([x, y]) => [-x, y],
  ([x, y]) => [y, x],
];
const mirror = (d: number) => MIRROR[d % 4] ?? (([x, y]: Cell): Cell => [x, -y]);

function get<K, V>(m: ReadonlyMap<K, V>, k: K): V {
  const v = m.get(k);
  if (v === undefined) throw new Error(`map-layout: missing ${String(k)}`);
  return v;
}

/** The bounding box of some cells, as its area in cells. */
function area(cells: Iterable<Cell>): number {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const [x, y] of cells) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return (x1 - x0 + 1) * (y1 - y0 + 1);
}

// ---- the layout ---------------------------------------------------------------------------

export function layoutMap(places: readonly MapPlace[], options: MapOptions): MapLayout {
  // in name order throughout, so that the map depends on the places and not on their order
  const names = [...new Set(places.map((p) => p.name))].sort();
  const known = new Set(names);
  const adj = new Map(names.map((n) => [n, new Set<string>()]));
  const arcs = new Set<string>();
  for (const p of places)
    for (const x of p.exits)
      if (known.has(x) && x !== p.name) {
        get(adj, p.name).add(x);
        get(adj, x).add(p.name);
        arcs.add(p.name + '\n' + x);
      }
  const roads: MapRoad[] = [];
  const seen = new Set<string>();
  for (const a of names)
    for (const b of get(adj, a)) {
      const k = [a, b].sort().join('\n');
      if (seen.has(k)) continue;
      seen.add(k);
      const ab = arcs.has(a + '\n' + b),
        ba = arcs.has(b + '\n' + a);
      roads.push(
        ab === ba
          ? { a, b, oneWay: false }
          : ab
            ? { a, b, oneWay: true }
            : { a: b, b: a, oneWay: true }
      );
    }

  const root = startPlace(places);
  // the tree of the shortest routes from the root; neighbours in name order, for a stable tree
  const parent = new Map<string, string>();
  const reached = new Set<string>();
  if (root !== undefined) {
    reached.add(root);
    const queue = [root];
    for (let u = queue.shift(); u !== undefined; u = queue.shift())
      for (const v of [...get(adj, u)].sort())
        if (!reached.has(v)) {
          reached.add(v);
          parent.set(v, u);
          queue.push(v);
        }
  }
  const kids = new Map(names.map((n) => [n, [] as string[]]));
  for (const [v, p] of parent) get(kids, p).push(v);
  const size = new Map<string, number>();
  const measure = (n: string): number => {
    const s = 1 + get(kids, n).reduce((t, k) => t + measure(k), 0);
    size.set(n, s);
    return s;
  };
  if (root !== undefined) measure(root);
  for (const ks of kids.values())
    ks.sort((x, y) => get(size, y) - get(size, x) || (x < y ? -1 : 1));
  const isTree = (r: MapRoad) => parent.get(r.a) === r.b || parent.get(r.b) === r.a;
  /** The places n is linked to outside the tree. */
  const linksOf = (n: string) =>
    [...get(adj, n)].filter((w) => parent.get(w) !== n && parent.get(n) !== w);

  const route = (name: string): string[] => {
    if (!reached.has(name)) return [];
    const r = [name];
    for (let p = parent.get(name); p !== undefined; p = parent.get(p)) r.unshift(p);
    return r;
  };

  const at = new Map<string, Cell>();
  if (root !== undefined) {
    for (const [n, c] of drawTree(root)) at.set(n, c);
    if (options.fold) foldChains();
  }
  placeUnreached();
  return { root, cells: at, roads, route };

  // 1 and 2: directions by the rules, lengths by pushing out
  function drawTree(top: string): Map<string, Cell> {
    const MAIN = options.axis === 'h' ? [0, 4] : [6, 2];
    const CROSS = options.axis === 'h' ? [2, 6] : [0, 4];
    const dir = new Map<string, number>();
    const straightRank = (din: number | undefined): number[] => {
      if (din === undefined) return [...MAIN, ...CROSS];
      if (!isDiag(din)) return MAIN.includes(din) ? [din, ...CROSS] : [...MAIN, din];
      const sides = [(din + 7) % 8, (din + 1) % 8];
      const m = sides.find((s) => MAIN.includes(s)) ?? 0;
      const c = sides.find((s) => CROSS.includes(s)) ?? 2;
      return [m, c, ...[0, 2, 4, 6].filter((s) => s !== m && s !== c)].filter(
        (s) => s !== opp(din)
      );
    };
    const assign = (u: string, din: number | undefined): void => {
      const ks = get(kids, u);
      const plan = new Map<string, number>();
      const partnerOf = (v: string) => ks.slice(0, ks.indexOf(v)).find((k) => get(adj, v).has(k));
      const back = din === undefined ? [] : [opp(din)];
      const used = () => new Set([...back, ...plan.values()]);
      const roadCount = ks.length + back.length + linksOf(u).length;
      for (const v of ks) {
        if (partnerOf(v) !== undefined) continue;
        const d = straightRank(din).find((s) => !used().has(s));
        if (d !== undefined) plan.set(v, d);
      }
      for (const v of ks) {
        const p = partnerOf(v);
        const dp = p === undefined ? undefined : plan.get(p);
        if (dp === undefined) continue;
        const near = roadCount > 4 ? [1, -1, 2, -2] : [2, -2, 1, -1];
        const d = near.map((k) => (dp + k + 8) % 8).find((x) => !used().has(x));
        if (d !== undefined) plan.set(v, d);
      }
      const sizeAt = (d: number) => {
        const e = [...plan].find(([, x]) => x === d);
        return e ? get(size, e[0]) : 0;
      };
      const beside = (d: number) => sizeAt((d + 1) % 8) + sizeAt((d + 7) % 8);
      for (const v of ks) {
        if (plan.has(v)) continue;
        const d = [1, 3, 5, 7]
          .filter((x) => !used().has(x))
          .sort((a, b) => beside(a) - beside(b))[0];
        // a place with more than eight roads: the rest share the first free one
        plan.set(v, d ?? [0, 1, 2, 3, 4, 5, 6, 7].find((x) => !back.includes(x)) ?? 0);
      }
      for (const v of ks) {
        dir.set(v, get(plan, v));
        assign(v, get(plan, v));
      }
    };
    assign(top, undefined);

    const segmentsOf = (b: ReadonlyMap<string, Cell>, links: boolean): Segment[] => {
      const out: Segment[] = [];
      for (const [n, c] of b) {
        const p = parent.get(n);
        const pc = p === undefined ? undefined : b.get(p);
        if (pc) out.push([...pc, ...c]);
      }
      if (links)
        for (const r of roads) {
          const ca = b.get(r.a),
            cb = b.get(r.b);
          if (!isTree(r) && ca && cb) out.push([...ca, ...cb]);
        }
      return out;
    };
    const key = (s: Segment) => s.join(',');
    // a block fits where none of its places, roads and (if asked) links touch or cross those of
    // the other
    const fits = (
      base: ReadonlyMap<string, Cell>,
      sub: ReadonlyMap<string, Cell>,
      links: boolean
    ): boolean => {
      const taken = new Set([...base.values()].map((c) => c.join(',')));
      for (const c of sub.values()) if (taken.has(c.join(','))) return false;
      const merged = new Map([...base, ...sub]);
      const old = segmentsOf(base, links),
        oldKeys = new Set(old.map(key));
      const own = new Set(segmentsOf(sub, links).map(key));
      const fresh = segmentsOf(merged, links).filter((s) => !oldKeys.has(key(s)));
      // the roads that join the block, and the links it closes
      const joining = fresh.filter((s) => !own.has(key(s)));
      for (const s of fresh) {
        const others = own.has(key(s))
          ? [...old, ...joining]
          : [...old, ...fresh.filter((t) => t !== s)];
        if (others.some((t) => crosses(t, s))) return false;
        for (const c of merged.values()) if (inside(s, c)) return false;
      }
      for (const s of old) for (const c of sub.values()) if (inside(s, c)) return false;
      return true;
    };
    const extent = (b: ReadonlyMap<string, Cell>) =>
      Math.max(...[...b.values()].map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
    // the line from a place towards a direction, as far as any drawing reaches
    const FAR = 1e6;
    const ray = (d: number): Segment => [0, 0, vec(d)[0] * FAR, vec(d)[1] * FAR];
    // whether a block keeps clear of some lines from the place it joins
    const clearOf = (sub: ReadonlyMap<string, Cell>, lines: readonly Segment[]) => {
      const drawn = segmentsOf(new Map([...sub, ['', [0, 0] as Cell]]), true);
      return lines.every(
        (l) => ![...sub.values()].some((c) => inside(l, c)) && !drawn.some((s) => crosses(s, l))
      );
    };
    // Each branch joins its place in its planned direction, as it is or mirrored, with the
    // shortest road that fits. The lines from the place to its parent and to the branches still
    // to join stay clear, so a branch pushed out far enough always fits: past everything drawn
    // and clear of every other line. Links are kept clear while a road of that length allows.
    const block = (u: string, din: number | undefined): Map<string, Cell> => {
      let b = new Map<string, Cell>([[u, [0, 0]]]);
      const order = [...get(kids, u)].sort(
        (a, c) => Number(isDiag(get(dir, c))) - Number(isDiag(get(dir, a)))
      );
      for (const [i, v] of order.entries()) {
        const d = get(dir, v),
          [dx, dy] = vec(d),
          own = block(v, d);
        const open = [
          ...(din === undefined ? [] : [opp(din)]),
          ...order.slice(i + 1).map((w) => get(dir, w)),
        ]
          .filter((x) => x !== d)
          .map(ray);
        const limit = extent(b) + 2 * extent(own) + 2;
        let best: Map<string, Cell> | undefined;
        search: for (const links of [true, false])
          for (let len = 1; len <= limit; len++) {
            for (const shape of [own, new Map([...own].map(([n, c]) => [n, mirror(d)(c)]))]) {
              const moved = new Map(
                [...shape].map(([n, [x, y]]) => [n, [x + dx * len, y + dy * len] as Cell])
              );
              if (!fits(b, moved, links) || !clearOf(moved, open)) continue;
              const merged = new Map([...b, ...moved]);
              if (!best || area(merged.values()) < area(best.values())) best = merged;
            }
            if (best) break search;
          }
        b =
          best ??
          new Map([
            ...b,
            ...[...own].map(
              ([n, [x, y]]) => [n, [x + dx * limit, y + dy * limit] as Cell] as const
            ),
          ]);
      }
      return b;
    };
    return block(top, undefined);
  }

  // every segment drawn: the roads to the places drawn
  function drawnSegments(): Segment[] {
    const out: Segment[] = [];
    for (const r of roads) {
      const ca = at.get(r.a),
        cb = at.get(r.b);
      if (ca && cb) out.push([...ca, ...cb]);
    }
    return out;
  }
  function occupied(c: Cell): boolean {
    return [...at.values()].some(([x, y]) => x === c[0] && y === c[1]);
  }

  // 3: a straight chain ending in a dead end turns a right angle at the place before it, where
  // the map gets smaller for it; the smallest map first, until no turn helps
  function foldChains(): void {
    const chainFrom = (k: string): string[] | undefined => {
      const out = [k];
      for (let n = k; ;) {
        const ks = get(kids, n);
        if (linksOf(n).length || ks.length > 1) return undefined;
        if (!ks[0]) return out;
        n = ks[0];
        out.push(n);
      }
    };
    const dirTo = (n: string) => {
      const [x, y] = get(at, n),
        [px, py] = get(at, get(parent, n));
      return dirOf(x - px, y - py);
    };
    for (let a0 = area(at.values()); ; a0 = area(at.values())) {
      let best: { area: number; cells: [string, Cell][] } | undefined;
      for (const c of names) {
        if (c === root || !at.has(c)) continue;
        const [cx, cy] = get(at, c);
        for (const k of get(kids, c)) {
          const tail = chainFrom(k);
          if (!tail || dirTo(k) !== dirTo(c)) continue; // only a straight run turns
          const saved = tail.map((n) => [n, get(at, n)] as [string, Cell]);
          for (const turn of [1, -1]) {
            for (const n of tail) at.delete(n);
            let ok = true;
            for (const [n, [x0, y0]] of saved) {
              const dx = x0 - cx,
                dy = y0 - cy;
              const cell: Cell = turn === 1 ? [cx + dy, cy - dx] : [cx - dy, cy + dx];
              const p = get(at, get(parent, n));
              const road: Segment = [...p, ...cell];
              const drawn = drawnSegments();
              if (
                occupied(cell) ||
                drawn.some((s) => inside(s, cell) || crosses(s, road)) ||
                [...at.values()].some((q) => inside(road, q))
              ) {
                ok = false;
                break;
              }
              at.set(n, cell);
            }
            const a1 = ok ? area(at.values()) : Infinity;
            if (a1 < a0 && (!best || a1 < best.area))
              best = { area: a1, cells: tail.map((n) => [n, get(at, n)]) };
            for (const n of tail) at.delete(n);
            for (const [n, cell] of saved) at.set(n, cell);
          }
        }
      }
      if (!best) return;
      for (const [n, cell] of best.cells) at.set(n, cell);
    }
  }

  // the places the root does not reach: on a free cell along the edge of the map, one with free
  // neighbours if any, the bottom right first; past the bottom edge when none is left
  function placeUnreached(): void {
    for (const n of names) {
      if (at.has(n)) continue;
      if (!at.size) {
        at.set(n, [0, 0]);
        continue;
      }
      const cells = [...at.values()];
      const xs = cells.map((c) => c[0]),
        ys = cells.map((c) => c[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const drawn = drawnSegments();
      const free = (c: Cell) => !occupied(c) && !drawn.some((s) => inside(s, c));
      const edge: Cell[] = [];
      for (let y = y1; y >= y0; y--)
        for (let x = x1; x >= x0; x--)
          if ((x === x0 || x === x1 || y === y0 || y === y1) && free([x, y])) edge.push([x, y]);
      const roomy = edge.find(([x, y]) => D.every(([dx, dy]) => free([x + dx, y + dy])));
      at.set(n, roomy ?? edge[0] ?? [x1, y1 + 1]);
    }
  }
}

// ---- labels -------------------------------------------------------------------------------

/** A point of the drawing, in pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A label: its lines, its box, and how its lines are anchored at `textX`. */
export interface Label {
  readonly lines: readonly string[];
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly textX: number;
}

export interface LabelOptions {
  /** The width of a text in pixels, as drawn. */
  readonly measure: (text: string) => number;
  /** The widest a line may be; longer texts wrap at spaces. */
  readonly maxWidth: number;
  readonly lineHeight: number;
  /** The radius of the mark of a place, which a label keeps clear of. */
  readonly radius: number;
}

/** Splits a text into lines no wider than `maxWidth`, at spaces; a single word may be wider. */
export function wrapText(text: string, measure: (t: string) => number, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(' ')) {
    const t = cur ? cur + ' ' + w : w;
    if (cur && measure(t) > maxWidth) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Puts each place's label below, above, right or left of it, wherever it covers the fewest
 * other labels, places and roads, below first. The places with most roads choose first.
 */
export function placeLabels(
  points: ReadonlyMap<string, Point>,
  texts: ReadonlyMap<string, string>,
  segments: readonly Segment[],
  o: LabelOptions
): Map<string, Label> {
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  // Liang–Barsky: whether a segment passes through a box
  const hits = ([sx0, sy0, sx1, sy1]: Segment, r: Box) => {
    let t0 = 0,
      t1 = 1;
    const dx = sx1 - sx0,
      dy = sy1 - sy0;
    for (const [p, q] of [
      [-dx, sx0 - r.x0],
      [dx, r.x1 - sx0],
      [-dy, sy0 - r.y0],
      [dy, r.y1 - sy0],
    ] as const) {
      if (p === 0) {
        if (q < 0) return false;
        continue;
      }
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
    return t1 - t0 > 1e-6;
  };
  const R = o.radius;
  const marks = [...points].map(([n, p]) => ({
    n,
    x0: p.x - R,
    x1: p.x + R,
    y0: p.y - R,
    y1: p.y + R,
  }));
  const roadsAt = new Map<string, number>();
  for (const [x0, y0, x1, y1] of segments)
    for (const [x, y] of [
      [x0, y0],
      [x1, y1],
    ] as const)
      for (const [n, p] of points)
        if (p.x === x && p.y === y) roadsAt.set(n, (roadsAt.get(n) ?? 0) + 1);
  const order = [...points.keys()].sort((a, b) => (roadsAt.get(b) ?? 0) - (roadsAt.get(a) ?? 0));
  const placed: Box[] = [];
  const out = new Map<string, Label>();
  for (const n of order) {
    const { x, y } = get(points, n);
    const lines = wrapText(texts.get(n) ?? n, o.measure, o.maxWidth);
    const w = Math.max(...lines.map(o.measure)),
      h = lines.length * o.lineHeight;
    const sides: [number, number, Label['anchor'], number][] = [
      [x - w / 2, y + R + 3, 'middle', x],
      [x - w / 2, y - R - 3 - h, 'middle', x],
      [x + R + 5, y - h / 2, 'start', x + R + 5],
      [x - R - 5 - w, y - h / 2, 'end', x - R - 5],
    ];
    let best: { score: number; label: Label } | undefined;
    for (const [i, [bx, by, anchor, textX]] of sides.entries()) {
      const box = { x0: bx, y0: by, x1: bx + w, y1: by + h };
      const score =
        placed.filter((p) => overlaps(p, box)).length * 100 +
        marks.filter((m) => m.n !== n && overlaps(m, box)).length * 60 +
        segments.filter((s) => hits(s, box)).length * 30 +
        i * 2;
      if (!best || score < best.score) best = { score, label: { lines, ...box, anchor, textX } };
    }
    if (!best) continue;
    placed.push(best.label);
    out.set(n, best.label);
  }
  return out;
}
