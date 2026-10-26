/** player.ts: the export owner's personal state (phase 5). */
import { describe, expect, it } from 'vitest';
import { ev, type EvOptions, runBuild } from '#test/build.ts';
import * as T from '#test/texts.ts';
import { iso } from './build.ts';
import { placeName } from './places.ts';
import { Holdings, renamed, sameTransfer } from './player.ts';
import { type BuildEvent, type PlayerState } from './types.ts';

const BOSCO = 'nel bosco nebbioso di Valtorbo 🌲';
const PIANURA = 'nella valle ventosa 🏞';

function g(
  text: string,
  query: string | null = null,
  t = 0,
  who = 'luigi',
  o: EvOptions = {}
): BuildEvent {
  return ev(text, query, { t, dm: false, chat: 'Gruppo', player: who, match: 'user', ...o });
}

function invOf(
  events: BuildEvent[],
  player: string | null = null
): [Record<string, number>, PlayerState] {
  const { state } = runBuild(events, player);
  return [Object.fromEntries(Object.entries(state.inventory).map(([n, v]) => [n, v.qty])), state];
}

const info = (name: string, n: number, t: number, rarity = 'C'): BuildEvent =>
  ev(T.info(name, rarity, { count: n }), `/esamina ${name}`, { t });

describe('common player', () => {
  it('typical_player_json', () => {
    const events = [
      ev(T.where(BOSCO, [PIANURA]), '/viaggio', { t: 0 }),
      ev(
        T.inventory([
          ['un sasso', 'C', 2],
          ['una trave', 'N', 1],
        ]),
        '/inventario',
        { t: 10 }
      ),
      ev(T.drop('nel bosco trovi un sasso', 'C'), '/avventura', { t: 20 }),
      ev(
        T.recipeList([
          ['Torre', 1, 0],
          ['Muro', 2, 3],
        ]),
        '/ricetta',
        { t: 30 }
      ),
      ev(
        T.craft(
          [
            ['un sasso', 'C', 2],
            ['una trave', 'N', 1],
          ],
          'una torre'
        ),
        '/ricetta torre',
        { t: 40 }
      ),
      ev(T.craft([['un sasso', 'C', 1]], 'una torre'), '/ricetta torre', { t: 50 }),
    ];
    const { state } = runBuild(events);
    const last = events[events.length - 1] as BuildEvent;
    expect(state.player).toBe('djjeck');
    expect(state.as_of).toBe(iso(last.date ?? null));
    expect(state.recipes).toStrictEqual({ Torre: { crafted: 2, last_crafted: last.date } });
    expect(Object.keys(state.items).sort()).toStrictEqual(['un sasso', 'una torre', 'una trave']);
    expect(state.items['un sasso']).toStrictEqual({ first_seen: events[1]?.date });
    expect(state.locations[placeName(BOSCO)]).toStrictEqual({ visited: true, adventures: 1 });
    expect(state.locations[placeName(PIANURA)]).toStrictEqual({ visited: false, adventures: 0 });
    expect(state.recipe_list?.recipes).toStrictEqual({ Torre: 'pronta', Muro: 'manca 3' });
    expect(
      Object.fromEntries(Object.entries(state.inventory).map(([n, v]) => [n, v.qty]))
    ).toStrictEqual({ 'una torre': 2 });
  });
});

describe('check of the estimate', () => {
  it('ricetta_lists_compared_with_the_estimate_of_their_moment', () => {
    const list = (missing: number, t: number): BuildEvent =>
      ev(
        T.recipeList([
          ['Muro', 2, missing],
          ['Torre', 1, 0], // ingredients unknown: not compared
        ]),
        '/ricetta',
        { t }
      );
    const { state } = runBuild([
      ev(T.detail('Muro', [['un sasso', 'C', 2]], [['una trave', 'N', 1]]), '/ricetta muro', {
        t: 0,
      }),
      list(2, 1), // agrees: two stones missing
      ev(T.drop('nel bosco trovi un sasso', 'C'), '/avventura', { t: 2 }),
      list(1, 3), // agrees: one found since
      list(2, 4), // disagrees: a stone went somewhere the exports do not show
      g(T.recipeList([['Muro', 2, 0]], 'luigi'), '/ricetta', 5), // another player's
    ]);
    expect(state.inventory_check).toStrictEqual({ compared: 3, agreed: 2 });
  });

  it('nothing_compared_without_lists', () => {
    expect(runBuild([info('un sasso', 2, 0)]).state.inventory_check).toStrictEqual({
      compared: 0,
      agreed: 0,
    });
  });
});

