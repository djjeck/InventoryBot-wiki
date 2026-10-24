/** build.ts: merging events into the wiki (phase 5). */
import { describe, expect, it } from 'vitest';
import { ownerFromDm } from '#src/telegram/conversation/owner.ts';
import { ev, type EvOptions, fieldsOf, runBuild } from '#test/build.ts';
import { BAULE_CARD, card, CRIPTE_CARD, EVENT_CARD, TORRE_CARD } from '#test/channels.ts';
import { tgDate } from '#test/helpers.ts';
import * as T from '#test/texts.ts';
import { ATLANTE, CITTADELLA, GRIMORIO } from './bot.ts';
import {
  build,
  isMine,
  iso as isoDate,
  recipeMatch,
  reportLines,
  splitRecipes,
  UNNAMED_PREFIX,
  useCandidates,
  useTemplate,
} from './build.ts';
import { classify } from './classify.ts';
import { placeName } from './places.ts';
import { type BuildEvent } from './types.ts';

/** A place's key in the wiki: its article form. */
const P = placeName;
const BOSCO = 'nel bosco nebbioso di Valtorbo 🌲';
const PIANURA = 'nella valle ventosa 🏞';
const MONTE = 'ai piedi del monte Grevolo ⛰';
const FONDALE = 'sul banco corallino 🐠';

const iso = (t: number): string | null => isoDate(tgDate(t));

/** A group event addressed to another player. */
function g(
  text: string,
  query: string | null = null,
  t = 0,
  player = 'luigi',
  o: EvOptions = {}
): BuildEvent {
  return ev(text, query, { t, dm: false, chat: 'Gruppo', player, match: 'user', ...o });
}

const f = fieldsOf;

describe('common build', () => {
  it('typical_dm_session_builds_wiki', () => {
    const events = [
      ev(
        T.recipeList([
          ['Pratica cestina', 2, 1],
          ['Merenda veloce', 1, 0],
        ]),
        '/ricetta',
        { t: 0 }
      ),
      ev(
        T.detail(
          'Pratica cestina',
          [['un nastro da pacchi', 'C', 1]],
          [['un paio di mollette', 'N', 1]],
          'djjeck',
          true
        ),
        '/esamina cestina',
        { t: 10 }
      ),
      ev(
        T.info('un paio di mollette', 'N', {
          count: 2,
          usedIn: 'Pratica cestina',
          source: 'adventure',
        }),
        '/esamina mollette',
        { t: 20 }
      ),
      ev(T.where(BOSCO, [PIANURA]), '/viaggio', { t: 30 }),
      ev(T.drop('nel bosco trovi un nastro da pacchi', 'C'), '/avventura', { t: 40 }),
      ev(
        T.craft(
          [
            ['un nastro da pacchi', 'C', 1],
            ['un paio di mollette', 'N', 1],
          ],
          'una cestina'
        ),
        '/ricetta cestina',
        { t: 50 }
      ),
      ev(T.FAQ, '/faq', { t: 60 }),
    ];
    const { kb, wiki } = runBuild(events);
    expect(kb.player).toBe('djjeck');
    const r = wiki.recipes['Pratica cestina'];
    expect([r?.level, r?.ingredients, r?.output, r?.ingredients_source]).toStrictEqual([
      2,
      { 'un nastro da pacchi': 1, 'un paio di mollette': 1 },
      'una cestina',
      'craft',
    ]);
    expect(r?.craft_text).toBe('e mescoli tutto con cura...');
    expect(wiki.items['una cestina']?.made_by).toStrictEqual(['Pratica cestina']);
    expect(wiki.items['un paio di mollette']?.used_in).toStrictEqual(['Pratica cestina']);
    expect(wiki.items['un nastro da pacchi']?.sources).toStrictEqual(['adventure']);
    expect(wiki.locations[P(BOSCO)]?.exits).toStrictEqual([P(PIANURA)]);
    expect(wiki.locations[P(BOSCO)]?.label).toBe('Il bosco nebbioso di Valtorbo 🌲');
    expect(wiki.rarities['C']).toBe('comune');
    expect(Object.keys(wiki).sort()).toStrictEqual(
      [
        'generated',
        'rarities',
        'rules',
        'trivia',
        'renames',
        'rarity_hypotheses',
        'items',
        'recipes',
        'locations',
      ].sort()
    );
    expect(JSON.parse(JSON.stringify(wiki))).toStrictEqual(wiki); // plain JSON values (no Maps or Sets left)
    expect(events[0]?.date).toBe(iso(0)); // dates converted in place
  });
});

describe('drops', () => {
  it('known_name_closes_the_sentence', () => {
    const events = [
      ev(T.inventory([['un torroncino al pistacchio', 'C', 1]]), '/inventario', { t: 0 }),
      ev(
        T.drop(
          'ti tuffi nel lago, semisommerso nel fondale scorgi un torroncino al pistacchio',
          'C'
        ),
        null,
        { t: 1 }
      ),
    ];
    const { wiki } = runBuild(events);
    expect(f(events[1] as BuildEvent)['resolved']).toBe('un torroncino al pistacchio');
    expect(wiki.items['un torroncino al pistacchio']?.sources).toStrictEqual(['adventure']);
  });

  it('drop_without_exclamation_resolves', () => {
    const events = [
      ev(T.inventory([['un sasso', 'C', 1]]), '/inventario', { t: 0 }),
      ev(T.drop('nel bosco trovi un sasso', 'C', 'djjeck', false, false), null, { t: 1 }),
    ];
    runBuild(events);
    expect(f(events[1] as BuildEvent)['resolved']).toBe('un sasso');
  });

  it('longest_known_name_wins', () => {
    const events = [
      ev(
        T.inventory([
          ['spada', 'C', 1],
          ['una spada', 'C', 1],
        ]),
        '/inventario',
        { t: 0 }
      ),
      ev(T.drop('nella grotta trovi una spada', 'C'), null, { t: 1 }),
    ];
    runBuild(events);
    expect(f(events[1] as BuildEvent)['resolved']).toBe('una spada');
  });

  it('word_boundary', () => {
    const events = [
      ev(T.inventory([['rana', 'C', 1]]), '/inventario', { t: 0 }),
      ev(T.drop('nel fosso vedi una marana', 'C'), null, { t: 1 }),
      ev(T.drop('nello stagno salta rana', 'C'), null, { t: 2 }),
    ];
    const { kb } = runBuild(events);
    expect(f(events[1] as BuildEvent)).not.toHaveProperty('resolved');
    expect(f(events[2] as BuildEvent)['resolved']).toBe('rana');
    expect(kb.report.get('unresolved_drop')).toStrictEqual([
      { kind: 'unresolved_drop', text: 'nel fosso vedi una marana' },
    ]);
  });

  it('unknown_item_via_known_prefix', () => {
    const events = [
      ev(T.drop('nel bosco trovi una ghianda magica', 'R'), null, { t: 0 }), // earlier than the template
      ev(T.inventory([['un sasso', 'C', 1]]), '/inventario', { t: 1 }),
      ev(T.drop('nel bosco trovi un sasso', 'C'), null, { t: 2 }),
    ];
    const { kb, wiki } = runBuild(events);
    expect(f(events[0] as BuildEvent)['resolved']).toBe('una ghianda magica');
    const it_ = wiki.items['una ghianda magica'];
    expect([it_?.rarity, it_?.sources]).toStrictEqual(['R', ['adventure']]);
    expect(kb.report.has('unresolved_drop')).toBe(false);
  });

  it('unknown_item_without_prefix_is_reported', () => {
    const { kb, wiki } = runBuild([
      ev(T.drop('sulla spiaggia raccogli una conchiglia', 'C'), null, { t: 0 }),
    ]);
    expect(kb.report.get('unresolved_drop')).toStrictEqual([
      { kind: 'unresolved_drop', text: 'sulla spiaggia raccogli una conchiglia' },
    ]);
    expect(wiki.items).toStrictEqual({});
  });

  it('lucky_drop_named_directly', () => {
    const events = [
      ev(
        '@djjeck, oggi è la tua avventura FORTUNATA del giorno! Hai vinto: un trifoglio di latta [R]!',
        null,
        { t: 0 }
      ),
    ];
    const { wiki } = runBuild(events);
    expect(f(events[0] as BuildEvent)['resolved']).toBe('un trifoglio di latta');
    expect(wiki.items['un trifoglio di latta']?.sources).toStrictEqual(['adventure']); // inferred from R
    expect(wiki.items['un trifoglio di latta']?.sources_inferred).toBe(true);
  });

  // A drop whose text is exactly a known name records an empty prefix: it must not
  // turn every unknown drop into an item named after its whole narrative.
  it('empty_prefix_is_not_a_template', () => {
    const events = [
      ev(T.inventory([['un sasso', 'C', 1]]), '/inventario', { t: 0 }),
      ev(T.drop('un sasso', 'C'), null, { t: 1 }),
      ev(T.drop('nel fosso vedi una cosa strana', 'C'), null, { t: 2 }),
    ];
    const { kb, wiki } = runBuild(events);
    expect(wiki.items).not.toHaveProperty(['nel fosso vedi una cosa strana']);
    expect(kb.report.get('unresolved_drop')).toStrictEqual([
      { kind: 'unresolved_drop', text: 'nel fosso vedi una cosa strana' },
    ]);
  });
});

describe('split recipes', () => {
  it('plain_split', () => {
    expect(splitRecipes('Muro, Torre', new Set())).toStrictEqual(['Muro', 'Torre']);
    expect(splitRecipes('Giocare a scopa', new Set())).toStrictEqual(['Giocare a scopa']);
  });

  it('known_name_with_comma', () => {
    expect(
      splitRecipes('Muro, Sale, pepe e olio, Torre', new Set(['Sale, pepe e olio']))
    ).toStrictEqual(['Muro', 'Sale, pepe e olio', 'Torre']);
  });

  it('in_build', () => {
    const events = [
      ev(
        T.recipeList([
          ['Sale, pepe e olio', 1, 1],
          ['Muro', 1, 2],
        ]),
        '/ricetta',
        { t: 0 }
      ),
      ev(
        T.info('un sasso', 'C', { count: 1, usedIn: 'Muro, Sale, pepe e olio' }),
        '/esamina sasso',
        { t: 1 }
      ),
    ];
    const { wiki } = runBuild(events);
    expect(wiki.items['un sasso']?.used_in).toStrictEqual(['Muro', 'Sale, pepe e olio']);
    expect(wiki.recipes['Muro']?.partial_ingredients).toStrictEqual(['un sasso']);
    expect(wiki.recipes).not.toHaveProperty(['Sale']);
  });
});

describe('recipe match', () => {
  const NAMES = ['Pizza', 'Pizza della nonna', 'Pratica cestina', 'Perché no', "Moneta d'oro"];

  it('exact_name_preferred', () => {
    expect(recipeMatch('pizza', NAMES)).toStrictEqual(['Pizza']);
  });

  it('every_word_contained', () => {
    expect(recipeMatch('pizza non', NAMES)).toStrictEqual(['Pizza della nonna']);
    expect(recipeMatch('cest', NAMES)).toStrictEqual(['Pratica cestina']);
    expect(recipeMatch('izz', NAMES)).toStrictEqual(['Pizza', 'Pizza della nonna']);
  });

  it('accents_punctuation_case', () => {
    expect(recipeMatch('PERCHE', NAMES)).toStrictEqual(['Perché no']);
    expect(recipeMatch("d'oro", NAMES)).toStrictEqual(["Moneta d'oro"]);
  });

  it('empty_or_no_match', () => {
    expect(recipeMatch('', NAMES)).toStrictEqual([]);
    expect(recipeMatch('torta', NAMES)).toStrictEqual([]);
  });
});

