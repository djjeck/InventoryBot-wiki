/**
 * The item of an adventure's drop. Its reply names the item only at the end of the narrative
 * (`raw` of the drop event: "nel bosco trovi un sasso"), and nothing marks where the name begins:
 * the item is the longest known item name that ends the narrative, after a space or a line break,
 * or is all of it; else what follows the longest sentence prefix already seen before a known item
 * ("nel bosco trovi "), which names an item not known yet. One rule for the whole run (build.ts,
 * which learns the item names and the prefixes from every drop first) and for a reply read on its
 * own (the module's `resolveDrop`, with what its caller knows). Pure logic only.
 */
import { itemName } from './patterns.ts';

/** What the resolution of a drop knows of the game. */
export interface DropKnowledge {
  /** The item names known, as the bot writes them ("un sasso"). */
  readonly items: ReadonlySet<string>;
  /** The sentence prefixes seen before a known item ("nel bosco trovi "), in any order. */
  readonly prefixes: Iterable<string>;
}

/** A drop's item, as `resolveDrop` finds it. */
export interface DropResolution {
  /** The item's name. */
  item: string;
  /**
   * True when `item` is a known item that ends the narrative; false when it is what follows a
   * known prefix, an item not known yet, whose name is only as good as the prefix.
   */
  sure: boolean;
  /** The narrative before `item`, the sentence prefix it was found after (possibly ''). */
  prefix: string;
}

/** The longest known name that ends `raw` after a space or a line break, or is all of it. */
function knownSuffix(raw: string, items: ReadonlySet<string>): string | undefined {
  for (let i = -1; ;) {
    const n = raw.slice(i + 1);
    if (items.has(n)) return n;
    i = raw.slice(i + 1).search(/[ \n]/u);
    if (i < 0) return undefined;
    i += raw.length - n.length;
  }
}

/** The longest non-empty prefix that starts `raw` and leaves something after it. */
function longestPrefix(raw: string, prefixes: Iterable<string>): string | undefined {
  let best: string | undefined;
  for (const p of prefixes) {
    if (p !== '' && raw.length > p.length && raw.startsWith(p) && p.length > (best?.length ?? 0))
      best = p;
  }
  return best;
}

/**
 * The item of a drop, from its narrative (`raw`) and what is known: a known item that ends it
 * (`sure`), else what follows the longest known prefix that starts it; null when neither is found.
 */
export function resolveDrop(raw: string, known: DropKnowledge): DropResolution | null {
  const name = knownSuffix(raw, known.items);
  // An empty name counts as not found.
  if (name !== undefined && name !== '')
    return { item: name, sure: true, prefix: raw.slice(0, raw.length - name.length) };
  const prefix = longestPrefix(raw, known.prefixes);
  return prefix === undefined
    ? null
    : { item: itemName(raw.slice(prefix.length)), sure: false, prefix };
}
