/**
 * Personal state of the export owner, kept apart from the objective wiki.
 *
 * Called after build() (it relies on build.ts's in-memory event annotations: drop
 * "resolved"/"location", craft "recipe", use "used_item"). Produces the player state:
 *
 *   recipes     times crafted and last time, per recipe
 *   items       first time each item was seen
 *   locations   visited or not, adventures done there
 *   recipe_list the latest /ricetta list (visible recipes and their status; if it was
 *               truncated, the recipes after the cut are unknown)
 *   inventory   estimated holdings, see below
 *   inventory_check  how often the estimate agreed with the bot, see below
 *
 * Inventory estimate. The bot never shows the full inventory reliably (long
 * /inventario replies are cut off), so holdings are rebuilt from every
 * observation, the newest one always overwriting older ones:
 *
 *   /inventario complete, unfiltered   exact for everything; unlisted items -> 0
 *   /inventario complete, filtered     exact for listed items; unlisted items in the
 *                                      filter's scope -> 0 (see build.inventoryScope:
 *                                      a rarity like "C", or words of the name)
 *   /inventario truncated, "M" filter,
 *   or with an unknown command         exact for listed items only
 *   /esamina "Ne hai N"                exact
 *   "ti manca X xK" (needs N)          exact: N-K
 *   "hai gia' X xK", /ricetta [*]      at least K (the bot caps it at the quantity the
 *                                      recipe needs, so it is only a lower bound)
 *   /mostra "possedere Kx"             at least K
 *   /dai "ne possiedi solo N"          exact, for the item the /dai command names
 *   drops, gifts, crafts, /usa, /dai   applied as deltas to the last value; a /usa of an
 *                                      item the wiki found to be consumed takes one away
 *
 * A /dai in a group to the owner is also notified in the DM ("ti ha dato"): the
 * two are the same transfer and are counted once.
 *
 * Each entry records whether it is exact, and the date and kind of the last
 * observation that set it. Only events addressed to the owner are used.
 *
 * Check of the estimate. Every recipe of a /ricetta list whose ingredients are known is
 * compared with the estimate of that moment, before the list's own observations: the
 * units it says are missing ("manca K", 0 for "*") against the units the estimate lacks.
 * Disagreements come from what the exports do not show: items found, given, received or
 * used in chats that were not added.
 *
 * Pure logic only (no Node APIs).
 */
import { isoDateSeconds } from '#src/lib/dates.ts';
import { compareCodePoints } from '#src/lib/text.ts';
import { inventoryScope, isFailedUse, isMine, type KB } from './build.ts';
import { type BuildEvent, type Holding, type HoldingVia, type PlayerState } from './types.ts';

export class Holdings {
  /** name -> holding, in order of first observation. */
  readonly h = new Map<string, Holding>();

  exact(name: string, qty: number, date: string | null, via: HoldingVia): void {
    this.h.set(name, { qty, exact: true, date, via });
  }

  atLeast(name: string, qty: number, date: string | null, via: HoldingVia): void {
    const cur = this.h.get(name);
    if (cur && cur.qty >= qty) return; // still consistent with what we knew
    this.h.set(name, { qty, exact: false, date, via });
  }

  delta(name: string, d: number, date: string | null): void {
    const cur = this.h.get(name);
    if (cur === undefined) {
      // Never observed: we only know about this change.
      this.h.set(name, { qty: Math.max(d, 0), exact: false, date, via: 'movimento' });
      return;
    }
    const q = cur.qty + d;
    if (q < 0) cur.exact = false; // we under-counted at some point
    cur.qty = Math.max(q, 0);
  }

  zeroExcept(
    keep: ReadonlyMap<string, number>,
    pred: (name: string) => boolean,
    date: string | null,
    via: HoldingVia
  ): void {
    for (const name of this.h.keys()) {
      if (!keep.has(name) && pred(name)) this.exact(name, 0, date, via);
    }
  }
}

/** The fields sameTransfer() reads. */
export interface Transfer {
  date: string | null;
  item: string;
  qty: number;
}

/**
 * Largest gap, in seconds, between a group "/dai ... a @me" and the DM notice "@x ti ha
 * dato" for the same transfer, in either order. Not GROUP_WINDOW (the dialect's groupWindow): that
 * pairs a reply with a command sent before it in the same chat, while this matches two
 * messages of different chats about one event, whichever arrives first.
 */
export const TRANSFER_WINDOW = 120;

/** A group "/dai ... a @me" and the DM notice "@x ti ha dato" for it (within TRANSFER_WINDOW). */
export function sameTransfer(
  give: Transfer & { player?: string | null },
  gift: Transfer & { from: string }
): boolean {
  const a = isoDateSeconds(give.date);
  const b = isoDateSeconds(gift.date);
  if (a === null || b === null) return false;
  return (
    gift.from === give.player &&
    gift.item === give.item &&
    gift.qty === give.qty &&
    Math.abs(a - b) <= TRANSFER_WINDOW
  );
}

