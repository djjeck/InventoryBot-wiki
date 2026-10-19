/** CommandMatcher: which command a bot reply answers, on the test bot's dialect. */
import { describe, expect, it } from 'vitest';
import { type Message } from '#src/telegram/messages.ts';
import { DROP, GIVE, INV, TEST_DIALECT, TOO_EARLY } from '#test/conversation.ts';
import { BOT, Chat } from '#test/helpers.ts';
import { type Command, CommandMatcher, type MatchKind } from './matcher.ts';

function matcher(names: Record<string, string> = {}): CommandMatcher {
  return new CommandMatcher(new Map(Object.entries(names)), TEST_DIALECT.groupWindow);
}

function match(cm: CommandMatcher, reply: Message): [Command | null, MatchKind | null] {
  return cm.match(
    reply,
    TEST_DIALECT.addressee(reply.text),
    TEST_DIALECT.compatibleCommands(reply.text)
  );
}

/** [command id, how] of a match. */
const idHow = ([c, how]: [Command | null, MatchKind | null]): [
  number | undefined,
  MatchKind | null,
] => [c?.id, how];

describe('DM', () => {
  it('dm_reply_belongs_to_latest_command', () => {
    const dm = new Chat(BOT);
    const cm = matcher();
    cm.command(dm.user('Daniele', '/esamina sasso', 0));
    const last = dm.user('Daniele', '/inventario', 1);
    cm.command(last);
    const reply = dm.bot(INV('djjeck'), 500); // no window in the DM
    expect(idHow(match(cm, reply))).toStrictEqual([last.id, 'dm']);
  });

  it('dm_reply_before_any_command', () => {
    const dm = new Chat(BOT);
    expect(match(matcher(), dm.bot(DROP('djjeck'), 0))).toStrictEqual([null, 'dm']);
  });
});

describe('quoted command', () => {
  it('quoted_command_wins_even_outside_window', () => {
    const g = new Chat('G');
    const cm = matcher({ Mario: 'mario' });
    const quoted = g.user('Luigi', '/avventura', 0);
    cm.command(quoted);
    cm.command(g.user('Mario', '/avventura', 990));
    const reply = g.bot(DROP('mario'), 1000, { reply_to: quoted.id });
    expect(idHow(match(cm, reply))).toStrictEqual([quoted.id, 'reply']);
  });

  it('reply_to_unknown_message_falls_back', () => {
    const g = new Chat('G');
    const cm = matcher();
    const cmd = g.user('Luigi', '/avventura', 0);
    cm.command(cmd);
    const reply = g.bot(DROP('luigi'), 5, { reply_to: 424242 });
    expect(idHow(match(cm, reply))).toStrictEqual([cmd.id, 'single']);
  });
});

describe('command of the addressed player', () => {
  it('oldest_unanswered_command_of_the_mapped_name', () => {
    const g = new Chat('G');
    const cm = matcher({ Mario: 'mario' });
    const first = g.user('Mario', '/avventura', 0);
    const luigi = g.user('Luigi', '/avventura', 5);
    const second = g.user('Mario', '/avventura', 10);
    for (const c of [first, luigi, second]) cm.command(c);
    const r1 = g.bot(DROP('mario'), 20);
    const r2 = g.bot(DROP('mario'), 21);
    expect([idHow(match(cm, r1)), idHow(match(cm, r2))]).toStrictEqual([
      [first.id, 'user'],
      [second.id, 'user'],
    ]);
    expect((cm.pending.get('G') ?? []).filter((c) => c.answered).map((c) => c.id)).not.toContain(
      luigi.id
    );
  });
});

describe('only candidate', () => {
  it('only_unanswered_command', () => {
    const g = new Chat('G');
    const cm = matcher();
    const cmd = g.user('Luigi', '/avventura', 0);
    cm.command(cmd);
    expect(idHow(match(cm, g.bot(DROP('luigi'), 3)))).toStrictEqual([cmd.id, 'single']);
  });

  it('ambiguous_when_several', () => {
    const g = new Chat('G');
    const cm = matcher();
    cm.command(g.user('Luigi', '/avventura', 0));
    cm.command(g.user('Anna', '/avventura', 1));
    expect(match(cm, g.bot(DROP('luigi'), 3))).toStrictEqual([null, null]);
  });

  it('mapped_names_excluded_from_single', () => {
    const g = new Chat('G');
    const cm = matcher({ Mario: 'mario' });
    cm.command(g.user('Mario', '/avventura', 0));
    const luigi = g.user('Luigi', '/avventura', 1);
    cm.command(luigi);
    expect(idHow(match(cm, g.bot(DROP('luigi'), 3)))).toStrictEqual([luigi.id, 'single']);
  });

  it('known_player_without_compatible_command_is_not_matched', () => {
    const g = new Chat('G');
    const cm = matcher({ Mario: 'mario' });
    cm.command(g.user('Mario', '/inventario', 0));
    cm.command(g.user('Luigi', '/avventura', 1)); // the only compatible one, but not Mario's
    expect(match(cm, g.bot(DROP('mario'), 3))).toStrictEqual([null, null]);
  });

  it('unaddressed_reply_single', () => {
    const g = new Chat('G');
    const cm = matcher({ Mario: 'mario' });
    const cmd = g.user('Mario', '/avventura', 0);
    cm.command(cmd);
    expect(idHow(match(cm, g.bot(TOO_EARLY, 3)))).toStrictEqual([cmd.id, 'single']);
  });
});

describe('compatible commands', () => {
  it('give_reply_not_matched_to_inventory', () => {
    const g = new Chat('G');
    const cm = matcher();
    cm.command(g.user('Luigi', '/inventario', 0));
    expect(match(cm, g.bot(GIVE('luigi'), 3))).toStrictEqual([null, null]);
  });

  it('give_reply_matched_to_dai', () => {
    const g = new Chat('G');
    const cm = matcher();
    cm.command(g.user('Luigi', '/inventario', 0));
    const dai = g.user('Anna', '/dai 1 bottone @zeta', 1);
    cm.command(dai);
    expect(idHow(match(cm, g.bot(GIVE('luigi'), 3)))).toStrictEqual([dai.id, 'single']);
  });

  it('command_case_insensitive', () => {
    const g = new Chat('G');
    const cm = matcher();
    cm.command(g.user('Luigi', '/Avventura', 0));
    expect(match(cm, g.bot(DROP('luigi'), 3))[1]).toBe('single');
  });
});

describe('group window', () => {
  const one = (delay: number): MatchKind | null => {
    const g = new Chat('G');
    const cm = matcher();
    cm.command(g.user('Luigi', '/avventura', 0));
    return match(cm, g.bot(DROP('luigi'), delay))[1];
  };

  it('at_window_edge', () => {
    expect(one(TEST_DIALECT.groupWindow)).toBe('single');
  });

  it('older_than_window', () => {
    expect(one(TEST_DIALECT.groupWindow + 1)).toBeNull();
  });

  it('command_after_reply', () => {
    expect(one(-1)).toBeNull();
  });
});
