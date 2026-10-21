/** InventoryBot as Telegram shows it: the BotIdentity the generic layer is run with. */
import { type BotIdentity } from '#src/telegram/bot.ts';

/** The encyclopedia channels, by title as their exports name them: recipes, items, places. */
export const CITTADELLA = 'La Cittadella dei Demiurghi';
export const GRIMORIO = 'Il Grimorio del Golem';
export const ATLANTE = "L'Atlante di Barbabeige";
export const CHANNEL_TITLES: readonly string[] = [CITTADELLA, GRIMORIO, ATLANTE];

export const INVENTORY_BOT: BotIdentity = {
  name: 'InventoryBot',
  dmTitle: 'InventoryBot',
  // The encyclopedia channels the bot's /gruppi lists: recipes, items and places.
  channels: CHANNEL_TITLES,
};
