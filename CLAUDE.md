# InventoryBot Wiki

A pipeline that rebuilds the recipes, items and places of the Telegram game
[@InventoryBot](https://t.me/InventoryBot) from Telegram Desktop exports of the bot chat, and shows
them in a web app. Everything runs in the player's browser: the exports are read there and never
sent anywhere. It is written in TypeScript; Node.js runs the tests and the tooling.

See [README.md](README.md) for the end-user description (in Italian).

## Development Process

- Implementation is handled by the AI agent; the author reviews and approves each change.
- Each change is one logical, self-contained commit, with tests and documentation updated in the
  same commit. Commit only after the author has reviewed the change.
- Every commit must pass `npm run ci` on its own: when adding a check, fix the existing files in an
  earlier commit, not a later one.

### Implementation Workflow

**Read documentation first:** Before reading source files, read the relevant documentation. Key
docs:

- [README.md](README.md): what the project does, for end users (Italian).
- [docs/telegram-export.md](docs/telegram-export.md): the Telegram Desktop HTML export format, the
  pipeline's input.
- [docs/bot-protocol.md](docs/bot-protocol.md): the commands and messages of @InventoryBot, as they
  appear in the export.
- [docs/channels.md](docs/channels.md): the cards of the encyclopedia channels the bot's `/gruppi`
  lists, as they appear in their exports.

**Validate after every edit:**

```bash
source ~/.nvm/nvm.sh && nvm use && npm run validate
```

`validate` applies formatting and lint autofixes, regenerates the golden outputs, then runs every
check. Address all errors before considering a change complete. It is for local use only: CI
(`.github/workflows/ci.yml`, mirrored by `npm run ci`) runs the same checks without fixing anything,
so unfixed problems that were never committed still fail. Real Telegram exports and anything derived
from them live only in git-ignored folders (`inbox/` for exports, `out/` for the output of
`npm run inspect`) and never enter git history; every other file is rewritten by `validate`.

**Stop and wait for review:** After completing each change, stop and wait for author approval before
proceeding. Do not chain changes without an explicit instruction to continue.

### Releasing

Commits on `main` are not published: the web app goes live only from a release tag, so changes, pull
requests included, can land at any time and reach players together, recorded in
[CHANGELOG.md](CHANGELOG.md). To cut a release:

1. Find the previous release, `git describe --tags --abbrev=0`, and list what came since:
   `git log --oneline <previous tag>..main`.
2. Choose the version (semantic versioning; below 1.0.0 until the game's author has had their say),
   and add its entry at the top of `CHANGELOG.md`: `## X.Y.Z (YYYY-MM-DD)`, then a short list of the
   changes since the previous release that a player, or a contributor, would notice. Skip cosmetic
   and trivial changes (formatting, refactoring, wording, small fixes of style).
3. Set the version: `npm version X.Y.Z --no-git-tag-version` (it updates `package.json` and
   `package-lock.json`), and commit it with the changelog as `Release X.Y.Z`.
4. Tag that commit, `git tag -a vX.Y.Z -m "X.Y.Z"`, and push both: `git push origin main vX.Y.Z`.

CI then checks the tag as a release (it must match the version in `package.json`, have its entry in
`CHANGELOG.md` and be on `main`), builds the web app and publishes it on GitHub Pages. A tag that
fails publishes nothing: fix it on `main`, then delete the tag and tag again.

### Documentation

- Docs state the result, not the investigation: they describe the format or rule for a reader who
  does not know it, with no account of how it was found out, no references to the exports examined
  and no counts. Each input doc says once at the top the date it describes ("documented as of");
  whoever notices a change in the bot or in Telegram updates it. Genuinely unknown points go in a
  short final section.
- Docs are objective, not about us: they never mention the maintainers' own setup or activity
  (computers, accounts, which exports they made, the commands they ran to check something). A fact
  checked by running a command is written as the fact itself.

## Architecture

The pipeline is a chain of phases, each a function with typed input and output that a caller runs in
order:

1. **Export parsing** (`src/telegram/export/`): Telegram Desktop HTML export pages become `Message`s
   (`src/telegram/messages.ts`), in two steps, so that each export is parsed once. `readExport`
   (`record.ts`) reads the pages of one export into an `ExportRecord`, plain JSON data that can be
   kept: the bot's messages (with the text file one has attached, when the export holds it,
   `file_text`), the commands for the bot and the posts of the bot's channels
   (`BotIdentity.channels`) in full, every other message as a stub without text (chat, id, date,
   display name, sender key), which is all phase 2 reads of it, plus the export's metadata (folder,
   a SHA-256 of the pages, counts, chats, first and last date) and a `formatVersion`. `mergeExports`
   joins the records of a run, which needs them all: macOS dates take their offset from the other
   exports, then copies are de-duplicated by (chat, id), the one read last winning, and sorted; a
   stub becomes a message with an empty text, so the results are those of the whole chat. A macOS
   export's Telegram user ids become sender keys there and nowhere else: a salted SHA-256 of the id
   (`senderKey`), with the pseudonyms' salt, so a person has the same key in every record and every
   run, and nobody without the salt can work back to the id. `parsePages` is the two steps in a row.
   All of it is pure and takes the pages as strings. Which files of an export folder are pages, and
   which text files a page links to, is decided by `export-listing.ts`, also pure; two adapters list
   and read them: `browser-files.ts` for the files of a browser folder picker, `export-files.ts` on
   disk (used by the tests).

