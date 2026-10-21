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
import { CHANNEL_TITLES, CITTADELLA } from './bot.ts';
import { D, DOT, rx, S } from './patterns.ts';
import { type EventRecord, type ItemLine, type RecipeCardEvent } from './types.ts';

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

export function cardItem(text: string): ItemLine | null {
  const m = CARD_ITEM.exec(squash(text));
  const g = m?.groups;
  if (!g || !g['name']) return null;
  return {
    name: squash(g['name']),
    rarity: g['rarity'] ?? null,
    usable: g['usable'] !== undefined,
    qty: g['qty'] === undefined ? 1 : Number.parseInt(g['qty'], 10),
  };
}

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

/** Whether a message is a post of one of the channels. */
export const isChannelPost = (m: Message): boolean =>
  !m.from_bot && m.chat !== null && m.chat !== undefined && CHANNEL_TITLES.includes(m.chat);

/** The cards of the channels' posts, as events with the context of a reply (no player, no command). */
export function readChannelPosts(posts: readonly Message[]): EventRecord[] {
  const out: EventRecord[] = [];
  for (const m of posts) {
    const card = m.chat === CITTADELLA ? readRecipeCard(m.text) : null;
    if (card === null) continue;
    out.push({
      type: 'recipe_card',
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
