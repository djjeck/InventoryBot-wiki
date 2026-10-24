/**
 * Phase 5: game events -> objective game wiki; player.ts adds the personal state.
 *
 * The wiki holds only facts about the game, the same for every player:
 *   rarities   rarity legend and game rules, from /faq
 *   items      name, rarity, sources, recipes it is used in / made by, exclusive location
 *   recipes    name, level, ingredients (with quantities), output
 *   locations  exits, whether entry needs an item, unlock texts, exclusive items
 *
 * Adventure flavour text is random and discarded: only the item name and rarity
 * are kept, and the name is isolated by matching against names known from other
 * messages (/esamina, /inventario, recipes...).
 *
 * While merging, events are annotated in place for player.ts:
 *   drop  -> "resolved" (item name), "location" (where the owner was)
 *   craft -> "recipe" (resolved recipe name)
 *   use   -> "used_item"
 *
 * Pure logic only (no Node APIs).
 *
 * Output is deterministic, the same byte for byte from run to run: Maps and Sets keep
 * insertion order, strings sort by code point, lengths and slices count code points,
 * a minimum keeps the first of equal candidates, dates are compared as instants, and
 * report entries print in one fixed form (formatReportEntry).
 */
import { formatIso, isoDateSeconds, localNowIso, parseWindowsDate } from '#src/lib/dates.ts';
import {
  codePointLength,
  compareCodePoints,
  isCombiningMark,
  parseDecimalInt,
  sliceCodePoints,
  splitWords,
  stripEndChars,
  stripWs,
  WORD_BODY,
  WS_CLASS,
} from '#src/lib/text.ts';
import { INVENTORY_COMMANDS, pakkomonItem, parseDuration, useItems } from './classify.ts';
import { itemName, stripAddr } from './patterns.ts';
import { placeLabel, placeName } from './places.ts';
import { type ReportEntry, type ReportKind, reportSections } from './report.ts';
import {
  type BuildEvent,
  type EventRecord,
  type InventoryEvent,
  type TravelRequirementEvent,
  type Wiki,
  type WikiItem,
  type WikiItemCard,
  type WikiItemUse,
  type WikiLocation,
  type WikiOldName,
  type WikiRecipe,
  type WikiTrivia,
} from './types.ts';
import { useShapes } from './use-shapes.ts';

/** Whether an optional string is present and non-empty. */
const truthy = (s: string | null | undefined): s is string =>
  s !== null && s !== undefined && s !== '';

const sortedStrings = (xs: Iterable<string>): string[] => [...xs].sort(compareCodePoints);

const NON_WORD = new RegExp(`[^${WORD_BODY} ]+`, 'gu');
const normCache = new Map<string, string[]>();

/** Words of a name for matching: lower case, accents removed, punctuation as spaces. */
export function norm(s: string): string[] {
  const cached = normCache.get(s);
  if (cached) return cached;
  let out = '';
  for (const ch of s.toLowerCase().normalize('NFKD')) if (!isCombiningMark(ch)) out += ch;
  const words = splitWords(out.replace(NON_WORD, ' '));
  normCache.set(s, words);
  return words;
}

/** Telegram date ("27.11.2025 19:14:19 UTC-05:00") -> ISO 8601 with offset; anything else unchanged. */
export function iso(date: string | null): string | null {
  const d = parseWindowsDate(date);
  return d === null ? date : formatIso(d);
}

/** The argument of a command among `cmds` (`/ricetta torre` -> `torre`), "" without one, null for another command. */
export function queryArg(q: string | null | undefined, ...cmds: string[]): string | null {
  for (const c of cmds) {
    if (truthy(q) && q.toLowerCase().startsWith(c + ' '))
      return stripWs(sliceCodePoints(q, codePointLength(c) + 1));
    if (truthy(q) && q.toLowerCase() === c) return '';
  }
  return null;
}

const instantCache = new Map<string, number>();

/**
 * Seconds since the epoch, so that dates with different UTC offsets compare right
 * (comparing ISO strings does not: 01:00+00:00 sorts before 23:00-05:00 the day before).
 * -Infinity for a missing or unparsable date, so that it sorts before every real one.
 */
export function instant(isoDate: string | null | undefined): number {
  if (typeof isoDate !== 'string') return -Infinity;
  let v = instantCache.get(isoDate);
  if (v === undefined) {
    v = isoDateSeconds(isoDate) ?? -Infinity;
    instantCache.set(isoDate, v);
  }
  return v;
}

/**
 * /inventario arguments that are rarity filters, as verified on the bot: "C" lists C and
 * C+ items, "C+" only C+, "L" every Ln, "L2" only L2. "M" is accepted but always lists nothing.
 * The letter is case-insensitive ("c" is "C", "l1" is "L1"); ASCII letters only.
 */
export const RARITY_FILTER = /^(?:[CNRSXUcnrsxu]\+?|[Ll]\p{Nd}*)(?=\n?$)/u;

export type RarityOf = (name: string) => string | null | undefined;

/**
 * Which unlisted items a /inventario reply proves the player does not have.
 *
 * Returns a predicate on item names, or null when the reply says nothing about
 * unlisted items: it was truncated, its command is unknown (an unmatched group
 * reply), or it used the "M" filter, which does not work in the bot.
 */
export function inventoryScope(
  e: BuildEvent,
  rarityOf: RarityOf
): ((name: string) => boolean) | null {
  if (e.type !== 'inventory' || e.truncated || e.query === null || e.query === undefined)
    return null;
  const raw = stripWs(queryArg(e.query, ...INVENTORY_COMMANDS) || '');
  if (!raw) return () => true;
  if (raw === 'M' || raw === 'm') return null;
  if (RARITY_FILTER.test(raw)) {
    const arg = raw.toUpperCase();
    return (n) => {
      const r = rarityOf(n) || '';
      if (arg === 'L') return r.startsWith('L');
      return arg.endsWith('+') || arg.startsWith('L') ? r === arg : stripEndChars(r, '+') === arg;
    };
  }
  // Text filter: every word must appear in the name, case-insensitively, also inside
  // another word ("otto" lists "un bottone"); "[C]" is text too and matches nothing.
  const words = splitWords(raw.toLowerCase());
  return (n) => {
    const lower = n.toLowerCase();
    return words.every((w) => lower.includes(w));
  };
}

/** "+" rarity (C+, N+, R+): the item drops in a single location (per the bot's /faq). */
export function isExclusive(rarity: string | null): boolean {
  return truthy(rarity) && rarity.endsWith('+');
}

// ---- the knowledge base ---------------------------------------------------------------

/** Date of the observation that set each attribute. */
type Dates = Partial<Record<'rarity' | 'ingredients' | 'output', string | null>>;

export interface KbItem {
  name: string;
  rarity: string | null;
  usable: boolean;
  sources: Set<string>;
  used_in: Set<string>;
  made_by: Set<string>;
  last_seen: string | null;
  /** Where it is found: the owner's drops and the channels' place cards; only exported for exclusive items. */
  dropLocations: Set<string>;
  firstSeen: string | null;
  /** The events that named it (KB.event), each once: its observations. */
  seenIn: Set<object>;
  dates: Dates;
  use?: WikiItemUse;
  renamedTo?: string;
  oldNames?: WikiOldName[];
  /** Listed by a /titolo reply. */
  givesTitle?: true;
  /** The title it gives, as a channel names it. */
  title?: string;
  /** The channel card behind the item. */
  channel?: Omit<WikiItemCard, 'fields'>;
  sourcesInferred?: true;
}

export interface KbRecipe {
  name: string;
  level: number | null;
  ingredients: Map<string, number> | null;
  ingredients_source: 'detail' | 'craft' | 'channel' | null;
  partial_ingredients: Set<string>;
  output: string | null;
  craft_text: string | null;
  last_seen: string | null;
  firstSeen: string | null;
  /** The events that named it (KB.event), each once: its observations. */
  seenIn: Set<object>;
  dates: Dates;
  levelInferred?: true;
  /** The channel card behind the recipe, and the attributes it still sets. */
  channel?: {
    name: string;
    date: string | null;
    fields: Set<'level' | 'ingredients' | 'output'>;
    notes: string[];
  };
}

export interface KbLocation {
  name: string;
  label: string;
  /** As the bot writes it ("nel bosco …"), from the latest reply naming it, and that reply's date. */
  at: string | null;
  atDate: string | null;
  last_seen: string | null;
  firstSeen: string | null;
  /** The events that named it (KB.event), each once: its observations. */
  seenIn: Set<object>;
  exits: Set<string>;
  /** The date each exit was last seen (KB.exit, KB.listExits). */
  exitDates: Map<string, string | null>;
  /** The date of the latest "Puoi andare verso:" listing of the place, which the exits follow. */
  listedAt: string | null;
  /** Exits a newer listing left out: closed, unless they lead to a secret place (toJson). */
  dropped: Set<string>;
  requires_item: boolean;
  unlock_texts: string[];
  /** Items named by "<item> ti serve per passare <place>" notices, and by place cards. */
  required_items: Set<string>;
  /** Items without which the place is not listed in the travel panel (place cards). */
  sight_items: Set<string>;
  secret?: true;
  /** The channel card behind the place, and what it adds. */
  channel?: { name: string; date: string | null; fields: Set<PlaceCardField>; notes: string[] };
}

/** What a place card adds to a place. */
type PlaceCardField = 'items' | 'route' | 'access' | 'sight' | 'secret';

interface RenameHint {
  old: string;
  new: string;
  recipe: string;
  date: string | null;
}

