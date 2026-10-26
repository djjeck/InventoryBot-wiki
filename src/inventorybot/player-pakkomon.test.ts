/** player-pakkomon.ts: the owner's Pakkomon in the player state. */
import { describe, expect, it } from 'vitest';
import { ev, type EvOptions, fieldsOf, runBuild } from '#test/build.ts';
import * as T from '#test/texts.ts';
import { type BuildEvent, type PlayerPakkomon } from './types.ts';

const group = (text: string, query: string | null, t: number, o: EvOptions = {}): BuildEvent =>
  ev(text, query, { t, dm: false, chat: 'Gruppo', match: 'user', ...o });
const fight = (w: string, wo: string, l: string, lo: string, end: string, more = ''): string =>
  `@${wo}, i due pakkomon iniziano a combattere furiosamente. Alla fine ${w} di @${wo} sconfigge ${l} di @${lo} ${end}!${more}`;
const dateOf = (e: BuildEvent): string => fieldsOf(e)['date'] as string;
const mine = (events: BuildEvent[]): PlayerPakkomon[] => runBuild(events, 'djjeck').state.pakkomon;

describe("the owner's Pakkomon", () => {
  it('a_pakkomon_from_its_hatching_to_its_return', () => {
    // build() annotates its events: each run takes new ones.
    const hatching = (): BuildEvent =>
      ev(
        "@djjeck, lanci la tua Sfera Frullo, si apre a mezz'aria ed esce un Pakkomon di nome Zampirlo 🐯 [X]!",
        '/usa sfera',
        { t: 0 }
      );
    const giving = (): BuildEvent =>
      group('@djjeck, dai 1x un Pakkomon di nome Zampirlo 🐯 a @lucia_b', '/dai lucia_b zamp', 400);
    const hatch = hatching();
    const record = ev(
      "@djjeck, Zampirlo 🐯 ha vinto 1 battaglie e ne ha perse 1.\nE' equipaggiato con una spada di cartone [S].\nE' pronto a combattere.\nE' nato il giorno 18-04-2025 dalle mani di @djjeck.\n🏆",
      '/usa zamp',
      { t: 300 }
    );
    const given = giving();
    const back = ev('[N] @lucia_b ti ha dato 1x un Pakkomon di nome Zampirlo 🐯', null, { t: 500 });
    const all = mine([
      ev(T.inventory([['una sfera Frullo 💊', 'L1', 1, true]]), '/inventario', { t: -10 }),
      hatch,
      // Won on the owner's challenge, then lost on the other player's.
      ev(
        fight(
          'Zampirlo 🐯',
          'djjeck',
          'Tibolah 🐸',
          'lucia_b',
          'con ampio margine',
          '\nZampirlo 🐯 ha imparato qualcosa di nuovo..'
        ),
        '/usa zamp # @lucia_b',
        { t: 100 }
      ),
      group(
        fight('Tibolah 🐸', 'lucia_b', 'Zampirlo 🐯', 'djjeck', 'di stretta misura'),
        '/usa tib # @djjeck',
        200
      ),
      record,
      given,
    ]);
    expect(all).toStrictEqual([
      {
        name: 'Zampirlo 🐯',
        came: { via: 'hatched', from: 'una sfera Frullo 💊', date: dateOf(hatch) },
        born: '2025-04-18',
        maker: 'djjeck',
        first_seen: dateOf(hatch),
        last_seen: dateOf(given),
        gone: { via: 'given', to: 'lucia_b', date: dateOf(given) },
        record: { wins: 1, losses: 1, date: dateOf(record) },
        equipment: 'una spada di cartone',
        power_ups: ['🏆'],
        power_up_items: [],
        fights: { won: 1, lost: 1, learned: 1 },
        best_win: { min: 40, max: 49 },
        stunned_until: null,
        probe: null,
      },
    ]);
    // Received back: the owner's again, as it first came.
    const [again] = mine([hatching(), giving(), back]);
    expect([again?.gone, again?.came?.via]).toStrictEqual([null, 'hatched']);
  });

  it('other_players_pakkomon_are_not_followed', () => {
    expect(
      mine([
        group(
          fight('Tibolah 🐸', 'lucia_b', 'Brumolo 👻', 'gino_x', 'per un soffio'),
          '/usa tib # @gino_x',
          0
        ),
        group(
          "@lucia_b, Tibolah 🐸 ha vinto 3 battaglie e ne ha perse 1.\nNon ha nulla equipaggiato.\nE' pronto a combattere.",
          '/usa tib',
          10
        ),
        // A forwarded copy of a fight is no fight.
        ev(fight('Zampirlo 🐯', 'djjeck', 'Tibolah 🐸', 'lucia_b', 'per un soffio'), null, {
          t: 20,
          forwarded: true,
        }),
      ])
    ).toStrictEqual([]);
  });

  it('a_lost_fight_stuns_and_uses_on_it_tell_its_state', () => {
    const lost = ev(
      fight('Gigante di Sale 🧂', 'InventoryBot', 'Zampirlo 🐯', 'djjeck', 'di stretta misura'),
      '/usa zamp # @InventoryBot',
      { t: 0 }
    );
    const [stunned] = mine([lost]);
    // Until the end of its ending's band: 19 minutes.
    expect(Date.parse(stunned?.stunned_until as string) - Date.parse(dateOf(lost))).toBe(
      19 * 60 * 1000
    );
    const [p] = mine([
      ev(
        T.inventory([
          ['un unguento di menta', 'N', 1, true],
          ['una pozione', 'X', 1, true],
        ]),
        '/inventario',
        { t: -10 }
      ),
      lost,
      ev(
        '@djjeck, spalmi un Pakkomon di nome Zampirlo 🐯 con un unguento di menta e dopo pochi istanti torna in perfetta forma e pronto a combattere!',
        '/usa unguento # zamp',
        { t: 60 }
      ),
      ev(
        "@djjeck, fai bere una pozione a un Pakkomon di nome Zampirlo 🐯.. Poi lo scruti attentamente per alcuni minuti.. Si, ti sembra leggermente piu' muscoloso.",
        '/usa pozione # zamp',
        { t: 120 }
      ),
      ev(
        '@djjeck, inserisci Zampirlo 🐯 nella sonda e sul display appare una scritta: "Forte"!',
        '/usa sonda # zamp',
        { t: 180 }
      ),
    ]);
    expect([p?.stunned_until, p?.power_up_items, p?.probe, p?.fights]).toStrictEqual([
      null,
      ['una pozione'],
      'Forte',
      { won: 0, lost: 1, learned: 0 },
    ]);
  });

  it('one_seen_before_a_list_of_all_of_them_and_left_out_is_gone', () => {
    const all = mine([
      ev(
        fight('Tibolah 🐸', 'djjeck', 'Brumolo 👻', 'lucia_b', 'per un soffio'),
        '/usa tib # @lucia_b',
        { t: 0 }
      ),
      ev(
        '@djjeck, esamini i tuoi pakkomon con lo scanner:\n - Zampirlo 🐯: pronto',
        '/usa scanner',
        { t: 60 }
      ),
      // Seen again after the list: the owner's again.
      ev(
        T.inventory([
          ['un Pakkomon di nome Zampirlo 🐯', 'X', 1, true],
          ['un Pakkomon di nome Tibolah 🐸', 'X', 1, true],
        ]),
        '/inventario',
        { t: 120 }
      ),
      ev(T.inventory([['un Pakkomon di nome Zampirlo 🐯', 'X', 1, true]]), '/inventario', {
        t: 180,
      }),
    ]);
    expect(all.map((p) => [p.name, p.gone?.via ?? null])).toStrictEqual([
      ['Zampirlo 🐯', null],
      ['Tibolah 🐸', 'unlisted'],
    ]);
  });

  it('the_scanner_lists_them_and_the_extractor_ends_one', () => {
    const scan = ev(
      '@djjeck, esamini i tuoi pakkomon con lo scanner:\n - Zampirlo 🐯: 5 minuti e 38 secondi\n - Brumolo 👻: pronto',
      '/usa scanner',
      { t: 0 }
    );
    const all = mine([
      scan,
      ev(
        '@djjeck, punti un aspiratore di scintille 🔌 contro un Pakkomon di nome Brumolo 👻 e premi il grilletto: un raggio lo colpisce. Ottieni una scintilla blu.',
        '/usa aspiratore # brum',
        { t: 60 }
      ),
    ]);
    expect(all.map((p) => [p.name, p.gone?.via ?? null, p.stunned_until !== null])).toStrictEqual([
      ['Zampirlo 🐯', null, true],
      ['Brumolo 👻', 'extracted', false],
    ]);
  });

  it('items_and_inventory_count_them_as_the_one_pakkomon', () => {
    const { state } = runBuild(
      [
        ev(
          T.inventory([
            ['un Pakkomon di nome Zampirlo 🐯', 'X', 1, true],
            ['un Pakkomon di nome Brumolo 👻', 'X', 1, true],
            ['un sasso', 'C', 2, false],
          ]),
          '/inventario',
          { t: 0 }
        ),
      ],
      'djjeck'
    );
    expect([
      Object.keys(state.items).sort(),
      state.inventory['un Pakkomon']?.qty,
      state.pakkomon.map((p) => p.name),
    ]).toStrictEqual([['un Pakkomon', 'un sasso'], 2, ['Brumolo 👻', 'Zampirlo 🐯']]);
  });
});