const SASSI: T.ItemSpec[] = [
  ['un sasso', 'C', 2],
  ['una trave', 'N', 1],
];

describe('crafts', () => {
  const nameOf = (events: BuildEvent[]): unknown[] => {
    runBuild(events);
    return events.filter((e) => e.type === 'craft').map((e) => f(e)['recipe']);
  };

  it('by_signature', () => {
    expect(
      nameOf([
        ev(T.detail('Torre', [['un sasso', 'C', 2]], [['una trave', 'N', 1]]), '/ricetta torre', {
          t: 0,
        }),
        ev(T.craft(SASSI, 'una torre'), '/ricetta', { t: 1 }),
      ])
    ).toStrictEqual(['Torre']);
  });

  it('query_and_signature', () => {
    expect(
      nameOf([
        ev(T.detail('Torre', SASSI, []), '/ricetta torre', { t: 0 }),
        ev(T.detail('Torretta', SASSI, []), '/ricetta torretta', { t: 1 }),
        ev(T.craft(SASSI, 'una torretta'), '/ricetta torretta', { t: 2 }),
      ])
    ).toStrictEqual(['Torretta']);
  });

  it('signature_beats_query_alone', () => {
    expect(
      nameOf([
        ev(T.recipeList([['Pizza', 1, 2]]), '/ricetta', { t: 0 }),
        ev(T.detail('Torre', SASSI, []), '/ricetta torre', { t: 1 }),
        ev(T.craft(SASSI, 'una torre'), '/ricetta pizza', { t: 2 }),
      ])
    ).toStrictEqual(['Torre']);
  });

  it('by_output', () => {
    expect(
      nameOf([
        ev(
          T.info('un vortice', 'L1', { count: 0, source: 'Fonduta cosmica' }),
          '/esamina vortice',
          { t: 0 }
        ),
        ev(T.craft([['un biscotto', 'C', 2]], 'un vortice'), null, { t: 1 }),
      ])
    ).toStrictEqual(['Fonduta cosmica']);
  });

  it('query_and_output', () => {
    expect(
      nameOf([
        ev(
          T.info('un vortice', 'L1', { count: 0, source: 'Fonduta cosmica' }),
          '/esamina vortice',
          { t: 0 }
        ),
        ev(T.info('un vortice', 'L1', { count: 0, source: 'Fonduta lunare' }), '/esamina vortice', {
          t: 1,
        }),
        ev(T.craft([['un biscotto', 'C', 2]], 'un vortice'), '/ricetta lunare', { t: 2 }),
      ])
    ).toStrictEqual(['Fonduta lunare']);
  });

  it('by_query_only', () => {
    expect(
      nameOf([
        ev(T.recipeList([['Pratica cestina', 2, 0]]), '/ricetta', { t: 0 }),
        ev(T.craft([['un laccio', 'C', 1]], 'una cestina'), '/ricetta cestina', { t: 1 }),
      ])
    ).toStrictEqual(['Pratica cestina']);
  });

  it('unnamed_recipe_one_entry_per_output', () => {
    const events = [
      ev(T.craft([['un laccio', 'C', 1]], 'una cestina'), null, { t: 0 }),
      ev(T.craft([['un laccio', 'C', 1]], 'una cestina'), null, { t: 1 }),
      ev(T.craft([['un sasso', 'C', 3]], 'un muro'), null, { t: 2 }),
    ];
    const { kb, wiki } = runBuild(events);
    const unnamed = Object.keys(wiki.recipes)
      .filter((n) => n.startsWith(UNNAMED_PREFIX))
      .sort();
    expect(unnamed).toStrictEqual([
      '(ricetta senza nome) → un muro',
      '(ricetta senza nome) → una cestina',
    ]);
    const r = wiki.recipes['(ricetta senza nome) → una cestina'];
    expect([r?.ingredients, r?.output]).toStrictEqual([{ 'un laccio': 1 }, 'una cestina']);
    expect(kb.report.get('unnamed_recipe')).toHaveLength(3);
  });

  it('ambiguous_query_is_unnamed', () => {
    expect(
      nameOf([
        ev(
          T.recipeList([
            ['Pizza', 1, 0],
            ['Pizza della nonna', 1, 0],
          ]),
          '/ricetta',
          { t: 0 }
        ),
        ev(T.craft([['un laccio', 'C', 1]], 'una pizza'), '/ricetta izz', { t: 1 }),
      ])
    ).toStrictEqual(['(ricetta senza nome) → una pizza']);
  });
});

describe('newest observation wins', () => {
  it('newer_rarity_wins_even_if_resolved_later', () => {
    const { kb, wiki } = runBuild([
      ev(T.drop('nel bosco trovi un sasso', 'C'), null, { t: 0 }),
      ev(T.info('un sasso', 'N', { count: 1 }), '/esamina sasso', { t: 10 }),
    ]);
    expect(wiki.items['un sasso']?.rarity).toBe('N');
    expect(kb.report.get('rarity_conflict')).toStrictEqual([
      { kind: 'rarity_conflict', item: 'un sasso', old: 'N', new: 'C', date: iso(0) },
    ]);
  });

  it('newer_rarity_replaces_older', () => {
    const { kb, wiki } = runBuild([
      ev(T.info('un sasso', 'C', { count: 1 }), null, { t: 0 }),
      ev(T.info('un sasso', 'N', { count: 1 }), null, { t: 10 }),
    ]);
    expect(wiki.items['un sasso']?.rarity).toBe('N');
    expect(kb.report.get('rarity_conflict')).toHaveLength(1);
  });

  it('newer_detail_beats_older_craft', () => {
    const { kb, wiki } = runBuild([
      ev(
        T.craft(
          [
            ['un sasso', 'C', 1],
            ['una trave', 'N', 3],
          ],
          'una torre'
        ),
        '/ricetta torre',
        { t: 0 }
      ),
      ev(T.detail('Torre', [['un sasso', 'C', 2]], [['un chiodo', 'C', 1]]), '/ricetta torre', {
        t: 10,
      }),
    ]);
    const r = wiki.recipes['Torre'];
    expect([r?.ingredients, r?.ingredients_source]).toStrictEqual([
      { 'un sasso': 2, 'un chiodo': 1 },
      'detail',
    ]);
    expect(kb.report.get('ingredient_conflict')).toHaveLength(1);
  });

  it('newer_craft_beats_older_detail', () => {
    const { wiki } = runBuild([
      ev(T.detail('Torre', [['un sasso', 'C', 2]], [['un chiodo', 'C', 1]]), '/ricetta torre', {
        t: 0,
      }),
      ev(
        T.craft(
          [
            ['un sasso', 'C', 1],
            ['una trave', 'N', 3],
          ],
          'una torre'
        ),
        '/ricetta torre',
        { t: 10 }
      ),
    ]);
    const r = wiki.recipes['Torre'];
    expect([r?.ingredients, r?.ingredients_source]).toStrictEqual([
      { 'un sasso': 1, 'una trave': 3 },
      'craft',
    ]);
  });

  it('newer_output_wins_with_conflict', () => {
    const { kb, wiki } = runBuild([
      ev(T.recipeList([['Torre', 1, 0]]), '/ricetta', { t: 0 }),
      ev(T.craft([['un sasso', 'C', 1]], 'una torre'), '/ricetta torre', { t: 1 }),
      ev(T.craft([['un sasso', 'C', 1]], 'una torre alta'), '/ricetta torre', { t: 10 }),
    ]);
    expect(wiki.recipes['Torre']?.output).toBe('una torre alta');
    expect(kb.report.get('output_conflict')).toStrictEqual([
      {
        kind: 'output_conflict',
        recipe: 'Torre',
        old: 'una torre',
        new: 'una torre alta',
        date: iso(10),
      },
    ]);
  });

  it('newest_by_instant_across_utc_offsets', () => {
    const early = '28.11.2025 01:00:00 UTC+00:00';
    const late = '27.11.2025 23:00:00 UTC-05:00';
    const { wiki } = runBuild([
      ev(T.info('un sasso', 'C', { count: 1 }), null, { date: early }),
      ev(T.info('un sasso', 'N', { count: 1 }), null, { date: late }),
    ]);
    expect(wiki.items['un sasso']?.rarity).toBe('N');
  });
});

describe('last seen', () => {
  it('last_seen_is_latest_and_no_private_fields', () => {
    const { wiki } = runBuild([
      ev(T.inventory([['un sasso', 'C', 1]]), '/inventario', { t: 0 }),
      ev(T.info('un sasso', 'C', { count: 2 }), null, { t: 100 }),
      ev(T.drop('nel bosco trovi un sasso', 'C'), null, { t: 50 }), // resolved after the merge
      ev(T.recipeList([['Torre', 1, 1]]), '/ricetta', { t: 10 }),
      ev(T.recipeList([['Torre', 1, 0]]), '/ricetta', { t: 30 }),
      ev(T.where(BOSCO, [PIANURA]), '/viaggio', { t: 40 }),
    ]);
    expect(wiki.items['un sasso']?.last_seen).toBe(iso(100));
    expect(wiki.recipes['Torre']?.last_seen).toBe(iso(30));
    for (const section of [wiki.items, wiki.recipes, wiki.locations]) {
      for (const entry of Object.values(section))
        expect(Object.keys(entry).filter((k) => k.startsWith('_'))).toStrictEqual([]);
    }
  });
});

describe('infer', () => {
  it('level_from_output_rarity', () => {
    const { wiki } = runBuild([
      ev(T.info('un vortice', 'L3', { count: 0, source: 'Fonduta cosmica' }), null, { t: 0 }),
      ev(T.craft([['un biscotto', 'C', 2]], 'un vortice'), '/ricetta fonduta', { t: 1 }),
    ]);
    const r = wiki.recipes['Fonduta cosmica'];
    expect([r?.level, r?.level_inferred]).toStrictEqual([3, true]);
  });

  it('known_level_kept', () => {
    const { wiki } = runBuild([
      ev(T.recipeList([['Fonduta cosmica', 2, 0]]), '/ricetta', { t: 0 }),
      ev(T.info('un vortice', 'L3', { count: 0, source: 'Fonduta cosmica' }), null, { t: 1 }),
      ev(T.craft([['un biscotto', 'C', 2]], 'un vortice'), '/ricetta fonduta', { t: 2 }),
    ]);
    const r = wiki.recipes['Fonduta cosmica'];
    expect([r?.level, r !== undefined && 'level_inferred' in r]).toStrictEqual([2, false]);
  });

  it('source_inferred_from_rarity', () => {
    const { wiki } = runBuild([
      ev(
        T.inventory([
          ['un sasso', 'C', 1],
          ['una perla', 'S', 1],
          ['un vortice', 'L2', 1],
          ["una moneta d'oro", 'X', 1],
          ['un drago', 'M', 1],
          ['una ghianda', 'R+', 1],
        ]),
        '/inventario',
        { t: 0 }
      ),
    ]);
    const got = Object.fromEntries(
      Object.entries(wiki.items).map(([n, it]) => [n, [it.sources, it.sources_inferred ?? false]])
    );
    expect(got).toStrictEqual({
      'un sasso': [['adventure'], true],
      'una perla': [['adventure'], true],
      'un vortice': [['recipe'], true],
      "una moneta d'oro": [['special'], true],
      'un drago': [[], false],
      'una ghianda': [['adventure'], true],
    });
  });

  it('known_source_not_inferred', () => {
    const { wiki } = runBuild([
      ev(T.info('un sasso', 'C', { count: 1, source: 'adventure' }), null, { t: 0 }),
    ]);
    expect(wiki.items['un sasso']).not.toHaveProperty('sources_inferred');
  });

  it('source_vs_rarity_reported', () => {
    const { kb } = runBuild([
      ev(T.info('un sasso', 'C', { count: 1, source: 'special' }), null, { t: 0 }),
    ]);
    expect(kb.report.get('source_vs_rarity')).toStrictEqual([
      { kind: 'source_vs_rarity', item: 'un sasso', rarity: 'C', sources: ['special'] },
    ]);
  });
});

