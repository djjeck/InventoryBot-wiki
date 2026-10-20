# The invented universe

Every item, recipe, place and Telegram username in the tests and docs of this repository is
invented: real game content is meant to be discovered by playing, and never belongs here. This file
lists the invented world. Tests and docs use names from it; a new invented name is added here, in
the same change.

`npm run check:universe` (`scripts/check-universe.ts`, run by `validate`, `ci` and GitHub CI)
enforces it: wherever the bot's reply formats put an item, a recipe or a place, and wherever an
`@username` is written (`scripts/universe.ts`), the name must be in the lists below. Names are
compared ignoring case and runs of spaces; places include their preposition and emoji, as the bot
writes them.

Before adding a name, make sure it is not a real one. Public facts the bot tells every player
(command names, the `/faq`, fixed reply texts) are not entities and need no entry. A trailing
`<!-- … -->` comment explains an entry where needed: `public: …` marks the rare real name that every
player sees anyway, and says why it is allowed.

## Items

- il primo numero di Topo Detective
- il Sigillo Antico
- lo stecco di legno di un ghiacciolo
- un apriscatole storto
- un astrolabio da cartografo
- un attestato di buona azione
- un barattolo di vetro con qualche conchiglia dentro
- un caffè ristretto
- un candido fazzoletto
- un chicco di caffè
- un ciuffo di morbide setole di tasso
- un fiorino ƒ
- un fischietto di quelli da carnevale che fanno le trombette
- un gigantesco forziere da 3 tonnellate di monete d'oro 🏷
- un grembiule da cuoco
- un Motocarro anni 70
- un Pakkomon di nome Brumolo 👻
- un rampino di ferro
- un sasso
- un seme di Zaffirella
- un secchio di fango
- un tappetino con scritto Benvenuti
- un torroncino al pistacchio
- un vecchio alberello parlante 🌱
- un'ottima "moneta" d'oro
- una candela mezza consumata
- una corda di canapa
- una lanterna cieca
- una latta di piselli
- una manciata di linguette di latta
- una moneta d'oro <!-- public: the game's currency, named in the bot's fixed level-up text -->
- una pigna secca
- una ruota della fortuna 🎡
- una Sfera del Grillo da 1 stella ⭐️
- una spada di cartone
- una splendida statuetta di Torosco di quelle con la coda a spirale 🐲
- una tazzina vuota

## Recipes

- Cera riciclata
- Chiodi storti
- Corso di vela
- Gara di cucina
- L'ancora nel fango
- L'ombra dell'albero
- Merenda veloce
- Orto in vaso
- Pennello rustico
- Piccola collezione
- Pizza della nonna

## Places

- ai piedi del monte Grevolo ⛰
- in cima al monte Grevolo 🏔
- nel bosco nebbioso di Valtorbo 🌲
- nel magnifico Palazzo di Cristallo 🏰
- nell'immenso deserto di Sabbiora 🏜
- nella baia di Scogliola 🦀
- nella palude sussurrante 🌾
- nella valle ventosa 🏞
- nelle cripte del monastero 👻
- sul banco corallino 🐠

## Usernames

Without `@`. Placeholders used in prose and comments (`@u`, `@username`, `@BotName`) count as
invented names.

- anna
- bot
- BotName
- djjeck
- gif <!-- public: Telegram's own GIF search bot, in "via @gif" -->
- gino_x
- guardiano
- InventoryBot <!-- public: the bot itself -->
- lucia_b
- luigi
- luigi_v
- mario
- mario_r
- msx80 <!-- public: the game's author and admin, in the bot's own texts -->
- Name
- nuovo
- somebot
- u
- user
- username
- usernames
- x
- y
- zeta