/** Event fields holding one item name. */
const ITEM_FIELDS: ReadonlySet<string> = new Set(['item', 'output', 'resolved', 'used_item']);
/** Event fields holding item lines (`{name, rarity, usable, qty}`). */
const ITEM_LINE_FIELDS: ReadonlySet<string> = new Set(['items', 'ingredients', 'missing', 'have']);

/**
 * Copy of an event with every renamed item name replaced by the current one. Only item
 * fields change: places, chat titles, queries, texts and recipe names stay as they are.
 */
export function renamed<T extends BuildEvent>(e: T, renames: ReadonlyMap<string, string>): T {
  if (e.type === 'stats') return e; // free-form fields; its unique items do not count for the holdings
  const name = (n: unknown): unknown => (typeof n === 'string' ? (renames.get(n) ?? n) : n);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (ITEM_FIELDS.has(k)) out[k] = name(v);
    else if (ITEM_LINE_FIELDS.has(k) && Array.isArray(v))
      out[k] = v.map((x: { name: string }) => ({ ...x, name: name(x.name) }));
    else out[k] = v;
  }
  return out as T;
}

/** Words of the item in "/dai USER [QTY] ITEM" (lower case), or null. */
function daiWords(query: string | null | undefined): string[] | null {
  const w = (query ?? '').split(/\s+/u).filter((x) => x !== '');
  if ((w[0] ?? '').toLowerCase() !== '/dai' || w.length < 3) return null;
  const rest = /^\p{Nd}+$/u.test(w[2] as string) ? w.slice(3) : w.slice(2);
  return rest.length > 0 ? rest.map((x) => x.toLowerCase()) : null;
}

/**
 * The item a /dai command names, the way the bot looks it up (every word in the name,
 * ignoring case): the only match among the items the owner is estimated to hold, else
 * the only match among the wiki's items; null when there is none or several.
 */
function daiItem(query: string | null | undefined, hold: Holdings, kb: KB): string | null {
  const words = daiWords(query);
  if (words === null) return null;
  const fits = (n: string): boolean => words.every((x) => n.toLowerCase().includes(x));
  for (const pool of [
    [...hold.h].filter(([, v]) => v.qty > 0).map(([n]) => n),
    [...kb.items.keys()],
  ]) {
    const c = pool.filter(fits);
    if (c.length === 1) return c[0] as string;
    if (c.length > 1) return null;
  }
  return null;
}

const increment = (c: Map<string, number>, k: string): void => {
  c.set(k, (c.get(k) ?? 0) + 1);
};

const byKey = <V>(m: ReadonlyMap<string, V>): [string, V][] =>
  [...m].sort((a, b) => compareCodePoints(a[0], b[0]));

