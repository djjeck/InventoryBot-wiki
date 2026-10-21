import { describe, expect, it } from 'vitest';
import { readConversation } from '#src/telegram/conversation/conversation.ts';
import { BOT, Chat } from '#test/helpers.ts';
import {
  broadcastText,
  compatibleCommands,
  inventoryBotDialect,
  learnTitles,
  playerOf,
  stripSuaMaesta,
  titleStripper,
  userSpans,
} from './dialect.ts';

describe('addressee', () => {
  it('forms', () => {
    const cases: Record<string, string> = {
      '@djjeck, possiedi:': 'djjeck',
      '@djjeck un secchio di fango [L1] al momento': 'djjeck',
      'Complimenti @gino_x, hai vinto': 'gino_x',
      'Avventuriero @djjeck\n- Livello: 5': 'djjeck',
      'ciao @mario_r, benvenuto': 'mario_r',
    };
    for (const [text, who] of Object.entries(cases)) expect(playerOf(text), text).toBe(who);
  });

  it('unaddressed', () => {
    for (const text of ['Troppo presto!', '[N] @gino_x ti ha dato 1x un bottone', 'Grazie @djjeck'])
      expect(playerOf(text), text).toBeNull();
  });

  it('anonymous_player', () => {
    const { isAnonymous } = inventoryBotDialect([]);
    expect(isAnonymous('[.. una presenza indistinta..], possiedi:')).toBe(true);
    expect(isAnonymous('@mario_r, possiedi:')).toBe(false);
  });
});

describe('titles', () => {
  it('learned_from_comma_form_min_twice', () => {
    expect(
      learnTitles(['@u il fornaio, ti tuffi', '@v il fornaio, possiedi:', '@w lo scemo, ciao'])
    ).toStrictEqual(['il fornaio']);
  });

  it('leaderboard_count_not_in_title', () => {
    expect(learnTitles(['1. @u il fornaio (12)', '2. @v il fornaio (3)'])).toStrictEqual([
      'il fornaio',
    ]);
  });

  it('longest_first', () => {
    const texts = ['@u il re, x', '@v il re, x', '@u il gran cuoco, x', '@v il gran cuoco, x'];
    expect(learnTitles(texts)).toStrictEqual(['il gran cuoco', 'il re']);
  });

  it('stripped_with_and_without_comma_and_as_recipient', () => {
    expect(titleStripper(['il cartografo'])('@u il cartografo, possiedi:')).toBe('@u, possiedi:');
    expect(
      titleStripper(['il cartografo'])(
        '@u il cartografo un secchio di fango [C] al momento non ti serve in nessuna ricetta.'
      )
    ).toBe('@u un secchio di fango [C] al momento non ti serve in nessuna ricetta.');
    const strip = titleStripper(['il fornaio']);
    expect(strip('@d, dai 1x un bottone a @u il fornaio')).toBe('@d, dai 1x un bottone a @u');
    expect(strip('@u il fornaio (12)\n@v')).toBe('@u\n@v');
  });

  it('no_titles_identity', () => {
    expect(titleStripper([])('@u il cartografo, x')).toBe('@u il cartografo, x');
  });
});

describe('admin and broadcasts', () => {
  it('sua_maesta_removed_only_before_the_admin', () => {
    expect(stripSuaMaesta('Sua Maestà @msx80, possiedi:')).toBe('@msx80, possiedi:');
    expect(stripSuaMaesta('Avventuriero Sua Maestà @msx80\n- Livello: 9')).toBe(
      'Avventuriero @msx80\n- Livello: 9'
    );
    expect(stripSuaMaesta('Lunga vita a Sua Maestà @msx80')).toBe('Lunga vita a Sua Maestà @msx80');
  });

  it('broadcasts', () => {
    expect(broadcastText('[W] @mario_r, nel bosco trovi un sasso [C]!')).toBe(
      '@mario_r, nel bosco trovi un sasso [C]!'
    );
    expect(broadcastText('[N] @gino_x ti ha dato 1x un bottone')).toBe(
      '[N] @gino_x ti ha dato 1x un bottone'
    );
    expect(broadcastText('[BAN] qualcuno')).toBe('[BAN] qualcuno');
    expect(broadcastText('@mario_r, possiedi:')).toBeNull();
  });
});

