/**
 * Synthetic posts of InventoryBot's channels, for the tests of channels.ts and of phase 5:
 * a Cittadella recipe card as its curators write it, and card(), a card as phase 4 reads it.
 * No vitest imports here.
 */
import { CITTADELLA } from '#src/inventorybot/bot.ts';
import { readChannelPosts } from '#src/inventorybot/channels.ts';
import { type BuildEvent } from '#src/inventorybot/types.ts';
import { BASE, tgDate } from './helpers.ts';

/** A Cittadella card, with every part a card can have. */
export const TORRE_CARD = [
  '📇 RICETTA: Torre alta [L2]',
  '{id: 7}',
  '',
  '📚 INGREDIENTI:',
  '📌 una torre [L1] x1',
  '📌 una trave [N] x2',
  '',
  '📝 TESTO:',
  'e sovrapponi le travi alla torre,',
  'che si allunga verso il cielo.',
  '',
  '📎 OGGETTO OTTENUTO: una torre alta [L2] [usabile]',
  '',
  '🎖 TITOLO: @username, il costruttore',
  '',
  '⚠️ Torre alta è una ricetta di prova.',
].join('\n');

let msgCounter = 90000;

/** A card posted on the Cittadella at `t` seconds from BASE, as a phase 4 event. */
export function card(text: string, t = 0): BuildEvent {
  const [e] = readChannelPosts([
    {
      chat: CITTADELLA,
      dm: false,
      id: ++msgCounter,
      date: tgDate(t, BASE),
      from_bot: false,
      sender: CITTADELLA,
      forwarded_from: null,
      reply_to: null,
      text,
    },
  ]);
  if (e === undefined) throw new Error('not a card');
  return e as BuildEvent;
}
