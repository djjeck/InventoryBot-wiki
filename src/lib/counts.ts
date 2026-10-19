/**
 * Counting helpers shared by the phases. Pure functions, no Node APIs.
 *
 * Counts are Maps, so entries keep insertion order and ties are broken by first
 * appearance, which keeps every output deterministic.
 */

/** Entries by count, descending; ties keep insertion order (the sort is stable). */
export function mostCommon<K>(c: ReadonlyMap<K, number>): [K, number][] {
  return [...c].sort((a, b) => b[1] - a[1]);
}

/** Adds one to the count of `k`. */
export function increment<K>(c: Map<K, number>, k: K): void {
  c.set(k, (c.get(k) ?? 0) + 1);
}
