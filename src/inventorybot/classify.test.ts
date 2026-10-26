/** classify.ts: what each bot reply is read as (docs/bot-protocol.md). */
import { describe, expect, it } from 'vitest';
import { BOT, Chat, tgDate } from '#test/helpers.ts';
import { byType, runExtract } from '#test/interpret.ts';
import * as T from '#test/texts.ts';
import { classify, itemFromLine, itemLines } from './classify.ts';
import { compatibleCommands, playerOf } from './dialect.ts';
import { type ItemLine } from './types.ts';

function item(name: string, rarity: string | null = null, usable = false, qty = 1): ItemLine {
  return { name, rarity, usable, qty };
}

const DROP =
  '@djjeck, ti tuffi nel lago incantato di Mirtovalle, semisommerso nel fondale ' +
  'scorgi un torroncino al pistacchio [C]!';
const ITEM_INFO =
  '@djjeck una sedia pieghevole [C] al momento ti serve nelle ricette: Giocare a scopa.\n' +
  "Ne hai 3.\nE' un oggetto trovabile in avventura.";
const DETAIL =
  '@djjeck, per fare la ricetta Pratica cestina ti manca:\n- un nastro da pacchi [C] x1\n' +
  "Mentre hai gia':\n- un paio di mollette [N] x1";
const CRAFT =
  '@djjeck, prendi in mano:\n- un biscotto Lunetta [C] x1\n- un biscotto Stellina [C] x1\n' +
  'e avvicini i due biscotti...\nOttieni: un vortice croccante di energia biscottosa!';
const RECIPE_LIST =
  '@djjeck, ecco le ricette a tua disposizione:\n- Merenda veloce L1 [*]\n' +
  '- Pizza della nonna L1 [manca 1]\nScrivi /ricetta <nome ricetta> per vedere...';
const INVENTORY = "@djjeck, possiedi:\n- una moneta d'oro [X] x1\n- un fiorino ƒ [X] [usabile] x3";
const TRAVEL =
  '@djjeck, ti metti in cammino e dopo un lunghissimo viaggio arrivi nella valle ventosa 🏞\n\n' +
  'Puoi andare verso:\n - nel bosco nebbioso di Valtorbo 🌲\n - ai piedi del monte Grevolo ⛰';
const FAQ =
  'Ciao, sono InventoryBot! Ti aiuto a collezionare oggetti.\n\nLegenda oggetti\n' +
  'C = comune, N = non comune, R = raro, S = super raro, U = unico (ne esiste uno solo), ' +
  'Ln = ottenibile da ricette. X = oggetti speciali :)\n' +
  'Il + indica un oggetto che si trova in un solo luogo.\n\nLivelli\n\n' +
  'Ogni ricetta di livello N richiede il livello N.\n\nBuon divertimento!';

/** A classified event as a plain record, for field access in assertions. */
const fields = (text: string, query: string | null): Record<string, unknown> =>
  classify(text, query) as unknown as Record<string, unknown>;

describe('item line', () => {
  it('typical_line', () => {
    expect(itemFromLine('- un tubetto di colla verde [N] [usabile] x3')).toStrictEqual(
      item('un tubetto di colla verde', 'N', true, 3)
    );
  });

  it('no_space_after_dash', () => {
    expect(itemFromLine("-una moneta d'oro [X] x2")).toStrictEqual(
      item("una moneta d'oro", 'X', false, 2)
    );
  });

  it('leading_indent', () => {
    expect(itemFromLine('  - un sasso [C]')).toStrictEqual(item('un sasso', 'C'));
  });

  it('line_without_a_name_is_no_item', () => {
    expect(itemFromLine('- ')).toBeNull();
  });

  it('quantity_missing_defaults_to_one', () => {
    expect(itemFromLine('- un sasso [C]')?.qty).toBe(1);
  });

  it('rarity_variants', () => {
    for (const r of ['C', 'C+', 'N+', 'R+', 'L1', 'L11', 'X', 'U', 'M', 'S']) {
      expect(itemFromLine(`- un oggetto [${r}] x2`), r).toStrictEqual(
        item('un oggetto', r, false, 2)
      );
    }
  });

  it('no_rarity', () => {
    expect(itemFromLine('- un oggetto misterioso x4')).toStrictEqual(
      item('un oggetto misterioso', null, false, 4)
    );
  });

  it('symbol_in_name', () => {
    expect(itemFromLine('- un fiorino ƒ [X] [usabile] x3')).toStrictEqual(
      item('un fiorino ƒ', 'X', true, 3)
    );
  });

  it('not_an_item_line', () => {
    expect(itemFromLine("Mentre hai gia':")).toBeNull();
    expect(itemLines(['testo', '- un sasso [C]'])).toStrictEqual([item('un sasso', 'C')]);
  });
});

describe('recipe list', () => {
  it('ready_and_missing', () => {
    expect(classify(RECIPE_LIST, '/ricetta')).toStrictEqual({
      type: 'recipe_list',
      truncated: false,
      recipes: [
        { name: 'Merenda veloce', level: 1, ready: true, missing: 0 },
        { name: 'Pizza della nonna', level: 1, ready: false, missing: 1 },
      ],
    });
  });

  it('multi_digit_level_and_missing', () => {
    const e = classify(
      '@djjeck, ecco le ricette a tua disposizione:\n- Torre L2 [*]\n- Gran Torre L11 [manca 3]',
      null
    );
    expect(e.type).toBe('recipe_list');
    if (e.type !== 'recipe_list') return;
    expect(e.recipes.map((r) => [r.name, r.level, r.ready, r.missing])).toStrictEqual([
      ['Torre', 2, true, 0],
      ['Gran Torre', 11, false, 3],
    ]);
  });
});

describe('recipe detail', () => {
  it('esamina_form_with_la_ricetta', () => {
    expect(classify(DETAIL, '/esamina cestina')).toStrictEqual({
      type: 'recipe_detail',
      recipe: 'Pratica cestina',
      missing: [item('un nastro da pacchi', 'C')],
      have: [item('un paio di mollette', 'N')],
    });
  });

  it('ricetta_form_without_la_ricetta', () => {
    const e = fields(
      '@djjeck, per fare Pratica cestina ti manca:\n- un nastro da pacchi [C] x2\n' +
        "Mentre hai gia':\n- un paio di mollette [N] x1\n- un nastro da pacchi [C] x1",
      '/ricetta cestina'
    );
    expect(e['recipe']).toBe('Pratica cestina');
    expect(e['missing']).toStrictEqual([item('un nastro da pacchi', 'C', false, 2)]);
    expect(e['have']).toHaveLength(2);
  });

  it('empty_missing_list', () => {
    const e = fields(
      "@djjeck, per fare Pratica cestina ti manca:\nMentre hai gia':\n- un paio di mollette [N] x1",
      null
    );
    expect(e['missing']).toStrictEqual([]);
    expect(e['have']).toStrictEqual([item('un paio di mollette', 'N')]);
  });

  it('no_have_section', () => {
    const e = fields(
      '@djjeck, per fare Pratica cestina ti manca:\n- un paio di mollette [N] x1',
      null
    );
    expect([e['missing'], e['have']]).toStrictEqual([[item('un paio di mollette', 'N')], []]);
  });

  it('have_section_stops_at_text', () => {
    const e = fields(DETAIL + '\nScrivi /ricetta per eseguirla\n- non un oggetto', null);
    expect(e['have']).toStrictEqual([item('un paio di mollette', 'N')]);
  });
});

