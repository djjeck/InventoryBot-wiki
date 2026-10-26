/**
 * The messages of a Telegram chat with a bot, as phase 1 (export parsing) produces them.
 * Generic: nothing here depends on which bot.
 *
 * Field names and key order are those of the JSON form (snake_case); build objects in this
 * key order so that serialising them gives byte-identical output from run to run.
 */

/** One message of phase 1 (`telegram/export/parse-export.ts`, `record.ts`). */
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
   * Present only for a message with a text file attached that the export holds (`files/*.txt`,
   * docs/telegram-export.md §5.6): the file's content, read like a page (decodeText). The
   * text above is the file's caption.
   */
  file_text?: string;
  /**
   * Present only when the export identifies the sender (macOS export avatars): an opaque
   * key, a salted hash of the user id (senderKey, telegram/export/record.ts), the same for
   * one user in every export and run with the same salt. Never the Telegram user id
   * itself, which no output file may contain.
   */
  sender_key?: string;
}

/** One page of an export as found on disk: where it came from, and its HTML. */
export interface Page {
  /** Path of the page file: `path/to/messagesN.html`. */
  label: string;
  html: string;
  /**
   * The text files the page links to as attachments that the export holds (linkedTextFiles,
   * export-listing.ts): link as written (`files/file (1).txt`) -> content. Absent for none.
   */
  files?: ReadonlyMap<string, string>;
}
