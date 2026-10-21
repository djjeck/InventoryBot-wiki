/** InventoryBot as Telegram shows it: the BotIdentity the generic layer is run with. */
import { type BotIdentity } from '#src/telegram/bot.ts';

/** The channels' titles, as their exports name them. */
export const CHANNEL_TITLES: readonly string[] = [
  'La Cittadella dei Demiurghi',
  'Il Grimorio del Golem',
  "L'Atlante di Barbabeige",
];

export const INVENTORY_BOT: BotIdentity = {
  name: 'InventoryBot',
  dmTitle: 'InventoryBot',
  // The encyclopedia channels the bot's /gruppi lists: recipes, items and places.
  channels: CHANNEL_TITLES,
};
