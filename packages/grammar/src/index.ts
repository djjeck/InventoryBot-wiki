/**
 * The module's entry, its public API: InventoryBot's reply grammar, for a program that reads the
 * bot's replies one at a time (a live bot) rather than a whole export. Installed in
 * MegaBotTron1999 as the library module of `module.json`, it is imported by the name the module
 * provides (`@inventorybot-wiki/grammar`).
 *
 * This file is the contract: what it exports keeps its meaning across the module's minor and patch
 * versions, and changes only with a new major version (`version` in `module.json`). Everything
 * else in the repository, the files the module ships included, is internal and may change at any
 * time.
 *
 * The module knows the grammar, never the game: the item names, the sentence prefixes and the
 * titles it resolves against are the caller's (`Knowledge`), as the repository holds no real game
 * content. Pure logic only: no Node APIs, no npm packages.
 */
import { classify } from './classify.ts';
import { type DropKnowledge, type DropResolution, resolveDrop } from './drops.ts';
import { codePointLength } from './lib/text.ts';
import { replyNormalizer } from './titles.ts';

export type {
  AdventureDropEvent,
  CooldownEvent,
  CraftEvent,
  Event,
  EventType,
  GiftEvent,
  GiveEvent,
  InventoryEvent,
  ItemCardEvent,
  ItemCooldownEvent,
  ItemInfoEvent,
  ItemLine,
  LocationEvent,
  LoreCardEvent,
  LuckyDropEvent,
  MissEvent,
  OldFormatEvent,
  PakkomonBossEvent,
  PakkomonChallengeEvent,
  PakkomonFightEvent,
  PakkomonReadiness,
  PakkomonReadyEvent,
  PakkomonRecordEvent,
  PakkomonRole,
  PakkomonSide,
  PakkomonStunnedEvent,
  PakkomonUse,
  PlaceCardEvent,
  RecipeCardEvent,
  RecipeDetailEvent,
  RecipeListEntry,
  RecipeListEvent,
  ShowEvent,
  StatsEvent,
  TitleEvent,
  TravelBlockedEvent,
  TravelEvent,
  TravelRequirementEvent,
  UnknownEvent,
  UseEvent,
} from './types.ts';
export { classify, type DropKnowledge, type DropResolution, resolveDrop };

/** What the caller knows of the game, which the module never ships. */
export interface Knowledge extends DropKnowledge {
  /** The player titles the bot prints after a username ("il fornaio"), in any order. */
  readonly titles?: readonly string[];
}

/**
 * A bot reply as `classify` reads it: the player titles of `known` removed after each username
 * ("@u il fornaio, possiedi:" is "@u, possiedi:"), and the admin's "Sua Maestà" prefix.
 */
export function normalizeReply(text: string, known: Pick<Knowledge, 'titles'>): string {
  // Longest first, so that a title is never cut by a shorter one it starts with.
  const titles = [...(known.titles ?? [])].sort((a, b) => codePointLength(b) - codePointLength(a));
  return replyNormalizer(titles)(text);
}
