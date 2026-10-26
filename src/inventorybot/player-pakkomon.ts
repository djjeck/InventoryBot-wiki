/**
 * The owner's Pakkomon, for the player state: each by its name, followed through every
 * event that shows it as the owner's (hatched, received, listed, examined, equipped,
 * fought, healed) until it is given away, extracted, or left out of a list of all the
 * owner's Pakkomon (the scanner's, a complete inventory), and back if it returns.
 *
 * The owner's own replies show their Pakkomon; a fight shows them whoever started it, so a
 * fight in which one of the owner's Pakkomon takes part counts, the challenger's reply or a
 * group notice included (not a forwarded copy). Other players' Pakkomon are not followed.
 *
 * Called after build() (it reads the use event's `used_item`). Pure logic only (no Node APIs).
 */
import { isoPlusSeconds } from '#src/lib/dates.ts';
import { compareCodePoints } from '#src/lib/text.ts';
import { instant, isMine, nameKey } from './build.ts';
import { pakkomonItem } from './pakkomon.ts';
import { type BuildEvent, type PlayerPakkomon } from './types.ts';

const PREFIX = pakkomonItem('');

/** The Pakkomon an item name is ("un Pakkomon di nome X" -> "X"), or null. */
export const pakkomonOf = (item: string): string | null =>
  item.startsWith(PREFIX) ? item.slice(PREFIX.length) : null;

