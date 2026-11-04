/**
 * Which stored exports are of the same chat, for the list of exports (labels.ts). An
 * export has no chat id (docs/telegram-export.md §6.1), only its chat's title at the time
 * it was made: exports of the same title are of the same chat, and so are two exports of
 * which one holds the first messages of the other (`SAMPLE` of them, each with the same
 * message id and the same second of its date), so that a chat renamed between two
 * overlapping exports is still one. Exports that neither share a title nor overlap stay
 * apart. Pure, tested in Node.
 */
import { parseMacDate, parseWindowsDate } from '#src/lib/dates.ts';
import { type ExportRecord } from '#src/telegram/export/record.ts';

/**
 * How many of an export's first messages another must hold to be of its chat. A message
 * id is unique only within a chat, and the second of its date tells it apart from that of
 * another chat in one case out of 60: several of them together do not match by chance.
 */
export const SAMPLE = 5;

/** What the grouping reads of an export: its key, its chat titles and, if loaded, its record. */
export interface ChatSource {
  hash: string;
  chats: readonly (string | null)[];
  record?: ExportRecord | undefined;
}

/** An export's messages, as message id -> second of its date, and its first ones. */
export interface Fingerprint {
  seconds: Map<number, number>;
  first: [id: number, second: number][];
}

/** Fingerprints by record hash, kept from one grouping to the next (the worker's). */
export type FingerprintCache = Map<string, Fingerprint>;

/**
 * The second of a date as the export wrote it, null without a date. Only the second: it is
 * the same whatever the time zone and the platform of the export (a macOS date has no offset).
 */
function second(date: string | null): number | null {
  return (parseWindowsDate(date) ?? parseMacDate(date))?.second ?? null;
}

function fingerprint(record: ExportRecord, cache: FingerprintCache): Fingerprint {
  let f = cache.get(record.hash);
  if (f !== undefined) return f;
  f = { seconds: new Map(), first: [] };
  for (const e of record.entries) {
    const [id, date] = Array.isArray(e) ? [e[1], e[2]] : [e.id, e.date];
    const s = second(date);
    if (s === null) continue;
    f.seconds.set(id, s);
    if (f.first.length < SAMPLE) f.first.push([id, s]);
  }
  cache.set(record.hash, f);
  return f;
}

/** Whether `a` holds the first messages of `b`. */
function holdsStart(a: Fingerprint, b: Fingerprint): boolean {
  return b.first.length > 0 && b.first.every(([id, s]) => a.seconds.get(id) === s);
}

/** Whether two records are exports of the same chat because they overlap. */
export function overlap(
  a: ExportRecord,
  b: ExportRecord,
  cache: FingerprintCache = new Map()
): boolean {
  const fa = fingerprint(a, cache);
  const fb = fingerprint(b, cache);
  return holdsStart(fa, fb) || holdsStart(fb, fa);
}

/**
 * The chat of each export: hash -> the smallest hash among the exports of its chat. Two
 * exports are of one chat if they share a title, or their records (when loaded) overlap,
 * and so on along any chain of them. `cache` keeps the fingerprints of the records for the
 * next call, and drops those of the exports no longer given.
 */
export function chatKeys(
  sources: readonly ChatSource[],
  cache: FingerprintCache = new Map()
): Map<string, string> {
  const given = new Set(sources.map((s) => s.hash));
  for (const h of cache.keys()) if (!given.has(h)) cache.delete(h);
  const parent = new Map(sources.map((s) => [s.hash, s.hash]));
  const find = (h: string): string => {
    let root = h;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    parent.set(h, root);
    return root;
  };
  const join = (a: string, b: string): void => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  const byTitle = new Map<string, string>();
  for (const s of sources)
    for (const title of s.chats) {
      if (title === null || title === '') continue;
      const seen = byTitle.get(title);
      if (seen === undefined) byTitle.set(title, s.hash);
      else join(seen, s.hash);
    }
  const loaded = sources.filter((s) => s.record !== undefined);
  for (const [i, a] of loaded.entries())
    for (const b of loaded.slice(i + 1))
      if (find(a.hash) !== find(b.hash) && overlap(a.record!, b.record!, cache))
        join(a.hash, b.hash);
  return new Map(sources.map((s) => [s.hash, find(s.hash)]));
}
