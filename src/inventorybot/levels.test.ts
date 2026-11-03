/** The levels of the places (levels.ts). Invented items and places only. */
import { describe, expect, it } from 'vitest';
import { placeLevels } from './levels.ts';
import { type WikiItem, type WikiLocation, type WikiRecipe } from './types.ts';

const V = 'il villaggio di Borgoverde 🏡';
const BOSCO = 'il bosco nebbioso di Valtorbo 🌲';
const VALLE = 'la valle ventosa 🏞';
const PALUDE = 'la palude sussurrante 🌾';
const CRIPTE = 'le cripte del monastero 👻';
const MONTE = 'i piedi del monte Grevolo ⛰';

function item(name: string, rarity: string | null, more: Partial<WikiItem> = {}): WikiItem {
  return {
    name,
    rarity,
    usable: false,
    sources: ['adventure'],
    used_in: [],
    made_by: [],
    last_seen: null,
    observations: 1,
    exclusive: false,
    locations: [],
    ...more,
  };
}

function recipe(
  name: string,
  level: number | null,
  ingredients: Record<string, number>
): WikiRecipe {
  return {
    name,
    level,
    ingredients,
    ingredients_source: 'detail',
    partial_ingredients: [],
    output: null,
    craft_text: null,
    last_seen: null,
    observations: 1,
  };
}

function place(name: string, exits: string[], more: Partial<WikiLocation> = {}): WikiLocation {
  return {
    name,
    label: name,
    at: null,
    last_seen: null,
    observations: 1,
    exits,
    requires_item: false,
    unlock_texts: [],
    required_items: [],
    exclusive_items: [],
    sight_items: [],
    ...more,
  };
}

const record = <T extends { name: string }>(xs: T[]): Record<string, T> =>
  Object.fromEntries(xs.map((x) => [x.name, x]));

/** The levels, as `place -> [level, via]`. */
function levels(
  items: WikiItem[],
  places: WikiLocation[],
  recipes: WikiRecipe[] = [],
  renames: Record<string, string> = {}
): Record<string, [number, string]> {
  const out = placeLevels(record(items), record(recipes), record(places), renames, V);
  return Object.fromEntries([...out].map(([n, l]) => [n, [l.level, l.via]]));
}

const needs = (items: string[]): Partial<WikiLocation> => ({
  requires_item: true,
  required_items: items,
});

describe('placeLevels', () => {
  it('gives a place the level of the item it requires, and the places behind it', () => {
    const out = levels(
      [item('una torre', 'L2', { sources: ['recipe'] })],
      [
        place(V, [BOSCO]),
        place(BOSCO, [PALUDE]),
        place(PALUDE, [CRIPTE], needs(['una torre'])),
        place(CRIPTE, []),
      ]
    );
    expect(out).toEqual({ [PALUDE]: [2, 'una torre'], [CRIPTE]: [2, PALUDE] });
  });

  it('takes the way of the lowest level, and counts the items to see a place', () => {
    const out = levels(
      [
        item('una torre', 'L2', { sources: ['recipe'] }),
        item('una torre alta', 'L4', { sources: ['recipe'] }),
      ],
      [
        place(V, [BOSCO, VALLE]),
        place(BOSCO, [CRIPTE], { sight_items: ['una torre alta'] }),
        place(VALLE, [CRIPTE], needs(['una torre'])),
        place(CRIPTE, []),
      ]
    );
    expect(out).toEqual({
      [BOSCO]: [4, 'una torre alta'],
      [VALLE]: [2, 'una torre'],
      [CRIPTE]: [2, VALLE],
    });
  });

  it('gives no level to an item found anywhere', () => {
    const out = levels(
      [item('una lanterna cieca', 'N')],
      [place(V, [CRIPTE]), place(CRIPTE, [], needs(['una lanterna cieca']))]
    );
    expect(out).toEqual({});
  });

  it('gives an item found in one place the level of that place', () => {
    const out = levels(
      [
        item('una torre', 'L3', { sources: ['recipe'] }),
        item('un rampino di ferro', 'R+', { exclusive: true, locations: [PALUDE] }),
      ],
      [
        place(V, [PALUDE, MONTE]),
        place(PALUDE, [], needs(['una torre'])),
        place(MONTE, [], needs(['un rampino di ferro'])),
      ]
    );
    expect(out).toEqual({ [PALUDE]: [3, 'una torre'], [MONTE]: [3, 'un rampino di ferro'] });
  });

  it("gives a crafted item its recipe's level and its ingredients'", () => {
    const out = levels(
      [
        item('una torre', 'L1', { sources: ['recipe'] }),
        item('una trave', null, { sources: ['recipe'], made_by: ['Torre alta di pietra'] }),
        item('un sasso', 'C+', { exclusive: true, locations: [PALUDE] }),
        item('una torre alta', null, { sources: [], made_by: ['Torre alta'] }),
      ],
      [
        place(V, [PALUDE, VALLE, MONTE]),
        place(PALUDE, [], needs(['una torre'])),
        place(VALLE, [], needs(['una trave'])),
        place(MONTE, [], needs(['una torre alta'])),
      ],
      [
        recipe('Torre alta di pietra', 2, { 'un seme': 1 }),
        recipe('Torre alta', 1, { 'un sasso': 2 }),
      ]
    );
    expect(out).toEqual({
      [PALUDE]: [1, 'una torre'],
      [VALLE]: [2, 'una trave'],
      [MONTE]: [1, 'una torre alta'],
    });
  });

  it('gives a place no road reaches the level of its own items, by their current names', () => {
    const out = levels(
      [item('una torre', 'L2', { sources: ['recipe'] })],
      [place(V, [BOSCO]), place(BOSCO, []), place(CRIPTE, [], needs(['una torre altissima']))],
      [],
      { 'una torre altissima': 'una torre' }
    );
    expect(out).toEqual({ [CRIPTE]: [2, 'una torre'] });
  });
});
