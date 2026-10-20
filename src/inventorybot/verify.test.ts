/** verify.ts, through interpretReplies: group pairs checked against the classified reply. */
import { describe, expect, it } from 'vitest';
import { type BotReply, type ReplyContext } from '#src/telegram/conversation/conversation.ts';
import { BASE, BOT, tgDate } from '#test/helpers.ts';
import { interpretationReport, interpretReplies } from './extract.ts';

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
    expect(entries.map((e) => e.type)).toStrictEqual(['miss']);
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
});