describe('full inventory', () => {
  it('unlisted_items_go_to_zero', () => {
    const [inv, state] = invOf([
      info('un sasso', 2, 0),
      info('un paio di mollette', 1, 1),
      ev(T.inventory([["una moneta d'oro", 'X', 5]]), '/inventario', { t: 2 }),
    ]);
    expect(inv).toStrictEqual({ "una moneta d'oro": 5 });
    expect(state.inventory["una moneta d'oro"]).toStrictEqual({
      qty: 5,
      exact: true,
      date: iso('27.11.2025 19:00:02 UTC-05:00'),
      via: 'inventario',
    });
  });

  it('later_movements_apply_on_top', () => {
    const [inv] = invOf([
      ev(T.inventory([['un sasso', 'C', 1]]), '/inventario', { t: 0 }),
      ev(T.drop('nel bosco trovi un sasso', 'C'), '/avventura', { t: 1 }),
    ]);
    expect(inv).toStrictEqual({ 'un sasso': 2 });
  });

  it('unmatched_group_inventory_does_not_zero_unlisted', () => {
    const reply = ev(T.inventory([['un sasso', 'C', 1]]), null, {
      t: 10,
      dm: false,
      chat: 'Gruppo',
      match: null,
    });
    expect(reply.player).toBe('djjeck');
    const [inv] = invOf([info('una trave', 4, 0), reply]);
    expect(inv).toStrictEqual({ 'un sasso': 1, 'una trave': 4 });
  });
});

describe('collezioni and inv2', () => {
  const base = (): BuildEvent[] => [info('un sasso', 2, 0), info('un paio di mollette', 1, 1)];
  const after = (text: string, query: string): Record<string, number> =>
    invOf([...base(), ev(text, query, { t: 2 })])[0];

  it('a_complete_list_zeroes_unlisted', () => {
    expect(after(T.inventoryByQuantity([['un sasso', 'C', 3]]), '/collezioni')).toStrictEqual({
      'un sasso': 3,
    });
    expect(after(T.inventoryPage([['un sasso', 'C', 3]], 1, 1), '/inv2')).toStrictEqual({
      'un sasso': 3,
    });
  });

  it('a_cut_list_a_page_of_several_or_an_argument_zero_nothing', () => {
    const kept = { 'un sasso': 3, 'un paio di mollette': 1 };
    const listed: T.ItemSpec[] = [['un sasso', 'C', 3]];
    expect(after(T.inventoryByQuantity(listed, 'djjeck', true), '/collezioni')).toStrictEqual(kept);
    expect(after(T.inventoryPage(listed, 2, 2), '/inv2')).toStrictEqual(kept);
    expect(after(T.inventoryByQuantity(listed), '/collezioni C')).toStrictEqual(kept);
  });
});

describe('the /esporta file', () => {
  const CAPTION = 'Inventario di @djjeck, al 2025/11/28 00:00:02';
  const base = (): BuildEvent[] => [info('un sasso', 2, 0), info('un paio di mollette', 1, 1)];
  const file = T.inventoryFile([['un sasso', 'C', 3]]);

  it('every_item_is_exact_and_unlisted_ones_go_to_zero', () => {
    const [inv, state] = invOf([...base(), ev(CAPTION, '/esporta', { t: 2, file })]);
    expect(inv).toStrictEqual({ 'un sasso': 3 });
    expect(state.inventory['un sasso']).toMatchObject({ exact: true, via: 'esporta' });
  });

  it('even_an_unmatched_group_copy_lists_everything', () => {
    const copy = ev(CAPTION, null, { t: 2, file, dm: false, chat: 'Gruppo', match: null });
    expect(invOf([...base(), copy])[0]).toStrictEqual({ 'un sasso': 3 });
  });

  it('without_its_file_it_changes_nothing', () => {
    expect(invOf([...base(), ev(CAPTION, '/esporta', { t: 2 })])[0]).toStrictEqual({
      'un sasso': 2,
      'un paio di mollette': 1,
    });
  });
});

