import { describe, expect, it } from 'vitest';
import { classify } from './classify.ts';
import { compatibleCommands, userSpans } from './dialect.ts';
import { ENDINGS, pakkomonUserSpans, WOUNDS } from './pakkomon.ts';

const spanned = (t: string): string[] => userSpans(t).map(([a, b]) => t.slice(a, b));

describe('fights', () => {
  it('fight_names_both_sides_winner_first_and_the_stun_of_its_ending', () => {
    const t =
      '@mario_r, i due pakkomon iniziano a combattere furiosamente. Alla fine Tibolah 🐸 di @lucia_b sconfigge Zampirlo 🐯 di @mario_r con discreto margine!\nTibolah 🐸 ha imparato qualcosa di nuovo..';
    expect(classify(t, '/usa zamp # @lucia_b')).toStrictEqual({
      type: 'pakkomon_fight',
      winner: { pakkomon: 'Tibolah 🐸', owner: 'lucia_b' },
      loser: { pakkomon: 'Zampirlo 🐯', owner: 'mario_r' },
      hit: false,
      ending: 'con discreto margine',
      stun_min: 20,
      stun_max: 29,
      move: null,
      prize: null,
      learned: true,
      wound: null,
      spoils: null,
    });
  });

  it('old_wording_notice_and_missing_ending_are_fights_too', () => {
    expect(
      classify(
        "[N] @mario_r, i due pakkomon iniziano a combattere furiosamente e alla fine Zampirlo 🐯 di @mario_r sconfigge Tibolah 🐸 di @lucia_b rimuovendolo dall'universo!",
        null
      )
    ).toMatchObject({
      type: 'pakkomon_fight',
      winner: { pakkomon: 'Zampirlo 🐯', owner: 'mario_r' },
      stun_min: 350,
      stun_max: null,
    });
    expect(
      classify(
        '[N] i due pakkomon iniziano a combattere furiosamente. Alla fine Tibolah 🐸 di @lucia_b sconfigge Zampirlo 🐯 di @mario_r!',
        null
      )
    ).toMatchObject({ type: 'pakkomon_fight', ending: null, stun_min: null, stun_max: null });
    expect(
      classify(
        '@mario_r, i due pakkomon iniziano a combattere furiosamente. Alla fine Tibolah 🐸 di @lucia_b sconfigge Zampirlo 🐯 di @mario_r a sorpresa!',
        null
      )
    ).toMatchObject({ ending: 'a sorpresa', stun_min: null, stun_max: null });
  });

  it('boss_hit_with_a_move_gives_a_prize_and_a_wound', () => {
    const t =
      "@mario_r, i due pakkomon iniziano a combattere furiosamente. Di colpo Gigante di Sale 🧂 ti tira dietro tre sassi! Fa male ma pazienza 🪨! Alla fine Zampirlo 🐯 di @mario_r colpisce Gigante di Sale 🧂 di @InventoryBot per un soffio!\n@mario_r ottiene un granello di sale grosso [R][#]!\nGigante di Sale 🧂 e' ferito seriamente!";
    expect(classify(t, '/usa zamp # @InventoryBot')).toStrictEqual({
      type: 'pakkomon_fight',
      winner: { pakkomon: 'Zampirlo 🐯', owner: 'mario_r' },
      loser: { pakkomon: 'Gigante di Sale 🧂', owner: 'InventoryBot' },
      hit: true,
      ending: 'per un soffio',
      stun_min: 0,
      stun_max: 9,
      move: 'Di colpo Gigante di Sale 🧂 ti tira dietro tre sassi! Fa male ma pazienza 🪨!',
      prize: { name: 'un granello di sale grosso', rarity: 'R', usable: false, qty: 1 },
      learned: false,
      wound: "e' ferito seriamente",
      spoils: null,
    });
  });

  it('boss_defeat_lists_the_spoils', () => {
    const t =
      "@mario_r, i due pakkomon iniziano a combattere furiosamente. Alla fine Zampirlo 🐯 di @mario_r colpisce Gigante di Sale 🧂 di @InventoryBot accartocciandolo!\n@mario_r ottiene un floppy disk incrinato [X] [usabile]!\nZampirlo 🐯 ha imparato qualcosa di nuovo..\n\nLanciando un ultimo grido rabbioso, Gigante di Sale 🧂 si accascia a terra con un tonfo e giace immobile! Un silenzo totale aleggia per qualche secondo, poi i guerrieri prorompono in grida di vittoria. Il boss e' sconfitto!\nDivisione delle spoglie:\n• @lucia_b: 12\n• @mario_r: 7";
    expect(classify(t, null)).toMatchObject({
      hit: true,
      prize: { name: 'un floppy disk incrinato', rarity: 'X', usable: true, qty: 1 },
      learned: true,
      wound: null,
      spoils: [
        { player: 'lucia_b', points: 12 },
        { player: 'mario_r', points: 7 },
      ],
    });
  });

  it('ending_bands_cover_every_minute_once', () => {
    let next = 0;
    for (const [, lo, hi] of ENDINGS) {
      expect(lo).toBe(next);
      next = hi === null ? Infinity : hi + 1;
    }
    expect(next).toBe(Infinity);
    expect(new Set(WOUNDS).size).toBe(10);
  });
});