describe('exclusive items', () => {
  it('exclusive_located_by_owner_drop', () => {
    const { kb, wiki } = runBuild([
      ev(T.where(BOSCO, [PIANURA]), '/viaggio', { t: 0 }),
      ev(
        T.inventory([
          ["una ghianda d'oro", 'C+', 1],
          ['un sasso', 'C', 1],
        ]),
        '/inventario',
        { t: 1 }
      ),
      ev(T.drop("nel bosco trovi una ghianda d'oro", 'C+'), '/avventura', { t: 2 }),
      ev(T.drop('nel bosco trovi un sasso', 'C'), '/avventura', { t: 3 }),
    ]);
    const gh = wiki.items["una ghianda d'oro"];
    expect([gh?.exclusive, gh?.locations]).toStrictEqual([true, [P(BOSCO)]]);
    expect([wiki.items['un sasso']?.exclusive, wiki.items['un sasso']?.locations]).toStrictEqual([
      false,
      [],
    ]);
    expect(wiki.locations[P(BOSCO)]?.exclusive_items).toStrictEqual(["una ghianda d'oro"]);
    expect(wiki.locations[P(PIANURA)]?.exclusive_items).toStrictEqual([]);
    expect(kb.report.has('exclusive_in_many_places')).toBe(false);
  });

  it('other_players_drops_not_located', () => {
    const { wiki } = runBuild([
      ev(T.where(BOSCO, []), '/viaggio', { t: 0 }),
      ev(T.inventory([["una ghianda d'oro", 'C+', 1]]), '/inventario', { t: 1 }),
      g(T.drop("nel bosco trovi una ghianda d'oro", 'C+', 'luigi'), '/avventura', 2),
    ]);
    expect(wiki.items["una ghianda d'oro"]?.locations).toStrictEqual([]);
  });

  it('exclusive_in_many_places_reported', () => {
    const { kb, wiki } = runBuild([
      ev(T.where(BOSCO, [PIANURA]), '/viaggio', { t: 0 }),
      ev(T.inventory([["una ghianda d'oro", 'C+', 1]]), '/inventario', { t: 1 }),
      ev(T.drop("nel bosco trovi una ghianda d'oro", 'C+'), null, { t: 2 }),
      ev(T.travel(PIANURA, [BOSCO]), '/viaggio valle', { t: 3 }),
      ev(T.drop("nel bosco trovi una ghianda d'oro", 'C+'), null, { t: 4 }),
    ]);
    const both = [P(BOSCO), P(PIANURA)].sort();
    expect(wiki.items["una ghianda d'oro"]?.locations).toStrictEqual(both);
    expect(kb.report.get('exclusive_in_many_places')).toStrictEqual([
      { kind: 'exclusive_in_many_places', item: "una ghianda d'oro", locations: both },
    ]);
  });
});

describe('position', () => {
  it('first_location_applies_before_travel', () => {
    const events = [
      ev(T.drop("trovi una ghianda d'oro", 'C+'), null, { t: 0 }),
      ev(T.where(BOSCO, [PIANURA]), '/viaggio', { t: 10 }),
      ev(T.travel(PIANURA, [BOSCO, MONTE]), '/viaggio valle', { t: 20 }),
      ev(T.drop('trovi un fiore di pianura', 'N+'), null, { t: 30 }),
    ];
    events.unshift(
      ev(
        T.inventory([
          ["una ghianda d'oro", 'C+', 1],
          ['un fiore di pianura', 'N+', 1],
        ]),
        null,
        { t: -5 }
      )
    );
    const { wiki } = runBuild(events);
    expect(f(events[1] as BuildEvent)['location']).toBe(P(BOSCO));
    expect(f(events[4] as BuildEvent)['location']).toBe(P(PIANURA));
    expect(wiki.locations[P(PIANURA)]?.exits).toStrictEqual([P(BOSCO), P(MONTE)].sort());
    expect(wiki.locations).toHaveProperty([P(MONTE)]);
  });

  it('first_location_ignored_if_a_move_came_first', () => {
    const events = [
      ev(T.inventory([["una ghianda d'oro", 'C+', 1]]), null, { t: -5 }),
      ev(T.drop("trovi una ghianda d'oro", 'C+'), null, { t: 0 }),
      ev(T.travel(PIANURA, [BOSCO]), '/viaggio valle', { t: 10 }),
      ev(T.where(PIANURA, [BOSCO]), '/viaggio', { t: 20 }),
    ];
    runBuild(events);
    expect(f(events[1] as BuildEvent)['location']).toBeNull();
  });

  it('travel_links_previous_location', () => {
    const { wiki } = runBuild([
      ev(T.where(BOSCO, []), '/viaggio', { t: 0 }),
      ev(T.travel(MONTE, []), '/viaggio monte', { t: 10 }),
    ]);
    expect(wiki.locations[P(BOSCO)]?.exits).toStrictEqual([P(MONTE)]);
    expect(wiki.locations[P(MONTE)]?.exits).toStrictEqual([]);
  });

  it('blocked_and_unlock', () => {
    const { wiki } = runBuild([
      ev(T.where(PIANURA, [FONDALE]), '/viaggio', { t: 0 }),
      ev(T.blocked(FONDALE), '/viaggio banco', { t: 10 }),
      ev(
        T.travel(FONDALE, [PIANURA], 'djjeck', "inghiotti l'Respirella e ti tuffi..."),
        '/viaggio banco',
        { t: 20 }
      ),
    ]);
    const fd = wiki.locations[P(FONDALE)];
    expect(fd?.requires_item).toBe(true);
    expect(fd?.unlock_texts).toStrictEqual(["inghiotti l'Respirella e ti tuffi..."]);
    expect(wiki.locations[P(PIANURA)]?.requires_item).toBe(false);
    expect(wiki.locations[P(PIANURA)]?.exits).toStrictEqual([P(FONDALE)]);
  });

  it('blocked_while_location_unknown', () => {
    const { wiki } = runBuild([ev(T.blocked(FONDALE), '/viaggio banco', { t: 0 })]);
    expect(wiki.locations).toStrictEqual({
      [P(FONDALE)]: {
        name: P(FONDALE),
        label: 'Il banco corallino 🐠',
        at: FONDALE,
        last_seen: iso(0),
        observations: 1,
        exits: [],
        requires_item: true,
        unlock_texts: [],
        required_items: [],
        exclusive_items: [],
        sight_items: [],
      },
    });
  });

  it('a_place_is_written_as_the_latest_reply_wrote_it', () => {
    const later = '@djjeck non puoi andare: al banco corallino 🐠.. Forse ti manca qualcosa!';
    const at = (events: BuildEvent[]): string | null | undefined =>
      runBuild(events).wiki.locations[P(FONDALE)]?.at;
    expect(at([ev(T.blocked(FONDALE), null, { t: 0 }), ev(later, null, { t: 10 })])).toBe(
      'al banco corallino 🐠'
    );
    // An older reply read after a newer one does not replace it.
    expect(at([ev(later, null, { t: 10 }), ev(T.blocked(FONDALE), null, { t: 0 })])).toBe(
      'al banco corallino 🐠'
    );
  });

  it('a_narrated_arrival_writes_the_place_it_ends_with', () => {
    const PALUDE = 'nella palude sussurrante 🌾';
    const { wiki } = runBuild([
      ev(T.where(BOSCO, [PALUDE]), '/viaggio', { t: 0 }),
      ev(
        `@djjeck, guidato dalla tua bussola fatata finalmente ti trovi ${PALUDE}\n\nPuoi andare verso:\n - ${BOSCO}`,
        '/viaggio palude',
        { t: 10 }
      ),
    ]);
    expect(wiki.locations[P(PALUDE)]?.at).toBe(PALUDE);
  });

  it('other_players_moves_add_exits_but_do_not_move_owner', () => {
    const events = [
      ev(T.inventory([["una ghianda d'oro", 'C+', 1]]), null, { t: -5 }),
      ev(T.where(BOSCO, []), '/viaggio', { t: 0 }),
      g(T.travel(PIANURA, [MONTE], 'luigi'), '/viaggio valle', 10),
      g(T.blocked(FONDALE, 'luigi'), '/viaggio banco', 15),
      ev(T.drop("trovi una ghianda d'oro", 'C+'), null, { t: 20 }),
    ];
    const { wiki } = runBuild(events);
    expect(f(events[4] as BuildEvent)['location']).toBe(P(BOSCO));
    expect(wiki.locations[P(PIANURA)]?.exits).toStrictEqual([P(MONTE)]);
    expect(wiki.locations[P(BOSCO)]?.exits).toStrictEqual([]); // no link from the owner's place
    expect(wiki.locations[P(FONDALE)]?.requires_item).toBe(true);
  });

  it('stats_place_sets_position', () => {
    const events = [
      ev(T.inventory([["una ghianda d'oro", 'C+', 1]]), null, { t: -5 }),
      ev(`Avventuriero @djjeck\n- Livello: 5\n- Luogo: ${MONTE}`, '/stats', { t: 0 }),
      ev(T.drop("trovi una ghianda d'oro", 'C+'), null, { t: 10 }),
    ];
    runBuild(events);
    expect(f(events[2] as BuildEvent)['location']).toBe(P(MONTE));
  });
});

describe('is mine', () => {
  it('cases', () => {
    const cases: [Parameters<typeof isMine>[0], boolean][] = [
      [{ player: 'djjeck', dm: false }, true],
      [{ player: 'luigi', dm: true }, false],
      [{ player: null, dm: true }, true],
      [{ player: null, dm: false }, false],
      [{ player: 'djjeck', dm: true, forwarded: true }, false],
      [{ player: 'djjeck', dm: false, broadcast: true }, false],
    ];
    for (const [e, want] of cases) expect(isMine(e, 'djjeck'), JSON.stringify(e)).toBe(want);
  });
});

describe('player', () => {
  it('detected_from_dm_only', () => {
    const events = [ev(T.inventory([['un sasso', 'C', 1]]), null, { t: 0 })];
    for (let i = 1; i < 6; i++)
      events.push(g(T.inventory([['un sasso', 'C', 1]], 'luigi'), null, i));
    expect(ownerFromDm(events)).toBe('djjeck');
    expect(ownerFromDm(events.slice(1))).toBeNull();
    expect(build(events, 'luigi').player).toBe('luigi');
  });
});

const ITEMS_USABLE: T.ItemSpec[] = [
  ['un dado a dodici facce', 'C', 1, true],
  ['un dado truccato', 'C', 1, true],
  ['una caps rossa', 'C', 2, true],
  ['una chiave', 'C', 1, true],
];

const uses = (pairs: [string, string][], t0 = 10): BuildEvent[] =>
  pairs.map(([q, text], i) => ev(text, q, { t: t0 + i }));

