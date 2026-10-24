/**
 * Classification of InventoryBot's replies into typed game events (part of phase 4).
 * The reply formats are docs/bot-protocol.md.
 *
 * Every bot message is classified by its own content (never only by the command
 * that preceded it, since replies can interleave). The command it answers is passed
 * as `query` for context, e.g. to resolve which recipe a successful /ricetta refers
 * to. Unrecognised bot messages become `{"type": "unknown"}` events so that new
 * message formats show up in the report instead of being lost.
 *
 * Pure logic only (no Node APIs). Regular expressions follow patterns.ts.
 */
import {
  parseDecimalInt,
  sliceCodePoints,
  stripStartWs,
  stripWs,
  WORD_BODY,
} from '#src/lib/text.ts';
import {
  A,
  ADDR,
  ADDR_RE,
  D,
  DOT,
  END,
  GIFT,
  GIVE,
  itemName,
  rx,
  S,
  stripAddr,
  W,
} from './patterns.ts';
import { placeName } from './places.ts';
import {
  type CraftEvent,
  type Event,
  type FaqEvent,
  type ItemInfoEvent,
  type ItemLine,
  type MissEvent,
  type OldFormatEvent,
  type RecipeListEntry,
  type StatsEvent,
} from './types.ts';

/** /inventario and its other names (dialect.ts ALIASES). */
export const INVENTORY_COMMANDS: readonly string[] = ['/inventario', '/inventory', '/i'];

const RARITY = `[A-Z]${D}*\\+?`;
// "- un tubetto di colla verde [N] [usabile] x3" (the leading "- " may lack the space; any
// whitespace may stand before the tags)
const ITEM_LINE = rx(
  `^${S}*-${S}?(?<name>${DOT}+?)(?:${S}+\\[(?<rarity>${RARITY})\\])?(?<usable>${S}+\\[usabile\\])?(?:${S}+x(?<qty>${D}+))?${S}*${END}`
);

/** Named groups of a match; groups that did not take part are undefined. */
type Groups = Record<string, string | undefined>;
const groups = (m: RegExpExecArray): Groups => m.groups ?? {};

export function itemFromLine(line: string): ItemLine | null {
  const m = ITEM_LINE.exec(line);
  if (!m) return null;
  const g = groups(m);
  const name = itemName(g['name'] as string);
  // The bot sometimes lists "- " alone: nothing to name.
  if (name === '') return null;
  return {
    name,
    rarity: g['rarity'] ?? null,
    usable: Boolean(g['usable']),
    qty: g['qty'] ? parseDecimalInt(g['qty']) : 1,
  };
}

export function itemLines(lines: readonly string[]): ItemLine[] {
  const out: ItemLine[] = [];
  for (const l of lines) {
    if (!stripStartWs(l).startsWith('-')) continue;
    const it = itemFromLine(l);
    if (it) out.push(it);
  }
  return out;
}

/** Item lines that follow `header` until a non-item line. */
function splitSection(lines: readonly string[], header: string): ItemLine[] {
  const out: string[] = [];
  let on = false;
  for (const l of lines) {
    if (stripWs(l) === header) {
      on = true;
      continue;
    }
    if (on) {
      if (stripStartWs(l).startsWith('-')) out.push(l);
      else break;
    }
  }
  return itemLines(out);
}

function between(lines: readonly string[], start: number, stop: string): string[] {
  const out: string[] = [];
  for (const l of lines.slice(start)) {
    if (stripWs(l) === stop) break;
    out.push(l);
  }
  return out;
}

/** The text after the first `sep` (which must occur in `s`). */
const after = (s: string, sep: string): string => s.slice(s.indexOf(sep) + sep.length);

// ---- classifiers: each returns an event or null -----------------------------------

type Query = string | null;
type Classifier = (t: string, q: Query) => Event | null;

const cTooEarly: Classifier = (t) => (t.startsWith('Troppo presto') ? { type: 'cooldown' } : null);

const DURATION_PART = rx(`^(${D}+) (giorn[oi]|or[ae]|minut[oi]|second[oi])$`);
const UNIT_SECONDS: Readonly<Record<string, number>> = {
  giorn: 86400,
  or: 3600,
  minut: 60,
  second: 1,
};

/**
 * A bot duration ("4 ore e 6 minuti", "2 giorni e 3 ore", "12 secondi") in seconds,
 * with the seconds of its smallest unit (`precision`); null if it is not one.
 */
export function parseDuration(text: string): { seconds: number; precision: number } | null {
  let seconds = 0;
  let precision = Infinity;
  for (const part of stripWs(text).split(/ e |, /u)) {
    const m = DURATION_PART.exec(part);
    if (!m) return null;
    const unit = UNIT_SECONDS[(m[2] as string).slice(0, -1)] as number;
    seconds += parseDecimalInt(m[1] as string) * unit;
    precision = Math.min(precision, unit);
  }
  return { seconds, precision };
}

// Addressed for /usa, not addressed for /dai.
const ITEM_COOLDOWN = rx(
  `^(?:${ADDR.slice(1)})?(?<name>${DOT}+?) deve raffreddarsi ancora per (?<d>${DOT}+?) prima di poterl[oaie] (?<act>usare|dare in giro)(?: di nuovo)?\\.?${S}*${END}`
);

