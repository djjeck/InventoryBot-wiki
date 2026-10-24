# InventoryBot protocol

Documented as of 2026-10-18. If the bot changes, update this document.

[@InventoryBot](https://t.me/InventoryBot) is an Italian-language Telegram game: players go on
adventures that yield items, combine items through recipes, travel between places and trade with
each other, all by sending commands to the bot in a private chat or in a group. This document
explains the game to someone who has never played it: its concepts, the commands, and the grammar
and meaning of every kind of reply, including the formats of older group history. How Telegram
Desktop exports these messages is in [`telegram-export.md`](telegram-export.md).

## Contents

1. [Notation](#1-notation)
2. [Game concepts](#2-game-concepts)
3. [Commands](#3-commands)
4. [Addressing](#4-addressing)
5. [Groups](#5-groups)
6. [Replies](#6-replies)
7. [Older formats](#7-older-formats)
8. [Example blocks](#8-example-blocks)
9. [Unknowns](#9-unknowns)

## 1. Notation

Grammars use a compact EBNF and describe a whole message text, with line breaks as `NL`:

| Notation                            | Meaning                                                  |
| ----------------------------------- | -------------------------------------------------------- |
| `"text"`                            | literal text (Italian apostrophes are ASCII `'`)         |
| `A B`                               | A followed by B, nothing in between                      |
| `[ A ]`, `{ A }`, `A \| B`, `( A )` | optional, zero or more, alternative, grouping            |
| `SP`, `NL`, `INT`                   | one space, one line break, decimal digits                |
| `LINE`                              | any characters except a line break, as few as possible   |
| `ANY`                               | any characters, line breaks included, as few as possible |
| `EOT`                               | end of the message                                       |

Rules shared by several replies:

```text
USERNAME  = 1*( letter | digit | "_" )                (* Telegram @username without "@" *)
TITLE     = article SP word [ SP word [ SP word ] ]    (* section 2.8 *)
article   = "il" | "lo" | "la" | "l'" | "i" | "gli" | "le"
PLAYER    = [ "Sua Maestà" SP ] "@" USERNAME [ SP TITLE ]
ADDR      = PLAYER ( "," SP | SP )                      (* section 4 *)
CODE      = capital-letter { digit } [ "+" ]            (* C, N+, L3, L11, M+ *)
RARITY    = "[" CODE "]"
USABLE    = "[usabile]"
NAME      = LINE                                        (* item name, article included *)
ITEM_LINE = { SP } "-" [ SP ] NAME [ SP RARITY ] [ SP USABLE ] [ SP "x" INT ] { SP }
LOCATION  = LINE                                        (* preposition + place + emoji *)
DURATION  = INT " giorni e " INT " ore" | INT " ore e " INT " minuti"
          | INT " minuti e " INT " secondi" | INT SP ( "giorni" | "ore" | "minuti" | "secondi" )
```

- An **item name** includes its article or quantifier ("un sasso", "l'orologio di un'antica torre",
  "tre metri di spago colorato") and may contain digits, emoji, quotes, commas and `x` ("un tagliere
  30x40 di faggio"). Player-made items can contain line breaks. The bot writes some names with a
  no-break space or a doubled space; the pipeline keeps every name with single spaces.
- In an `ITEM_LINE`, a missing quantity means 1. Some lists omit the space after `-`
  (`-una moneta d'oro [X] x41`) or the rarity. An inventory may hold a line with `- ` alone, which
  names no item.
- A **location** includes its preposition and emoji ("nella valle ventosa 🏞", "sul banco corallino
  🐠") and is always written the same way.

## 2. Game concepts

### 2.1 Adventures

`/avventura` gives one random item, wrapped in a random sentence. The sentence does not depend on
where the player is. A player can adventure once every 15 minutes; earlier attempts get a cooldown
reply. Very rarely an adventure is "l'avventura FORTUNATA del giorno" (the lucky adventure of the
day) and is followed by a second message with an extra item.

### 2.2 Items and rarity

Every item carries a rarity code:

| Code         | Meaning (from `/faq`)   |
| ------------ | ----------------------- |
| `C`          | comune                  |
| `N`          | non comune              |
| `R`          | raro                    |
| `S`          | super raro              |
| `U`          | unico: only one exists  |
| `L1` … `L11` | ottenibile da ricette   |
| `X`          | oggetti speciali        |
| `M`          | not explained by `/faq` |

- A `+` after the code (`C+`, `N+`, `R+`, `S+`, `M+`) marks an item that drops in only one place.
  All other adventure items drop everywhere.
- A level-`k` recipe usually produces an `Lk` item, but some recipes produce items of other rarities
  (`C`, `X`).
- `[usabile]` after the rarity marks a usable item (2.6).

### 2.3 Recipes

A recipe has a name, a level from 1 to 11, ingredients with quantities, and one output. A player
sees a recipe only when they own at least half of its required items; it is marked with `*` when
they own all of them. `/ricetta <name>` makes a recipe the player can complete, consuming the
ingredients and giving one output item. Otherwise it shows what is missing. The output is revealed
only by making the recipe.

### 2.4 Levels

Players start at level 0. To reach level `n+1` a player makes a recipe of level `n+1`. The level-up
rewards `10 × level` gold coins ("una moneta d'oro") and a gift box ("un bel pacchettino regalo
🎁"). The maximum level is 11.

### 2.5 Places and travel

The world is a graph of places. `/viaggio` shows where the player is and the adjacent places;
`/viaggio <place>` moves there. Some places require an item. They are listed among the exits like
any other place; without the item the move is refused with "Forse ti manca qualcosa!", which does
not name the item. The bot gives no notice when such a route becomes available: the player has to
try again. The required item is named in the arrival text once the move succeeds (for example
"mastichi una foglia di Respirella dalla tua scorta…" for the coral bank), and in a notice that
names the item and the place (6.9). Travelling does not consume the item. Adventures happen where
the player is, which matters only for `+` items.

### 2.6 Usable items

Each usable item has its own replies to `/usa`: fixed, random (for example a die), item-giving, or
failures that say what is missing (a key, a complete set of something). Usable items have a
cooldown, shown by `/esamina` and enforced by `/usa`. Some are consumed by use and some are not; the
reply does not say which.

### 2.7 Transfers and showing

`/dai` gives items to another player, in a group or in private; with `/notificheon` the receiver
gets a private notice. `/mostra <item>` shows the chat how many of an item the player owns.

### 2.8 Titles and favourite item

Some items give a title ("il fornaio", "il cartografo", "l'incappellato", "il Lucente", "il
Cartomante", "il capitano"). The bot prints it after the username wherever it names that player.
`/preferito <item>` sets the favourite item shown by `/stats` (6.17).

## 3. Commands

The bot's own list (`/faqcomandi`):

| Command                         | Arguments               | Effect                                                      | Reply      |
| ------------------------------- | ----------------------- | ----------------------------------------------------------- | ---------- |
| `/inventario`                   | `[filter]`              | items owned                                                 | 6.8        |
| `/avventura`                    |                         | one adventure                                               | 6.1-6.3    |
| `/ricetta`                      |                         | visible recipes                                             | 6.4        |
| `/ricetta`                      | `recipe`                | make it, or show what is missing                            | 6.5, 6.6   |
| `/mostra`                       | `item`                  | show an owned item                                          | 6.12       |
| `/dai`                          | `user quantity item`    | give items                                                  | 6.11       |
| `/esamina`                      | `item or recipe`        | item information, or recipe requirements                    | 6.7, 6.5   |
| `/usa`                          | `item`                  | activate a usable item                                      | 6.13       |
| `/viaggio`                      | `[place]`               | current place and exits, or move                            | 6.9        |
| `/stats`                        | `[username]`            | leaderboards, or a player's statistics                      | 6.16, 6.14 |
| `/suggerisci`                   | `text`                  | suggest items or recipes                                    |            |
| `/nascondi`                     | `recipe` \| `*` \| none | hide or show a recipe, all recipes, or list the hidden ones | 6.17       |
| `/notificheon`, `/notificheoff` |                         | turn gift notices on or off                                 | 6.10       |

Other commands: `/start` and `/registrami` (registration, private chat only), `/faq` (help, rarity
legend, level rule), `/faqcomandi` (the list above), `/gruppi` (unofficial groups), `/titolo`
(title-giving items owned), `/preferito <item>` (set the favourite item, 6.17), `/quest` (the
current quest, 6.17), `/biglietto` (lottery ticket while a lottery is open).

Arguments:

- `/dai` is written `/dai @user [quantity] item` (`/dai @lucia_b 10 moneta`); the `@` is optional
  and the default quantity is 1.
- `/usa` takes the item's argument after `#`, the item before it: the teleport capsule its
  destination (`/usa capsula # molo`), a Pakkomon the player to fight (`/usa <pakkomon> # @user`) or
  an item to equip it with, an idea the rarity and name of the item it is to become
  (`/usa idea # N <name>`).
- In groups a command may be written `/cmd@InventoryBot args`.

**Name lookup.** Item, recipe and place arguments are matched by words: a name matches when every
word of the argument occurs in it, also inside another word, ignoring case. "otto" finds "un
bottone"; "Oro" finds "una moneta d'oro" and "una statuetta di Torosco"; "usa getta" finds "un
cucchiaino di plastica usa e getta". There is no stemming ("elenchi" does not find "un elenco"), and
bracketed tags are not part of names (`[C]`, `usabile` match nothing). `/esamina` searches only the
player's items and visible recipes. Several matches give an ambiguity reply; none gives a not-found
reply:

| Command           | Ambiguous                                     | Not found                                      |
| ----------------- | --------------------------------------------- | ---------------------------------------------- |
| `/esamina`        | `@u, conosci diversi oggetti con quel nome`   | `@u, non hai oggetti o ricette con quel nome`  |
| `/ricetta`        | `troppe ricette trovate con quel nome`        | `@u, non hai ricette con quel nome.`           |
| `/mostra`, `/dai` | `troppi oggetti trovati con quel nome(<arg>)` | `@u, non hai niente del genere`                |
| `/usa`            | `troppi oggetti trovati con quel nome(<arg>)` | `@u, non hai niente del genere di usabile.`    |
| `/viaggio`        | `troppi luoghi trovati con quel nome(<arg>)`  | `@u, non vedi nessun luogo con quel nome, qui` |

`/esamina` also gives `troppe ricette trovate con quel nome`, when the argument matches several
recipes. The ambiguity replies are not addressed and repeat the argument as written, also when it is
empty (`troppi oggetti trovati con quel nome()`).

## 4. Addressing

Most replies begin by naming the player they concern:

| Form                             | Used by                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `@user, `                        | almost every reply                                                                                           |
| `@user ` (no comma)              | item info (6.7), blocked travel                                                                              |
| `Complimenti @user, `            | lucky adventure                                                                                              |
| `Avventuriero @user`             | `/stats`                                                                                                     |
| `ciao @user, `                   | "register first" notice                                                                                      |
| `@user TITLE, ` / `@user TITLE ` | the same replies, for a player with a title                                                                  |
| `… a @user TITLE`                | the receiver in a `/dai` reply                                                                               |
| `@user TITLE (n)`                | leaderboard entries                                                                                          |
| `Sua Maestà @msx80`              | the game's admin, in every position (`Avventuriero Sua Maestà @msx80`, `[N] Sua Maestà @msx80 ti ha dato …`) |
| `[.. una presenza indistinta..]` | in place of `@user` for a player without a visible username                                                  |
| none                             | cooldown, ambiguity replies, gift notices, `/faq`, errors                                                    |

## 5. Groups

The bot plays in groups too, and there:

- replies are plain messages, never Telegram replies to the command;
- ordinary chat and other players' commands and replies can come between a command and its reply,
  which usually follows within seconds;
- the reply names the player's `@username`, while Telegram shows the sender of the command by
  display name;
- messages beginning with `[W] `, `[N] ` or `[BAN] ` do not answer a command in that group.
  `[W] @user, <adventure>` reports another player's adventure, `[N]` is a notice (gifts, pakkomon
  fights, pets) and `[BAN]` a ban. In private, `[N]` is the gift notice.

## 6. Replies

Each section gives the command, the grammar, the meaning and examples (the example format is in
section 8).

### 6.1 Adventure drop

`/avventura`. One line, unless the item is a player-made one whose name spans lines; the narrative
ends with the article and name of the item, with no delimiter.

```text
DROP = ADDR NARRATIVE SP RARITY [ SP USABLE ] [ "!" ] EOT
```

```bot-reply type=drop query="/avventura" kind=adventure rarity=C usable=false raw="ti tuffi nel lago incantato di Mirtovalle, semisommerso nel fondale scorgi un torroncino al pistacchio" addressee=mario_r
@mario_r, ti tuffi nel lago incantato di Mirtovalle, semisommerso nel fondale scorgi un torroncino al pistacchio [C]!
```

```bot-reply type=drop query="/avventura" rarity=R usable=true
@mario_r, al bazar della citta' inizi a mercanteggiare con un venditore, alla fine ottieni un baule di quercia 📦 [R] [usabile]!
```

Another player's adventure reported in a group:

```bot-reply type=drop chat=group addressee=lucia_b rarity=S usable=true
[W] @lucia_b, ti avventuri nell'intricata giungla di Ramafitta, nascondendoti dagli animali feroci che la popolano, quand'ecco che una scimmia ti tira un baule di ebano 📦 [S] [usabile]!
```

### 6.2 Lucky adventure

A second message right after a drop, very rare. The extra item is named explicitly.

```text
LUCKY = "Complimenti" SP PLAYER ", questa e' l'avventura FORTUNATA del giorno! Hai vinto:" SP NAME SP RARITY [ "!" ] EOT
```

```bot-reply type=drop query="/avventura" kind=lucky item="una Sfera del Grillo da 1 stella ⭐️" rarity=X addressee=mario_r
Complimenti @mario_r, questa e' l'avventura FORTUNATA del giorno! Hai vinto: una Sfera del Grillo da 1 stella ⭐️ [X]
```

### 6.3 Adventure cooldown

`/avventura` less than 15 minutes after the previous one. Not addressed.

```text
COOLDOWN = "Troppo presto, devi riposare ancora per" SP WAIT SP "prima di poterti avventurare di nuovo. Nelle /faq puoi trovare gruppi per scambiare oggetti e giocare con altri utenti! :P" EOT
WAIT     = INT " minuti e " INT " secondi" | INT " secondi" | INT " minuti"
```

```bot-reply type=cooldown query="/avventura" addressee=null
Troppo presto, devi riposare ancora per 9 minuti e 29 secondi prima di poterti avventurare di nuovo. Nelle /faq puoi trovare gruppi per scambiare oggetti e giocare con altri utenti! :P
```

### 6.4 Recipe list

`/ricetta` without arguments.

```text
RECIPE_LIST = ADDR "ecco le ricette a tua disposizione:" { NL RECIPE } NL END EOT
RECIPE      = "- " RNAME " L" INT SP "[" ( "*" | "manca" SP INT ) "]"
END         = "Scrivi /ricetta <nome ricetta> per vedere quali oggetti ti mancano per una certa ricetta!"
            | LINE " TRONCATO!"
```

- `L INT` is the level; `[*]` means every ingredient is owned; `[manca K]` means `K` units are
  missing in total.
- Ready recipes come first, then the others by `manca`, ascending.
- A list longer than Telegram's 4096-character limit is cut mid-line and ends with ` TRONCATO!`; the
  recipes after the cut are not shown. `/ricetta` takes no filter (not even by level), so no other
  command lists the recipes after the cut; `/ricetta <name>` and `/esamina <name>` still answer for
  a recipe whose name is known.
- With no visible recipe:
  `@u, non hai ricette al momento. Cerca altri oggetti per poterli combinare insieme!`

```bot-reply type=recipe_list query="/ricetta" truncated=false recipes.0.name="Orto in vaso" recipes.0.level=1 recipes.0.ready=true recipes.2.name="L'ombra dell'albero" recipes.2.level=11 recipes.2.missing=2
@mario_r, ecco le ricette a tua disposizione:
- Orto in vaso L1 [*]
- Corso di vela L5 [manca 1]
- L'ombra dell'albero L11 [manca 2]
- Chiodi storti L1 [manca 39]
Scrivi /ricetta <nome ricetta> per vedere quali oggetti ti mancano per una certa ricetta!
```

```bot-reply type=recipe_list query="/ricetta" recipes='[{"name":"Merenda veloce","level":1,"ready":true,"missing":0},{"name":"Pizza della nonna","level":1,"ready":false,"missing":1}]' truncated=true
@mario_r, ecco le ricette a tua disposizione:
- Merenda veloce L1 [*]
- Pizza della nonna L1 [manca 1]
- Gara di cucina L3 [manca TRONCATO!
```

### 6.5 Recipe detail

`/ricetta <name>` when something is missing ("per fare X"); `/esamina <name>` of a recipe, always
("per fare la ricetta X").

```text
DETAIL = ADDR "per fare" SP [ "la ricetta" SP ] RNAME " ti manca:" { NL ITEM_LINE }
         [ NL "Mentre hai gia':" { NL ITEM_LINE } ] EOT
```

- "ti manca" lists each ingredient the player lacks, with how many more are needed
  (`needed − owned`). It can be empty.
- "Mentre hai gia'" lists each ingredient the player owns at least one of, with
  `min(owned, needed)`: the count stops at what the recipe needs.
- A partly owned ingredient is in both lists, so the recipe needs, for each ingredient, the sum of
  its two quantities.

```bot-reply type=recipe_detail query="/ricetta pennello" recipe="Pennello rustico" missing.0.name="un ciuffo di morbide setole di tasso" missing.0.qty=1 have.0.name="lo stecco di legno di un ghiacciolo"
@mario_r, per fare Pennello rustico ti manca:
- un ciuffo di morbide setole di tasso [R] x1
Mentre hai gia':
- lo stecco di legno di un ghiacciolo [C] x1
```

The recipe below needs 2 "corda di canapa"; the player has 1:

```bot-reply type=recipe_detail query="/esamina ancora nel fan" recipe="L'ancora nel fango" missing.0.qty=1 have.1.name="una corda di canapa" have.1.qty=1
@mario_r, per fare la ricetta L'ancora nel fango ti manca:
- una corda di canapa [R] x1
- un secchio di fango [L1] x1
Mentre hai gia':
- un rampino di ferro [L1] x1
- una corda di canapa [R] x1
```

### 6.6 Craft

`/ricetta <name>` when the player has every ingredient. The reply does not name the recipe.

```text
CRAFT  = ADDR "prendi in mano:" { NL ITEM_LINE } NL FLAVOR NL "Ottieni:" SP NAME [ "!" ] [ NL NL SUFFIX ] EOT
FLAVOR = ANY                    (* the recipe's fixed text, starting with "e " *)
SUFFIX = "Hai raggiunto il livello " INT "! Per te " INT "x una moneta d'oro e un bel pacchettino regalo 🎁 in omaggio!"
       | "Sei il primo al mondo a fare questa ricetta! Complimenti!"
```

- The item lines are the recipe's ingredients, all consumed. The output (one unit) is given without
  rarity.
- The first suffix is a level-up (2.4); the second marks the first time anyone made the recipe.

```bot-reply type=craft query="/ricetta caffe rist" output="un caffè ristretto" ingredients.0.name="un chicco di caffè" ingredients.0.qty=2
@mario_r, prendi in mano:
- un chicco di caffè [R] x2
- una tazzina vuota [R] x1
e macini i chicchi con pazienza, li versi nella moka e aspetti il borbottio che annuncia il momento piu' bello della mattina!
Ottieni: un caffè ristretto!
```

```bot-reply type=craft query="/ricetta piselli" output="una manciata di linguette di latta" level_up=1
@mario_r, prendi in mano:
- un apriscatole storto [C] x1
- una latta di piselli [C] x1
e hai trovato una latta di piselli in offerta al mercato e non vedi l’ora di assaggiarli! Appena arrivi a casa prendi il tuo apriscatole, apri la latta e te li mangi in un attimo!
Ottieni: una manciata di linguette di latta!

Hai raggiunto il livello 1! Per te 10x una moneta d'oro e un bel pacchettino regalo 🎁 in omaggio!
```

### 6.7 Item info

`/esamina <item>`. No comma after the username.

```text
INFO     = PLAYER SP NAME SP RARITY [ SP USABLE ] " al momento " USED_IN [ NL COUNT NL SOURCE ] [ NL COOLDOWN ] EOT
USED_IN  = "ti serve nelle ricette: " RNAME { ", " RNAME } "." | "non ti serve in nessuna ricetta."
COUNT    = "Ne hai " INT "." | "Non ne hai neanche uno."
SOURCE   = "E' un oggetto trovabile in avventura."
         | "E' un oggetto speciale."
         | "E' un oggetto che si ottiene con la ricetta " '"' RNAME '"' "."
         | "E' un oggetto che si ottiene con una ricetta, ma non sai quale.."
COOLDOWN = "Raffreddamento: " ( "pronto all'uso." | DURATION )
```

- `USED_IN` lists the recipes using the item that the player can currently see. Recipe names may
  themselves contain ", ".
- `COUNT` is the exact number owned; an item can be examined without owning it.
- The recipe source is named once the player has made that recipe.
- `COOLDOWN` is present only for usable items: `DURATION` is the time left before the item can be
  used again, truncated to the units shown.

```bot-reply type=item_info query="/esamina candela consum" item="una candela mezza consumata" rarity=C used_in_raw="Cera riciclata" count=3 source=adventure addressee=mario_r
@mario_r una candela mezza consumata [C] al momento ti serve nelle ricette: Cera riciclata.
Ne hai 3.
E' un oggetto trovabile in avventura.
```

```bot-reply type=item_info query="/esamina barattolo" rarity=L1 source=recipe from_recipe="Piccola collezione"
@mario_r un barattolo di vetro con qualche conchiglia dentro [L1] al momento ti serve nelle ricette: Grande collezione.
Ne hai 1.
E' un oggetto che si ottiene con la ricetta "Piccola collezione".
```

```bot-reply type=item_info query="/esamina baule ebano" titles="il cartografo" usable=true cooldown="pronto all'uso." addressee=mario_r
@mario_r il cartografo un baule di ebano 📦 [S] [usabile] al momento non ti serve in nessuna ricetta.
Ne hai 1.
E' un oggetto trovabile in avventura.
Raffreddamento: pronto all'uso.
```

### 6.8 Inventory

`/inventario [filter]`, also written `/i [filter]` or `/inventory [filter]`.

```text
INVENTORY = ADDR "possiedi:" ( { NL ITEM_LINE } [ NL "e altre robe che non ci stanno.." ]
                             | NL "un bel niente!" ) EOT
```

- Each line gives the exact number owned.
- A list that would not fit in one message stops at about 4,000 characters and ends with
  `e altre robe che non ci stanno..`; the items left out are not identified.
- `possiedi:` alone means the filter matched nothing; `un bel niente!` means the player owns nothing
  at all.
- Unfiltered and text-filtered lists are grouped by rarity (`X`, then `L` from the highest level,
  `S`, `R`, `N`, `C`); rarity-filtered lists are alphabetical.

Filters:

| Argument                     | Lists                                            |
| ---------------------------- | ------------------------------------------------ |
| none                         | everything                                       |
| `C`, `N`, `R`, `S`, `X`, `U` | that rarity and its `+` variant                  |
| `C+`, `N+`, `R+`, `S+`       | only that `+` rarity                             |
| `L`                          | every `Ln` item                                  |
| `L1`, `L2`, …                | only that level                                  |
| `M`                          | nothing, even when `M` items are owned           |
| anything else                | items whose name contains every word (section 3) |

Rarity arguments are case-insensitive: `c` lists the same items as `C`, `r+` as `R+`, `l` as `L`,
`l1` as `L1`. They never act as text filters.

```bot-reply type=inventory query="/inventario" filtered=false truncated=false items.1.name="un fiorino ƒ" items.1.usable=true items.1.qty=3
@mario_r, possiedi:
- una chiave di quercia 🔑 [X] x2
- un fiorino ƒ [X] [usabile] x3
- un Motocarro anni 70 [L3] x1
- un grembiule da cuoco [R] x1
- un candido fazzoletto [C] x14
```

```bot-reply type=inventory query="/inventario Oro" filtered=true items.1.name="una splendida statuetta di Torosco di quelle con la coda a spirale 🐲"
@mario_r, possiedi:
- una moneta d'oro [X] x35
- una splendida statuetta di Torosco di quelle con la coda a spirale 🐲 [S] x1
```

```bot-reply type=inventory query="/inventario M" items=[]
@mario_r, possiedi:
```

```bot-reply type=inventory query="/inventario" items=[]
@mario_r, possiedi:
un bel niente!
```

### 6.9 Travel

`/viaggio` (where am I), `/viaggio <place>` (move, or refusal).

```text
WHERE   = ADDR "ti trovi: " LOCATION NL EXITS EOT
TRAVEL  = ADDR ( "ti metti in cammino e dopo un lunghissimo viaggio arrivi " LOCATION
               | UNLOCK " arrivi: " LOCATION
               | UNLOCK SP LOCATION ) NL NL EXITS EOT
BLOCKED = PLAYER " non puoi andare: " LOCATION ".. Forse ti manca qualcosa!" EOT
EXITS   = "Puoi andare verso:" { NL " - " LOCATION }
UNLOCK  = LINE                    (* arrival text of a place that needs an item *)
NEEDED  = NAME " ti serve per passare " LOCATION " sulla via per tornare al villaggio." EOT
```

`EXITS` are the places adjacent to `LOCATION`, including those that need an item: all of them, at
the time of the reply, except a secret place, which is listed only to a player who holds its item
(`docs/channels.md`). The roads change over time, so a place's later `EXITS` can lack one of its
earlier ones. After `BLOCKED` the player has not moved; the reply does not name the missing item.
`UNLOCK` names the required item, which is not consumed. Most places that need an item have their
own arrival text, written as a sentence that ends with the place itself ("guidato dalla tua bussola
fatata … finalmente ti trovi nella palude sussurrante 🌾"), without "arrivi"; only the exits block
marks it as an arrival, and nothing but the known place names delimits the place. Neither does
"arrivi" without the colon, which may be followed by more words or a full stop ("arrivi esausto
nella baia di Scogliola 🦀", "arrivi (stremato) nell'immenso deserto di Sabbiora 🏜.").

`NEEDED` is a separate, unaddressed notice that is not the answer to a command: it follows a `/dai`
of the item by a player at `LOCATION`, and names an item that `LOCATION` itself or another place on
the way back from it to the village (`nel villaggio …`) requires, without saying which.

```bot-reply type=location query="/viaggio" location="il bosco nebbioso di Valtorbo 🌲" exits.0="la valle ventosa 🏞" exits.2="l'immenso deserto di Sabbiora 🏜"
@mario_r, ti trovi: nel bosco nebbioso di Valtorbo 🌲
Puoi andare verso:
 - nella valle ventosa 🏞
 - nella palude sussurrante 🌾
 - nell'immenso deserto di Sabbiora 🏜
```

```bot-reply type=travel query="/viaggio valle" location="la valle ventosa 🏞" narrative=null exits.1="i piedi del monte Grevolo ⛰"
@mario_r, ti metti in cammino e dopo un lunghissimo viaggio arrivi nella valle ventosa 🏞

Puoi andare verso:
 - nel bosco nebbioso di Valtorbo 🌲
 - ai piedi del monte Grevolo ⛰
```

```bot-reply type=travel query="/viaggio banco" location="il banco corallino 🐠" narrative="mastichi una foglia di Respirella dalla tua scorta e puf! per magia respiri sott'acqua come un pesce! Ti tuffi senza esitare e scendi sempre piu' giu', senza alcun problema.. Dopo una lunga discesa"
@mario_r, mastichi una foglia di Respirella dalla tua scorta e puf! per magia respiri sott'acqua come un pesce! Ti tuffi senza esitare e scendi sempre piu' giu', senza alcun problema.. Dopo una lunga discesa arrivi: sul banco corallino 🐠

Puoi andare verso:
 - nella valle ventosa 🏞
```

```bot-reply type=travel query="/viaggio palude" location=null narrative="guidato dalla tua bussola fatata … finalmente ti trovi nella palude sussurrante 🌾" exits.0="il bosco nebbioso di Valtorbo 🌲"
@mario_r, guidato dalla tua bussola fatata … finalmente ti trovi nella palude sussurrante 🌾

Puoi andare verso:
 - nel bosco nebbioso di Valtorbo 🌲
```

```bot-reply type=travel_blocked query="/viaggio palazzo" location="il magnifico Palazzo di Cristallo 🏰" addressee=mario_r
@mario_r non puoi andare: nel magnifico Palazzo di Cristallo 🏰.. Forse ti manca qualcosa!
```

```bot-reply type=travel_requirement item="una lanterna cieca" location="le cripte del monastero 👻" addressee=null
una lanterna cieca ti serve per passare nelle cripte del monastero 👻 sulla via per tornare al villaggio.
```

### 6.10 Gift notice

Sent privately to a player who received items, if notices are on. It answers no command and names
the giver.

```text
GIFT = "[N] " [ "Sua Maestà" SP ] "@" USERNAME [ SP TITLE ] " ti ha dato " INT "x " NAME EOT
```

```bot-reply type=gift from=lucia_b qty=1 item="un tappetino con scritto Benvenuti" addressee=null
[N] @lucia_b ti ha dato 1x un tappetino con scritto Benvenuti
```

```bot-reply type=gift from=msx80 item="una ruota della fortuna 🎡"
[N] Sua Maestà @msx80 ti ha dato 1x una ruota della fortuna 🎡
```

### 6.11 Give

`/dai`. The addressee is the giver; the receiver follows "a".

```text
GIVE = ADDR "dai " INT "x " NAME " a " ( [ "Sua Maestà " ] "@" USERNAME [ SP TITLE ] | "[.. una presenza indistinta..]" ) EOT
```

```bot-reply type=give query="/dai @lucia_b pigna" to=lucia_b qty=1 item="una pigna secca" addressee=mario_r
@mario_r, dai 1x una pigna secca a @lucia_b
```

A receiver without a visible username is written as such:

```bot-reply type=give query="/dai @lucia_b pigna" to=null qty=1 item="una pigna secca" addressee=mario_r
@mario_r, dai 1x una pigna secca a [.. una presenza indistinta..]
```

```bot-reply type=give query="/dai @lucia_b 30 zucchin" titles="il Lucente|il Cartomante" to=lucia_b qty=30
@mario_r il Lucente, dai 30x una simpatica zucchina a @lucia_b il Cartomante
```

Refusals (nothing is transferred):

| Reply                                                                                     | Cause                                         |
| ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| `Sintassi: /dai utente quantita' oggetto`                                                 | no arguments                                  |
| `Non esiste quell'utente. Sei sicuro di aver scritto giusto (anche minuscole/maiuscole)?` | unknown receiver                              |
| `non ne hai abbastanza, ne possiedi solo N.`                                              | more than owned; `N` is the exact count owned |
| `la quantità deve essere un intero positivo, non fare il furbo.`                          | quantity ≤ 0                                  |
| `meglio non dare niente a @x, non ti sembra un tipo affidabile.`                          | receiver not allowed                          |
| `sicuro che vuoi dare cose a @x? Meglio di no..`                                          | receiver not allowed                          |
| `NAME deve raffreddarsi ancora per DURATION prima di poterlo dare in giro.`               | the item is still cooling down (6.13)         |
| `troppi oggetti trovati con quel nome(<arg>)`, `@u, non hai niente del genere`            | ambiguous or not owned                        |

```bot-reply type=miss query="/dai" reply=dai_syntax command=/dai addressee=null
Sintassi: /dai utente quantita' oggetto
```

```bot-reply type=miss query="/dai @lucia_b 60 moneta" reply=dai_not_enough owned=57 addressee=null
non ne hai abbastanza, ne possiedi solo 57.
```

### 6.12 Show

`/mostra <item>`. `INT` is the number owned.

```text
SHOW = ADDR "mostri orgogliosamente di possedere " INT "x " NAME SP RARITY [ SP USABLE ] EOT
```

```bot-reply type=show query="/mostra fazzol" qty=14 item="un candido fazzoletto" rarity=C usable=false
@mario_r, mostri orgogliosamente di possedere 14x un candido fazzoletto [C]
```

```bot-reply type=show query="/mostra fischietto" qty=241 rarity=C addressee=null
[.. una presenza indistinta..], mostri orgogliosamente di possedere 241x un fischietto di quelli da carnevale che fanno le trombette [C]
```

### 6.13 Use

`/usa <item>`. Each usable item has its own texts, so there is no common grammar beyond `ADDR TEXT`.
Items received are either listed as `ITEM_LINE`s after the first line, or named in the text
("Ottieni: un seme di Zaffirella!", "ci trovi dentro 22 monete d'oro!").

| Kind                          | Replies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| item not found / not named    | `non hai niente del genere di usabile.`, `si ma cosa vuoi usare?`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| item not usable               | `non puoi usare quell'oggetto..`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| argument not understood       | `<arg> non e' un utente e non hai oggetti del genere.`, `quello non e' ne un utente ne un oggetto in tuo possesso.`, `Troppo lungo vecchio...`                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| argument asked for            | `su che Pakkomon vuoi usarlo?`, `a chi lo vuoi tirare?`, `dove vuoi teletrasportarti?`, how to use the item (`utilizzo:` + its syntax)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| argument not found            | `non hai nessun oggetto con quel nome.`, `nessun oggetto trovato con quel nome`, `non conosco nessuno con quel nome..`, `troppi luoghi trovati con quel nome(<arg>)`, `Non e' un pakkomon!`, `Troppo corto vecchio...`, `Esiste gia...`                                                                                                                                                                                                                                                                                                                                              |
| errors                        | `Qualcosa e' andato storto.. <detail>`, `qualcosa e' andato storto.. :(`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| failure stating a requirement | `non hai la chiave giusta per aprire questo baule..`, `… ma non le hai ancora tutte..`, `non puoi teletrasportarti in quei luoghi, forse ti mancano gli oggetti necessari..`, `<player> non ha un walkie talkie..`, `<player> non e' un nuovo arrivato..`, `quel pakkomon ha gia' bevuto l'elisir..`, `i pakkomon boss vanno sfidati in Arena!`, `non hai abbastanza <item>`, `devi introdurre esattamente N oggetti in totale.`, `gli oggetti inseriti devono essere tutti della stessa rarita' (C, N, R o S)`, `Rarità ammesse: …`, `non ti senti in grado di cuocere una pizza..` |
| other failures                | the item cooldown (below), `non conosci nessun luogo con quel nome..` (capsule destination)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| success                       | anything else                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

An item still cooling down is refused, to `/usa` and to `/dai`, naming the item and the time left
(truncated to the units shown, as in item info). The `/usa` refusal is addressed, the `/dai` one is
not:

```text
ITEM_COOLDOWN = [ ADDR ] NAME " deve raffreddarsi ancora per " DURATION " prima di poterlo "
                ( "usare di nuovo." | "usare." | "dare in giro." ) EOT
```

```bot-reply type=use query="/usa dado" text="tiri il dado e fai 5!" items=[]
@mario_r, tiri il dado e fai 5!
```

```bot-reply type=use query="/usa ruota"
@mario_r, giri la ruota e si ferma su:
[🍀🌙🍀]
Hai fatto coppia, vinci 2 gettoni!
```

```bot-reply type=use query="/usa baule ebano" items.0.name="una moneta d'oro" items.0.qty=41 items.1.usable=true
@mario_r, infili una chiave di ebano 🔑 nella serratura di un baule di ebano 📦, lo apri e dentro trovi:
-una moneta d'oro [X] x41
-un cartoccio di caldarroste🌰 [X] [usabile] x1
```

```bot-reply type=use query="/usa alberello" items.0.name="un seme di Zaffirella" items.0.qty=1
@mario_r, osservi il tuo vecchio alberello e sorpresa! Noti che su un ramo è spuntato un piccolo seme. Senza indugio lo cogli con delicatezza. Ottieni: un seme di Zaffirella!
```

```bot-reply type=item_cooldown query="/usa alberello" item="un vecchio alberello parlante 🌱" action=use remaining=14760 precision=60
@mario_r, un vecchio alberello parlante 🌱 deve raffreddarsi ancora per 4 ore e 6 minuti prima di poterlo usare di nuovo.
```

```bot-reply type=item_cooldown query="/dai lucia_b ruota" item="una ruota della fortuna 🎡" action=give remaining=12 precision=1 addressee=null
una ruota della fortuna 🎡 deve raffreddarsi ancora per 12 secondi prima di poterlo dare in giro.
```

The Pakkomon scanner's reply lists the player's Pakkomon, each with the time left before it can
fight again or `pronto`; its lines are not items received. Equipping a Pakkomon with an item
(`/usa <pakkomon> # <item>`) answers `@u, equipaggi il tuo NAME con ITEM_LINE.`, the item kept by
the Pakkomon, not received. Both replies name the item used: the scanner, the Pakkomon.

```bot-reply type=use query="/usa scanner" items=[] named=scanner
@mario_r, esamini i tuoi pakkomon con lo scanner:
 - Zampirlo 🐯: 5 minuti e 38 secondi
 - Brumolo 👻: pronto
```

The same texts without a known `/usa` command:

```bot-reply type=miss
@mario_r, non hai niente del genere di usabile.
```

```bot-reply type=unknown addressee=mario_r
@mario_r, tiri il dado e fai 5!
```

### 6.14 Player stats

`/stats <username>`.

```text
STATS = "Avventuriero " PLAYER { NL "- " FIELD ": " VALUE } NL "- Oggetti unici:" [ SP ] { NL "   - " NAME SP RARITY [ SP USABLE ] } EOT
```

| Field                           | Value                                                 |
| ------------------------------- | ----------------------------------------------------- |
| `Livello`                       | level (`∞` for the admin)                             |
| `Luogo`                         | current place                                         |
| `Oggetto preferito`             | `INTx NAME`; absent if none is set (see below)        |
| `Avventure`, `Ricette`          | total, `(INT° posto)` rank, `Oggi: INT` today         |
| `Oggetti`, `Distinti`, `Monete` | items, distinct items, gold coins, each with its rank |
| `Oggetti unici`                 | the `U` items owned, one per indented line            |

The favourite item's `NAME` may span lines, like any player-made item's, and those lines may read
like fields (`- Luogo: …`, even `- Oggetti unici:`): it ends before the first field with its rank,
`Avventure`.

```bot-reply type=stats query="/stats mario_r" luogo="il banco corallino 🐠" livello=3 addressee=mario_r
Avventuriero @mario_r
- Livello: 3
- Luogo: sul banco corallino 🐠
- Avventure: 1067 (1181° posto) Oggi: 5
- Ricette: 80 (1017° posto) Oggi: 1
- Oggetti: 927 (1125° posto)
- Distinti: 383 (810° posto)
- Monete: 35 (2210° posto)
- Oggetti unici:
```

```bot-reply type=stats query="/stats lucia_b" titles="il Lucente" addressee=lucia_b livello=11 unique_items.0.name="un gigantesco forziere da 3 tonnellate di monete d'oro 🏷" unique_items.0.rarity=U
Avventuriero @lucia_b il Lucente
- Livello: 11
- Luogo: al molo dei barcaioli 🎣
- Oggetto preferito: 1x la Grande Pietra Lucente Dell'Infinito Splendore Cosmico Ultra Mega Luminosa 💎
- Avventure: 25485 (34° posto) Oggi: 5
- Monete: 23613 (6° posto)
- Oggetti unici:
   - un gigantesco forziere da 3 tonnellate di monete d'oro 🏷 [U]
```

The admin's statistics:

```bot-reply type=stats query="/stats msx80" addressee=msx80 livello=∞ unique_items.0.name="il Sigillo Antico" unique_items.1.usable=true
Avventuriero Sua Maestà @msx80
- Livello: ∞
- Luogo: nella grotta dei contrabbandieri ⚓
- Oggetti unici:
   - il Sigillo Antico [U]
   - un cannocchiale dorato [U] [usabile]
```

### 6.15 FAQ

`/faq`. Not addressed. A long help text with blank-line-separated sections: an introduction,
"Comandi base:", "Livelli" (the level rule), "Legenda oggetti" (the rarity legend, then the `+`
rule), and sections on abuse, official groups and donations. The example is abridged after the
legend and without "Comandi base".

```text
FAQ    = "Ciao, sono InventoryBot!" ANY NL "Livelli" NL NL RULE NL NL "Legenda oggetti" NL LEGEND NL PLUS [ NL NL ANY ] EOT
LEGEND = LINE        (* "…: C = comune, N = non comune, …, Ln = ottenibile da ricette. X = oggetti speciali :)" *)
```

```bot-reply type=faq query="/faq" rarities.C=comune rarities.U="unico (esiste un solo oggetto di questo tipo)" rarities.Ln="ottenibile da ricette" rarities.X="oggetti speciali" addressee=null
Ciao, sono InventoryBot! Gioca con me, vivi incredibili avventure, colleziona tantissimi oggetti e combinali per formarne di nuovi! E se sei veramente molto molto bravo, potrai sconfiggere il malvagio Arcibaldo! Chi e' il malvagio Arcibaldo? Scoprilo nel gioco!

Livelli

Per raggiungere il nuovo livello devi fare una ricetta del livello corrispondente. Ad esempio se sei livello 2, per passare al 3 devi fare una ricetta di livello 3. Puoi vedere i livelli delle ricette col comando /ricetta. Ricchi premi e cotillons al passaggio di livello!

Legenda oggetti
Gli oggetti sono accompagnati da una lettera che indica la rarita' o la tipologia: C = comune, N = non comune, R = raro, S = super raro, U = unico (esiste un solo oggetto di questo tipo), Ln = ottenibile da ricette. X = oggetti speciali :)
Se un oggetto ha un + nel nome, significa che c'e' un solo luogo dove quell'oggetto esce. Scoprite quale!
```

### 6.16 Other replies

Help, listings and refusals:

| Reply begins with or contains                                          | Produced by                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `I comandi:`                                                           | `/faqcomandi` (the list in section 3)                               |
| `Eroi di Sempre:`                                                      | `/stats` without arguments: leaderboards of `@user TITLE (n)`       |
| `Gruppi di InventoryBot`                                               | `/gruppi`                                                           |
| `Benvenuto!`                                                           | `/start`, `/registrami`                                             |
| `ciao @u, per giocare con me devi prima registrarti!`                  | any command from an unregistered user                               |
| `cosa vuoi esaminare?`                                                 | `/esamina` without arguments                                        |
| `@u, non hai ricette al momento.`                                      | `/ricetta` with no visible recipe                                   |
| ambiguity and not-found replies                                        | section 3                                                           |
| `Errore <Java exception> …`                                            | a command with a malformed argument, or an internal error           |
| `Non puoi :)`                                                          | a restricted command                                                |
| `in questo gruppo non sono consentite avventure, inventari e liste …`  | `/avventura`, `/inventario` or `/ricetta` in a group that bans them |
| `non esiste nessuno con quel nome..`                                   | `/stats` of an unknown user                                         |
| `Non c'e' nessuna lotteria attiva`                                     | `/biglietto` with no lottery open                                   |
| `Mi spiace ma per evitare abusi non e' possibile cambiare username. …` | any command after the player changed their username                 |
| `⚠ Per favore risolvi il captcha per continuare. …`                    | any command, when the bot asks for a captcha                        |
| `Ciao, il gioco si e' trasferito sul nuovo bot, @u! …`                 | any command sent to the previous bot after July 2021 (section 7)    |

Lotteries are announced in groups; the announcements are not answers to a player's command. A
lottery opens with `APRE LA BIGLIETTERIA! PRENDETE UN BIGLIETTO CON /biglietto!`, players take a
ticket with `/biglietto` (a `[N] @u, prendi un biglietto!` notice follows), then
`LA BIGLIETTERIA E' CHIUSA!! NIENTE PIU' BIGLIETTI!!`,
`ABBIAMO N PARTECIPANTI! PRONTI ALL'ESTRAZIONE!`, `RULLO DI TAMBURI!!!`, and the draw:
`IL FORTUNATO E': @u ! Evviva! Vince il fantastico Primo Premio della lotteria!` and
`PREMIO DI CONSOLAZIONE: @u vince un pacchettino di consolazione 🎁!` for the others. The prizes are
usable items (their `/usa` replies list what they contain).

```bot-reply type=miss reply=lottery_drumroll addressee=null
RULLO DI TAMBURI!!!
```

```bot-reply type=miss query="/stats" reply=leaderboards command=/stats
Eroi di Sempre:
Livelli: @lucia_b il fornaio (11), @gino_x l'incappellato (11), @mario_r (11)
Numero oggetti: @gino_x (26278), @mario_r (23745), @lucia_b il fornaio (20482)
```

```bot-reply type=miss query="/avventura" addressee=mario_r
ciao @mario_r, per giocare con me devi prima registrarti! Basta scrivermi /start in privato :)
```

```bot-reply type=miss query="/remove pippo" reply=error addressee=null
Errore NumberFormatException For input string: "pippo"
```

`/titolo` (title-giving items owned) answers `@u, non hai oggetti che diano titoli..` when the
player owns none; the reply of a player who owns some is not known in its current form (the
2017-2018 form, which lists them, is in section 7).

```bot-reply type=title query="/titolo" items=[] addressee=mario_r
@mario_r, non hai oggetti che diano titoli..
```

### 6.17 Favourite item, hidden recipes and quests

`/preferito <item>`, `/nascondi [recipe | *]` and `/quest`. These replies confirm or show the
player's interface preferences and carry no game fact.

```text
FAVOURITE = ADDR "sei veramente affezionato a " NAME ", e' di gran lunga il tuo oggetto preferito!" EOT
HIDE      = ADDR "nascondi la ricetta " RNAME EOT
UNHIDE    = ADDR "smetti di nascondere la ricetta " RNAME EOT
HIDDEN    = ADDR "stai nascondendo le seguenti ricette:" NL ( "nessuna" | " - " RNAME { NL " - " RNAME } ) EOT
NO_QUEST  = ADDR "non hai nessuna quest al momento." EOT
```

- `FAVOURITE` answers `/preferito <item>`: the item, named without rarity, becomes the
  `Oggetto preferito` of `/stats` (6.14). An item the player does not own gets
  `@u, non hai niente del genere` (section 3).
- `/nascondi <recipe>` hides a recipe (`HIDE`); the same command for a hidden recipe shows it again
  (`UNHIDE`). `/nascondi *` hides or shows every recipe. `/nascondi` without arguments lists the
  hidden recipes (`HIDDEN`), `nessuna` when there are none.
- `/quest` answers `NO_QUEST` when the player has no quest. The replies about a quest offered, still
  incomplete or completed are known only in their 2017-2018 forms (section 7).

```bot-reply type=miss query="/preferito bonsai" reply=favourite command=/preferito addressee=mario_r
@mario_r, sei veramente affezionato a un piccolo bonsai, e' di gran lunga il tuo oggetto preferito!
```

```bot-reply type=miss query="/nascondi orto" reply=hide_recipe command=/nascondi addressee=mario_r
@mario_r, nascondi la ricetta Orto in vaso
```

```bot-reply type=miss query="/nascondi orto" reply=unhide_recipe command=/nascondi
@mario_r, smetti di nascondere la ricetta Orto in vaso
```

```bot-reply type=miss query="/nascondi" reply=hidden_recipes command=/nascondi
@mario_r, stai nascondendo le seguenti ricette:
nessuna
```

```bot-reply type=miss query="/quest" reply=quest_none command=/quest addressee=mario_r
@mario_r non hai nessuna quest al momento.
```

## 7. Older formats

Group histories reach back to 2017. These formats belong to earlier periods:

- **Until September 2017**, item info had only its first line (no count, no source), whose recipe
  list had no final full stop; usable items had an empty line, then the `Raffreddamento` line.
- **Until 2018**, travel replies had no `Puoi andare verso:` block, and arrival texts of places
  needing an item ended in other ways ("arrivi esausto nella baia di Scogliola 🦀", "arrivi
  (stremato) nell'immenso deserto di Sabbiora 🏜", "… riesci ad accedere al molo dei barcaioli 🎣"):
  like the current item-narrated arrivals, they end with the place, but without the exits block only
  the `/viaggio` command they answer marks them as arrivals.
- **Until 2018**, `/inventario M` listed `M` and `M+` items, `+` alone listed every `+` item,
  `[usabile]` listed the usable items, and an invalid argument got
  `@u puoi usare solo i seguenti parametri: C, N, R, S, L, X, U, M.`
- **Until 2025**, some adventure narratives ended without the final `!`.
- **Until July 2021** the game ran on a previous bot; afterwards that bot answered every command
  with a notice that the game had moved to `@InventoryBot`.
- **In 2017-2018** groups also saw:
  - `/titolo` replies:
    `@u, ora non hai nessun titolo. Ecco gli oggetti che danno titoli che possiedi:` + item lines,
    `@u, NAME RARITY non da nessun titolo..`, and the title choice
    `@u, ti fregi del titolo che si confa' al possessore di NAME RARITY.`;
  - quests (`/quest` is still a command, 6.17): a character asks for help
    (`@u, un robusto valletto … ti si avvicina per chiederti aiuto! … Puoi aiutarlo?` +
    `Gli serve:` + item lines + the time left),
    `@u, non hai ancora tutti gli oggetti necessari per aiutare …, ti manca:` + item lines (+
    `Mentre hai gia':` + item lines) + the minutes left, the completion
    `Complimenti! Hai trovato tutti gli oggetti! Li consegni a … Ti ricompensa donandoti:` + item
    lines;
  - parcels: `@u bravissimo, hai trovato un pacchetto! Tutto contento lo apri e dentro ci trovi:` +
    item lines + a pointer to `/faq`, and the gift parcel opened with `/usa`
    (`@u, ti accingi ad aprire il tuo pacco eccitato come un bambino a natale, …` + item lines);
  - Pakkomon, creatures obtained by using a sphere
    (`@u, lanci la tua ITEM, si apre a mezz'aria ed esce un Pakkomon di nome NAME RARITY!`) and used
    to fight other players' Pakkomon (`/usa <pakkomon> # @user`):
    `@u, sfidi @x a combattere contro il tuo NAME`,
    `@u, sei pronto a sfidare chiunque col tuo NAME !`, the fight
    `[N] i due pakkomon iniziano a combattere furiosamente e alla fine NAME di @x sconfigge NAME di @y …`,
    a Pakkomon's record `@u, NAME ha vinto N battaglie e ne ha perse N.` + its equipment and
    readiness, and the refusals
    `@u, il pakkomon del tuo avversario e' ancora rintronato per DURATION.` and
    `@u, NAME e' ancora rintronato dall'ultimo combattimento. …`;
  - bans (`[BAN] Sei stato bannato per: N ore. Motivazione: …`) and the inventory header
    `Inventario di @u, al YYYY/MM/DD HH:MM:SS`.
- **In 2017**, `/nascondi` with a recipe not found answered
  `nessuna ricetta trovata con quel nome (ARG)`.
- **Items get renamed**: "un Gufetto d'Argento" became "un Premio Sgranocchio" in 2026, with the
  same recipes and rarity. Recipes can also change their ingredients.

```bot-reply type=travel query="/viaggio cima" location="in cima al monte Grevolo 🏔" exits=[] narrative=null
@mario_r, ti metti in cammino e dopo un lunghissimo viaggio arrivi in cima al monte Grevolo 🏔
```

```bot-reply type=travel query="/viaggio baia" location=null exits=[] narrative="ti infili la tua muta da palombaro e ti tuffi! Via mare puoi finalmente superare la scogliera che blocca il passaggio. Dopo una bella nuotata, arrivi esausto nella baia di Scogliola 🦀"
@mario_r, ti infili la tua muta da palombaro e ti tuffi! Via mare puoi finalmente superare la scogliera che blocca il passaggio. Dopo una bella nuotata, arrivi esausto nella baia di Scogliola 🦀
```

```bot-reply type=item_info query="/esamina baule" item="un baule di ebano 📦" usable=true used_in_raw="Cera riciclata" count=null cooldown="23 ore"
@mario_r un baule di ebano 📦 [S] [usabile] al momento ti serve nelle ricette: Cera riciclata

Raffreddamento: 23 ore
```

```bot-reply type=old_format query="/quest" format=quest_completed addressee=null
Complimenti! Hai trovato tutti gli oggetti! Li consegni a un vecchio pescatore con la pipa spenta che e' contentissimo di poter finalmente tornare in mare!
Ti ricompensa donandoti:
- il primo numero di Topo Detective [S] x1
- un attestato di buona azione [X] x1
- una moneta d'oro [X] x7
```

```bot-reply type=use items.0.name="un Pakkomon di nome Brumolo 👻" items.0.rarity=X named="Sfera Frullo"
@mario_r, lanci la tua Sfera Frullo, si apre a mezz'aria ed esce un Pakkomon di nome Brumolo 👻 [X]!
```

```bot-reply type=old_format query="/usa zamp" format=pakkomon_record
@mario_r, Zampirlo 🐯 ha vinto 54 battaglie e ne ha perse 44.
E' equipaggiato con una spada di cartone [S].
E' pronto a combattere.
```

```bot-reply type=title query="/titolo" items.0.name="un astrolabio da cartografo" items.0.rarity=L1
@mario_r, ora non hai nessun titolo. Ecco gli oggetti che danno titoli che possiedi:
- un astrolabio da cartografo [L1]
```

## 8. Example blocks

Every reply example above is a block with the info string `bot-reply` and attributes `key=value`,
`key="value"` (`\"` escapes a quote) or `key='value'`, which say what the reply means:

- `type`: the kind of reply (required); `query`: the command it answers (default none);
- `chat=group`: the reply was sent in a group, and a leading `[W] ` is not part of it;
  `titles="a|b"`: these player titles are not part of it (`Sua Maestà ` never is, at the start and
  after `Avventuriero `);
- `addressee`: the player the reply names (`null` for none);
- any other key: a value read from the reply, by dotted path (`items.0.qty`): text for strings,
  compact JSON otherwise. A place is read in its article form: an articulated preposition at the
  start becomes its article (`nella valle ventosa 🏞` is `la valle ventosa 🏞`, `al porto…` is
  `il porto…`), so that every source names a place the same way.

## 9. Unknowns

- What `M` means.
- Whether the lucky adventure of the day is one per day for all players or one per player.
- What `[W]` stands for.
- Whether "half of the ingredients" (recipe visibility) counts units or distinct items.
- Whether an exact name wins over partial matches in lookups.
- The current `/titolo` reply of a player who owns title-giving items.
- What triggers the "ti serve per passare" notice (6.9); it can follow `/dai` and `/ricetta`
  replies.
- Where a hidden recipe is left out (the `/ricetta` list, `/esamina`), and the current replies of
  `/nascondi *` and of `/quest` while a quest is open.
