/** The map of the places (map-layout.ts). Invented places only. */
import { describe, expect, it } from 'vitest';
import {
  type Axis,
  type Cell,
  crosses,
  layoutMap,
  type MapLayout,
  type MapPlace,
  placeLabels,
  type Point,
  type Segment,
  startPlace,
  wrapText,
} from './map-layout.ts';

/** Places joined by two-way roads, given as pairs; `oneWay` pairs lead from the first only. */
function world(pairs: readonly [string, string][], oneWay: readonly [string, string][] = []) {
  const exits = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    exits.set(a, [...(exits.get(a) ?? []), b]);
    if (!exits.has(b)) exits.set(b, []);
  };
  for (const [a, b] of pairs) {
    add(a, b);
    add(b, a);
  }
  for (const [a, b] of oneWay) add(a, b);
  return [...exits].map(([name, ex]): MapPlace => ({ name, exits: ex }));
}

const cellOf = (m: MapLayout, n: string): Cell => {
  const c = m.cells.get(n);
  if (!c) throw new Error(`no cell for ${n}`);
  return c;
};
const segments = (m: MapLayout): Segment[] =>
  m.roads.map((r) => [...cellOf(m, r.a), ...cellOf(m, r.b)]);
const isDiagonal = ([x0, y0, x1, y1]: Segment) => x0 !== x1 && y0 !== y1;
const crossings = (m: MapLayout) => {
  const s = segments(m);
  let n = 0;
  for (let i = 0; i < s.length; i++)
    for (let j = i + 1; j < s.length; j++) if (crosses(s[i]!, s[j]!)) n++;
  return n;
};
const box = (m: MapLayout) => {
  const cs = [...m.cells.values()];
  const xs = cs.map((c) => c[0]),
    ys = cs.map((c) => c[1]);
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
    area: (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1),
  };
};

const isTreeRoad = (m: MapLayout, a: string, b: string) =>
  m.route(b).at(-2) === a || m.route(a).at(-2) === b;

/**
 * Every rule of the drawing that holds for any map shaped like the game's. With `roadsOnly`, the
 * links outside the tree are left out: one that no road length keeps clear may cross.
 */
function expectWellDrawn(m: MapLayout, roadsOnly = false) {
  const cells = [...m.cells.values()].map((c) => c.join());
  expect(new Set(cells).size).toBe(cells.length); // one place a cell
  const shown = roadsOnly ? { ...m, roads: m.roads.filter((r) => isTreeRoad(m, r.a, r.b)) } : m;
  expect(crossings(shown)).toBe(0);
  for (const s of segments(shown)) {
    // no road passes over a place
    for (const [x, y] of m.cells.values()) {
      const onLine = (s[2] - s[0]) * (y - s[1]) === (s[3] - s[1]) * (x - s[0]);
      const within =
        Math.min(s[0], s[2]) <= x &&
        x <= Math.max(s[0], s[2]) &&
        Math.min(s[1], s[3]) <= y &&
        y <= Math.max(s[1], s[3]);
      const end = (x === s[0] && y === s[1]) || (x === s[2] && y === s[3]);
      expect(onLine && within && !end).toBe(false);
    }
  }
  // the roads of the tree go along the four directions, or at 45°
  for (const r of m.roads) {
    if (!isTreeRoad(m, r.a, r.b)) continue;
    const [x0, y0, x1, y1] = [...cellOf(m, r.a), ...cellOf(m, r.b)];
    expect(x0 === x1 || y0 === y1 || Math.abs(x1 - x0) === Math.abs(y1 - y0)).toBe(true);
  }
}

describe('startPlace', () => {
  it('is_the_village_whatever_its_roads', () => {
    const places = world([
      ['la valle ventosa 🏞', 'il villaggio di Borgoverde 🏡'],
      ['la valle ventosa 🏞', 'la palude sussurrante 🌾'],
      ['la valle ventosa 🏞', 'la baia di Scogliola 🦀'],
    ]);
    expect(startPlace(places)).toBe('il villaggio di Borgoverde 🏡');
  });

  it('without_a_village_is_the_place_with_most_roads', () => {
    expect(
      startPlace(
        world([
          ['b', 'a'],
          ['b', 'c'],
          ['d', 'e'],
        ])
      )
    ).toBe('b');
    expect(startPlace([])).toBeUndefined();
  });
});

