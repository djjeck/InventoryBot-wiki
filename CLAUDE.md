# InventoryBot Wiki

A pipeline that rebuilds the recipes, items and places of the Telegram game
[@InventoryBot](https://t.me/InventoryBot) from Telegram Desktop exports of the bot chat, and shows
them in a small static web app. It is written in TypeScript and run with Node.js; end users are
players who run it on their own exports.

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
- [docs/bot-protocol.md](docs/bot-protocol.md): the commands and messages of @InventoryBot, as
  they appear in the export.

**Validate after every edit:**

```bash
source ~/.nvm/nvm.sh && nvm use && npm run validate
```

`validate` applies formatting and lint autofixes, then runs every check. Address all errors before
considering a change complete. It is for local use only: CI (`.github/workflows/ci.yml`, mirrored
by `npm run ci`) runs the same checks without fixing anything, so unfixed problems that were never
committed still fail.

**Stop and wait for review:** After completing each change, stop and wait for author approval
before proceeding. Do not chain changes without an explicit instruction to continue.

## Architecture

The pipeline is a chain of phases, each a function with typed input and output that a caller
runs in order. So far there is phase 1:

1. **Export parsing** (`src/telegram/export/`): Telegram Desktop HTML export pages become
   `Message`s (`src/telegram/messages.ts`), kept in memory. `parsePages` is pure and takes the
   pages as strings; `export-files.ts` finds and reads them on disk (`parseExportPaths`).

The code has two layers. The generic Telegram-bot layer, `src/telegram/` with the utilities of
`src/lib/`, knows nothing about the game: the bot is a parameter (`BotIdentity`,
`src/telegram/bot.ts`), so the layer could serve another bot, and a change in the game's wording
never touches it. Everything about InventoryBot belongs in its own layer, `src/inventorybot/`, and
only the command line, `src/cli.ts`, joins the two. `src/layers.test.ts` fails on any import from
the generic layer into either.

## Conventions

- **Language**: authors and contributors work in English, so everything for developers is in
  English: code, comments, tests, commit messages, `CLAUDE.md` and `docs/`. The game is Italian, and
  so are its players: everything they see is in Italian, including the end-user documentation
  (`README.md`), command line messages and the web app.
- **Node.js 24**, pinned in `.nvmrc`; `engines` in `package.json` matches it.
- **No build step.** Node runs the `.ts` sources directly by stripping types, and `tsc` only
  type-checks (`noEmit`). So imports use `.ts` extensions, and only erasable TypeScript syntax is
  allowed (no enums, namespaces or constructor parameter properties).
- **Strict TypeScript**, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **Imports**: ESLint owns their style, and `npm run lint:fix` normalizes them (sorted in one
  group, inline `type` specifiers, unused ones removed). Import across directories through the
  `#src/*` alias (`package.json` `imports`), never with `../`.
- **Formatting**: Prettier, for every file it supports, including Markdown.
- **Tests** sit next to the code they test (`foo.ts`, `foo.test.ts`) and run with Vitest. Helpers
  shared by several tests live in `test/` and are imported through the `#test/*` alias; production
  code never imports them (ESLint rejects it), so it can be shipped without them. Coverage of
  `src/` must stay at or above 90% on statements, branches, functions and lines.
- **Dependencies**: as few as possible, pinned to exact versions in `package.json`, with
  `package-lock.json` committed. `package.json` is the only record of them.
- **Held-back versions**: TypeScript stays on 6.x because typescript-eslint does not support
  TypeScript 7, and ESLint on 9.x because eslint-plugin-import does not support ESLint 10. Upgrade
  once they do.
