/** The shapes of an item's /usa replies (use-shapes.ts). Synthetic replies only. */
import { describe, expect, it } from 'vitest';
import { unshaped, useShapes } from './use-shapes.ts';

const NAMES = {
  items: [
    "una moneta d'oro",
    'una caps rossa',
    'un dado truccato',
    'un Pakkomon di nome Brumolo 👻',
  ],
  places: ['nella valle ventosa 🏞', 'nel bosco nebbioso di Valtorbo 🌲'],
};

describe('use shapes', () => {
  it('a_number_is_described_by_its_range_and_decimals', () => {
    expect(useShapes(['fai 3!', 'fai 1!', 'fai 6!'], NAMES)).toStrictEqual([
      {
        parts: ['fai ', 0, '!'],
        count: 3,
        slots: [{ kind: 'number', min: 1, max: 6, decimals: 0 }],
      },
    ]);
    expect(useShapes(['in 12.345 secondi', 'in 10.5 secondi'], NAMES)[0]?.slots).toStrictEqual([
      { kind: 'number', min: 10.5, max: 12.345, decimals: 3 },
    ]);
  });

  it('a_slot_with_one_value_is_fixed_text', () => {
    // The coin is always there, its number and the other item vary: as a channel card writes it.
    const shapes = useShapes(
      [
        "dentro trovi:\n- una moneta d'oro [X] x41\n- una caps rossa [C] x1",
        "dentro trovi:\n- una moneta d'oro [X] x29\n- un dado truccato [C] x1",
      ],
      NAMES
    );
    expect(shapes).toStrictEqual([
      {
        parts: ["dentro trovi:\n- una moneta d'oro [X] x", 0, '\n- ', 1, ' x1'],
        count: 2,
        slots: [
          { kind: 'number', min: 29, max: 41, decimals: 0 },
          { kind: 'item', values: ['una caps rossa', 'un dado truccato'], counts: [1, 1] },
        ],
      },
    ]);
  });

  it('an_item_with_other_tags_is_the_same_slot', () => {
    // As a card writes "[una possibile ricompensa] x1": each item comes with its own tags.
    const shapes = useShapes(
      ['dentro trovi: una caps rossa [C] [usabile] x1', 'dentro trovi: un dado truccato [R] x1'],
      NAMES
    );
    expect(shapes).toStrictEqual([
      {
        parts: ['dentro trovi: ', 0, ' x1'],
        count: 2,
        slots: [{ kind: 'item', values: ['una caps rossa', 'un dado truccato'], counts: [1, 1] }],
      },
    ]);
  });

  it('an_item_slot_counts_the_replies_of_each_item', () => {
    // How often each prize came, the most frequent first: the odds of a use giving it.
    const shapes = useShapes(
      [
        'dentro trovi: un dado truccato [C] x1',
        'dentro trovi: una caps rossa [C] x1',
        'dentro trovi: un dado truccato [C] x1',
        'dentro trovi: un dado truccato [C] x1',
      ],
      NAMES
    );
    expect(shapes[0]?.slots).toStrictEqual([
      { kind: 'item', values: ['un dado truccato', 'una caps rossa'], counts: [3, 1] },
    ]);
  });

  it('a_reply_alone_is_its_own_text', () => {
    expect(useShapes(['soffi e .. TUUUU', 'soffi e .. TUUUU', 'si rompe!'], NAMES)).toStrictEqual([
      { parts: ['soffi e .. TUUUU'], count: 2, slots: [] },
      { parts: ['si rompe!'], count: 1, slots: [] },
    ]);
  });

  it('players_and_typed_text_are_kept_by_kind_only', () => {
    expect(
      useShapes(
        ['mandi a @bea il messaggio: "ciao".', 'mandi a @luigi il messaggio: "pagliaccio".'],
        NAMES
      )
    ).toStrictEqual([
      {
        parts: ['mandi a ', 0, ' il messaggio: ', 1, '.'],
        count: 2,
        slots: [{ kind: 'user' }, { kind: 'text' }],
      },
    ]);
  });

  it('a_player_and_typed_text_stay_slots_even_with_one_value', () => {
    expect(useShapes(['mandi a @bea il messaggio: "ciao".'], NAMES)[0]?.parts).toStrictEqual([
      'mandi a ',
      0,
      ' il messaggio: ',
      1,
      '.',
    ]);
  });

  it('the_shape_given_to_an_item_is_typed_text_even_naming_an_item', () => {
    expect(
      useShapes(['gli dai la forma di un dado truccato', 'gli dai la forma di un drago'], NAMES)
    ).toStrictEqual([{ parts: ['gli dai la forma di ', 0], count: 2, slots: [{ kind: 'text' }] }]);
  });

  it('a_shaped_item_is_the_item_shaped', () => {
    expect(unshaped("un po' di creta modellato a forma di un drago")).toBe("un po' di creta");
    expect(unshaped("un po' di creta")).toBe("un po' di creta");
  });

  it('durations_places_pakkomon_symbols_and_lists_are_slots', () => {
    const [scan] = useShapes(
      [
        'esamini i tuoi pakkomon:\n - Zampirlo 🐯: 5 minuti\n - Brumolo 👻: pronto',
        'esamini i tuoi pakkomon:\n - Zampirlo 🐯: pronto',
      ],
      NAMES
    );
    expect(scan).toStrictEqual({
      parts: ['esamini i tuoi pakkomon:', 0],
      count: 2,
      slots: [{ kind: 'list' }],
    });
    const [wait] = useShapes(['riprova tra 2 ore e 5 minuti', 'riprova tra 30 secondi'], NAMES);
    expect(wait?.slots).toStrictEqual([{ kind: 'duration', min: 30, max: 7500 }]);
    const [place] = useShapes(
      ['ti trovi nella valle ventosa 🏞!', 'ti trovi nel bosco nebbioso di Valtorbo 🌲!'],
      NAMES
    );
    expect(place?.slots).toStrictEqual([
      { kind: 'place', values: ['nella valle ventosa 🏞', 'nel bosco nebbioso di Valtorbo 🌲'] },
    ]);
    // A place the wiki does not know, where one finds oneself.
    const [far] = useShapes(
      ['ti trovi nella valle ventosa 🏞!', 'ti trovi sulla scogliera bianca 🏖!'],
      NAMES
    );
    expect(far?.slots).toStrictEqual([
      { kind: 'place', values: ['nella valle ventosa 🏞', 'sulla scogliera bianca 🏖'] },
    ]);
    // A Pakkomon known as an item is an item; another one, by its name.
    const [pk] = useShapes(
      [
        'spalmi un Pakkomon di nome Zampirlo 🐯 e guarisce',
        'spalmi un Pakkomon di nome Rufoh 🐸 e guarisce',
      ],
      NAMES
    );
    expect(pk?.slots).toStrictEqual([{ kind: 'pakkomon', values: ['Zampirlo 🐯', 'Rufoh 🐸'] }]);
    const [slot] = useShapes(['esce:\n[🍓🍋💎]\nNiente..', 'esce:\n[🍓🍓🍒]\nNiente..'], NAMES);
    expect(slot).toStrictEqual({
      parts: ['esce:\n', 0, '\nNiente..'],
      count: 2,
      slots: [{ kind: 'symbols', values: ['🍓', '🍋', '💎', '🍒'] }],
    });
  });

  it('a_number_inside_an_item_name_belongs_to_the_name', () => {
    const shapes = useShapes(['lanci un dado truccato e fai 3', 'lanci un dado truccato e fai 4'], {
      items: ['un dado truccato'],
      places: [],
    });
    expect(shapes[0]?.parts).toStrictEqual(['lanci un dado truccato e fai ', 0]);
  });
});