/** Equality of two ingredient maps (same entries; order does not matter). */
function sameIngredients(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

export class KB {
  readonly items = new Map<string, KbItem>();
  readonly recipes = new Map<string, KbRecipe>();
  readonly locations = new Map<string, KbLocation>();
  /** Report entries by kind, in order of the first entry of each kind (shown in the report). */
  readonly report = new Map<ReportKind, ReportEntry[]>();
  faq: Extract<BuildEvent, { type: 'faq' }> | null = null;
  readonly trivia: WikiTrivia[] = [];
  player: string | null = null;
  /** Ingredient swaps (old item, new item, recipe, date), see detectRenames(). */
  readonly renameHints: RenameHint[] = [];
  /** Old item name -> new item name. */
  readonly renames = new Map<string, string>();
  /**
   * Date of the observation being merged. The game changes over time (groups hold
   * years of history), so every attribute keeps the date that set it and only a newer
   * observation replaces it; entities record when they were last seen.
   */
  now: string | null = null;

  addReport(entry: ReportEntry): void {
    let list = this.report.get(entry.kind);
    if (list === undefined) this.report.set(entry.kind, (list = []));
    list.push(entry);
  }

  /** Whether the current observation may replace obj[key] (and records its date). */
  newer(obj: { dates: Dates }, key: keyof Dates): boolean {
    const cur = obj.dates[key];
    if (
      cur === null ||
      cur === undefined ||
      this.now === null ||
      instant(this.now) >= instant(cur)
    ) {
      obj.dates[key] = this.now;
      return true;
    }
    return false;
  }

  /**
   * The event being read, set with `now`: every entity it names counts it once among its
   * observations, whichever pass names it.
   */
  event: object | null = null;

  touch(obj: { last_seen: string | null; firstSeen: string | null; seenIn: Set<object> }): void {
    if (this.event !== null) obj.seenIn.add(this.event);
    if (truthy(this.now) && (obj.last_seen === null || instant(this.now) > instant(obj.last_seen)))
      obj.last_seen = this.now;
    if (truthy(this.now) && (obj.firstSeen === null || instant(this.now) < instant(obj.firstSeen)))
      obj.firstSeen = this.now;
  }

  item(name: string, rarity: string | null = null, usable: boolean | null = null): KbItem {
    let it = this.items.get(name);
    if (it === undefined) {
      it = {
        name,
        rarity: null,
        usable: false,
        sources: new Set(),
        used_in: new Set(),
        made_by: new Set(),
        last_seen: null,
        dropLocations: new Set(),
        firstSeen: null,
        seenIn: new Set(),
        dates: {},
      };
      this.items.set(name, it);
    }
    this.touch(it);
    if (truthy(rarity) && rarity !== it.rarity) {
      if (truthy(it.rarity))
        this.addReport({
          kind: 'rarity_conflict',
          item: name,
          old: it.rarity,
          new: rarity,
          date: this.now,
        });
      if (this.newer(it, 'rarity')) it.rarity = rarity;
    } else if (truthy(rarity)) {
      this.newer(it, 'rarity');
    }
    if (usable) it.usable = true;
    return it;
  }

  recipe(name: string): KbRecipe {
    let r = this.recipes.get(name);
    if (r === undefined) {
      r = {
        name,
        level: null,
        ingredients: null,
        ingredients_source: null,
        partial_ingredients: new Set(),
        output: null,
        craft_text: null,
        last_seen: null,
        firstSeen: null,
        seenIn: new Set(),
        dates: {},
      };
      this.recipes.set(name, r);
    }
    this.touch(r);
    return r;
  }

  /**
   * An exit from a place, seen now (a move, a blocked attempt, a card's route): kept
   * unless a newer listing of the place's exits left it out.
   */
  exit(from: string, to: string): void {
    const l = this.location(from);
    this.location(to);
    if (l.listedAt !== null && this.now !== null && instant(this.now) < instant(l.listedAt)) return;
    l.exits.add(to);
    l.exitDates.set(to, this.now);
  }

  /**
   * A place's "Puoi andare verso:" listing, all of its exits at the time: the newest
   * listing replaces the exits seen before it, as the map of the game changes (a road
   * can close), while an older one changes nothing. A secret place is listed only to a
   * player who holds its item, so a road to one is not closed by a listing without it.
   */
  listExits(from: string, to: readonly string[]): void {
    const l = this.location(from);
    // The reply names the places, whatever its date.
    for (const x of to) this.location(x);
    if (l.listedAt !== null && (this.now === null || instant(this.now) < instant(l.listedAt)))
      return;
    for (const [x, d] of l.exitDates)
      if (!to.includes(x) && (d === null || this.now === null || instant(d) <= instant(this.now))) {
        l.exits.delete(x);
        l.exitDates.delete(x);
        l.dropped.add(x);
      }
    for (const x of to) {
      l.exits.add(x);
      l.exitDates.set(x, this.now);
      l.dropped.delete(x);
    }
    l.listedAt = this.now;
  }

  /** The place, made if new; `named`: the current event names it, an observation that dates it. */
  location(name: string, named = true): KbLocation {
    let l = this.locations.get(name);
    if (l === undefined) {
      l = {
        name,
        label: placeLabel(name),
        at: null,
        atDate: null,
        exitDates: new Map(),
        listedAt: null,
        dropped: new Set(),
        last_seen: null,
        firstSeen: null,
        seenIn: new Set(),
        exits: new Set(),
        requires_item: false,
        unlock_texts: [],
        required_items: new Set(),
        sight_items: new Set(),
      };
      this.locations.set(name, l);
    }
    if (named) this.touch(l);
    return l;
  }

  /** ingr: item -> qty. The most recent observation wins (recipes can change). */
  setIngredients(
    r: KbRecipe,
    ingr: Map<string, number>,
    source: 'detail' | 'craft' | 'channel'
  ): void {
    const cur = r.ingredients;
    if (cur !== null && !sameIngredients(cur, ingr)) {
      const old = [...cur.keys()].filter((k) => !ingr.has(k));
      const added = [...ingr.keys()].filter((k) => !cur.has(k));
      if (
        old.length === 1 &&
        added.length === 1 &&
        cur.get(old[0] as string) === ingr.get(added[0] as string)
      ) {
        // Same recipe, one ingredient swapped for another in the same quantity:
        // possibly an item renamed by the game (checked in detectRenames).
        this.renameHints.push({
          old: old[0] as string,
          new: added[0] as string,
          recipe: r.name,
          date: this.now,
        });
      } else {
        this.addReport({
          kind: 'ingredient_conflict',
          recipe: r.name,
          source,
          old: record(cur),
          new: record(ingr),
          date: this.now,
        });
      }
    }
    if (this.newer(r, 'ingredients')) {
      r.ingredients = ingr;
      r.ingredients_source = source;
      if (source !== 'channel') r.channel?.fields.delete('ingredients');
    }
  }
}

/** Mimic the bot's lookup: every word of the query appears in the name. */
export function recipeMatch(query: string, names: Iterable<string>): string[] {
  const qw = norm(query);
  if (qw.length === 0) return [];
  const all = [...names];
  const exact = all.filter((n) => {
    const nw = norm(n);
    return nw.length === qw.length && nw.every((w, i) => w === qw[i]);
  });
  if (exact.length > 0) return exact;
  return all.filter((n) => qw.every((x) => norm(n).some((w) => w.startsWith(x) || w.includes(x))));
}

/** Split "A, B, C" respecting recipe names that themselves contain ', '. */
export function splitRecipes(raw: string, known: ReadonlySet<string>): string[] {
  const parts = raw.split(', ');
  const out: string[] = [];
  let i = 0;
  while (i < parts.length) {
    for (let j = parts.length; j > i; j--) {
      const cand = parts.slice(i, j).join(', ');
      if (known.has(cand) || j === i + 1) {
        out.push(cand);
        i = j;
        break;
      }
    }
  }
  return out;
}

/** The fields isMine() reads. */
export interface Addressing {
  player?: string | null | undefined;
  dm?: boolean | undefined;
  forwarded?: boolean | undefined;
  broadcast?: boolean | undefined;
}

/**
 * Whether a bot reply is about the export owner (their moves, holdings, crafts).
 *
 * Addressed replies belong to the @username they name. Unaddressed ones ("Troppo
 * presto", gift notices) are the owner's only in the DM; in a group the conversation
 * phase already attributes them through the matched command when it can. Forwarded bot
 * messages and group broadcasts ("[W]", "[N]") belong to nobody: they did not
 * happen at that time and place.
 */
export function isMine(e: Addressing, player: string | null): boolean {
  if (e.forwarded || e.broadcast) return false;
  if (truthy(e.player)) return e.player === player;
  return Boolean(e.dm);
}

function addQty(c: Map<string, number>, name: string, qty: number): void {
  c.set(name, (c.get(name) ?? 0) + qty);
}

type Drop = Extract<BuildEvent, { type: 'drop' }>;
type Craft = Extract<BuildEvent, { type: 'craft' }>;
type Use = Extract<BuildEvent, { type: 'use' }>;

/**
 * Merges the events (mutated in place, see the module comment) into a knowledge base,
 * for `player`, the export owner decided before anonymisation (src/telegram/conversation/owner.ts).
 */
export function build(events: BuildEvent[], player: string | null): KB {
  const kb = new KB();
  kb.player = player;
  const uses = merge(kb, events, player);
  resolveUses(kb, events, uses);
  detectRenames(kb);
  infer(kb);
  return kb;
}

/**
 * The game's items as the build knows them before resolving uses (names and `usable`):
 * build's merge run on a copy of `events`. Phase 4 reads it to check its /usa pairs
 * (verify.ts); the copy's report entries are discarded.
 */
export function itemCatalogue(events: readonly EventRecord[]): ReadonlyMap<string, KbItem> {
  const kb = new KB();
  merge(kb, structuredClone(events) as BuildEvent[], null);
  return kb.items;
}

/**
 * A name's key for matching names typed by hand with the bot's: whitespace as single
 * spaces, without the emoji variation selector, zero-width joiners, gender signs and skin
 * tones that a hand-typed emoji may add.
 */
export function nameKey(name: string): string {
  return stripWs(
    name
      .normalize('NFC')
      .replace(/\u{FE0F}|\u{200D}|\u{2640}|\u{2642}|[\u{1F3FB}-\u{1F3FF}]/gu, '')
      .replace(new RegExp(`${WS_CLASS}+`, 'gu'), ' ')
  );
}

/**
 * A name -> the first of `known` with its key, else the name itself (as nameKey spaces
 * it); `caseless` compares the keys in lower case (the bot looks names up so).
 */
function canonicalNames(known: Iterable<string>, caseless = false): (name: string) => string {
  const key = (n: string): string => (caseless ? nameKey(n).toLowerCase() : nameKey(n));
  const byKey = new Map<string, string>();
  for (const n of known) if (!byKey.has(key(n))) byKey.set(key(n), n);
  return (name) =>
    byKey.get(key(name)) ?? stripWs(name.replace(new RegExp(`${WS_CLASS}+`, 'gu'), ' '));
}

/**
 * The recipe a channel card describes: the bot's spelling of its name (canonicalNames),
 * or, for a name the bot never wrote (the curators sometimes name a recipe their own
 * way), the one recipe of the bot with exactly the card's ingredients and quantities,
 * from its /ricetta and /esamina details and its crafts named by their command. Else the
 * card's own name.
 */
function cardRecipes(
  events: readonly BuildEvent[],
  botNames: ReadonlySet<string>,
  item: (name: string) => string
): (name: string) => string {
  const canon = canonicalNames(botNames, true);
  const bySig = new Map<string, Set<string>>();
  const add = (name: string | undefined, ingr: Map<string, number>): void => {
    if (name === undefined || ingr.size === 0) return;
    const k = signature(ingr);
    let names = bySig.get(k);
    if (names === undefined) bySig.set(k, (names = new Set()));
    names.add(name);
  };
  const cardSig = new Map<string, string>();
  for (const e of events) {
    const ingr = new Map<string, number>();
    if (e.type === 'recipe_detail') {
      for (const x of [...e.missing, ...e.have]) addQty(ingr, x.name, x.qty);
      add(e.recipe, ingr);
    } else if (e.type === 'craft') {
      for (const x of e.ingredients) addQty(ingr, x.name, x.qty);
      const named = recipeMatch(queryArg(e.query, '/ricetta') ?? '', botNames);
      if (named.length === 1) add(named[0], ingr);
    } else if (e.type === 'recipe_card') {
      for (const x of e.ingredients) addQty(ingr, item(x.name), x.qty);
      if (ingr.size > 0) cardSig.set(canon(e.recipe), signature(ingr));
    }
  }
  return (raw) => {
    const name = canon(raw);
    if (botNames.has(name)) return name;
    const k = cardSig.get(name);
    const same = k === undefined ? undefined : bySig.get(k);
    return same?.size === 1 ? (same.values().next().value as string) : name;
  };
}

/** The item names an event of the bot names (channel cards aside). */
function itemNamesOf(e: BuildEvent): string[] {
  const lines = (xs: readonly { name: string }[] | undefined): string[] =>
    (xs ?? []).map((x) => x.name);
  switch (e.type) {
    case 'inventory':
    case 'title':
    case 'use':
      return lines(e.items);
    case 'recipe_detail':
      return [...lines(e.missing), ...lines(e.have)];
    case 'craft':
      return [...lines(e.ingredients), ...(truthy(e.output) ? [e.output] : [])];
    case 'item_info':
    case 'gift':
    case 'give':
    case 'show':
    case 'item_cooldown':
      return [e.item];
    case 'stats':
      return lines(e.unique_items);
    default:
      return [];
  }
}

/**
 * A recipe card into the knowledge base, with the date of its post: like any other
 * observation, it sets what is unknown or older (KB.newer), never what the bot said later.
 */
function mergeRecipeCard(
  kb: KB,
  e: Extract<BuildEvent, { type: 'recipe_card' }>,
  item: (name: string) => string,
  recipe: (name: string) => string
): void {
  const name = recipe(e.recipe);
  const r = kb.recipe(name);
  const card =
    r.channel ?? (r.channel = { name: e.chat ?? '', date: e.date, fields: new Set(), notes: [] });
  card.date = e.date;
  card.notes = [...e.notes];
  if (r.level === null) {
    r.level = e.level;
    card.fields.add('level');
  }
  const ingr = new Map<string, number>();
  for (const x of e.ingredients) {
    const n = item(x.name);
    ingr.set(n, (ingr.get(n) ?? 0) + x.qty);
    kb.item(n, x.rarity, x.usable).used_in.add(name);
  }
  if (ingr.size > 0) {
    const before = r.ingredients;
    kb.setIngredients(r, ingr, 'channel');
    if (r.ingredients !== before) card.fields.add('ingredients');
  }
  if (e.output !== null) {
    const out = item(e.output.name);
    const it = kb.item(out, e.output.rarity, e.output.usable);
    it.sources.add('recipe');
    it.made_by.add(name);
    if (truthy(e.title)) {
      it.givesTitle = true;
      it.title = e.title;
    }
    if (kb.newer(r, 'output')) {
      r.output = out;
      r.craft_text = e.text;
      card.fields.add('output');
    }
  }
}

/**
 * A place card into the knowledge base: the items found there (exclusive ones, by their
 * "+" rarity), the route from the village as exits, the items it takes to enter the place
 * and to see it, whether it is secret. None of these has a date: a card adds to what the
 * bot showed.
 */
function mergePlaceCard(
  kb: KB,
  e: Extract<BuildEvent, { type: 'place_card' }>,
  item: (name: string) => string,
  place: (name: string) => string
): void {
  const name = place(e.place);
  const loc = kb.location(name);
  const card =
    loc.channel ??
    (loc.channel = { name: e.chat ?? '', date: e.date, fields: new Set(), notes: [] });
  card.date = e.date;
  card.notes = [...(e.route_note === null ? [] : [e.route_note]), ...e.notes];
  for (const x of e.items) {
    const it = kb.item(item(x.name), x.rarity, x.usable);
    it.sources.add('adventure');
    it.dropLocations.add(name);
    card.fields.add('items');
  }
  const route = e.route.map(place);
  for (let i = 1; i < route.length; i++) {
    kb.exit(route[i - 1] as string, route[i] as string);
    card.fields.add('route');
  }
  if (e.access !== null) {
    const n = item(e.access.name);
    kb.item(n, e.access.rarity, e.access.usable);
    loc.requires_item = true;
    loc.required_items.add(n);
    card.fields.add('access');
  }
  if (e.sight !== null) {
    const n = item(e.sight.name);
    kb.item(n, e.sight.rarity, e.sight.usable);
    loc.sight_items.add(n);
    card.fields.add('sight');
  }
  if (e.secret) {
    loc.secret = true;
    card.fields.add('secret');
  }
}

/**
 * Build's passes up to the uses: recipe names, arrivals, the chronological merge, drops
 * and crafts. Returns the /usa replies, for resolveUses.
 */
function merge(kb: KB, events: BuildEvent[], player: string | null): Use[] {
  const mine = (e: BuildEvent): boolean => isMine(e, player);
  for (const e of events) e.date = iso(e.date ?? null);

  // Pass 1: collect recipe names, needed to split "ti serve nelle ricette: A, B".
  const recipeNames = new Set<string>();
  for (const e of events) {
    if (e.type === 'recipe_list') for (const r of e.recipes) recipeNames.add(r.name);
    else if (e.type === 'recipe_detail') recipeNames.add(e.recipe);
    else if (e.type === 'item_info' && truthy(e.from_recipe)) recipeNames.add(e.from_recipe);
  }
  for (const e of events) {
    if (e.type === 'item_info' && truthy(e.used_in_raw))
      for (const n of splitRecipes(e.used_in_raw, recipeNames)) recipeNames.add(n);
  }
  // A channel card names an item or recipe as its curators typed it: the bot's own name,
  // when one matches it (nameKey), is the one kept.
  const itemCanon = canonicalNames(events.flatMap(itemNamesOf), true);
  const recipeCanon = cardRecipes(events, recipeNames, itemCanon);
  const placeCanon = canonicalNames(knownPlaces(events), true);
  for (const e of events) if (e.type === 'recipe_card') recipeNames.add(recipeCanon(e.recipe));

  resolveArrivals(kb, events);

  // Pass 2: chronological merge. The owner's position is followed through /viaggio
  // only to attribute exclusive ("+") drops to a location; other players' moves in
  // a group are ignored.
  const firstLocEv = events.find(
    (e) => (e.type === 'location' || (e.type === 'travel' && e.location !== null)) && mine(e)
  );
  // Adventures before the first /viaggio happened where the first "ti trovi" says
  // (only valid if that first observation was not itself a move).
  let curLoc: string | null =
    firstLocEv && firstLocEv.type === 'location' ? firstLocEv.location : null;

  const drops: [Drop, string | null][] = [];
  const crafts: Craft[] = [];
  const uses: Use[] = [];
  const requirements: TravelRequirementEvent[] = [];
  for (const e of events) {
    kb.now = e.date ?? null;
    kb.event = e;
    const t = e.type;
    // How the bot writes each place a travel reply names: the latest wording wins.
    if ('written' in e)
      for (const [name, words] of Object.entries(e.written)) {
        const l = kb.location(name);
        if (l.atDate === null || kb.now === null || instant(kb.now) >= instant(l.atDate)) {
          l.at = words;
          l.atDate = kb.now;
        }
      }
    // Unique items listed by any player's /stats are items of the game (rarity as shown).
    if (e.type === 'stats')
      for (const x of e.unique_items ?? []) kb.item(x.name, x.rarity, x.usable);
    if (e.type === 'recipe_list') {
      for (const r of e.recipes) {
        const kr = kb.recipe(r.name);
        kr.level = r.level;
        kr.channel?.fields.delete('level');
      }
    } else if (e.type === 'recipe_detail') {
      const r = kb.recipe(e.recipe);
      const ingr = new Map<string, number>();
      for (const it of [...e.missing, ...e.have]) {
        kb.item(it.name, it.rarity, it.usable).used_in.add(r.name);
        addQty(ingr, it.name, it.qty);
      }
      kb.setIngredients(r, ingr, 'detail');
    } else if (e.type === 'item_info') {
      const it = kb.item(e.item, e.rarity, e.usable);
      if (truthy(e.source)) it.sources.add(e.source);
      if (truthy(e.from_recipe)) {
        it.made_by.add(e.from_recipe);
        kb.recipe(e.from_recipe);
      }
      for (const rn of truthy(e.used_in_raw) ? splitRecipes(e.used_in_raw, recipeNames) : []) {
        it.used_in.add(rn);
        kb.recipe(rn).partial_ingredients.add(it.name);
      }
      if (truthy(e.cooldown)) it.usable = true;
    } else if (e.type === 'inventory') {
      for (const x of e.items) kb.item(x.name, x.rarity, x.usable);
    } else if (e.type === 'recipe_card') {
      mergeRecipeCard(kb, e, itemCanon, recipeCanon);
    } else if (e.type === 'place_card') {
      mergePlaceCard(kb, e, itemCanon, placeCanon);
    } else if (e.type === 'item_card') {
      const it = kb.item(itemCanon(e.item.name), e.item.rarity, e.item.usable);
      const { obtain, usage, effect, consumed, cooldown, notes } = e;
      it.channel = {
        name: e.chat ?? '',
        date: e.date,
        notes,
        obtain,
        usage,
        effect,
        consumed,
        cooldown,
      };
    } else if (e.type === 'lore_card') {
      kb.trivia.push({ channel: e.chat ?? '', date: e.date, title: e.title, text: e.text });
    } else if (e.type === 'title') {
      // A fact of the game: these items give a title (whoever owns them).
      for (const x of e.items) kb.item(x.name, x.rarity, x.usable).givesTitle = true;
    } else if (e.type === 'craft') {
      for (const x of e.ingredients) kb.item(x.name, x.rarity, x.usable);
      if (truthy(e.output)) kb.item(e.output).sources.add('recipe');
      crafts.push(e);
    } else if (e.type === 'travel' && e.location === null) {
      // An arrival whose place is not known (reported by resolveArrivals): only its exits are facts.
      for (const x of e.exits) kb.location(x);
    } else if (e.type === 'travel_requirement') {
      kb.location(e.location);
      kb.item(e.item);
      requirements.push(e);
    } else if (
      (e.type === 'travel' || e.type === 'location' || e.type === 'travel_blocked') &&
      !mine(e)
    ) {
      // Another player's move: where they are is not tracked, but the exits listed
      // from a place and the need for an item to enter it are facts of the game.
      const loc = kb.location(e.location as string);
      // A reply listing the exits lists them all (an old arrival has none to list).
      if (e.type !== 'travel_blocked' && e.exits.length > 0) kb.listExits(loc.name, e.exits);
      if (e.type === 'travel_blocked') {
        loc.requires_item = true;
      } else if (e.type === 'travel' && truthy(e.narrative)) {
        loc.requires_item = true;
        if (!loc.unlock_texts.includes(e.narrative)) loc.unlock_texts.push(e.narrative);
      }
    } else if (e.type === 'travel' || e.type === 'location') {
      const loc = kb.location(e.location as string);
      if (e.exits.length > 0) kb.listExits(loc.name, e.exits);
      if (e.type === 'travel' && truthy(e.narrative)) {
        loc.requires_item = true;
        if (!loc.unlock_texts.includes(e.narrative)) loc.unlock_texts.push(e.narrative);
      }
      if (truthy(curLoc) && e.type === 'travel') kb.exit(curLoc, e.location as string);
      curLoc = e.location;
    } else if (e.type === 'travel_blocked') {
      kb.location(e.location).requires_item = true;
      if (mine(e) && truthy(curLoc)) kb.exit(curLoc, e.location);
    } else if (t === 'stats' && truthy(statsField(e, 'luogo')) && mine(e)) {
      curLoc = statsField(e, 'luogo') as string;
      kb.location(curLoc);
    } else if (e.type === 'drop') {
      drops.push([e, mine(e) ? curLoc : null]);
    } else if (e.type === 'gift' || e.type === 'give') {
      kb.item(e.item);
    } else if (e.type === 'show') {
      kb.item(e.item, e.rarity, e.usable);
    } else if (e.type === 'faq') {
      kb.faq = e; // the latest /faq wins
    } else if (e.type === 'use') {
      for (const x of e.items) kb.item(x.name, x.rarity, x.usable);
      uses.push(e);
    }
  }
  kb.event = null;

  resolveDrops(kb, drops);
  resolveCrafts(kb, crafts, recipeNames);
  resolveRequirements(kb, requirements);
  return uses;
}

/** The place the bot calls "il villaggio" ("nel villaggio …"), where every way back ends. */
const VILLAGE = /^il villaggio\b/u;

/**
 * The places from `from` to `to` (both included) along the fewest known exits, or null.
 * An exit is walked both ways: a place listed as an exit of another leads back to it.
 */
function wayBetween(kb: KB, from: string, to: string): string[] | null {
  const next = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    let s = next.get(a);
    if (s === undefined) next.set(a, (s = new Set()));
    s.add(b);
  };
  for (const [n, l] of kb.locations)
    for (const x of l.exits) {
      link(n, x);
      link(x, n);
    }
  const prev = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i] as string;
    if (at === to) {
      const way: string[] = [];
      for (let n: string | null = at; n !== null; n = prev.get(n) ?? null) way.unshift(n);
      return way;
    }
    for (const x of next.get(at) ?? []) {
      if (prev.has(x)) continue;
      prev.set(x, at);
      queue.push(x);
    }
  }
  return null;
}

