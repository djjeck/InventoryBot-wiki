/**
 * The export owner: whose page the run builds. Generic. Pure functions, no Node APIs.
 *
 * Decided once per run, after phase 2 and before phase 3 (anonymisation, which keeps the
 * owner's username as written): the username the player gives, else ownerFromDm on the
 * replies. Without a DM and without a given username there is no owner (hasDm).
 */
import { increment, mostCommon } from '#src/lib/counts.ts';

/** The fields the owner is read from: a reply's context, or an event. */
export interface Addressed {
  dm?: boolean | undefined;
  player?: string | null | undefined;
}

/**
 * The player the bot addresses most often in the DM (ties: the first seen), or null.
 * Groups are not used: another member may use the bot there more than the owner.
 */
export function ownerFromDm(records: Iterable<Addressed>): string | null {
  const c = new Map<string, number>();
  for (const r of records) if (r.dm && r.player) increment(c, r.player);
  return c.size > 0 ? (mostCommon(c)[0] as [string, number])[0] : null;
}

/** Whether any record is from the DM: without one, the owner must be given. */
export const hasDm = (records: Iterable<Addressed>): boolean => {
  for (const r of records) if (r.dm) return true;
  return false;
};
