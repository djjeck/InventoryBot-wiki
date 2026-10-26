/** Phase 2 as a whole (readConversation), on the test bot's dialect. */
import { describe, expect, it } from 'vitest';
import { type Message } from '#src/telegram/messages.ts';
import {
  ANONYMOUS,
  DROP,
  INV,
  keyedVotes,
  TEST_DIALECT,
  TOO_EARLY,
  votes,
} from '#test/conversation.ts';
import { BOT, Chat } from '#test/helpers.ts';
import { type Conversation, matchReportLines, readConversation } from './conversation.ts';

const converse = (messages: readonly Message[]): Conversation =>
  readConversation(messages, BOT, TEST_DIALECT);

/** [match, query] of every reply. */
const pairs = (c: Conversation): [string | null, string | null][] =>
  c.replies.map((r) => [r.context.match, r.context.query]);

describe('pairing', () => {
  it('every_dm_reply_belongs_to_the_latest_command', () => {
    const dm = new Chat(BOT);
    dm.bot(DROP('djjeck'), 0); // before any command
    dm.user('Daniele', '/esamina sasso', 1);
    dm.user('Daniele', '/avventura', 2);
    dm.bot(DROP('djjeck'), 3);
    dm.bot('Livello raggiunto!', 4);
    const c = converse(dm.clean());
    expect(pairs(c)).toStrictEqual([
      ['dm', null],
      ['dm', '/avventura'],
      ['dm', '/avventura'],
    ]);
    // An unaddressed reply takes the player of its command: the DM's owner.
    expect(c.replies.map((r) => r.context.player)).toStrictEqual(['djjeck', 'djjeck', 'djjeck']);
  });

  it('quoted_command_in_a_group', () => {
    const g = new Chat('G');
    g.user('Luigi', '/inventario', 0);
    g.user('Mario', '/inventario', 1);
    g.bot(INV('luigi'), 2, { reply_to: 1000 });
    const c = converse(g.clean());
    expect(pairs(c)).toStrictEqual([['reply', '/inventario']]);
    expect(matchReportLines(c.replies)).toStrictEqual([
      '  G: risposte del bot abbinate a un comando: reply=1',
    ]);
  });

  it('learned_names_pair_by_user', () => {
    const g = new Chat('G');
    const t = votes(g, 'Mario', 'mario', 3, 0); // teaches Mario -> @mario
    g.user('Mario', '/avventura', t);
    g.user('Luigi', '/avventura', t + 1);
    g.bot(DROP('mario'), t + 2);
    g.bot(DROP('luigi'), t + 3);
    const c = converse(g.clean());
    expect(c.replies.map((r) => r.context.match)).toStrictEqual([
      'user',
      'user',
      'user',
      'user',
      'single',
    ]);
    expect(matchReportLines(c.replies)).toStrictEqual([
      '  G: risposte del bot abbinate a un comando: user=4, single=1',
    ]);
    expect(Object.fromEntries(c.senders)).toStrictEqual({ Mario: 'mario' });
  });

  it('an_unaddressed_reply_takes_the_player_of_its_command', () => {
    const g = new Chat('G');
    const t = votes(g, 'Mario', 'mario', 3, 0);
    g.user('Mario', '/avventura', t);
    g.bot(TOO_EARLY, t + 1);
    // Paired as the only candidate (it names nobody), then given its command's player.
    expect(converse(g.clean()).replies.at(-1)?.context).toMatchObject({
      player: 'mario',
      match: 'single',
    });
  });

  it('an_anonymous_reply_has_no_player_even_when_its_command_is_known', () => {
    const g = new Chat('G');
    const t = votes(g, 'Mario', 'mario', 3, 0);
    g.user('Mario', '/avventura', t);
    g.bot(ANONYMOUS, t + 1);
    expect(converse(g.clean()).replies.at(-1)?.context).toMatchObject({
      player: null,
      match: 'single',
      query: '/avventura',
    });
  });
});

describe('attached files', () => {
  it('a_reply_keeps_the_text_of_its_file', () => {
    const dm = new Chat(BOT);
    dm.user('Daniele', '/esporta', 0);
    dm.bot(DROP('djjeck'), 1);
    dm.bot(DROP('djjeck'), 2);
    const [cmd, withFile, without] = dm.clean() as [Message, Message, Message];
    const c = converse([cmd, { ...withFile, file_text: 'riga 1\n' }, without]);
    expect(c.replies.map((r) => r.file_text)).toStrictEqual(['riga 1\n', undefined]);
    expect(c.replies[1]).not.toHaveProperty('file_text');
  });
});