describe('uses', () => {
  const runUses = (pairs: [string, string][], extra: BuildEvent[] = []) => {
    const events = [
      ev(T.inventory(ITEMS_USABLE), '/inventario', { t: 0 }),
      ...uses(pairs),
      ...extra,
    ];
    const { kb, wiki } = runBuild(events);
    return { kb, wiki, events };
  };

  it('fixed_single_variable', () => {
    const { wiki } = runUses([
      ['/usa caps', '@djjeck, lanci il tappo lontano'],
      ['/usa caps', '@djjeck, lanci il tappo lontano'],
      ['/usa chiave', '@djjeck, la chiave gira a vuoto'],
      ['/usa dado a dodici', '@djjeck, tiri il dado e fai 5!'],
      ['/usa dado a dodici', '@djjeck, tiri il dado e fai 2!'],
    ]);
    const it_ = wiki.items;
    expect([
      it_['una caps rossa']?.use?.result,
      it_['una caps rossa']?.use?.observations,
    ]).toStrictEqual(['fixed', 2]);
    expect(it_['una chiave']?.use?.result).toBe('single');
    expect(it_['un dado a dodici facce']?.use?.result).toBe('variable');
    expect(it_['un dado a dodici facce']?.use?.outcomes).toStrictEqual([
      'tiri il dado e fai 5!',
      'tiri il dado e fai 2!',
    ]);
    expect(it_['un dado truccato']).not.toHaveProperty('use');
  });

  it('noise_ignored', () => {
    const { kb, wiki } = runUses([
      ['/usa dado a dodici', '@djjeck, non hai niente del genere di usabile.'],
      ['/usa dado a dodici', "@djjeck, non puoi usare quell'oggetto.."],
    ]);
    expect(wiki.items['un dado a dodici facce']).not.toHaveProperty('use');
    expect(kb.report.has('unresolved_use')).toBe(false);
  });

  it('failed_use_is_a_requirement', () => {
    const { wiki } = runUses([
      ['/usa chiave', '@djjeck, non hai la chiave giusta per aprire questo baule..'],
    ]);
    const u = wiki.items['una chiave']?.use;
    expect([u?.observations, u?.result, u?.requirements]).toStrictEqual([
      0,
      null,
      ['non hai la chiave giusta per aprire questo baule..'],
    ]);
  });

  it('ambiguous_query_resolved_by_reply_shape', () => {
    const { wiki, events } = runUses([
      ['/usa dado a dodici', '@djjeck, tiri il dado e fai 5!'],
      ['/usa dado', '@djjeck, tiri il dado e fai 2!'],
    ]);
    expect(f(events[2] as BuildEvent)['used_item']).toBe('un dado a dodici facce');
    expect(wiki.items['un dado a dodici facce']?.use?.observations).toBe(2);
    expect(useTemplate('tiri il dado e fai 12!\naltro')).toBe('tiri il dado e fai N!');
  });

  it('ambiguous_query_without_template_unresolved', () => {
    const { kb } = runUses([['/usa dado', '@djjeck, tiri il dado e fai 2!']]);
    expect(kb.report.get('unresolved_use')).toStrictEqual([
      { kind: 'unresolved_use', query: '/usa dado', text: 'tiri il dado e fai 2!' },
    ]);
  });

  it('trailing_arguments_dropped', () => {
    const { events } = runUses([['/usa caps # palude', '@djjeck, lanci il tappo nella palude']]);
    expect(f(events[1] as BuildEvent)['used_item']).toBe('una caps rossa');
  });

  it('use_candidates_prefer_usable', () => {
    const kb = build(
      [
        ev(
          T.inventory([
            ['un dado di legno', 'C', 1],
            ['un dado magico', 'C', 1, true],
          ]),
          null,
          { t: 0 }
        ),
      ],
      'djjeck'
    );
    expect(useCandidates(kb.items, 'dado', ['un dado magico'])).toStrictEqual(['un dado magico']);
    expect(useCandidates(kb.items, 'legno', ['un dado magico'])).toStrictEqual([
      'un dado di legno',
    ]);
    expect(useCandidates(kb.items, '', ['un dado magico'])).toStrictEqual([]);
  });

  it('unknown_reply_with_known_shape_becomes_use', () => {
    const stray = ev('@djjeck, tiri il dado e fai 3!', null, { t: 100 });
    expect(stray.type).toBe('unknown');
    const { wiki } = runUses([['/usa dado a dodici', '@djjeck, tiri il dado e fai 5!']], [stray]);
    expect([stray.type, f(stray)['used_item']]).toStrictEqual(['use', 'un dado a dodici facce']);
    expect(wiki.items['un dado a dodici facce']?.use?.observations).toBe(2);
  });
});

describe('dominant item of a use shape', () => {
  const VUVU = 'una vuvuzela 🎺';
  const CONF = 'un cannoncino sparabolle 🎉';
  const LAMP = 'una lampada magica';
  const inv = ev(
    T.inventory([
      [VUVU, 'X', 1, true],
      [CONF, 'X', 1, true],
      [LAMP, 'X', 1, true],
      ...ITEMS_USABLE,
    ]),
    '/inventario',
    { t: 0 }
  );
  const toot = '@djjeck, soffi con tutto il fiato e .. 🎺 TUUUU';
  const boom = '@djjeck, tiri la cordicella e PUFF! Bolle di sapone dappertutto!!';
  const dice = (n: number): string => `@djjeck, tiri il dado e fai ${n}!`;
  const times = (n: number, q: string, text: string, t0: number): BuildEvent[] =>
    Array.from({ length: n }, (_, i) => ev(text, q, { t: t0 + i }));

  it('ambiguous_query_takes_the_item_with_90_percent_of_the_shape', () => {
    const amb = ev(dice(4), '/usa dado', { t: 100 });
    const { wiki } = runBuild([
      inv,
      ...times(9, '/usa dado a dodici', dice(5), 10),
      ev(dice(3), '/usa dado truccato', { t: 50 }),
      amb,
    ]);
    expect(f(amb)['used_item']).toBe('un dado a dodici facce');
    expect(wiki.items['un dado a dodici facce']?.use?.observations).toBe(11);
  });

  it('unknown_reply_takes_the_item_with_90_percent_of_the_shape', () => {
    const stray = ev(dice(1), null, { t: 100 });
    runBuild([
      inv,
      ...times(9, '/usa dado a dodici', dice(5), 10),
      ev(dice(3), '/usa dado truccato', { t: 50 }),
      stray,
    ]);
    expect([stray.type, f(stray)['used_item']]).toStrictEqual(['use', 'un dado a dodici facce']);
  });

  it('no_item_with_90_percent_stays_unresolved', () => {
    const amb = ev(dice(4), '/usa dado', { t: 100 });
    const stray = ev(dice(1), null, { t: 101 });
    const { kb } = runBuild([
      inv,
      ...times(4, '/usa dado a dodici', dice(5), 10),
      ev(dice(3), '/usa dado truccato', { t: 50 }),
      amb,
      stray,
    ]);
    expect([f(amb)['used_item'], stray.type]).toStrictEqual([undefined, 'unknown']);
    expect(kb.report.get('unresolved_use')).toStrictEqual([
      { kind: 'unresolved_use', query: '/usa dado', text: 'tiri il dado e fai 4!' },
    ]);
  });

  it('reply_of_a_shape_dominated_by_another_item_moves_to_that_item', () => {
    // A bubble reply paired with the command "/usa vuvu" belongs to the bubble cannon.
    const wrong = ev(boom, '/usa vuvu', { t: 100, dm: false, chat: 'Gruppo', match: 'user' });
    const { wiki } = runBuild([
      inv,
      ...times(9, '/usa sparabolle', boom, 10),
      ...times(3, '/usa vuvu', toot, 30),
      wrong,
    ]);
    expect(f(wrong)['used_item']).toBe(CONF);
    expect(wiki.items[VUVU]?.use?.outcomes).toStrictEqual([
      'soffi con tutto il fiato e .. 🎺 TUUUU',
    ]);
    expect(wiki.items[CONF]?.use?.observations).toBe(10);
  });

  it('failed_use_is_not_moved', () => {
    const fail = '@djjeck, non hai la chiave giusta per aprire questo baule..';
    const { wiki } = runBuild([
      inv,
      ...times(9, '/usa chiave', fail, 10),
      ev(fail, '/usa caps', { t: 50 }),
    ]);
    expect(wiki.items['una caps rossa']?.use?.requirements).toStrictEqual([
      'non hai la chiave giusta per aprire questo baule..',
    ]);
  });
});

// Mispaired group uses are checked at the end of phase 4: verify.test.ts.

const pozInfo = (n: number, t: number): BuildEvent =>
  ev(T.info('una pozione', 'C', { count: n, usable: true }), '/esamina pozione', { t });
const pozUse = (t: number): BuildEvent =>
  ev('@djjeck, bevi la pozione e ti senti meglio', '/usa pozione', { t });