/** A usable item still cooling down, refused to /usa or /dai; recognised from the text alone. */
const cItemCooldown: Classifier = (t) => {
  const m = ITEM_COOLDOWN.exec(t);
  if (!m) return null;
  const g = groups(m);
  const d = parseDuration(g['d'] as string);
  if (!d) return null;
  return {
    type: 'item_cooldown',
    item: itemName(g['name'] as string),
    action: g['act'] === 'usare' ? 'use' : 'give',
    remaining: d.seconds,
    precision: d.precision,
  };
};

/** Commands that produce a known reply: a list, any command, or none (a notice that answers nothing). */
export type Producers = readonly string[] | 'any' | 'none';

interface OldFormat {
  format: string;
  match: RegExp;
  commands: Producers;
  /** Also a /usa reply (the gift parcel; the quest offer of "una pergamena misteriosa"): a use when its command is a /usa. */
  useReply?: true;
}

/**
 * Formats of earlier periods recognised as such, without reading facts from them:
 * quest offers, progress and completion, parcels, the 2017 /nascondi "not found", old
 * /titolo replies, the old inventory header, Pakkomon fights. (The current /preferito,
 * /nascondi and "no quest" replies are in KNOWN_REPLIES.) Before the other classifiers (a quest's "ti manca:" is not a recipe).
 */
const OLD_FORMATS: readonly OldFormat[] = [
  {
    format: 'quest_offer',
    match: rx(`^${A}${DOT}* ti si avvicina per chiederti aiuto![\\s\\S]*\\nGli serve:`),
    commands: 'any',
    useReply: true,
  },
  {
    format: 'quest_missing',
    match: rx(`^${A}non hai ancora tutti gli oggetti necessari per aiutare `),
    commands: ['/quest'],
  },
  {
    format: 'quest_completed',
    match: rx('^Complimenti! Hai trovato tutti gli oggetti!'),
    commands: ['/quest'],
  },
  {
    format: 'found_parcel',
    match: rx(
      `^${A}bravissimo, hai trovato un pacchetto! Tutto contento lo apri e dentro ci trovi:`
    ),
    commands: 'any',
  },
  {
    format: 'gift_parcel',
    match: rx(`^${A}ti accingi ad aprire il tuo pacco eccitato come un bambino a natale`),
    commands: ['/usa'],
    useReply: true,
  },
  {
    format: 'hide_not_found',
    match: rx('^nessuna ricetta trovata con quel nome \\('),
    commands: ['/nascondi'],
  },
  {
    format: 'title_none',
    match: rx(`^${A}${DOT}+ non da nessun titolo\\.\\.`),
    commands: ['/titolo'],
  },
  {
    format: 'title_choice',
    match: rx(`^${A}ti fregi del titolo che si confa' al possessore di `),
    commands: ['/titolo'],
  },
  {
    format: 'inventory_header',
    match: rx(`^Inventario di @${W}+, al ${D}{4}/${D}{2}/${D}{2} ${D}{2}:${D}{2}:${D}{2}`),
    commands: ['/inventario'],
  },
  {
    format: 'pakkomon_fight',
    match: rx(`^(?:\\[N\\] )?(?:${A})?i due pakkomon iniziano a combattere furiosamente`),
    commands: ['/usa'],
  },
  {
    format: 'pakkomon_record',
    match: rx(`^(?:${A})?${DOT}+ ha vinto ${D}+ battaglie e ne ha perse ${D}+\\.`),
    commands: ['/usa'],
  },
  {
    format: 'pakkomon_ready',
    match: rx(`^${A}sei pronto a sfidare chiunque col tuo ${DOT}+ !`),
    commands: ['/usa'],
  },
  {
    format: 'pakkomon_challenge',
    match: rx(`^${A}sfidi @${W}+ a combattere contro il tuo `),
    commands: ['/usa'],
  },
  {
    format: 'pakkomon_stunned',
    match: rx(
      `^${A}(?:il pakkomon del tuo avversario e' ancora rintronato per |${DOT}+ e' ancora rintronato dall'ultimo combattimento)`
    ),
    commands: ['/usa'],
  },
];

const OLD_BY_FORMAT: ReadonlyMap<string, OldFormat> = new Map(
  OLD_FORMATS.map((o) => [o.format, o])
);

const isUseQuery = (q: Query): boolean =>
  q !== null && (q.startsWith('/usa') || q.startsWith('/use'));

const cOldFormat: Classifier = (t, q) => {
  const o = OLD_FORMATS.find((x) => x.match.test(t));
  if (o === undefined || (o.useReply && isUseQuery(q))) return null;
  return { type: 'old_format', format: o.format };
};

// "lanci la tua ITEM, si apre a mezz'aria ed esce un Pakkomon di nome NAME [R]!"
const PAKKOMON_SPHERE = rx(
  `${ADDR}lanci la tua (?<item>${DOT}+?), si apre a mezz'aria ed esce (?<name>un Pakkomon di nome ${DOT}+?) \\[(?<r>${RARITY})\\](?<u> \\[usabile\\])?!?${S}*${END}`
);

/**
 * The /usa reply of a sphere that releases a Pakkomon, recognised from its text alone:
 * a use that gives the Pakkomon and names the sphere it used.
 */