/** The owner's Pakkomon, current ones first, then by name. */
export function ownerPakkomon(
  events: readonly BuildEvent[],
  player: string | null
): PlayerPakkomon[] {
  if (player === null) return [];
  const owner = player.toLowerCase();
  const isOwner = (u: string | null | undefined): boolean =>
    typeof u === 'string' && u.toLowerCase() === owner;
  const byKey = new Map<string, PlayerPakkomon>();

  /** The Pakkomon of this name, seen at `date`. */
  const get = (name: string, date: string | null): PlayerPakkomon => {
    const k = nameKey(name);
    let p = byKey.get(k);
    if (p === undefined) {
      p = {
        name,
        came: null,
        born: null,
        maker: null,
        first_seen: date,
        last_seen: date,
        gone: null,
        record: null,
        equipment: null,
        power_ups: [],
        power_up_items: [],
        fights: { won: 0, lost: 0, learned: 0 },
        best_win: null,
        stunned_until: null,
        probe: null,
      };
      byKey.set(k, p);
    }
    p.name = name;
    if (date !== null) {
      if (p.first_seen === null || instant(date) < instant(p.first_seen)) p.first_seen = date;
      if (p.last_seen === null || instant(date) > instant(p.last_seen)) p.last_seen = date;
    }
    return p;
  };
  /** The Pakkomon, the owner's at `date`: back with them if it had gone before. */
  const held = (name: string, date: string | null): PlayerPakkomon => {
    const p = get(name, date);
    if (p.gone !== null && instant(date) > instant(p.gone.date)) p.gone = null;
    return p;
  };
  const until = (date: string | null, seconds: number): string | null =>
    seconds > 0 ? isoPlusSeconds(date, seconds) : null;
  /**
   * A list of every Pakkomon the owner has at `date` (the scanner's, a complete
   * inventory's): one seen before and not listed is no longer theirs.
   */
  const listed = (names: readonly string[], date: string | null): void => {
    const keys = new Set(names.map(nameKey));
    for (const [k, p] of byKey)
      if (!keys.has(k) && p.gone === null && instant(p.last_seen) < instant(date))
        p.gone = { via: 'unlisted', to: null, date };
    for (const name of names) held(name, date);
  };

  for (const e of events) {
    if (e.forwarded) continue;
    const d = e.date ?? null;
    if (e.type === 'pakkomon_fight') {
      // Either side may be the owner's, whoever started the fight.
      if (isOwner(e.winner.owner)) {
        const p = held(e.winner.pakkomon, d);
        p.fights.won++;
        if (e.learned) p.fights.learned++;
        if (e.stun_min !== null && (p.best_win === null || e.stun_min > p.best_win.min))
          p.best_win = { min: e.stun_min, max: e.stun_max };
      }
      if (isOwner(e.loser.owner)) {
        const p = held(e.loser.pakkomon, d);
        p.fights.lost++;
        // A boss stays out until defeated: a hit does not stun it.
        if (!e.hit && e.stun_min !== null)
          p.stunned_until = until(d, 60 * (e.stun_max ?? e.stun_min));
      }
      continue;
    }
    if (e.type === 'give' && isOwner(e.to) && !isOwner(e.player)) {
      const name = pakkomonOf(e.item);
      if (name !== null)
        held(name, d).came ??= { via: 'received', from: e.player ?? null, date: d };
      continue;
    }
    if (!isMine(e, player)) continue;
    if (e.type === 'give') {
      const name = pakkomonOf(e.item);
      if (name !== null) get(name, d).gone = { via: 'given', to: e.to, date: d };
    } else if (e.type === 'gift') {
      const name = pakkomonOf(e.item);
      if (name !== null) held(name, d).came ??= { via: 'received', from: e.from, date: d };
    } else if (e.type === 'inventory') {
      const names = e.items.map((x) => pakkomonOf(x.name)).filter((n) => n !== null);
      if (!e.filtered && !e.truncated) listed(names, d);
      else for (const name of names) held(name, d);
    } else if (e.type === 'item_info' || e.type === 'show') {
      const name = pakkomonOf(e.item);
      if (name !== null) held(name, d);
    } else if (e.type === 'pakkomon_record') {
      const p = held(e.pakkomon, d);
      p.record = { wins: e.wins, losses: e.losses, date: d };
      p.equipment = e.equipment?.name ?? null;
      p.power_ups = [...e.power_ups];
      p.stunned_until = until(d, e.stunned_for);
      if (e.born !== null) {
        p.born = e.born;
        p.maker = e.maker;
      }
    } else if (e.type === 'pakkomon_ready' || e.type === 'pakkomon_challenge') {
      held(e.pakkomon, d);
    } else if (e.type === 'pakkomon_stunned' && e.pakkomon !== null) {
      held(e.pakkomon, d).stunned_until = until(d, e.remaining);
    } else if (e.type === 'use') {
      const [first, second] = e.pakkomon ?? [];
      switch (e.pakkomon_use) {
        case 'hatch':
          if (first !== undefined)
            held(first, d).came ??= {
              via: 'hatched',
              from: e.used_item ?? e.named ?? null,
              date: d,
            };
          break;
        case 'equip':
          if (first !== undefined) held(first, d).equipment = e.takes?.[0] ?? null;
          break;
        case 'scan':
          listed(
            (e.scan ?? []).map((s) => s.pakkomon),
            d
          );
          for (const s of e.scan ?? []) held(s.pakkomon, d).stunned_until = until(d, s.remaining);
          break;
        case 'heal':
          if (first !== undefined) held(first, d).stunned_until = null;
          break;
        case 'power_up': {
          const item = e.named ?? e.used_item;
          const p = first === undefined ? null : held(first, d);
          if (p !== null && item !== undefined && !p.power_up_items.includes(item))
            p.power_up_items.push(item);
          break;
        }
        case 'probe':
          if (first !== undefined) held(first, d).probe = e.reading ?? null;
          break;
        case 'scale':
          for (const name of [first, second]) if (name !== undefined) held(name, d);
          break;
        case 'extract':
          if (first !== undefined) get(first, d).gone = { via: 'extracted', to: null, date: d };
          break;
        default:
          break;
      }
    }
  }
  return [...byKey.values()].sort(
    (a, b) => Number(a.gone !== null) - Number(b.gone !== null) || compareCodePoints(a.name, b.name)
  );
}