describe('craft', () => {
  it('typical_craft', () => {
    expect(classify(CRAFT, '/ricetta biscottosa')).toStrictEqual({
      type: 'craft',
      ingredients: [item('un biscotto Lunetta', 'C'), item('un biscotto Stellina', 'C')],
      output: 'un vortice croccante di energia biscottosa',
      flavor: 'e avvicini i due biscotti...',
    });
  });

  it('level_up_not_part_of_output', () => {
    const e = fields(
      CRAFT +
        "\nHai raggiunto il livello 5! Per te 10x una moneta d'oro e un bel " +
        'pacchettino regalo 🎁 in omaggio!',
      null
    );
    expect(e['output']).toBe('un vortice croccante di energia biscottosa');
    expect(e['level_up']).toBe(5);
    expect(e['level_up_text']).toBe(
      "Per te 10x una moneta d'oro e un bel pacchettino regalo 🎁 in omaggio!"
    );
  });

  it('output_without_exclamation', () => {
    const e = fields(CRAFT.replace(/!+$/u, ''), null);
    expect(e['output']).toBe('un vortice croccante di energia biscottosa');
    expect(e).not.toHaveProperty('level_up');
  });

  it('no_output', () => {
    const e = fields('@djjeck, prendi in mano:\n- un sasso [C] x2\nma non succede niente.', null);
    expect(e['output']).toBeNull();
    expect(e['flavor']).toBe('ma non succede niente.');
    expect(e['ingredients']).toStrictEqual([item('un sasso', 'C', false, 2)]);
  });
});

describe('item info', () => {
  it('used_in_count_adventure', () => {
    expect(classify(ITEM_INFO, '/esamina sedia')).toStrictEqual({
      type: 'item_info',
      item: 'una sedia pieghevole',
      rarity: 'C',
      usable: false,
      used_in_raw: 'Giocare a scopa',
      count: 3,
      source: 'adventure',
      from_recipe: null,
    });
  });

  it('no_recipe_none_owned_special', () => {
    const e = fields(
      "@djjeck, una moneta d'oro [X] [usabile] al momento non ti serve in nessuna ricetta.\n" +
        "Non ne hai neanche uno.\nE' un oggetto speciale.",
      null
    );
    expect([e['item'], e['usable'], e['used_in_raw'], e['count'], e['source']]).toStrictEqual([
      "una moneta d'oro",
      true,
      null,
      0,
      'special',
    ]);
  });

  it('several_recipes_raw', () => {
    const e = fields(
      '@djjeck un sasso [C] al momento ti serve nelle ricette: Muro, Sale, pepe e olio, Torre.',
      null
    );
    expect(e['used_in_raw']).toBe('Muro, Sale, pepe e olio, Torre');
  });

  it('known_recipe_source', () => {
    const e = fields(
      '@djjeck un vortice [L1] al momento non ti serve in nessuna ricetta.\nNe hai 1.\n' +
        'E\' un oggetto che si ottiene con la ricetta "Fonduta cosmica".',
      null
    );
    expect([e['source'], e['from_recipe'], e['rarity']]).toStrictEqual([
      'recipe',
      'Fonduta cosmica',
      'L1',
    ]);
  });

  it('unknown_recipe_source', () => {
    const e = fields(
      '@djjeck un vortice [L1] al momento non ti serve in nessuna ricetta.\n' +
        "E' un oggetto che si ottiene con una ricetta.",
      null
    );
    expect([e['source'], e['from_recipe'], e['count']]).toStrictEqual(['recipe', null, null]);
  });

  it('cooldown_line', () => {
    const e = fields(
      '@djjeck un dado a dodici facce [C] al momento non ti serve in nessuna ricetta.\nNe hai 1.\n' +
        'Raffreddamento: 2 ore',
      null
    );
    expect(e['cooldown']).toBe('2 ore');
  });

  it('without_comma_after_username', () => {
    expect(fields(ITEM_INFO.replace('@djjeck ', '@djjeck, '), null)['item']).toBe(
      'una sedia pieghevole'
    );
  });
});

describe('inventory', () => {
  it('full_inventory', () => {
    expect(classify(INVENTORY, '/inventario')).toStrictEqual({
      type: 'inventory',
      filtered: false,
      truncated: false,
      items: [item("una moneta d'oro", 'X'), item('un fiorino ƒ', 'X', true, 3)],
    });
  });

  it('unmatched_query_not_filtered', () => {
    expect(fields(INVENTORY, null)['filtered']).toBe(false);
  });

  it('filtered', () => {
    expect(fields(INVENTORY, '/inventario oro')['filtered']).toBe(true);
  });

  it('short_form_i', () => {
    expect([
      fields(INVENTORY, '/i')['filtered'],
      fields(INVENTORY, '/i oro')['filtered'],
    ]).toStrictEqual([false, true]);
    expect([...(compatibleCommands(INVENTORY) ?? [])]).toContain('/i');
  });

  it('a_player_made_name_spans_lines_up_to_its_rarity', () => {
    const e = fields(
      '@djjeck, possiedi:\n' +
        '- un sasso [C] x2\n' +
        '- una cornice con dentro\n' +
        '- 🖼\n' +
        'un tappetino con scritto Benvenuti [S] x1\n' +
        '- un grembiule da cuoco [L2]',
      '/inventario'
    );
    expect(e['items']).toStrictEqual([
      item('un sasso', 'C', false, 2),
      item('una cornice con dentro\n- 🖼\nun tappetino con scritto Benvenuti', 'S'),
      item('un grembiule da cuoco', 'L2'),
    ]);
  });

  it('an_unfinished_name_at_the_end_is_dropped', () => {
    const e = fields(
      '@djjeck, possiedi:\n- un sasso [C] x2\n- una cornice con dentro',
      '/inventario'
    );
    expect(e['items']).toStrictEqual([item('un sasso', 'C', false, 2)]);
  });

  it('truncated', () => {
    const e = fields(INVENTORY + '\ne altre robe che non ci stanno..', '/inventario');
    expect(e['truncated']).toBe(true);
    expect(e['items']).toHaveLength(2);
  });

  it('collezioni_lists_by_quantity', () => {
    const t = T.inventoryByQuantity([
      ["una moneta d'oro", 'X', 5],
      ['un fiorino ƒ', 'X', 3, true],
    ]);
    expect(classify(t, '/collezioni')).toStrictEqual({
      type: 'inventory',
      filtered: false,
      truncated: false,
      items: [item("una moneta d'oro", 'X', false, 5), item('un fiorino ƒ', 'X', true, 3)],
    });
    expect(fields(T.inventoryByQuantity([], 'djjeck', true), '/collezioni')['truncated']).toBe(
      true
    );
  });

  it('inv2_page_is_truncated_unless_it_is_the_only_one', () => {
    const page = (n: number, of: number): Record<string, unknown> =>
      fields(T.inventoryPage([['un sasso', 'C', 2]], n, of), '/inv2');
    expect(page(1, 1)).toStrictEqual({
      type: 'inventory',
      filtered: false,
      truncated: false,
      items: [item('un sasso', 'C', false, 2)],
    });
    expect([page(1, 3)['truncated'], page(3, 3)['truncated']]).toStrictEqual([true, true]);
  });

  it('collezioni_and_inv2_pair_with_their_commands', () => {
    const replies = [T.inventoryByQuantity([['un sasso', 'C', 2]]), T.inventoryPage([], 1, 1)];
    for (const t of replies)
      expect([...(compatibleCommands(t) ?? [])]).toStrictEqual(
        expect.arrayContaining(['/inventario', '/collezioni', '/inv2'])
      );
  });
});