const cPakkomonSphere: Classifier = (t) => {
  const m = PAKKOMON_SPHERE.exec(t);
  if (!m) return null;
  const g = groups(m);
  return {
    type: 'use',
    text: stripAddr(t),
    items: [
      {
        name: itemName(g['name'] as string),
        rarity: g['r'] as string,
        usable: Boolean(g['u']),
        qty: 1,
      },
    ],
    named: stripWs(g['item'] as string),
  };
};

const RECIPE_LINE = rx(
  `^- (?<name>${DOT}+?) L(?<lvl>${D}+) \\[(?<st>\\*|manca (?<miss>${D}+))\\]${S}*${END}`
);

/** A list longer than Telegram's limit is cut mid-line and ends with " TRONCATO!". */
const RECIPES_TRUNCATED = rx(` TRONCATO!${S}*${END}`);

const cRecipeList: Classifier = (t) => {
  if (!t.includes('ecco le ricette a tua disposizione:')) return null;
  const recipes: RecipeListEntry[] = [];
  for (const l of t.split('\n')) {
    const m = RECIPE_LINE.exec(l);
    if (!m) continue;
    const g = groups(m);
    recipes.push({
      name: g['name'] as string,
      level: parseDecimalInt(g['lvl'] as string),
      ready: g['st'] === '*',
      missing: g['miss'] ? parseDecimalInt(g['miss']) : 0,
    });
  }
  // The cut line does not match RECIPE_LINE, so only complete lines are kept.
  return { type: 'recipe_list', truncated: RECIPES_TRUNCATED.test(t), recipes };
};

const RECIPE_DETAIL = rx(`per fare (?:la ricetta )?(?<name>${DOT}+?) ti manca:`);

const cRecipeDetail: Classifier = (t) => {
  const m = RECIPE_DETAIL.exec(t);
  if (!m) return null;
  const lines = t.split('\n');
  return {
    type: 'recipe_detail',
    recipe: groups(m)['name'] as string,
    missing: itemLines(between(lines, 1, "Mentre hai gia':")),
    have: splitSection(lines, "Mentre hai gia':"),
  };
};

const CRAFT_OUTPUT = rx(`Ottieni:${S}*(?<out>[^\\n]+?)!?[ \\t]*(?:\\n(?<extra>[\\s\\S]*))?${END}`);
const LEVEL_UP = rx(`Hai raggiunto il livello (${D}+)!${S}*([\\s\\S]*)`);

const cCraft: Classifier = (t) => {
  if (!t.includes('prendi in mano:')) return null;
  const lines = t.split('\n');
  const ingredients: ItemLine[] = [];
  const rest: string[] = [];
  for (const l of lines.slice(1)) {
    if (rest.length === 0 && stripStartWs(l).startsWith('-')) {
      const it = itemFromLine(l);
      if (it) {
        ingredients.push(it);
        continue;
      }
    }
    rest.push(l);
  }
  const body = rest.join('\n');
  const m = CRAFT_OUTPUT.exec(body);
  const output = m ? stripWs(groups(m)['out'] as string) : null;
  const flavor = m ? stripWs(body.slice(0, m.index)) : stripWs(body);
  const ev: CraftEvent = { type: 'craft', ingredients, output, flavor };
  const extra = m ? groups(m)['extra'] : undefined;
  const lv = extra ? LEVEL_UP.exec(extra) : null;
  if (lv) {
    // "Per te 10x una moneta d'oro e un bel pacchettino regalo 🎁 in omaggio!"
    ev.level_up = parseDecimalInt(lv[1] as string);
    ev.level_up_text = stripWs(lv[2] as string);
  }
  return ev;
};

// Until September 2017 the recipe list had no final full stop.
const ITEM_INFO = rx(
  `${ADDR}(?<name>${DOT}+?) \\[(?<rarity>${RARITY})\\](?<usable> \\[usabile\\])? al momento ` +
    `(?:ti serve nelle ricette: (?<recipes>${DOT}+?)\\.?|non ti serve in nessuna ricetta\\.)${S}*${END}`
);
const NE_HAI = rx(`^Ne hai (${D}+)\\.`);
const FROM_RECIPE = rx(`si ottiene con la ricetta "(${DOT}+)"`);
const COOLDOWN_LINE = rx(`^Raffreddamento: (${DOT}+)`);

const cItemInfo: Classifier = (t) => {
  const lines = t.split('\n');
  const m = ITEM_INFO.exec(lines[0] as string);
  if (!m) return null;
  const g = groups(m);
  const ev: ItemInfoEvent = {
    type: 'item_info',
    item: itemName(g['name'] as string),
    rarity: g['rarity'] as string,
    usable: Boolean(g['usable']),
    // Comma-split is refined in phase 5 against known recipe names.
    used_in_raw: g['recipes'] ?? null,
    count: null,
    source: null,
    from_recipe: null,
  };
  for (const l of lines.slice(1)) {
    let mm: RegExpExecArray | null;
    if ((mm = NE_HAI.exec(l))) ev.count = parseDecimalInt(mm[1] as string);
    else if (l.startsWith('Non ne hai neanche uno')) ev.count = 0;
    else if (l.includes('trovabile in avventura')) ev.source = 'adventure';
    else if (l.includes('oggetto speciale')) ev.source = 'special';
    else if ((mm = FROM_RECIPE.exec(l))) {
      ev.source = 'recipe';
      ev.from_recipe = mm[1] as string;
    } else if (l.includes('si ottiene con una ricetta')) ev.source = 'recipe';
    else if ((mm = COOLDOWN_LINE.exec(l))) ev.cooldown = mm[1] as string;
  }
  return ev;
};

