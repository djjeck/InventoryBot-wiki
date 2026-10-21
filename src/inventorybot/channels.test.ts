/** channels.ts: the cards of InventoryBot's encyclopedia channels. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Message } from '#src/telegram/messages.ts';
import { TORRE_CARD } from '#test/channels.ts';
import { CITTADELLA, GRIMORIO } from './bot.ts';
import { cardItem, isChannelPost, readChannelPosts, readRecipeCard } from './channels.ts';

describe('readRecipeCard', () => {
  it('reads_every_part_of_a_card', () => {
    expect(readRecipeCard(TORRE_CARD)).toStrictEqual({
      recipe: 'Torre alta',
      level: 2,
      ingredients: [
        { name: 'una torre', rarity: 'L1', usable: false, qty: 1 },
        { name: 'una trave', rarity: 'N', usable: false, qty: 2 },
      ],
      text: 'e sovrapponi le travi alla torre,\nche si allunga verso il cielo.',
      output: { name: 'una torre alta', rarity: 'L2', usable: true, qty: 1 },
      title: 'il costruttore',
      notes: ['Torre alta è una ricetta di prova.'],
    });
  });

  it('tolerates_how_a_card_is_typed', () => {
    const card = readRecipeCard(
      [
        'RICETTA: Torre  [L1]',
        '📚INGREDIENTI :',
        '📌un sasso [C]x3',
        '-  una trave [N]',
        '📝 TESTO: e impili tutto.',
        '📎 OGGETTO  OTTENUTO: una torre [L1][usabile]',
      ].join('\n')
    );
    expect(card).toMatchObject({
      recipe: 'Torre',
      level: 1,
      ingredients: [
        { name: 'un sasso', rarity: 'C', usable: false, qty: 3 },
        { name: 'una trave', rarity: 'N', usable: false, qty: 1 },
      ],
      text: 'e impili tutto.',
      output: { name: 'una torre', rarity: 'L1', usable: true, qty: 1 },
      title: null,
      notes: [],
    });
  });

  it('other_posts_are_no_card', () => {
    expect(readRecipeCard('‼️ Benvenuto nella Cittadella! ‼️')).toBeNull();
    expect(readRecipeCard('📇 RICETTA: senza livello')).toBeNull();
  });

  it('card_items_without_tags', () => {
    expect(cardItem('una trave')).toStrictEqual({
      name: 'una trave',
      rarity: null,
      usable: false,
      qty: 1,
    });
    expect(cardItem('   ')).toBeNull();
  });
});

describe('readChannelPosts', () => {
  const post = (chat: string, text: string, id = 1): Message => ({
    chat,
    dm: false,
    id,
    date: '01.10.2017 10:00:00 UTC+02:00',
    from_bot: false,
    sender: chat,
    forwarded_from: null,
    reply_to: null,
    text,
  });

  it('cards_of_the_cittadella_become_events_with_a_reply_s_context', () => {
    const events = readChannelPosts([post(CITTADELLA, TORRE_CARD, 5), post(CITTADELLA, 'ciao', 6)]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'recipe_card',
      recipe: 'Torre alta',
      chat: CITTADELLA,
      dm: false,
      msg: 5,
      date: '01.10.2017 10:00:00 UTC+02:00',
      player: null,
      query: null,
      match: null,
    });
  });

  it('only_the_channels_posts_are_channel_posts', () => {
    expect(isChannelPost(post(GRIMORIO, 'x'))).toBe(true);
    expect(isChannelPost(post('Gruppo', 'x'))).toBe(false);
    expect(isChannelPost({ ...post(CITTADELLA, 'x'), from_bot: true })).toBe(false);
  });
});

describe('docs/channels.md', () => {
  it('its_card_examples_are_cards', () => {
    const doc = fs.readFileSync(path.join(import.meta.dirname, '../../docs/channels.md'), 'utf-8');
    const examples = [...doc.matchAll(/```text\n(📇[\s\S]*?)```/gu)].map((m) => m[1] as string);
    expect(examples.length).toBeGreaterThan(0);
    for (const e of examples) expect(readRecipeCard(e), e).not.toBeNull();
  });
});
