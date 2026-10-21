/** channels.ts: the cards of InventoryBot's encyclopedia channels. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Message } from '#src/telegram/messages.ts';
import { CRIPTE_CARD, TORRE_CARD } from '#test/channels.ts';
import { ATLANTE, CITTADELLA, GRIMORIO } from './bot.ts';
import {
  cardItem,
  isChannelPost,
  readChannelPosts,
  readPlaceCard,
  readRecipeCard,
} from './channels.ts';

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

describe('readPlaceCard', () => {
  it('reads_every_part_of_a_card_with_places_in_their_article_form', () => {
    expect(readPlaceCard(CRIPTE_CARD)).toStrictEqual({
      place: 'le cripte del monastero 👻',
      items: [
        { name: "una ghianda d'oro", rarity: 'C+', usable: false, qty: 1 },
        { name: 'un paio di mollette', rarity: 'R+', usable: true, qty: 1 },
      ],
      route: [
        'il villaggio di Borgoverde 🏡',
        'il bosco nebbioso di Valtorbo 🌲',
        'le cripte del monastero 👻',
      ],
      route_note: null,
      access: { name: 'una lanterna cieca', rarity: 'N', usable: false, qty: 1 },
      sight: { name: 'un rampino di ferro', rarity: 'R', usable: false, qty: 1 },
      secret: true,
      notes: [
        'una lanterna cieca: trovabile nella valle ventosa 🏞',
        "Questo è un luogo segreto! Non è visibile nel pannello di viaggio se non si possiede l'oggetto per raggiungerlo!",
      ],
    });
  });

  it('a_place_without_items_or_route', () => {
    const c = readPlaceCard(
      [
        '🗺 LUOGO: nella valle ventosa 🏞',
        '📎 OGGETTI TROVABILI:',
        '‼️ [nessun oggetto inserito]‼️',
        '📫 COME ARRIVARCI:',
        "🚩🏁 Utilizzando l'oggetto richiesto per l'accesso da un luogo qualsiasi.",
      ].join('\n')
    );
    expect(c).toMatchObject({
      place: 'la valle ventosa 🏞',
      items: [],
      route: [],
      route_note: "Utilizzando l'oggetto richiesto per l'accesso da un luogo qualsiasi.",
      access: null,
      secret: false,
    });
  });

  it('other_posts_are_no_card', () => {
    expect(readPlaceCard('🗺 La Mappa Completa 🗺')).toBeNull();
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

  it('cards_of_the_atlante_too', () => {
    expect(readChannelPosts([post(ATLANTE, CRIPTE_CARD)])[0]).toMatchObject({
      type: 'place_card',
      place: 'le cripte del monastero 👻',
    });
    expect(readChannelPosts([post(GRIMORIO, CRIPTE_CARD)])).toStrictEqual([]);
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
    const examples = (start: string): string[] =>
      [...doc.matchAll(new RegExp(`\`\`\`text\n(${start}[\\s\\S]*?)\`\`\``, 'gu'))].map(
        (m) => m[1] as string
      );
    expect(examples('📇').length + examples('🗺').length).toBe(2);
    for (const e of examples('📇')) expect(readRecipeCard(e), e).not.toBeNull();
    for (const e of examples('🗺')) expect(readPlaceCard(e), e).not.toBeNull();
  });
});
