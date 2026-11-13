/**
 * The wiki's types built on the events of the grammar (InventoryBotTron's, whose types it
 * re-exports): the event records of phase 4 (extract.ts), and the wiki and the player state
 * of phase 5 (build.ts, player.ts). Field names and key order are those of the JSON form
 * (snake_case).
 */
import {
  type Event,
  type PakkomonRole,
  type StatsEvent,
  type UnknownEvent,
} from '@inventorybottron/grammar/types.ts';
import { type ReplyContext } from '#src/telegram/conversation/conversation.ts';
import { type MatchKind } from '#src/telegram/conversation/matcher.ts';

export type * from '@inventorybottron/grammar/types.ts';

/**
 * Fields added to every classified event, after its own (same key order): phase 2's
 * ReplyContext, where `match` may also be `dissolved`: phase 2 paired the reply in a
 * group, and phase 4 found the pair inconsistent with the reply (verify.ts), so the
 * event has no `query`.
 */
export type EventContext = Omit<ReplyContext, 'match'> & { match: MatchKind | 'dissolved' | null };

/**
 * An event of phase 4: the event's own fields, then the context; an unknown event also
 * carries the message `text` last.
 */
export type EventRecord =
  | (Exclude<Event, UnknownEvent | StatsEvent> & EventContext)
  | (StatsEvent & Partial<EventContext>)
  | (UnknownEvent & EventContext & { text: string });

// ---- phase 5: the wiki and the player state (build.ts, player.ts) -----------------------

/**
 * An event while phase 5 runs: its date converted to ISO (`iso()`), and annotations
 * added in place for player.ts: a drop gets the item name (`resolved`) and where the
 * owner was (`location`), a craft its recipe name, a /usa reply the item used. An
 * unrecognised reply with the shape of a known /usa reply is turned into a use.
 */
export type BuildEvent =
  | (Extract<EventRecord, { type: 'drop' }> & { resolved?: string; location?: string | null })
  | (Extract<EventRecord, { type: 'craft' }> & { recipe?: string })
  | (Extract<EventRecord, { type: 'use' }> & { used_item?: string })
  | Exclude<EventRecord, { type: 'drop' | 'craft' | 'use' }>;

/**
 * A slot of a use's reply, by what it held: a number (its range, and its decimals), a
 * duration (in seconds), the items, places or Pakkomon named (most frequent first), the
 * symbols of a row like "[🍓🍋💎]"; a player, a text players typed, or a list (the
 * scanner's Pakkomon) only by kind (use-shapes.ts).
 */
export type WikiUseSlot =
  | { kind: 'number'; min: number; max: number; decimals: number }
  | { kind: 'duration'; min: number; max: number }
  /** `counts`: how many of the shape's replies held each item, in the order of `values`. */
  | { kind: 'item'; values: string[]; counts: number[] }
  | { kind: 'place' | 'pakkomon' | 'symbols'; values: string[] }
  | { kind: 'user' | 'text' | 'list' };

/** Replies of a use with the same shape: their text, with slot numbers in place of what varies. */
export interface WikiUseShape {
  /** Fixed text, and the index in `slots` of each varying part. */
  parts: (string | number)[];
  /** The replies it covers. */
  count: number;
  slots: WikiUseSlot[];
}

/** What `/usa` of an item does, from the replies seen (`use` in a wiki item). */
export interface WikiItemUse {
  /** Successful uses seen. */
  observations: number;
  /** The shapes of the successful uses' replies, the most frequent first. */
  shapes: WikiUseShape[];
  /** single: one use seen; fixed: every use gave the same reply; variable: they differ. */
  result: 'single' | 'fixed' | 'variable' | null;
  /** Whether a use consumes the item, from the owner's counts; null when unknown. */
  consumed: boolean | null;
  /** Uses backed by counts before and after them. */
  consumed_evidence: { yes: number; no: number };
  /** Replies of failed uses (a missing requirement). */
  requirements: string[];
  /**
   * The cooldown, from refusals and /esamina times left after a use seen: `min` (the
   * largest time left) and `max` (the smallest elapsed + time left + slack; null when the
   * observations contradict each other), in seconds; `seconds` only when the value is
   * fixed (a quick refusal after a use, or several observations agreeing on one round value).
   */
  cooldown?: { seconds?: number; min: number; max: number | null; observations: number };
}

/** An event of the game that gives items: reaching a level, a lottery draw. */
export type WikiReward = 'level_up' | 'lottery';

/** A name the item had before the game renamed it. */
export interface WikiOldName {
  name: string;
  last_seen: string;
  /** Italian sentence with the evidence for the rename. */
  evidence: string;
}

