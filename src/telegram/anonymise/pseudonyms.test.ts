import { describe, expect, it } from 'vitest';
import { ADJECTIVES, ANIMALS, fnv1a, pseudonym, PseudonymSource } from './pseudonyms.ts';

const PSEUDONYM = /^[A-Z][a-z]+[A-Z][a-z]+\d*$/u;

describe('pseudonyms', () => {
  it('compound_names_animal_then_invariable_adjective', () => {
    expect(new Set(ANIMALS).size).toBe(ANIMALS.length);
    expect(new Set(ADJECTIVES).size).toBe(ADJECTIVES.length);
    for (const w of [...ANIMALS, ...ADJECTIVES]) expect(w).toMatch(/^[A-Z][a-z]+$/u);
    // Adjectives in -e agree with masculine and feminine nouns alike.
    for (const a of ADJECTIVES) expect(a.endsWith('e'), a).toBe(true);
    const n = ANIMALS.length * ADJECTIVES.length;
    expect(n).toBeGreaterThan(5000);
    const all = Array.from({ length: n }, (_, i) => pseudonym(i));
    expect(new Set(all).size).toBe(n);
    for (const p of all) expect(p).toMatch(PSEUDONYM);
  });

  it('exhausted_lists_append_a_number', () => {
    const animals = ['Volpe', 'Gufo'];
    const adjectives = ['Veloce'];
    expect([0, 1, 2, 3, 4].map((i) => pseudonym(i, animals, adjectives))).toStrictEqual([
      'VolpeVeloce',
      'GufoVeloce',
      'VolpeVeloce2',
      'GufoVeloce2',
      'VolpeVeloce3',
    ]);
  });

  it('fnv1a_matches_the_reference_values', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });
});

describe('PseudonymSource', () => {
  it('the_same_name_and_salt_give_the_same_pseudonym_in_any_run', () => {
    const a = new PseudonymSource('salt', new Set());
    const b = new PseudonymSource('salt', new Set());
    b.for('someone else first');
    expect(b.for('luigi')).toBe(a.for('luigi'));
    expect(a.for('luigi')).toMatch(PSEUDONYM);
  });

  it('another_salt_gives_other_pseudonyms', () => {
    const names = ['luigi', 'anna', 'mario', 'zeta'];
    const one = names.map((n) => new PseudonymSource('one', new Set()).for(n));
    const two = names.map((n) => new PseudonymSource('two', new Set()).for(n));
    expect(one).not.toStrictEqual(two);
  });

  it('memoized_so_asking_again_gives_the_same_pseudonym', () => {
    const s = new PseudonymSource('salt', new Set(), ['Volpe', 'Gufo'], ['Veloce']);
    const first = s.for('a');
    // Without the memo the pseudonym would now count as taken and the next one be served.
    expect(s.for('a')).toBe(first);
  });

  it('collisions_and_taken_names_move_to_the_next_pseudonym', () => {
    const tiny = (taken: string[]) =>
      new PseudonymSource('salt', new Set(taken), ['Volpe', 'Gufo'], ['Veloce']);
    const s = tiny([]);
    const served = ['a', 'b', 'c'].map((n) => s.for(n));
    expect(new Set(served).size).toBe(3); // two pairs only: the third gets a number
    expect(served.filter((p) => /\d$/u.test(p))).toHaveLength(1);
    // A real username of the run is never served, ignoring case.
    const t = tiny(['volpeveloce', 'gufoveloce']);
    expect(['a', 'b'].map((n) => t.for(n)).every((p) => p.endsWith('2'))).toBe(true);
  });
});