describe('anonymisation', () => {
  const spanned = (text: string): string[] => userSpans(text).map(([a, b]) => text.slice(a, b));

  it('designates_addressee_receiver_and_giver', () => {
    expect(spanned('@luigi, dai 1x il ritratto di @anna a @bice')).toStrictEqual(['luigi', 'bice']);
    expect(spanned("Complimenti @luigi, questa e' l'avventura FORTUNATA")).toStrictEqual(['luigi']);
    expect(spanned('ciao @luigi, prima registrati')).toStrictEqual(['luigi']);
    expect(spanned('Avventuriero @luigi\n- Livello: 3\n- Amico di @anna')).toStrictEqual(['luigi']);
    expect(spanned('[N] @anna ti ha dato 2x un sasso')).toStrictEqual(['anna']);
    expect(
      spanned('meglio non dare niente a @bice, non ti sembra un tipo affidabile.')
    ).toStrictEqual(['bice']);
    // Leaderboards and other texts that only mention players designate nobody.
    expect(spanned('Classifica avventure:\n@luigi (120)\n@anna (99)')).toStrictEqual([]);
  });

  it('dialect_for_the_run', () => {
    const d = inventoryBotDialect(['il fornaio']);
    expect(d.normalizeReply('Sua Maestà @msx80 il fornaio, possiedi:')).toBe('@msx80, possiedi:');
    expect(d.compatibleCommands('@mario_r, possiedi:\n- un sasso [C] x1')).toStrictEqual(
      new Set(['/inventario', '/i', '/inventory'])
    );
    expect([...d.publicNames, ...d.userCommands]).toStrictEqual(['msx80', '/stats', '/dai']);
    expect(d.groupWindow).toBe(120);
  });
});

describe('phase 2 with this dialect', () => {
  it('titles_learned_from_the_run_are_removed_before_pairing', () => {
    const g = new Chat('G');
    g.user('Uno', '/avventura', 0);
    g.bot('@u il cartografo, nel bosco trovi un sasso [C]!', 1);
    g.user('Uno', '/inventario', 10);
    g.bot('@u il cartografo, possiedi:\n- un sasso [C] x1', 11);
    g.user('Due', '/dai 1 bottone @u', 30);
    g.bot('@d, dai 1x un bottone a @u il cartografo', 31);
    const messages = g.clean();
    const titles = learnTitles(messages.filter((m) => m.from_bot).map((m) => m.text));
    expect(titles).toStrictEqual(['il cartografo']);
    const c = readConversation(messages, BOT, inventoryBotDialect(titles));
    expect(c.replies.map((r) => r.text)).toStrictEqual([
      '@u, nel bosco trovi un sasso [C]!',
      '@u, possiedi:\n- un sasso [C] x1',
      '@d, dai 1x un bottone a @u',
    ]);
    expect(c.replies.map((r) => [r.context.player, r.context.query])).toStrictEqual([
      ['u', '/avventura'],
      ['u', '/inventario'],
      ['d', '/dai 1 bottone @u'],
    ]);
  });
});

describe('pairing', () => {
  it('compatible_commands_by_reply_type', () => {
    expect(compatibleCommands('@mario_r, nel bosco trovi un sasso [C]!')).toStrictEqual(
      new Set(['/avventura'])
    );
    expect(
      compatibleCommands('@mario_r, per fare Torre ti manca:\n- un sasso [C] x1')
    ).toStrictEqual(new Set(['/ricetta', '/esamina']));
    expect(compatibleCommands('@mario_r, possiedi:\n- un sasso [C] x1')).toStrictEqual(
      new Set(['/inventario', '/i', '/inventory'])
    );
    // A successful /usa has no grammar (each item answers in its own words): read without its
    // command it is unrecognised, so it may answer any command, and pairing finds its /usa.
    expect(compatibleCommands('@mario_r, tiri il dado e fai 5!')).toBeNull();
  });
});
