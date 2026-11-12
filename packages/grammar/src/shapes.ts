/** Items a use gave a shape to, as the bot names them. Pure logic only. */

/**
 * How the bot names an item a use gave a shape to: the item, then the shape the player
 * typed (docs/bot-protocol.md 2.6). It is the same item whatever its shape.
 */
const SHAPED = ' modellato a forma di ';
/** Where a use's reply names the shape the player gave the item, up to the end of the reply. */
export const SHAPED_AS = 'gli dai la forma di ';

/** The item a shaped item is ("NAME modellato a forma di TEXT" is NAME); any other name as it is. */
export function unshaped(name: string): string {
  const i = name.indexOf(SHAPED);
  return i > 0 ? name.slice(0, i) : name;
}

/** The shape of a shaped item ("NAME modellato a forma di TEXT" is TEXT), or null. */
export function shapeOf(name: string): string | null {
  const i = name.indexOf(SHAPED);
  return i > 0 ? name.slice(i + SHAPED.length).trim() : null;
}

/** The shape a use's reply gave the item ("… gli dai la forma di TEXT" is TEXT), or null. */
export function shapeGiven(text: string): string | null {
  const i = text.indexOf(SHAPED_AS);
  return i < 0 ? null : text.slice(i + SHAPED_AS.length).trim() || null;
}