describe('filtered inventory', () => {
  const base = (): BuildEvent[] => [
    info("una moneta d'Oro", 3, 0, 'X'),
    info('un tesoro', 2, 1),
    info('un sasso', 4, 2),
    info('un oro falso', 1, 3),
  ];

  it('filter_zeroes_matching_unlisted_case_insensitively', () => {
    const [inv] = invOf([
      ...base(),
      ev(T.inventory([['un tesoro', 'C', 2]]), '/inventario oro', { t: 10 }),
    ]);
    expect(inv).toStrictEqual({ 'un tesoro': 2, 'un sasso': 4 });
  });

  it('every_word_must_appear', () => {
    const [inv] = invOf([
      ...base(),
      ev(T.inventory([['un tesoro', 'C', 2]]), '/inventario moneta oro', { t: 10 }),
    ]);
    expect(inv).toStrictEqual({ 'un tesoro': 2, 'un sasso': 4, 'un oro falso': 1 });
  });

  it('argument_contained_in_no_name_zeroes_nothing', () => {
    const [inv] = invOf([
      ...base(),
      ev(T.inventory([['un sasso', 'C', 4]]), '/inventario [C]', { t: 10 }),
    ]);
    expect(inv).toStrictEqual({
      "una moneta d'Oro": 3,
      'un tesoro': 2,
      'un sasso': 4,
      'un oro falso': 1,
    });
  });
});

/**
 * Rarity filters, as verified on the bot: "/inventario C" lists C and C+ items,
 * "C+" only C+, "L" every Ln; "M" is accepted but always lists nothing; "[C]" is text.
 */
describe('rarity letter arguments', () => {
  const base = (): BuildEvent[] => [
    info('una mela', 2, 0, 'C'),
    info('un fiore', 1, 1, 'C+'),
    info('una cosa', 3, 2, 'N'),
    info('un drago', 1, 3, 'M'),
    info('uno scudo', 1, 4, 'L1'),
    info('un sasso', 4, 5, 'C'),
  ];
  const all: Record<string, number> = {
    'una mela': 2,
    'un fiore': 1,
    'una cosa': 3,
    'un drago': 1,
    'uno scudo': 1,
    'un sasso': 4,
  };
  const without = (k: string): Record<string, number> =>
    Object.fromEntries(Object.entries(all).filter(([n]) => n !== k));
  const after = (query: string, listed: T.ItemSpec[], truncated = false): Record<string, number> =>
    invOf([...base(), ev(T.inventory(listed, 'djjeck', truncated), query, { t: 10 })])[0];

  it('rarity_letter_zeroes_unlisted_of_that_rarity_and_its_plus', () => {
    expect(after('/inventario C', [['un sasso', 'C', 4]])).toStrictEqual({
      'una cosa': 3,
      'un drago': 1,
      'uno scudo': 1,
      'un sasso': 4,
    });
  });

  it('the_short_form_i_filters_like_inventario', () => {
    expect(after('/i C', [['un sasso', 'C', 4]])).toStrictEqual(
      after('/inventario C', [['un sasso', 'C', 4]])
    );
    expect(after('/i', [['un sasso', 'C', 4]])).toStrictEqual({ 'un sasso': 4 });
  });

  it('rarity_plus_zeroes_only_plus', () => {
    expect(after('/inventario C+', [])).toStrictEqual(without('un fiore'));
  });

  it('rarity_L_covers_every_level', () => {
    expect(after('/inventario L', [])).toStrictEqual(without('uno scudo'));
  });

  it('rarity_level_zeroes_only_that_level', () => {
    const events = [
      ...base(),
      info('una L1 rara', 1, 6, 'L2'),
      ev(T.inventory([]), '/inventario L1', { t: 10 }),
    ]; // an L2 item whose name contains "l1"
    expect(invOf(events)[0]).toStrictEqual({ ...without('uno scudo'), 'una L1 rara': 1 });
  });

  it('rarity_letter_M_zeroes_nothing', () => {
    // The bot's M filter always lists nothing, whatever the player owns.
    expect(after('/inventario M', [])).toStrictEqual(all);
  });

  it('rarity_letter_does_not_zero_by_name', () => {
    // "una cosa" contains "c" but is N: a rarity filter is not a text search.
    expect(
      after('/inventario C', [
        ['una mela', 'C', 2],
        ['un fiore', 'C+', 1],
        ['un sasso', 'C', 4],
      ])
    ).toStrictEqual(all);
  });

  it('truncated_rarity_filter_zeroes_nothing', () => {
    expect(after('/inventario C', [['un sasso', 'C', 4]], true)).toStrictEqual(all);
  });

  it('bracketed_rarity_zeroes_nothing', () => {
    expect(after('/inventario [C]', [])).toStrictEqual(all);
  });
});

