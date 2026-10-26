/**
 * The invented game world of the tests and docs (scripts/universe.md), and the scanner that
 * every item, recipe and place they mention belongs to it, so that no real game content
 * (which players are meant to discover) reaches the repository.
 *
 * Entities are found where the bot's reply formats put them (docs/bot-protocol.md), and
 * the text there must end with a name of the universe (the bot may write words before it):
 *
 * - items: before a rarity tag (`un sasso [C]`: the text before the tag must end with an
 *   item of the universe), after `Ottieni: ` up to `!`, and first in the item tuples (name, rarity,
 *   quantity) of the tests' reply builders (`['un sasso', 'C', 1]`);
 * - recipes: in recipe lists (`- NAME L3 [manca 1]`), details (`per fare [la ricetta]
 *   NAME ti manca`) and channel cards (`RICETTA: NAME [L1]`);
 * - places: after `ti trovi`, `arrivi`, `non puoi andare: `, `passare ` up to the place's
 *   emoji, and exit lines (` - `) that end with it;
 * - Telegram usernames: every `@name` (not an e-mail address, a package scope such as
 *   `@types/node`, code such as `@${u}`, or a JSDoc tag such as `@param`), compared whole.
 *
 * A name written anywhere else is not seen; review catches those. Names are compared
 * ignoring case and runs of spaces. No vitest imports here.
 */

export type Kind = 'item' | 'recipe' | 'place' | 'user';

export type Universe = Record<Kind, ReadonlySet<string>>;

/** One name of an unknown entity, or the text before a rarity tag that ends with none. */
export interface Finding {
  kind: Kind;
  /** The name, or for an item before a rarity tag, the text before the tag. */
  text: string;
  /** 1-based line of the entity in the scanned text. */
  line: number;
}

const SECTIONS: Record<string, Kind> = {
  items: 'item',
  recipes: 'recipe',
  places: 'place',
  usernames: 'user',
};

