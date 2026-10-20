/**
 * The events of InventoryBot's replies: what the classifier (classify.ts) reads each bot
 * reply as, and the event records of phase 4 (extract.ts). Field names and key order are
 * those of the JSON form (snake_case); each classifier builds its event with the keys in
 * the order listed here, so that serialising events gives byte-identical output from run
 * to run.
 */
import { type ReplyContext } from '#src/telegram/conversation/conversation.ts';
import { type MatchKind } from '#src/telegram/conversation/matcher.ts';

/** An item line: `- name [R] [usabile] xN`. */
export interface ItemLine {
  name: string;
  /** Rarity code (`C`, `N+`, `L3`, `X`...), null when the line has none. */
  rarity: string | null;
  usable: boolean;
  /** 1 when the line has no `xN`. */
  qty: number;
}

/** One `- Name L2 [*]` / `- Name L1 [manca 3]` line of a recipe list. */
export interface RecipeListEntry {
  name: string;
  level: number;
  ready: boolean;
  missing: number;
}

/** "Troppo presto...": adventure cooldown. */
export interface CooldownEvent {
  type: 'cooldown';
}

/** "<item> deve raffreddarsi ancora per DURATION prima di poterlo usare / dare in giro": an item still cooling down. */
export interface ItemCooldownEvent {
  type: 'item_cooldown';
  item: string;
  /** What was refused: `/usa` ("usare") or `/dai` ("dare in giro"). */
  action: 'use' | 'give';
  /** Remaining time, in seconds. */
  remaining: number;
  /** Seconds of the smallest unit the duration shows (1, 60, 3600 or 86400). */
  precision: number;
}

export interface RecipeListEvent {
  type: 'recipe_list';
  /** Cut by Telegram's length limit (" TRONCATO!"): later recipes are not listed. */
  truncated: boolean;
  /** The complete lines only. */
  recipes: RecipeListEntry[];
}

export interface RecipeDetailEvent {
  type: 'recipe_detail';
  recipe: string;
  missing: ItemLine[];
  have: ItemLine[];
}

export interface CraftEvent {
  type: 'craft';
  ingredients: ItemLine[];
  /** Text after "Ottieni:", null when the reply has none. */
  output: string | null;
  flavor: string;
  /** Present only after "Hai raggiunto il livello N!". */
  level_up?: number;
  level_up_text?: string;
}

export interface ItemInfoEvent {
  type: 'item_info';
  item: string;
  rarity: string;
  usable: boolean;
  /** "A, B, C" as written: recipe names may contain ", " (split by phase 5, against known recipes). */
  used_in_raw: string | null;
  count: number | null;
  source: 'adventure' | 'special' | 'recipe' | null;
  from_recipe: string | null;
  /** Present only with a "Raffreddamento:" line. */
  cooldown?: string;
}

export interface InventoryEvent {
  type: 'inventory';
  filtered: boolean;
  truncated: boolean;
  items: ItemLine[];
}

/** `/titolo`: the title-giving items the player owns (none in the current reply form). */
export interface TitleEvent {
  type: 'title';
  items: ItemLine[];
}

export interface TravelBlockedEvent {
  type: 'travel_blocked';
  location: string;
}

export interface LocationEvent {
  type: 'location';
  location: string;
  exits: string[];
}

export interface TravelEvent {
  type: 'travel';
  /**
   * The place reached; null when the reply does not delimit it (an arrival narrated
   * through an item without "arrivi:"): phase 5 finds it among the known places at the
   * end of `narrative`, and then sets both fields.
   */
  location: string | null;
  exits: string[];
  /** Arrival text of a place that needs an item; null for the standard arrival. */
  narrative: string | null;
}

/** "<item> ti serve per passare <place> sulla via per tornare al villaggio.": the item a place requires. */
export interface TravelRequirementEvent {
  type: 'travel_requirement';
  item: string;
  location: string;
}

/**
 * `/stats <user>`: one field per `- Name: value` line, keyed by the lower-cased name
 * (`livello`, `luogo`, `avventure`...), in line order, then `unique_items`. A field named
 * `type`, `unique_items` or like a context key (`date`, `player`, `chat`...) is dropped.
 */
export interface StatsEvent {
  type: 'stats';
  /** The item lines after "- Oggetti unici:" (rarity as shown, `U`); present only when the reply has that line. */
  unique_items?: ItemLine[];
  [field: string]: string | ItemLine[];
}

export interface AdventureDropEvent {
  type: 'drop';
  kind: 'adventure';
  /** The narrative before the rarity, addressee removed; the item name is at its end. */
  raw: string;
  rarity: string;
  usable: boolean;
}

export interface LuckyDropEvent {
  type: 'drop';
  kind: 'lucky';
  item: string;
  rarity: string;
  usable: false;
}

export interface GiftEvent {
  type: 'gift';
  from: string;
  qty: number;
  item: string;
}

export interface GiveEvent {
  type: 'give';
  to: string;
  qty: number;
  item: string;
}

export interface ShowEvent {
  type: 'show';
  qty: number;
  item: string;
  rarity: string;
  usable: boolean;
}

export interface UseEvent {
  type: 'use';
  /** The reply minus the addressee. */
  text: string;
  items: ItemLine[];
  /** The item the reply itself names as used (a Pakkomon sphere's reply), for a use without a usable query. */
  named?: string;
}

/** A format of an earlier period, recognised without reading facts (quest offers, parcels, Pakkomon fights...). */
export interface OldFormatEvent {
  type: 'old_format';
  /** Which format (`OLD_FORMATS` in classify.ts), e.g. `quest_completed`, `pakkomon_fight`. */
  format: string;
}

export interface FaqEvent {
  type: 'faq';
  /** Rarity code -> meaning, in legend order. */
  rarities: Record<string, string>;
  rules: string[];
}

/** Help, listings, refusals, not-found replies. */
export interface MissEvent {
  type: 'miss';
  /** Name of the known reply (`KNOWN_REPLIES` in classify.ts), e.g. `dai_not_enough`. */
  reply: string;
  /** Present for replies that only one command produces. */
  command?: string;
  /** `dai_not_enough`: "ne possiedi solo N", the exact count the player owns of the item named by /dai. */
  owned?: number;
}

export interface UnknownEvent {
  type: 'unknown';
}

/** What `classify()` returns: one member per event type (`drop` has two kinds). */
export type Event =
  | CooldownEvent
  | ItemCooldownEvent
  | RecipeListEvent
  | RecipeDetailEvent
  | CraftEvent
  | ItemInfoEvent
  | InventoryEvent
  | TitleEvent
  | TravelBlockedEvent
  | LocationEvent
  | TravelEvent
  | TravelRequirementEvent
  | StatsEvent
  | AdventureDropEvent
  | LuckyDropEvent
  | GiftEvent
  | GiveEvent
  | ShowEvent
  | UseEvent
  | FaqEvent
  | MissEvent
  | OldFormatEvent
  | UnknownEvent;

export type EventType = Event['type'];

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