/**
 * "X ti serve per passare P sulla via per tornare al villaggio": X is needed by P or by a
 * place on the way back from P to the village, and the notice does not say which. X goes
 * to the one place on that way (the village aside) known to need an item, or to P when
 * none is; with several, or no known way back, it is reported and goes nowhere.
 */
function resolveRequirements(kb: KB, notices: readonly TravelRequirementEvent[]): void {
  const village = [...kb.locations.keys()].find((n) => VILLAGE.test(n));
  for (const e of notices) {
    const way = village === undefined ? null : wayBetween(kb, e.location, village);
    if (way === null) {
      kb.addReport({
        kind: 'unresolved_requirement',
        item: e.item,
        location: e.location,
        reason: 'no_way_back',
      });
      continue;
    }
    // Looking the places up observes nothing: it neither counts nor dates them.
    const needing = way.filter((n) => n !== village && kb.location(n, false).requires_item);
    if (needing.length > 1) {
      kb.addReport({
        kind: 'unresolved_requirement',
        item: e.item,
        location: e.location,
        reason: 'several',
      });
      continue;
    }
    const loc = kb.location(needing[0] ?? e.location, false);
    loc.requires_item = true;
    loc.required_items.add(e.item);
  }
}

/** Every place an event names: where the player is or goes, the exits, refusals, /stats, requirement notices. */
function knownPlaces(events: readonly BuildEvent[]): Set<string> {
  const out = new Set<string>();
  const add = (n: string | null | undefined): void => {
    if (truthy(n)) out.add(n);
  };
  for (const e of events) {
    if (e.type === 'location' || e.type === 'travel') {
      add(e.location);
      for (const x of e.exits) add(x);
    } else if (e.type === 'travel_blocked' || e.type === 'travel_requirement') {
      add(e.location);
    } else if (e.type === 'stats') {
      add(statsField(e, 'luogo'));
    }
  }
  return out;
}

