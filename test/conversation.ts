/**
 * Fixtures for the tests of the generic conversation phase (phase 2):
 *
 * - TEST_DIALECT: a synthetic BotDialect, a few fixed rules for a made-up bot whose
 *   replies look like InventoryBot's, so that the generic code (phases 2 and 3) is tested
 *   without the game's own dialect; DROP, INV… build replies it recognises.
 * - votes(), keyedVotes(): commands answered by replies, which teach the display name
 *   -> @username map.
 *
 * No vitest imports here.
 */
import { type BotDialect } from '#src/telegram/conversation/dialect.ts';
import { type Chat } from './helpers.ts';

/** An adventure find, answering `/avventura`. */
export const DROP = (u: string): string => `@${u}, nel bosco trovi un sasso [C]!`;
/** An inventory, answering `/inventario`. */
export const INV = (u: string): string => `@${u}, possiedi:\n- un sasso [C] x1`;
/** A gift to another player, answering `/dai`. */
export const GIVE = (u: string): string => `@${u}, dai 1x un bottone a @zeta`;
/** A cooldown, addressed to nobody, answering `/avventura`. */
export const TOO_EARLY = 'Troppo presto! Riprova tra 5 minuti';
/** A reply to a player the bot does not name. */
export const ANONYMOUS = '[anonimo], nel bosco trovi un sasso [C]!';

/** Reply patterns and the commands that can produce them, in order. */
const COMPATIBLE: readonly [RegExp, ReadonlySet<string>][] = [
  [/ trovi /, new Set(['/avventura'])],
  [/^Troppo presto!/, new Set(['/avventura'])],
  [/, possiedi:\n/, new Set(['/inventario'])],
  [/, dai \d+x /, new Set(['/dai'])],
  [/, per fare .* ti manca:/, new Set(['/ricetta', '/esamina'])],
  [/^Livello raggiunto!/, new Set()],
];

const ADDRESSEE = /^@(\w+)[, ]/u;
/** The players a reply designates: whom it addresses (also in stats and gift notices) and a gift's receiver. */
const DESIGNATED = [/^(?:\[N\] |Avventuriero )?@(\w+)/du, /, dai \d+x .+ a @(\w+)$/dmu];

/**
 * The test bot's dialect. In groups, `[W] ` starts a broadcast and is removed from it;
 * `[N] ` starts one and is kept. `** ` around a username is a decoration, removed by
 * normalizeReply. Its admin, `guardiano`, is a public name; `/dai` and `/stats` take a
 * player as argument.
 */
export const TEST_DIALECT: BotDialect = {
  normalizeReply: (text) => text.replace(/^\*\* (@\w+) \*\*/u, '$1'),
  compatibleCommands: (text) => COMPATIBLE.find(([re]) => re.test(text))?.[1] ?? null,
  addressee: (text) => ADDRESSEE.exec(text)?.[1] ?? null,
  isAnonymous: (text) => text.startsWith('[anonimo]'),
  broadcast: (text) =>
    text.startsWith('[W] ') ? text.slice(4) : text.startsWith('[N] ') ? text : null,
  unmappableNames: new Set(['Admin']),
  groupWindow: 120,
  publicNames: new Set(['guardiano']),
  userSpans: (text) =>
    DESIGNATED.flatMap((re) => {
      const span = re.exec(text)?.indices?.[1];
      return span ? [span] : [];
    }),
  userArguments: (query) =>
    /^\/(?:dai|stats)(?=\s|$)/iu.test(query) ? query.search(/\s|$/u) : null,
};

/** `n` commands from `sender`, each answered with a reply addressed to `user`, 300 s apart. */
export function votes(
  chat: Chat,
  sender: string,
  user: string,
  n: number,
  t0: number,
  cmd = '/avventura',
  reply = DROP
): number {
  let t = t0;
  for (let i = 0; i < n; i++) {
    chat.user(sender, cmd, t);
    chat.bot(reply(user), t + 1);
    t += 300;
  }
  return t;
}

/** votes(), with the opaque sender key a macOS export gives the commands' sender. */
export function keyedVotes(
  chat: Chat,
  sender: string,
  key: string,
  user: string,
  n: number,
  t0: number
): number {
  const from = chat.messages.length;
  const t = votes(chat, sender, user, n, t0);
  for (const m of chat.messages.slice(from)) if (!m.from_bot) m.sender_key = key;
  return t;
}