describe('truncated', () => {
  it('truncated_exact_for_listed_only', () => {
    const [inv, state] = invOf([
      info('un sasso', 4, 0),
      info('un paio di mollette', 1, 1),
      ev(
        T.inventory(
          [
            ["una moneta d'oro", 'X', 2],
            ['un sasso', 'C', 3],
          ],
          'djjeck',
          true
        ),
        '/inventario',
        { t: 2 }
      ),
    ]);
    expect(inv).toStrictEqual({ 'un sasso': 3, 'un paio di mollette': 1, "una moneta d'oro": 2 });
    expect(state.inventory['un paio di mollette']?.via).toBe('esamina');
  });

  it('truncated_filtered', () => {
    const [inv] = invOf([
      info('un sasso', 4, 0),
      info('un sassetto', 1, 1),
      ev(T.inventory([['un sasso', 'C', 3]], 'djjeck', true), '/inventario sass', { t: 2 }),
    ]);
    expect(inv).toStrictEqual({ 'un sasso': 3, 'un sassetto': 1 });
  });
});

const pick = (h: object | undefined, keys: string[]): Record<string, unknown> =>
  Object.fromEntries(keys.map((k) => [k, (h as Record<string, unknown> | undefined)?.[k]]));

describe('observations', () => {
  it('ne_hai_exact', () => {
    const [, state] = invOf([info('un sasso', 4, 0)]);
    expect(pick(state.inventory['un sasso'], ['qty', 'exact', 'via'])).toStrictEqual({
      qty: 4,
      exact: true,
      via: 'esamina',
    });
  });

  it('non_ne_hai_zero', () => {
    expect(invOf([info('un sasso', 4, 0), info('un sasso', 0, 1)])[0]).toStrictEqual({});
  });

  it('ti_manca_gives_n_minus_k', () => {
    const [, state] = invOf([
      ev(
        T.detail(
          'Torre',
          [['un sasso', 'C', 1]],
          [
            ['un sasso', 'C', 2],
            ['una trave', 'N', 1],
          ]
        ),
        '/ricetta torre',
        { t: 0 }
      ),
    ]);
    expect(pick(state.inventory['un sasso'], ['qty', 'exact'])).toStrictEqual({
      qty: 2,
      exact: true,
    });
    expect(pick(state.inventory['una trave'], ['qty', 'exact'])).toStrictEqual({
      qty: 1,
      exact: false,
    });
  });

  it('ti_manca_all_means_zero', () => {
    const [inv] = invOf([
      info('un laccio', 3, 0),
      ev(
        T.detail('Gabbia', [['un laccio', 'C', 1]], [['un paio di mollette', 'N', 1]]),
        '/ricetta gabbia',
        { t: 1 }
      ),
    ]);
    expect(inv).toStrictEqual({ 'un paio di mollette': 1 });
  });

  it('ready_recipe_and_show_are_lower_bounds', () => {
    const [, state] = invOf([
      ev(T.detail('Torre', [], [['un sasso', 'C', 2]]), '/ricetta torre', { t: 0 }),
      info('un sasso', 0, 1),
      ev(T.recipeList([['Torre', 1, 0]]), '/ricetta', { t: 2 }),
      ev(T.show(3, 'un cappello piumato', 'N'), '/mostra cappello', { t: 3 }),
    ]);
    expect(
      Object.fromEntries(
        Object.entries(state.inventory).map(([n, v]) => [n, [v.qty, v.exact, v.via]])
      )
    ).toStrictEqual({
      'un sasso': [2, false, 'ricetta'],
      'un cappello piumato': [3, false, 'mostra'],
    });
  });

  it('higher_known_value_kept', () => {
    const [, state] = invOf([
      info('un cappello piumato', 5, 0, 'N'),
      ev(T.show(3, 'un cappello piumato', 'N'), '/mostra cappello', { t: 1 }),
      ev(T.detail('Abito', [], [['un cappello piumato', 'N', 1]]), '/ricetta abito', { t: 2 }),
    ]);
    expect(pick(state.inventory['un cappello piumato'], ['qty', 'exact', 'via'])).toStrictEqual({
      qty: 5,
      exact: true,
      via: 'esamina',
    });
  });
});