export interface WikiItem {
  name: string;
  rarity: string | null;
  usable: boolean;
  /** `adventure`, `recipe`, `special`, sorted. */
  sources: string[];
  /** Recipe names, sorted. */
  used_in: string[];
  made_by: string[];
  /**
   * The items whose /usa replies name it without giving it (the chest a key opens, the
   * machine it goes in, the Pakkomon it equips), sorted; only when there are some.
   */
  used_with?: string[];
  /** The items whose /usa gave it (the chest it was in, the machine that made it), sorted; only when there are some. */
  from_use?: string[];
  /** The events of the game that give it: a level-up, a lottery draw; only when there are some. */
  rewards?: WikiReward[];
  /**
   * The Pakkomon whose defeat, or a hit on whom (a boss), gave it, sorted: the bot's own
   * and the bosses; only when there are some.
   */
  from_fight?: string[];
  /** What it is for, with Pakkomon (equipment, healing...), sorted; only when it has a role. */
  pakkomon_roles?: PakkomonRole[];
  last_seen: string | null;
  /** How many observations name it: replies of the bot and channel cards, each once. */
  observations: number;
  use?: WikiItemUse;
  old_names?: WikiOldName[];
  /** Listed by /titolo among the items that give a title. */
  gives_title?: true;
  /** The title it gives ("il pastore"), when a channel names it. */
  title?: string;
  /** Present when a channel's card describes the item (channels.ts). */
  channel?: WikiItemCard;
  /** Present when `sources` was deduced from the rarity. */
  sources_inferred?: true;
  /** A "+" rarity: drops in a single location. */
  exclusive: boolean;
  /** Where it is found (the owner's drops, place cards); only for exclusive items. */
  locations: string[];
}

export interface WikiRecipe {
  name: string;
  level: number | null;
  /** Item name -> quantity, from the latest /ricetta detail or craft. */
  ingredients: Record<string, number> | null;
  ingredients_source: 'detail' | 'craft' | 'channel' | null;
  /** Items known to be ingredients ("ti serve nelle ricette"), sorted. */
  partial_ingredients: string[];
  output: string | null;
  /** Craft text of the latest craft that set the output. */
  craft_text: string | null;
  last_seen: string | null;
  /** How many observations name it: replies of the bot and channel cards, each once. */
  observations: number;
  /** Present when `level` was deduced from the output's `Ln` rarity. */
  level_inferred?: true;
  /** Present when a channel's card describes the recipe (channels.ts). */
  channel?: WikiChannelCard<'level' | 'ingredients' | 'output'>;
}

/** An item card behind an item: what it says, besides the rarity it may still set. */
export interface WikiItemCard extends WikiChannelCard<'rarity'> {
  obtain: string[];
  usage: string[];
  effect: string | null;
  consumed: boolean | null;
  /** Seconds; 0: none. */
  cooldown: number | null;
}

/** A story or guide of a channel (the Grimorio's events and guides). */
export interface WikiTrivia {
  channel: string;
  date: string | null;
  title: string;
  text: string;
}

/**
 * A channel card behind an entity: the channel, the card's date, the attributes it still
 * sets (an observation of the bot's newer than the card replaces it), and the curators'
 * notes.
 */
export interface WikiChannelCard<F extends string> {
  name: string;
  date: string | null;
  fields: F[];
  notes: string[];
}

export interface WikiLocation {
  name: string;
  /** Name without the leading preposition, capitalised. */
  label: string;
  /**
   * The place as the bot writes it, with the preposition of being there ("nel bosco
   * nebbioso di Valtorbo 🌲"), from the latest reply naming it; null if none did.
   */
  at: string | null;
  /** The date of the latest observation naming it. */
  last_seen: string | null;
  /** How many observations name it: replies of the bot and channel cards, each once. */
  observations: number;
  exits: string[];
  requires_item: boolean;
  unlock_texts: string[];
  /** Items the place requires, from the bot's "ti serve per passare" notices and place cards, sorted. */
  required_items: string[];
  exclusive_items: string[];
  /** Items without which the place is not listed in the travel panel, sorted (place cards). */
  sight_items: string[];
  /** Not listed in the travel panel without its items (place cards). */
  secret?: true;
  /**
   * The lowest level of the game at which a player can reach it (levels.ts), when above
   * 0, and what sets it: an item it requires, or the place it is reached through.
   */
  level?: number;
  level_via?: string;
  /** Present when a channel's card describes the place (channels.ts). */
  channel?: WikiChannelCard<'items' | 'route' | 'access' | 'sight' | 'secret'>;
}

/** The wiki: facts about the game, the same for every player. */
export interface Wiki {
  /** Local time of the run, `2026-10-17T12:00:00+02:00`. */
  generated: string;
  /** Rarity code -> meaning (the rarity system of build.ts). */
  rarities: Record<string, string>;
  /** The channels' stories and guides, in post order. */
  trivia: WikiTrivia[];
  /** Old item name -> current name. */
  renames: Record<string, string>;
  items: Record<string, WikiItem>;
  recipes: Record<string, WikiRecipe>;
  locations: Record<string, WikiLocation>;
}

/**
 * The player state (player.ts) is InventoryBotTron's (`@inventorybottron/state`): the owner's
 * state, as its view shows it, and its parts.
 */
export type {
  ViewHolding as Holding,
  HoldingVia,
  PlayerPakkomon,
  PlayerShape,
  PlayerView as PlayerState,
} from '@inventorybottron/state';
