/** Phase 3 (anonymise): other players' identities replaced, on the test bot's dialect. */
import { describe, expect, it } from 'vitest';
import {
  type BotReply,
  type Conversation,
  readConversation,
  type ReplyContext,
} from '#src/telegram/conversation/conversation.ts';
import { ownerFromDm } from '#src/telegram/conversation/owner.ts';
import { DROP, INV, TEST_DIALECT, votes } from '#test/conversation.ts';
import { BOT, Chat } from '#test/helpers.ts';
import { anonymise } from './anonymise.ts';
import { PseudonymSource } from './pseudonyms.ts';

const SALT = 'test-salt';
const PSEUDONYM = /^[A-Z][a-z]+[A-Z][a-z]+\d*$/u;

function reply(text: string, o: Partial<ReplyContext> = {}): BotReply {
  return {
    text,
    context: {
      chat: null,
      dm: false,
      msg: 1,
      date: null,
      player: null,
      query: null,
      match: null,
      forwarded: false,
      broadcast: false,
      ...o,
    },
  };
}

function run(
  replies: BotReply[],
  owner: string | null = 'djjeck',
  senders: [string | null, string][] = []
): Conversation {
  return anonymise(
    { replies, senders: new Map(senders) },
    { owner, botName: BOT, dialect: TEST_DIALECT, salt: SALT, groupChats: [] }
  ).conversation;
}

describe('one mapping per run', () => {
  it('each_person_gets_one_pseudonym_the_same_in_every_run', () => {
    const replies = [
      reply('@luigi, nel bosco trovi un sasso [C]!', { player: 'luigi' }),
      reply('@anna, dai 1x un bottone a @luigi', { player: 'anna', query: '/dai @luigi bottone' }),
    ];
    const [luigi, anna] = run(replies).replies.map((r) => r.context.player) as [string, string];
    expect(luigi).toMatch(PSEUDONYM);
    expect(anna).toMatch(PSEUDONYM);
    expect(luigi).not.toBe(anna);
    // Hashed, not counted: the same people keep their pseudonyms in another run, in any order.
    expect(run([...replies].reverse()).replies.map((r) => r.context.player)).toStrictEqual([
      anna,
      luigi,
    ]);
    expect(run([replies[0] as BotReply]).replies[0]?.context.player).toBe(luigi);
  });

  it('same_pseudonym_in_every_field_ignoring_case', () => {
    const out = run([
      reply('@Luigi, dai 2x un sasso a @anna', { player: 'luigi', query: '/dai @ANNA 2 sasso' }),
      reply('[N] @luigi ti ha dato 1x un bottone', { chat: BOT, dm: true, player: 'djjeck' }),
    ]);
    const [give, gift] = out.replies as [BotReply, BotReply];
    const luigi = give.context.player as string;
    const anna = (give.context.query as string).split(' ')[1]?.slice(1) as string;
    expect(anna).toMatch(PSEUDONYM);
    expect(give.text).toBe(`@${luigi}, dai 2x un sasso a @${anna}`);
    expect(give.context.query).toBe(`/dai @${anna} 2 sasso`);
    expect(gift.text).toBe(`[N] @${luigi} ti ha dato 1x un bottone`);
  });

  it('mapped_senders_get_pseudonyms_and_lose_display_names', () => {
    const out = run([], 'djjeck', [
      ['Mario Rossi', 'mario'],
      ['\u0000u3', 'lucia_b'],
    ]);
    expect([...out.senders.keys()]).toStrictEqual(['#1', '#2']);
    const [mario, lucia] = [...out.senders.values()] as [string, string];
    expect([mario, lucia].every((p) => PSEUDONYM.test(p))).toBe(true);
    expect(mario).not.toBe(lucia);
  });
});

describe('kept names', () => {
  it('owner_kept_ignoring_case', () => {
    const out = run([
      reply('@DJJeck, dai 1x un sasso a @luigi', { player: 'DJJeck', query: '/dai luigi sasso' }),
    ]);
    const luigi = out.replies[0]?.context.query?.split(' ')[1] as string;
    expect(luigi).toMatch(PSEUDONYM);
    expect(out.replies[0]?.text).toBe(`@DJJeck, dai 1x un sasso a @${luigi}`);
    expect(out.replies[0]?.context.player).toBe('DJJeck');
  });

  it('without_an_owner_every_player_is_replaced', () => {
    const out = run([reply('@djjeck, ciao', { player: 'djjeck' })], null);
    expect(out.replies[0]?.context.player).toMatch(PSEUDONYM);
  });

  it('public_names_and_the_bot_kept', () => {
    const out = run([
      reply('[N] @guardiano ti ha dato 1x una corda di canapa [R]', { chat: BOT, dm: true }),
      reply('@guardiano, nel bosco trovi un sasso [C]!', { player: 'guardiano' }),
      reply(`@luigi, chiedi a @${BOT}`, { player: 'luigi', query: `/stats ${BOT}` }),
    ]);
    expect(out.replies[0]?.text).toBe('[N] @guardiano ti ha dato 1x una corda di canapa [R]');
    expect(out.replies[1]?.context.player).toBe('guardiano');
    expect(out.replies[2]?.text).toBe(`@${out.replies[2]?.context.player}, chiedi a @${BOT}`);
    expect(out.replies[2]?.context.query).toBe(`/stats ${BOT}`);
  });
});