/** The owner's state, from the events annotated by build(). */
export function playerState(input: readonly BuildEvent[], kb: KB): PlayerState {
  const player = kb.player;
  // An item renamed by the game is one item for the owner's counts.
  const events = kb.renames.size > 0 ? input.map((e) => renamed(e, kb.renames)) : input;
  const gifts = events.filter(
    (e): e is Extract<BuildEvent, { type: 'gift' }> => e.type === 'gift' && isMine(e, player)
  );
  const notified = new Set<string>(); // group gives to the owner already counted via a DM notice
  for (const g of events) {
    if (g.type === 'give' && g.to === player && gifts.some((x) => sameTransfer(g, x)))
      notified.add(JSON.stringify([g.chat, g.msg]));
  }
  const hold = new Holdings();
  const crafted = new Map<string, number>();
  const lastCrafted = new Map<string, string | null>();
  const firstSeen = new Map<string, string | null>();
  const visited = new Set<string>();
  const adventures = new Map<string, number>();
  let lastList: PlayerState['recipe_list'] = null;
  const check: PlayerState['inventory_check'] = { compared: 0, agreed: 0 };
  const rarityOf = (n: string): string | null | undefined => kb.items.get(n)?.rarity;

  const seen = (name: string | null | undefined, date: string | null): void => {
    if (name && !firstSeen.has(name)) firstSeen.set(name, date);
  };

  for (const e of events) {
    const d = e.date ?? null;
    if (e.type === 'give' && e.to === player && e.player !== player) {
      if (!notified.has(JSON.stringify([e.chat, e.msg]))) {
        seen(e.item, d);
        hold.delta(e.item, e.qty, d);
      }
      continue;
    }
    if (!isMine(e, player)) continue;
    if (e.type === 'inventory') {
      const listed = new Map(e.items.map((x) => [x.name, x.qty]));
      const scope = inventoryScope(e, rarityOf);
      if (scope) hold.zeroExcept(listed, scope, d, 'inventario');
      for (const [n, q] of listed) {
        hold.exact(n, q, d, 'inventario');
        seen(n, d);
      }
    } else if (e.type === 'item_info') {
      seen(e.item, d);
      if (e.count !== null) hold.exact(e.item, e.count, d, 'esamina');
    } else if (e.type === 'recipe_detail') {
      const need = new Map<string, number>();
      for (const x of [...e.missing, ...e.have]) {
        need.set(x.name, (need.get(x.name) ?? 0) + x.qty);
        seen(x.name, d);
      }
      const missing = new Set(e.missing.map((x) => x.name));
      for (const x of e.missing)
        hold.exact(x.name, (need.get(x.name) as number) - x.qty, d, 'ricetta');
      for (const x of e.have) if (!missing.has(x.name)) hold.atLeast(x.name, x.qty, d, 'ricetta');
    } else if (e.type === 'recipe_list') {
      const recipes = new Map(
        e.recipes.map((r) => [r.name, r.ready ? 'pronta' : `manca ${r.missing}`])
      );
      lastList = { date: d, truncated: e.truncated, recipes: Object.fromEntries(recipes) };
      // The bot's count of missing units against the estimate's, before the list adds to it.
      for (const r of e.recipes) {
        const ingr = kb.recipes.get(r.name)?.ingredients;
        if (!ingr || ingr.size === 0) continue;
        let missing = 0;
        for (const [n, q] of ingr) missing += Math.max(0, q - (hold.h.get(n)?.qty ?? 0));
        check.compared++;
        if (missing === (r.ready ? 0 : r.missing)) check.agreed++;
      }
      for (const r of e.recipes) {
        const ingr = kb.recipes.get(r.name)?.ingredients;
        if (r.ready && ingr && ingr.size > 0)
          for (const [n, q] of ingr) hold.atLeast(n, q, d, 'ricetta');
      }
    } else if (e.type === 'craft') {
      for (const x of e.ingredients) {
        seen(x.name, d);
        hold.atLeast(x.name, x.qty, d, 'ricetta');
        hold.delta(x.name, -x.qty, d);
      }
      if (e.output) {
        seen(e.output, d);
        hold.delta(e.output, 1, d);
      }
      if (e.recipe) {
        increment(crafted, e.recipe);
        lastCrafted.set(e.recipe, d);
      }
    } else if (e.type === 'drop' && e.resolved) {
      seen(e.resolved, d);
      hold.delta(e.resolved, 1, d);
      if (e.location) increment(adventures, e.location);
    } else if (e.type === 'gift') {
      seen(e.item, d);
      hold.delta(e.item, e.qty, d);
    } else if (e.type === 'give') {
      // the owner gave something away
      seen(e.item, d);
      hold.delta(e.item, -e.qty, d);
    } else if (e.type === 'show') {
      seen(e.item, d);
      hold.atLeast(e.item, e.qty, d, 'mostra');
    } else if (e.type === 'use') {
      for (const x of e.items) {
        seen(x.name, d);
        hold.delta(x.name, x.qty, d);
      }
      // A successful use of an item the wiki found to be consumed takes one away;
      // for items whose consumption is not verified the count is left alone.
      const used = e.used_item;
      if (used && kb.items.get(used)?.use?.consumed && !isFailedUse(e.text))
        hold.delta(used, -1, d);
    } else if (e.type === 'miss' && e.owned !== undefined) {
      // "non ne hai abbastanza, ne possiedi solo N": exact, for the item the /dai named.
      const item = daiItem(e.query, hold, kb);
      if (item !== null) {
        seen(item, d);
        hold.exact(item, e.owned, d, 'dai');
      }
    } else if (e.type === 'travel' || e.type === 'location') {
      if (e.location !== null) visited.add(e.location);
    } else if (e.type === 'stats') {
      const luogo = (e as Record<string, unknown>)['luogo'];
      if (typeof luogo === 'string' && luogo) visited.add(luogo);
    }
  }

  const asOf = [...events].reverse().find((e) => isMine(e, player));
  return {
    player,
    as_of: asOf === undefined ? null : (asOf.date ?? null),
    recipes: Object.fromEntries(
      byKey(crafted).map(([n, c]) => [n, { crafted: c, last_crafted: lastCrafted.get(n) ?? null }])
    ),
    items: Object.fromEntries(byKey(firstSeen).map(([n, d]) => [n, { first_seen: d }])),
    locations: Object.fromEntries(
      [...kb.locations.keys()]
        .sort(compareCodePoints)
        .map((n) => [n, { visited: visited.has(n), adventures: adventures.get(n) ?? 0 }])
    ),
    recipe_list: lastList,
    inventory: Object.fromEntries(byKey(hold.h).filter(([, v]) => v.qty > 0)),
    inventory_check: check,
  };
}