describe('travel', () => {
  it('standard_arrival', () => {
    expect(classify(TRAVEL, '/viaggio valle')).toStrictEqual({
      type: 'travel',
      location: 'la valle ventosa 🏞',
      exits: ['il bosco nebbioso di Valtorbo 🌲', 'i piedi del monte Grevolo ⛰'],
      narrative: null,
      written: {
        'la valle ventosa 🏞': 'nella valle ventosa 🏞',
        'il bosco nebbioso di Valtorbo 🌲': 'nel bosco nebbioso di Valtorbo 🌲',
        'i piedi del monte Grevolo ⛰': 'ai piedi del monte Grevolo ⛰',
      },
    });
  });

  it('arrival_with_unlock_text', () => {
    const e = fields(
      "@djjeck, inghiotti l'Respirella e ti tuffi tra le onde... arrivi: sul banco corallino 🐠\n\n" +
        'Puoi andare verso:\n - nella valle ventosa 🏞',
      null
    );
    expect([e['type'], e['location'], e['narrative']]).toStrictEqual([
      'travel',
      'il banco corallino 🐠',
      "inghiotti l'Respirella e ti tuffi tra le onde...",
    ]);
  });

  it('arrival_with_unlock_text_and_arrivi_without_colon_leaves_the_place_to_phase_5', () => {
    const e = fields(
      '@djjeck, ti infili la tua muta da palombaro e ti tuffi! Dopo una bella nuotata, arrivi esausto nella baia di Scogliola 🦀\n\n' +
        'Puoi andare verso:\n - nella valle ventosa 🏞',
      '/viaggio baia'
    );
    expect([e['type'], e['location'], e['narrative']]).toStrictEqual([
      'travel',
      null,
      'ti infili la tua muta da palombaro e ti tuffi! Dopo una bella nuotata, arrivi esausto nella baia di Scogliola 🦀',
    ]);
  });

  it('blocked', () => {
    expect(
      classify('@djjeck non puoi andare: sul banco corallino 🐠.. Forse ti manca qualcosa!', null)
    ).toStrictEqual({
      type: 'travel_blocked',
      location: 'il banco corallino 🐠',
      written: { 'il banco corallino 🐠': 'sul banco corallino 🐠' },
    });
  });

  it('status', () => {
    expect(
      classify(
        '@djjeck, ti trovi: nel bosco nebbioso di Valtorbo 🌲\nPuoi andare verso:\n' +
          ' - nella valle ventosa 🏞',
        null
      )
    ).toStrictEqual({
      type: 'location',
      location: 'il bosco nebbioso di Valtorbo 🌲',
      exits: ['la valle ventosa 🏞'],
      written: {
        'il bosco nebbioso di Valtorbo 🌲': 'nel bosco nebbioso di Valtorbo 🌲',
        'la valle ventosa 🏞': 'nella valle ventosa 🏞',
      },
    });
  });
});

describe('travel arrivals without a parsable place', () => {
  const RACCHETTA =
    '@mario_r, guidato dalla tua bussola fatata attraversi il canneto e finalmente ti trovi nella palude sussurrante 🌾\n\n' +
    'Puoi andare verso:\n - nel bosco nebbioso di Valtorbo 🌲';
  const SNORKELING =
    '@mario_r, ti infili la tua muta da palombaro e ti tuffi! Dopo una bella nuotata, arrivi esausto nella baia di Scogliola 🦀';

  it('item_narrated_arrival_with_exits', () => {
    expect(classify(RACCHETTA, '/viaggio palude')).toStrictEqual({
      type: 'travel',
      location: null,
      exits: ['il bosco nebbioso di Valtorbo 🌲'],
      narrative:
        'guidato dalla tua bussola fatata attraversi il canneto e finalmente ti trovi nella palude sussurrante 🌾',
      // The place reached is written too, once phase 5 has found it.
      written: { 'il bosco nebbioso di Valtorbo 🌲': 'nel bosco nebbioso di Valtorbo 🌲' },
    });
    expect(classify(RACCHETTA, null).type).toBe('travel'); // the exits are enough
  });

  it('old_narrated_arrival_without_exits_needs_its_viaggio_command', () => {
    expect(classify(SNORKELING, '/viaggio baia')).toStrictEqual({
      type: 'travel',
      location: null,
      exits: [],
      narrative:
        'ti infili la tua muta da palombaro e ti tuffi! Dopo una bella nuotata, arrivi esausto nella baia di Scogliola 🦀',
      written: {},
    });
    expect([
      classify(SNORKELING, null).type,
      classify(SNORKELING, '/viaggio').type,
      classify('qualcosa di strano', '/viaggio baia').type,
    ]).toStrictEqual(['unknown', 'unknown', 'unknown']);
  });

  it('old_arrival_with_arrivi_colon_names_its_place', () => {
    expect(
      classify(
        '@mario_r, inghiotti un boccone di Respirella e ti tuffi.. Dopo numerose bracciate arrivi: sul banco corallino 🐠',
        '/viaggio banco'
      )
    ).toStrictEqual({
      type: 'travel',
      location: 'il banco corallino 🐠',
      exits: [],
      narrative: 'inghiotti un boccone di Respirella e ti tuffi.. Dopo numerose bracciate',
      written: { 'il banco corallino 🐠': 'sul banco corallino 🐠' },
    });
  });

  it('old_standard_arrival_without_exits', () => {
    expect(
      classify(
        '@mario_r, ti metti in cammino e dopo un lunghissimo viaggio arrivi sulla scogliera bianca 🏖',
        null
      )
    ).toStrictEqual({
      type: 'travel',
      location: 'la scogliera bianca 🏖',
      exits: [],
      narrative: null,
      written: { 'la scogliera bianca 🏖': 'sulla scogliera bianca 🏖' },
    });
  });
});

describe('replies naming the item used', () => {
  it('equip_names_the_pakkomon_and_the_scanner_itself', () => {
    expect(
      classify('@djjeck, equipaggi il tuo Brumolo 👻 con una caps rossa [C].', '/usa brum # caps')
    ).toStrictEqual({
      type: 'use',
      text: 'equipaggi il tuo Brumolo 👻 con una caps rossa [C].',
      items: [],
      named: 'un Pakkomon di nome Brumolo 👻',
      takes: ['una caps rossa'],
      pakkomon_use: 'equip',
      pakkomon: ['Brumolo 👻'],
    });
    expect(
      classify(
        '@djjeck, esamini i tuoi pakkomon con lo scanner:\n - Brumolo 👻: pronto',
        '/usa sca'
      )
    ).toMatchObject({ type: 'use', items: [], named: 'scanner' });
  });
});

describe('travel requirement notice', () => {
  it('item_needed_to_pass_a_place', () => {
    const t =
      'una lanterna cieca ti serve per passare nelle cripte del monastero 👻 sulla via per tornare al villaggio.';
    expect(classify(t, null)).toStrictEqual({
      type: 'travel_requirement',
      item: 'una lanterna cieca',
      location: 'le cripte del monastero 👻',
      written: { 'le cripte del monastero 👻': 'nelle cripte del monastero 👻' },
    });
    expect([...(compatibleCommands(t) ?? ['any'])]).toStrictEqual([]); // a side notice: it answers no command
  });
});

