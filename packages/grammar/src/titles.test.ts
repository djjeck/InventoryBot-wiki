import { describe, expect, it } from 'vitest';
import { learnTitles, replyNormalizer, stripSuaMaesta, titleStripper } from './titles.ts';

describe('titles', () => {
  it('learned_from_comma_form_min_twice', () => {
    expect(
      learnTitles(['@u il fornaio, ti tuffi', '@v il fornaio, possiedi:', '@w lo scemo, ciao'])
    ).toStrictEqual(['il fornaio']);
  });

  it('leaderboard_count_not_in_title', () => {
    expect(learnTitles(['1. @u il fornaio (12)', '2. @v il fornaio (3)'])).toStrictEqual([
      'il fornaio',
    ]);
  });

  it('longest_first', () => {
    const texts = ['@u il re, x', '@v il re, x', '@u il gran cuoco, x', '@v il gran cuoco, x'];
    expect(learnTitles(texts)).toStrictEqual(['il gran cuoco', 'il re']);
  });

  it('stripped_with_and_without_comma_and_as_recipient', () => {
    expect(titleStripper(['il cartografo'])('@u il cartografo, possiedi:')).toBe('@u, possiedi:');
    expect(
      titleStripper(['il cartografo'])(
        '@u il cartografo un secchio di fango [C] al momento non ti serve in nessuna ricetta.'
      )
    ).toBe('@u un secchio di fango [C] al momento non ti serve in nessuna ricetta.');
    const strip = titleStripper(['il fornaio']);
    expect(strip('@d, dai 1x un bottone a @u il fornaio')).toBe('@d, dai 1x un bottone a @u');
    expect(strip('@u il fornaio (12)\n@v')).toBe('@u\n@v');
  });

  it('no_titles_identity', () => {
    expect(titleStripper([])('@u il cartografo, x')).toBe('@u il cartografo, x');
  });
});

describe('admin', () => {
  it('sua_maesta_removed_only_before_the_admin', () => {
    expect(stripSuaMaesta('Sua Maestà @msx80, possiedi:')).toBe('@msx80, possiedi:');
    expect(stripSuaMaesta('Avventuriero Sua Maestà @msx80\n- Livello: 9')).toBe(
      'Avventuriero @msx80\n- Livello: 9'
    );
    expect(stripSuaMaesta('Lunga vita a Sua Maestà @msx80')).toBe('Lunga vita a Sua Maestà @msx80');
  });
});

describe('normalizer', () => {
  it('titles_then_admin', () => {
    expect(replyNormalizer(['il fornaio'])('Sua Maestà @msx80 il fornaio, possiedi:')).toBe(
      '@msx80, possiedi:'
    );
    expect(replyNormalizer([])('Sua Maestà @msx80, possiedi:')).toBe('@msx80, possiedi:');
  });
});
