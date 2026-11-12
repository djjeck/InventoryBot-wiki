import { describe, expect, it } from 'vitest';
import { resolveDrop } from './drops.ts';

const known = (items: string[], prefixes: string[] = []) => ({ items: new Set(items), prefixes });

describe('resolveDrop', () => {
  it('known_item_at_the_end_is_sure_with_its_prefix', () => {
    expect(resolveDrop('nel bosco trovi un sasso', known(['un sasso']))).toStrictEqual({
      item: 'un sasso',
      sure: true,
      prefix: 'nel bosco trovi ',
    });
  });

  it('longest_known_name_wins', () => {
    expect(resolveDrop('nella grotta trovi una spada', known(['spada', 'una spada']))?.item).toBe(
      'una spada'
    );
  });

  it('on_a_word_boundary_or_a_line_break', () => {
    expect(resolveDrop('nel fosso vedi una marana', known(['rana']))).toBeNull();
    expect(resolveDrop('nello stagno salta rana', known(['rana']))?.item).toBe('rana');
    const framed = 'una cornice con dentro\n- un sasso';
    expect(resolveDrop(`nel bosco trovi ${framed}`, known([framed]))).toStrictEqual({
      item: framed,
      sure: true,
      prefix: 'nel bosco trovi ',
    });
  });

  it('the_whole_narrative_is_a_known_item_with_an_empty_prefix', () => {
    expect(resolveDrop('un sasso', known(['un sasso']))).toStrictEqual({
      item: 'un sasso',
      sure: true,
      prefix: '',
    });
  });

  it('unknown_item_after_the_longest_known_prefix_is_not_sure', () => {
    const k = known([], ['nel ', 'nel bosco trovi ', 'nel bosco ']);
    expect(resolveDrop('nel bosco trovi  un dado di legno ', k)).toStrictEqual({
      item: 'un dado di legno',
      sure: false,
      prefix: 'nel bosco trovi ',
    });
  });

  it('a_known_item_wins_over_a_prefix', () => {
    const k = known(['legno', 'un dado di legno'], ['nel bosco trovi un dado ']);
    expect(resolveDrop('nel bosco trovi un dado di legno', k)?.sure).toBe(true);
    expect(resolveDrop('nel bosco trovi un dado di legno', k)?.item).toBe('un dado di legno');
  });

  it('empty_or_whole_prefixes_never_match', () => {
    expect(resolveDrop('nel fosso vedi una cosa strana', known([], ['']))).toBeNull();
    expect(resolveDrop('nel bosco trovi ', known([], ['nel bosco trovi ']))).toBeNull();
  });

  it('nothing_known', () => {
    expect(resolveDrop('sulla spiaggia raccogli una conchiglia', known([]))).toBeNull();
  });
});