describe('stats unique items', () => {
  it('unique_item_lines_of_stats', () => {
    const t =
      "Avventuriero @lucia_b\n- Livello: 11\n- Monete: 23613 (6° posto)\n- Oggetti unici: \n   - un gigantesco forziere da 3 tonnellate di monete d'oro 🏷 [U]\n   - un cannocchiale dorato [U] [usabile]";
    const e = classify(t, '/stats lucia_b') as unknown as Record<string, unknown>;
    expect([e['type'], e['livello'], e['unique_items']]).toStrictEqual([
      'stats',
      '11',
      [
        {
          name: "un gigantesco forziere da 3 tonnellate di monete d'oro 🏷",
          rarity: 'U',
          usable: false,
          qty: 1,
        },
        { name: 'un cannocchiale dorato', rarity: 'U', usable: true, qty: 1 },
      ],
    ]);
  });

  it('a_multi_line_favourite_item_reads_like_fields_up_to_the_ranked_ones', () => {
    const t = [
      'Avventuriero @lucia_b',
      '- Livello: 3',
      '- Luogo: sul banco corallino 🐠',
      '- Oggetto preferito: 1x una cornice con dentro',
      '- Luogo: nella valle ventosa 🏞',
      '- Oggetti unici:',
      '- Avventure: 12 (3° posto) Oggi: 1',
      '- Monete: 0 (9° posto)',
      '- Oggetti unici:',
      '   - un cannocchiale dorato [U] [usabile]',
    ].join('\n');
    const e = classify(t, '/stats lucia_b') as unknown as Record<string, unknown>;
    expect([e['luogo'], e['oggetto preferito'], e['avventure'], e['unique_items']]).toStrictEqual([
      'il banco corallino 🐠',
      '1x una cornice con dentro\n- Luogo: nella valle ventosa 🏞\n- Oggetti unici:',
      '12 (3° posto) Oggi: 1',
      [{ name: 'un cannocchiale dorato', rarity: 'U', usable: true, qty: 1 }],
    ]);
  });

  it('stats_without_the_unique_items_line_have_no_list', () => {
    const empty = classify(
      'Avventuriero @lucia_b\n- Livello: 3\n- Oggetti unici:',
      null
    ) as unknown as Record<string, unknown>;
    const none = classify('Avventuriero @lucia_b\n- Livello: 3', null) as unknown as Record<
      string,
      unknown
    >;
    expect([empty['unique_items'], 'unique_items' in none]).toStrictEqual([[], false]);
  });
});

describe('drop', () => {
  it('typical_drop', () => {
    expect(classify(DROP, '/avventura')).toStrictEqual({
      type: 'drop',
      kind: 'adventure',
      rarity: 'C',
      usable: false,
      raw: 'ti tuffi nel lago incantato di Mirtovalle, semisommerso nel fondale scorgi un torroncino al pistacchio',
    });
  });

  it('a_player_made_item_s_name_may_span_lines', () => {
    const e = fields(
      '@mario_r, nel bosco trovi una cornice con dentro\n- un sasso [S]!',
      '/avventura'
    );
    expect([e['type'], e['raw'], e['rarity']]).toStrictEqual([
      'drop',
      'nel bosco trovi una cornice con dentro\n- un sasso',
      'S',
    ]);
  });

  it('drop_without_exclamation', () => {
    const e = fields(DROP.slice(0, -1), null);
    expect([e['type'], e['rarity']]).toStrictEqual(['drop', 'C']);
    expect((e['raw'] as string).endsWith('un torroncino al pistacchio')).toBe(true);
  });

  it('usable_drop', () => {
    const e = fields('@djjeck, nel bosco trovi un dado a dodici facce [C] [usabile]!', null);
    expect([e['raw'], e['rarity'], e['usable']]).toStrictEqual([
      'nel bosco trovi un dado a dodici facce',
      'C',
      true,
    ]);
  });

  it('exclusive_rarity', () => {
    expect(fields("@djjeck, nel bosco trovi una ghianda d'oro [R+]!", null)['rarity']).toBe('R+');
  });

  it('multiline_is_not_a_drop', () => {
    expect(classify('@djjeck, nel bosco trovi:\nuna ghianda [C]!', null).type).toBe('unknown');
  });
});

describe('lucky, gift, give, show', () => {
  it('lucky', () => {
    expect(
      classify(
        '@djjeck, oggi è la tua avventura FORTUNATA del giorno! Hai vinto: un trifoglio di latta [R]!',
        null
      )
    ).toStrictEqual({
      type: 'drop',
      kind: 'lucky',
      item: 'un trifoglio di latta',
      rarity: 'R',
      usable: false,
    });
  });

  it('gift_dm', () => {
    expect(classify('[N] @gino_x ti ha dato 1x un mantello di velluto', null)).toStrictEqual({
      type: 'gift',
      from: 'gino_x',
      qty: 1,
      item: 'un mantello di velluto',
    });
  });

  it('gift_from_sua_maesta', () => {
    expect(classify('[N] Sua Maestà @msx80 ti ha dato 2x una corona di latta', null)).toStrictEqual(
      {
        type: 'gift',
        from: 'msx80',
        qty: 2,
        item: 'una corona di latta',
      }
    );
  });

  it('give_group', () => {
    expect(classify('@djjeck, dai 1x un bottone a @gino_x', '/dai')).toStrictEqual({
      type: 'give',
      to: 'gino_x',
      qty: 1,
      item: 'un bottone',
    });
  });

  it('give_to_the_admin_or_to_a_titled_receiver', () => {
    const to = (t: string): unknown => fields(t, '/dai')['to'];
    expect(to('@djjeck, dai 2x un bottone a Sua Maestà @msx80')).toBe('msx80');
    expect(to("@djjeck, dai 1x un bottone a @gino_x l'apprendista")).toBe('gino_x');
  });

  it('show', () => {
    expect(
      classify(
        '@djjeck, mostri orgogliosamente di possedere 3x un elegante cappello piumato [N]',
        null
      )
    ).toStrictEqual({
      type: 'show',
      qty: 3,
      item: 'un elegante cappello piumato',
      rarity: 'N',
      usable: false,
    });
  });

  it('show_usable', () => {
    const e = fields(
      '@djjeck, mostri orgogliosamente di possedere 1x un dado a dodici facce [C] [usabile]',
      null
    );
    expect([e['item'], e['usable']]).toStrictEqual(['un dado a dodici facce', true]);
  });
});

describe('faq', () => {
  it('faq_is_a_known_reply', () => {
    expect(classify(FAQ, '/faq')).toStrictEqual({ type: 'miss', reply: 'faq' });
    expect(compatibleCommands(FAQ)).toStrictEqual(new Set(['/faq', '/start', '/help']));
  });
});

describe('noise', () => {
  it('noise_with_command', () => {
    expect(classify('Sintassi: /dai <quantita> <oggetto> @utente', null)).toStrictEqual({
      type: 'miss',
      reply: 'dai_syntax',
      command: '/dai',
    });
    expect(fields("@x, Non esiste quell'utente", null)['command']).toBe('/dai');
    expect(compatibleCommands('Sintassi: /dai <quantita>')).toStrictEqual(new Set(['/dai']));
  });

  it('noise_without_command', () => {
    // Each known reply has a name; its producing commands constrain group pairing.
    expect(
      [
        '@djjeck, cosa vuoi esaminare?',
        "@djjeck, troppe ricette trovate, sii piu' preciso",
        '@djjeck, non hai niente del genere di usabile.',
        "@djjeck, non puoi usare quell'oggetto..",
        "@djjeck cervello non e' un utente e non hai oggetti del genere.",
        "@djjeck quello non e' ne un utente ne un oggetto in tuo possesso.",
        '@djjeck Troppo lungo vecchio...',
        '@djjeck Troppo corto vecchio...',
      ].map((t) => classify(t, null))
    ).toStrictEqual([
      { type: 'miss', reply: 'examine_what', command: '/esamina' },
      { type: 'miss', reply: 'recipe_ambiguous' }, // /ricetta or /esamina
      { type: 'miss', reply: 'use_not_owned', command: '/usa' },
      { type: 'miss', reply: 'use_not_usable', command: '/usa' },
      { type: 'miss', reply: 'use_target_unknown', command: '/usa' },
      { type: 'miss', reply: 'use_target_not_owned', command: '/usa' },
      { type: 'miss', reply: 'argument_length' },
      { type: 'miss', reply: 'argument_length' },
    ]);
    expect(
      classify('ciao @djjeck, per giocare con me devi prima registrarti!', null)
    ).toStrictEqual({ type: 'miss', reply: 'register_first' });
    expect(
      compatibleCommands('ciao @djjeck, per giocare con me devi prima registrarti!')
    ).toBeNull(); // any command
  });

  it('cooldown_and_unknown', () => {
    expect(classify('Troppo presto! Riprova tra 5 minuti', null)).toStrictEqual({
      type: 'cooldown',
    });
    expect(classify('Il bot sta dormendo', null)).toStrictEqual({ type: 'unknown' });
  });

  it('use_reply_classified_by_query', () => {
    expect(classify('@djjeck, tiri il dado e fai 5!', '/usa dado')).toStrictEqual({
      type: 'use',
      text: 'tiri il dado e fai 5!',
      items: [],
    });
    expect(
      fields("@djjeck, apri il baule e trovi:\n- una moneta d'oro [X] x2", '/usa chiave')['items']
    ).toStrictEqual([item("una moneta d'oro", 'X', false, 2)]);
    expect(classify('@djjeck, tiri il dado e fai 5!', null)).toStrictEqual({ type: 'unknown' });
  });
});

