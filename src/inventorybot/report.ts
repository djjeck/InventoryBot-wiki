/**
 * Entries of the report (shown to the player): what phase 4 found inconsistent. Pure
 * functions, no Node APIs.
 *
 * Each kind of entry has its own named fields. An entry prints as one line: its kind,
 * then `field=value` pairs in the order of the type below, each value written as JSON
 * (strings in double quotes with JSON escapes, `null`, `true` / `false`, numbers, arrays
 * and objects), so a line is unambiguous and the same from run to run:
 *
 *   dissolved_pair: reason="command" match="single" query="/inventario" type="drop" text="…"
 */

export type ReportEntry =
  /**
   * A group pair (`user` or `single`) that phase 4 dissolved (verify.ts): the reply,
   * classified with the command, is not of the command's family (`command`). `type` is the
   * event the command gave; the reply is then read without it. Text cut to 80 characters.
   */
  {
    kind: 'dissolved_pair';
    reason: 'command';
    match: 'user' | 'single';
    query: string;
    type: string;
    text: string;
  };

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
