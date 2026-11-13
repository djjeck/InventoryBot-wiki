/**
 * Personal state of the export owner, kept apart from the objective wiki: InventoryBotTron's
 * player state (`@inventorybottron/state`), folded over the events of the export one at a time
 * and shown as its view.
 *
 * Called after build(): the state reads the annotations build.ts makes in place (a drop's item
 * and place, `resolved` and `location`; a craft's `recipe`; a /usa reply's `used_item`), and what
 * the whole export teaches of the game is given to it as its `Know`: an item's rarity (for a
 * rarity-filtered /inventario), whether a use consumes the item, a recipe's ingredients (for the
 * check of the estimate against the bot's /ricetta lists) and every item known (for the item a
 * /dai names). Two more things only a whole export tells:
 *
 * - an item the game renamed is one item for the owner's counts: every event is read with the
 *   current names (`renamed`);
 * - a /dai in a group to the owner is also notified in the DM ("ti ha dato"): the two are the
 *   same transfer, and the group's is marked `notified`, so that it is counted once
 *   (`sameTransfer`), whichever comes first.
 *
 * The rules of the estimate, the recipes made, the items seen and used, the places, the
 * Pakkomon and the shapes are the state's (its `reduce.ts`, `pakkomon.ts` and `view.ts`).
 *
 * Pure logic only (no Node APIs).
 */
import { unshaped } from '@inventorybottron/grammar/shapes.ts';
import {
  apply,
  initialState,
  isMine,
  type Know,
  playerView,
  renamed,
  sameTransfer,
  type StateEvent,
} from '@inventorybottron/state';
import { type KB } from './build.ts';
import { type BuildEvent, type PlayerState } from './types.ts';

/** What the whole export teaches of the game, for the state. */
export function knowledgeOf(kb: KB): Know {
  return {
    rarityOf: (n) => kb.items.get(unshaped(n))?.rarity,
    consumed: (item) => kb.items.get(item)?.use?.consumed === true,
    ingredients: (recipe) => kb.recipes.get(recipe)?.ingredients ?? undefined,
    items: () => kb.items.keys(),
  };
}

/** The owner's state, from the events annotated by build(). */
export function playerState(input: readonly BuildEvent[], kb: KB): PlayerState {
  const player = kb.player;
  // An item renamed by the game is one item for the owner's counts.
  const events = kb.renames.size > 0 ? input.map((e) => renamed(e, kb.renames)) : input;
  const gifts = events.filter(
    (e): e is Extract<BuildEvent, { type: 'gift' }> => e.type === 'gift' && isMine(e, player)
  );
  const know = knowledgeOf(kb);
  const state = initialState(player);
  for (const e of events) {
    // A group give to the owner already counted by its DM notice.
    const notified = e.type === 'give' && e.to === player && gifts.some((x) => sameTransfer(e, x));
    apply(state, (notified ? { ...e, notified } : e) as StateEvent, know);
  }
  return playerView(state, kb.locations.keys());
}