/** A name as names are compared: source-string escapes of quotes removed, spaces collapsed, lower case. */
export const normalizeName = (s: string): string =>
  s
    .replace(/\\(['"`])/gu, '$1')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();

/**
 * The names of universe.md: the `- ` lines of its `## Items`, `## Recipes` and `## Places`
 * sections, without a trailing `<!-- … -->` comment (a note on the entry, such as why a
 * real name every player sees is allowed).
 */
export function parseUniverse(markdown: string): Universe {
  const out: Record<Kind, Set<string>> = {
    item: new Set(),
    recipe: new Set(),
    place: new Set(),
    user: new Set(),
  };
  let kind: Kind | null = null;
  for (const line of markdown.split('\n')) {
    const heading = /^## (\w+)/u.exec(line);
    if (heading) kind = SECTIONS[(heading[1] as string).toLowerCase()] ?? null;
    else if (kind !== null && line.startsWith('- '))
      out[kind].add(normalizeName(line.slice(2).replace(/<!--.*?-->\s*$/u, '')));
  }
  return out;
}

/** A rarity tag: `[C]`, `[N+]`, `[L3]`. */
const RARITY_TAG = /\[[CNRSXML]\d*\+?\]/gu;
/** A place ends with its emoji (and an optional variation selector). */
const PLACE_END = String.raw`\p{Extended_Pictographic}\u{FE0F}?`;
/** Text within one line of a file, a source string's `\n` included as a line end. */
const SPAN = String.raw`[^\n\\]+?`;
const LINE_START = String.raw`(?:^|\n|\\n)`;

/** A Telegram username after `@`: not inside a word, an address or code, nor a package scope. */
const USERNAME = /(?<![\p{L}\p{N}_.@/\\$])@([A-Za-z][A-Za-z0-9_]*)(?![\p{L}\p{N}_/-])/gu;

/** JSDoc tags, which read like usernames in comments (`@param`). */
const JSDOC_TAGS = new Set(['param', 'returns', 'return', 'type', 'typedef', 'see', 'throws']);

/** Patterns whose first group is the whole name of an entity. */
const NAMED: readonly [Kind, RegExp][] = [
  ['item', new RegExp(`Ottieni: (${SPAN})!`, 'gu')],
  // An item tuple: name, rarity (or null), quantity.
  ['item', /\[\s*(['"])(?<name>[^'"\n]+)\1,\s*(?:(['"])[CNRSXMUL]\d*\+?\3|null)\s*,\s*\d+/gu],
  ['recipe', new RegExp(`${LINE_START}- (${SPAN}) L\\d+ \\[(?:\\*|manca)`, 'gu')],
  ['recipe', new RegExp(`per fare (?:la ricetta )?(${SPAN}) ti manca`, 'gu')],
  // A channel's recipe card (src/inventorybot/channels.ts): `📇 RICETTA: Torre [L1]`.
  ['recipe', new RegExp(`RICETTA:\\s*(${SPAN})\\s*\\[L\\d+\\]`, 'gu')],
  [
    'place',
    new RegExp(`(?:ti trovi:? |arrivi:? |non puoi andare: |passare )(${SPAN}${PLACE_END})`, 'gu'),
  ],
  // An exit line holds the place alone (" - Brumolo 👻: pronto" is a Pakkomon).
  ['place', new RegExp(`${LINE_START} - (${SPAN}${PLACE_END})(?=[ \t]*(?:$|\n|\\n))`, 'gu')],
];

/** Regular-expression or template syntax: the "name" is code. */
const CODE = /\$\{|\(\?/u;

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** Whether `before` ends with one of `names`, starting at a word boundary. */
function endsWithName(before: string, names: ReadonlySet<string>): boolean {
  const b = normalizeName(before);
  for (const n of names) {
    if (!b.endsWith(n)) continue;
    const prev = b[b.length - n.length - 1];
    if (prev === undefined || !/[\p{L}\p{N}]/u.test(prev)) return true;
  }
  return false;
}

/** The entities of `text` that are not in the universe. */
export function unknownEntities(text: string, universe: Universe): Finding[] {
  const out: Finding[] = [];
  for (const m of text.matchAll(RARITY_TAG)) {
    const start = Math.max(
      text.lastIndexOf('\n', m.index) + 1,
      text.lastIndexOf('\\n', m.index) + 2, // a source string's `\n`
      0
    );
    // The /esporta file sets the name between tabs: `\t` in a source string, `→` in the docs.
    const before = text
      .slice(start, m.index)
      .replaceAll('\\t', '\t')
      .replaceAll('→', '\t')
      .trimEnd();
    // A tag alone (a legend, a pattern), after code (`${name} [C]`, `'[N] '`) or after a
    // command (`/inventario [C]`, a rarity filter) names no item; a channel's recipe card
    // names its recipe with its level (`RICETTA: Torre [L1]`: a recipe, below).
    if (!/[\p{L}\p{N}]$/u.test(before) || /(?:^|\s|['"`])\/[\p{L}]+$/u.test(before)) continue;
    if (/RICETTA:/u.test(before)) continue;
    if (!endsWithName(before, universe.item))
      out.push({ kind: 'item', text: before.slice(-60), line: lineOf(text, m.index) });
  }
  for (const [kind, re] of NAMED) {
    for (const m of text.matchAll(re)) {
      // A crafted item may carry its tags (`Ottieni: un baule [X] [usabile]!`).
      const name = ((m.groups?.['name'] ?? m[1]) as string).replace(/(?:\s*\[[^\]]*\])+$/u, '');
      // Code (a pattern such as `.*`, `(?<name>${DOT}+?)`) is no name; a name may follow other words.
      if (/\p{L}/u.test(name) && !CODE.test(name) && !endsWithName(name, universe[kind]))
        out.push({ kind, text: name, line: lineOf(text, m.index + m[0].indexOf(name)) });
    }
  }
  for (const m of text.matchAll(USERNAME)) {
    const name = m[1] as string;
    if (!JSDOC_TAGS.has(name) && !universe.user.has(normalizeName(name)))
      out.push({ kind: 'user', text: `@${name}`, line: lineOf(text, m.index) });
  }
  return out.sort((a, b) => a.line - b.line);
}
