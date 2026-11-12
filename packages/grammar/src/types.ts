/**
 * The events of InventoryBot's replies: what the classifier (classify.ts) reads each bot
 * reply as. Field names and key order are those of the JSON form (snake_case); each
 * classifier builds its event with the keys in the order listed here, so that serialising
 * events gives byte-identical output from run to run. The wiki's event records and its
 * outputs build on them (src/inventorybot/types.ts).
 */

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
  /** The wait before the next adventure, in seconds; present when the reply states it (6.3). */
  remaining?: number;
  /** Seconds of the smallest unit the wait shows (1, 60, 3600 or 86400), with `remaining`. */
  precision?: number;
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
  /** Present for the /esporta file: every item the player owns, whatever its command. */
  exported?: true;
}

/** `/titolo`: the title-giving items the player owns (none in the current reply form). */
export interface TitleEvent {
  type: 'title';
  items: ItemLine[];
}

export interface TravelBlockedEvent {
  type: 'travel_blocked';
  location: string;
  /**
   * The places the reply names, each in its article form (`location`, `exits`) mapped to
   * the words the reply wrote it with, preposition included ("nella valle ventosa 🏞").
   */
  written: Record<string, string>;
}

export interface LocationEvent {
  type: 'location';
  location: string;
  exits: string[];
  /**
   * The places the reply names, each in its article form (`location`, `exits`) mapped to
   * the words the reply wrote it with, preposition included ("nella valle ventosa 🏞").
   */
  written: Record<string, string>;
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
  /**
   * The places the reply names, each in its article form (`location`, `exits`) mapped to
   * the words the reply wrote it with, preposition included ("nella valle ventosa 🏞").
   */
  written: Record<string, string>;
}

/**
 * "<item> ti serve per passare <place> sulla via per tornare al villaggio.": the item the
 * place, or one on the way back from it to the village, requires (build.ts resolveRequirements).
 */
export interface TravelRequirementEvent {
  type: 'travel_requirement';
  item: string;
  location: string;
  /**
   * The places the reply names, each in its article form (`location`, `exits`) mapped to
   * the words the reply wrote it with, preposition included ("nella valle ventosa 🏞").
   */
  written: Record<string, string>;
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
  /** The receiver's username; null for a player without a visible one. */
  to: string | null;
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
  /**
   * The item the reply itself names as used, stronger evidence than the command: the
   * sphere a Pakkomon came out of, the Pakkomon equipped, the scanner.
   */
  named?: string;
  /**
   * The items the reply says the use takes besides the item used: the key put in a chest's
   * lock, the items put into a machine, the item a Pakkomon is equipped with.
   */
  takes?: string[];
  /** What the use does to a Pakkomon (docs/bot-protocol.md 6.18), for a use on one. */
  pakkomon_use?: PakkomonUse;
  /** The Pakkomon the use acts on, each by its name and emoji (two for the scale). */
  pakkomon?: string[];
  /** What the use reads: the probe's word, or the scale's verdict (`il primo`, `il secondo`). */
  reading?: string;
  /** The scanner's list: each of the player's Pakkomon and the seconds before it can fight. */
  scan?: PakkomonReadiness[];
}

/** What a use does to a Pakkomon. */
export type PakkomonUse =
  'hatch' | 'equip' | 'scan' | 'heal' | 'power_up' | 'probe' | 'scale' | 'extract' | 'customise';

/** What an item is for, with Pakkomon (docs/bot-protocol.md 6.18). */
export type PakkomonRole =
  | 'sphere'
  | 'equipment'
  | 'scanner'
  | 'heal'
  | 'power_up'
  | 'probe'
  | 'scale'
  | 'extractor'
  | 'customisation';

/** A Pakkomon of the scanner's list, and the seconds before it can fight (0: ready). */
export interface PakkomonReadiness {
  pakkomon: string;
  remaining: number;
}

/** A Pakkomon in a fight: its name and emoji, and its owner's username. */
export interface PakkomonSide {
  pakkomon: string;
  owner: string;
}

/** A fight's reply (6.18): the winner first, the stun its ending phrase states, and what follows. */
export interface PakkomonFightEvent {
  type: 'pakkomon_fight';
  winner: PakkomonSide;
  loser: PakkomonSide;
  /** "colpisce": the winner hit a boss, which stays out until defeated. */
  hit: boolean;
  /** The ending phrase; null when the reply has none. */
  ending: string | null;
  /** The loser's stun, in minutes, that the ending states; null for a phrase not known. */
  stun_min: number | null;
  /** Null without an upper bound, or for a phrase not known. */
  stun_max: number | null;
  /** A special move, as the reply words it ("Di colpo …!"). */
  move: string | null;
  /** The item the winner's owner gets (a hit on a boss, a win over a bot's strongest Pakkomon). */
  prize: ItemLine | null;
  /** The winner learned something. */
  learned: boolean;
  /** The boss's wound after a hit. */
  wound: string | null;
  /** The boss is defeated: each player who fought it, and their number. */
  spoils: { player: string; points: number }[] | null;
}

