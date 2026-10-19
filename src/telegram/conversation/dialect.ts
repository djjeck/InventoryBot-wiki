/**
 * What the conversation phase needs to know about one particular bot's replies. The
 * generic code pairs replies with commands and maps senders to usernames; everything that
 * depends on the bot's wording comes through this interface, implemented by the bot's own
 * layer.
 *
 * Every member is a pure function of the reply text, or a constant: the dialect holds no
 * state of the run. Anything a dialect learns from the input (such as player titles) is learned
 * before it is built, and fixed for the run.
 */

/** Commands that can have produced a reply (first words, lower case), or null when any could have. */
export type Compatible = (text: string) => ReadonlySet<string> | null;

export interface BotDialect {
  /**
   * The bot's reply text as the rest of the run reads it (e.g. with decorations around
   * usernames removed). Applied to every bot message before anything else reads it,
   * except `addressee` in the DM seed (see readConversation).
   */
  normalizeReply(text: string): string;
  /**
   * Which commands can have produced this reply: a set of first words (`/cmd`, lower
   * case); an empty set for a notice that answers no command; null when any command can.
   */
  compatibleCommands: Compatible;
  /** The username (without `@`) a reply addresses, or null when it names nobody. */
  addressee(text: string): string | null;
  /**
   * A reply addressed to a player the bot does not name: it belongs to nobody, even when
   * the sender of its command is known.
   */
  isAnonymous(text: string): boolean;
  /**
   * A group broadcast: a message the bot posts to the group on its own, answering no
   * command there. Returns the text to read (a prefix may be removed), or null when the
   * reply is not a broadcast. Only asked for group messages.
   */
  broadcast(text: string): string | null;
  /**
   * Display names that must never be mapped to a username, in addition to Telegram's own
   * (`DELETED_ACCOUNT`), because many people share them.
   */
  unmappableNames: ReadonlySet<string>;
  /**
   * Seconds: a group reply is paired only with a command sent at most this long before it,
   * and votes only for such a command (learnDisplayNames). How long the bot takes to answer
   * in a group, at most.
   */
  groupWindow: number;
}
