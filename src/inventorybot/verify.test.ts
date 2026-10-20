/** verify.ts, through interpretReplies: group pairs checked against the classified reply. */
import { describe, expect, it } from 'vitest';
import { type BotReply, type ReplyContext } from '#src/telegram/conversation/conversation.ts';
import { runBuild } from '#test/build.ts';
import { BASE, BOT, Chat, tgDate } from '#test/helpers.ts';
import { runExtract } from '#test/interpret.ts';
import * as T from '#test/texts.ts';
import { interpretationReport, interpretReplies } from './extract.ts';
import { type BuildEvent, type EventRecord } from './types.ts';

let msgCounter = 70000;

/** A reply as phase 2 leaves it; by default in a group, paired by sender. */
function reply(
  text: string,
  query: string | null,
  o: Partial<ReplyContext> & { t?: number } = {}
): BotReply {
  const { t, ...context } = o;
  const dm = context.dm ?? false;
  return {
    text,
    context: {
      chat: dm ? BOT : 'Gruppo',
      dm,
      msg: ++msgCounter,
      date: tgDate(t ?? 0, BASE),
      player: /^@(\w+)/u.exec(text)?.[1] ?? null,
      query,
      match: dm ? 'dm' : query === null ? null : 'user',
      forwarded: false,
      broadcast: false,
      ...context,
    },
  };
}

const field = (e: EventRecord | undefined, k: string): unknown =>
  (e as unknown as Record<string, unknown> | undefined)?.[k];

const VUVU = 'una vuvuzela 🎺';
const LAMP = 'una lampada magica';
const INV = reply(
  T.inventory([
    [VUVU, 'X', 1, true],
    [LAMP, 'X', 1, true],
  ]),
  '/inventario',
  { dm: true }
);
const TOOT = '@mario, soffi con tutto il fiato e .. 🎺 TUUUU';
const toots = (o: Partial<ReplyContext> = {}): BotReply[] =>
  Array.from({ length: 10 }, (_, i) => reply(TOOT, '/usa vuvu', { t: 10 + i, ...o }));

describe('command family', () => {
  it('group_reply_outside_the_command_family_is_dissolved', () => {
    const drop = reply('@mario, nel bosco trovi un sasso [C]!', '/inventario', { match: 'single' });
    const { events, summary, entries } = interpretReplies([drop]);
    expect(events[0]).toMatchObject({
      type: 'drop',
      query: null,
      match: 'dissolved',
      player: 'mario',
    });
    expect(entries).toStrictEqual([
      {
        kind: 'dissolved_pair',
        reason: 'command',
        match: 'single',
        query: '/inventario',
        type: 'drop',
        text: 'nel bosco trovi un sasso [C]!',
      },
    ]);
    expect(summary).toContain(
      '  coppie nei gruppi verificate dalla risposta: confermate=0, sciolte=1'
    );
  });

  it('dm_and_quoted_pairs_are_not_checked', () => {
    const text = '@mario, nel bosco trovi un sasso [C]!';
    const { events, summary, entries } = interpretReplies([
      reply(text, '/inventario', { dm: true }),
      reply(text, '/inventario', { match: 'reply' }),
    ]);
    expect(events.map((e) => [e.query, e.match])).toStrictEqual([
      ['/inventario', 'dm'],
      ['/inventario', 'reply'],
    ]);
    expect(entries).toStrictEqual([]);
    expect(summary.some((l) => l.includes('verificate'))).toBe(false);
  });

  it('types_read_with_the_command_are_of_its_family', () => {
    // A /usa reply is a use only with its command, a narrated arrival only with its /viaggio: both fit.
    const { events, summary } = interpretReplies([
      reply('@mario, accendi la lanterna e la stanza si illumina', '/usa lanterna'),
      reply('@mario, segui il sentiero e sbuchi alla radura', '/viaggio radura', {
        match: 'single',
      }),
    ]);
    expect(events.map((e) => [e.type, e.match])).toStrictEqual([
      ['use', 'user'],
      ['travel', 'single'],
    ]);
    expect(summary).toContain(
      '  coppie nei gruppi verificate dalla risposta: confermate=2, sciolte=0'
    );
  });
});

