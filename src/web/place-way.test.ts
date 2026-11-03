/** The way into a place (place-way.ts). Invented places only. */
import { describe, expect, it } from 'vitest';
import { type MapPlace } from './map-layout.ts';
import { lockedWay } from './place-way.ts';

const V = 'il villaggio di Borgoverde 🏡';
const BOSCO = 'il bosco nebbioso di Valtorbo 🌲';
const VALLE = 'la valle ventosa 🏞';
const PALUDE = 'la palude sussurrante 🌾';
const CRIPTE = 'le cripte del monastero 👻';
const MONTE = 'i piedi del monte Grevolo ⛰';

/** Places joined by roads, given as pairs (one exit is enough: roads go both ways). */
function world(pairs: readonly [string, string][]): MapPlace[] {
  const exits = new Map<string, string[]>();
  for (const [a, b] of pairs) {
    exits.set(a, [...(exits.get(a) ?? []), b]);
    if (!exits.has(b)) exits.set(b, []);
  }
  return [...exits].map(([name, ex]) => ({ name, exits: ex }));
}

const lockedIn =
  (...names: string[]) =>
  (n: string) =>
    names.includes(n);

describe('lockedWay', () => {
  it('is empty when nothing on the way is locked', () => {
    const places = world([
      [V, BOSCO],
      [BOSCO, VALLE],
    ]);
    expect(lockedWay(places, lockedIn(PALUDE), VALLE)).toEqual([]);
  });

  it('lists the locked places on the way, the target included, from the village', () => {
    const places = world([
      [V, BOSCO],
      [BOSCO, PALUDE],
      [PALUDE, CRIPTE],
    ]);
    expect(lockedWay(places, lockedIn(CRIPTE, PALUDE), CRIPTE)).toEqual([PALUDE, CRIPTE]);
  });

  it('goes around a locked place when a longer way passes none', () => {
    const places = world([
      [V, PALUDE],
      [PALUDE, CRIPTE],
      [V, BOSCO],
      [BOSCO, VALLE],
      [VALLE, CRIPTE],
    ]);
    expect(lockedWay(places, lockedIn(PALUDE), CRIPTE)).toEqual([]);
  });

  it('takes the shortest of the ways that pass as few, then the first by name', () => {
    const places = world([
      [V, PALUDE],
      [PALUDE, CRIPTE],
      [V, BOSCO],
      [BOSCO, VALLE],
      [VALLE, MONTE],
      [MONTE, CRIPTE],
    ]);
    expect(lockedWay(places, lockedIn(PALUDE, MONTE), CRIPTE)).toEqual([PALUDE]);
    const fork = world([
      [V, PALUDE],
      [V, MONTE],
      [PALUDE, CRIPTE],
      [MONTE, CRIPTE],
    ]);
    expect(lockedWay(fork, lockedIn(PALUDE, MONTE), CRIPTE)).toEqual([MONTE]);
  });

  it('follows a road listed only by the place it leads to', () => {
    const places = world([
      [V, BOSCO],
      [PALUDE, BOSCO],
    ]);
    expect(lockedWay(places, lockedIn(PALUDE), PALUDE)).toEqual([PALUDE]);
  });

  it('is the target alone, if locked, without a known way', () => {
    const places = world([
      [V, BOSCO],
      [PALUDE, CRIPTE],
    ]);
    expect(lockedWay(places, lockedIn(PALUDE, CRIPTE), CRIPTE)).toEqual([CRIPTE]);
    expect(lockedWay(places, lockedIn(PALUDE), CRIPTE)).toEqual([]);
    expect(lockedWay([], lockedIn(CRIPTE), CRIPTE)).toEqual([CRIPTE]);
  });
});