2. **Conversation** (`src/telegram/conversation/`, `readConversation`): the messages become the
   bot's replies, each paired with the command it answers and the player it concerns, and with the
   text file it has attached, if any. In the DM a reply answers the latest command; in a group it is
   paired with the command it quotes, else the addressed player's oldest unanswered command, else
   the only candidate, within the bot's answer window. Display names are mapped to @usernames by
   voting over the whole chat (opaque sender keys, when the export gives them, tell apart people
   with the same name). Everything that depends on the bot's wording comes through a `BotDialect`
   (`dialect.ts`); the tests use a synthetic one (`test/conversation.ts`).

3. **Anonymisation** (`src/telegram/anonymise/`, `anonymise`): the conversation with every other
   player's identity replaced by a pseudonym (`VolpeVeloce`, `GufoGentile`, …), one per person or
   group, never equal to a real username of the run. A pseudonym comes from a hash of the name with
   a secret salt that the caller keeps (the web app keeps one per browser): the same person keeps
   the same pseudonym from run to run, and nobody without the salt can work back to the name, as
   they could from a hash of the name alone. Replaced are the player of each reply, the usernames
   the dialect designates in its text (`userSpans`), usernames in the arguments of commands that may
   name a player (`userArguments`: those of `/dai` and `/stats`, a `/usa`'s after `#`), and group
   titles; every other name in a text is what the bot says and stays. The owner, decided just before
   (`src/telegram/conversation/owner.ts`: the given username, else the player the bot addresses most
   in the DM), the bot and the dialect's `publicNames` are kept. Display names never leave this
   phase.

4. **Interpretation** (`src/inventorybot/extract.ts`, `interpretReplies`): every reply becomes a
   typed event (`src/inventorybot/types.ts`): the classifier (`classify.ts`) reads it with the
   command phase 2 paired it with (and `/esporta`'s with its file, the whole inventory), following
   the grammars of `docs/bot-protocol.md`, whose `bot-reply` examples are checked against it
   (`classify.docs-examples.test.ts`). The Pakkomon replies are read by `pakkomon.ts`: fights and
   boss hits (with the loser's stun their ending phrase states, `ENDINGS`, and every player they
   name designated for phase 3), records, challenges, stuns, bosses, and the uses of an item on a
   Pakkomon. A place is named in its article form (`places.ts`: "nella valle" is "la valle"),
   whatever preposition the reply used, so that every source names it the same way; a travel event
   also keeps the words its reply wrote each place with (`written`), from which the wiki keeps how
   the bot writes a place (`at`, the latest wording). The posts of the bot's channels become events
   too (`channels.ts`, `docs/channels.md`): each card, with the date of its post, merged with the
   replies' events in date order. The phase ends by verifying the group pairs (`verify.ts`): a reply
   that, read with its command, is not of that command's family is read again without it, and so is
   a group `/usa` reply that does not fit the item its query names (which uses phase 5's item
   catalogue).

5. **Wiki and player state** (`src/inventorybot/build.ts`, `player.ts`): the events become the wiki,
   facts about the game the same for every player (items, recipes, places, and the rarity legend,
   which `build.ts` states with the rest of the rarity system rather than reading it from the bot's
   `/faq`), and the owner's own state (recipes made, items seen and how often each was used, places
   visited, an estimate of the inventory and how often it agreed with the bot's `/ricetta` lists,
   and their Pakkomon, `player-pakkomon.ts`: each followed by name from its hatching or arrival to
   its departure, given, extracted or left out of a list of all of them, with its record, equipment,
   power-ups, fights, widest win and stun), kept apart so that the wiki can be shared. `build`
   merges the events into a knowledge base, newest observation first, an item's `/usa` replies kept
   by shape, what varies in them described as the channels' cards do (`use-shapes.ts`: "tiri il dado
   e fai N!", N from 1 to 6), and an item a use takes (a chest's key, a machine's inputs, a
   Pakkomon's equipment, `takes` in the use event) used with the item used (`used_with`), and where
   an item comes from besides adventures and recipes: the items whose use gave it (`from_use`), a
   level-up or a lottery draw (`rewards`), a fight against one of the bot's Pakkomon or a boss
   (`from_fight`). Every Pakkomon is the wiki's one item `un Pakkomon` (`wikiItemName` in
   `pakkomon.ts`): each is a creature of its owner, so the wiki learns only what holds for any of
   them, and an item learns what it is for with Pakkomon (`pakkomon_roles`: equipment, healing,
   power-up…) from most of its uses, a use's shape leaving the Pakkomon's name out. `toJson` writes
   the wiki, `playerState` the player state. Phase 5 reads plain JSON copies of the events
   (`buildFromEvents` in `src/pipeline.ts`), since `build` annotates them for `playerState`.

