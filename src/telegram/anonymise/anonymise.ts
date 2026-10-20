/**
 * Phase 3: the conversation of phase 2 -> the same conversation with the identity of
 * every other player who acts or is designated replaced by a pseudonym. Generic: what a
 * reply designates comes from its BotDialect (`userSpans`, `userCommands`,
 * `publicNames`). Pure logic, no Node APIs.
 *
 * Replaced, with one mapping per run:
 * - `player`, the player a reply belongs to;
 * - in the text, the usernames the dialect designates (userSpans: the addressee, the
 *   other party of an action), and nothing else;
 * - in `query`, for the dialect's `userCommands` only, the @usernames among the arguments
 *   and the known usernames written there without `@` (whole words, ignoring case);
 * - `chat` for a group: `Gruppo <pseudonym>`. The DM keeps its title.
 * Every other username in a text (leaderboards, item names, announcements, group names
 * the bot lists) is part of what the bot says and stays as written.
 *
 * The mapping is built before anything is rewritten, in order of first appearance: in
 * reply order, for each reply its group chat, its `player`, the @usernames of its query's
 * arguments (userCommands), its designated usernames; then the usernames phase 2 mapped
 * display names to; then the groups without replies. Each takes the pseudonym of its
 * salted hash (PseudonymSource), except the owner, the bot and the dialect's public
 * names; the order only decides who keeps a pseudonym two names hash to. Usernames
 * compare ignoring case, as Telegram's do; a pseudonym equal to any username written in
 * the run is skipped. The display-name map of phase 2 keeps only its size: its keys
 * become opaque.
 */
import { WORD_BODY, WS_BODY } from '#src/lib/text.ts';
import { type BotReply, type Conversation } from '#src/telegram/conversation/conversation.ts';
import { type BotDialect } from '#src/telegram/conversation/dialect.ts';
import { PseudonymSource } from './pseudonyms.ts';

/** What phase 3 needs from the dialect. */
export type AnonymiseDialect = Pick<BotDialect, 'publicNames' | 'userSpans' | 'userCommands'>;

export interface AnonymiseOptions {
  /** The export owner's @username (without `@`), kept as written; null when unknown. */
  owner: string | null;
  /** The bot's name (BotIdentity.name): `@Bot` stays. */
  botName: string;
  dialect: AnonymiseDialect;
  /**
   * The secret that pseudonyms are hashed with: random, kept by the caller, never output.
   * The same salt gives each person the same pseudonym in every run.
   */
  salt: string;
  /**
   * The titles of every group chat of the run, also of groups without bot replies (in
   * message order), so that no title is printed unchanged (e.g. in the summary of phase 1).
   */
  groupChats?: Iterable<string | null>;
}

export interface Anonymised {
  conversation: Conversation;
  /** A chat title as phase 3 writes it: a group's pseudonym title, any other title unchanged. */
  chatTitle(title: string): string;
}

/** Prefix of a group's pseudonym title. */
export const GROUP_PREFIX = 'Gruppo ';

const AT_NAME = new RegExp(`(?<![${WORD_BODY}])@([${WORD_BODY}]+)`, 'gu');
/** A word, or an @username, not inside another word. */
const WORD_OR_AT_NAME = new RegExp(`(?<![${WORD_BODY}@])(@?)([${WORD_BODY}]+)`, 'gu');
const COMMAND_WORD = new RegExp(`^[^${WS_BODY}]*`, 'u');

const key = (name: string): string => name.toLowerCase();

/** Phase 3 on the conversation of phase 2. */
export function anonymise(conversation: Conversation, options: AnonymiseOptions): Anonymised {
  const { dialect } = options;
  const kept = new Set<string>([key(options.botName), ...[...dialect.publicNames].map(key)]);
  if (options.owner) kept.add(key(options.owner));
  const spans = conversation.replies.map((r) => dialect.userSpans(r.text));
  /** The command word and its arguments, when the command takes a user. */
  const userArgs = (query: string | null): [string, string] | null => {
    if (query === null) return null;
    const command = (COMMAND_WORD.exec(query) as RegExpExecArray)[0];
    return dialect.userCommands.has(command.toLowerCase())
      ? [command, query.slice(command.length)]
      : null;
  };

  // Everything to replace, in order of first appearance: [kind, name].
  const order: ['user' | 'chat', string][] = [];
  const seenUsers = new Set<string>();
  const seenChats = new Set<string>();
  const addUser = (name: string | null): void => {
    if (!name || kept.has(key(name)) || seenUsers.has(key(name))) return;
    seenUsers.add(key(name));
    order.push(['user', key(name)]);
  };
  const addChat = (title: string | null): void => {
    if (title === null || seenChats.has(title)) return;
    seenChats.add(title);
    order.push(['chat', title]);
  };
  conversation.replies.forEach(({ text, context }, i) => {
    if (!context.dm) addChat(context.chat);
    addUser(context.player);
    for (const m of userArgs(context.query)?.[1].matchAll(AT_NAME) ?? []) addUser(m[1] as string);
    for (const [a, b] of spans[i] ?? []) addUser(text.slice(a, b));
  });
  for (const name of conversation.senders.values()) addUser(name);
  const dmTitles = new Set(
    conversation.replies.filter((r) => r.context.dm).map((r) => r.context.chat)
  );
  for (const title of options.groupChats ?? []) if (!dmTitles.has(title)) addChat(title);

  // Pseudonyms never equal a username written anywhere in the run (kept ones included).
  const taken = new Set([...kept, ...seenUsers]);
  for (const { text, context } of conversation.replies)
    for (const m of `${text} ${context.query ?? ''}`.matchAll(AT_NAME))
      taken.add(key(m[1] as string));
  const source = new PseudonymSource(options.salt, taken);
  const users = new Map<string, string>();
  const chats = new Map<string, string>();
  // Kinds apart, so that a group titled like a username is another name.
  for (const [kind, name] of order) {
    if (kind === 'user') users.set(name, source.for(`user:${name}`));
    else chats.set(name, GROUP_PREFIX + source.for(`chat:${name}`));
  }

  const user = (name: string): string => users.get(key(name)) ?? name;
  const rewriteText = (text: string, s: readonly (readonly [number, number])[]): string => {
    let out = '';
    let at = 0;
    for (const [a, b] of s) {
      out += text.slice(at, a) + user(text.slice(a, b));
      at = b;
    }
    return out + text.slice(at);
  };
  const rewriteQuery = (query: string): string => {
    const args = userArgs(query);
    if (args === null) return query;
    const [command, rest] = args;
    return (
      command + rest.replace(WORD_OR_AT_NAME, (_all, at: string, name: string) => at + user(name))
    );
  };
  const chatOf = (title: string | null, dm: boolean): string | null =>
    title === null || dm ? title : (chats.get(title) ?? title);

  const replies = conversation.replies.map(({ text, context }, i): BotReply => ({
    text: rewriteText(text, spans[i] ?? []),
    context: {
      ...context,
      chat: chatOf(context.chat, context.dm),
      player: context.player === null ? null : user(context.player),
      query: context.query === null ? null : rewriteQuery(context.query),
    },
  }));
  // Only the number of mapped senders is ever read (for the report); no display name
  // leaves this phase.
  const senders = new Map([...conversation.senders.values()].map((v, i) => [`#${i + 1}`, user(v)]));
  return {
    conversation: { replies, senders },
    chatTitle: (title) => (dmTitles.has(title) ? title : (chats.get(title) ?? title)),
  };
}
