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

## Phase 2: the replies, read ⬜

Goal: every Pakkomon reply is a typed event that names its Pakkomon, owners and outcome, with every
username anonymised.

### 2.1 Fights ⬜

- ⬜ A `pakkomon_fight` event (both wordings): winner and loser with their owners, the ending phrase
  and its stun range, who learned something, the prize (`@u ottiene ITEM!`).
- ⬜ Boss hits as the same event marked as a boss: special move, wound state, defeat and spoils.
- ⬜ The dialect designates the usernames of fights, spoils and boss moves (`userSpans`), so
  anonymisation replaces them.
- ⬜ The boss announcement is a broadcast, not an unknown reply.

### 2.2 Records, challenges, stuns ⬜

- ⬜ Typed events for the record (wins, losses, equipment, readiness or stun, birth date and maker,
  power-up icons), the challenge, the ready and stop replies, and the stun refusal (with its
  duration).
- ⬜ The birth line's maker anonymised.
- ⬜ The `pakkomon_*` old formats removed from `OLD_FORMATS`.

### 2.3 Uses on a Pakkomon ⬜

- ⬜ Recognise the uses that name a Pakkomon (healing, power-ups, probe and its result, scale,
  extractor, heal-all) as uses, the Pakkomon kept apart from the item used.
- ⬜ The scanner's list read as the owner's Pakkomon and their readiness.

Acceptance for each: `classify.docs-examples.test.ts` covers the new formats; golden outputs change
only where Pakkomon replies were `old_format` or `unknown`; on the real exports the count of
unrecognised Pakkomon replies drops to about zero (`npm run inspect`).

## Phase 3: the wiki without Pakkomon ⬜

Goal: no Pakkomon is a wiki item; the wiki learns what acts on any Pakkomon and what fights give.

### 3.1 Pakkomon are not items ⬜

- ⬜ No `un Pakkomon di nome …` item: a sphere gives "a Pakkomon", an item used on one is used with
  "a Pakkomon" (`used_with`), never with a named one.
- ⬜ Inventory and `/ricetta` lists ignore Pakkomon lines for the wiki; the inventory check still
  agrees with the bot.

### 3.2 Items for Pakkomon ⬜

- ⬜ An item learns its role from how it was used on a Pakkomon: equipment, power-up, healing, tool
  (scanner, probe, scale, extractor, kit), sphere.
- ⬜ Fight prizes as a source of the item: beating one of the bot's Pakkomon or hitting a boss (with
  its name, as the replies give it).

Acceptance: on the real exports the wiki has no Pakkomon among its items; the items seen used on
Pakkomon show their role; the golden wiki changes accordingly.

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