/**
 * Arrivals whose reply does not delimit the place (narrated through an item): the
 * place is the longest ending of the narrative (a final full stop aside), on a word
 * boundary, that is a known place in its article form (places.ts); the
 * narrative keeps the text before it (the unlock text). Places named anywhere in the
 * events count, also later ones. Otherwise the arrival is reported and its place stays null.
 */
function resolveArrivals(kb: KB, events: BuildEvent[]): void {
  const pending = events.filter(
    (e): e is Extract<BuildEvent, { type: 'travel' }> => e.type === 'travel' && e.location === null
  );
  if (pending.length === 0) return;
  const known = knownPlaces(events);
  for (const e of pending) {
    // A full stop may follow the place ("… arrivi nella baia di Scogliola 🦀.").
    const text = stripWs(e.narrative ?? '').replace(/\.$/u, '');
    // The text's endings after a space, longest first, in their article form.
    let start: number | null = null;
    for (let i = 0; i >= 0; i = text.indexOf(' ', i) + 1 || -1) {
      if (known.has(placeName(text.slice(i)))) {
        start = i;
        break;
      }
    }
    if (start !== null) {
      e.location = placeName(text.slice(start));
      e.narrative = stripWs(text.slice(0, start)) || null;
      e.written = { ...e.written, [e.location]: text.slice(start) };
    } else {
      kb.addReport({
        kind: 'unresolved_travel',
        query: e.query,
        text: sliceCodePoints(text, 0, 80),
      });
    }
  }
}