Phases 2 to 4 are InventoryBot's through its dialect (`src/inventorybot/dialect.ts`): addressing,
player titles, broadcasts, what anonymisation designates, and which commands can produce each reply
(`compatibleCommands`, from the reply type the classifier gives). `src/pipeline.ts` runs the phases
and words their report lines: `processExport` is phase 1 for one export (its record), `buildWiki`
runs the rest of phase 1 and phases 2 to 5 on the records of a run (`converse`, `interpret`,
`buildFromEvents`), and `runPipeline` is `buildWiki` on the `processExport` of each export of the
given pages: one code path, whether the records were just read or kept from earlier.

The web app (`src/web/`, `npm run web:dev`) is the interface, published on GitHub Pages by
`.github/workflows/ci.yml` from each release tag that passes the checks (see "Releasing")
(`npm run web:build` builds it into `web-dist/`). The built page carries a Content-Security-Policy
that forbids any network connection, so the browser itself guarantees that the exports are never
sent anywhere. Its one exception is Google Fonts: the page loads its typefaces from there (a
stylesheet and font files, requests that carry no data of the player's), and falls back to system
fonts without them. Its look follows Telegram Web's default themes, light, or night when the system
prefers a dark one, with no switch of its own (colours, Roboto, radii and shadows, as tokens at the
top of `view/wiki-view.css`, with any colour used as text adjusted to 4.5:1 contrast), and the
header shows the bot's profile picture (`avatar.png`, redrawn as clean 26×26 pixel art and drawn at
whole multiples) beside a title in a pixel font. The page (`main.ts`) has one view, the wiki (empty,
with how to export, a link to the repository on GitHub and, while no export is listed, "Prova con un
esempio", until there is one), under a header with a GitHub icon that links to the repository and
whose "Importa" button (with the number of exports) opens a modal panel below it, closed by Escape
or a click outside it, with the owner whose wiki it is (with the inventory estimate's agreement,
`accountLabel` in `labels.ts`), the list of exports (each with its chat, the days of its first and
last message and its status, worded by `labels.ts`, and a bin button to remove it), how to export a
chat, "Aggiungi esportazione", which opens the folder picker, the options and "Cancella i miei
dati". The example is a short chat with the bot, written by hand in `demo-chat.ts`: an invented
player who has just started walks from the village to the plain, finds one each of four common
items, lists and examines their items and recipes. "Prova con un esempio" opens its page in place of
the wiki: the chat as Telegram draws it, and a button that builds the wiki from it; the worker
writes it as an export (`demo.ts`) and reads it like a folder picked, and above its wiki a line
opens the chat again. Adding an export of the player's own drops it (`run.ts`), as its chat with the
bot would mix with theirs. It sends each folder picked at once to a Web Worker (`worker.ts`,
`run.ts`; the messages are in `protocol.ts`), so the page stays responsive, and every change of the
options (the time zone, the username once typing pauses, `debounce.ts`); there is no button to
build. The worker owns the storage and runs the pipeline: it reads each folder into records
(`processExport`) and keeps them, then builds the wiki again from every kept record (`buildWiki`)
and saves the results. It loads the stored records once, at start, and keeps them in memory, so a
build loads nothing again unless another tab stored one. Its queue runs one step at a time: the
folders added, in order, then one build once none is left to read, however many were added. A build
is never abandoned: a folder added or removed while it runs, or new options, make its results not
current, and one more build follows. A folder whose exports are all kept already builds nothing, and
one that cannot be read is listed with the error while the queue goes on. Removing an export
rebuilds from the rest, and options equal to the current ones build nothing. The header shows the
reading and the build's phase while the current wiki stays usable; each build's wiki replaces it in
place, without moving the focus. The wiki and the player state are drawn by the wiki view
(`view/wiki-view.js` and `.css`, plain JavaScript that defines `window.renderWiki`): as in
Telegram's chat list, the search, the categories (as tabs, each with how many entries it lists, with
the search if any, as unread counts) and their list are in a sidebar fixed to the left of the
window, whose list scrolls on its own, while the selected entry is in the page, shown first as the
bot's own reply that describes it (`/esamina`, a recipe's craft, `/viaggio` for a place), worded for
any player, in a Telegram bubble with links, then what the bot does not say, with the owner's own
state in a card beside it (above it when narrow), as the bot would answer them ("ti manca: …"),
which scrolls as a whole (on a narrow screen the sidebar is a block above it); the tab and the
selected entry are in the URL's fragment (`#oggetti/l_oro`: a slug of the name, unique within its
tab; a recipe whose item is known is shown on the item's page, which also holds its recipes, at the
item's address with the list it was opened from, `#oggetti/una_torre?lista=ricette`, and
`#ricette/<slug>` leads there), so a reload keeps them and each change is a step of the browser's
history; and the report is in a collapsed section. A fourth tab, Pakkomon, shown only while the
owner has a Pakkomon (they come late in the game), lists a guide first (the fight rules and the
ending phrases' stuns, `ENDINGS` of `pakkomon.ts`, the items of each Pakkomon role, the prizes of
fights), then the owner's Pakkomon, current ones unless a filter shows the former: each page is its
record as the bot shows it, then its story and fights, beside a card of the owner's items for
Pakkomon (the equipment it wears, that of their other Pakkomon, the free one; healing items,
power-ups, tools); the wiki's one Pakkomon item leads there. Each recipe on a page comes with its
tree, when it takes an item that a recipe makes: everything it takes, a column per level, down to
the items to find, each item once (an ingredient of several of its recipes has an edge from each)
with how many times to craft it, or how many to find, to make the recipe once. With the owner's
state, a toggle above it, "Ti manca" by default (remembered in this browser), shows only what they
still lack: the inventory estimate is taken off each count, an item they hold enough of is not
drawn, nor what it takes, and a recipe they can make now is green. Above a place, Luoghi shows the
map of the places (`map-layout.ts`, drawn by the view as pixel art, the same in both themes, its
rows a little closer than its columns): a grid, as in classic role-playing games, running across a
wide window and down a tall one, where no two roads cross and a road goes at 45° only from a place
with more than four roads. It is the tree of the shortest routes from the village (the place the bot
calls "il villaggio"), drawn in three steps: directions by rules alone (a place's straight
directions to its biggest branches, along the main axis first, a branch linked to a sibling beside
it, the rest diagonally), lengths by pushing each branch out as one block until it fits, the lines
towards the branches still to join kept clear, then straight dead-end chains folded at a right angle
where that makes the map smaller; a link that no length keeps clear may cross a road. Places the
village does not reach go on free cells along its edge. The selected place is marked, with its
shortest route from the village. The owner is the player the bot addresses most in the DM; without a
DM the build stops, the records stay kept, and the panel shows a username field, which the page
offers nowhere else. What the worker keeps is in IndexedDB, in this browser only (`storage.ts`): the
records of the exports (`ExportRecord`, never the export pages), each with its folder, dates and
counts, in upload order, which is their merge order; the last results (wiki, player state, report,
options) with the records they were built from and the build of the page that made them
(`__BUILD__`, from `vite.config.ts`: a release's version, a new value at each start of the dev
server), so a returning player sees their wiki at once and the worker rebuilds only if they are not
current, from other records or by another build; and the salt of the pseudonyms and sender keys,
made once. A record is valid only with the salt that made it, so the three live in one database:
without a salt the records and results are dropped, and a record or results made with another salt
are refused. A record of an older `RECORD_FORMAT_VERSION` is stale: it is listed, so the player can
add the export again, but never used, and its payload is dropped. Opening the database of an older
schema drops what it kept. Without storage the worker keeps the records of the visit in memory.
"Cancella i miei dati" deletes the whole database and resets the options. `run.ts`, `storage.ts`,
`labels.ts`, `debounce.ts`, `demo.ts` and `map-layout.ts` use no browser API and are tested in Node
(on a fake IndexedDB, `test/fake-indexeddb.ts`); `main.ts` and `worker.ts` are browser-only wiring,
checked in a browser (type-checked with the DOM types by `tsconfig.web.json`, and left out of
coverage).

