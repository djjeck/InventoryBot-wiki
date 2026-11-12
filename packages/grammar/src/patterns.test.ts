/** patterns.ts: the text conventions of InventoryBot's replies. */
import { describe, expect, it } from 'vitest';
import { itemName } from './patterns.ts';

describe('itemName', () => {
  it('whitespace_runs_become_one_space_and_the_ends_are_trimmed', () => {
    expect(itemName(' un\u00a0sasso  grande ')).toBe('un sasso grande');
  });

  it('line_breaks_of_a_player_made_name_stay', () => {
    expect(itemName('\nuna cornice con dentro \n- un sasso')).toBe(
      'una cornice con dentro\n- un sasso'
    );
  });
});
