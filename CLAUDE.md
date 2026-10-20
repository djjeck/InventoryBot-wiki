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

**Validate after every edit:**

```bash
source ~/.nvm/nvm.sh && nvm use && npm run validate
```

`validate` applies formatting and lint autofixes, then runs every check. Address all errors before
considering a change complete. It is for local use only: CI (`.github/workflows/ci.yml`, mirrored by
`npm run ci`) runs the same checks without fixing anything, so unfixed problems that were never
committed still fail.

**Stop and wait for review:** After completing each change, stop and wait for author approval before
proceeding. Do not chain changes without an explicit instruction to continue.

## Architecture

The pipeline is a chain of phases, each a function with typed input and output that a caller runs in
order. So far there are phases 1 to 4:

1. **Export parsing** (`src/telegram/export/`): Telegram Desktop HTML export pages become `Message`s
   (`src/telegram/messages.ts`), kept in memory. `parsePages` is pure and takes the pages as
   strings. Which files of an export folder are pages is decided by `export-listing.ts`, also pure;
   two adapters list and read them: `browser-files.ts` for the files of a browser folder picker,
   `export-files.ts` on disk (used by the tests).

2. **Conversation** (`src/telegram/conversation/`, `readConversation`): the messages become the
   bot's replies, each paired with the command it answers and the player it concerns. In the DM a
   reply answers the latest command; in a group it is paired with the command it quotes, else the
   addressed player's oldest unanswered command, else the only candidate, within the bot's answer
   window. Display names are mapped to @usernames by voting over the whole chat (opaque sender keys,
   when the export gives them, tell apart people with the same name). Everything that depends on the
   bot's wording comes through a `BotDialect` (`dialect.ts`); the tests use a synthetic one
   (`test/conversation.ts`).

3. **Anonymisation** (`src/telegram/anonymise/`, `anonymise`): the conversation with every other
   player's identity replaced by a pseudonym (`VolpeVeloce`, `GufoGentile`, …), one per person or
   group, never equal to a real username of the run. A pseudonym comes from a hash of the name with
   a secret salt that the caller keeps (the web app keeps one per browser): the same person keeps
   the same pseudonym from run to run, and nobody without the salt can work back to the name, as
   they could from a hash of the name alone. Replaced are the player of each reply, the usernames
   the dialect designates in its text (`userSpans`), usernames in the arguments of commands that
   take a player (`userCommands`), and group titles; every other name in a text is what the bot says
   and stays. The owner, decided just before (`src/telegram/conversation/owner.ts`: the given
   username, else the player the bot addresses most in the DM), the bot and the dialect's
   `publicNames` are kept. Display names never leave this phase.

4. **Interpretation** (`src/inventorybot/extract.ts`, `interpretReplies`): every reply becomes a
   typed event (`src/inventorybot/types.ts`): the classifier (`classify.ts`) reads it with the
   command phase 2 paired it with, following the grammars of `docs/bot-protocol.md`, whose
   `bot-reply` examples are checked against it (`classify.docs-examples.test.ts`). The phase ends by
   verifying the group pairs (`verify.ts`): a reply that, read with its command, is not of that
   command's family is read again without it. A second check, on group `/usa` replies, needs the
   items of phase 5 and comes with it.

Phases 2 to 4 are InventoryBot's through its dialect (`src/inventorybot/dialect.ts`): addressing,
player titles, broadcasts, what anonymisation designates, and which commands can produce each reply
(`compatibleCommands`, from the reply type the classifier gives). `src/pipeline.ts` runs phases 2 to
4 on the messages of phase 1 (`converse`, `interpret`) and words their report lines.

The web app (`src/web/`, `npm run web:dev`) is the interface, published on GitHub Pages by
`.github/workflows/ci.yml` on every push to `main` that passes the checks (`npm run web:build`
builds it into `web-dist/`). The built page carries a Content-Security-Policy that forbids any
network connection, so the browser itself guarantees that the exports are never sent anywhere. The
page (`main.ts`) lets the player pick export folders and runs the pipeline in a Web Worker
(`worker.ts`, `run.ts`), so the page stays responsive; for now it shows a summary of what phases 1
to 4 found. The owner is the player the bot addresses most in the DM; without a DM the run stops and
shows a username field, which the page offers nowhere else. The pseudonyms' salt is made once and
kept in the browser's `localStorage`. `run.ts` uses no browser API and is tested in Node; `main.ts`
and `worker.ts` are browser-only wiring, checked in a browser (type-checked with the DOM types by
`tsconfig.web.json`, and left out of coverage).

The code has two layers. The generic Telegram-bot layer, `src/telegram/` with the utilities of
`src/lib/`, knows nothing about the game: the bot is a parameter (`BotIdentity`,
`src/telegram/bot.ts`), so the layer could serve another bot, and a change in the game's wording
never touches it. Everything about InventoryBot belongs in its own layer, `src/inventorybot/`, and
only `src/pipeline.ts` and the web app, `src/web/`, join the two. `src/layers.test.ts` fails on any
import from the generic layer into either.

## Respect for the game

InventoryBot is meant to be discovered: its own `/faq` invites players to find things out ("Scoprite
quale!") and bans cheating (multiple accounts, scripts that automate adventures, exploiting bugs).
This project must stay on the right side of that.

- **A personal tool, not a public wiki.** The pipeline turns a player's own exports into a page for
  that player. Nothing generated from an export is ever committed, published or shared; each player
  builds their own.
- **Read-only.** Nothing in this project sends messages to the bot or automates play. Do not add
  features that interact with Telegram or the bot.
- **No spoilers in the repository.** Docs and tests describe the bot's message formats and the
  game's mechanics, but never real game content that players are meant to discover: real recipes and
  their ingredients or outputs, which item unlocks which place, where exclusive items drop, real
  item, recipe and place names. Public facts the bot itself tells every player (the `/faq` legend
  and rules, command names, fixed reply texts) are fine.
  - Examples use the invented world of [scripts/universe.md](scripts/universe.md), in the real
    format: take names from it, and when a new test case or example needs a new item, recipe, place
    or Telegram username, invent one and add it there in the same change. Real usernames are worse
    than real items: they identify people.
  - This is enforced, not left to judgement: `npm run check:universe` (`scripts/check-universe.ts`,
    run by `validate`, `ci` and GitHub CI) fails on any entity, found where the bot's reply formats
    put one, and on any `@username`, that is not in the universe. Do not try to decide by eye
    whether a name is real; the author reviews additions to the universe.
- **Group history is other players' discoveries.** Using it for one's own page is what any member
  can do by scrolling the group; publishing it is not. Keep it out of anything shared.
- **The published page is the tool, never data.** GitHub Pages serves the web app, published from
  `main` by the CI workflow; the repository and the page contain no game content. Each player's wiki
  is built in their own browser from their own exports and stays there (the page cannot connect
  anywhere). Nothing generated from an export is ever part of the published site.
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
  must stay at or above 90% on statements, branches, functions and lines.
- **Dependencies**: as few as possible, pinned to exact versions in `package.json`, with
  `package-lock.json` committed. `package.json` is the only record of them.
- **Held-back versions**: TypeScript stays on 6.x because typescript-eslint does not support
  TypeScript 7, and ESLint on 9.x because eslint-plugin-import does not support ESLint 10. Upgrade
  once they do.