`npm run inspect -- [FOLDER ...] [--out DIR] [--player NAME] [--time-zone ZONE]`
(`scripts/inspect.ts`, the work in `scripts/inspection.ts`) is a development tool, not part of the
product: it runs the web app's code path on exports on disk (`processExport` for each export, then
`buildWiki` on every record), by default those in `inbox/`, so results can be checked without
reading the chats. It prints an aggregate summary (per export its folder, DM or group, first and
last day, messages, bot messages and whether its record was kept from an earlier run; the time of
each phase; the report lines without the entries that quote texts; the counts of the wiki; how often
the inventory estimate agreed with the bot) and writes to the output folder, by default `out/`:
`wiki.json` and `player.json`, the wiki and player state the page draws; the record of each export,
keyed by the hash of its pages, so a later run parses only exports it has not seen; and the salt of
the pseudonyms and sender keys, made once, with which alone the kept records are valid. It refuses
an output folder inside the repository that git does not ignore. Exit codes: 0 done, 1 stopped (no
export, or no DM and no `--player`), 2 wrong arguments or a refused output folder.

The code has two layers. The generic Telegram-bot layer, `src/telegram/` with the utilities of
`src/lib/`, knows nothing about the game: the bot is a parameter (`BotIdentity`,
`src/telegram/bot.ts`), so the layer could serve another bot, and a change in the game's wording
never touches it. Everything about InventoryBot belongs in its own layer, `src/inventorybot/`, and
only `src/pipeline.ts` and the web app, `src/web/`, join the two. `src/layers.test.ts` fails on any
import from the generic layer into either.