describe('craft', () => {
  it('craft_subtracts_ingredients_adds_output', () => {
    const [, state] = invOf([
      info('un laccio', 3, 0),
      ev(T.craft([['un laccio', 'C', 1]], 'una cestina'), '/ricetta cestina', { t: 1 }),
    ]);
    expect(pick(state.inventory['un laccio'], ['qty', 'exact'])).toStrictEqual({
      qty: 2,
      exact: true,
    });
    expect(pick(state.inventory['una cestina'], ['qty', 'via'])).toStrictEqual({
      qty: 1,
      via: 'movimento',
    });
  });

  it('unknown_ingredient_at_least_then_used', () => {
    const [inv] = invOf([
      ev(T.craft([['un laccio', 'C', 2]], 'una cestina'), '/ricetta cestina', { t: 1 }),
      ev(T.craft([['un laccio', 'C', 2]], 'una cestina'), '/ricetta cestina', { t: 2 }),
    ]);
    expect(inv).toStrictEqual({ 'una cestina': 2 });
  });

  it('below_zero_becomes_not_exact', () => {
    const h = new Holdings();
    h.exact('un sasso', 1, 'd', 'esamina');
    h.delta('un sasso', -2, 'd2');
    expect(pick(h.h.get('un sasso'), ['qty', 'exact'])).toStrictEqual({ qty: 0, exact: false });
    h.delta('una trave', 3, 'd3');
    expect(h.h.get('una trave')).toStrictEqual({
      qty: 3,
      exact: false,
      date: 'd3',
      via: 'movimento',
    });
    h.delta('un chiodo', -1, 'd4');
    expect(h.h.get('un chiodo')?.qty).toBe(0);
  });

  it('craft_with_exact_zero_ingredient', () => {
    const [, state] = invOf([
      info('un laccio', 0, 0),
      ev(T.craft([['un laccio', 'C', 1]], 'una cestina'), '/ricetta cestina', { t: 1 }),
    ]);
    expect(state.inventory).not.toHaveProperty(['un laccio']); // raised to at least 1, then used: 0, not exact
  });
});

describe('movements', () => {
  it('additions_and_removals', () => {
    const [inv] = invOf([
      ev(
        T.inventory([
          ['un sasso', 'C', 1],
          ['un baule', 'C', 1, true],
        ]),
        '/inventario',
        { t: 0 }
      ),
      info('un bottone', 5, 1),
      ev(T.drop('nel bosco trovi un sasso', 'C'), '/avventura', { t: 2 }),
      ev(T.gift(2, 'un sasso', 'luigi'), null, { t: 3 }),
      ev("@djjeck, apri il baule e trovi:\n- una moneta d'oro [X] x3", '/usa baule', { t: 4 }),
      g(T.give(1, 'un bottone', 'luigi', 'djjeck'), '/dai', 5, 'djjeck'),
      g(T.give(4, 'un sasso', 'djjeck', 'anna'), '/dai', 6, 'anna'),
    ]);
    expect(inv).toStrictEqual({
      'un sasso': 1 + 1 + 2 + 4,
      'un baule': 1,
      "una moneta d'oro": 3,
      'un bottone': 4,
    });
  });
});

