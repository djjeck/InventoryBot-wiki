/**
 * The posts of InventoryBot's encyclopedia channels (bot.ts CHANNEL_TITLES), written by
 * hand by their curators: each post is a card, read into a dated event that phase 5
 * merges with the bot's own observations (docs/channels.md). The readers are tolerant
 * of how the cards are typed: any whitespace, tags with or without a space between them,
 * a quantity with or without a space after the tags, an emoji before a header or not.
 * Pure logic, no Node APIs.
 */
import { stripWs } from '#src/lib/text.ts';
import { type Message } from '#src/telegram/messages.ts';
import { ATLANTE, CHANNEL_TITLES, CITTADELLA } from './bot.ts';
import { D, DOT, rx, S } from './patterns.ts';
import { placeName } from './places.ts';
import {
  type EventRecord,
  type ItemLine,
  type PlaceCardEvent,
  type RecipeCardEvent,
} from './types.ts';

/** Any run of whitespace as one space, trimmed: hand-typed cards mix spaces and no-break spaces. */
const squash = (s: string): string => stripWs(s.replace(new RegExp(`${S}+`, 'gu'), ' '));

const RARITY = `[A-Z]${D}*\\+?`;

/**
 * An item as a card writes it: the name, then its rarity, `[usabile]` and `xN`, each
 * optional, with or without spaces between them.
 */
const CARD_ITEM = rx(
  `^(?<name>${DOT}+?)(?:${S}*\\[(?<rarity>${RARITY})\\])?(?<usable>${S}*\\[usabile\\])?(?:${S}*x${S}*(?<qty>${D}+))?${S}*$`
);
/** After the rarity, a card may go on with a remark ("[N+] trovabile sulla spiaggia"). */
const TAGGED = rx(
  `^(?<item>${DOT}+?\\[${RARITY}\\](?:${S}*\\[usabile\\])?(?:${S}*x${S}*${D}+)?)(?<remark>${DOT}*)$`
);

export function cardItem(text: string): ItemLine | null {
  const t = squash(text);
  const m = CARD_ITEM.exec(TAGGED.exec(t)?.groups?.['item'] ?? t);
  const g = m?.groups;
  if (!g || !g['name']) return null;
  return {
    name: squash(g['name']),
    rarity: g['rarity'] ?? null,
    usable: g['usable'] !== undefined,
    qty: g['qty'] === undefined ? 1 : Number.parseInt(g['qty'], 10),
  };
}

/** The remark after an item's tags, if any. */
const remarkOf = (text: string): string | null =>
  squash(TAGGED.exec(squash(text))?.groups?.['remark'] ?? '') || null;

/** A header line: an optional emoji, the header's words and a colon; the rest of the line follows. */
const header = (words: string): RegExp =>
  rx(
    `^${S}*(?:\\p{Extended_Pictographic}[\\u{FE0F}\\u{200D}]*${S}*)*${words.replaceAll(' ', `${S}+`)}${S}*:${S}*(?<rest>${DOT}*)$`
  );

const RECIPE = header('RICETTA');
const INGREDIENTS = header('INGREDIENTI');
const TEXT = header('TESTO');
const OUTPUT = header('OGGETTO OTTENUTO');
const TITLE = header('TITOLO');
const CARD_ID = rx(`^${S}*\\{${S}*id${S}*:${S}*${D}+${S}*\\}${S}*$`);
const LEVEL = rx(`^(?<name>${DOT}+?)${S}*\\[L(?<level>${D}+)\\]${S}*$`);
/** An ingredient line starts with a pin (📌) or a dash. */
const BULLET = rx(`^${S}*(?:\\u{1F4CC}|-)${S}*`);
/** A note: a line after the output that starts with ⚠ (curators' remarks). */
const NOTE = rx(`^${S}*\\u{26A0}\\u{FE0F}?${S}*`);