## Data rules

- **The wiki is objective.** It holds only facts about the game, the same for every player. Anything
  about the owner's own play (crafts, dates, places visited, holdings) goes in the player state, and
  the wiki view works without it.
- **Telegram user ids never leave phase 1** (`docs/telegram-export.md` §11.4): no output, report
  line or test fixture holds one.
- **Other players teach the wiki, never the owner's state.** Their replies in group exports add
  recipes, items and places, but only the owner's own events change the player state. One exception:
  a fight in which one of the owner's Pakkomon takes part counts for it, whoever started the fight,
  since the fight's reply goes to the player who did.
- **Old data**: group exports span years, and the game and the bot's wording changed over them. An
  attribute keeps the date of the observation that set it, and only a newer one replaces it; never
  assume that an old message format or game state still holds.

## Respect for the game

InventoryBot is meant to be discovered: its own `/faq` invites players to find things out ("Scoprite
quale!") and bans cheating (multiple accounts, scripts that automate adventures, exploiting bugs).
This project must stay on the right side of that.

- **A personal tool, not a public wiki.** The pipeline turns a player's own exports into a page for
  that player. Nothing generated from an export is ever committed, published or shared; each player
  builds their own.
- **The encyclopedia channels are the game's own help.** The bot's `/gruppi` points every player to
  three channels that describe recipes, items and places (`docs/channels.md`). They no longer allow
  exporting, so nothing a player sees suggests it any more; a player may still add an export made
  before, like any chat of theirs: the project reads what the player can already read there, and
  changes how fast they find it, not what they may know. Their cards stay apart from the bot's
  observations (each with its channel and date), and the same rules hold: nothing generated from
  them is committed or published, and the repository holds none of their content.
- **Read-only.** Nothing in this project sends messages to the bot or automates play. Do not add
  features that interact with Telegram or the bot.
- **No spoilers in the repository.** Docs and tests describe the bot's message formats and the
  game's mechanics, but never real game content that players are meant to discover: real recipes and
  their ingredients or outputs, which item unlocks which place, where exclusive items drop, real
  item, recipe and place names. Public facts the bot itself tells every player (the `/faq` legend
  and rules, command names, fixed reply texts) are fine.
  - **One exception:** `src/web/demo-chat.ts`, the web app's example, holds real game content, which
    `check:universe` skips: what a player who has just started learns in an evening, a few level-1
    recipes of common items that drop everywhere (none made, so no output), one of each item, and
    the places a new player's `/viaggio` lists on the road from the village to the plain (no secret
    place). Nothing else holds real game content.
  - Examples use the invented world of [scripts/universe.md](scripts/universe.md), in the real
    format: take names from it, and when a new test case or example needs a new item, recipe, place
    or Telegram username, invent one and add it there in the same change. Real usernames are worse
    than real items: they identify people.
  - This is enforced, not left to judgement: `npm run check:universe` (`scripts/check-universe.ts`,
    run by `validate`, `ci` and GitHub CI) fails on any entity, found where the bot's reply formats
    put one or in the item tuples of the tests' reply builders, and on any `@username`, that is not
    in the universe. Do not try to decide by eye whether a name is real; the author reviews
    additions to the universe.