describe('only designated players', () => {
  const STATS = ['Avventuriero @luigi', '- Livello: 3', '- Amico di @anna'].join('\n');

  it('other_usernames_in_texts_stay_as_written', () => {
    const out = run([
      reply(STATS, { player: 'luigi', query: '/stats luigi' }),
      reply('@anna, nel bosco trovi il primo numero di Topo Detective [S]! Lo manda @luigi', {
        player: 'anna',
      }),
    ]);
    const [luigi, anna] = out.replies.map((r) => r.context.player) as [string, string];
    expect(out.replies[0]?.text).toBe(STATS.replace('@luigi', `@${luigi}`));
    expect(out.replies[0]?.context.query).toBe(`/stats ${luigi}`);
    // Only what the dialect designates is replaced: the rest is what the bot says.
    expect(out.replies[1]?.text).toBe(
      `@${anna}, nel bosco trovi il primo numero di Topo Detective [S]! Lo manda @luigi`
    );
  });
});

describe('group titles', () => {
  it('groups_get_pseudonym_titles_dm_keeps_its_own', () => {
    const conversation: Conversation = {
      replies: [
        reply('@luigi, ciao', { chat: 'Gli Amici di Luigi', player: 'luigi' }),
        reply('@djjeck, ciao', { chat: BOT, dm: true, player: 'djjeck' }),
      ],
      senders: new Map(),
    };
    const a = anonymise(conversation, {
      owner: 'djjeck',
      botName: BOT,
      dialect: TEST_DIALECT,
      salt: SALT,
      groupChats: ['Gli Amici di Luigi', 'Gruppo Muto', BOT],
    });
    const [group, dm] = a.conversation.replies.map((r) => r.context.chat) as [string, string];
    expect(group).toMatch(/^Gruppo [A-Z][a-z]+[A-Z][a-z]+$/u);
    expect(dm).toBe(BOT);
    expect(a.chatTitle('Gli Amici di Luigi')).toBe(group);
    // A group without bot replies still gets a title, for the summary of phase 1.
    expect(a.chatTitle('Gruppo Muto')).toMatch(/^Gruppo [A-Z][a-z]+[A-Z][a-z]+$/u);
    expect(a.chatTitle('Gruppo Muto')).not.toBe(group);
    expect(a.chatTitle(BOT)).toBe(BOT);
    expect(a.chatTitle('Mai visto')).toBe('Mai visto');
  });
});

describe('usernames without @ in command arguments', () => {
  it('whole_words_ignoring_case_only_for_user_commands', () => {
    const known = reply('@mario, ciao', { player: 'mario' });
    const mario = run([known]).replies[0]?.context.player as string;
    const q = (query: string): string | null =>
      run([known, reply('@djjeck, ok', { player: 'djjeck', query })]).replies[1]?.context.query ??
      null;
    expect(q('/stats Mario')).toBe(`/stats ${mario}`);
    expect(q('/dai mario 2 sasso')).toBe(`/dai ${mario} 2 sasso`);
    expect(q('/DAI @MARIO sasso')).toBe(`/DAI @${mario} sasso`);
    // Not part of another word, and not in commands that take no user.
    expect(q('/stats marione')).toBe('/stats marione');
    expect(q('/esamina mario')).toBe('/esamina mario');
    expect(q('/esamina @mario')).toBe('/esamina @mario');
    // Unknown names stay: only names the run knows are recognised.
    expect(q('/stats paolo')).toBe('/stats paolo');
  });
});

describe('pseudonyms and real names', () => {
  it('a_player_really_called_like_a_pseudonym_is_not_confused_with_one', () => {
    // The pseudonym luigi would get, taken by a real player of the run.
    const real = new PseudonymSource(SALT, new Set()).for('user:luigi');
    const out = run([
      reply(`@${real}, ciao`, { player: real }),
      reply('@luigi, ciao', { player: 'luigi' }),
    ]);
    const [p, luigi] = out.replies.map((r) => r.context.player) as [string, string];
    expect([p, luigi]).not.toContain(real);
    expect(p).not.toBe(luigi);
  });
});

describe('phases 2 and 3 together', () => {
  it('nothing_of_the_other_players_leaves_the_phase', () => {
    const dm = new Chat(BOT, 100);
    dm.user('Daniele', '/inventario', 0);
    dm.bot(INV('djjeck'), 1);
    const g = new Chat('Gruppo Avventurieri', 500);
    const t = votes(g, 'Luigi Verdi', 'luigi', 3, 10);
    g.user('Mario Rossi', '/avventura', t);
    g.bot(DROP('mario'), t + 1);
    const conversation = readConversation([...dm.clean(), ...g.clean()], BOT, TEST_DIALECT);
    const owner = ownerFromDm(conversation.replies.map((r) => r.context));
    expect(owner).toBe('djjeck');
    const out = anonymise(conversation, {
      owner,
      botName: BOT,
      dialect: TEST_DIALECT,
      salt: SALT,
      groupChats: ['Gruppo Avventurieri'],
    });
    const text = JSON.stringify([...out.conversation.replies, ...out.conversation.senders]);
    // Usernames, display names (the owner's included) and the group's title.
    expect(text).not.toMatch(/luigi|mario|daniele|avventurieri/iu);
    expect(text).toContain('"player":"djjeck"');
    expect(out.chatTitle('Gruppo Avventurieri')).toMatch(/^Gruppo [A-Z][a-z]+[A-Z][a-z]+$/u);
  });
});