describe('dissolved pairs', () => {
  it('unaddressed_dissolved_reply_loses_the_player_of_its_command', () => {
    const tooEarly = 'Troppo presto, devi riposare ancora per 9 minuti e 29 secondi';
    const { events } = interpretReplies([
      reply(tooEarly, '/inventario', { player: 'mario' }),
      reply(tooEarly, '/avventura', { player: 'mario' }),
    ]);
    expect(events.map((e) => [e.type, e.player, e.match])).toStrictEqual([
      ['cooldown', null, 'dissolved'],
      ['cooldown', 'mario', 'user'],
    ]);
  });

  it('fixed_reply_of_another_command_is_dissolved', () => {
    // Read with /viaggio, an item ambiguity is still an item ambiguity, which /viaggio never gives.
    const odd = reply('troppi oggetti trovati con quel nome(sasso)', '/viaggio sasso');
    const { events, entries } = interpretReplies([odd]);
    expect(events[0]).toMatchObject({ type: 'miss', query: null, match: 'dissolved' });
    expect(entries).toMatchObject([{ kind: 'dissolved_pair', type: 'miss' }]);
  });

  it('report_entries_follow_the_summary_lines', () => {
    const odd = reply('@mario, nel bosco trovi un sasso [C]!', '/inventario');
    expect(interpretationReport(interpretReplies([odd]))).toStrictEqual([
      'eventi: drop=1',
      '  coppie nei gruppi verificate dalla risposta: confermate=0, sciolte=1',
      '-- dissolved_pair: 1',
      '  dissolved_pair: reason="command" match="user" query="/inventario" type="drop" text="nel bosco trovi un sasso [C]!"',
    ]);
  });

  it('dissolved_reply_is_read_without_its_command', () => {
    const odd = reply('@mario, cosa desideri?', '/usa vuvu', { t: 100 });
    const lamp = reply('@luigi, cosa desideri?', '/usa lampada', { t: 110 });
    const { events } = interpretReplies([INV, ...toots(), odd, lamp]);
    // Without "/usa" the reply is not recognised: it keeps its text, as any unpaired reply.
    expect(events[11]).toStrictEqual({
      type: 'unknown',
      ...odd.context,
      query: null,
      match: 'dissolved',
      text: '@mario, cosa desideri?',
    });
  });

  it('dissolved_command_is_not_offered_again', () => {
    // Phase 2 has already paired every reply: the command of a dissolved pair stays answered.
    const g = new Chat('Gruppo');
    g.user('Mario', '/inventario', 0);
    g.bot(
      T.inventory(
        [
          [VUVU, 'X', 1, true],
          [LAMP, 'X', 1, true],
        ],
        'mario'
      ),
      1
    );
    for (let i = 0; i < 10; i++) {
      g.user('Mario', '/usa vuvu', 10 + i * 5);
      g.bot(TOOT, 11 + i * 5);
    }
    g.user('Mario', '/usa vuvu', 100);
    g.bot('@mario, cosa desideri?', 101);
    g.bot(TOOT, 102);
    g.user('Luigi', '/usa lampada', 300);
    g.bot('@luigi, cosa desideri?', 301);
    const { events, err } = runExtract(g.clean());
    expect(events.slice(-3).map((e) => [e.type, e.query, e.match])).toStrictEqual([
      ['unknown', null, 'dissolved'],
      ['unknown', null, null],
      ['use', '/usa lampada', 'single'],
    ]);
    expect(err).toContain('-- dissolved_pair: 1\n');
  });
});

describe('mispaired group uses', () => {
  const run = (
    replies: BotReply[]
  ): ReturnType<typeof interpretReplies> & ReturnType<typeof runBuild> => {
    const r = interpretReplies(replies);
    return { ...r, ...runBuild(r.events as BuildEvent[]) };
  };

  it('group_outlier_of_a_one_shape_item_is_dissolved', () => {
    // The vuvuzela always answers the same: a lamp's "cosa desideri?" paired with "/usa vuvu" in a group is a mispairing.
    const odd = reply('@mario, cosa desideri?', '/usa vuvu', { t: 100 });
    const lamp = reply('@luigi, cosa desideri?', '/usa lampada', { t: 110 });
    const { events, entries, wiki } = run([INV, ...toots(), odd, lamp]);
    expect(field(events[11], 'match')).toBe('dissolved');
    expect(entries).toStrictEqual([
      {
        kind: 'dissolved_pair',
        reason: 'use_item',
        match: 'user',
        query: '/usa vuvu',
        type: 'use',
        text: 'cosa desideri?',
      },
    ]);
    expect([
      wiki.items[VUVU]?.use?.observations,
      wiki.items[VUVU]?.use?.outcomes.length,
    ]).toStrictEqual([10, 1]);
    // Read without its command, the reply has the lamp's shape: phase 5 gives it to the lamp.
    expect(wiki.items[LAMP]?.use?.observations).toBe(2);
  });

  it('outlier_in_the_dm_is_kept', () => {
    const odd = reply('@mario, la vuvuzela si rompe!', '/usa vuvu', { t: 100, dm: true });
    const { entries, wiki } = run([INV, ...toots(), odd]);
    expect(entries).toStrictEqual([]);
    expect(wiki.items[VUVU]?.use?.outcomes.length).toBe(2);
  });

  it('quoted_outlier_is_kept', () => {
    const odd = reply('@mario, cosa desideri?', '/usa vuvu', { t: 100, match: 'reply' });
    const lamp = reply('@luigi, cosa desideri?', '/usa lampada', { t: 110 });
    const { entries, wiki } = run([INV, ...toots(), odd, lamp]);
    expect(entries).toStrictEqual([]);
    expect(wiki.items[VUVU]?.use?.observations).toBe(11);
  });

  it('item_with_varied_replies_keeps_its_group_outliers', () => {
    const varied = Array.from({ length: 4 }, (_, i) =>
      reply(`@mario, esprimi il desiderio numero ${'abcd'[i]}`, '/usa lampada', { t: 10 + i })
    );
    const odd = reply('@mario, cosa desideri?', '/usa lampada', { t: 100 });
    const { entries, wiki } = run([INV, ...varied, odd]);
    expect(entries).toStrictEqual([]);
    expect(wiki.items[LAMP]?.use?.observations).toBe(5);
  });
});
