/**
 * The messages of a Telegram chat with a bot, as phase 1 (export parsing) produces them.
 * Generic: nothing here depends on which bot.
 *
 * Field names and key order are those of the JSON form (snake_case); build objects in this
 * key order so that serialising them gives byte-identical output from run to run.
 */

/** One message of phase 1 (`telegram/export/parse-export.ts`). */
export interface Message {
  /** Chat title from the page header; `null` only if a page has no header. */
  chat: string | null;
  /** True for the private chat with the bot (the chat titled `BotIdentity.dmTitle`). */
  dm: boolean;
  /** Telegram message id, unique within a chat. */
  id: number;
  /**
   * Date title verbatim, e.g. `27.11.2025 19:14:19 UTC-05:00`; `null` if missing. A macOS
   * export's title (`27 November 2025, 19:14:19`, no offset) is converted to this form
   * with the export's inferred or given UTC offset.
   */
  date: string | null;
  /** The original author (forwarded_from, else sender) is the bot (`BotIdentity.name`). */
  from_bot: boolean;
  /** Display name (stripped); inherited from the previous message when joined. */
  sender: string | null;
  /** Original author of a forwarded message. */
  forwarded_from: string | null;
  /** Id of the message replied to (negative in chats with negative ids). */
  reply_to: number | null;
  /** Visible text: `<br>` as `\n`, entities decoded, tags dropped, stripped; `/cmd@Bot` as written. */
  text: string;
  /**
   * Present only when the export identifies the sender (macOS export avatars): an opaque
   * key (`u1`, `u2`, ...), the same for every message of one user within one parse run.
   * Never the Telegram user id itself, which no output file may contain.
   */
  sender_key?: string;
}

/** One page of an export as found on disk: where it came from, and its HTML. */
export interface Page {
  /** Path of the page file: `path/to/messagesN.html`. */
  label: string;
  html: string;
}