/**
 * /titolo: "@u, non hai oggetti che diano titoli.." (none owned), or the 2017-2018 form
 * "@u, ora non hai nessun titolo. Ecco gli oggetti che danno titoli che possiedi:" +
 * item lines. Before cInventory, which would read the list form ("possiedi:").
 */
const cTitle: Classifier = (t) => {
  const lines = t.split('\n');
  const head = lines[0] as string;
  if (!head.includes('oggetti che diano titoli') && !head.includes('oggetti che danno titoli'))
    return null;
  return { type: 'title', items: itemLines(lines.slice(1)) };
};

/** The rarity tags that end an inventory line, after the name: " [N] [usabile] x3". */
const LINE_TAGS = rx(`${S}\\[${RARITY}\\](?:${S}+\\[usabile\\])?(?:${S}+x${D}+)?${S}*${END}`);

/**
 * The items of an inventory, whose every line carries a rarity. A player-made item's
 * name may span lines: a `- ` line without a rarity starts it, and the lines up to the
 * one with the rarity (with or without their own `-`) continue it. An unfinished name
 * at the end (a truncated list) is dropped.
 */
export function inventoryItems(lines: readonly string[]): ItemLine[] {
  const out: ItemLine[] = [];
  let pending: string[] | null = null;
  for (const l of lines) {
    if (pending === null) {
      if (!stripStartWs(l).startsWith('-')) continue;
      if (!LINE_TAGS.test(l)) {
        pending = [l];
        continue;
      }
      const it = itemFromLine(l);
      if (it) out.push(it);
      continue;
    }
    pending.push(l);
    if (!LINE_TAGS.test(l)) continue;
    // One line of the whole: the name keeps its line breaks.
    const first = stripStartWs(pending[0] as string).slice(1);
    const it = itemFromLine(`- ${[first, ...pending.slice(1)].join('\u0000')}`);
    pending = null;
    if (it) out.push({ ...it, name: itemName(it.name.replaceAll('\u0000', '\n')) });
  }
  return out;
}

const cInventory: Classifier = (t, q) => {
  const lines = t.split('\n');
  if (!(lines[0] as string).includes('possiedi:')) return null;
  // Long inventories are cut off by the bot with "e altre robe che non ci stanno.."
  return {
    type: 'inventory',
    filtered: q !== null && !INVENTORY_COMMANDS.includes(q.toLowerCase()),
    truncated: t.includes('altre robe che non ci stanno'),
    items: inventoryItems(lines.slice(1)),
  };
};

/** The places of the "Puoi andare verso:" block, as written. */
function exitsWritten(t: string): string[] {
  if (!t.includes('Puoi andare verso:')) return [];
  const tail = after(t, 'Puoi andare verso:');
  return tail
    .split('\n')
    .filter((l) => stripWs(l).startsWith('- '))
    .map((l) => stripWs(stripWs(l).slice(2)));
}

function exits(t: string): string[] {
  return exitsWritten(t).map(placeName);
}

/** The places a reply names, in their article form, mapped to the words it wrote them with. */
function written(t: string, ...places: (string | null)[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const w of [...places, ...exitsWritten(t)]) if (w !== null) out[placeName(w)] = w;
  return out;
}

/** The place a match names, as written. */
const loc = (m: RegExpExecArray): string => stripWs(groups(m)['loc'] as string);

const BLOCKED = rx(`non puoi andare: (?<loc>${DOT}+?)\\.\\. Forse ti manca qualcosa`);
const WHERE = rx(`ti trovi: (?<loc>${DOT}+)`);
const ARRIVAL = rx(`arrivi:?${S}+(?<loc>[^\\n]+)${END}`);
const ARRIVAL_COLON = rx(` arrivi:${S}+(?<loc>[^\\n]+)${END}`);

// 2017-2018: the standard arrival without the "Puoi andare verso:" block.
const STANDARD_ARRIVAL = rx(
  `${ADDR}ti metti in cammino e dopo un lunghissimo viaggio arrivi (?<loc>${DOT}+?)${S}*${END}`
);

const cTravel: Classifier = (t) => {
  if (!t.includes('Puoi andare verso:') && !t.includes('non puoi andare:')) {
    const m = STANDARD_ARRIVAL.exec(t);
    return m
      ? {
          type: 'travel',
          location: placeName(loc(m)),
          exits: [],
          narrative: null,
          written: written(t, loc(m)),
        }
      : null;
  }
  let m = BLOCKED.exec(t);
  if (m)
    return { type: 'travel_blocked', location: placeName(loc(m)), written: written(t, loc(m)) };
  m = WHERE.exec(t);
  if (m)
    return {
      type: 'location',
      location: placeName(loc(m)),
      exits: exits(t),
      written: written(t, loc(m)),
    };
  const head = stripWs(t.split('Puoi andare verso:')[0] as string);
  m = ARRIVAL.exec(head);
  if (m) {
    const narrative = stripWs(stripAddr(head.slice(0, m.index)));
    const standard = narrative.startsWith('ti metti in cammino');
    // Only the standard text and "arrivi:" delimit the place: "… arrivi esausto nella baia di
    // Scogliola 🦀" is left to phase 5, which finds the known place that ends it.
    if (!standard && !ARRIVAL_COLON.test(head))
      return {
        type: 'travel',
        location: null,
        exits: exits(t),
        narrative: stripWs(stripAddr(head)),
        written: written(t),
      };
    return {
      type: 'travel',
      location: placeName(loc(m)),
      exits: exits(t),
      narrative: standard ? null : narrative,
      written: written(t, loc(m)),
    };
  }
  // An arrival narrated through an item without "arrivi" ("… finalmente ti trovi nella
  // palude sussurrante 🌾"): the place ends the text, and phase 5 finds it among the known places.
  return {
    type: 'travel',
    location: null,
    exits: exits(t),
    narrative: stripWs(stripAddr(head)),
    written: written(t),
  };
};

