import { describe, expect, it } from 'vitest';
import { shapeGiven, shapeOf, unshaped } from './shapes.ts';

describe('shaped items', () => {
  it('a_shaped_item_is_the_item_shaped', () => {
    expect(unshaped("un po' di creta modellato a forma di un drago")).toBe("un po' di creta");
    expect(unshaped("un po' di creta")).toBe("un po' di creta");
  });

  it('the_shape_of_an_item_and_the_shape_a_use_gave', () => {
    expect(shapeOf("un po' di creta modellato a forma di un drago")).toBe('un drago');
    expect(shapeOf("un po' di creta")).toBeNull();
    expect(shapeGiven('@mario_r, gli dai la forma di un drago')).toBe('un drago');
    expect(shapeGiven('@mario_r, niente')).toBeNull();
  });
});
