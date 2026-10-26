/**
 * The text conventions of InventoryBot's replies, shared by its dialect and its
 * classifiers: regular-expression building blocks, the addressee at the start of a reply,
 * and the reply grammars the dialect reads names from. Pure functions, no Node APIs.
 *
 * Regular expressions use the `u` flag and never JavaScript's own `\w`, `\s`, `\d`, `\b`
 * or `.`, which are ASCII-only or stop at more line terminators: word characters are
 * WORD_CLASS (any Unicode letter or number), whitespace is WS_CLASS, digits are any
 * Unicode decimal digit (`\p{Nd}`), `.` is DOT (anything but `\n`) and the end of a
 * reply is END (the end, or before a final newline). Grammars: docs/bot-protocol.md.
 */
import { parseDecimalInt, stripWs, WORD_CLASS, WS_CLASS } from '#src/lib/text.ts';

export const W = WORD_CLASS;
export const S = WS_CLASS;
export const D = '\\p{Nd}';
/** Any character but `\n` (JS `.` also stops at `\r`, U+2028 and U+2029). */
export const DOT = '[^\\n]';
/** End of the text, or before a final newline. */
export const END = '(?=\\n?$)';

export const rx = (src: string, flags = ''): RegExp => new RegExp(src, 'u' + flags);

/** A rarity code: `C`, `N+`, `L3`, `X`. */
export const RARITY = `[A-Z]${D}*\\+?`;

const DURATION_PART = rx(`^(${D}+) (giorn[oi]|or[ae]|minut[oi]|second[oi])$`);
const UNIT_SECONDS: Readonly<Record<string, number>> = {
  giorn: 86400,
  or: 3600,
  minut: 60,
  second: 1,
};

/**
 * A bot duration ("4 ore e 6 minuti", "2 giorni e 3 ore", "12 secondi") in seconds,
 * with the seconds of its smallest unit (`precision`); null if it is not one.
 */
export function parseDuration(text: string): { seconds: number; precision: number } | null {
  let seconds = 0;
  let precision = Infinity;
  for (const part of stripWs(text).split(/ e |, /u)) {
    const m = DURATION_PART.exec(part);
    if (!m) return null;
    const unit = UNIT_SECONDS[(m[2] as string).slice(0, -1)] as number;
    seconds += parseDecimalInt(m[1] as string) * unit;
    precision = Math.min(precision, unit);
  }
  return { seconds, precision };
}

// Bot messages address the player as "@username, ..." or "@username ...", or a player
// without a visible username as "[.. una presenza indistinta..], ...".
const ANONYMOUS = '\\[\\.\\. una presenza indistinta\\.\\.\\]';
export const ADDR = `^(?:@${W}+|${ANONYMOUS}),?${S}+`;
/** The addressee, unanchored. */
export const A = ADDR.slice(1);
export const ANONYMOUS_RE = rx(`^${ANONYMOUS}`);
export const ADDR_RE = rx(ADDR);

/** The reply without its addressee. */
export function stripAddr(text: string): string {
  return text.replace(ADDR_RE, '');
}

/** A `/dai` reply in a group (6.11): "@mario_r, dai 1x un bottone a @lucia_b". */
// The receiver may be the admin ("Sua Maestà @msx80"), have a title after the username, or
// be a player without a visible username: no `to`.
export const GIVE = rx(
  `${ADDR}dai (?<qty>${D}+)x (?<name>${DOT}+?) a (?:(?:Sua Maestà )?@(?<to>${W}+)(?: ${DOT}+?)?|${ANONYMOUS})${S}*${END}`
);

/** A gift notice (6.10): "[N] @lucia_b ti ha dato 1x un bottone". */
export const GIFT = rx(
  `^\\[${W}+\\] (?:${DOT}*?)@(?<from>${W}+) ti ha dato (?<qty>${D}+)x (?<name>${DOT}+?)${S}*${END}`
);

/**
 * An item name as the wiki keeps it: every run of whitespace within a line as one space,
 * the line breaks of a player-made name kept, and trimmed. The bot writes some names with
 * a no-break space, or after one more space than usual.
 */
export function itemName(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(WS_RUN, ' '))
    .join('\n')
    .replace(/ ?\n ?/gu, '\n')
    .replace(TRIM, '');
}
const WS_RUN = new RegExp(`(?:(?!\\n)${S})+`, 'gu');
const TRIM = new RegExp(`^${S}+|${S}+$`, 'gu');