/** A free-form field of a /stats event (other event types have none). */
function statsField(e: BuildEvent, key: string): string | undefined {
  const v = e.type === 'stats' ? (e as Record<string, unknown>)[key] : undefined;
  return typeof v === 'string' ? v : undefined;
}

function resolveDrops(kb: KB, drops: readonly [Drop, string | null][]): void {
  // Longest first (code points); equal lengths keep insertion order (stable sort).
  const byLength = (xs: Iterable<string>): string[] =>
    [...xs]
      .map((n) => ({ n, len: codePointLength(n) }))
      .sort((a, b) => b.len - a.len)
      .map((x) => x.n);
  const names = new Set(kb.items.keys());
  // The longest known name that ends `raw` after a space or a line break, or is all of it.
  const knownSuffix = (raw: string): string | undefined => {
    for (let i = -1; ;) {
      const n = raw.slice(i + 1);
      if (names.has(n)) return n;
      i = raw.slice(i + 1).search(/[ \n]/u);
      if (i < 0) return undefined;
      i += raw.length - n.length;
    }
  };
  const templates = new Set<string>(); // the use templates seen
  const pending: [Drop, string | null][] = [];

  const record = (e: Drop, loc: string | null, name: string): void => {
    e.resolved = name;
    e.location = loc;
    const it = kb.item(name, e.rarity, e.usable);
    if (e.kind === 'adventure') it.sources.add('adventure');
    if (truthy(loc)) {
      it.dropLocations.add(loc);
      kb.location(loc, false); // where the owner was, which the drop does not name
    }
  };

  for (const [e, loc] of drops) {
    kb.now = e.date;
    kb.event = e;
    if (e.kind === 'lucky') {
      record(e, loc, e.item);
      continue;
    }
    const raw = e.raw;
    const name = knownSuffix(raw);
    // Below, an empty name or prefix counts as not found.
    if (truthy(name)) {
      templates.add(raw.slice(0, raw.length - name.length));
      record(e, loc, name);
    } else {
      pending.push([e, loc]);
    }
  }
  kb.event = null;
  // Unknown items: strip the longest flavour prefix already seen with a known item.
  const tpl = byLength(templates);
  for (const [e, loc] of pending) {
    kb.now = e.date;
    kb.event = e;
    const raw = (e as Extract<Drop, { kind: 'adventure' }>).raw;
    const pre = tpl.find((p) => raw.startsWith(p) && raw.length > p.length);
    if (truthy(pre)) record(e, loc, itemName(raw.slice(pre.length)));
    else kb.addReport({ kind: 'unresolved_drop', text: raw });
  }
  kb.event = null;
}

export const UNNAMED_PREFIX = '(ricetta senza nome) → ';

/** An ingredient multiset as a Map key: the same for the same names and quantities in any order. */
function signature(ingr: ReadonlyMap<string, number>): string {
  return JSON.stringify([...ingr].sort((a, b) => compareCodePoints(a[0], b[0])));
}

function intersect(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  return new Set([...a].filter((x) => b.has(x)));
}

function resolveCrafts(kb: KB, crafts: readonly Craft[], recipeNames: ReadonlySet<string>): void {
  // Signature (ingredient multiset) -> recipe, from /ricetta & /esamina details.
  const sig = new Map<string, Set<string>>();
  for (const r of kb.recipes.values()) {
    if (r.ingredients !== null && r.ingredients.size > 0) {
      const k = signature(r.ingredients);
      let s = sig.get(k);
      if (s === undefined) sig.set(k, (s = new Set()));
      s.add(r.name);
    }
  }
  for (const e of crafts) {
    kb.now = e.date;
    kb.event = e;
    const ingr = new Map<string, number>();
    for (const x of e.ingredients) addQty(ingr, x.name, x.qty);
    const q = queryArg(e.query, '/ricetta') || '';
    const cands = new Set(recipeMatch(q, recipeNames));
    const bySig = sig.get(signature(ingr)) ?? new Set<string>();
    // Output -> recipes as known now: details, plus the crafts resolved before this one
    // (named recipes only: an unnamed entry is not a recipe link).
    const made = e.output === null ? undefined : kb.items.get(e.output)?.made_by;
    const byOut = new Set([...(made ?? [])].filter((n) => !n.startsWith(UNNAMED_PREFIX)));
    let name: string | null = null;
    for (const c of [intersect(cands, bySig), bySig, intersect(cands, byOut), byOut, cands]) {
      if (c.size === 1) {
        name = c.values().next().value as string;
        break;
      }
    }
    if (!truthy(name)) {
      // Ingredients and output are known, the recipe name is not (e.g. another
      // player's craft whose command was not matched): keep it as its own entry.
      kb.addReport({ kind: 'unnamed_recipe', query: e.query, output: e.output });
      name = `${UNNAMED_PREFIX}${e.output || '?'}`;
    }
    e.recipe = name;
    const r = kb.recipe(name);
    kb.setIngredients(r, ingr, 'craft');
    for (const x of ingr.keys()) (kb.items.get(x) as KbItem).used_in.add(name);
    if (truthy(r.output) && truthy(e.output) && r.output !== e.output) {
      kb.addReport({
        kind: 'output_conflict',
        recipe: name,
        old: r.output,
        new: e.output,
        date: e.date,
      });
    }
    if (truthy(e.output) && kb.newer(r, 'output')) {
      r.output = e.output;
      r.craft_text = e.flavor;
      r.channel?.fields.delete('output');
    }
    if (truthy(e.output)) (kb.items.get(e.output) as KbItem).made_by.add(name);
  }
  kb.event = null;
}

/**
 * /usa replies dropped before resolving uses: the item was not found, not named or
 * ambiguous ("troppi oggetti trovati con quel nome(ARG)"), or not usable at all ("non
 * puoi usare quell'oggetto.."), the argument was no player nor item of the player's, or
 * too long, or the use was refused without saying anything about the
 * item (still cooling down, any duration; the capsule's destination is not a known place).
 * None of them is what a use does.
 */
const USE_NOISE: readonly (string | RegExp)[] = [
  'non hai niente del genere',
  'si ma cosa vuoi usare',
  "non puoi usare quell'oggetto",
  // The argument, echoed before these, is neither a player nor an item of the player's.
  "non e' un utente e non hai oggetti del genere",
  "non e' ne un utente ne un oggetto in tuo possesso",
  /^Troppo (?:lungo|corto) vecchio\.\.\.\s*$/u,
  /^Esiste gia\.\.\.\s*$/u,
  // How to use the item, when its argument is not understood.
  /^utilizzo:\s*\n/u,
  'deve raffreddarsi ancora per',
  'non conosci nessun luogo con quel nome',
  'troppi oggetti trovati con quel nome',
  // The item's argument missing (the bot asks for it), or not found.
  'su che Pakkomon vuoi usarlo?',
  'a chi lo vuoi tirare?',
  'dove vuoi teletrasportarti?',
  "Non e' un pakkomon!",
  'non hai nessun oggetto con quel nome',
  'nessun oggetto trovato con quel nome',
  'non conosco nessuno con quel nome',
  'troppi luoghi trovati con quel nome',
  // The bot's own errors, and a player not registered yet.
  /^qualcosa e' andato storto\.\./iu,
  'per giocare con me devi prima registrarti',
];
/** /usa replies where the use failed for a reason worth keeping (a requirement). */
export const USE_FAILED: readonly (string | RegExp)[] = [
  'non hai la chiave giusta',
  'non le hai ancora tutte',
  'non puoi teletrasportarti in quei luoghi',
  // A player named by the argument (echoed before these) lacks what the use needs.
  ' non ha un walkie talkie',
  " non e' un nuovo arrivato",
  // A Pakkomon that cannot take the use.
  "quel pakkomon ha gia' bevuto",
  'i pakkomon boss vanno sfidati in Arena',
  // What the use needs from the player: items, their number or rarity, an ability.
  'non hai abbastanza ',
  'devi introdurre esattamente ',
  "gli oggetti inseriti devono essere tutti della stessa rarita'",
  /^Rarità ammesse: /u,
  'non ti senti in grado di ',
];

const hasAny = (text: string, keys: readonly (string | RegExp)[]): boolean =>
  keys.some((k) => (typeof k === 'string' ? text.includes(k) : k.test(text)));
export const isFailedUse = (text: string): boolean => hasAny(text, USE_FAILED);

const DIGITS = /\p{Nd}+/gu;

/** Reply shape (first line, numbers blanked), used to attribute ambiguous /usa queries. */
export function useTemplate(text: string): string {
  const i = text.indexOf('\n');
  return (i < 0 ? text : text.slice(0, i)).replace(DIGITS, 'N');
}

/**
 * Items a /usa query can name: those its part before "#" names, the item's argument
 * following it ("/usa caps # palude", "/usa idea # N <name>"), which may name other
 * items. Without "#", trailing words are dropped one by one until something matches.
 * Usable items come first.
 */
export function useCandidates(
  items: ReadonlyMap<string, unknown>,
  query: string,
  usable: readonly string[]
): string[] {
  return candidatesOf(namesWithWords([...items.keys()]), namesWithWords(usable), query);
}

/** Names with their words (norm). */
type NamesWithWords = readonly (readonly [string, readonly string[]])[];

const namesWithWords = (names: readonly string[]): NamesWithWords =>
  names.map((n) => [n, norm(n)] as const);

/** The names whose words contain each of `words` (as substrings). */
const fitting = (pool: NamesWithWords, words: readonly string[]): string[] =>
  pool.filter(([, nw]) => words.every((x) => nw.some((w) => w.includes(x)))).map(([n]) => n);