/**
 * A Cittadella recipe card: `📇 RICETTA: NAME [Ln]`, `{id: N}`, `📚 INGREDIENTI:` and one
 * `📌 ITEM` line each, `📝 TESTO:` and the craft text, `📎 OGGETTO OTTENUTO: ITEM`, then
 * optionally `🎖 TITOLO: @username, TITLE` and `⚠️` notes. Null for any other post.
 */
export function readRecipeCard(text: string): Omit<RecipeCardEvent, 'type'> | null {
  const lines = text.split('\n');
  const head = lines.findIndex((l) => RECIPE.test(l));
  if (head < 0) return null;
  const named = LEVEL.exec(squash(RECIPE.exec(lines[head] as string)?.groups?.['rest'] ?? ''));
  if (!named?.groups) return null;
  const ingredients: ItemLine[] = [];
  const textLines: string[] = [];
  let output: ItemLine | null = null;
  let title: string | null = null;
  const notes: string[] = [];
  let section: 'head' | 'ingredients' | 'text' | 'after' = 'head';
  for (const line of lines.slice(head + 1)) {
    let m: RegExpExecArray | null;
    if (CARD_ID.test(line)) continue;
    if (INGREDIENTS.test(line)) section = 'ingredients';
    else if ((m = TEXT.exec(line))) {
      section = 'text';
      if (m.groups?.['rest']) textLines.push(m.groups['rest']);
    } else if ((m = OUTPUT.exec(line))) {
      section = 'after';
      output = cardItem(m.groups?.['rest'] ?? '');
    } else if ((m = TITLE.exec(line))) {
      // "🎖 TITOLO: @username, il pastore": the title, after the placeholder username.
      title = squash((m.groups?.['rest'] ?? '').replace(/^@\S+,?/u, '')) || null;
    } else if (section === 'ingredients' && BULLET.test(line)) {
      const it = cardItem(line.replace(BULLET, ''));
      if (it) ingredients.push(it);
    } else if (section === 'text') textLines.push(line);
    else if (section === 'after' && NOTE.test(line)) notes.push(squash(line.replace(NOTE, '')));
  }
  return {
    recipe: squash(named.groups['name'] as string),
    level: Number.parseInt(named.groups['level'] as string, 10),
    ingredients,
    text: stripWs(textLines.join('\n')) || null,
    output,
    title,
    notes,
  };
}

const PLACE = header('LUOGO');
const FOUND = header('OGGETTI TROVABILI');
const ROUTE = header('COME ARRIVARCI');
const ACCESS = header("OGGETTO RICHIESTO PER L'ACCESSO");
const SIGHT = header('OGGETTO RICHIESTO PER VISUALIZZARE');
/** A line's leading emoji (with its joiners and selectors), and the rest. */
const LEAD = rx(
  `^${S}*(?<emoji>(?:\\p{Extended_Pictographic}[\\u{FE0F}\\u{200D}\\u{2640}\\u{2642}]*)+)${S}*(?<rest>${DOT}*)$`
);
const lead = (line: string): { emoji: string; rest: string } | null => {
  const g = LEAD.exec(line)?.groups;
  return g ? { emoji: g['emoji'] as string, rest: squash(g['rest'] as string) } : null;
};
/** The route's markers: 🚩 the start, 🏃 a stage, 🏁 the end; "🚩🏁" before a remark. */
const START = '\u{1F6A9}';
const END_FLAG = '\u{1F3C1}';
const RUNNER = '\u{1F3C3}';
/** A remark of the curators: 🔎, ⚠️ or 📯. */
const REMARK = ['\u{1F50E}', '\u{26A0}', '\u{1F4EF}'];