/**
 * 2017-2018 arrivals narrated through an item had no "Puoi andare verso:" block and no
 * fixed wording ("… arrivi esausto nella baia di Scogliola 🦀", "… accedere al molo dei
 * barcaioli 🎣"): an addressed one-line reply to "/viaggio <place>" that no other
 * classifier recognised is one, with the place left to phase 5. Last of the classifiers.
 */
const cNarratedArrival: Classifier = (t, q) => {
  const arg =
    q === null ? '' : stripWs(q.toLowerCase().startsWith('/viaggio ') ? sliceCodePoints(q, 9) : '');
  if (!arg || !ADDR_RE.test(t) || stripWs(t).includes('\n')) return null;
  const text = stripWs(stripAddr(t));
  // "… arrivi: sul banco corallino 🐠" delimits the place, as with the exits block.
  const m = ARRIVAL_COLON.exec(text);
  if (m)
    return {
      type: 'travel',
      location: placeName(loc(m)),
      exits: [],
      narrative: stripWs(text.slice(0, m.index)),
      written: written('', loc(m)),
    };
  return { type: 'travel', location: null, exits: [], narrative: text, written: {} };
};

const TRAVEL_REQUIREMENT = rx(
  `^(?<item>${DOT}+?) ti serve per passare (?<loc>${DOT}+?) sulla via per tornare al villaggio\\.?${S}*${END}`
);

/** "<item> ti serve per passare <place> sulla via per tornare al villaggio.": a side notice naming the item a place requires. */
const cTravelRequirement: Classifier = (t) => {
  const m = TRAVEL_REQUIREMENT.exec(t);
  if (!m) return null;
  const g = groups(m);
  return {
    type: 'travel_requirement',
    item: itemName(g['item'] as string),
    location: placeName(loc(m)),
    written: written('', loc(m)),
  };
};

const STATS_LINE = rx(`^- (${W}[${WORD_BODY} ]*?): (${DOT}+)`);

/** Event keys a /stats field must not take: `type` and the context keys (EventContext). */
const STATS_RESERVED: ReadonlySet<string> = new Set([
  'type',
  'unique_items',
  'chat',
  'dm',
  'msg',
  'date',
  'player',
  'query',
  'match',
  'forwarded',
  'broadcast',
]);
const UNIQUE_ITEMS = '- Oggetti unici:';

const RANKED = rx(`\\(${D}+° posto\\)`);

