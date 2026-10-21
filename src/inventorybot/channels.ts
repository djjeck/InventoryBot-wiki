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
import { ATLANTE, CHANNEL_TITLES, CITTADELLA, GRIMORIO } from './bot.ts';
import { D, DOT, rx, S } from './patterns.ts';
import { placeName } from './places.ts';
import {
  type EventRecord,
  type ItemCardEvent,
  type ItemLine,
  type LoreCardEvent,
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

const ITEM = header('OGGETTO');
const OBTAIN = header('COME OTTENERLO');
const USAGE = header('(?:UTILIZZO|FUNZIONE)');
const LORE = header('(?:EVENTO|GUIDA)');
/** The bullet of an item card's use section. */
const BULLET_USE = '\u{1F538}';
/** The 🔍 line of an item card: what a use does to the item. */
const EFFECT = '\u{1F50D}';
/** "[X] / [C]": a card names two rarities. */
const TWO_RARITIES = rx(`\\[${RARITY}\\]${S}*/${S}*\\[?${RARITY}\\]?`);
const COOLDOWN = rx(`raffreddamento di (?<n>${D}+)${S}*(?<unit>h|ore|min|minuti|s|secondi)`);
const UNIT: Readonly<Record<string, number>> = {
  h: 3600,
  ore: 3600,
  min: 60,
  minuti: 60,
  s: 1,
  secondi: 1,
};

/** What a use does, as the 🔍 line of an item card says: consumed or kept, and the cooldown in seconds. */
export function useEffect(line: string): { consumed: boolean | null; cooldown: number | null } {
  const t = line.toLowerCase();
  const consumed = /si consuma|scompare dall'inventario/u.test(t)
    ? true
    : /rimane in inventario/u.test(t)
      ? false
      : null;
  const m = COOLDOWN.exec(t);
  const cooldown = m?.groups
    ? Number.parseInt(m.groups['n'] as string, 10) * (UNIT[m.groups['unit'] as string] ?? 1)
    : /non ha (?:un )?tempo di raffreddamento/u.test(t)
      ? 0
      : null;
  return { consumed, cooldown };
}

/**
 * A Grimorio item card: `📣 OGGETTO:`, `🗝 ITEM`, `{id: N}`, `📚 COME OTTENERLO:` and its
 * lines, `📌 UTILIZZO:` or `📌 FUNZIONE:` and its lines, and a `🔍` line on what a use does.
 * The sections are text as the curators wrote it, their markers (🔹, 🔸) removed. Null for
 * any other post.
 */
export function readItemCard(text: string): Omit<ItemCardEvent, 'type'> | null {
  const lines = text.split('\n');
  const head = lines.findIndex((l) => ITEM.test(l));
  if (head < 0) return null;
  const nameLine = lines.slice(head + 1).find((l) => stripWs(l) !== '');
  const named = nameLine === undefined ? null : lead(nameLine);
  if (named === null || !named.rest) return null;
  const notes: string[] = [];
  const two = TWO_RARITIES.test(named.rest);
  const item = cardItem(two ? named.rest.replace(TWO_RARITIES, '') : named.rest);
  if (item === null) return null;
  if (two) notes.push(squash(named.rest.slice(item.name.length)));
  const obtain: string[] = [];
  const usage: string[] = [];
  let effect: string | null = null;
  let section: 'head' | 'obtain' | 'usage' = 'head';
  for (const line of lines.slice(lines.indexOf(nameLine as string) + 1)) {
    if (stripWs(line) === '' || CARD_ID.test(line)) continue;
    if (OBTAIN.test(line)) section = 'obtain';
    else if (USAGE.test(line)) section = 'usage';
    else {
      const l = lead(line);
      const rest = l === null ? squash(line) : l.rest;
      if (l?.emoji.startsWith(EFFECT)) effect = rest;
      else if (section === 'obtain') obtain.push(rest);
      // A use line keeps its marker (▶️ a command, 📝 a message, ⚠️ a remark), not the bullet 🔸.
      else if (section === 'usage')
        usage.push(l === null || l.emoji.startsWith(BULLET_USE) ? rest : `${l.emoji} ${rest}`);
    }
  }
  const { consumed, cooldown } =
    effect === null ? { consumed: null, cooldown: null } : useEffect(effect);
  return {
    item: { ...item, rarity: two ? null : item.rarity },
    obtain,
    usage,
    effect,
    consumed,
    cooldown,
    notes,
  };
}

/** A Grimorio event or guide card: `📣 EVENTO: TITLE` or `📣 GUIDA …`, then its text. */
export function readLoreCard(text: string): Omit<LoreCardEvent, 'type'> | null {
  const lines = text.split('\n');
  const head = lines.findIndex((l) => LORE.test(l));
  if (head < 0) return null;
  const title = squash((lines[head] as string).replace(/^\S*\s*(?:EVENTO\s*:)?\s*/u, ''));
  const body = lines
    .slice(head + 1)
    .filter((l) => !CARD_ID.test(l))
    .join('\n');
  return { title, text: stripWs(body) };
}

/** Whether a message is a post of one of the channels. */
export const isChannelPost = (m: Message): boolean =>
  !m.from_bot && m.chat !== null && m.chat !== undefined && CHANNEL_TITLES.includes(m.chat);

/** A post's card, by its channel; null for a post that is no card. */
function cardOf(
  m: Message
): RecipeCardEvent | PlaceCardEvent | ItemCardEvent | LoreCardEvent | null {
  if (m.chat === CITTADELLA) {
    const c = readRecipeCard(m.text);
    return c && { type: 'recipe_card', ...c };
  }
  if (m.chat === ATLANTE) {
    const c = readPlaceCard(m.text);
    return c && { type: 'place_card', ...c };
  }
  if (m.chat === GRIMORIO) {
    const c = readItemCard(m.text);
    if (c !== null) return { type: 'item_card', ...c };
    const l = readLoreCard(m.text);
    return l && { type: 'lore_card', ...l };
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