describe('same transfer', () => {
  const transfer = (delay: number): BuildEvent[] => [
    info('un bottone', 1, 0),
    g(T.give(2, 'un bottone', 'djjeck', 'luigi'), '/dai', 10, 'luigi'),
    ev(T.gift(2, 'un bottone', 'luigi'), null, { t: 10 + delay }),
  ];

  it('group_give_and_dm_notice_count_once', () => {
    expect(invOf(transfer(30))[0]).toStrictEqual({ 'un bottone': 3 });
  });

  it('far_apart_counted_twice', () => {
    expect(invOf(transfer(121))[0]).toStrictEqual({ 'un bottone': 5 });
  });

  it('group_give_to_owner_without_dm_notice_counts_once', () => {
    const [inv] = invOf([
      info('un bottone', 1, 0),
      g(T.give(2, 'un bottone', 'djjeck', 'luigi'), '/dai', 10, 'luigi'),
    ]);
    expect(inv).toStrictEqual({ 'un bottone': 3 });
  });

  it('dm_notice_121s_later_counted_twice_known_limit', () => {
    // Known limit, not fixed: sameTransfer() pairs a group /dai with its DM notice
    // only within 120 s, so a notice that arrives later counts the transfer twice
    // (1 + 2 + 2 instead of 1 + 2). This test documents the current behaviour.
    for (const delay of [121, 600])
      expect(invOf(transfer(delay))[0], String(delay)).toStrictEqual({ 'un bottone': 5 });
  });

  it('same_transfer_fields', () => {
    const give = { player: 'luigi', item: 'un bottone', qty: 2, date: '2025-11-27T19:00:00-05:00' };
    const gift = { from: 'luigi', item: 'un bottone', qty: 2, date: '2025-11-28T00:02:00+00:00' };
    expect(sameTransfer(give, gift)).toBe(true); // 120 s, different offsets
    expect(sameTransfer(give, { ...gift, qty: 1 })).toBe(false);
    expect(sameTransfer(give, { ...gift, item: 'un sasso' })).toBe(false);
    expect(sameTransfer(give, { ...gift, from: 'anna' })).toBe(false);
    expect(sameTransfer(give, { ...gift, date: null })).toBe(false);
  });
});

describe('renamed', () => {
  it('renamed_item_counted_under_new_name', () => {
    const [, state] = invOf([
      info("un Gufetto d'Argento", 2, 0, 'R'),
      ev(
        T.detail(
          'Premiazione',
          [],
          [
            ['un sasso', 'C', 1],
            ["un Gufetto d'Argento", 'R', 1],
          ]
        ),
        '/ricetta p',
        { t: 10 }
      ),
      ev(
        T.detail(
          'Premiazione',
          [],
          [
            ['un sasso', 'C', 1],
            ['un Premio Sgranocchio', 'R', 1],
          ]
        ),
        '/ricetta p',
        { t: 1000 }
      ),
      ev(T.drop('nel bosco trovi un Premio Sgranocchio', 'R'), '/avventura', { t: 1100 }),
    ]);
    expect(state.inventory).not.toHaveProperty(["un Gufetto d'Argento"]);
    expect(state.inventory['un Premio Sgranocchio']?.qty).toBe(3);
    expect(state.items).not.toHaveProperty(["un Gufetto d'Argento"]);
  });

  it('renamed_helper', () => {
    // Item fields only: the query and the text keep the old name.
    const r = new Map([['x', 'z']]);
    const craft = ev(T.craft([['x', 'C', 1]], 'x'), '/ricetta x', { t: 0 });
    const c = renamed(craft, r) as Extract<BuildEvent, { type: 'craft' }>;
    expect([c.ingredients.map((i) => i.name), c.output, c.query]).toStrictEqual([
      ['z'],
      'z',
      '/ricetta x',
    ]);
    expect(Object.keys(c)).toStrictEqual(Object.keys(craft));
  });
});

