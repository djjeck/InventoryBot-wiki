/**
 * What the replies of an item's /usa have in common: each reply is cut into fixed text and
 * typed slots (numbers, durations, known items, Pakkomon names, places, players, quoted
 * text, rows of symbols, list lines), the replies with the same cut are one shape, and a
 * slot holding the same value in all of them is fixed text again. Each slot left is
 * described by what it held, as the channels' cards describe a reply ("dove N è un numero
 * compreso tra 1 e 6"), an item slot with how often each item came, from which a use's
 * odds of giving it follow; players and the text players typed are not kept. Pure logic.
 */
import { parseDuration } from './patterns.ts';
import { type WikiUseShape, type WikiUseSlot } from './types.ts';

/** What the replies may name, known from the wiki: items, and places as the bot writes them. */
export interface ShapeNames {
  items: Iterable<string>;
  places: Iterable<string>;
}

const escapeRx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const alternation = (names: Iterable<string>): string =>
  [...new Set(names)]
    .filter((n) => n.length > 0)
    .sort((a, b) => b.length - a.length)
    .map(escapeRx)
    .join('|');

// An emoji, with its variation selector, modifiers, and the emoji joined to it.
const EMOJI =
  '\\p{Extended_Pictographic}(?:\\u{FE0F}|\\p{Emoji_Modifier}|\\u{200D}\\p{Extended_Pictographic})*';
const UNIT = '(?:giorn[oi]|or[ae]|minut[oi]|second[oi])';
// An item's tags in a reply: its rarity, and whether it is usable.
const TAGS = '(?:\\s*\\[[A-Z]\\d*\\+?\\])?(?:\\s*\\[usabile\\])?';
const DURATION = `\\d+ ${UNIT}(?:(?: e |, )\\d+ ${UNIT})*`;

/** The slot kinds, in the order they are tried at the same place of a text. */
function slotPattern(names: ShapeNames): RegExp {
  const items = alternation(names.items);
  const places = alternation(names.places);
  return new RegExp(
    [
      // A list line, "- name: value", after the first line (the scanner's Pakkomon).
      `(?<list>(?:\\n ?- [^\\n]+: [^\\n]+)+)`,
      // An item, with its tags: the same item with other tags is the same slot.
      ...(items ? [`(?<![\\p{L}'’])(?<item>(?:${items})(?!\\p{L})${TAGS})`] : []),
      ...(places ? [`(?<![\\p{L}'’])(?<place>${places})(?!\\p{L})`] : []),
      // A Pakkomon the wiki does not know as an item: its name, ending with its emoji.
      `(?<=Pakkomon di nome |il tuo )(?<pakkomon>[^\\n\\[]*?${EMOJI})`,
      // A place the wiki does not know, where one finds oneself (the capsule's), up to its emoji.
      `(?<=ti trovi )(?<where>[^\\n!]*?${EMOJI})`,
      `(?<duration>${DURATION})`,
      `(?<user>@\\w+)`,
      `(?<number>\\d+(?:[.,]\\d+)?)`,
      `(?<symbols>\\[(?:${EMOJI}){2,}\\])`,
      `(?<text>"[^"\\n]+")`,
    ].join('|'),
    'gu'
  );
}

type Kind = WikiUseSlot['kind'];
/** A reply cut into fixed text and slots: `parts` alternates them, starting with text. */
interface Cut {
  parts: string[];
  kinds: Kind[];
}

function cut(text: string, rx: RegExp): Cut {
  const parts: string[] = [];
  const kinds: Kind[] = [];
  let at = 0;
  for (const m of text.matchAll(rx)) {
    const g = m.groups ?? {};
    const group = Object.keys(g).find((k) => g[k] !== undefined);
    const kind = (group === 'where' ? 'place' : group) as Kind | undefined;
    if (kind === undefined) continue;
    parts.push(text.slice(at, m.index), g[group as string] as string);
    kinds.push(kind);
    at = m.index + m[0].length;
  }
  parts.push(text.slice(at));
  return { parts, kinds };
}

/** The value of a slot, as a number when it is one. */
const numberOf = (v: string): number => Number(v.replace(',', '.'));
const decimalsOf = (v: string): number => /[.,](\d+)$/u.exec(v)?.[1]?.length ?? 0;

/** The values of a slot with how often each came, most frequent first (first seen first among equals). */
function counted(values: readonly string[]): [string, number][] {
  const n = new Map<string, number>();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]);
}
/** The values of a slot, most frequent first (first seen first among equals). */
const byFrequency = (values: readonly string[]): string[] => counted(values).map(([v]) => v);

function describe(kind: Kind, values: readonly string[]): WikiUseSlot {
  switch (kind) {
    case 'number': {
      const ns = values.map(numberOf);
      return {
        kind,
        min: Math.min(...ns),
        max: Math.max(...ns),
        decimals: Math.max(...values.map(decimalsOf)),
      };
    }
    case 'duration': {
      const ds = values.map((v) => parseDuration(v)?.seconds ?? 0);
      return { kind, min: Math.min(...ds), max: Math.max(...ds) };
    }
    case 'item': {
      // The item's name: its tags are the item's own, as the wiki knows them.
      const items = counted(values.map((v) => v.replace(new RegExp(`${TAGS}$`, 'u'), '')));
      return { kind, values: items.map(([v]) => v), counts: items.map(([, k]) => k) };
    }
    case 'place':
    case 'pakkomon':
      return { kind, values: byFrequency(values) };
    case 'symbols':
      return {
        kind,
        values: byFrequency(
          values.flatMap((v) =>
            [...v.slice(1, -1).matchAll(new RegExp(EMOJI, 'gu'))].map((x) => x[0])
          )
        ),
      };
    default:
      return { kind };
  }
}

/**
 * The shapes of an item's replies (every successful use, repeats included), the most
 * frequent first: each its text, with slot numbers in place of what varies, how many
 * replies it covers, and its slots.
 */
export function useShapes(replies: readonly string[], names: ShapeNames): WikiUseShape[] {
  const rx = slotPattern(names);
  const groups = new Map<string, Cut[]>();
  for (const r of replies) {
    const c = cut(r, rx);
    // The fixed text and the slot kinds identify the shape.
    const key = JSON.stringify([c.parts.filter((_, i) => i % 2 === 0), c.kinds]);
    let g = groups.get(key);
    if (g === undefined) groups.set(key, (g = []));
    g.push(c);
  }
  const shapes: WikiUseShape[] = [];
  for (const cuts of groups.values()) {
    const first = cuts[0] as Cut;
    const parts: (string | number)[] = [];
    const slots: WikiUseSlot[] = [];
    const text = (s: string): void => {
      if (s === '') return;
      if (typeof parts.at(-1) === 'string') parts[parts.length - 1] += s;
      else parts.push(s);
    };
    first.parts.forEach((p, i) => {
      if (i % 2 === 0) return text(p);
      const values = cuts.map((c) => c.parts[i] as string);
      // A slot that always held the same value is fixed text.
      if (values.every((v) => v === values[0])) return text(p);
      parts.push(slots.length);
      slots.push(describe(first.kinds[(i - 1) / 2] as Kind, values));
    });
    shapes.push({ parts, count: cuts.length, slots });
  }
  return shapes.sort((a, b) => b.count - a.count);
}