describe('travel unlocks', () => {
  const PALUDE = 'nella palude sussurrante 🌾';
  const DESERTO = "nell'immenso deserto di Sabbiora 🏜";
  const CATACOMBE = 'nelle cripte del monastero 👻';
  const racchetta =
    '@djjeck, guidato dalla tua bussola fatata finalmente ti trovi nella palude sussurrante 🌾\n\nPuoi andare verso:\n - ' +
    BOSCO;

  it('narrated_arrival_takes_the_known_place_that_ends_it', () => {
    const arrival = ev(racchetta, '/viaggio palude', { t: 10 });
    const { wiki, state } = runBuild([
      ev(T.where(BOSCO, [PALUDE, PIANURA]), '/viaggio', { t: 0 }),
      arrival,
    ]);
    expect([f(arrival)['location'], f(arrival)['narrative']]).toStrictEqual([
      P(PALUDE),
      'guidato dalla tua bussola fatata finalmente ti trovi',
    ]);
    const l = wiki.locations[P(PALUDE)];
    expect([l?.requires_item, l?.unlock_texts, l?.exits]).toStrictEqual([
      true,
      ['guidato dalla tua bussola fatata finalmente ti trovi'],
      [P(BOSCO)],
    ]);
    expect(state.locations[P(PALUDE)]?.visited).toBe(true);
  });

  it('longest_known_place_wins_and_later_events_count', () => {
    // The arrival comes first; the places are learned from a later /viaggio.
    const arrival = ev(
      "@luigi, con dieci borracce piene d'acqua e dopo un lungo viaggio arrivi (stremato) nell'immenso deserto di Sabbiora 🏜",
      '/viaggio deserto',
      { t: 0, dm: false, chat: 'Gruppo', match: 'user' }
    );
    const { wiki } = runBuild([
      arrival,
      ev(T.where(BOSCO, ['deserto di Sabbiora 🏜', DESERTO]), '/viaggio', { t: 100 }),
    ]);
    expect(f(arrival)['location']).toBe(P(DESERTO));
    expect(wiki.locations[P(DESERTO)]?.unlock_texts).toStrictEqual([
      "con dieci borracce piene d'acqua e dopo un lungo viaggio arrivi (stremato)",
    ]);
  });

  it('arrivi_without_colon_leaves_out_the_words_and_full_stop_before_and_after', () => {
    // With the exits block: "arrivi" without the colon does not delimit the place.
    const arrival = ev(
      "@djjeck, con dieci borracce piene d'acqua arrivi (stremato) nell'immenso deserto di Sabbiora 🏜.\n\nPuoi andare verso:\n - " +
        BOSCO,
      '/viaggio deserto',
      { t: 10 }
    );
    const { wiki } = runBuild([ev(T.where(BOSCO, [DESERTO]), '/viaggio', { t: 0 }), arrival]);
    expect([f(arrival)['location'], f(arrival)['narrative']]).toStrictEqual([
      P(DESERTO),
      "con dieci borracce piene d'acqua arrivi (stremato)",
    ]);
    expect(Object.keys(wiki.locations).sort()).toStrictEqual([P(DESERTO), P(BOSCO)].sort());
  });

  it('arrival_at_an_unknown_place_is_reported', () => {
    const arrival = ev(racchetta, '/viaggio palude', { t: 10 });
    const { wiki, kb, state } = runBuild([arrival]);
    expect(f(arrival)['location']).toBeNull();
    expect(Object.keys(wiki.locations)).toStrictEqual([P(BOSCO)]); // only the exit
    expect(kb.report.get('unresolved_travel')).toStrictEqual([
      {
        kind: 'unresolved_travel',
        query: '/viaggio palude',
        text: 'guidato dalla tua bussola fatata finalmente ti trovi nella palude sussurrante 🌾',
      },
    ]);
    expect(state.locations[P(BOSCO)]?.visited).toBe(false);
  });

  describe('travel requirement notices', () => {
    const VILLAGGIO = 'nel villaggio di Borgoverde 🏡';
    const MONTE = 'ai piedi del monte Grevolo ⛰';
    const CIMA = 'in cima al monte Grevolo 🏔';
    const notice = (item: string, place: string, t: number): BuildEvent =>
      ev(`${item} ti serve per passare ${place} sulla via per tornare al villaggio.`, null, { t });
    /**
     * Village -> bosco -> cripte, and village -> monte -> cima -> palude. The cripte's own
     * exits are unknown: the bosco lists them, so they lead back to it.
     */
    const map = [
      ev(T.where(VILLAGGIO, [BOSCO, MONTE]), '/viaggio', { t: 0 }),
      ev(T.where(BOSCO, [VILLAGGIO, CATACOMBE]), '/viaggio', { t: 1 }),
      ev(T.where(MONTE, [VILLAGGIO, CIMA]), '/viaggio', { t: 3 }),
      ev(T.where(CIMA, [MONTE, PALUDE]), '/viaggio', { t: 4 }),
      ev(T.where(PALUDE, [CIMA]), '/viaggio', { t: 5 }),
    ];
    const required = (wiki: ReturnType<typeof runBuild>['wiki']): Record<string, string[]> =>
      Object.fromEntries(
        Object.values(wiki.locations)
          .filter((l) => l.required_items.length > 0)
          .map((l) => [l.name, l.required_items])
      );

    it('the_place_takes_the_item_when_nothing_on_the_way_back_needs_one', () => {
      const { wiki } = runBuild([...map, notice('una lanterna cieca', CATACOMBE, 10)]);
      expect(required(wiki)).toStrictEqual({ [P(CATACOMBE)]: ['una lanterna cieca'] });
      expect(wiki.locations[P(CATACOMBE)]?.requires_item).toBe(true);
      expect(wiki.items['una lanterna cieca']?.rarity).toBeNull();
    });

    it('the_one_place_on_the_way_back_that_needs_an_item_takes_it', () => {
      const { wiki } = runBuild([
        ...map,
        ev(T.blocked(CIMA), '/viaggio cima', { t: 6 }),
        notice('un rampino di ferro', PALUDE, 10),
      ]);
      expect(required(wiki)).toStrictEqual({ [P(CIMA)]: ['un rampino di ferro'] });
      expect(wiki.locations[P(PALUDE)]?.requires_item).toBe(false);
    });

    it('several_places_needing_an_item_are_reported', () => {
      const { wiki, kb } = runBuild([
        ...map,
        ev(T.blocked(CIMA), '/viaggio cima', { t: 6 }),
        ev(T.blocked(PALUDE), '/viaggio palude', { t: 7 }),
        notice('un rampino di ferro', PALUDE, 10),
      ]);
      expect(required(wiki)).toStrictEqual({});
      expect(kb.report.get('unresolved_requirement')).toStrictEqual([
        {
          kind: 'unresolved_requirement',
          item: 'un rampino di ferro',
          location: P(PALUDE),
          reason: 'several',
        },
      ]);
    });

    it('without_a_known_way_back_it_is_reported', () => {
      const { wiki, kb } = runBuild([
        ev(T.where(BOSCO, [CATACOMBE]), '/viaggio', { t: 0 }),
        notice('una lanterna cieca', CATACOMBE, 10),
      ]);
      expect(required(wiki)).toStrictEqual({});
      expect(kb.report.get('unresolved_requirement')).toStrictEqual([
        {
          kind: 'unresolved_requirement',
          item: 'una lanterna cieca',
          location: P(CATACOMBE),
          reason: 'no_way_back',
        },
      ]);
    });
  });
});

describe('unique items from stats', () => {
  it('unique_items_of_any_stats_enter_the_wiki', () => {
    const stats =
      'Avventuriero @lucia_b\n- Livello: 11\n- Oggetti unici:\n   - il Sigillo Antico [U]\n   - un cannocchiale dorato [U] [usabile]';
    const { wiki, state } = runBuild(
      [ev(stats, '/stats lucia_b', { t: 0, dm: false, chat: 'Gruppo', match: 'user' })],
      'djjeck'
    );
    expect([
      wiki.items['il Sigillo Antico']?.rarity,
      wiki.items['un cannocchiale dorato']?.usable,
    ]).toStrictEqual(['U', true]);
    expect(state.inventory).toStrictEqual({});
  });
});

describe('use ambiguity reply', () => {
  it('ambiguity_reply_to_usa_is_not_a_use', () => {
    const { kb, wiki } = runBuild([
      ev(T.inventory(ITEMS_USABLE), '/inventario', { t: 0 }),
      ev('troppi oggetti trovati con quel nome(dado)', '/usa dado', { t: 1 }),
    ]);
    expect(kb.report.has('unresolved_use')).toBe(false);
    expect(wiki.items['un dado a dodici facce']).not.toHaveProperty('use');
  });
});

describe('Pakkomon sphere', () => {
  it('pakkomon_sphere_use_is_a_use_of_the_sphere', () => {
    const ball = ev(
      "@djjeck, lanci la tua Sfera Frullo, si apre a mezz'aria ed esce un Pakkomon di nome Brumolo 👻 [X]!",
      null,
      { t: 1 }
    );
    const { wiki, kb, state } = runBuild([
      ev(T.inventory([['una sfera Frullo 💊', 'L1', 1, true]]), '/inventario', { t: 0 }),
      ball,
    ]);
    expect(f(ball)['used_item']).toBe('una sfera Frullo 💊');
    expect([
      wiki.items['una sfera Frullo 💊']?.use?.observations,
      wiki.items['un Pakkomon di nome Brumolo 👻']?.rarity,
    ]).toStrictEqual([1, 'X']);
    expect([
      kb.report.has('unresolved_drop'),
      kb.report.has('unresolved_use'),
      state.inventory['un Pakkomon di nome Brumolo 👻']?.qty,
    ]).toStrictEqual([false, false, 1]);
  });
});

describe('cooldown intervals', () => {
  const inv = ev(T.inventory([['un dado', 'C', 1, true]]), '/inventario', { t: 0 });
  const use = (t: number, o: EvOptions = {}): BuildEvent =>
    ev('@djjeck, tiri il dado e fai 5!', '/usa dado', { t, ...o });
  const wait = (t: number, d: string, o: EvOptions = {}): BuildEvent =>
    ev(`@djjeck, un dado deve raffreddarsi ancora per ${d} prima di poterlo usare.`, null, {
      t,
      ...o,
    });
  const cd = (events: BuildEvent[]) =>
    runBuild([inv, ...events]).wiki.items['un dado']?.use?.cooldown;

  it('one_slow_observation_gives_only_a_minimum', () => {
    // 2 hours left a million seconds after the last use seen: an unseen use may lie in between.
    expect(cd([use(10), wait(1000010, '2 ore')])).toStrictEqual({
      min: 7200,
      max: 1000000 + 7200 + 3600 + 90,
      observations: 1,
    });
  });

  it('quick_refusal_must_be_in_the_same_chat', () => {
    const grp = { dm: false, chat: 'Gruppo', match: 'user' } as const;
    expect(cd([use(10), wait(40, '4 minuti e 20 secondi', grp)])).toStrictEqual({
      min: 260,
      max: 30 + 260 + 1 + 90,
      observations: 1,
    });
    expect(cd([use(10, grp), wait(40, '4 minuti e 20 secondi', grp)])?.seconds).toBe(300);
  });

  it('slow_observations_corroborating_one_round_value', () => {
    // [120, 670] and [280, 671]: 600 is the only multiple of 10 minutes in [280, 670].
    expect(
      cd([use(10), wait(410, '2 minuti'), use(10000), wait(10300, '4 minuti e 40 secondi')])
    ).toStrictEqual({ seconds: 600, min: 280, max: 670, observations: 2 });
  });

  it('slow_observations_with_several_round_values_give_only_a_minimum', () => {
    // [86000, 299900+...] and [100, ...]: both 1 and 2 days fit.
    expect(
      cd([
        use(10),
        wait(200010, '23 ore e 53 minuti'),
        use(400000),
        wait(650000, '1 minuto e 40 secondi'),
      ])
    ).toStrictEqual({ min: 85980, max: 250000 + 100 + 1 + 90, observations: 2 });
  });
});

describe('consumption', () => {
  const useOf = (events: BuildEvent[]) => runBuild(events).wiki.items['una pozione']?.use;

  it('drop_of_k_means_consumed', () => {
    const u = useOf([pozInfo(3, 0), pozUse(1), pozUse(2), pozInfo(1, 3)]);
    expect([u?.consumed, u?.consumed_evidence]).toStrictEqual([true, { yes: 2, no: 0 }]);
  });

  it('no_drop_means_not_consumed', () => {
    const u = useOf([pozInfo(3, 0), pozUse(1), pozInfo(3, 2)]);
    expect([u?.consumed, u?.consumed_evidence]).toStrictEqual([false, { yes: 0, no: 1 }]);
  });

  it('no_counts_unknown', () => {
    expect(useOf([pozInfo(3, 0), pozUse(1)])?.consumed).toBeNull();
  });

  it('inventory_counts_including_zero', () => {
    const u = useOf([
      ev(
        T.inventory([
          ['una pozione', 'C', 1, true],
          ['un sasso', 'C', 1],
        ]),
        '/inventario',
        { t: 0 }
      ),
      pozUse(1),
      ev(T.inventory([['un sasso', 'C', 1]]), '/inventario', { t: 2 }),
    ]);
    expect(u?.consumed_evidence).toStrictEqual({ yes: 1, no: 0 });
  });

  it('other_movement_invalidates_interval', () => {
    const cases: Record<string, () => BuildEvent> = {
      drop: () => ev(T.drop('trovi una pozione', 'C'), '/avventura', { t: 2 }),
      gift: () => ev(T.gift(1, 'una pozione', 'luigi'), null, { t: 2 }),
      give: () => ev(T.give(1, 'una pozione', 'luigi'), '/dai', { t: 2 }),
      craft: () => ev(T.craft([['una pozione', 'C', 1]], 'un elisir'), '/ricetta elisir', { t: 2 }),
      level_up: () =>
        ev(
          T.craft([['un sasso', 'C', 1]], 'un muro', 'djjeck', [
            5,
            'Per te 1x una pozione in omaggio!',
          ]),
          '/ricetta muro',
          { t: 2 }
        ),
      use_output: () =>
        ev('@djjeck, apri il baule e trovi:\n- una pozione [C] x1', '/usa baule', { t: 2 }),
    };
    for (const [name, extra] of Object.entries(cases)) {
      const events = [
        ev(
          T.inventory([
            ['un sasso', 'C', 1],
            ['un baule', 'C', 1, true],
          ]),
          null,
          { t: -1 }
        ),
        pozInfo(3, 0),
        pozUse(1),
        extra(),
        pozUse(3),
        pozInfo(3, 4),
      ];
      expect(useOf(events)?.consumed_evidence, name).toStrictEqual({ yes: 0, no: 0 });
    }
  });

  it('conflicting_evidence_means_consumed', () => {
    const { kb, wiki } = runBuild([
      pozInfo(3, 0),
      pozUse(1),
      pozInfo(2, 2),
      pozUse(3),
      pozInfo(2, 4),
    ]);
    const u = wiki.items['una pozione']?.use;
    expect([u?.consumed, u?.consumed_evidence]).toStrictEqual([true, { yes: 1, no: 1 }]);
    expect(kb.report.get('use_consumption_conflict')).toStrictEqual([
      { kind: 'use_consumption_conflict', item: 'una pozione', yes: 1, no: 1 },
    ]);
  });

  it('other_players_counts_ignored', () => {
    const events = [
      pozInfo(3, 0),
      pozUse(1),
      g(
        T.info('una pozione', 'C', { count: 2, user: 'luigi', usable: true }),
        '/esamina pozione',
        2
      ),
    ];
    expect(useOf(events)?.consumed).toBeNull();
  });
});