describe('records and challenges', () => {
  it('record_reads_every_line', () => {
    const t =
      "@mario_r, Zampirlo 🐯 ha vinto 54 battaglie e ne ha perse 44.\nE' equipaggiato con una spada di cartone [S].\nE' ancora rintronato dall'ultimo combattimento. Si rimettera' tra 12 minuti e 5 secondi.\nE' nato il giorno 18-04-2025 dalle mani di @lucia_b.\n🏆💧🍫";
    expect(classify(t, '/usa zamp')).toStrictEqual({
      type: 'pakkomon_record',
      pakkomon: 'Zampirlo 🐯',
      wins: 54,
      losses: 44,
      equipment: { name: 'una spada di cartone', rarity: 'S', usable: false, qty: 1 },
      stunned_for: 725,
      born: '2025-04-18',
      maker: 'lucia_b',
      power_ups: ['🏆', '💧', '🍫'],
    });
    expect(
      classify(
        "@mario_r, Brumolo 👻 ha vinto 0 battaglie e ne ha perse 3.\nNon ha nulla equipaggiato.\nE' pronto a combattere.\nNon si sa niente del suo passato, deve essere molto vecchio...",
        null
      )
    ).toMatchObject({ equipment: null, stunned_for: 0, born: null, maker: null, power_ups: [] });
  });

  it('ready_challenge_stun_and_boss', () => {
    expect(
      classify('@mario_r, sfidi @lucia_b a combattere contro il tuo Zampirlo 🐯', null)
    ).toStrictEqual({
      type: 'pakkomon_challenge',
      pakkomon: 'Zampirlo 🐯',
      opponent: 'lucia_b',
    });
    expect(
      classify(
        "@mario_r, Zampirlo 🐯 e' ancora rintronato dall'ultimo combattimento. Si rimettera' tra 2 ore.",
        null
      )
    ).toStrictEqual({ type: 'pakkomon_stunned', pakkomon: 'Zampirlo 🐯', remaining: 7200 });
    expect(
      classify(
        "@mario_r, il pakkomon del tuo avversario e' ancora rintronato per 33 minuti e 20 secondi.",
        null
      )
    ).toStrictEqual({ type: 'pakkomon_stunned', pakkomon: null, remaining: 2000 });
    const boss =
      "📣 Attenzione!Un Pakkomon Boss 🧂 sta sfidando l'arena! Accorrete a sconfiggerlo! 🥊";
    expect(classify(boss, null)).toStrictEqual({ type: 'pakkomon_boss', emoji: '🧂' });
    expect(compatibleCommands(boss)).toStrictEqual(new Set());
    expect(
      compatibleCommands('@mario_r, sei pronto a sfidare chiunque col tuo Zampirlo 🐯 !')
    ).toStrictEqual(new Set(['/usa', '/use']));
  });

  it('stop_gone_and_heal_all_are_known_replies', () => {
    const reply = (t: string): unknown => {
      const e = classify(t, null);
      return e.type === 'miss' ? e.reply : e.type;
    };
    expect(
      [
        '@mario_r, smetti di sfidare chicchessia.',
        "@mario_r, @lucia_b non ha piu' il pakkomon con cui ti ha sfidato!",
        '@msx80, tutti i Pakkomon di @lucia_b sono stati curati.',
      ].map(reply)
    ).toStrictEqual(['pakkomon_stop', 'pakkomon_gone', 'pakkomon_heal_all']);
  });
});