/** useCandidates, on the items' and usable items' names with their words. */
function candidatesOf(all: NamesWithWords, usable: NamesWithWords, query: string): string[] {
  const hash = query.indexOf('#');
  if (hash > 0) {
    const qw = norm(query.slice(0, hash));
    for (const pool of [usable, all]) {
      const c = fitting(pool, qw);
      if (c.length > 0) return c;
    }
    return [];
  }
  let qw = norm(query);
  while (qw.length > 0) {
    for (const pool of [usable, all]) {
      const c = fitting(pool, qw);
      if (c.length > 0) return c;
    }
    qw = qw.slice(0, -1);
  }
  return [];
}

/** Share of a reply shape's observations an item needs to be taken as the item of every reply of that shape. */
export const USE_SHAPE_SHARE = 0.9;

/** Shape -> item -> observations, for the uses whose item is known. */
type ShapeCounts = Map<string, Map<string, number>>;

/** A /usa reply while its item is resolved: the item it is attributed to, once known. */
type UseLike = Pick<Use, 'text' | 'query'> & Partial<Pick<Use, 'named' | 'used_item'>>;

function shapeCounts(uses: readonly UseLike[]): ShapeCounts {
  const out: ShapeCounts = new Map();
  for (const e of uses) {
    if (!truthy(e.used_item)) continue;
    const k = useTemplate(e.text);
    let m = out.get(k);
    if (m === undefined) out.set(k, (m = new Map()));
    m.set(e.used_item, (m.get(e.used_item) ?? 0) + 1);
  }
  return out;
}

/** The item with at least USE_SHAPE_SHARE of the observations (among `among`, when given), or null. */
function dominantItem(
  counts: ReadonlyMap<string, number> | undefined,
  among: ReadonlySet<string> | null = null
): string | null {
  if (counts === undefined) return null;
  const kept = [...counts].filter(([n]) => among === null || among.has(n));
  let total = 0;
  for (const [, c] of kept) total += c;
  const best = kept.find(([, c]) => c >= USE_SHAPE_SHARE * total);
  return total > 0 && best !== undefined ? best[0] : null;
}

/**
 * The successful /usa replies whose item answers with another shape: the item
 * answers with one shape, which it dominates, in USE_SHAPE_SHARE of its successful uses,
 * and this reply has another shape that no item dominates. Their command pairing is
 * contradicted by the reply; verify.ts dissolves such pairs when they were made in a
 * group by sender or as the only candidate. Reads `used_item`, as attributeUses() set it.
 */