const det = (recipe: string, ingr: T.ItemSpec[], t: number, query?: string): BuildEvent =>
  ev(T.detail(recipe, [], ingr), query ?? `/ricetta ${recipe.toLowerCase()}`, { t });

describe('observations', () => {
  it('each_event_naming_an_entry_counts_once', () => {
    const { wiki } = runBuild([
      // Named twice by one reply, and again by the pass that resolves the drop: one.
      ev(T.inventory([['un sasso', 'C', 1]]), '/inventario', { t: 0 }),
      ev(T.drop('nel bosco trovi un sasso', 'C'), null, { t: 10 }),
      ev(T.recipeList([['Torre', 1, 1]]), '/ricetta', { t: 20 }),
      ev(T.detail('Torre', [['un sasso', 'C', 4]], []), '/ricetta torre', { t: 30 }),
      ev(T.where(BOSCO, [PIANURA]), '/viaggio', { t: 40 }),
      ev(T.where(PIANURA, [BOSCO]), '/viaggio', { t: 50 }),
    ]);
    expect(wiki.items['un sasso']?.observations).toBe(3);
    expect(wiki.recipes['Torre']?.observations).toBe(2);
    expect(wiki.locations[P(BOSCO)]?.observations).toBe(2);
    // Named last as an exit; the drop attributed to it does not date it.
    expect(wiki.locations[P(BOSCO)]?.last_seen).toBe(iso(50));
  });

  it('a_renamed_item_counts_the_observations_of_both_names', () => {
    const { wiki } = runBuild([
      det('Premiazione', [["un Gufetto d'Argento", 'R', 1]], 10),
      det('Premiazione', [['un Premio Sgranocchio', 'R', 1]], 1000),
    ]);
    expect(wiki.items['un Premio Sgranocchio']?.observations).toBe(2);
  });
});

describe('renames', () => {
  it('swap_with_same_rarity_is_rename', () => {
    const { kb, wiki } = runBuild([
      ev(T.inventory([["un Gufetto d'Argento", 'R', 1]]), null, { t: 0 }),
      det(
        'Premiazione',
        [
          ['un sasso', 'C', 1],
          ["un Gufetto d'Argento", 'R', 1],
        ],
        10
      ),
      det('Altare', [["un Gufetto d'Argento", 'R', 2]], 11),
      det(
        'Premiazione',
        [
          ['un sasso', 'C', 1],
          ['un Premio Sgranocchio', 'R', 1],
        ],
        1000
      ),
    ]);
    expect(wiki.renames).toStrictEqual({ "un Gufetto d'Argento": 'un Premio Sgranocchio' });
    expect(wiki.items).not.toHaveProperty(["un Gufetto d'Argento"]);
    const nw = wiki.items['un Premio Sgranocchio'];
    expect(nw?.old_names?.map((o) => o.name)).toStrictEqual(["un Gufetto d'Argento"]);
    expect(nw?.old_names?.[0]?.last_seen).toBe(iso(11));
    expect(nw?.used_in).toStrictEqual(['Altare', 'Premiazione']);
    expect(wiki.recipes['Altare']?.ingredients).toStrictEqual({ 'un Premio Sgranocchio': 2 });
    expect(kb.report.get('renamed_item')?.[0]).toMatchObject({
      old: "un Gufetto d'Argento",
      new: 'un Premio Sgranocchio',
      recipe: 'Premiazione',
    });
    expect(kb.report.has('ingredient_conflict')).toBe(false);
  });

  it('different_rarity_is_conflict', () => {
    const { kb, wiki } = runBuild([
      det(
        'Premiazione',
        [
          ['un sasso', 'C', 1],
          ['un Gufetto', 'R', 1],
        ],
        10
      ),
      det(
        'Premiazione',
        [
          ['un sasso', 'C', 1],
          ['un Premio', 'N', 1],
        ],
        1000
      ),
    ]);
    expect(wiki.renames).toStrictEqual({});
    expect(wiki.items).toHaveProperty(['un Gufetto']);
    expect(kb.report.get('ingredient_conflict')?.[0]).toMatchObject({
      recipe: 'Premiazione',
      source: 'swap',
      old_item: 'un Gufetto',
      new_item: 'un Premio',
    });
  });

  it('old_seen_after_new_is_conflict', () => {
    const { kb, wiki } = runBuild([
      det(
        'Premiazione',
        [
          ['un sasso', 'C', 1],
          ['un Gufetto', 'R', 1],
        ],
        10
      ),
      det(
        'Premiazione',
        [
          ['un sasso', 'C', 1],
          ['un Premio', 'R', 1],
        ],
        1000
      ),
      ev(T.inventory([['un Gufetto', 'R', 1]]), '/inventario', { t: 2000 }),
    ]);
    expect(wiki.renames).toStrictEqual({});
    expect(kb.report.get('ingredient_conflict')).toHaveLength(1);
  });

  it('different_quantity_is_conflict', () => {
    const { kb, wiki } = runBuild([
      det(
        'Premiazione',
        [
          ['un sasso', 'C', 1],
          ['un Gufetto', 'R', 1],
        ],
        10
      ),
      det(
        'Premiazione',
        [
          ['un sasso', 'C', 1],
          ['un Premio', 'R', 2],
        ],
        1000
      ),
    ]);
    expect(wiki.renames).toStrictEqual({});
    expect(kb.renameHints).toStrictEqual([]);
    expect(kb.report.get('ingredient_conflict')?.[0]).toMatchObject({ source: 'detail' });
  });

  it('chain_points_to_current_name', () => {
    const { wiki } = runBuild([
      det(
        'Premiazione',
        [
          ['un sasso', 'C', 1],
          ['un A', 'R', 1],
        ],
        10
      ),
      det(
        'Premiazione',
        [
          ['un sasso', 'C', 1],
          ['un B', 'R', 1],
        ],
        1000
      ),
      det(
        'Premiazione',
        [
          ['un sasso', 'C', 1],
          ['un C', 'R', 1],
        ],
        2000
      ),
    ]);
    expect(wiki.renames).toStrictEqual({ 'un A': 'un C', 'un B': 'un C' });
    expect(wiki.items['un C']?.old_names?.map((o) => o.name).sort()).toStrictEqual([
      'un A',
      'un B',
    ]);
    expect(Object.keys(wiki.items).sort()).toStrictEqual(['un C', 'un sasso']);
  });
});

describe('rarity hypotheses', () => {
  it('m_hypothesis_without_faq', () => {
    const { wiki } = runBuild([ev(T.inventory([['un drago', 'M', 1]]), null, { t: 0 })]);
    expect(Object.keys(wiki.rarity_hypotheses)).toStrictEqual(['M']);
    expect(wiki.rarities).toStrictEqual({});
  });

  it('m_hypothesis_when_faq_does_not_define_it', () => {
    const { wiki } = runBuild([ev(T.FAQ, '/faq', { t: 0 })]);
    expect(Object.keys(wiki.rarity_hypotheses)).toStrictEqual(['M']);
    expect(wiki.rules).toStrictEqual(['Ogni ricetta di livello N richiede il livello N.']);
  });

  it('no_hypothesis_when_faq_defines_m', () => {
    const faq = T.FAQ.replace('S = super raro,', 'S = super raro, M = mitico,');
    const { wiki } = runBuild([ev(faq, '/faq', { t: 0 })]);
    expect(wiki.rarity_hypotheses).toStrictEqual({});
    expect(wiki.rarities['M']).toBe('mitico');
  });

  it('latest_faq_wins', () => {
    const newer = T.FAQ.replace('C = comune', 'C = comunissimo');
    const { wiki } = runBuild([ev(T.FAQ, '/faq', { t: 0 }), ev(newer, '/faq', { t: 10 })]);
    expect(wiki.rarities['C']).toBe('comunissimo');
  });
});

describe('preferences are not player state', () => {
  it('preference_and_quest_replies_change_neither_wiki_nor_player', () => {
    const base = (): BuildEvent[] => [
      ev('@mario_r, possiedi:\n- un piccolo bonsai [C] x1', '/inventario', { t: 0 }),
    ];
    const prefs = [
      ev(
        "@mario_r, sei veramente affezionato a un piccolo bonsai, e' di gran lunga il tuo oggetto preferito!",
        '/preferito bonsai',
        { t: 10 }
      ),
      ev('@mario_r, nascondi la ricetta Orto in vaso', '/nascondi orto', { t: 20 }),
      ev('@mario_r, stai nascondendo le seguenti ricette:\n - Orto in vaso', '/nascondi', {
        t: 30,
      }),
      ev('@mario_r non hai nessuna quest al momento.', '/quest', { t: 40 }),
    ];
    const without = runBuild(base(), 'mario_r');
    const withPrefs = runBuild([...base(), ...prefs], 'mario_r');
    expect(prefs.map((e) => e.type)).toStrictEqual(['miss', 'miss', 'miss', 'miss']);
    expect(withPrefs.wiki.items).toStrictEqual(without.wiki.items);
    expect(withPrefs.wiki.recipes).toStrictEqual(without.wiki.recipes);
    // Only as_of (the date of the latest event) moves.
    expect({ ...withPrefs.state, as_of: null }).toStrictEqual({ ...without.state, as_of: null });
  });
});

describe('report', () => {
  it('prints the count of each kind and its first 15 entries, one line each', () => {
    const events = Array.from({ length: 16 }, (_, i) =>
      ev(T.drop(`nel fosso vedi la cosa ${i}`, 'C'), null, { t: i })
    );
    const { kb } = runBuild(events);
    const lines = reportLines(kb);
    const at = lines.indexOf('-- unresolved_drop: 16 (primi 15)');
    expect(at).toBeGreaterThan(0);
    expect(lines.slice(at + 1)).toHaveLength(15);
    expect(lines[at + 1]).toBe('  unresolved_drop: text="nel fosso vedi la cosa 0"');
  });
});