describe('known fixed-text replies', () => {
  const known = (t: string): [string | undefined, unknown, string[] | null] => {
    const e = classify(t, null) as unknown as Record<string, unknown>;
    const c = compatibleCommands(t);
    return [e['reply'] as string | undefined, e['command'], c === null ? null : [...c].sort()];
  };

  it('known_replies_have_a_name_and_their_commands', () => {
    expect(
      [
        'Non puoi :)',
        '@mario_r, in questo gruppo non sono consentite avventure, inventari e liste di ricette. Scrivimi in privato! :)',
        'Errore NumberFormatException For input string: "pippo"',
        'Errore NullPointerException null',
        'non esiste nessuno con quel nome..',
        "Non c'e' nessuna lotteria attiva",
        "IL FORTUNATO E': @lucia_b ! Evviva! Vince il fantastico Primo Premio della lotteria!",
        'PREMIO DI CONSOLAZIONE: @lucia_b vince un pacchettino di consolazione 🎁!',
        'APRE LA BIGLIETTERIA! PRENDETE UN BIGLIETTO CON /biglietto!',
        "LA BIGLIETTERIA E' CHIUSA!! NIENTE PIU' BIGLIETTI!!",
        "ABBIAMO 21 PARTECIPANTI! PRONTI ALL'ESTRAZIONE!",
        'RULLO DI TAMBURI!!!',
        "Mi spiace ma per evitare abusi non e' possibile cambiare username. Per tornare a giocare devi rimettere l'username vecchio_nome",
        'meglio non dare niente a @lucia_b, non ti sembra un tipo affidabile.',
        'sicuro che vuoi dare cose a @lucia_b? Meglio di no..',
        'la quantità deve essere un intero positivo, non fare il furbo.',
        "Ciao, il gioco si e' trasferito sul nuovo bot, @mario_r! Non temere, ritroverai il tuo inventario sul nuovo bot, il gioco resta invariato!",
        '[BAN] Sei stato bannato per: 72 ore. Motivazione: Usa un secondo account per rifornirsi di oggetti.',
        '⚠ Per favore risolvi il captcha per continuare. Hai 5 tentativi e 5 minuti. ⚠',
        '@mario_r, non hai la chiave giusta per aprire questo baule..',
        'troppi oggetti trovati con quel nome(dado)',
        'troppi luoghi trovati con quel nome(pia)',
        '@mario_r puoi usare solo i seguenti parametri: C, N, R, S, L, X, U, M.',
      ].map(known)
    ).toStrictEqual([
      ['restricted', undefined, null],
      [
        'group_restricted',
        undefined,
        ['/avventura', '/i', '/inventario', '/inventory', '/ricetta'],
      ],
      ['error', undefined, null],
      ['error', undefined, null],
      ['stats_unknown_user', '/stats', ['/stats']],
      ['lottery_none', '/biglietto', ['/biglietto']],
      ['lottery_winner', undefined, []],
      ['lottery_consolation', undefined, []],
      ['lottery_open', undefined, []],
      ['lottery_closed', undefined, []],
      ['lottery_count', undefined, []],
      ['lottery_drumroll', undefined, []],
      ['username_locked', undefined, null],
      ['dai_untrusted', '/dai', ['/dai']],
      ['dai_doubtful', '/dai', ['/dai']],
      ['dai_bad_quantity', '/dai', ['/dai']],
      ['game_moved', undefined, null],
      ['ban', undefined, []],
      ['captcha', undefined, null],
      ['use_wrong_key', '/usa', ['/usa']],
      ['item_ambiguous', undefined, ['/dai', '/mostra', '/usa']],
      ['place_ambiguous', '/viaggio', ['/viaggio']],
      ['inventory_bad_filter', '/inventario', ['/i', '/inventario', '/inventory']],
    ]);
  });

  it('dai_not_enough_keeps_the_count', () => {
    expect(
      classify('non ne hai abbastanza, ne possiedi solo 57.', '/dai @lucia_b 60 sasso')
    ).toStrictEqual({ type: 'miss', reply: 'dai_not_enough', command: '/dai', owned: 57 });
  });

  it('a_reply_matching_no_pattern_stays_unknown', () => {
    expect(
      [
        'Ok, puoi continuare! :)',
        'Errore di battitura',
        'Non puoi farlo',
        '@mario_r, cosa desideri?',
      ].map((t) => classify(t, null).type)
    ).toStrictEqual(['unknown', 'unknown', 'unknown', 'unknown']);
  });
});

describe('preferences and quests', () => {
  const known = (
    t: string,
    q: string | null = null
  ): [string, unknown, unknown, string[] | null] => {
    const e = classify(t, q) as unknown as Record<string, unknown>;
    const c = compatibleCommands(t);
    return [e['type'] as string, e['reply'], e['command'], c === null ? null : [...c].sort()];
  };

  it('preference_and_quest_replies_are_current_known_replies', () => {
    expect(
      [
        "@mario_r, sei veramente affezionato a un piccolo bonsai, e' di gran lunga il tuo oggetto preferito!",
        '@mario_r, nascondi la ricetta Arrivederci e grazie!',
        '@mario_r, smetti di nascondere la ricetta Spaventapasseri allegro',
        '@mario_r, stai nascondendo le seguenti ricette:\nnessuna',
        '@mario_r, stai nascondendo le seguenti ricette:\n - Orto in vaso\n - Spaventapasseri allegro',
        '@mario_r non hai nessuna quest al momento.',
        '@mario_r, non hai nessuna quest al momento.',
      ].map((t) => known(t))
    ).toStrictEqual([
      ['miss', 'favourite', '/preferito', ['/preferito']],
      ['miss', 'hide_recipe', '/nascondi', ['/nascondi']],
      ['miss', 'unhide_recipe', '/nascondi', ['/nascondi']],
      ['miss', 'hidden_recipes', '/nascondi', ['/nascondi']],
      ['miss', 'hidden_recipes', '/nascondi', ['/nascondi']],
      ['miss', 'quest_none', '/quest', ['/quest']],
      ['miss', 'quest_none', '/quest', ['/quest']],
    ]);
  });

  it('preferito_of_an_item_not_owned_is_a_not_found_reply', () => {
    expect(known('@mario_r, non hai niente del genere', '/preferito bonsai')).toStrictEqual([
      'miss',
      'item_not_owned',
      undefined,
      ['/dai', '/mostra', '/preferito'],
    ]);
  });
});

