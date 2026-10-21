# InventoryBot's encyclopedia channels

Documented as of 2026-10-21.

The bot's `/gruppi` lists three Telegram channels that describe the game as an encyclopedia, one
card per post: _La Cittadella dei Demiurghi_ (recipes), _Il Grimorio del Golem_ (items) and
_L'Atlante di Barbabeige_ (places). Their curators write the cards by hand, in a fixed layout typed
with small variations. Most cards date from 2017, and the game changed after them: a card is an
observation with the date of its post, and whatever the bot showed later prevails.

An export of a channel is an ordinary Telegram Desktop export
([telegram-export.md](telegram-export.md)): the channel is the chat, and every post is a message
whose sender is the channel. Phase 1 keeps the posts in full (`BotIdentity.channels`), and
`src/inventorybot/channels.ts` reads them.

## 1. How cards are typed

Every reader tolerates the variations of a hand-typed card:

- any whitespace (spaces, no-break spaces, several in a row) where a space belongs;
- an item's tags with or without a space between them (`[L2][usabile]`), and its quantity with or
  without one before it (`[N]x1`), or missing (`1`);
- a header with or without its emoji, and with or without a space before the colon;
- an emoji written with or without its variation selector, joiners, gender or skin tone (`✏` and
  `✏️`): a name is matched with the bot's own spelling of it, which is the one kept.

```text
ITEM = NAME [ RARITY ] [ USABLE ] [ "x" INT ]       (* any whitespace, or none, between the parts *)
```

## 2. La Cittadella dei Demiurghi: recipes

```text
CARD   = [ EMOJI ] "RICETTA:" RNAME " [L" INT "]" NL
         "{id: " INT "}" NL
         [ EMOJI ] "INGREDIENTI:" { NL BULLET ITEM }
         [ EMOJI ] "TESTO:" NL TEXT
         [ EMOJI ] "OGGETTO OTTENUTO:" SP ITEM
         [ NL [ EMOJI ] "TITOLO: @username, " TITLE ]
         { NL "⚠️" NOTE }
BULLET = "📌" | "-"
```

- `{id: N}` numbers the cards in the order they were posted; a recipe can have two cards, and the
  later one prevails.
- `TEXT` is the craft text, the one the bot shows when the recipe is made, possibly over several
  lines.
- `TITLE` is the title the recipe's output gives its owner; `@username` stands for any player.
- A `NOTE` is a remark of the curators.

Other posts of the channel (a welcome, short stories) are no cards and are skipped.

```text
📇 RICETTA: Torre alta [L2]
{id: 7}

📚 INGREDIENTI:
📌 una torre [L1] x1
📌 una trave [N] x2

📝 TESTO:
e sovrapponi le travi alla torre,
che si allunga verso il cielo.

📎 OGGETTO OTTENUTO: una torre alta [L2] [usabile]

🎖 TITOLO: @username, il costruttore

⚠️ Torre alta è una ricetta di prova.
```

A card gives the recipe its level (when no recipe list has), its ingredients, its output and craft
text, the title of the output, and the card's notes, each as an observation of the post's date. The
wiki keeps, per recipe, which card stands behind it and which of these the card still sets.

## 3. Unknowns

- Whether a recipe with two cards was changed by the game, or its first card was wrong.
