/**
 * The events of InventoryBot's replies: what the classifier (classify.ts) reads each bot
 * reply as, the event records of phase 4 (extract.ts), and the wiki and the player state of
 * phase 5 (build.ts, player.ts). Field names and key order are
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

/** What `/usa` of an item does, from the replies seen (`use` in a wiki item). */
export interface WikiItemUse {
  /** Successful uses seen. */
  observations: number;
  /** Distinct replies of the successful uses, first seen first. */
  outcomes: string[];
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
  /** Present when a channel's card describes the place (channels.ts). */
  channel?: WikiChannelCard<'items' | 'route' | 'access' | 'sight' | 'secret'>;
}

/** The wiki: facts about the game, the same for every player. */
export interface Wiki {
  /** Local time of the run, `2026-10-17T12:00:00+02:00`. */
  generated: string;
  /** Rarity code -> meaning, from the latest /faq. */
  rarities: Record<string, string>;
  rules: string[];
  /** The channels' stories and guides, in post order. */
  trivia: WikiTrivia[];
  /** Old item name -> current name. */
  renames: Record<string, string>;
  /** Rarity codes the /faq does not explain -> assumed meaning. */
  rarity_hypotheses: Record<string, string>;
  items: Record<string, WikiItem>;
  recipes: Record<string, WikiRecipe>;
  locations: Record<string, WikiLocation>;
}

/** How a holding was last set (Italian, shown on the page). */
export type HoldingVia = 'inventario' | 'esamina' | 'ricetta' | 'mostra' | 'dai' | 'movimento';

export interface Holding {
  qty: number;
  /** False when only a lower bound or a change is known. */
  exact: boolean;
  date: string | null;
  via: HoldingVia;
}

/** The player state: the export owner's own state. */
export interface PlayerState {
  player: string | null;
  /** Date of the owner's latest event. */
  as_of: string | null;
  recipes: Record<string, { crafted: number; last_crafted: string | null }>;
  /** Per item: when first seen; `used` and `last_used` only for an item the owner used successfully. */
  items: Record<string, { first_seen: string | null; used?: number; last_used?: string | null }>;
  locations: Record<string, { visited: boolean; adventures: number }>;
  /** The latest /ricetta list: recipe -> `pronta` or `manca N`. */
  /** The latest /ricetta list; `truncated`: it was cut, so a recipe missing from it may still be visible. */
  recipe_list: { date: string | null; truncated: boolean; recipes: Record<string, string> } | null;
  /** Estimated holdings above zero. */
  inventory: Record<string, Holding>;
  /**
   * The recipes of the owner's /ricetta lists (with known ingredients) compared with the
   * estimate of that moment, and those whose missing units it got right.
   */
  inventory_check: { compared: number; agreed: number };
}
