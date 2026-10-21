/** places.ts: place names in their article form. */
import { describe, expect, it } from 'vitest';
import { placeLabel, placeName } from './places.ts';

describe('placeName', () => {
  it('articulated_prepositions_become_their_articles', () => {
    expect(
      [
        'nella valle ventosa 🏞',
        'nel bosco nebbioso di Valtorbo 🌲',
        "nell'immenso deserto di Sabbiora 🏜",
        'nelle cripte del monastero 👻',
        'sul banco corallino 🐠',
        'sulla scogliera bianca 🏖',
        'ai piedi del monte Grevolo ⛰',
        'negli abissi 🐙',
        'al villaggio 🏡',
      ].map(placeName)
    ).toStrictEqual([
      'la valle ventosa 🏞',
      'il bosco nebbioso di Valtorbo 🌲',
      "l'immenso deserto di Sabbiora 🏜",
      'le cripte del monastero 👻',
      'il banco corallino 🐠',
      'la scogliera bianca 🏖',
      'i piedi del monte Grevolo ⛰',
      'gli abissi 🐙',
      'il villaggio 🏡',
    ]);
  });

  it('other_names_stay', () => {
    for (const n of ['in cima al monte Grevolo 🏔', 'la valle ventosa 🏞', 'nebbia 🌫', 'nell 🌫'])
      expect(placeName(n), n).toBe(n);
  });

  it('a_capital_preposition_gives_a_capital_article_and_any_whitespace_counts', () => {
    expect(placeName('Nella valle ventosa 🏞')).toBe('La valle ventosa 🏞');
    expect(placeName('nell’immenso deserto di Sabbiora 🏜')).toBe("l'immenso deserto di Sabbiora 🏜");
  });

  it('the_preposition_is_a_whole_word', () => {
    expect(
      [
        'nellapianura',
        'sulfureo lago',
        'alato drago 🐉',
        'nello stagno',
        'sugli scogli',
        'sui monti',
        'agli orti',
        'alle dune',
        'allo stagno',
        "all'isola",
      ].map(placeName)
    ).toStrictEqual([
      'nellapianura',
      'sulfureo lago',
      'alato drago 🐉',
      'lo stagno',
      'gli scogli',
      'i monti',
      'gli orti',
      'le dune',
      'lo stagno',
      "l'isola",
    ]);
  });

  it('labels_are_capitalised', () => {
    expect(placeLabel('nella valle ventosa 🏞')).toBe('La valle ventosa 🏞');
    expect(placeLabel('in cima al monte Grevolo 🏔')).toBe('In cima al monte Grevolo 🏔');
  });
});
