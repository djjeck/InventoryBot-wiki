/**
 * Entries of the report (shown to the player): the pairs phase 4 dissolved, and what phase
 * 5 could not resolve or found contradictory. Pure functions, no Node APIs.
 *
 * Each kind of entry has its own named fields. An entry prints as one line: its kind,
 * then `field=value` pairs in the order of the type below, each value written as JSON
 * (strings in double quotes with JSON escapes, `null`, `true` / `false`, numbers, arrays
 * and objects), so a line is unambiguous and the same from run to run:
 *
 *   rarity_conflict: item="un sasso" old="C" new="N" date="2025-11-27T19:00:11-05:00"
 */

/** Ingredient name -> quantity. */
export type Ingredients = Record<string, number>;

export type ReportEntry =
  /** An item seen with two rarities; the newer one is kept. */
  | { kind: 'rarity_conflict'; item: string; old: string | null; new: string; date: string | null }
  /** A recipe seen with other ingredients; the newer list is kept. */
  | {
      kind: 'ingredient_conflict';
      recipe: string;
      source: 'detail' | 'craft';
      old: Ingredients;
      new: Ingredients;
      date: string | null;
    }
  /** One ingredient of a recipe replaced by another that is not a rename (see renamed_item). */
  | {
      kind: 'ingredient_conflict';
      recipe: string;
      source: 'swap';
      old_item: string;
      new_item: string;
      date: string | null;
    }
  /** A craft whose recipe could not be named; kept as an unnamed recipe. */
  | { kind: 'unnamed_recipe'; query: string | null; output: string | null }
  /** A recipe seen with another output; the newer one is kept. */
  | {
      kind: 'output_conflict';
      recipe: string;
      old: string;
      new: string;
      date: string | null;
    }
  /** An item whose known source contradicts its rarity class. */
  | { kind: 'source_vs_rarity'; item: string; rarity: string | null; sources: string[] }
  /** Ingredients a ready-recipe list shows that the full recipe does not have. */
  | { kind: 'partial_not_in_full'; recipe: string; missing: string[] }
  /** An exclusive item dropped in more than one place. */
  | { kind: 'exclusive_in_many_places'; item: string; locations: string[] }
  /** An adventure drop whose item name could not be isolated. */
  | { kind: 'unresolved_drop'; text: string }
  /** A use whose item could not be determined (text cut to 80 characters). */
  | { kind: 'unresolved_use'; query: string | null; text: string }
  /**
   * A group pair (`user` or `single`) that phase 4 dissolved (verify.ts): the reply,
   * classified with the command, is not of the command's family (`command`), or is a /usa
   * reply that does not fit the item its query names (`use_item`). `type` is the event the
   * command gave; the reply is then read without it. Text cut to 80 characters.
   */
  | {
      kind: 'dissolved_pair';
      reason: 'command' | 'use_item';
      match: 'user' | 'single';
      query: string;
      type: string;
      text: string;
    }
  /** A travel whose destination is not a known place (text cut to 80 characters). */
  | { kind: 'unresolved_travel'; query: string | null; text: string }
  /** Counts that show the item both consumed and not consumed by a use. */
  | { kind: 'use_consumption_conflict'; item: string; yes: number; no: number }
  /** Cooldown observations whose bounds contradict each other (seconds). */
  | { kind: 'cooldown_conflict'; item: string; min: number; max: number; observations: number }
  /** An item renamed by the game, detected from a recipe. */
  | { kind: 'renamed_item'; old: string; new: string; recipe: string; date: string | null };

export type ReportKind = ReportEntry['kind'];

/** One report line: `kind: field=value ...`, values as JSON. */
export function formatReportEntry(entry: ReportEntry): string {
  const { kind, ...fields } = entry;
  const pairs = Object.entries(fields).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  return `${kind}: ${pairs.join(' ')}`;
}

/** Report entries printed per kind; the count line gives the total. */
export const REPORT_LIMIT = 15;

/**
 * Report entries as lines, by kind in order of first appearance: per kind, `-- kind: N`
 * (with `(primi 15)` when there are more) and its first REPORT_LIMIT entries, indented.
 */
export function reportSections(entries: readonly ReportEntry[]): string[] {
  const byKind = new Map<ReportKind, ReportEntry[]>();
  for (const x of entries) {
    let l = byKind.get(x.kind);
    if (l === undefined) byKind.set(x.kind, (l = []));
    l.push(x);
  }
  const out: string[] = [];
  for (const [kind, list] of byKind) {
    const shown = Math.min(list.length, REPORT_LIMIT);
    out.push(`-- ${kind}: ${list.length}${shown < list.length ? ` (primi ${shown})` : ''}`);
    for (const x of list.slice(0, REPORT_LIMIT)) out.push(`  ${formatReportEntry(x)}`);
  }
  return out;
}