describe('edge cases', () => {
  it('craft_by_output_sees_recipe_links_from_earlier_crafts', () => {
    const events: BuildEvent[] = [
      ev(T.recipeList([['Pizza', 1, 0]]), '/ricetta', { t: 0 }),
      ev(T.craft([['un pomodoro', 'C', 1]], 'una pizza'), '/ricetta pizza', { t: 1 }), // named by query: Pizza -> una pizza
      ev(T.craft([['una mozzarella', 'C', 1]], 'una pizza'), null, { t: 2 }), // no query, unknown signature: by output
    ];
    const { wiki } = runBuild(events);
    expect(Object.keys(wiki.recipes).sort()).toStrictEqual(['Pizza']);
  });

  it('craft_by_output_does_not_see_links_from_later_crafts', () => {
    const events: BuildEvent[] = [
      ev(T.recipeList([['Pizza', 1, 0]]), '/ricetta', { t: 0 }),
      ev(T.craft([['una mozzarella', 'C', 1]], 'una pizza'), null, { t: 1 }), // before any link: unnamed
      ev(T.craft([['un pomodoro', 'C', 1]], 'una pizza'), '/ricetta pizza', { t: 2 }), // Pizza -> una pizza
    ];
    const { wiki } = runBuild(events);
    expect(Object.keys(wiki.recipes).sort()).toStrictEqual([
      '(ricetta senza nome) → una pizza',
      'Pizza',
    ]);
  });

  it('rename_rewrites_only_item_names', () => {
    const OLD = "un Gufetto d'Argento";
    const { state } = runBuild([
      ev(T.where(OLD, []), '/viaggio', { t: 0 }), // a place whose name equals the old item name
      ev(T.info(OLD, 'R', { count: 2 }), `/esamina ${OLD}`, { t: 1 }),
      ev(
        T.detail(
          'Premiazione',
          [],
          [
            ['un sasso', 'C', 1],
            [OLD, 'R', 1],
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
    ]);
    expect(state.locations[OLD]).toStrictEqual({ visited: true, adventures: 0 });
  });

  it('rename_still_rewrites_every_item_field', () => {
    const OLD = "un Gufetto d'Argento";
    const NEW = 'un Premio Sgranocchio';
    const { state } = runBuild([
      ev(T.info(OLD, 'R', { count: 2 }), `/esamina ${OLD}`, { t: 1 }),
      ev(
        T.detail(
          'Premiazione',
          [],
          [
            ['un sasso', 'C', 1],
            [OLD, 'R', 1],
          ]
        ),
        '/ricetta p',
        { t: 10 }
      ),
      ev(T.drop(`nel bosco trovi ${OLD}`, 'R'), '/avventura', { t: 20 }),
      ev(
        T.inventory([
          [OLD, 'R', 3],
          ['un sasso', 'C', 1],
        ]),
        '/inventario',
        { t: 30 }
      ),
      ev(
        T.detail(
          'Premiazione',
          [],
          [
            ['un sasso', 'C', 1],
            [NEW, 'R', 1],
          ]
        ),
        '/ricetta p',
        { t: 1000 }
      ),
    ]);
    expect(state.inventory).not.toHaveProperty([OLD]);
    expect(state.inventory[NEW]?.qty).toBe(3);
  });

  it('lower_case_inventory_rarity_filter_is_a_rarity_filter', () => {
    // Rarity filters are case-insensitive in the bot: "/inventario c" lists the C and C+
    // items only, like "/inventario C". It zeroes unlisted C items, not names containing "c".
    const info = (name: string, n: number, t: number, rarity: string): BuildEvent =>
      ev(T.info(name, rarity, { count: n }), `/esamina ${name}`, { t });
    const { state } = runBuild([
      info('una cosa', 3, 0, 'N'),
      info('una mela', 2, 1, 'C'),
      info('un sasso', 4, 2, 'C+'),
      ev(T.inventory([['una mela', 'C', 2]]), '/inventario c', { t: 10 }),
    ]);
    expect(state.inventory['una cosa']?.qty).toBe(3);
    expect(state.inventory).not.toHaveProperty(['un sasso']); // zeroed: dropped from the inventory
  });

  it('every_rarity_filter_is_case_insensitive', () => {
    const info = (name: string, n: number, t: number, rarity: string): BuildEvent =>
      ev(T.info(name, rarity, { count: n }), `/esamina ${name}`, { t });
    const names = ['una rosa', 'un rubino', 'un liuto', 'una lira', 'un mulo'];
    const known = [
      info('una rosa', 1, 0, 'R'),
      info('un rubino', 1, 1, 'R+'),
      info('un liuto', 1, 2, 'L1'),
      info('una lira', 1, 3, 'L2'),
      info('un mulo', 1, 4, 'M'),
    ];
    // Items the reply proves to be 0 are dropped from the inventory.
    const zeroed = (query: string): string[] => {
      const { state } = runBuild([...known, ev(T.inventory([]), query, { t: 10 })]);
      return names.filter((n) => !(n in state.inventory)).sort();
    };
    expect(zeroed('/inventario r')).toStrictEqual(['un rubino', 'una rosa']);
    expect(zeroed('/inventario r+')).toStrictEqual(['un rubino']);
    expect(zeroed('/inventario l1')).toStrictEqual(['un liuto']);
    expect(zeroed('/inventario l')).toStrictEqual(['un liuto', 'una lira']);
    expect(zeroed('/inventario m')).toStrictEqual([]);
    expect(zeroed('/inventario lira')).toStrictEqual(['una lira']); // a word, not a rarity
  });

  it('use_refusals_are_not_successful_uses', () => {
    const inv = ev(
      T.inventory([
        ['una ruota della fortuna 🎡', 'X', 1, true],
        ['una capsula', 'X', 1, true],
      ]),
      '/inventario',
      { t: 0 }
    );
    const use = (q: string, text: string, t: number): BuildEvent =>
      ev(`@djjeck, ${text}`, q, { t });
    const { wiki } = runBuild([
      inv,
      use(
        '/usa ruota',
        'giri la ruota e si ferma su:\n[🍀🌙🍀]\nHai fatto coppia, vinci 2 gettoni!',
        1
      ),
      use(
        '/usa ruota',
        'una ruota della fortuna 🎡 deve raffreddarsi ancora per 7 secondi prima di poterlo usare.',
        2
      ),
      use(
        '/usa ruota',
        'una ruota della fortuna 🎡 deve raffreddarsi ancora per 2 ore e 5 minuti prima di poterlo usare di nuovo.',
        3
      ),
      use(
        '/usa capsula # palazzo',
        'non puoi teletrasportarti in quei luoghi, forse ti mancano gli oggetti necessari..',
        4
      ),
      use('/usa capsula # xyz', 'non conosci nessun luogo con quel nome..', 5),
    ]);
    const slot = wiki.items['una ruota della fortuna 🎡']?.use;
    const caps = wiki.items['una capsula']?.use;
    expect([slot?.observations, slot?.outcomes.length, slot?.requirements]).toStrictEqual([
      1,
      1,
      [],
    ]);
    expect([caps?.observations, caps?.requirements]).toStrictEqual([
      0,
      ['non puoi teletrasportarti in quei luoghi, forse ti mancano gli oggetti necessari..'],
    ]);
  });

  it('cooldown_refusal_is_no_consumption_evidence', () => {
    const poz = (n: number, t: number): BuildEvent =>
      ev(T.info('una pozione', 'C', { count: n, usable: true }), '/esamina pozione', { t });
    const { wiki } = runBuild([
      poz(3, 0),
      ev('@djjeck, bevi la pozione e ti senti meglio', '/usa pozione', { t: 1 }),
      poz(2, 2),
      ev(
        '@djjeck, una pozione deve raffreddarsi ancora per 30 secondi prima di poterlo usare.',
        '/usa pozione',
        { t: 3 }
      ),
      poz(2, 4),
    ]);
    expect(wiki.items['una pozione']?.use?.consumed_evidence).toStrictEqual({ yes: 1, no: 0 });
  });

  it('inline_use_items_count_for_the_owner', () => {
    const { state } = runBuild([
      ev(T.info("una moneta d'oro", 'X', { count: 5 }), '/esamina moneta', { t: 0 }),
      ev("@djjeck, apri il barattolo e ci trovi dentro 22 monete d'oro!", '/usa barattolo', {
        t: 1,
      }),
    ]);
    expect(state.inventory["una moneta d'oro"]?.qty).toBe(27);
  });

  it('inline_items_edges', () => {
    const items = (t: string) => {
      const e = classify(t, '/usa x');
      return e.type === 'use' ? e.items : null;
    };
    expect(
      items(
        "@djjeck, apri il baule e trovi:\n-una moneta d'oro [X] x41\nOttieni: un sacchetto [X] [usabile]!"
      )
    ).toStrictEqual([
      { name: "una moneta d'oro", rarity: 'X', usable: false, qty: 41 },
      { name: 'un sacchetto', rarity: 'X', usable: true, qty: 1 },
    ]);
    expect(items('@djjeck, ci trovi dentro 3 sassi!')).toStrictEqual([]); // only gold coins are counted inline
    expect(items("@djjeck, scuoti il barattolo e ci trovi dentro 1 moneta d'oro")).toStrictEqual([
      { name: "una moneta d'oro", rarity: null, usable: false, qty: 1 },
    ]);
  });

  it('unknown_reply_turned_into_a_use_reads_its_items', () => {
    const known = ev('@djjeck, osservi il vecchio alberello. Ottieni: un seme!', '/usa alberello', {
      t: 1,
    });
    const stray = ev('@djjeck, osservi il vecchio alberello. Ottieni: un seme!', null, { t: 2 });
    const { state } = runBuild([
      ev(T.inventory([['un alberello', 'C', 1, true]]), '/inventario', { t: 0 }),
      known,
      stray,
    ]);
    expect([stray.type, state.inventory['un seme']?.qty]).toStrictEqual(['use', 2]);
  });

  it('truncated_recipe_list_is_marked_in_the_player_state', () => {
    const { state } = runBuild([
      ev(
        '@djjeck, ecco le ricette a tua disposizione:\n- Torre L1 [*]\n- Gara di cucina L3 [manca TRONCATO!',
        '/ricetta',
        { t: 0 }
      ),
    ]);
    expect(state.recipe_list).toStrictEqual({
      date: state.recipe_list?.date,
      truncated: true,
      recipes: { Torre: 'pronta' },
    });
  });

  it('titolo_list_does_not_zero_the_inventory', () => {
    const { state, wiki } = runBuild([
      ev(T.info('un sasso', 'C', { count: 2 }), '/esamina sasso', { t: 0 }),
      ev(
        '@djjeck, ora non hai nessun titolo. Ecco gli oggetti che danno titoli che possiedi:\n- un astrolabio da cartografo [L1]',
        '/titolo',
        { t: 1 }
      ),
    ]);
    expect(state.inventory['un sasso']?.qty).toBe(2);
    expect(wiki.items['un astrolabio da cartografo']?.gives_title).toBe(true);
    expect(wiki.items['un sasso']).not.toHaveProperty('gives_title');
  });

  it('anonymous_show_gives_no_player_state', () => {
    const { state, wiki } = runBuild(
      [
        ev(
          '[.. una presenza indistinta..], mostri orgogliosamente di possedere 241x un fischietto [C]',
          '/mostra fischietto',
          { t: 0, dm: false, chat: 'Gruppo', match: 'user' }
        ),
      ],
      'djjeck'
    );
    expect(wiki.items['un fischietto']?.rarity).toBe('C');
    expect(state.inventory).toStrictEqual({});
  });
  it('cooldown_estimated_from_last_use_and_refusal', () => {
    const inv = ev(T.inventory([['un dado', 'C', 1, true]]), '/inventario', { t: 0 });
    const use = (t: number): BuildEvent => ev('@djjeck, tiri il dado e fai 5!', '/usa dado', { t });
    const wait = (t: number, d: string): BuildEvent =>
      ev(`@djjeck, un dado deve raffreddarsi ancora per ${d} prima di poterlo usare.`, null, { t });
    const { wiki } = runBuild([
      inv,
      use(10),
      wait(70, '55 secondi'),
      wait(80, '40 secondi'),
      use(1000),
      wait(1030, '1 minuto e 28 secondi'),
    ]);
    // 70 - 10 + 55 = 115, at most 115 + 1 + 90 = 206; the second refusal is the same cycle;
    // 1030 - 1000 + 88 = 118, a quick refusal (30 s < 88 s left): a 2-minute cooldown.
    expect(wiki.items['un dado']?.use?.cooldown).toStrictEqual({
      seconds: 120,
      min: 88,
      max: 206,
      observations: 2,
    });
  });

  it('cooldown_needs_the_same_player_and_no_unknown_use_between', () => {
    const inv = ev(T.inventory([['un dado', 'C', 1, true]]), '/inventario', { t: 0 });
    const { wiki } = runBuild([
      inv,
      ev('@djjeck, tiri il dado e fai 5!', '/usa dado', { t: 10 }),
      ev('@luigi, un dado deve raffreddarsi ancora per 60 secondi prima di poterlo usare.', null, {
        t: 70,
        dm: false,
        chat: 'Gruppo',
      }),
      ev('@djjeck, tiri il dado e fai 2!', '/usa dado', { t: 200 }),
      ev('@djjeck, qualcosa di mai visto', '/usa boh', { t: 210 }), // an unresolved use: the last use may be another one
      ev('@djjeck, un dado deve raffreddarsi ancora per 60 secondi prima di poterlo usare.', null, {
        t: 260,
      }),
    ]);
    expect(wiki.items['un dado']?.use).not.toHaveProperty('cooldown');
  });

  it('cooldown_from_esamina_and_disagreeing_observations', () => {
    const inv = ev(T.inventory([['un dado', 'C', 1, true]]), '/inventario', { t: 0 });
    const use = (t: number): BuildEvent => ev('@djjeck, tiri il dado e fai 5!', '/usa dado', { t });
    const esamina = (t: number, d: string): BuildEvent =>
      ev(
        `@djjeck un dado [C] [usabile] al momento non ti serve in nessuna ricetta.\nNe hai 1.\nRaffreddamento: ${d}`,
        '/esamina dado',
        { t }
      );
    const { wiki, kb } = runBuild([
      inv,
      use(10),
      esamina(20, '1 ore e 50 minuti'),
      use(100000),
      esamina(100010, '49 minuti e 0 secondi'),
    ]);
    // 6600 s left 10 s after a use, then 2940 s left 10 s after another: the bounds contradict each other.
    expect(wiki.items['un dado']?.use?.cooldown).toStrictEqual({
      min: 6600,
      max: null,
      observations: 2,
    });
    expect(kb.report.has('cooldown_conflict')).toBe(true);
  });

  it('cooldown_rounding', () => {
    // Raw estimates fall short of the nominal value by up to the precision of the remaining time plus about a minute.
    const cd = (raws: readonly (readonly [number, string])[]) => {
      const events: BuildEvent[] = [
        ev(T.inventory([['un dado', 'C', 1, true]]), '/inventario', { t: 0 }),
      ];
      raws.forEach(([elapsed, left], i) => {
        const t = 1000000 * (i + 1);
        events.push(ev('@djjeck, tiri il dado e fai 5!', '/usa dado', { t }));
        events.push(
          ev(
            `@djjeck, un dado deve raffreddarsi ancora per ${left} prima di poterlo usare.`,
            null,
            { t: t + elapsed }
          )
        );
      });
      return runBuild(events).wiki.items['un dado']?.use?.cooldown;
    };
    expect(
      cd([
        [10, '4 minuti e 31 secondi'],
        [50, '3 minuti e 20 secondi'],
        [100, '2 minuti e 24 secondi'],
        [2, '4 minuti e 50 secondi'],
      ])
    ).toStrictEqual({ seconds: 300, min: 290, max: 335, observations: 4 }); // 281, 250, 244, 292 -> 5 minutes
    expect(
      cd([
        [100, '23 ore e 58 minuti'],
        [30, '23 ore e 59 minuti'],
      ])
    ).toStrictEqual({ seconds: 86400, min: 86340, max: 86520, observations: 2 });
    expect(cd([[20, '1 giorno e 23 ore']])).toStrictEqual({
      seconds: 172800,
      min: 169200,
      max: 172910,
      observations: 1,
    }); // hour precision
    expect(
      cd([
        [20, '25 secondi'],
        [10, '34 secondi'],
      ])
    ).toStrictEqual({ seconds: 45, min: 34, max: 135, observations: 2 }); // under a minute: seconds
  });
});

describe('channel cards', () => {
  it('a_card_alone_makes_the_recipe_and_its_items', () => {
    const { wiki } = runBuild([card(TORRE_CARD, 0)]);
    const r = wiki.recipes['Torre alta'];
    expect(r).toMatchObject({
      level: 2,
      ingredients: { 'una torre': 1, 'una trave': 2 },
      ingredients_source: 'channel',
      output: 'una torre alta',
      craft_text: 'e sovrapponi le travi alla torre,\nche si allunga verso il cielo.',
      channel: {
        name: CITTADELLA,
        fields: ['level', 'ingredients', 'output'],
        notes: ['Torre alta è una ricetta di prova.'],
      },
    });
    expect(wiki.items['una torre alta']).toMatchObject({
      rarity: 'L2',
      usable: true,
      made_by: ['Torre alta'],
      sources: ['recipe'],
      gives_title: true,
      title: 'il costruttore',
    });
    expect(wiki.items['una trave']?.used_in).toStrictEqual(['Torre alta']);
  });

  it('what_the_bot_said_later_wins_and_leaves_the_card_s_fields', () => {
    const { wiki } = runBuild([
      card(TORRE_CARD, 0),
      ev(T.recipeList([['Torre alta', 3, 1]]), '/ricetta', { t: 10 }),
      ev(
        T.craft(
          [
            ['una torre', 'L1', 1],
            ['una trave', 'N', 3],
          ],
          'una torre altissima'
        ),
        '/ricetta torre alta',
        { t: 20 }
      ),
    ]);
    const r = wiki.recipes['Torre alta'];
    expect([r?.level, r?.ingredients, r?.output, r?.channel?.fields]).toStrictEqual([
      3,
      { 'una torre': 1, 'una trave': 3 },
      'una torre altissima',
      [],
    ]);
  });

  it('what_the_bot_said_before_gives_way_to_the_card', () => {
    const { wiki } = runBuild([
      ev(
        T.detail('Torre alta', [['una trave', 'N', 1]], [['una torre', 'L1', 1]]),
        '/ricetta torre alta',
        {
          t: 0,
        }
      ),
      card(TORRE_CARD, 10),
    ]);
    expect(wiki.recipes['Torre alta']?.ingredients_source).toBe('channel');
  });

  it('a_card_takes_the_bot_s_spelling_of_a_name', () => {
    const { wiki } = runBuild([
      ev(T.recipeList([['Torre alta', 2, 1]]), '/ricetta', { t: 0 }),
      ev(T.inventory([['una trave', 'N', 1]]), '/inventario', { t: 1 }),
      card(
        TORRE_CARD.replace('RICETTA: Torre alta', 'RICETTA: Torre Alta').replace(
          '📌 una trave [N] x2',
          '📌 una trave [N] x2'
        ),
        10
      ),
    ]);
    expect(Object.keys(wiki.recipes)).toStrictEqual(['Torre alta']);
    expect(Object.keys(wiki.items).filter((n) => n.includes('trave'))).toStrictEqual(['una trave']);
  });
});

describe('recipe cards named otherwise', () => {
  const OTHER = TORRE_CARD.replace('RICETTA: Torre alta', 'RICETTA: Torre alta di pietra');

  it('a_card_with_the_ingredients_of_a_recipe_of_the_bot_describes_it', () => {
    const { wiki } = runBuild([
      ev(
        T.detail('Torre alta', [['una trave', 'N', 2]], [['una torre', 'L1', 1]]),
        '/ricetta torre alta',
        { t: 0 }
      ),
      card(OTHER, 10),
    ]);
    expect(Object.keys(wiki.recipes)).toStrictEqual(['Torre alta']);
    expect(wiki.recipes['Torre alta']?.channel?.name).toBeDefined();
  });

  it('a_craft_named_by_its_command_counts_too_and_stays_named', () => {
    const { wiki } = runBuild([
      ev(T.recipeList([['Torre alta', 2, 0]]), '/ricetta', { t: 0 }),
      ev(
        T.craft(
          [
            ['una torre', 'L1', 1],
            ['una trave', 'N', 2],
          ],
          'una torre alta'
        ),
        '/ricetta torre alta',
        { t: 5 }
      ),
      card(OTHER, 10),
    ]);
    expect(Object.keys(wiki.recipes)).toStrictEqual(['Torre alta']);
    expect(wiki.items['una torre alta']?.made_by).toStrictEqual(['Torre alta']);
  });

  it('a_card_matching_two_recipes_keeps_its_own_name', () => {
    const both = [
      ['una trave', 'N', 2],
      ['una torre', 'L1', 1],
    ] as const;
    const { wiki } = runBuild([
      ev(T.detail('Torre alta', both, []), '/ricetta torre alta', { t: 0 }),
      ev(T.detail('Torre', both, []), '/ricetta torre', { t: 1 }),
      card(OTHER, 10),
    ]);
    expect(Object.keys(wiki.recipes).sort()).toStrictEqual([
      'Torre',
      'Torre alta',
      'Torre alta di pietra',
    ]);
  });
});

describe('place cards', () => {
  const CRIPTE = 'le cripte del monastero 👻';

  it('a_card_gives_the_place_its_items_route_and_requirements', () => {
    const { wiki } = runBuild([card(CRIPTE_CARD, 0, ATLANTE)]);
    expect(wiki.locations[CRIPTE]).toMatchObject({
      requires_item: true,
      required_items: ['una lanterna cieca'],
      sight_items: ['un rampino di ferro'],
      secret: true,
      exclusive_items: ['un paio di mollette', "una ghianda d'oro"],
      channel: { name: ATLANTE, fields: ['items', 'route', 'access', 'sight', 'secret'] },
    });
    expect(wiki.locations['il villaggio di Borgoverde 🏡']?.exits).toStrictEqual([
      'il bosco nebbioso di Valtorbo 🌲',
    ]);
    expect(wiki.items["una ghianda d'oro"]).toMatchObject({
      exclusive: true,
      locations: [CRIPTE],
      sources: ['adventure'],
    });
  });

  it('a_card_names_a_place_as_the_bot_does', () => {
    const { wiki } = runBuild([
      ev(
        T.where('nel bosco nebbioso di Valtorbo 🌲', ['nelle cripte del monastero 👻']),
        '/viaggio',
        {
          t: 0,
        }
      ),
      card(CRIPTE_CARD.replace('LUOGO: nelle cripte', 'LUOGO: le Cripte'), 10, ATLANTE),
    ]);
    expect(Object.keys(wiki.locations).filter((n) => /cripte/iu.test(n))).toStrictEqual([CRIPTE]);
  });
});

describe('item cards', () => {
  const BAULE = 'un baule di ebano 📦';

  it('a_card_gives_the_item_its_texts_and_a_dated_rarity', () => {
    const { wiki } = runBuild([card(BAULE_CARD, 0, GRIMORIO)]);
    expect(wiki.items[BAULE]).toMatchObject({
      rarity: 'S',
      usable: true,
      channel: {
        name: GRIMORIO,
        fields: ['rarity'],
        obtain: ['avventurandosi'],
        consumed: false,
        cooldown: 86400,
      },
    });
  });

  it('the_bot_s_later_rarity_prevails', () => {
    const { wiki } = runBuild([
      card(BAULE_CARD, 0, GRIMORIO),
      ev(T.info(BAULE, 'R', { count: 1, usable: true }), '/esamina baule', { t: 10 }),
    ]);
    expect([wiki.items[BAULE]?.rarity, wiki.items[BAULE]?.channel?.fields]).toStrictEqual([
      'R',
      [],
    ]);
  });

  it('event_cards_are_the_wiki_s_trivia', () => {
    const { wiki } = runBuild([card(EVENT_CARD, 0, GRIMORIO)]);
    expect(wiki.trivia).toMatchObject([{ channel: GRIMORIO, title: 'La gara delle ghiande 🌰' }]);
  });
});
