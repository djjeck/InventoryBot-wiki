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

## Phase 4: the owner's Pakkomon ✅

The player state lists the owner's Pakkomon (`player-pakkomon.ts`), each followed by name, with its
fights, widest win (the strength estimate the rules allow) and probe reading.

## Phase 5: the Pakkomon tab ✅

The web app has a Pakkomon tab: a guide to how Pakkomon work, then the owner's Pakkomon.

## Closing ⬜

- ⬜ Check the whole on the real exports, then delete this file.
