/**
 * InventoryBot's dialect (BotDialect): what the generic conversation and anonymisation
 * phases need to know about the bot's wording. Pure functions, no Node APIs.
 *
 * - addressing: "@user, ...", "Complimenti @user", "Avventuriero @user", "ciao @user",
 *   and the anonymous "[.. una presenza indistinta..]";
 * - reply normalisation: player titles learned from the input ("@user il fornaio,") and
 *   the admin's "Sua Maestà" prefix are removed;
 * - group broadcasts `[W]`, `[N]`, `[BAN]`;
 * - which commands can produce each reply (COMPATIBLE, compatibleCommands), from the
 *   reply type classify() gives without a command;
 * - for anonymisation: the admin's public username (PUBLIC_NAMES), the usernames a reply
 *   designates (userSpans) and the commands that take a username (USER_COMMANDS).
 */
import { codePointLength, escapeRegex, WS_BODY } from '#src/lib/text.ts';
import { type BotDialect, type Compatible } from '#src/telegram/conversation/dialect.ts';
import { classify, producersOf } from './classify.ts';
import { ANONYMOUS_RE, D, GIFT, GIVE, rx, W } from './patterns.ts';
import { type Event, type EventType } from './types.ts';

/** Which commands can produce each reply type (used to pair replies in groups). */
export const COMPATIBLE: Readonly<Partial<Record<EventType, ReadonlySet<string>>>> = {
  drop: new Set(['/avventura']),
  cooldown: new Set(['/avventura']),
  recipe_list: new Set(['/ricetta']),
  recipe_detail: new Set(['/ricetta', '/esamina']),
  craft: new Set(['/ricetta']),
  item_info: new Set(['/esamina']),
  inventory: new Set(['/inventario']),
  travel: new Set(['/viaggio']),
  location: new Set(['/viaggio']),
  travel_blocked: new Set(['/viaggio']),
  stats: new Set(['/stats']),
  faq: new Set(['/faq', '/start', '/help']),
  give: new Set(['/dai']),
  show: new Set(['/mostra']),
  title: new Set(['/titolo']),
  // A side notice after another reply: it never takes a command.
  travel_requirement: new Set(),
  use: new Set(['/usa', '/use']),
};

const USE_COMMANDS: ReadonlySet<string> = new Set(['/usa', '/use']);
const GIVE_COMMANDS: ReadonlySet<string> = new Set(['/dai']);

/** Short forms the bot takes for a command: `/i` for `/inventario`. */
const SHORT_FORMS: ReadonlyMap<string, string> = new Map([['/i', '/inventario']]);

/** The commands with the short forms of those among them. */
function withShortForms(commands: ReadonlySet<string> | null): ReadonlySet<string> | null {
  if (commands === null) return null;
  const short = [...SHORT_FORMS].filter(([, full]) => commands.has(full)).map(([s]) => s);
  return short.length === 0 ? commands : new Set([...commands, ...short]);
}

/** Commands that can produce an event of this kind (first words), or null when any can. */
export function commandFamily(ev: Event): ReadonlySet<string> | null {
  if (ev.type === 'miss' || ev.type === 'old_format') {
    const c = producersOf(ev);
    return withShortForms(c === 'any' ? null : new Set(c === 'none' ? [] : c));
  }
  if (ev.type === 'item_cooldown') return ev.action === 'use' ? USE_COMMANDS : GIVE_COMMANDS;
  return withShortForms(COMPATIBLE[ev.type] ?? null);
}

/** Commands that can have produced this reply, or null when any could have; the reply type is classify()'s without a command. */
export const compatibleCommands: Compatible = (text) => commandFamily(classify(text, null));

// ---- addressing and titles ----------------------------------------------------------

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

const PLAYER = rx(`^(?:Complimenti |Avventuriero |ciao )?@(${W}+)`);

/** The @username the bot is answering (needed to tell players apart in groups). */
export function playerOf(text: string): string | null {
  const m = PLAYER.exec(text);
  return m ? (m[1] as string) : null;
}

/** Broadcasts posted in a group by the bot: "[W] @x, ..." (an adventure of x announced to the group), "[N] @x ti ha dato..." (a gift notice), "[BAN] ...". */
const BROADCAST = /^\[(W|N|BAN)\] /u;

/** A group broadcast: `[W]` is removed, so that the announced reply reads as one; `[N]` and `[BAN]` stay. */
export function broadcastText(text: string): string | null {
  const b = BROADCAST.exec(text);
  if (b === null) return null;
  return b[1] === 'W' ? text.slice(b[0].length) : text;
}

/** The text of a bot reply as the classifiers read it: titles (titleStripper) and "Sua Maestà" removed. */
export function replyNormalizer(titles: readonly string[]): (text: string) => string {
  const stripTitles = titleStripper(titles);
  return (text) => stripSuaMaesta(stripTitles(text));
}

/** A group reply answers a command sent at most this long before it (seconds). */
export const GROUP_WINDOW = 120;

// ---- anonymisation ------------------------------------------------------------------

/**
 * The game's admin: their username is part of the game's own texts (gift notices, place
 * names), the same for every player, so it is never replaced.
 */
export const PUBLIC_NAMES: ReadonlySet<string> = new Set(['msx80']);

/** Commands whose arguments may name a player without `@`: `/stats mario`, `/dai mario 2 sasso`. */
export const USER_COMMANDS: ReadonlySet<string> = new Set(['/stats', '/dai']);

/** The receiver a `/dai` is refused for (6.11). */
const GIVE_REFUSED = rx(`^meglio non dare niente a @(?<to>${W}+), `);

/** `re` with match indices (the `d` flag). */
const withIndices = (re: RegExp): RegExp => new RegExp(re.source, re.flags.replace('g', '') + 'd');

/** The username (without `@`) each pattern designates, by its named group. */
const DESIGNATED: readonly [RegExp, string][] = [
  [withIndices(rx(`^(?:Complimenti |Avventuriero |ciao )?@(?<u>${W}+)`)), 'u'],
  [withIndices(GIVE), 'to'],
  [withIndices(GIFT), 'from'],
  [withIndices(GIVE_REFUSED), 'to'],
];

/**
 * The usernames a reply designates, as spans of the text (without `@`): the addressee at
 * the start ("@u, ...", "Complimenti @u", "Avventuriero @u", "ciao @u"), the receiver of a
 * `/dai` ("dai 1x ... a @y", "meglio non dare niente a @y") and the giver of a gift notice
 * ("[N] @x ti ha dato ..."). Every other username in the text is part of what the bot
 * says (leaderboards, item names, announcements) and stays.
 */
export function userSpans(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const [re, group] of DESIGNATED) {
    const span = re.exec(text)?.indices?.groups?.[group];
    if (span !== undefined && !out.some(([a]) => a === span[0])) out.push([span[0], span[1]]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/** The dialect for a run, with the player titles learned from its bot messages (learnTitles). */
export function inventoryBotDialect(titles: readonly string[]): BotDialect {
  return {
    normalizeReply: replyNormalizer(titles),
    compatibleCommands,
    addressee: playerOf,
    isAnonymous: (text) => ANONYMOUS_RE.test(text),
    broadcast: broadcastText,
    unmappableNames: new Set(),
    groupWindow: GROUP_WINDOW,
    publicNames: PUBLIC_NAMES,
    userSpans,
    userCommands: USER_COMMANDS,
  };
}
