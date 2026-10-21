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
import { WORD_CLASS, WS_CLASS } from '#src/lib/text.ts';

export const W = WORD_CLASS;
export const S = WS_CLASS;
export const D = '\\p{Nd}';
/** Any character but `\n` (JS `.` also stops at `\r`, U+2028 and U+2029). */
export const DOT = '[^\\n]';
/** End of the text, or before a final newline. */
export const END = '(?=\\n?$)';

export const rx = (src: string, flags = ''): RegExp => new RegExp(src, 'u' + flags);

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
// The receiver may be a player without a visible username: no `to`.
export const GIVE = rx(
  `${ADDR}dai (?<qty>${D}+)x (?<name>${DOT}+?) a (?:@(?<to>${W}+)|${ANONYMOUS})${S}*${END}`
);

/** A gift notice (6.10): "[N] @lucia_b ti ha dato 1x un bottone". */
export const GIFT = rx(
  `^\\[${W}+\\] (?:${DOT}*?)@(?<from>${W}+) ti ha dato (?<qty>${D}+)x (?<name>${DOT}+?)${S}*${END}`
);
