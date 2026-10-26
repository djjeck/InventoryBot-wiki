# Plan: Pakkomon

Pakkomon are a live part of the game, not a format of 2017-2018: fights, challenges, records and
stuns are read today as `old_format` and teach nothing. A Pakkomon is not a wiki item but an
individual creature, with a unique name, an owner who can change (`/dai`), a record, an equipment,
power-ups and a stun. So Pakkomon are the owner's data (player state), shown in a tab of their own,
while the wiki learns only what holds for every Pakkomon: which items act on one and how, and what
fights give. Other players' Pakkomon are not tracked.

The rules of fights can be hardcoded (each side rolls up to its strength plus its equipment's bonus,
the loser's stun is the difference, the ending phrase gives its range, a winner over a stronger base
may learn): the exports confirm them without teaching them. Game content (names of the bot's
Pakkomon and of bosses, prizes, equipment bonuses) is never hardcoded: it comes from the exports,
and tests and docs use the invented world of `scripts/universe.md`.

Delete this file in the closing commit.

## Phase 1: the protocol, documented ✅

`docs/bot-protocol.md` describes Pakkomon as they are today (2.9, 6.18), with the stun range of each
ending phrase.

## Phase 2: the replies, read ✅

Every Pakkomon reply is a typed event (`pakkomon.ts`), and every player it names, in its text or
after a `/usa`'s `#`, is anonymised.

## Phase 3: the wiki without Pakkomon ✅

Every Pakkomon is the wiki's one item `un Pakkomon`; items learn their role with Pakkomon
(`pakkomon_roles`) and fight prizes their opponent (`from_fight`). Known gap: the uses of an item
whose command matches two items and whose reply names neither (`/usa sonda`) stay unresolved.

## Phase 4: the owner's Pakkomon ⬜

Goal: the player state holds the owner's Pakkomon, each with its history.

### 4.1 The owner's Pakkomon ⬜

- ⬜ A Pakkomon of the owner's: name, emoji, how it came (hatched from which sphere, received from
  whom), birth date, given away (to whom, when), record, equipment, power-ups, learnings, last stun,
  last seen.
- ⬜ Which fights count: those in which an owner's Pakkomon fights, whoever challenged (a decision
  for the data rules, to write in `CLAUDE.md`).
- ⬜ Identity by name; a Pakkomon gone without a trace (renamed, extracted) stays with its last
  known state.

### 4.2 Strength estimate ⬜

- ⬜ From the hardcoded rules: lower bounds from the stuns it inflicted, the probe's band, the
  scale's comparisons; shown as a range, never as a value the game gives.

Acceptance: `npm run inspect -- --player <a player with Pakkomon>` lists their Pakkomon with records
that agree with their latest record replies; unit tests on synthetic fights.

## Phase 5: the Pakkomon tab ⬜

Goal: the web app shows the owner's Pakkomon in a tab of their own.

### 5.1 The tab and its pages ⬜

- ⬜ A "Pakkomon" tab, present only with a player state, listing only the owner's Pakkomon (as if
  "Posseduti" were always selected), current ones first.
- ⬜ A Pakkomon's page: its record as the bot would show it, then what the bot does not say
  (history, strength estimate, equipment and power-ups, fights won and lost).
- ⬜ A page on how Pakkomon work: the hardcoded rules, the ending phrases and their stun ranges, the
  items with a Pakkomon role from the wiki.

### 5.2 Docs ⬜

- ⬜ `README.md` (Italian) and `CLAUDE.md` (architecture, data rules) describe the tab and the
  player state's Pakkomon.

Acceptance: checked in a browser with the Arena exports loaded as a player with several Pakkomon.

## Closing ⬜

- ⬜ Check the whole on the real exports, then delete this file.
