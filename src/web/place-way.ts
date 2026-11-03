/**
 * The way into a place, for the wiki view's trees: the places on it that keep a player out
 * (those that need an item the player lacks). Pure, tested in Node.
 */
import { type MapPlace, startPlace } from './map-layout.ts';

/** What reaching a place costs: the locked places passed, then the places passed. */
interface Cost {
  locks: number;
  hops: number;
  prev: string | undefined;
}

const cheaper = (a: Cost, b: Cost): boolean =>
  a.locks < b.locks || (a.locks === b.locks && a.hops < b.hops);

/**
 * The places for which `locked` holds on the way to `target` from the start (the village,
 * `startPlace`), the start and `target` included, in order from the start: along the way
 * that passes the fewest of them, then the fewest places, then the first by name. Roads go
 * both ways, as on the map. Without a known way, `target` alone, if it is locked.
 */
export function lockedWay(
  places: readonly MapPlace[],
  locked: (name: string) => boolean,
  target: string
): string[] {
  const adj = new Map(places.map((p) => [p.name, new Set<string>()]));
  for (const p of places)
    for (const x of p.exits)
      if (x !== p.name && adj.has(x)) {
        adj.get(p.name)?.add(x);
        adj.get(x)?.add(p.name);
      }
  const start = startPlace(places);
  const best = new Map<string, Cost>();
  if (start !== undefined)
    best.set(start, { locks: locked(start) ? 1 : 0, hops: 0, prev: undefined });
  // Dijkstra's, the places being few: the cheapest place not yet done, the first by name.
  const done = new Set<string>();
  for (;;) {
    let u: [string, Cost] | undefined;
    for (const [n, c] of best)
      if (!done.has(n) && (u === undefined || cheaper(c, u[1]) || (!cheaper(u[1], c) && n < u[0])))
        u = [n, c];
    if (u === undefined || u[0] === target) break;
    const [name, cu] = u;
    done.add(name);
    for (const v of [...(adj.get(name) ?? [])].sort()) {
      const c = { locks: cu.locks + (locked(v) ? 1 : 0), hops: cu.hops + 1, prev: name };
      const b = best.get(v);
      if (!done.has(v) && (b === undefined || cheaper(c, b))) best.set(v, c);
    }
  }
  if (!best.has(target)) return locked(target) ? [target] : [];
  const way: string[] = [];
  for (let n: string | undefined = target; n !== undefined; n = best.get(n)?.prev) way.unshift(n);
  return way.filter(locked);
}