- **Group history is other players' discoveries.** Using it for one's own page is what any member
  can do by scrolling the group; publishing it is not. Keep it out of anything shared.
- **Group exports are supported, never suggested.** The pipeline reads them, but nothing a player
  sees (the web app, `README.md`) mentions, encourages or explains exporting a group: they export
  their chat with the bot. This holds until the game's author says otherwise. Developer docs
  (`CLAUDE.md`, `docs/`) still describe group exports.
- **The published page is the tool, never data.** GitHub Pages serves the web app, published from
  the release tags of `main` by the CI workflow; the repository and the page contain no game
  content, other than the bot's own profile picture (`src/web/avatar.png`), its public branding,
  which the game's author may still revisit. Each player's wiki is built in their own browser from
  their own exports and stays there (the page cannot connect anywhere). Nothing generated from an
  export is ever part of the published site.
- **The game's author has the last word.** The game's author will be contacted about this project;
  if their answer sets conditions (for example on group history or on what may be published), they
  override these rules and this section is updated.

## Conventions

- **Language**: authors and contributors work in English, so everything for developers is in
  English: code, comments, tests, commit messages, `CLAUDE.md` and `docs/`. The game is Italian, and
  so are its players: everything they see is in Italian, including the end-user documentation
  (`README.md`), messages and the web app.
- **Node.js 24**, pinned in `.nvmrc`; `engines` in `package.json` matches it.
- **No build step.** Node runs the `.ts` sources directly by stripping types, and `tsc` only
  type-checks (`noEmit`). So imports use `.ts` extensions, and only erasable TypeScript syntax is
  allowed (no enums, namespaces or constructor parameter properties).
- **Strict TypeScript**, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **Imports**: ESLint owns their style, and `npm run lint:fix` normalizes them (sorted in one group,
  inline `type` specifiers, unused ones removed). Import across directories through the `#src/*`
  alias (`package.json` `imports`), never with `../`.
- **Formatting**: Prettier, for every file it supports, including Markdown, whose prose is wrapped
  at 100 columns (`proseWrap: "always"`), so every text has one canonical form.
- **Tests** sit next to the code they test (`foo.ts`, `foo.test.ts`) and run with Vitest. Helpers
  shared by several tests live in `test/` and are imported through the `#test/*` alias; production
  code never imports them (ESLint rejects it), so it can be shipped without them. Coverage of `src/`
  must stay at or above 90% on statements, branches, functions and lines. Test data is synthetic:
  tests never read real exports. A known misbehaviour gets an `it.fails` test asserting the correct
  behaviour, which becomes a plain `it` with the fix.
- **Golden outputs**: `src/pipeline.golden.test.ts` runs the whole pipeline on the synthetic
  scenarios of `test/synthetic-exports.ts` (invented data, generated at test time) and compares
  every output byte for byte with `test/golden/`: per scenario, the conversation and the events
  (JSON Lines), the wiki and the player state, the report lines and the outcome. `validate`
  regenerates them (`npm run golden:update`), so they never fail locally: review
  `git diff test/golden/` like code before committing, as every changed line must be explained by
  the change. `ci` and GitHub CI only compare. Never edit or reformat the golden files by hand
  (Prettier ignores them).
- **Dependencies**: as few as possible, each one justified in the commit that adds it, pinned to
  exact versions at least two weeks old in `package.json`, with `package-lock.json` committed.
  `package.json` is the only record of them.
- **Held-back versions**: TypeScript stays on 6.x because typescript-eslint does not support
  TypeScript 7, and ESLint on 9.x because eslint-plugin-import does not support ESLint 10. Upgrade
  once they do.
