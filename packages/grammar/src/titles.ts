/**
 * Player titles and the admin's prefix, removed from a bot reply before it is classified:
 * InventoryBot prints a player's title after their username ("@lucia_b il cartografo, ..."), and
 * addresses the game's admin as "Sua Maestà @msx80". Titles are learned from the replies of a run
 * (learnTitles); replyNormalizer removes those given. Pure logic only, for the dialect (phase 2)
 * and for the module's `normalizeReply`.
 */
import { codePointLength, escapeRegex, WS_BODY } from './lib/text.ts';
import { D, rx, W } from './patterns.ts';

// Players can earn a title, which the bot prints after the username:
// "@lucia_b il cartografo, mostri...", "dai 1x ... a @x il fornaio". Titles are
// learned from the comma form and removed before classification, so that the
// no-comma replies ("@x il cartografo un secchio di fango [C] al momento...") parse too.
const NOT_WS_COMMA_PAREN = `[^${WS_BODY},()]`;
const TITLE_SHAPE = rx(
  `@${W}+ ((?:il|lo|la|l'|i|gli|le) ?${NOT_WS_COMMA_PAREN}+(?: ${NOT_WS_COMMA_PAREN}+){0,2})(?=,| \\(${D}+\\))`,
  'g'
);

/** Titles seen at least `minCount` times, longest first (ties in order of first appearance). */
export function learnTitles(texts: Iterable<string>, minCount = 2): string[] {
  const c = new Map<string, number>();
  for (const text of texts) {
    for (const m of text.matchAll(TITLE_SHAPE)) {
      const t = m[1] as string;
      c.set(t, (c.get(t) ?? 0) + 1);
    }
  }
  return [...c]
    .filter(([, n]) => n >= minCount)
    .map(([t]) => t)
    .sort((a, b) => codePointLength(b) - codePointLength(a));
}

export function titleStripper(titles: readonly string[]): (text: string) => string {
  if (titles.length === 0) return (text) => text;
  const alt = titles.map(escapeRegex).join('|');
  // The end of a line: before any newline or at the end of the text.
  const re = rx(`(@${W}+) (?:${alt})(?: \\(${D}+\\))?(?=[ ,]|\\n|(?![\\s\\S]))`, 'g');
  return (text) => text.replace(re, '$1');
}

/** The game's admin is addressed as "Sua Maestà @msx80, ...", also in /stats ("Avventuriero Sua Maestà @msx80"). */
const SUA_MAESTA = rx('^(Avventuriero )?Sua Maestà (?=@)');

export function stripSuaMaesta(text: string): string {
  return text.replace(SUA_MAESTA, '$1');
}

/** The text of a bot reply as the classifiers read it: titles (titleStripper) and "Sua Maestà" removed. */
export function replyNormalizer(titles: readonly string[]): (text: string) => string {
  const stripTitles = titleStripper(titles);
  return (text) => stripSuaMaesta(stripTitles(text));
}
