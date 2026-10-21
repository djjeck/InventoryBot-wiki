/**
 * The bot a run is about, as Telegram shows it. Generic: the bot is a parameter, never a
 * constant here. Pure types, no Node APIs.
 */

/** How the bot appears in an export. */
export interface BotIdentity {
  /** The bot's display name as an author (`from_name`), and the `@Name` of `/cmd@Name`. */
  name: string;
  /** Title of the private chat with the bot: the chat with this title is the DM. */
  dmTitle: string;
  /**
   * Titles of channels that publish about the bot: phase 1 keeps their posts in full, for
   * the bot's own layer to read; no phase of this layer reads them.
   */
  channels?: readonly string[];
}