describe('old formats', () => {
  const fmt = (t: string, q: string | null = null): [string, unknown, string[] | null] => {
    const e = classify(t, q) as unknown as Record<string, unknown>;
    const c = compatibleCommands(t);
    return [e['type'] as string, e['format'], c === null ? null : [...c].sort()];
  };

  it('old_formats_are_recognised_without_facts', () => {
    expect(
      [
        '@mario_r, un robusto valletto con la puzza sotto il naso ti si avvicina per chiederti aiuto! Ha bisogno di alcuni oggetti. Puoi aiutarlo?\nGli serve:\n- un piccolo annaffiatoio [C] x1\n\nHai 2 ore a disposizione!',
        "@mario_r, non hai ancora tutti gli oggetti necessari per aiutare un monaco, ti manca:\n- un barattolo di miele [C] x1\nMentre hai gia':\n- una spada di legno [C] x1\n\nHai ancora 119 minuti!",
        "Complimenti! Hai trovato tutti gli oggetti! Li consegni a un mercante che e' contentissimo!\nTi ricompensa donandoti:\n- una moneta d'oro [X] x7",
        '@mario_r bravissimo, hai trovato un pacchetto! Tutto contento lo apri e dentro ci trovi:\n- un guanto bucato 🐠 [C] x1\n\nSe non hai idea di cosa sia questa cosa, puoi usare il comando /faq :)',
        '@mario_r, ti accingi ad aprire il tuo pacco eccitato come un bambino a natale, sfili il nastrino, apri la scatola ed ecco che trovi:\n-un colino di plastica [N]',
        'nessuna ricetta trovata con quel nome (chiodi)',
        '@mario_r, un uovo di quaglia [C] non da nessun titolo..',
        "@mario_r, ti fregi del titolo che si confa' al possessore di un astrolabio da cartografo [L1].",
        'Inventario di @mario_r, al 2017/10/15 13:11:45',
      ].map((t) => fmt(t))
    ).toStrictEqual([
      ['old_format', 'quest_offer', null],
      ['old_format', 'quest_missing', ['/quest']],
      ['old_format', 'quest_completed', ['/quest']],
      ['old_format', 'found_parcel', null],
      ['old_format', 'gift_parcel', ['/usa']],
      ['old_format', 'hide_not_found', ['/nascondi']],
      ['old_format', 'title_none', ['/titolo']],
      ['old_format', 'title_choice', ['/titolo']],
      ['old_format', 'inventory_header', ['/i', '/inventario', '/inventory']],
    ]);
  });

  it('pakkomon_reply_to_usa_is_not_a_use_but_a_parcel_is', () => {
    expect(
      classify('@mario_r, sei pronto a sfidare chiunque col tuo Zampirlo 🐯 !', '/usa zamp')
    ).toStrictEqual({ type: 'pakkomon_ready', pakkomon: 'Zampirlo 🐯' });
    expect(
      classify(
        '@mario_r, ti accingi ad aprire il tuo pacco eccitato come un bambino a natale, ed ecco che trovi:\n-un colino di plastica [N]',
        '/usa pacco'
      ).type
    ).toBe('use');
    expect(
      classify(
        '@mario_r, un robusto valletto ti si avvicina per chiederti aiuto! Puoi aiutarlo?\nGli serve:\n- un sasso [C] x1',
        '/usa quest'
      ).type
    ).toBe('use');
  });

  it('pakkomon_sphere_use_gives_the_pakkomon', () => {
    expect(
      classify(
        "@mario_r, lanci la tua Sfera Frullo, si apre a mezz'aria ed esce un Pakkomon di nome Brumolo 👻 [X]!",
        null
      )
    ).toStrictEqual({
      type: 'use',
      text: "lanci la tua Sfera Frullo, si apre a mezz'aria ed esce un Pakkomon di nome Brumolo 👻 [X]!",
      items: [{ name: 'un Pakkomon di nome Brumolo 👻', rarity: 'X', usable: false, qty: 1 }],
      named: 'Sfera Frullo',
      pakkomon_use: 'hatch',
      pakkomon: ['Brumolo 👻'],
    });
    // Any sphere name: the item is read from the reply.
    expect(
      classify(
        "@mario_r, lanci la tua Super Sfera Lampo ⚡️, si apre a mezz'aria ed esce un Pakkomon di nome Frullino 🐰 [X]!",
        null
      )
    ).toMatchObject({ type: 'use', named: 'Super Sfera Lampo ⚡️' });
  });
});

describe('items a use takes', () => {
  const takes = (text: string, query: string): unknown => {
    const e = classify(text, query);
    return e.type === 'use' ? e.takes : e.type;
  };

  it('a_key_a_machine_s_inputs_and_a_pakkomon_s_equipment_are_taken', () => {
    expect([
      takes(
        "@mario_r, infili una chiave di ebano 🔑 nella serratura di un baule di ebano 📦, lo apri e dentro trovi:\n-una moneta d'oro [X] x41",
        '/usa baule'
      ),
      takes(
        '@mario_r, inserisci un pomodoro, una mozzarella e infine una mela in uno sportello sul lato del tostapane.',
        '/usa tostapane'
      ),
      takes(
        '@mario_r, apri 2x una latta di piselli e inizi a versarli dentro un tostapane incantato 🍞.',
        '/usa tostapane'
      ),
    ]).toStrictEqual([
      ['una chiave di ebano 🔑'],
      ['un pomodoro', 'una mozzarella', 'una mela'],
      ['una latta di piselli'],
    ]);
  });

  it('an_equipment_named_with_a_comma_is_one_item', () => {
    expect(
      takes(
        '@djjeck, equipaggi il tuo Brumolo 👻 con una spada di legno, piccola ma robusta [L2].',
        '/usa brum # spada'
      )
    ).toStrictEqual(['una spada di legno, piccola ma robusta']);
  });

  it('a_use_that_takes_nothing_has_no_takes', () => {
    expect(takes('@mario_r, tiri il dado e fai 5!', '/usa dado')).toBeUndefined();
  });
});

