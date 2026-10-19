/** Who sent each message, and which @username each group sender is (senders.ts). */
import { describe, expect, it } from 'vitest';
import { type Message } from '#src/telegram/messages.ts';
import { DROP, keyedVotes, TEST_DIALECT, votes } from '#test/conversation.ts';
import { BOT, Chat } from '#test/helpers.ts';
import { learnDisplayNames, senderIdentity, shareSenderKeys, unmappableNames } from './senders.ts';

const learn = (chat: Chat, seed: Record<string, string> = {}): Record<string, string> =>
  Object.fromEntries(learnDisplayNames(chat.clean(), new Map(Object.entries(seed)), TEST_DIALECT));

const msg = (chat: string, sender: string, key?: string): Message => ({
  chat,
  dm: false,
  id: 1,
  date: null,
  from_bot: false,
  sender,
  forwarded_from: null,
  reply_to: null,
  text: 'x',
  ...(key === undefined ? {} : { sender_key: key }),
});

describe('display names', () => {
  it('three_votes_needed', () => {
    const g = new Chat('G');
    const t = votes(g, 'Mario', 'mario', 3, 0);
    votes(g, 'Luigi', 'luigi', 2, t);
    expect(learn(g)).toStrictEqual({ Mario: 'mario' });
  });

  it('share_at_least_60_percent', () => {
    const g = new Chat('G');
    let t = votes(g, 'Mario', 'mario', 3, 0);
    votes(g, 'Mario', 'luigi', 2, t); // 3/5 = 60%: mapped
    const h = new Chat('H');
    t = votes(h, 'Mario', 'mario', 3, 0);
    votes(h, 'Mario', 'luigi', 3, t); // 50%: not mapped
    expect(learn(g)).toStrictEqual({ Mario: 'mario' });
    expect(learn(h)).toStrictEqual({});
  });

  it('one_name_per_username', () => {
    const g = new Chat('G');
    const t = votes(g, 'Mario', 'mario', 5, 0);
    votes(g, 'Mario R', 'mario', 3, t);
    expect(learn(g)).toStrictEqual({ Mario: 'mario' });
  });

  it('deleted_account_and_the_dialects_names_never_mapped', () => {
    const g = new Chat('G');
    const t = votes(g, 'Deleted Account', 'ghost', 6, 0);
    votes(g, 'Admin', 'admin', 6, t);
    expect(learn(g)).toStrictEqual({});
    expect(unmappableNames(TEST_DIALECT)).toStrictEqual(new Set(['Deleted Account', 'Admin']));
  });

  it('seed_kept', () => {
    const g = new Chat('G');
    const t = votes(g, 'Daniele', 'luigi', 5, 0); // the seed's name votes elsewhere
    votes(g, 'Dani alt', 'djjeck', 5, t); // another name for the seeded username
    expect(learn(g, { Daniele: 'djjeck' })).toStrictEqual({ Daniele: 'djjeck' });
  });

  it('order_of_messages_does_not_matter', () => {
    const a = new Chat('G');
    let t = votes(a, 'Mario', 'luigi', 1, 0); // an early wrong vote
    t = votes(a, 'Mario', 'mario', 3, t);
    votes(a, 'Luigi', 'luigi', 3, t);
    const b = new Chat('G');
    t = votes(b, 'Luigi', 'luigi', 3, 0);
    t = votes(b, 'Mario', 'mario', 3, t);
    votes(b, 'Mario', 'luigi', 1, t);
    expect(learn(a)).toStrictEqual({ Mario: 'mario', Luigi: 'luigi' });
    // As key-value sets, not by key order.
    expect(learn(a)).toEqual(learn(b));
  });

  it('vote_goes_to_nearest_compatible_command', () => {
    const g = new Chat('G');
    let t = 0;
    for (let i = 0; i < 3; i++) {
      g.user('Mario', '/avventura', t);
      g.user('Luigi', '/inventario', t + 1); // closer, but cannot produce a find
      g.bot(DROP('mario'), t + 2);
      t += 300;
    }
    expect(learn(g)).toStrictEqual({ Mario: 'mario' });
  });

  it('same_display_name_for_two_people_maps_to_nobody', () => {
    const g = new Chat('G');
    let t = votes(g, 'Andrea', 'andrea_rossi', 4, 0);
    t = votes(g, 'Andrea', 'andrea_bianchi', 4, t);
    votes(g, 'Andrea', 'andrea_rossi', 1, t); // 5 vs 4: 56%, below 60%
    expect(learn(g)).toStrictEqual({});
  });

  it('dm_and_forwarded_do_not_vote', () => {
    const g = new Chat('G');
    let t = 0;
    for (let i = 0; i < 3; i++) {
      g.user('Mario', '/avventura', t);
      g.forward('Mario', BOT, DROP('mario'), t + 1);
      t += 300;
    }
    const dm = new Chat(BOT);
    votes(dm, 'Mario', 'mario', 3, 0);
    expect(
      Object.fromEntries(learnDisplayNames([...g.clean(), ...dm.clean()], new Map(), TEST_DIALECT))
    ).toStrictEqual({});
  });
});

describe('sender keys', () => {
  it('same_display_name_told_apart_by_key', () => {
    const g = new Chat('G');
    let t = keyedVotes(g, 'Andrea', 'u1', 'andrea_rossi', 4, 0);
    t = keyedVotes(g, 'Andrea', 'u2', 'andrea_bianchi', 4, t);
    keyedVotes(g, 'Andrea', 'u1', 'andrea_rossi', 1, t);
    const learned = learnDisplayNames(g.clean(), new Map(), TEST_DIALECT);
    expect([...learned.values()].sort()).toStrictEqual(['andrea_bianchi', 'andrea_rossi']);
  });

  it('unkeyed_messages_share_the_only_key_of_their_name', () => {
    const g = new Chat('G');
    const t = keyedVotes(g, 'Mario', 'u1', 'mario', 2, 0); // the macOS export
    votes(g, 'Mario', 'mario', 2, t); // the Windows export: same person, no key
    const shared = shareSenderKeys(g.clean());
    expect(new Set(shared.filter((m) => !m.from_bot).map(senderIdentity))).toStrictEqual(
      new Set(['\u0000u1'])
    );
  });

  it('name_with_several_keys_or_deleted_stays_a_name', () => {
    const out = shareSenderKeys([
      msg('G', 'Andrea', 'u1'),
      msg('G', 'Andrea', 'u2'),
      msg('G', 'Andrea'),
      msg('G', 'Deleted Account', 'u3'),
      msg('G', 'Deleted Account'),
    ]);
    expect(out.map(senderIdentity)).toStrictEqual([
      '\u0000u1',
      '\u0000u2',
      'Andrea',
      '\u0000u3',
      'Deleted Account',
    ]);
  });

  it('the_key_in_the_same_chat_comes_first', () => {
    const out = shareSenderKeys([
      msg('G', 'Mario', 'u1'),
      msg('H', 'Mario', 'u2'),
      msg('G', 'Mario'),
      msg('H', 'Mario'),
      msg('K', 'Mario'),
    ]);
    // In K the name has no key and two elsewhere: it stays a name.
    expect(out.map(senderIdentity)).toStrictEqual([
      '\u0000u1',
      '\u0000u2',
      '\u0000u1',
      '\u0000u2',
      'Mario',
    ]);
  });
});