describe('uses on a Pakkomon', () => {
  const use = (t: string, q: string | null = null): unknown => {
    const e = classify(t, q);
    if (e.type !== 'use') return e.type;
    const { type: _t, text: _x, items: _i, takes: _k, ...rest } = e;
    return rest;
  };

  it('each_use_says_what_it_does_without_a_command', () => {
    expect(
      [
        '@mario_r, dai da mangiare il biscotto Lunetta a un Pakkomon di nome Zampirlo 🐯 che lo mastica con fatica, ma appena lo inghiottisce BAM, torna immediatamente in forma e pronto a combattere!',
        '@mario_r, spalmi un Pakkomon di nome Zampirlo 🐯 con un unguento di menta e dopo pochi istanti torna in perfetta forma e pronto a combattere!',
        "@mario_r, fai bere una pozione a un Pakkomon di nome Zampirlo 🐯.. Poi lo scruti attentamente per alcuni minuti.. Si, ti sembra leggermente piu' muscoloso.",
        '@mario_r, inserisci Zampirlo 🐯 nella sonda e sul display appare una scritta: "Decente"!',
        '@mario_r, attivi la sonda su un Pakkomon di nome Zampirlo 🐯 e leggi il display: indica 57.',
        "@mario_r, metti i due pakkomon Zampirlo 🐯 e Brumolo 👻 sulla bilancia: il secondo e' piu' forte!",
        "@mario_r, a breve verrai contattato per la customizzazione del tuo Pakkomon! Intanto scegli un nome e un'icona.",
      ].map((t) => use(t))
    ).toStrictEqual([
      { pakkomon_use: 'heal', pakkomon: ['Zampirlo 🐯'] },
      { pakkomon_use: 'heal', pakkomon: ['Zampirlo 🐯'] },
      { named: 'una pozione', pakkomon_use: 'power_up', pakkomon: ['Zampirlo 🐯'] },
      { pakkomon_use: 'probe', pakkomon: ['Zampirlo 🐯'], reading: 'Decente' },
      { pakkomon_use: 'probe', pakkomon: ['Zampirlo 🐯'], reading: '57' },
      { pakkomon_use: 'scale', pakkomon: ['Zampirlo 🐯', 'Brumolo 👻'], reading: 'il secondo' },
      { pakkomon_use: 'customise' },
    ]);
  });

  it('extractor_gives_its_item_and_names_itself', () => {
    const t =
      '@mario_r, punti un aspiratore di scintille 🔌 contro un Pakkomon di nome Brumolo 👻 e premi il grilletto: un raggio lo colpisce. Ottieni una scintilla blu.';
    const e = classify(t, null);
    expect(e).toMatchObject({
      type: 'use',
      items: [{ name: 'una scintilla blu', rarity: null, usable: false, qty: 1 }],
      named: 'un aspiratore di scintille 🔌',
      pakkomon_use: 'extract',
      pakkomon: ['Brumolo 👻'],
    });
  });

  it('scanner_lists_each_pakkomon_and_its_readiness', () => {
    expect(
      use(
        '@mario_r, esamini i tuoi pakkomon con lo scanner:\n - Zampirlo 🐯: 5 minuti e 38 secondi\n - Brumolo 👻: pronto',
        '/usa scanner'
      )
    ).toStrictEqual({
      named: 'scanner',
      pakkomon_use: 'scan',
      scan: [
        { pakkomon: 'Zampirlo 🐯', remaining: 338 },
        { pakkomon: 'Brumolo 👻', remaining: 0 },
      ],
    });
  });

  it('another_use_is_no_pakkomon_use', () => {
    expect(use('@mario_r, tiri il dado e fai 5!')).toBe('unknown');
    expect(use('@mario_r, tiri il dado e fai 5!', '/usa dado')).toStrictEqual({});
  });
});

describe('players a Pakkomon reply names', () => {
  it('every_player_of_a_pakkomon_reply_is_designated', () => {
    expect(
      spanned(
        '@mario_r, i due pakkomon iniziano a combattere furiosamente. @lucia_b osserva Gigante di Sale 🧂 combattere e si sente strano 🐠! Alla fine Zampirlo 🐯 di @mario_r colpisce Gigante di Sale 🧂 di @InventoryBot per un soffio!\n@mario_r ottiene un granello di sale grosso [R]!\n\nLanciando un ultimo grido rabbioso, Gigante di Sale 🧂 si accascia.\nDivisione delle spoglie:\n• @gino_x: 3'
      )
    ).toStrictEqual(['mario_r', 'lucia_b', 'mario_r', 'InventoryBot', 'mario_r', 'gino_x']);
    expect(
      spanned('@mario_r, sfidi @lucia_b a combattere contro il tuo Zampirlo 🐯')
    ).toStrictEqual(['mario_r', 'lucia_b']);
    expect(
      spanned(
        "@mario_r, Zampirlo 🐯 ha vinto 1 battaglie e ne ha perse 0.\nNon ha nulla equipaggiato.\nE' pronto a combattere.\nE' nato il giorno 18-04-2025 dalle mani di @lucia_b."
      )
    ).toStrictEqual(['mario_r', 'lucia_b']);
    expect(spanned('@msx80, tutti i Pakkomon di @lucia_b sono stati curati.')).toStrictEqual([
      'msx80',
      'lucia_b',
    ]);
    expect(
      spanned("@mario_r, @lucia_b non ha piu' il pakkomon con cui ti ha sfidato!")
    ).toStrictEqual(['mario_r', 'lucia_b']);
  });

  it('other_replies_keep_their_usernames', () => {
    expect(pakkomonUserSpans('@mario_r, hai visto @lucia_b?')).toStrictEqual([]);
  });
});