describe('layoutMap', () => {
  // the village with six branches of 18, 6, 4, 3, 2 and 1 places, as in a full map
  const branch = (top: string, n: number): [string, string][] =>
    Array.from({ length: n - 1 }, (_, i) => [i ? `${top}${i}` : top, `${top}${i + 1}`]);
  const hub = world([
    ...['A', 'B', 'C', 'D', 'E', 'F'].map((b): [string, string] => ['il villaggio', b]),
    ...branch('A', 18),
    ...branch('B', 6),
    ...branch('C', 4),
    ...branch('D', 3),
    ...branch('E', 2),
  ]);

  it('starts_from_the_village_at_the_origin', () => {
    const m = layoutMap(hub, { axis: 'h' });
    expect(m.root).toBe('il villaggio');
    expect(cellOf(m, 'il villaggio')).toEqual([0, 0]);
    expect(m.route('A2')).toEqual(['il villaggio', 'A', 'A1', 'A2']);
    expect(m.route('il villaggio')).toEqual(['il villaggio']);
  });

  it.each(['h', 'v'] as Axis[])('draws_a_full_map_cleanly_along_%s', (axis) => {
    const m = layoutMap(hub, { axis, fold: true });
    expectWellDrawn(m);
    // six roads at the village: two diagonals, the two smallest branches
    const diagonals = segments(m).filter(isDiagonal);
    expect(diagonals).toHaveLength(2);
    for (const n of ['E', 'F']) expect(isDiagonal([0, 0, ...cellOf(m, n)])).toBe(true);
  });

  it('sends_the_biggest_branch_along_the_main_axis', () => {
    const [ax, ay] = cellOf(layoutMap(hub, { axis: 'h' }), 'A');
    expect(ay).toBe(0);
    expect(ax).toBeGreaterThan(0); // east
    const [vx, vy] = cellOf(layoutMap(hub, { axis: 'v' }), 'A');
    expect(vx).toBe(0);
    expect(vy).toBeGreaterThan(0); // south
  });

  it('pushes_a_straight_branch_out_past_the_diagonals', () => {
    // the two diagonals go beside B, the second branch, west; B forks three ways, so it moves
    // out of their way
    const places = world([
      ...['A', 'B', 'C', 'D', 'E', 'F'].map((b): [string, string] => ['il villaggio', b]),
      ...branch('A', 8),
      ['B', 'B1'],
      ['B', 'B2'],
      ['B', 'B3'],
      ...branch('C', 3),
      ...branch('D', 2),
    ]);
    const m = layoutMap(places, { axis: 'h' });
    expectWellDrawn(m);
    for (const n of ['E', 'F']) expect(cellOf(m, n)[0]).toBe(-1);
    expect(cellOf(m, 'B')).toEqual([-2, 0]);
  });

  it('puts_linked_siblings_side_by_side', () => {
    const places = world([
      ['il villaggio', 'A'],
      ['il villaggio', 'B'],
      ['il villaggio', 'C'],
      ['il villaggio', 'D'],
      ['il villaggio', 'E'],
      ['A', 'A1'],
      ['A1', 'A2'],
      ['A', 'E'],
    ]);
    const m = layoutMap(places, { axis: 'h' });
    expectWellDrawn(m);
    const [ax, ay] = cellOf(m, 'A'),
      [ex, ey] = cellOf(m, 'E');
    expect(Math.max(Math.abs(ax - ex), Math.abs(ay - ey))).toBe(1);
  });

  it('keeps_one_way_roads_from_their_start', () => {
    const m = layoutMap(world([['il villaggio', 'A']], [['A', 'B']]), { axis: 'h' });
    expect(m.roads).toContainEqual({ a: 'A', b: 'B', oneWay: true });
    expect(m.roads).toContainEqual({ a: 'A', b: 'il villaggio', oneWay: false });
  });

  it('folds_a_long_chain_to_make_the_map_smaller', () => {
    const places = world([
      ['il villaggio', 'A'],
      ['il villaggio', 'B'],
      ['B', 'B1'],
      ['B', 'B2'],
      ...branch('A', 9),
    ]);
    const straight = layoutMap(places, { axis: 'h' });
    const folded = layoutMap(places, { axis: 'h', fold: true });
    expectWellDrawn(folded);
    expect(box(folded).area).toBeLessThan(box(straight).area);
    expect(segments(folded).filter(isDiagonal)).toHaveLength(0);
  });

  it('turns_a_chain_at_a_place_with_other_exits', () => {
    // A9 has two exits: the chain after it turns there, the other exit stays
    const places = world([
      ['il villaggio', 'A'],
      ['il villaggio', 'B'],
      ['B', 'B1'],
      ['B1', 'B2'],
      ['B', 'B3'],
      ['B3', 'B4'],
      ...branch('A', 6),
      ['A5', 'X'],
      ['A5', 'Y1'],
      ['Y1', 'Y2'],
      ['Y2', 'Y3'],
    ]);
    const m = layoutMap(places, { axis: 'h', fold: true });
    expectWellDrawn(m);
    const [x5, y5] = cellOf(m, 'A5'),
      [xy, yy] = cellOf(m, 'Y1');
    expect(xy === x5 || yy === y5).toBe(true);
    expect(box(m).area).toBeLessThan(box(layoutMap(places, { axis: 'h' })).area);
  });

  it('puts_unconnected_places_on_a_free_cell_of_the_edge', () => {
    // a map of two rows, east, west and north of the village, with free cells in its corners
    const places = [
      ...world([
        ['il villaggio', 'A'],
        ['A', 'A1'],
        ['il villaggio', 'C'],
        ['il villaggio', 'D'],
      ]),
      { name: 'Z', exits: [] },
    ];
    const m = layoutMap(places, { axis: 'h' });
    const tree = layoutMap(places.slice(0, -1), { axis: 'h' });
    const z = cellOf(m, 'Z'),
      b = box(tree);
    expect(m.route('Z')).toEqual([]);
    expect(z[0] >= b.x0 && z[0] <= b.x1 && z[1] >= b.y0 && z[1] <= b.y1).toBe(true);
    expect(z[0] === b.x0 || z[0] === b.x1 || z[1] === b.y0 || z[1] === b.y1).toBe(true);
    expect(box(m).area).toBe(b.area);
  });

  it('puts_unconnected_places_below_when_the_edge_is_full', () => {
    const m = layoutMap(
      [{ name: 'il villaggio', exits: [] }, ...['Z1', 'Z2'].map((name) => ({ name, exits: [] }))],
      { axis: 'h' }
    );
    expect(cellOf(m, 'il villaggio')).toEqual([0, 0]);
    expect(cellOf(m, 'Z1')).toEqual([0, 1]);
    expect(cellOf(m, 'Z2')).toEqual([0, 2]);
    expect(layoutMap([], { axis: 'h' }).cells.size).toBe(0);
  });

  it('depends_on_the_places_not_on_their_order', () => {
    const a = layoutMap(hub, { axis: 'h', fold: true });
    const b = layoutMap([...hub].reverse(), { axis: 'h', fold: true });
    expect([...b.cells].sort()).toEqual([...a.cells].sort());
  });

  // Random maps shaped like the game's: a tree from the village, places of up to seven roads,
  // some linked to a sibling. Every one is drawn cleanly, with the fewest diagonals.
  it('draws_any_map_shaped_like_the_games_cleanly', () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let t = 0; t < 40; t++) {
      const pairs: [string, string][] = [];
      const kids = new Map<string, string[]>([['il villaggio', []]]);
      const total = 8 + rand(40);
      for (let i = 1; i < total; i++) {
        const open = [...kids].filter(([n, ks]) => ks.length < (n === 'il villaggio' ? 7 : 6));
        const [p, ks] = open[rand(open.length)]!;
        const n = `P${i}`;
        ks.push(n);
        kids.set(n, []);
        pairs.push([p, n]);
      }
      // a link between two siblings, now and then
      const links: [string, string][] = [];
      for (const ks of kids.values())
        if (ks.length >= 2 && rand(4) === 0) links.push([ks[0]!, ks[1]!]);
      for (const axis of ['h', 'v'] as Axis[]) {
        const m = layoutMap(world([...pairs, ...links]), { axis, fold: true });
        expectWellDrawn(m, links.length > 0);
        if (links.length) continue;
        // the fewest diagonals: only what a place's roads beyond four need
        let needed = 0;
        for (const [n, ks] of kids)
          needed += Math.max(0, ks.length + (n === 'il villaggio' ? 0 : 1) - 4);
        expect(segments(m).filter(isDiagonal)).toHaveLength(needed);
      }
    }
  });
});

