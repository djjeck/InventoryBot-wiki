/**
 * Synthetic posts of InventoryBot's channels, for the tests of channels.ts and of phase 5:
 * a Cittadella recipe card and an Atlante place card as their curators write them, and card(),
 * a card as phase 4 reads it.
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

/** An Atlante card, with every part a card can have. */
export const CRIPTE_CARD = [
  '🗺 LUOGO: nelle cripte del monastero 👻',
  '📌 {id: 3}',
  '',
  '📎 OGGETTI TROVABILI:',
  "📒 una ghianda d'oro [C+]",
  '📘 un paio di mollette [R+] [usabile]',
  '',
  '📫 COME ARRIVARCI:',
  '🚩 nel villaggio di Borgoverde 🏡',
  '🏃\u200d♂️ nel bosco nebbioso di Valtorbo 🌲',
  '🏁 nelle cripte del monastero 👻',
  '',
  "🗝 OGGETTO RICHIESTO PER L'ACCESSO:",
  '📚 una lanterna cieca [N] trovabile nella valle ventosa 🏞',
  '',
  '👁\u200d🗨 OGGETTO RICHIESTO PER VISUALIZZARE:',
  '📚 un rampino di ferro [R]',
  '',
  '📝 @username, accendi la lanterna e scendi nelle cripte del monastero 👻',
  '',
  "🔎 Questo è un luogo segreto! Non è visibile nel pannello di viaggio se non si possiede l'oggetto per raggiungerlo!",
].join('\n');

let msgCounter = 90000;

/** A card posted on a channel (the Cittadella by default) at `t` seconds from BASE, as a phase 4 event. */
export function card(text: string, t = 0, channel = CITTADELLA): BuildEvent {
  const [e] = readChannelPosts([
    {
      chat: channel,
      dm: false,
      id: ++msgCounter,
      date: tgDate(t, BASE),
      from_bot: false,
      sender: channel,
      forwarded_from: null,
      reply_to: null,
      text,
    },
  ]);
  if (e === undefined) throw new Error('not a card');
  return e as BuildEvent;
}