const cStats: Classifier = (t) => {
  if (!t.startsWith('Avventuriero @')) return null;
  const ev: StatsEvent = { type: 'stats' };
  // The favourite item's name may span lines (a player-made item), up to the first ranked
  // field ("- Avventure: 12 (3° posto) …"): every field after it carries its rank.
  let favourite = false;
  for (const l of t.split('\n')) {
    if (favourite && !RANKED.test(l)) {
      ev['oggetto preferito'] = `${String(ev['oggetto preferito'])}\n${l}`;
      continue;
    }
    favourite = false;
    const m = STATS_LINE.exec(l);
    if (!m) continue;
    const key = (m[1] as string).toLowerCase();
    if (key === 'oggetto preferito') favourite = true;
    // A field named like an event key is dropped: it would change the event's type or context.
    if (STATS_RESERVED.has(key)) continue;
    // defineProperty: a field named "__proto__" stays a plain key, not the prototype.
    const value = stripWs(m[2] as string);
    Object.defineProperty(ev, key, {
      value: key === 'luogo' ? placeName(value) : value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  // "- Oggetti unici:" then one indented item line per unique item owned; the last one,
  // as a favourite item's name may hold the words too.
  const lines = t.split('\n');
  const at = lines.findLastIndex((l) => stripWs(l) === UNIQUE_ITEMS);
  if (at >= 0) ev.unique_items = splitSection(lines.slice(at), UNIQUE_ITEMS);
  return ev;
};

const LUCKY = rx(
  `avventura FORTUNATA del giorno! Hai vinto: (?<name>${DOT}+?) \\[(?<r>${RARITY})\\]`
);

const cLucky: Classifier = (t) => {
  const m = LUCKY.exec(t);
  if (!m) return null;
  const g = groups(m);
  return {
    type: 'drop',
    kind: 'lucky',
    item: itemName(g['name'] as string),
    rarity: g['r'] as string,
    usable: false,
  };
};

const cGift: Classifier = (t) => {
  const m = GIFT.exec(t);
  if (!m) return null;
  const g = groups(m);
  return {
    type: 'gift',
    from: g['from'] as string,
    qty: parseDecimalInt(g['qty'] as string),
    item: itemName(g['name'] as string),
  };
};

const DROP = rx(`(?<pre>[\\s\\S]*) \\[(?<r>${RARITY})\\](?<u> \\[usabile\\])?!?${S}*${END}`);

const cDrop: Classifier = (t) => {
  // Adventure drops end with "<item> [R]!" or "<item> [R] [usabile]!" (the "!" is
  // missing in some group messages); a player-made item's name may span lines, but a
  // first line ending with ":" heads a list, not a drop.
  if (stripWs(t.split('\n')[0] as string).endsWith(':') && stripWs(t).includes('\n')) return null;
  const m = DROP.exec(t);
  if (!m) return null;
  const g = groups(m);
  return {
    type: 'drop',
    kind: 'adventure',
    raw: itemName(stripAddr(g['pre'] as string)),
    rarity: g['r'] as string,
    usable: Boolean(g['u']),
  };
};

// Items a /usa reply names inline: "… Ottieni: un seme di Zaffirella!" (one), and
// "… ci trovi dentro 22 monete d'oro!" (gold coins, the only counted form).
const USE_OTTIENI = rx(
  `Ottieni:${S}*(?<name>${DOT}+?)(?: \\[(?<rarity>${RARITY})\\])?(?<usable> \\[usabile\\])?!?${S}*${END}`
);
const USE_COINS = rx(`ci trovi dentro (?<qty>${D}+) monet[ae] d'oro!?${S}*${END}`);
const COIN = "una moneta d'oro";

/** The Pakkomon scanner's reply: its `- ` lines are the player's Pakkomon and their readiness. */
const PAKKOMON_SCAN = rx(`esamini i tuoi pakkomon con lo scanner:${S}*${END}`);

/** Items received in a /usa reply: `- item` lines after the first line, then items named inline. */
export function useItems(t: string): ItemLine[] {
  const lines = t.split('\n');
  const items = PAKKOMON_SCAN.test(lines[0] ?? '') ? [] : itemLines(lines.slice(1));
  for (const l of lines) {
    let m: RegExpExecArray | null;
    if ((m = USE_OTTIENI.exec(l))) {
      const g = groups(m);
      items.push({
        name: itemName(g['name'] as string),
        rarity: g['rarity'] ?? null,
        usable: Boolean(g['usable']),
        qty: 1,
      });
    } else if ((m = USE_COINS.exec(l))) {
      items.push({
        name: COIN,
        rarity: null,
        usable: false,
        qty: parseDecimalInt(groups(m)['qty'] as string),
      });
    }
  }
  return items;
}

const cUse: Classifier = (t, q) => {
  if (!isUseQuery(q)) return null;
  return { type: 'use', text: stripAddr(t), items: useItems(t) };
};

const LEGEND = rx(`Legenda oggetti\\n([\\s\\S]+?)(?:\\n\\n|${END})`);
// A word boundary before a word character: the previous character is not one.
const LEGEND_ENTRY = rx(
  `(?<![${WORD_BODY}])([A-Z]n?) = ([^,.:(]+?)(?: \\(([^)]*)\\))?(?=[,.]|${S}*:\\)|\\n?$)`,
  'g'
);
const LEVELS = rx(`\\nLivelli\\n\\n?([\\s\\S]+?)\\n\\n`);

/** /faq: the rarity legend and the levelling rule, so the wiki does not hardcode them. */
const cFaq: Classifier = (t) => {
  if (!t.startsWith('Ciao, sono InventoryBot!')) return null;
  const ev: FaqEvent = { type: 'faq', rarities: {}, rules: [] };
  let m = LEGEND.exec(t);
  if (m) {
    const legend = m[1] as string;
    // "C = comune, N = non comune, ..., Ln = ottenibile da ricette. X = oggetti speciali :)"
    for (const [, code, desc, note] of legend.matchAll(LEGEND_ENTRY)) {
      ev.rarities[code as string] = stripWs(desc as string) + (note ? ` (${note})` : '');
    }
    for (const line of legend.split('\n').slice(1)) {
      if (stripWs(line)) ev.rules.push(stripWs(line));
    }
  }
  m = LEVELS.exec(t);
  if (m) ev.rules.push(stripWs(m[1] as string));
  return ev;
};

interface KnownReply {
  /** Name of the reply, kept in the `miss` event. */
  name: string;
  /** A string: found at the start or in the first 80 characters (`head`) or anywhere; a RegExp: tested on the text. */
  match: { head: string } | { anywhere: string } | RegExp;
  commands: Producers;
}

const DAI_NOT_ENOUGH = rx(`^non ne hai abbastanza, ne possiedi solo (?<n>${D}+)\\.${S}*${END}`);

/**
 * Replies that carry no game fact, each recognised by an explicit pattern (first match
 * wins). A reply that matches none stays unknown: nothing is noise unless it is listed.
 */
const KNOWN_REPLIES: readonly KnownReply[] = [
  { name: 'dai_syntax', match: { head: 'Sintassi: /dai' }, commands: ['/dai'] },
  { name: 'dai_unknown_user', match: { head: "Non esiste quell'utente" }, commands: ['/dai'] },
  {
    name: 'register_first',
    match: { head: 'per giocare con me devi prima registrarti' },
    commands: 'any',
  },
  { name: 'leaderboards', match: { head: 'Eroi di Sempre:' }, commands: ['/stats'] },
  { name: 'groups', match: { head: 'Gruppi di InventoryBot' }, commands: ['/gruppi'] },
  { name: 'welcome', match: { head: 'Benvenuto!' }, commands: ['/start', '/registrami'] },
  { name: 'commands', match: { head: 'I comandi:' }, commands: ['/faqcomandi'] },
  {
    name: 'hidden_recipes',
    match: { head: 'stai nascondendo le seguenti ricette' },
    commands: ['/nascondi'],
  },
  // Interface preferences, not game state: nothing is read from them.
  { name: 'hide_recipe', match: rx(`^${A}nascondi la ricetta `), commands: ['/nascondi'] },
  {
    name: 'unhide_recipe',
    match: rx(`^${A}smetti di nascondere la ricetta `),
    commands: ['/nascondi'],
  },
  {
    name: 'favourite',
    match: rx(
      `^${A}sei veramente affezionato a ${DOT}+, e' di gran lunga il tuo oggetto preferito!`
    ),
    commands: ['/preferito'],
  },
  {
    name: 'quest_none',
    match: rx(`^${A}non hai nessuna quest al momento\\.`),
    commands: ['/quest'],
  },
  { name: 'examine_what', match: { anywhere: 'cosa vuoi esaminare' }, commands: ['/esamina'] },
  {
    name: 'examine_ambiguous',
    match: { anywhere: 'conosci diversi oggetti' },
    commands: ['/esamina'],
  },
  {
    name: 'examine_not_found',
    match: { anywhere: 'non hai oggetti o ricette' },
    commands: ['/esamina'],
  },
  {
    name: 'recipe_ambiguous',
    match: { anywhere: 'troppe ricette trovate' },
    commands: ['/ricetta', '/esamina'],
  },
  {
    name: 'item_ambiguous',
    match: { anywhere: 'troppi oggetti trovati' },
    commands: ['/mostra', '/dai', '/usa'],
  },
  {
    name: 'recipe_not_found',
    match: { anywhere: 'non hai ricette con quel nome' },
    commands: ['/ricetta'],
  },
  { name: 'no_recipes', match: { anywhere: 'non hai ricette al momento' }, commands: ['/ricetta'] },
  { name: 'place_not_found', match: { anywhere: 'non vedi nessun luogo' }, commands: ['/viaggio'] },
  { name: 'use_what', match: { anywhere: 'si ma cosa vuoi usare' }, commands: ['/usa'] },
  {
    name: 'use_not_owned',
    match: { anywhere: 'non hai niente del genere di usabile' },
    commands: ['/usa'],
  },
  // An item that is not usable: a refusal, not what a use does.
  {
    name: 'use_not_usable',
    match: { anywhere: "non puoi usare quell'oggetto" },
    commands: ['/usa'],
  },
  // An argument that is neither a player nor an item of the player's, echoed before the
  // fixed wording ("cervello non e' un utente e non hai oggetti del genere.").
  {
    name: 'use_target_unknown',
    match: { anywhere: "non e' un utente e non hai oggetti del genere" },
    commands: ['/usa'],
  },
  {
    name: 'use_target_not_owned',
    match: { anywhere: "non e' ne un utente ne un oggetto in tuo possesso" },
    commands: ['/usa'],
  },
  // An argument too long: the whole reply.
  {
    name: 'too_long',
    match: rx(`${ADDR}Troppo lungo vecchio\\.\\.\\.${S}*${END}`),
    commands: 'any',
  },
  {
    name: 'item_not_owned',
    match: { anywhere: 'non hai niente del genere' },
    commands: ['/mostra', '/dai', '/preferito'],
  },
  { name: 'restricted', match: rx(`^Non puoi :\\)${S}*${END}`), commands: 'any' },
  {
    name: 'group_restricted',
    match: rx(
      `${ADDR}in questo gruppo non sono consentite avventure, inventari e liste di ricette\\.`
    ),
    commands: ['/avventura', '/inventario', '/ricetta'],
  },
  {
    name: 'error',
    match: rx(`^Errore ${W}+(?:Exception|Error)(?![${WORD_BODY}])`),
    commands: 'any',
  },
  {
    name: 'stats_unknown_user',
    match: rx(`^non esiste nessuno con quel nome\\.\\.${S}*${END}`),
    commands: ['/stats'],
  },
  {
    name: 'lottery_none',
    match: rx("^Non c'e' nessuna lotteria attiva"),
    commands: ['/biglietto'],
  },
  { name: 'lottery_winner', match: rx("^IL FORTUNATO E': "), commands: 'none' },
  { name: 'lottery_consolation', match: rx('^PREMIO DI CONSOLAZIONE: '), commands: 'none' },
  { name: 'lottery_open', match: rx('^APRE LA BIGLIETTERIA!'), commands: 'none' },
  { name: 'lottery_closed', match: rx("^LA BIGLIETTERIA E' CHIUSA!!"), commands: 'none' },
  {
    name: 'lottery_count',
    match: rx(`^ABBIAMO ${D}+ PARTECIPANTI! PRONTI ALL'ESTRAZIONE!`),
    commands: 'none',
  },
  { name: 'lottery_drumroll', match: rx(`^RULLO DI TAMBURI!!!${S}*${END}`), commands: 'none' },
  {
    name: 'lottery_ticket',
    match: rx(`^(?:\\[N\\] )?${ADDR.slice(1)}prendi un biglietto!${S}*${END}`),
    commands: 'none',
  },
  {
    name: 'username_locked',
    match: rx("^Mi spiace ma per evitare abusi non e' possibile cambiare username\\."),
    commands: 'any',
  },
  { name: 'dai_not_enough', match: DAI_NOT_ENOUGH, commands: ['/dai'] },
  {
    name: 'dai_untrusted',
    match: rx(`^meglio non dare niente a ${DOT}+, non ti sembra un tipo affidabile\\.${S}*${END}`),
    commands: ['/dai'],
  },
  {
    name: 'dai_doubtful',
    match: rx(`^sicuro che vuoi dare cose a ${DOT}+\\? Meglio di no\\.\\.${S}*${END}`),
    commands: ['/dai'],
  },
  {
    name: 'dai_bad_quantity',
    match: rx('^la quantità deve essere un intero positivo, non fare il furbo\\.'),
    commands: ['/dai'],
  },
  {
    name: 'game_moved',
    match: rx("^Ciao, il gioco si e' trasferito sul nuovo bot"),
    commands: 'any',
  },
  { name: 'ban', match: rx('^\\[BAN\\] Sei stato bannato per: '), commands: 'none' },
  {
    name: 'captcha',
    match: rx('^(?:⚠ )?Per favore risolvi il captcha per continuare\\.'),
    commands: 'any',
  },
  {
    name: 'use_wrong_key',
    match: rx(`${ADDR}non hai la chiave giusta per aprire questo baule\\.\\.${S}*${END}`),
    commands: ['/usa'],
  },
  {
    name: 'place_ambiguous',
    match: rx('^troppi luoghi trovati con quel nome\\('),
    commands: ['/viaggio'],
  },
  {
    name: 'inventory_bad_filter',
    match: rx(`${ADDR}puoi usare solo i seguenti parametri: `),
    commands: ['/inventario'],
  },
];

const KNOWN_BY_NAME: ReadonlyMap<string, KnownReply> = new Map(
  KNOWN_REPLIES.map((k) => [k.name, k])
);

/** The commands that produce a known reply or an old format, as their table lists them. */
export function producersOf(ev: MissEvent | OldFormatEvent): Producers {
  return ev.type === 'miss'
    ? (KNOWN_BY_NAME.get(ev.reply) as KnownReply).commands
    : (OLD_BY_FORMAT.get(ev.format) as OldFormat).commands;
}

function knownReply(t: string): KnownReply | null {
  const head = sliceCodePoints(t, 0, 80);
  for (const k of KNOWN_REPLIES) {
    const m = k.match;
    if (
      m instanceof RegExp
        ? m.test(t)
        : 'head' in m
          ? t.startsWith(m.head) || head.includes(m.head)
          : t.includes(m.anywhere)
    )
      return k;
  }
  return null;
}

const cNoise: Classifier = (t) => {
  const k = knownReply(t);
  if (k === null) return null;
  const ev: MissEvent = { type: 'miss', reply: k.name };
  if (Array.isArray(k.commands) && k.commands.length === 1) ev.command = k.commands[0] as string;
  // "ne possiedi solo N": for the player who tried, an exact count of the item named by the /dai command.
  const m = k.name === 'dai_not_enough' ? DAI_NOT_ENOUGH.exec(t) : null;
  if (m) ev.owned = parseDecimalInt(groups(m)['n'] as string);
  return ev;
};

const cGive: Classifier = (t) => {
  // In a group: "@mario_r, dai 1x un bottone a @lucia_b"
  const m = GIVE.exec(t);
  if (!m) return null;
  const g = groups(m);
  return {
    type: 'give',
    to: g['to'] ?? null,
    qty: parseDecimalInt(g['qty'] as string),
    item: itemName(g['name'] as string),
  };
};

const SHOW = rx(
  `${ADDR}mostri orgogliosamente di possedere (?<qty>${D}+)x (?<name>${DOT}+?) \\[(?<r>${RARITY})\\](?<u> \\[usabile\\])?${S}*${END}`
);

const cShow: Classifier = (t) => {
  // "@mario_r, mostri orgogliosamente di possedere 3x un elegante cappello piumato [N]"
  const m = SHOW.exec(t);
  if (!m) return null;
  const g = groups(m);
  return {
    type: 'show',
    qty: parseDecimalInt(g['qty'] as string),
    item: itemName(g['name'] as string),
    rarity: g['r'] as string,
    usable: Boolean(g['u']),
  };
};

const CLASSIFIERS: readonly Classifier[] = [
  cTooEarly,
  cItemCooldown,
  cOldFormat,
  cPakkomonSphere,
  cRecipeList,
  cRecipeDetail,
  cCraft,
  cItemInfo,
  cTitle,
  cInventory,
  cTravel,
  cTravelRequirement,
  cStats,
  cLucky,
  cGift,
  cGive,
  cShow,
  cUse,
  cDrop,
  cFaq,
  cNoise,
  cNarratedArrival,
];

/** The event a bot reply describes; `query` is the command it answers, if known. */
export function classify(text: string, query: Query): Event {
  for (const c of CLASSIFIERS) {
    const ev = c(text, query);
    if (ev) return ev;
  }
  return { type: 'unknown' };
}