describe('ignored messages', () => {
  it('chat_other_bots_and_forwarded_commands_ignored', () => {
    const g = new Chat('G');
    g.user('Luigi', "ciao, faccio un'avventura", 0);
    g.user('Luigi', '/avventura@AltroBot', 1);
    g.forward('Luigi', 'Anna', '/avventura', 2);
    g.bot(DROP('luigi'), 3);
    const c = converse(g.clean());
    expect(pairs(c)).toStrictEqual([[null, null]]);
    expect(matchReportLines(c.replies)).toStrictEqual([
      '  G: risposte del bot abbinate a un comando: unmatched=1',
    ]);
  });

  it('a_command_for_the_bot_by_name_is_kept', () => {
    const g = new Chat('G');
    g.user('Luigi', '/avventura@InventoryBot', 0);
    g.bot(DROP('luigi'), 1);
    expect(pairs(converse(g.clean()))).toStrictEqual([['single', '/avventura']]);
  });

  it('command_answers_at_most_once', () => {
    const g = new Chat('G');
    g.user('Luigi', '/avventura', 0);
    g.bot(DROP('luigi'), 1);
    g.bot(DROP('luigi'), 2);
    expect(converse(g.clean()).replies.map((r) => r.context.match)).toStrictEqual(['single', null]);
  });

  it('forwarded_bot_reply_not_matched', () => {
    const g = new Chat('G');
    g.user('Luigi', '/avventura', 0);
    g.forward('Luigi', BOT, DROP('luigi'), 1);
    g.bot(DROP('luigi'), 2);
    const c = converse(g.clean());
    expect(c.replies.map((r) => [r.context.forwarded, r.context.match])).toStrictEqual([
      [true, null],
      [false, 'single'],
    ]);
    expect(matchReportLines(c.replies)).toStrictEqual([
      '  G: risposte del bot abbinate a un comando: single=1',
    ]);
  });

  it('broadcasts_answer_no_command', () => {
    const g = new Chat('G');
    g.user('Luigi', '/avventura', 0);
    g.bot('[W] Evento speciale nel bosco!', 1);
    g.bot('[N] Benvenuto @nuovo!', 2);
    g.bot(DROP('luigi'), 3);
    const c = converse(g.clean());
    expect(c.replies.map((r) => [r.text, r.context.broadcast, r.context.match])).toStrictEqual([
      ['Evento speciale nel bosco!', true, null], // its prefix removed by the dialect
      ['[N] Benvenuto @nuovo!', true, null],
      [DROP('luigi'), false, 'single'],
    ]);
    const dm = new Chat(BOT);
    dm.bot('[W] Solo nei gruppi', 0); // never a broadcast in the DM
    expect(converse(dm.clean()).replies[0]?.context.broadcast).toBe(false);
  });
});

describe('senders', () => {
  it('replies_are_read_as_the_dialect_normalises_them', () => {
    const dm = new Chat(BOT);
    dm.user('Daniele', '/avventura', 0);
    dm.bot('** @djjeck **, nel bosco trovi un sasso [C]!', 1);
    expect(converse(dm.clean()).replies[0]).toMatchObject({
      text: '@djjeck, nel bosco trovi un sasso [C]!',
      context: { player: 'djjeck' },
    });
  });

  it('the_dm_pairs_the_owner_name_with_their_username', () => {
    const dm = new Chat(BOT, 100);
    dm.user('Daniele', '/avventura', 0);
    dm.bot(DROP('djjeck'), 1);
    const g = new Chat('G', 500);
    g.user('Daniele', '/avventura', 100);
    g.user('Mario', '/avventura', 101);
    g.bot(DROP('djjeck'), 102);
    const c = converse([...dm.clean(), ...g.clean()]);
    expect(Object.fromEntries(c.senders)).toStrictEqual({ Daniele: 'djjeck' });
    const group = c.replies.filter((r) => !r.context.dm).map((r) => r.context);
    expect(group.map((x) => [x.match, x.player, x.query])).toStrictEqual([
      ['user', 'djjeck', '/avventura'],
    ]);
  });

  it('the_dm_owner_key_reaches_group_commands_by_name', () => {
    const dm = new Chat(BOT, 100);
    dm.user('Daniele', '/avventura', 0).sender_key = 'u1';
    dm.bot(DROP('djjeck'), 1).sender_key = 'u2';
    const g = new Chat('G', 500);
    g.user('Daniele', '/avventura', 100);
    g.user('Mario', '/avventura', 101);
    g.bot(DROP('djjeck'), 102);
    const c = converse([...dm.clean(), ...g.clean()]);
    const group = c.replies.filter((r) => !r.context.dm).map((r) => r.context);
    expect(group.map((x) => [x.match, x.player])).toStrictEqual([['user', 'djjeck']]);
  });

  it('same_display_name_told_apart_by_key_and_keys_never_leave_the_phase', () => {
    const g = new Chat('G');
    let t = keyedVotes(g, 'Andrea', 'u1', 'andrea_rossi', 4, 0);
    t = keyedVotes(g, 'Andrea', 'u2', 'andrea_bianchi', 4, t);
    keyedVotes(g, 'Andrea', 'u1', 'andrea_rossi', 1, t);
    const c = converse(g.clean());
    expect(c.senders.size).toBe(2);
    expect(new Set(c.replies.map((r) => r.context.match))).toStrictEqual(new Set(['user']));
    expect(JSON.stringify(c.replies)).not.toContain('u1');
  });

  it('same_display_name_for_two_people_pairs_but_never_by_user', () => {
    const g = new Chat('G');
    const t = votes(g, 'Andrea', 'andrea_rossi', 4, 0);
    votes(g, 'Andrea', 'andrea_bianchi', 4, t);
    const c = converse(g.clean());
    expect(c.senders.size).toBe(0);
    expect(new Set(c.replies.map((r) => r.context.match))).toStrictEqual(new Set(['single']));
  });
});

describe('dialect', () => {
  it('compatible_commands_asked_once_per_text', () => {
    const g = new Chat('G');
    g.user('Mario', '/avventura', 0);
    g.bot(DROP('mario'), 1);
    g.user('Mario', '/avventura', 2);
    g.bot(DROP('mario'), 3);
    g.bot(TOO_EARLY, 4);
    const asked: string[] = [];
    const c = readConversation(g.clean(), BOT, {
      ...TEST_DIALECT,
      compatibleCommands: (text) => {
        asked.push(text);
        return TEST_DIALECT.compatibleCommands(text);
      },
    });
    expect(pairs(c)).toStrictEqual(pairs(converse(g.clean())));
    expect(asked).toStrictEqual([DROP('mario'), TOO_EARLY]);
  });
});