/** `/usa <pakkomon>`: its record. */
export interface PakkomonRecordEvent {
  type: 'pakkomon_record';
  pakkomon: string;
  wins: number;
  losses: number;
  equipment: ItemLine | null;
  /** Seconds before it can fight (0: ready). */
  stunned_for: number;
  /** The day it was hatched (`YYYY-MM-DD`), and by whom; null when the record does not say. */
  born: string | null;
  maker: string | null;
  /** One icon per power-up received. */
  power_ups: string[];
}

/** `/usa <pakkomon> # ?`: the Pakkomon waits for any challenger. */
export interface PakkomonReadyEvent {
  type: 'pakkomon_ready';
  pakkomon: string;
}

/** `/usa <pakkomon> # @user`: a challenge, to be fought when the other player answers. */
export interface PakkomonChallengeEvent {
  type: 'pakkomon_challenge';
  pakkomon: string;
  opponent: string;
}

/** A fight refused because a Pakkomon is still stunned: the player's, or (null) the opponent's. */
export interface PakkomonStunnedEvent {
  type: 'pakkomon_stunned';
  pakkomon: string | null;
  /** Seconds before it recovers. */
  remaining: number;
}

/** A boss announced to the groups (a broadcast). */
export interface PakkomonBossEvent {
  type: 'pakkomon_boss';
  emoji: string;
}

/** A format of an earlier period, recognised without reading facts (quest offers, parcels...). */
export interface OldFormatEvent {
  type: 'old_format';
  /** Which format (`OLD_FORMATS` in classify.ts), e.g. `quest_completed`, `pakkomon_fight`. */
  format: string;
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
  /** `lottery_winner`, `lottery_consolation`: what the draw gives ("il fantastico Primo Premio della lotteria"). */
  prize?: string;
}

export interface UnknownEvent {
  type: 'unknown';
}

/** What `classify()` returns: one member per event type (`drop` has two kinds). */
/**
 * A recipe card of La Cittadella dei Demiurghi (channels.ts): the recipe, its level, its
 * ingredients, its craft text and output as the channel's curators wrote them, the title
 * the recipe gives, and their notes.
 */
export interface RecipeCardEvent {
  type: 'recipe_card';
  recipe: string;
  level: number;
  ingredients: ItemLine[];
  text: string | null;
  /** The item made; its qty is 1. */
  output: ItemLine | null;
  /** "🎖 TITOLO: @username, il pastore": `il pastore`. */
  title: string | null;
  notes: string[];
}

/**
 * A place card of L'Atlante di Barbabeige (channels.ts): the place, the items found there,
 * the route from the village, the items it takes to enter it and to see it in the travel
 * panel, and the curators' remarks; places in their article form.
 */
export interface PlaceCardEvent {
  type: 'place_card';
  place: string;
  items: ItemLine[];
  /** From the village to the place, both included; empty without a route. */
  route: string[];
  /** Instead of a route ("Utilizzando l'oggetto richiesto per l'accesso…"). */
  route_note: string | null;
  access: ItemLine | null;
  /** The item without which the place is not listed in the travel panel. */
  sight: ItemLine | null;
  /** "Questo è un luogo segreto!": not listed in the travel panel without its items. */
  secret: boolean;
  notes: string[];
}

/**
 * An item card of Il Grimorio del Golem (channels.ts): the item, how it is obtained and
 * what it is for (the curators' text), and what a use does to it.
 */
export interface ItemCardEvent {
  type: 'item_card';
  /** Its rarity is null when the card names two ("[X] / [C]", in `notes`). */
  item: ItemLine;
  obtain: string[];
  /** The UTILIZZO or FUNZIONE section, a line each. */
  usage: string[];
  /** The 🔍 line, on what a use does to the item. */
  effect: string | null;
  /** From `effect`: a use consumes it (true) or leaves it (false). */
  consumed: boolean | null;
  /** From `effect`: the cooldown in seconds (0: none). */
  cooldown: number | null;
  notes: string[];
}

/** An event or guide card of Il Grimorio del Golem: game history and how-tos. */
export interface LoreCardEvent {
  type: 'lore_card';
  title: string;
  text: string;
}

export type Event =
  | RecipeCardEvent
  | PlaceCardEvent
  | ItemCardEvent
  | LoreCardEvent
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
  | PakkomonFightEvent
  | PakkomonRecordEvent
  | PakkomonReadyEvent
  | PakkomonChallengeEvent
  | PakkomonStunnedEvent
  | PakkomonBossEvent
  | MissEvent
  | OldFormatEvent
  | UnknownEvent;

export type EventType = Event['type'];