describe('edge cases', () => {
  it('items_named_inline_in_a_use_reply_are_read', () => {
    const fagiolo = classify(
      '@mario_r, osservi il tuo vecchio alberello e sorpresa! Ottieni: un seme di Zaffirella!',
      '/usa alberello'
    );
    const monete = classify(
      "@mario_r, apri il barattolo e ci trovi dentro 22 monete d'oro!",
      '/usa barattolo'
    );
    expect([
      fagiolo.type === 'use' && fagiolo.items,
      monete.type === 'use' && monete.items,
    ]).toStrictEqual([
      [{ name: 'un seme di Zaffirella', rarity: null, usable: false, qty: 1 }],
      [{ name: "una moneta d'oro", rarity: null, usable: false, qty: 22 }],
    ]);
  });

  it('items_a_use_gives_in_other_wordings_are_read', () => {
    const items = (text: string): unknown => {
      const e = classify(text, '/usa x');
      return e.type === 'use' ? e.items.map((x) => [x.qty, x.name, x.rarity]) : e.type;
    };
    expect([
      items('@mario_r, la pietra ti si sbriciola tra le mani. Ottieni un sasso [C] x3.'),
      items('@mario_r, lo arrotoli per bene et voilá, ottieni: una perla [R] x1'),
      items('@mario_r, dopo pochi minuti sputa fuori dal retro un sasso!'),
      items(
        '@mario_r, lui salta via e atterra sulla testa di @lucia_b, lasciandoti addosso una perla!'
      ),
      items(
        "@mario_r, lanci la tua Sfera Frullo, si apre a mezz'aria ed esce un Pakkomon di nome Brumolo 👻 [X]!"
      ),
      items("@mario_r, apri lo scrigno rivelando.. un tesoro! Trovi 101 monete d'oro!"),
    ]).toStrictEqual([
      [[3, 'un sasso', 'C']],
      [[1, 'una perla', 'R']],
      [[1, 'un sasso', null]],
      [[1, 'una perla', null]],
      [[1, 'un Pakkomon di nome Brumolo 👻', 'X']],
      [[101, "una moneta d'oro", null]],
    ]);
  });

  it('an_item_in_a_message_players_wrote_is_not_received', () => {
    const e = classify(
      '@mario_r, accendi un walkie-talkie e mandi a @lucia_b il seguente messaggio: "Ottieni una perla.".',
      '/usa walkie'
    );
    expect(e.type === 'use' && e.items).toStrictEqual([]);
  });

  it('items_a_quest_asks_for_or_a_listing_shows_are_not_received', () => {
    const items = (text: string): unknown => {
      const e = classify(text, '/usa x');
      return e.type === 'use' ? e.items.map((x) => x.name) : e.type;
    };
    expect([
      items(
        '@mario_r, un contadino ti si avvicina per chiederti aiuto! Puoi aiutarlo?\nGli serve:\n- un sasso [C] x1\n- una perla [R] x1\n\nHai 2 ore a disposizione!'
      ),
      items(
        '@mario_r, ecco i tuoi oggetti in ordine di quantità:\n- un sasso [C] x618\n- una perla [R] x4'
      ),
      // A list after the one not received is received.
      items(
        '@mario_r, ecco cosa ti serve e cosa trovi:\nGli serve:\n- un sasso [C] x1\nTrovi:\n- una perla [R] x1'
      ),
    ]).toStrictEqual([[], [], ['una perla']]);
  });

  it('a_lottery_draw_names_its_prize', () => {
    const prize = (t: string): unknown => {
      const e = classify(t, null);
      return e.type === 'miss' ? e.prize : e.type;
    };
    expect([
      prize("IL FORTUNATO E': @lucia_b ! Evviva! Vince il fantastico Primo Premio della lotteria!"),
      prize('PREMIO DI CONSOLAZIONE: @lucia_b vince un pacchettino di consolazione 🎁!'),
      prize('RULLO DI TAMBURI!!!'),
    ]).toStrictEqual([
      'il fantastico Primo Premio della lotteria',
      'un pacchettino di consolazione 🎁',
      undefined,
    ]);
  });

  it('truncated_recipe_list_is_marked_truncated', () => {
    const e = classify(
      '@mario_r, ecco le ricette a tua disposizione:\n- Torre L1 [*]\n- Muro L2 [manca 1]\n- Gara di cucina L3 [manca TRONCATO!',
      '/ricetta'
    );
    expect(e).toStrictEqual({
      type: 'recipe_list',
      truncated: true,
      recipes: [
        { name: 'Torre', level: 1, ready: true, missing: 0 },
        { name: 'Muro', level: 2, ready: false, missing: 1 },
      ],
    });
  });

  it('titolo_replies_are_not_an_inventory', () => {
    const old = classify(
      '@mario_r, ora non hai nessun titolo. Ecco gli oggetti che danno titoli che possiedi:\n- un astrolabio da cartografo [L1]',
      '/titolo'
    );
    const none = classify('@mario_r, non hai oggetti che diano titoli..', '/titolo');
    expect([old, none]).toStrictEqual([
      {
        type: 'title',
        items: [{ name: 'un astrolabio da cartografo', rarity: 'L1', usable: false, qty: 1 }],
      },
      { type: 'title', items: [] },
    ]);
  });

  it('anonymous_show_is_a_show', () => {
    const e = classify(
      '[.. una presenza indistinta..], mostri orgogliosamente di possedere 241x un fischietto di quelli da carnevale [C]',
      '/mostra fischietto'
    );
    expect(e).toStrictEqual({
      type: 'show',
      qty: 241,
      item: 'un fischietto di quelli da carnevale',
      rarity: 'C',
      usable: false,
    });
  });

  it('anonymous_prefix_in_other_replies', () => {
    const A = '[.. una presenza indistinta..]';
    const info = classify(
      `${A} un sasso [C] al momento non ti serve in nessuna ricetta.`,
      '/esamina sasso'
    );
    const give = classify(`${A}, dai 1x un bottone a @lucia_b`, '/dai lucia_b bottone');
    const drop = classify(`${A}, nel bosco trovi un sasso [C]!`, '/avventura');
    const use = classify(`${A}, tiri il dado e fai 5!`, '/usa dado');
    expect([
      info.type,
      give.type,
      drop.type === 'drop' && drop.kind === 'adventure' && drop.raw,
      use.type === 'use' && use.text,
    ]).toStrictEqual(['item_info', 'give', 'nel bosco trovi un sasso', 'tiri il dado e fai 5!']);
    expect(playerOf(`${A}, dai 1x un bottone a @lucia_b`)).toBeNull();
  });

  it('old_travel_without_exits_is_a_travel', () => {
    const e = classify(
      '@mario_r, ti metti in cammino e dopo un lunghissimo viaggio arrivi in cima al monte Grevolo 🏔',
      '/viaggio cima'
    );
    expect(e).toStrictEqual({
      type: 'travel',
      location: 'in cima al monte Grevolo 🏔',
      exits: [],
      narrative: null,
      written: { 'in cima al monte Grevolo 🏔': 'in cima al monte Grevolo 🏔' },
    });
  });

  it('item_cooldown_reply_is_recognised_without_a_command', () => {
    const use = classify(
      '@mario_r, un vecchio alberello parlante 🌱 deve raffreddarsi ancora per 4 ore e 6 minuti prima di poterlo usare di nuovo.',
      null
    );
    const give = classify(
      'una ruota della fortuna 🎡 deve raffreddarsi ancora per 12 secondi prima di poterlo dare in giro.',
      '/dai lucia_b ruota'
    );
    expect([use, give]).toStrictEqual([
      {
        type: 'item_cooldown',
        item: 'un vecchio alberello parlante 🌱',
        action: 'use',
        remaining: 14760,
        precision: 60,
      },
      {
        type: 'item_cooldown',
        item: 'una ruota della fortuna 🎡',
        action: 'give',
        remaining: 12,
        precision: 1,
      },
    ]);
  });

  it('duration_forms', () => {
    const rem = (d: string) => {
      const e = classify(
        `@mario_r, un dado deve raffreddarsi ancora per ${d} prima di poterlo usare.`,
        '/usa dado'
      );
      return e.type === 'item_cooldown' ? [e.remaining, e.precision] : null;
    };
    expect(
      ['7 secondi', '2 minuti e 5 secondi', '3 ore', '1 ora e 1 minuto', '2 giorni e 3 ore'].map(
        rem
      )
    ).toStrictEqual([
      [7, 1],
      [125, 1],
      [10800, 3600],
      [3660, 60],
      [183600, 3600],
    ]);
  });
});