/** A successful /usa removes one item only when the wiki verified that it is consumed. */
describe('consumed on use', () => {
  const pozione = (n: number, t: number): BuildEvent =>
    ev(T.info('una pozione', 'C', { count: n, usable: true }), '/esamina pozione', { t });
  const use = (t: number, text = '@djjeck, bevi la pozione e ti senti meglio'): BuildEvent =>
    ev(text, '/usa pozione', { t });

  it('consumed_item_decreases_on_use', () => {
    // 3 -> use -> 2 proves consumption; the next use, with no count after it, lowers the estimate.
    expect(invOf([pozione(3, 0), use(1), pozione(2, 2), use(3)])[0]).toStrictEqual({
      'una pozione': 1,
    });
  });

  it('not_consumed_item_unchanged', () => {
    expect(invOf([pozione(3, 0), use(1), pozione(3, 2), use(3)])[0]).toStrictEqual({
      'una pozione': 3,
    });
  });

  it('unverified_item_unchanged', () => {
    expect(invOf([pozione(3, 0), use(1)])[0]).toStrictEqual({ 'una pozione': 3 });
  });

  it('successful_uses_counted_per_item', () => {
    const events = [
      pozione(3, 0),
      use(1),
      use(2, '@djjeck, non hai la chiave giusta per aprire questo baule..'),
      use(3),
    ];
    const { state } = runBuild(events);
    expect(state.items['una pozione']).toStrictEqual({
      first_seen: events[0]?.date,
      used: 2,
      last_used: events[3]?.date,
    });
  });

  it('failed_use_does_not_consume', () => {
    const [inv] = invOf([
      pozione(3, 0),
      use(1),
      pozione(2, 2),
      use(3, '@djjeck, non hai la chiave giusta per aprire questo baule..'),
    ]);
    expect(inv).toStrictEqual({ 'una pozione': 2 });
  });
});

describe('only owner', () => {
  it('other_players_events_ignored', () => {
    const [inv, state] = invOf([
      info('un sasso', 2, 0),
      g(T.inventory([['una trave', 'N', 9]], 'luigi'), '/inventario', 1),
      g(T.drop('nel bosco trovi un sasso', 'C', 'luigi'), '/avventura', 2),
      g(T.craft([['un sasso', 'C', 1]], 'un muro', 'luigi'), '/ricetta muro', 3),
      ev(T.drop('nel bosco trovi un sasso', 'C'), '/avventura', { t: 4, forwarded: true }),
      ev(T.gift(1, 'un sasso', 'anna'), null, {
        t: 5,
        dm: false,
        chat: 'Gruppo',
        broadcast: true,
        match: null,
      }),
    ]);
    expect(inv).toStrictEqual({ 'un sasso': 2 });
    expect(state.recipes).toStrictEqual({});
  });

  it('explicit_player_flag', () => {
    const [inv, state] = invOf(
      [info('un sasso', 2, 0), g(T.inventory([['una trave', 'N', 9]], 'luigi'), '/inventario', 1)],
      'luigi'
    );
    expect([inv, state.player]).toStrictEqual([{ 'una trave': 9 }, 'luigi']);
  });
});

describe('dai refusal count', () => {
  const refusal = (q: string, n: number, t: number): BuildEvent =>
    ev(`non ne hai abbastanza, ne possiedi solo ${n}.`, q, { t });

  it('not_enough_gives_the_exact_count', () => {
    const [inv, state] = invOf([
      info('un sasso', 5, 0),
      info('una mela', 2, 1),
      refusal('/dai @lucia_b 10 sasso', 3, 2),
    ]);
    expect([
      inv['un sasso'],
      state.inventory['un sasso']?.exact,
      state.inventory['un sasso']?.via,
    ]).toStrictEqual([3, true, 'dai']);
  });

  it('ambiguous_or_unknown_item_changes_nothing', () => {
    const [inv] = invOf([
      info('un sasso', 5, 0),
      info('un sasso rosso', 4, 1),
      refusal('/dai lucia_b 10 sasso', 3, 2),
      refusal('/dai lucia_b 3 pera', 1, 3),
    ]);
    expect([inv['un sasso'], inv['un sasso rosso'], inv['una pera']]).toStrictEqual([
      5,
      4,
      undefined,
    ]);
  });

  it('another_players_refusal_is_not_the_owners', () => {
    const [inv] = invOf(
      [
        info('un sasso', 5, 0),
        g('non ne hai abbastanza, ne possiedi solo 1.', '/dai @anna 3 sasso', 1),
      ],
      'djjeck'
    );
    expect(inv['un sasso']).toBe(5);
  });
});