/**
 * An Atlante place card: `🗺 LUOGO: PLACE`, `📌 {id: N}`, `📎 OGGETTI TROVABILI:` and one
 * item line each (a coloured book before it), `📫 COME ARRIVARCI:` and the route (🚩 the
 * start, 🏃 each stage, 🏁 the place; or "🚩🏁" and a remark), `🗝 OGGETTO RICHIESTO PER
 * L'ACCESSO:` and `👁‍🗨 OGGETTO RICHIESTO PER VISUALIZZARE:`, each with its item on the next
 * line, the arrival text (📝), then remarks. Places are in their article form. Null for any
 * other post.
 */
export function readPlaceCard(text: string): Omit<PlaceCardEvent, 'type'> | null {
  const lines = text.split('\n');
  const head = lines.findIndex((l) => PLACE.test(l));
  if (head < 0) return null;
  const place = squash(PLACE.exec(lines[head] as string)?.groups?.['rest'] ?? '');
  if (!place) return null;
  const items: ItemLine[] = [];
  const route: string[] = [];
  let routeNote: string | null = null;
  let access: ItemLine | null = null;
  let sight: ItemLine | null = null;
  const notes: string[] = [];
  let section: 'head' | 'items' | 'route' | 'access' | 'sight' | 'after' = 'head';
  for (const line of lines.slice(head + 1)) {
    if (stripWs(line) === '' || CARD_ID.test(line.replace(/^\S*\s*/u, ''))) continue;
    if (FOUND.test(line)) section = 'items';
    else if (ROUTE.test(line)) section = 'route';
    else if (ACCESS.test(line)) section = 'access';
    else if (SIGHT.test(line)) section = 'sight';
    else {
      const l = lead(line);
      if (l === null) continue;
      const e = l.emoji;
      if (REMARK.some((r) => e.startsWith(r))) notes.push(l.rest);
      else if (e.startsWith('\u{1F4DD}'))
        section = 'after'; // 📝 the arrival text
      else if (section === 'items') {
        const it = /^\[.*\]$/u.test(l.rest.replace(/\u{203C}\u{FE0F}?/gu, ''))
          ? null
          : cardItem(l.rest);
        if (it) items.push(it);
      } else if (section === 'route') {
        if (e.startsWith(START) && e.includes(END_FLAG)) routeNote = l.rest;
        else if (e.startsWith(START) || e.startsWith(RUNNER) || e.startsWith(END_FLAG))
          route.push(placeName(l.rest));
      } else if (section === 'access' || section === 'sight') {
        const it = cardItem(l.rest);
        if (section === 'access') access = it;
        else sight = it;
        const remark = remarkOf(l.rest);
        if (it !== null && remark !== null) notes.push(`${it.name}: ${remark}`);
      }
    }
  }
  const secret = notes.some((n) => /luogo segreto/iu.test(n));
  return {
    place: placeName(place),
    items,
    route,
    route_note: routeNote,
    access,
    sight,
    secret,
    notes,
  };
}

/** Whether a message is a post of one of the channels. */
export const isChannelPost = (m: Message): boolean =>
  !m.from_bot && m.chat !== null && m.chat !== undefined && CHANNEL_TITLES.includes(m.chat);

/** A post's card, by its channel; null for a post that is no card. */
function cardOf(m: Message): RecipeCardEvent | PlaceCardEvent | null {
  if (m.chat === CITTADELLA) {
    const c = readRecipeCard(m.text);
    return c && { type: 'recipe_card', ...c };
  }
  if (m.chat === ATLANTE) {
    const c = readPlaceCard(m.text);
    return c && { type: 'place_card', ...c };
  }
  return null;
}

/** The cards of the channels' posts, as events with the context of a reply (no player, no command). */
export function readChannelPosts(posts: readonly Message[]): EventRecord[] {
  const out: EventRecord[] = [];
  for (const m of posts) {
    const card = cardOf(m);
    if (card === null) continue;
    out.push({
      ...card,
      chat: m.chat,
      dm: false,
      msg: m.id,
      date: m.date,
      player: null,
      query: null,
      match: null,
      forwarded: false,
      broadcast: false,
    });
  }
  return out;
}