describe('through phases 2 and 4', () => {
  it('recipe_ambiguity_also_answers_esamina', () => {
    const ambiguous = 'troppe ricette trovate con quel nome';
    expect(classify(ambiguous, null)).toMatchObject({ type: 'miss', reply: 'recipe_ambiguous' });
    expect(compatibleCommands(ambiguous)).toStrictEqual(new Set(['/esamina', '/ricetta']));
    // In a group the reply takes the pending /esamina, and the final verification keeps the pair.
    const g = new Chat('Gruppo');
    g.user('Anna', '/inventario', 0);
    g.user('Bea', '/esamina torta', 1);
    g.bot('troppe ricette trovate con quel nome', 2);
    const { events, err } = runExtract(g.messages);
    expect(events.map((e) => [e.type, e.query])).toStrictEqual([['miss', '/esamina torta']]);
    expect(err).toContain('coppie nei gruppi verificate dalla risposta: confermate=1, sciolte=0');
  });

  it('known_replies_constrain_group_pairing', () => {
    const g = new Chat('Gruppo');
    g.user('Anna', '/avventura', 0);
    g.bot('RULLO DI TAMBURI!!!', 1); // answers no command: the adventure stays pending
    g.user('Bea', '/inventario', 2);
    g.user('Carla', '/stats zorro', 3);
    g.bot('non esiste nessuno con quel nome..', 4); // a /stats reply: not the /inventario
    const ev = runExtract(g.messages).events;
    expect(ev.map((e) => [e.type, e.query])).toStrictEqual([
      ['miss', null],
      ['miss', '/stats zorro'],
    ]);
  });

  it('a_preference_reply_takes_its_command_in_a_group', () => {
    const g = new Chat('Gruppo');
    g.user('Anna', '/avventura', 0);
    g.user('Bea', '/preferito bonsai', 1);
    g.bot(
      "@bea_b, sei veramente affezionato a un piccolo bonsai, e' di gran lunga il tuo oggetto preferito!",
      2
    );
    g.user('Carla', '/quest', 3);
    g.bot('@carla_c non hai nessuna quest al momento.', 4);
    const ev = runExtract(g.messages).events;
    expect(ev.map((e) => [e.type, e.query])).toStrictEqual([
      ['miss', '/preferito bonsai'],
      ['miss', '/quest'],
    ]);
  });

  it('sua_maesta_prefix', () => {
    const g = new Chat('G');
    g.user('Admin', '/inventario', 0);
    g.bot('Sua Maestà @msx80, possiedi:\n- una corona [U] x1', 1);
    const { events } = runExtract(g.clean());
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect([e.type, e.player, e.query]).toStrictEqual(['inventory', 'msx80', '/inventario']);
  });

  it('broadcasts_in_group', () => {
    const g = new Chat('G');
    g.user('Luigi', '/avventura', 0); // a pending command that must not be taken
    g.bot('[W] @x, nel bosco trovi un sasso [C]!', 1);
    g.bot('[N] @y ti ha dato 1x un bottone', 2);
    g.bot("[BAN] @z e' stato bannato", 3);
    const { events } = runExtract(g.clean());
    expect(events.map((e) => e.type)).toStrictEqual(['drop', 'gift', 'unknown']);
    expect(events.every((e) => e.broadcast && e.match === null && e.query === null)).toBe(true);
    expect((events[0] as Record<string, unknown>)['raw']).toBe('nel bosco trovi un sasso'); // [W] removed
    expect(events[0]?.player).toBe('x');
    expect((events[2] as Record<string, unknown>)['text']).toBe("[BAN] @z e' stato bannato");
  });

  it('not_a_broadcast_in_dm', () => {
    const dm = new Chat(BOT);
    dm.user('Daniele', '/avventura', 0);
    dm.bot('@djjeck, nel bosco trovi un sasso [C]!', 1);
    dm.bot('[N] @y ti ha dato 1x un bottone', 2);
    const { events } = runExtract(dm.clean());
    expect(events.map((e) => [e.type, e.broadcast, e.match])).toStrictEqual([
      ['drop', false, 'dm'],
      ['gift', false, 'dm'],
    ]);
  });

  it('normal_group_reply_is_not_broadcast', () => {
    const g = new Chat('G');
    g.user('Luigi', '/avventura', 0);
    g.bot('@luigi, nel bosco trovi un sasso [C]!', 1);
    const { events } = runExtract(g.clean());
    expect(events.map((e) => [e.broadcast, e.match, e.query])).toStrictEqual([
      [false, 'single', '/avventura'],
    ]);
  });

  it('typical_dm_session', () => {
    const dm = new Chat(BOT);
    const session: [string, string][] = [
      ['/avventura', DROP],
      ['/esamina sedia', ITEM_INFO],
      ['/ricetta cestina', DETAIL],
      ['/ricetta biscottosa', CRAFT],
      ['/ricetta', RECIPE_LIST],
      ['/inventario', INVENTORY],
      ['/viaggio valle', TRAVEL],
      ['/faq', FAQ],
      ['/dai 1 bottone @gino_x', '@djjeck, dai 1x un bottone a @gino_x'],
      [
        '/mostra cappello',
        '@djjeck, mostri orgogliosamente di possedere 3x un elegante cappello piumato [N]',
      ],
      ['/usa dado', '@djjeck, tiri il dado e fai 5!'],
    ];
    session.forEach(([cmd, reply], i) => {
      dm.user('Daniele', cmd, i * 60);
      dm.bot(reply, i * 60 + 2);
    });
    const { events, err } = runExtract(dm.clean());
    expect(events.map((e) => e.type)).toStrictEqual([
      'drop',
      'item_info',
      'recipe_detail',
      'craft',
      'recipe_list',
      'inventory',
      'travel',
      'miss',
      'give',
      'show',
      'use',
    ]);
    expect(events.every((e) => e.dm && e.match === 'dm' && e.chat === BOT)).toBe(true);
    expect(events.slice(0, 3).map((e) => e.player)).toStrictEqual(['djjeck', 'djjeck', 'djjeck']);
    // The /faq is not addressed: the player comes from the matched command's sender
    // (the DM sender is seeded as the owner).
    expect(playerOf(FAQ)).toBeNull();
    expect(events[7]?.player).toBe('djjeck');
    expect(events[3]?.query).toBe('/ricetta biscottosa');
    const keys = new Set(Object.keys(byType(events, 'drop')[0] ?? {}));
    for (const k of [
      'chat',
      'dm',
      'msg',
      'date',
      'player',
      'query',
      'match',
      'forwarded',
      'broadcast',
    ])
      expect(keys.has(k), k).toBe(true);
    expect(err).toContain('InventoryBot: risposte del bot abbinate a un comando: dm=11');
  });

  it('stats_field_does_not_overwrite_event_keys', () => {
    const c = new Chat(BOT);
    c.user('Daniele', '/stats', 0);
    c.bot('Avventuriero @djjeck\n- Type: altro\n- Date: ieri\n- Livello: 4', 1);
    const [e] = runExtract(c.messages).events;
    expect(e?.type).toBe('stats');
    expect(e?.date).toBe(tgDate(1));
  });

  it('stats_fields_named_like_event_keys_are_dropped', () => {
    const c = new Chat(BOT);
    c.user('Daniele', '/stats', 0);
    c.bot(
      'Avventuriero @djjeck\n- Livello: 4\n- Player: x\n- Chat: y\n- Msg: z\n- __proto__: w\n- Luogo: nel bosco',
      1
    );
    const [e] = runExtract(c.messages).events;
    const {
      type,
      chat,
      dm,
      msg: id,
      date: d,
      player,
      query,
      match,
      forwarded,
      broadcast,
      ...fields
    } = e as unknown as Record<string, unknown>;
    expect([type, chat, id, d, player, query]).toStrictEqual([
      'stats',
      BOT,
      c.messages[1]?.id,
      tgDate(1),
      'djjeck',
      '/stats',
    ]);
    expect([dm, match, forwarded, broadcast]).toStrictEqual([true, 'dm', false, false]);
    expect(Object.entries(fields)).toStrictEqual([
      ['livello', '4'],
      ['__proto__', 'w'],
      ['luogo', 'il bosco'],
    ]);
  });

  it('anonymous_reply_matched_in_a_group_has_no_player', () => {
    const g = new Chat('Gruppo');
    for (let i = 0; i < 3; i++) {
      g.user('Mario', '/avventura', i * 300);
      g.bot('@mario, nel bosco trovi un sasso [C]!', i * 300 + 1); // maps Mario -> mario
    }
    g.user('Mario', '/mostra sasso', 1000);
    g.bot(
      '[.. una presenza indistinta..], mostri orgogliosamente di possedere 3x un sasso [C]',
      1001
    );
    const e = runExtract(g.messages).events.at(-1);
    expect([e?.type, e?.query, e?.player]).toStrictEqual(['show', '/mostra sasso', null]);
  });

  it('admin_stats_are_stats', () => {
    const c = new Chat(BOT);
    c.user('Daniele', '/stats msx80', 0);
    c.bot('Avventuriero Sua Maestà @msx80\n- Livello: ∞', 1);
    const [e] = runExtract(c.messages).events;
    expect([
      e?.type,
      e?.player,
      (e as unknown as Record<string, unknown> | undefined)?.['livello'],
    ]).toStrictEqual(['stats', 'msx80', '∞']);
  });
});