export function mispairedUses<U extends UseLike>(uses: readonly U[]): U[] {
  const counts = shapeCounts(uses);
  // item -> its main shape: USE_SHAPE_SHARE of its successful uses, and dominated by it
  const byItem = new Map<string, Map<string, number>>();
  for (const e of uses) {
    if (!truthy(e.used_item) || isFailedUse(e.text)) continue;
    let m = byItem.get(e.used_item);
    if (m === undefined) byItem.set(e.used_item, (m = new Map()));
    const k = useTemplate(e.text);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  const mainShape = new Map<string, string>();
  for (const [item, shapes] of byItem) {
    const s = dominantItem(shapes); // the shape with USE_SHAPE_SHARE of the item's uses
    if (s !== null && dominantItem(counts.get(s)) === item) mainShape.set(item, s);
  }
  return uses.filter((e) => {
    const item = e.used_item;
    if (!truthy(item) || isFailedUse(e.text)) return false;
    const k = useTemplate(e.text);
    const main = mainShape.get(item);
    // A shape another item dominates is moved to that item instead (repairUses).
    return dominantItem(counts.get(k)) === null && truthy(main) && main !== k;
  });
}

/**
 * Successful /usa replies whose attribution is contradicted by their shape: a reply of a
 * shape that another item dominates (USE_SHAPE_SHARE of its observations) moves to that
 * item.
 */
function repairUses(uses: readonly Use[]): void {
  const counts = shapeCounts(uses);
  for (const e of uses) {
    const item = e.used_item;
    if (!truthy(item) || isFailedUse(e.text)) continue;
    const owner = dominantItem(counts.get(useTemplate(e.text)));
    if (owner !== null && owner !== item) e.used_item = owner;
  }
}

/**
 * The /usa replies worth resolving: noise removed (USE_NOISE), each attributed to its
 * item when the reply's name (a sphere's) or the command's query names one; returns the
 * ambiguous ones with their candidates (none when nothing matched).
 */
export function attributeUses<U extends UseLike>(
  items: ReadonlyMap<string, { name: string; usable: boolean }>,
  recorded: readonly U[]
): { uses: U[]; pending: [U, string[]][] } {
  const all = namesWithWords([...items.keys()]);
  const usable = namesWithWords([...items.values()].filter((it) => it.usable).map((it) => it.name));
  const uses = recorded.filter((e) => !hasAny(e.text, USE_NOISE));
  const pending: [U, string[]][] = [];
  // query -> useCandidates: many replies answer the same query
  const byQuery = new Map<string, readonly string[]>();
  const candidates = (q: string): string[] => {
    let c = byQuery.get(q);
    if (c === undefined) byQuery.set(q, (c = candidatesOf(all, usable, q)));
    return [...c];
  };
  for (const e of uses) {
    const q = queryArg(e.query, '/usa', '/use') || '';
    // A reply that names its item (a Pakkomon sphere's) is stronger evidence than the command: the items
    // matching every word of that name (usable ones first), and the query's candidates only without any.
    let c: string[] = [];
    if (truthy(e.named)) {
      const words = norm(e.named);
      c = fitting(usable, words);
      if (c.length === 0) c = fitting(all, words);
    }
    // A Pakkomon the wiki does not know as an item: the command, which names the
    // Pakkomon in short ("/usa cesa # ..."), could only point to another item.
    const unknownPakkomon =
      truthy(e.named) && e.named.startsWith(pakkomonItem('')) && c.length === 0;
    if (c.length === 0 && !unknownPakkomon) c = candidates(q);
    if (c.length > 1) {
      // prefer the item named explicitly in, or sharing most words with, the reply
      const named = c.filter((n) => e.text.includes(n));
      if (named.length > 0) c = named;
    }
    if (c.length > 1) {
      const tw = new Set(norm(e.text));
      const score = new Map(c.map((n) => [n, new Set(norm(n).filter((w) => tw.has(w))).size]));
      const best = Math.max(...score.values());
      c = c.filter((n) => score.get(n) === best);
    }
    if (c.length === 1) e.used_item = c[0] as string;
    else pending.push([e, c]);
  }
  return { uses, pending };
}

function resolveUses(kb: KB, events: BuildEvent[], recorded: readonly Use[]): void {
  const { uses, pending } = attributeUses(kb.items, recorded);
  repairUses(uses);
  const templates = shapeCounts(uses);
  // Still ambiguous ("/usa dado"): take the item with USE_SHAPE_SHARE of the replies of the same shape.
  for (const [e, c] of pending) {
    const t = dominantItem(templates.get(useTemplate(e.text)), c.length > 0 ? new Set(c) : null);
    if (t !== null) e.used_item = t;
    else
      kb.addReport({
        kind: 'unresolved_use',
        query: e.query,
        text: sliceCodePoints(e.text, 0, 80),
      });
  }
  // Replies not recognized at all (no /usa command was matched to them, e.g. in a
  // busy group) are uses too when they have the shape of a known item's replies.
  for (const e of events) {
    if (e.type === 'unknown' && truthy(e.text)) {
      const text = stripAddr(e.text);
      const t = dominantItem(templates.get(useTemplate(text)));
      if (t !== null) {
        // In place: "type" and "text" keep their key positions, "items" and "used_item" are added.
        const u = Object.assign(e, {
          type: 'use',
          text,
          items: useItems(text),
          used_item: t,
        }) as unknown as Use;
        const now = kb.now,
          event = kb.event;
        kb.now = u.date ?? null;
        kb.event = u;
        for (const x of u.items) kb.item(x.name, x.rarity, x.usable);
        kb.now = now;
        kb.event = event;
        uses.push(u);
      }
    }
  }

  const byItem = new Map<string, Use[]>();
  for (const e of uses) {
    if (truthy(e.used_item)) {
      let l = byItem.get(e.used_item);
      if (l === undefined) byItem.set(e.used_item, (l = []));
      l.push(e);
    }
  }
  const consumed = useConsumption(kb, events);
  const cooldowns = cooldownObservations(events);
  // What a reply may name: the items, and the places as the bot writes them.
  const names = {
    items: [...kb.items.keys()],
    places: [...kb.locations.values()].flatMap((l) => (l.at === null ? [l.name] : [l.name, l.at])),
  };
  for (const [name, es] of byItem) {
    const ok = es.filter((e) => !isFailedUse(e.text)).map((e) => e.text);
    const failed = es.filter((e) => isFailedUse(e.text)).map((e) => e.text);
    const distinct = new Set(ok).size;
    // An item the bot was seen using is usable, tagged "[usabile]" or not (a Pakkomon,
    // an item a player equips one with): as an item /esamina shows a cooldown for.
    if (ok.length > 0) (kb.items.get(name) as KbItem).usable = true;
    const ev = consumed.get(name) ?? new Map<string, number>();
    const yes = ev.get('yes') ?? 0;
    const no = ev.get('no') ?? 0;
    if (yes && no) kb.addReport({ kind: 'use_consumption_conflict', item: name, yes, no });
    (kb.items.get(name) as KbItem).use = {
      observations: ok.length,
      shapes: useShapes(ok, names),
      // fixed: every observed use gave the same reply; variable: they differ
      result:
        ok.length === 0 ? null : ok.length === 1 ? 'single' : distinct === 1 ? 'fixed' : 'variable',
      // On conflicting evidence "consumed" wins: an unseen gain (e.g. a level-up reward
      // received in a group) can hide a consumption, while a false "yes" would need an
      // unseen loss of exactly k items in the same interval.
      consumed: yes ? true : no ? false : null,
      // uses backed by before/after counts; both > 0 means some interval had a change
      // the export does not show (e.g. a level-up reward received in a group)
      consumed_evidence: { yes, no },
      requirements: [...new Set(failed)],
    };
    const obs = cooldowns.get(name);
    if (obs !== undefined)
      (kb.items.get(name) as KbItem).use = {
        ...((kb.items.get(name) as KbItem).use as WikiItemUse),
        cooldown: cooldownEstimate(kb, name, obs),
      };
  }
}

/** One cooldown observation: the time left shown (truncated to `precision`), and the time since the player's last use seen. */
interface CooldownObservation {
  remaining: number;
  precision: number;
  elapsed: number;
  /**
   * In the chat of that use, and sooner than the time left (elapsed < remaining): no use
   * can be hidden in between, since the item was still cooling down from the use seen.
   */
  quick: boolean;
}

/**
 * Cooldown observations per item. After a player's successful /usa of an item, the
 * first refusal of that player's next /usa of it ("deve raffreddarsi ancora per R") or
 * the first /esamina of it showing "Raffreddamento: R" gives one observation: R, and the
 * time elapsed since that use. A use by the same player whose item is not resolved
 * forgets that player's last uses (it may have been another use of the item); refusals
 * of /dai and of other players do not count.
 */
function cooldownObservations(events: readonly BuildEvent[]): Map<string, CooldownObservation[]> {
  const out = new Map<string, CooldownObservation[]>();
  // player -> item -> the last successful use not yet observed (instant in µs, chat), or null once observed
  const last = new Map<string, Map<string, { at: number; chat: string | null } | null>>();
  for (const e of events) {
    const p = e.player;
    if (!truthy(p) || e.forwarded || e.broadcast) continue;
    let mine = last.get(p);
    if (mine === undefined) last.set(p, (mine = new Map()));
    if (e.type === 'use') {
      if (!truthy(e.used_item)) {
        if (!hasAny(e.text, USE_NOISE)) mine.clear();
      } else if (!isFailedUse(e.text)) {
        mine.set(e.used_item, { at: instant(e.date), chat: e.chat ?? null });
      }
      continue;
    }
    let item: string | null = null;
    let r: { seconds: number; precision: number } | null = null;
    if (e.type === 'item_cooldown' && e.action === 'use') {
      item = e.item;
      r = { seconds: e.remaining, precision: e.precision };
    } else if (e.type === 'item_info' && truthy(e.cooldown)) {
      item = e.item;
      r = parseDuration(stripEndChars(e.cooldown, '.'));
    }
    if (item === null || r === null) continue;
    const start = mine.get(item);
    if (start === undefined || start === null || start.at === -Infinity) continue;
    const elapsed = instant(e.date) - start.at;
    let l = out.get(item);
    if (l === undefined) out.set(item, (l = []));
    l.push({
      remaining: r.seconds,
      precision: r.precision,
      elapsed,
      quick: start.chat === (e.chat ?? null) && elapsed < r.seconds,
    });
    mine.set(item, null); // one observation per use
  }
  return out;
}

/** Seconds by which elapsed + remaining may fall short of the cooldown, beyond the precision of the time left (latency). */
const COOLDOWN_SLACK = 90;
/** Round values a cooldown snaps to, roundest first (a day ... a minute). */
const COOLDOWN_GRID = [86400, 3600, 1800, 600, 300, 60];

/** The roundest grid step with a multiple in [lo, hi], and how many multiples of it lie there; null under a minute. */
function roundest(lo: number, hi: number): { step: number; value: number; count: number } | null {
  for (const g of COOLDOWN_GRID) {
    const m = Math.ceil(lo / g) * g;
    if (m <= hi) return { step: g, value: m, count: Math.floor(hi / g) - Math.ceil(lo / g) + 1 };
  }
  return null;
}

/**
 * The cooldown as an interval. Each observation bounds it: at least the time left shown,
 * at most elapsed + time left + its precision + COOLDOWN_SLACK (an unseen use in between
 * only makes the real elapsed time shorter). `min` is the largest lower bound, `max` the
 * smallest upper bound (null when they contradict each other: `cooldown_conflict`). A
 * value is fixed only (a) after a quick observation (no unseen use possible, so the
 * cooldown is at least its elapsed + time left): the roundest value in the window, whole
 * seconds under a minute; or (b) when several observations leave exactly one value at the
 * roundest step that fits their common window.
 */
function cooldownEstimate(
  kb: KB,
  name: string,
  obs: readonly CooldownObservation[]
): NonNullable<WikiItemUse['cooldown']> {
  let min = -Infinity;
  let max = Infinity;
  let lo = -Infinity;
  for (const o of obs) {
    min = Math.max(min, o.remaining);
    max = Math.min(max, o.elapsed + o.remaining + o.precision + COOLDOWN_SLACK);
    if (o.quick) lo = Math.max(lo, o.elapsed + o.remaining);
  }
  const quick = lo !== -Infinity;
  lo = Math.max(lo, min);
  if (max < lo) {
    kb.addReport({ kind: 'cooldown_conflict', item: name, min, max, observations: obs.length });
    return { min, max: null, observations: obs.length };
  }
  let seconds: number | null = null;
  const r = roundest(lo, max);
  if (quick) seconds = lo < 60 || r === null ? lo : r.value;
  else if (obs.length >= 2 && r !== null && r.count === 1) seconds = r.value;
  return { ...(seconds !== null && { seconds }), min, max, observations: obs.length };
}

/**
 * Whether /usa consumes the item, from the owner's exact counts around the uses.
 *
 * Between two consecutive exact counts of an item, if the only changes were k
 * uses of it: a drop of k means each use consumed one, no drop means none did.
 * Any other change in between (drop, gift, craft, level-up reward, /usa output)
 * makes that interval unusable. Returns item -> counts of "yes" and "no", whose keys
 * are in the order they were first incremented.
 */
function useConsumption(kb: KB, events: readonly BuildEvent[]): Map<string, Map<string, number>> {
  const player = kb.player;
  const rarityOf: RarityOf = (n) => kb.items.get(n)?.rarity;
  const scopes = new Map<InventoryEvent, ((n: string) => boolean) | null>();

  const count = (e: BuildEvent, n: string): number | null => {
    if (e.type === 'item_info' && e.item === n && e.count !== null) return e.count;
    if (e.type === 'inventory') {
      for (const x of e.items) if (x.name === n) return x.qty;
      let scope = scopes.get(e);
      if (scope === undefined) scopes.set(e, (scope = inventoryScope(e, rarityOf)));
      if (scope && scope(n)) return 0;
    }
    return null;
  };

  const otherChange = (e: BuildEvent, n: string): boolean =>
    (e.type === 'drop' && e.resolved === n) ||
    ((e.type === 'gift' || e.type === 'give') && e.item === n) ||
    (e.type === 'craft' &&
      (e.output === n ||
        (e.level_up_text ?? '').includes(n) ||
        e.ingredients.some((x) => x.name === n))) ||
    (e.type === 'use' && e.items.some((x) => x.name === n));

  const okUse = (e: BuildEvent, n: string): boolean =>
    e.type === 'use' && e.used_item === n && !isFailedUse(e.text);

  const mine = events.filter((e) => isMine(e, player));
  const out = new Map<string, Map<string, number>>();
  const used = new Set<string>();
  for (const e of mine) if (e.type === 'use' && truthy(e.used_item)) used.add(e.used_item);
  for (const n of used) {
    let last: number | null = null;
    let k = 0;
    let dirty = false;
    for (const e of mine) {
      if (okUse(e, n)) {
        k += 1;
      } else if (otherChange(e, n)) {
        dirty = true;
      } else {
        const c = count(e, n);
        if (c === null) continue;
        if (last !== null && k && !dirty) {
          const key = last - c === k ? 'yes' : last === c ? 'no' : null;
          if (key !== null) {
            let ev = out.get(n);
            if (ev === undefined) out.set(n, (ev = new Map()));
            ev.set(key, (ev.get(key) ?? 0) + k);
          }
        }
        last = c;
        k = 0;
        dirty = false;
      }
    }
  }
  return out;
}

/** Rarity codes the /faq does not explain, with the meaning assumed until it does. */
const RARITY_HYPOTHESES: Readonly<Record<string, string>> = {
  M:
    'mitico: più raro di super raro ma non unico, per analogia con altri giochi ' +
    '(es. il mythic rare di Magic). Non confermato dalla /faq',
};

/**
 * Source implied by the rarity class. Ln and X come from the /faq legend; C/N/R/S
 * being adventure drops is observed (no counter-example in the data).
 */
const SOURCE_BY_CLASS: Readonly<Record<string, string>> = {
  C: 'adventure',
  N: 'adventure',
  R: 'adventure',
  S: 'adventure',
  L: 'recipe',
  X: 'special',
};

function rarityClass(rarity: string | null): string {
  const r = stripEndChars(rarity || '', '+');
  return r.startsWith('L') ? 'L' : r;
}

/**
 * Turn ingredient swaps into renames when the evidence agrees.
 *
 * A swap old -> new seen in a recipe is a rename when both items have the same
 * rarity and old is never seen after new first appears. The old name then becomes
 * an alias: recipes, exclusive locations and the owner's counts move to the new
 * name. Otherwise the swap is reported as a recipe change.
 */
function detectRenames(kb: KB): void {
  for (const { old, new: nw, recipe, date } of kb.renameHints) {
    const o = kb.items.get(old);
    const n = kb.items.get(nw);
    const ok =
      o !== undefined &&
      n !== undefined &&
      o.rarity === n.rarity &&
      truthy(o.last_seen) &&
      truthy(n.firstSeen) &&
      instant(o.last_seen) <= instant(n.firstSeen);
    if (!ok) {
      kb.addReport({
        kind: 'ingredient_conflict',
        recipe,
        source: 'swap',
        old_item: old,
        new_item: nw,
        date,
      });
      continue;
    }
    const lastSeen = o.last_seen as string;
    const firstSeen = n.firstSeen as string;
    kb.renames.set(old, nw);
    kb.addReport({ kind: 'renamed_item', old, new: nw, recipe, date });
    o.renamedTo = nw;
    for (const x of o.sources) n.sources.add(x);
    for (const x of o.used_in) n.used_in.add(x);
    for (const x of o.made_by) n.made_by.add(x);
    for (const x of o.dropLocations) n.dropLocations.add(x);
    for (const x of o.seenIn) n.seenIn.add(x);
    if (o.givesTitle) n.givesTitle = true;
    // The old name lives on only inside the new item; toJson() drops its own entry.
    const oldNames = (n.oldNames ??= []);
    oldNames.push({
      name: old,
      last_seen: lastSeen,
      evidence:
        `stessa ricetta (${recipe}) con ${old} sostituito da ${nw}; stessa ` +
        `rarità ${n.rarity ?? 'sconosciuta'}; ${old} non si vede più dal ${sliceCodePoints(lastSeen, 0, 10)}, ` +
        `${nw} compare dal ${sliceCodePoints(firstSeen, 0, 10)}`,
    });
    oldNames.push(...(o.oldNames ?? [])); // names the old item had before it
    // The earlier of the two first sightings; on equal instants the new item's date is kept.
    const other = truthy(o.firstSeen) ? o.firstSeen : firstSeen;
    n.firstSeen = instant(other) < instant(firstSeen) ? other : firstSeen;
    o.used_in = new Set();
    o.made_by = new Set();
    for (const r of kb.recipes.values()) {
      if (r.ingredients !== null && r.ingredients.size > 0 && r.ingredients.has(old)) {
        const m = new Map<string, number>();
        for (const [k, v] of r.ingredients) m.set(k === old ? nw : k, v);
        r.ingredients = m;
      }
      if (r.partial_ingredients.has(old)) {
        r.partial_ingredients.delete(old);
        r.partial_ingredients.add(nw);
      }
      if (r.output === old) r.output = nw;
    }
  }
  // Chains (A -> B, later B -> C): every old name points to the current one.
  for (const old of kb.renames.keys()) {
    const seen = new Set([old]);
    let cur = kb.renames.get(old) as string;
    while (kb.renames.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = kb.renames.get(cur) as string;
    }
    kb.renames.set(old, cur);
  }
}

const LEVEL_RARITY = /^L(\p{Nd}+)$/u;

function infer(kb: KB): void {
  for (const it of kb.items.values()) {
    const implied = SOURCE_BY_CLASS[rarityClass(it.rarity)];
    if (it.sources.size === 0 && implied !== undefined) {
      it.sources.add(implied);
      it.sourcesInferred = true;
    } else if (implied !== undefined && it.sources.size > 0 && !it.sources.has(implied)) {
      kb.addReport({
        kind: 'source_vs_rarity',
        item: it.name,
        rarity: it.rarity,
        sources: sortedStrings(it.sources),
      });
    }
  }
  for (const r of kb.recipes.values()) {
    if (truthy(r.output) && r.level === null) {
      const m = LEVEL_RARITY.exec(kb.items.get(r.output)?.rarity || '');
      if (m) {
        r.level = parseDecimalInt(m[1] as string);
        r.levelInferred = true;
      }
    }
    if (r.ingredients !== null && r.ingredients.size > 0) {
      const ingr = r.ingredients;
      const missing = [...r.partial_ingredients].filter((x) => !ingr.has(x));
      if (missing.length > 0)
        kb.addReport({
          kind: 'partial_not_in_full',
          recipe: r.name,
          missing: sortedStrings(missing),
        });
    }
  }
}

/** The JSON object of a Map with string keys (Object.fromEntries also keeps a "__proto__" key). */
function record<V>(m: Iterable<readonly [string, V]>): Record<string, V> {
  return Object.fromEntries(m) as Record<string, V>;
}

/** The wiki. Also adds `exclusive_in_many_places` to the report. */
export function toJson(kb: KB, generated: string = localNowIso()): Wiki {
  // Only "+" items are tied to a location. Non-exclusive drops were checked to be
  // spread uniformly (same rarity mix everywhere, no item over-represented beyond
  // chance), so where they dropped is not a property of the game.
  const items: [string, WikiItem][] = [];
  for (const [n, it] of kb.items) {
    if (truthy(it.renamedTo)) continue; // merged into the item it was renamed to (see "old_names" there)
    const exclusive = isExclusive(it.rarity);
    const o: WikiItem = {
      name: it.name,
      rarity: it.rarity,
      usable: it.usable,
      sources: sortedStrings(it.sources),
      used_in: sortedStrings(it.used_in),
      made_by: sortedStrings(it.made_by),
      last_seen: it.last_seen,
      observations: it.seenIn.size,
      ...(it.use !== undefined && { use: it.use }),
      ...(it.oldNames !== undefined && { old_names: it.oldNames }),
      ...(it.givesTitle !== undefined && { gives_title: it.givesTitle }),
      ...(it.title !== undefined && { title: it.title }),
      ...(it.channel !== undefined && {
        channel: {
          ...it.channel,
          // The card's rarity, when no observation of the bot's replaced it.
          fields:
            it.dates.rarity === it.channel.date && it.rarity !== null ? ['rarity' as const] : [],
        },
      }),
      ...(it.sourcesInferred !== undefined && { sources_inferred: it.sourcesInferred }),
      exclusive,
      locations: exclusive ? sortedStrings(it.dropLocations) : [],
    };
    if (o.locations.length > 1)
      kb.addReport({ kind: 'exclusive_in_many_places', item: n, locations: o.locations });
    items.push([n, o]);
  }
  const recipes = [...kb.recipes].map(([n, r]): [string, WikiRecipe] => [
    n,
    {
      name: r.name,
      level: r.level,
      ingredients: r.ingredients === null ? null : record(r.ingredients),
      ingredients_source: r.ingredients_source,
      partial_ingredients: sortedStrings(r.partial_ingredients),
      output: r.output,
      craft_text: r.craft_text,
      last_seen: r.last_seen,
      observations: r.seenIn.size,
      ...(r.levelInferred !== undefined && { level_inferred: r.levelInferred }),
      ...(r.channel !== undefined && {
        channel: {
          name: r.channel.name,
          date: r.channel.date,
          fields: (['level', 'ingredients', 'output'] as const).filter((f) =>
            r.channel?.fields.has(f)
          ),
          notes: [...r.channel.notes],
        },
      }),
    },
  ]);
  const exclusiveItems = new Map<string, string[]>();
  for (const [, it] of items) {
    for (const loc of it.locations) {
      let l = exclusiveItems.get(loc);
      if (l === undefined) exclusiveItems.set(loc, (l = []));
      l.push(it.name);
    }
  }
  const locations = [...kb.locations].map(([n, l]): [string, WikiLocation] => [
    n,
    {
      name: l.name,
      label: l.label,
      at: l.at,
      last_seen: l.last_seen,
      observations: l.seenIn.size,
      // A road to a secret place is not closed by a listing without it (KB.listExits).
      exits: sortedStrings([
        ...l.exits,
        ...[...l.dropped].filter((x) => kb.locations.get(x)?.secret),
      ]),
      requires_item: l.requires_item,
      unlock_texts: [...l.unlock_texts],
      required_items: sortedStrings(l.required_items),
      exclusive_items: sortedStrings(exclusiveItems.get(n) ?? []),
      sight_items: sortedStrings(l.sight_items),
      ...(l.secret !== undefined && { secret: l.secret }),
      ...(l.channel !== undefined && {
        channel: {
          name: l.channel.name,
          date: l.channel.date,
          fields: (['items', 'route', 'access', 'sight', 'secret'] as const).filter((f) =>
            l.channel?.fields.has(f)
          ),
          notes: [...l.channel.notes],
        },
      }),
    },
  ]);
  const faqRarities = kb.faq ? kb.faq.rarities : null;
  return {
    generated,
    // From the bot's /faq: rarity codes ("Ln" stands for L1, L2, ...) and game rules.
    rarities: faqRarities ?? {},
    rules: kb.faq ? kb.faq.rules : [],
    trivia: [...kb.trivia],
    // Old item name -> current name, for links and searches by an old name.
    renames: record([...kb.renames].sort((a, b) => compareCodePoints(a[0], b[0]))),
    rarity_hypotheses: record(
      Object.entries(RARITY_HYPOTHESES).filter(
        ([k]) => !faqRarities || !Object.hasOwn(faqRarities, k)
      )
    ),
    items: record(items),
    recipes: record(recipes),
    locations: record(locations),
  };
}

/** The report lines of phase 5, in Italian (call after toJson(), which adds to the report). */
export function reportLines(kb: KB): string[] {
  const recipes = [...kb.recipes.values()];
  const full = recipes.filter((r) => r.ingredients !== null && r.ingredients.size > 0).length;
  const output = recipes.filter((r) => truthy(r.output)).length;
  return [
    `oggetti: ${kb.items.size}; ricette: ${kb.recipes.size} (con tutti gli ingredienti: ${full}, ` +
      `con il risultato noto: ${output}); luoghi: ${kb.locations.size}`,
    ...reportSections([...kb.report.values()].flat()),
  ];
}
