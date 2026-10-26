# InventoryBot's encyclopedia channels

Documented as of 2026-10-21. Since 2026-10-26 the channels do not allow exporting their history:
only exports made before then can be read.

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
- `RNAME` is not always the bot's name of the recipe: some cards name it otherwise, beyond spelling.
  Such a card describes the recipe of the bot with exactly its ingredients and quantities, when only
  one has them.

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

## 3. L'Atlante di Barbabeige: places

```text
CARD   = [ EMOJI ] "LUOGO:" SP LOCATION NL
         [ EMOJI ] "{id: " INT "}" NL
         [ EMOJI ] "OGGETTI TROVABILI:" { NL BOOK ITEM }
         [ EMOJI ] "COME ARRIVARCI:" ( { NL STAGE LOCATION } | NL "🚩🏁" SP REMARK )
         [ NL [ EMOJI ] "OGGETTO RICHIESTO PER L'ACCESSO:" NL "📚" SP ITEM [ SP REMARK ] ]
         [ NL [ EMOJI ] "OGGETTO RICHIESTO PER VISUALIZZARE:" NL "📚" SP ITEM [ SP REMARK ] ]
         [ NL "📝" SP ARRIVAL ]
         { NL ( "🔎" | "⚠️" | "📯" ) SP REMARK }
BOOK   = "📒" | "📗" | "📘" | "📕" | "📙"        (* the colour of the rarity: C+, N+, R+, S+, M+ *)
STAGE  = "🚩" | "🏃" | "🏃‍♂️" | "🏁"             (* the start, a stage, the place itself *)
```

- `LOCATION` is written with the article ("la Valle degli Eroi") or the preposition ("nella valle
  ventosa") of the bot's replies; the pipeline reads both in their article form.
- The items found are the place's exclusive ones, `+` rarities; `[nessun oggetto inserito]` stands
  for none.
- The route goes from the village to the place. Instead of a route, `🚩🏁` introduces a remark: the
  place is reached by using its item from anywhere, or not at all.
- The item for the access is the one the place requires; the item to view it, the one without which
  the place is not listed in the travel panel. A `REMARK` after an item says where it is found.
- `ARRIVAL` is the bot's arrival text, after `@username, `.
- The `🔎` remark "Questo è un luogo segreto!" marks a place that the travel panel lists only to a
  player who owns its items.

Other posts of the channel (a welcome, the map of every place) are no cards and are skipped. The map
opens with the legend of the books, the one place that names the `M` rarity:

```text
📒 [C+] = [Comune Plus]
📗 [N+] = [Non Comune Plus]
📘 [R+] = [Raro Plus]
📕 [S+] = [Super Raro Plus]
📙 [M+] = [Mega Raro Plus]
```

```text
🗺 LUOGO: nelle cripte del monastero 👻
📌 {id: 3}

📎 OGGETTI TROVABILI:
📒 una ghianda d'oro [C+]
📘 un paio di mollette [R+] [usabile]

📫 COME ARRIVARCI:
🚩 nel villaggio di Borgoverde 🏡
🏃‍♂️ nel bosco nebbioso di Valtorbo 🌲
🏁 nelle cripte del monastero 👻

🗝 OGGETTO RICHIESTO PER L'ACCESSO:
📚 una lanterna cieca [N] trovabile nella valle ventosa 🏞

👁‍🗨 OGGETTO RICHIESTO PER VISUALIZZARE:
📚 un rampino di ferro [R]

📝 @username, accendi la lanterna e scendi nelle cripte del monastero 👻

🔎 Questo è un luogo segreto! Non è visibile nel pannello di viaggio se non si possiede l'oggetto per raggiungerlo!
```

A card adds to the place its exclusive items, its route (as exits), the items to enter and to view
it, and whether it is secret. None of these has a date in the wiki: a card adds to what the bot
showed, and the wiki keeps, per place, which card stands behind it and what it added.

## 4. Il Grimorio del Golem: items

```text
CARD   = [ EMOJI ] "OGGETTO:" NL
         [ EMOJI ] ITEM [ SP "/" SP RARITY ] NL
         "{id: " INT "}" NL
         [ EMOJI ] "COME OTTENERLO:" { NL [ "🔹" ] LINE }
         [ EMOJI ] ( "UTILIZZO:" | "FUNZIONE:" ) { NL [ MARK ] LINE }
         [ NL "🔍" SP EFFECT ]
MARK   = "🔸" | "▶️" | "📝" | "⚠️" | "➡️"
```

- How the item is obtained and what it is for are free text: places, chests and events where it
  drops, the recipes it makes, the places it opens, the message a use gives (after `📝`), the
  command (after `▶️`) and remarks (after `⚠️`).
- Some cards name two rarities (`[X] / [C]`) for items whose rarity changed; such a card sets none.
- `EFFECT` says what a use does to the item, in a few fixed phrases: it is consumed ("si consuma e
  scompare dall'inventario"), or it stays ("rimane in inventario"), and its cooldown ("ha un tempo
  di raffreddamento di 24h", "non ha tempo di raffreddamento").

```text
📣 OGGETTO:
🗝 un baule di ebano 📦 [S] [usabile]
{id: 12}

📚 COME OTTENERLO:
🔹 avventurandosi

📌 UTILIZZO:
🔸 si ottiene il seguente messaggio:

📝 @username, infili una chiave di ebano 🔑 nella serratura di un baule di ebano 📦..

⚠️ serve la chiave giusta.

🔍 L'oggetto, una volta utilizzato, ha un tempo di raffreddamento di 24h e rimane in inventario.
```

A card gives the item its rarity and `[usabile]` as an observation of the post's date, and the wiki
keeps its texts as written, with whether a use consumes the item and its cooldown in seconds.

The channel also posts events of the game's history and guides (`📣 EVENTO: TITLE`, `📣 GUIDA …`),
free text that the wiki keeps as trivia.

## 5. Unknowns

- Whether a recipe with two cards was changed by the game, or its first card was wrong.
- Which of two rarities (`[X] / [C]`) an item has now.
