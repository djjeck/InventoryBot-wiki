# The invented universe

Every item, recipe, place and Telegram username in the tests and docs of this repository is
invented: real game content is meant to be discovered by playing, and never belongs here. This file
lists the invented world. Tests and docs use names from it; a new invented name is added here, in
the same change.

`npm run check:universe` (`scripts/check-universe.ts`, run by `validate`, `ci` and GitHub CI)
enforces it: wherever the bot's reply formats put an item, a recipe or a place, in the item tuples
of the tests' reply builders, and wherever an `@username` is written (`scripts/universe.ts`), the
name must be in the lists below. Names are compared ignoring case and runs of spaces; places include
their preposition and emoji, as the bot writes them.

Before adding a name, make sure it is not a real one. Public facts the bot tells every player
(command names, the `/faq`, fixed reply texts) are not entities and need no entry. A trailing
`<!-- … -->` comment explains an entry where needed: `public: …` marks the rare real name that every
player sees anyway, and says why it is allowed.

## Items

- il primo numero di Topo Detective
- il Sigillo Antico
- l'oro
- lo stecco di legno di un ghiacciolo
- name <!-- a placeholder in grammars and comments (NAME, `- name [R]`) -->
- rana
- spada
- un A
- un alberello
- un apriscatole storto
- un astrolabio da cartografo
- un attestato di buona azione
- un B
- un barattolo di miele
- un barattolo di vetro con qualche conchiglia dentro
- un baule
- un biscotto
- un biscotto Lunetta
- un biscotto Stellina
- un C
- un caffè ristretto
- un candido fazzoletto
- un cappello piumato
- un chicco di caffè
- un chiodo
- un ciuffo di morbide setole di tasso
- un colino di plastica
- un dado
- un dado a dodici facce
- un dado di legno
- un dado magico
- un dado truccato
- un diamante
- un drago
- un elegante cappello piumato
- un elisir
- un fiore
- un fiore di pianura
- un fiorino ƒ
- un fischietto
- un fischietto di quelli da carnevale
- un fischietto di quelli da carnevale che fanno le trombette
- un gigantesco forziere da 3 tonnellate di monete d'oro 🏷
- un grembiule da cuoco
- un Gufetto
- un Gufetto d'Argento
- un laccio
- un mantello di velluto
- un Motocarro anni 70
- un nastro
- un nastro da pacchi
- un Nuovo
- un oro falso
- un paio di mollette
- un Pakkomon di nome Brumolo 👻
- un Papa Bergoglio
- un Papa Ratzinger
- un piccolo annaffiatoio
- un piccolo bonsai
- un pomodoro
- un Premio
- un Premio Sgranocchio
- un rampino di ferro
- un sacchetto
- un sasso
- un secchio di fango
- un seme
- un seme di Zaffirella
- un tappetino con scritto Benvenuti
- un tesoro
- un torroncino al pistacchio
- un trifoglio di latta
- un tubetto di colla verde
- un uovo di quaglia
- un Vecchio
- un vecchio alberello parlante 🌱
- un vortice
- un vortice croccante di energia biscottosa
- un'ottima "moneta" d'oro
- una candela mezza consumata
- una caps rossa
- una capsula
- una chiave
- una conchiglia
- una corda di canapa
- una cosa
- una ghianda
- una ghianda d'oro
- una L1 rara
- una lampada magica
- una lanterna cieca
- una latta di piselli
- una manciata di linguette di latta
- una mela
- una moneta d'oro <!-- public: the game's currency, named in the bot's fixed level-up text -->
- una mozzarella
- una perla
- una pigna secca
- una pozione
- una ruota della fortuna 🎡
- una sedia pieghevole
- una Sfera del Grillo da 1 stella ⭐️
- una sfera Frullo 💊
- una spada
- una spada di cartone
- una spada di legno
- una splendida statuetta di Torosco di quelle con la coda a spirale 🐲
- una tazzina vuota
- una torre
- una torre alta
- una torre altissima
- una trave
- uno scanner da tasca 📟
- uno scudo
- x

## Recipes

- Altare
- Catena
- Cera riciclata
- Chiodi storti
- Corso di vela
- Gara di cucina
- Gran Torre
- L'ancora nel fango
- L'ombra dell'albero
- Merenda veloce
- Muro
- Orto in vaso
- Pennello rustico
- Piccola collezione
- Pizza della nonna
- Pratica cestina
- Premiazione
- Torre
- Torre alta
- Torre alta di pietra

## Places

- ai piedi del monte Grevolo ⛰
- al banco corallino 🐠
- in cima al monte Grevolo 🏔
- nel bosco nebbioso di Valtorbo 🌲
- nel magnifico Palazzo di Cristallo 🏰
- nel villaggio di Borgoverde 🏡
- nell'immenso deserto di Sabbiora 🏜
- nella baia di Scogliola 🦀
- nella palude sussurrante 🌾
- nella valle ventosa 🏞
- nelle cripte del monastero 👻
- sul banco corallino 🐠
- sulla scogliera bianca 🏖

## Usernames

Without `@`. Placeholders used in prose and comments (`@u`, `@username`, `@BotName`) count as
invented names.

- aldo
- andrea_bianchi
- andrea_rossi
- anna
- bea
- bea_b
- bice
- bot
- BotName
- carla_c
- carlo
- d
- djjeck
- esempio <!-- the player of the web app's example, src/web/demo.ts -->
- gif <!-- public: Telegram's own GIF search bot, in "via @gif" -->
- gino_x
- guardiano
- InventoryBot <!-- public: the bot itself -->
- lucia_b
- luigi
- luigi_v
- mario
- mario_r
- me
- msx80 <!-- public: the game's author and admin, in the bot's own texts -->
- Name
- nuovo
- rita
- somebot
- u
- user
- username
- usernames
- utente
- v
- w
- x
- y
- z
- zeta
