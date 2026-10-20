import { describe, expect, it } from 'vitest';
import { hasDm, ownerFromDm } from './owner.ts';

describe('owner', () => {
  it('the_player_the_bot_addresses_most_in_the_dm', () => {
    const records = [
      { dm: true, player: 'luigi' },
      { dm: true, player: 'djjeck' },
      { dm: true, player: 'djjeck' },
      { dm: false, player: 'mario' }, // groups do not count
      { dm: false, player: 'mario' },
      { dm: false, player: 'mario' },
      { dm: true, player: null },
    ];
    expect(ownerFromDm(records)).toBe('djjeck');
    expect(hasDm(records)).toBe(true);
  });

  it('ties_go_to_the_first_seen_and_no_dm_means_no_owner', () => {
    expect(
      ownerFromDm([
        { dm: true, player: 'luigi' },
        { dm: true, player: 'djjeck' },
      ])
    ).toBe('luigi');
    const groups = [{ dm: false, player: 'mario' }];
    expect(ownerFromDm(groups)).toBeNull();
    expect(hasDm(groups)).toBe(false);
  });
});
