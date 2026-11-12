/**
 * The level of each place: the lowest level of the game at which a player can reach it,
 * deduced from what the wiki knows (phase 5, toJson). The game grows a level at a time,
 * each with its items and places, so a place needs at least the level of the items it
 * requires (to enter it or to see it among the destinations) and of the places on the
 * way to it from the village; and an item is at least of its `Ln` rarity, and of the
 * easiest way to obtain it: found anywhere (no level), in the one place it drops in, or
 * by a recipe (its level and its ingredients'). Items and places depend on each other,
 * so both are computed in turn until nothing changes.
 *
 * Pure logic only (no Node APIs).
 */
import { compareCodePoints } from '@inventorybot-wiki/grammar/lib/text.ts';
import { type WikiItem, type WikiLocation, type WikiRecipe } from './types.ts';

/** A place's level, and what sets it: an item it requires, or the place it is reached through. */
export interface PlaceLevel {
  level: number;
  via: string;
}

/** The level an `Ln` rarity states, or 0. */
const rarityLevel = (rarity: string | null): number => {
  const m = /^L(\d+)$/u.exec(rarity ?? '');
  return m ? Number(m[1]) : 0;
};

/**
 * The level of each place above 0 (the village and the places reached without a levelled
 * item are of none). Roads go both ways, as on the map; a place no road from `village`
 * reaches is of the level of its own items.
 */
export function placeLevels(
  items: Readonly<Record<string, WikiItem>>,
  recipes: Readonly<Record<string, WikiRecipe>>,
  locations: Readonly<Record<string, WikiLocation>>,
  renames: Readonly<Record<string, string>>,
  village: string | undefined
): Map<string, PlaceLevel> {
  const current = (n: string): string => (items[n] ? n : (renames[n] ?? n));
  const names = Object.keys(locations).sort(compareCodePoints);
  const adj = new Map(names.map((n) => [n, new Set<string>()]));
  for (const l of Object.values(locations))
    for (const x of l.exits)
      if (x !== l.name && adj.has(x)) {
        adj.get(l.name)?.add(x);
        adj.get(x)?.add(l.name);
      }
  const itemLevel = new Map<string, number>();
  const levelOf = (n: string): number => itemLevel.get(current(n)) ?? 0;
  let places = new Map<string, PlaceLevel>();
  const placeLevel = (n: string): number => places.get(n)?.level ?? 0;

  /** The highest level among the items a place requires, and the first item of it. */
  const own = (n: string): PlaceLevel => {
    const l = locations[n];
    let best: PlaceLevel = { level: 0, via: '' };
    for (const i of [...(l?.required_items ?? []), ...(l?.sight_items ?? [])].sort(
      compareCodePoints
    ))
      if (levelOf(i) > best.level) best = { level: levelOf(i), via: current(i) };
    return best;
  };

  /** The places' levels from the items': the way from the village whose highest level is lowest. */
  const fromItems = (): Map<string, PlaceLevel> => {
    const out = new Map<string, PlaceLevel>();
    const done = new Set<string>();
    if (village !== undefined && adj.has(village)) out.set(village, own(village));
    for (;;) {
      let u: string | undefined;
      for (const n of names) {
        const c = out.get(n);
        const b = u === undefined ? undefined : out.get(u);
        if (c !== undefined && !done.has(n) && (b === undefined || c.level < b.level)) u = n;
      }
      if (u === undefined) break;
      done.add(u);
      const cu = out.get(u) ?? { level: 0, via: '' };
      for (const v of [...(adj.get(u) ?? [])].sort(compareCodePoints)) {
        if (done.has(v)) continue;
        const o = own(v);
        const c = o.level >= cu.level ? o : { level: cu.level, via: u };
        const b = out.get(v);
        if (b === undefined || c.level < b.level) out.set(v, c);
      }
    }
    for (const n of names) if (!out.has(n)) out.set(n, own(n));
    for (const [n, p] of out) if (p.level === 0) out.delete(n);
    return out;
  };

  /** An item's level from the places' and the other items': its easiest source. */
  const itemFrom = (i: WikiItem): number => {
    const ways: number[] = [];
    if (i.exclusive) for (const p of i.locations) ways.push(placeLevel(p));
    else if (i.sources.includes('adventure')) ways.push(0);
    for (const r of i.made_by) {
      const rec = recipes[r];
      if (!rec) continue;
      const parts = rec.ingredients ? Object.keys(rec.ingredients) : rec.partial_ingredients;
      ways.push(Math.max(rec.level ?? 0, ...parts.map(levelOf)));
    }
    return Math.max(rarityLevel(i.rarity), ways.length ? Math.min(...ways) : 0);
  };

  // Every level only grows from one round to the next, up to the highest one, so this ends.
  for (let changed = true; changed;) {
    changed = false;
    places = fromItems();
    for (const i of Object.values(items)) {
      const k = itemFrom(i);
      if (k !== (itemLevel.get(i.name) ?? 0)) {
        itemLevel.set(i.name, k);
        changed = true;
      }
    }
  }
  return places;
}