describe('labels', () => {
  const measure = (t: string) => t.length * 6;

  it('wraps_at_spaces_and_keeps_a_long_word_whole', () => {
    expect(wrapText('la cima del monte Grevolo 🏔', measure, 60)).toEqual([
      'la cima',
      'del monte',
      'Grevolo 🏔',
    ]);
    expect(wrapText('Sabbiora', measure, 12)).toEqual(['Sabbiora']);
  });

  it('goes_below_a_place_unless_something_is_there', () => {
    const points = new Map<string, Point>([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 0, y: 30 }],
      ['c', { x: 200, y: 0 }],
    ]);
    const texts = new Map([
      ['a', 'la valle ventosa 🏞'],
      ['b', 'la palude'],
      ['c', 'la baia'],
    ]);
    const roads: Segment[] = [
      [0, 0, 0, 30],
      [0, 0, 200, 0],
    ];
    const labels = placeLabels(points, texts, roads, {
      measure,
      maxWidth: 100,
      lineHeight: 13,
      radius: 9,
    });
    // a has the road to b below it and the road to c on its right
    const a = labels.get('a')!;
    expect(a.y1).toBeLessThanOrEqual(-9);
    expect(a.anchor).toBe('middle');
    expect(labels.get('c')!.y0).toBeGreaterThan(0);
    expect(labels.get('b')!.lines).toEqual(['la palude']);
  });

  it('takes_a_side_when_above_and_below_are_taken', () => {
    const points = new Map<string, Point>([
      ['a', { x: 0, y: 0 }],
      ['up', { x: 0, y: -40 }],
      ['down', { x: 0, y: 40 }],
    ]);
    const roads: Segment[] = [
      [0, -40, 0, 0],
      [0, 0, 0, 40],
    ];
    const labels = placeLabels(points, new Map([['a', 'la baia di Scogliola 🦀']]), roads, {
      measure,
      maxWidth: 200,
      lineHeight: 13,
      radius: 9,
    });
    expect(['start', 'end']).toContain(labels.get('a')!.anchor);
    // a place without a text is labelled with its name
    expect(labels.get('up')!.lines).toEqual(['up']);
  });
});
