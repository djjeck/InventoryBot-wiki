/**
 * The Pakkomon replies (docs/bot-protocol.md 2.9 and 6.18), read into events: fights and
 * boss hits, records, challenges, stuns, the boss announcement, and the uses of an item on
 * a Pakkomon. Also the game's rule that a fight's ending phrase states the loser's stun
 * (ENDINGS). Part of phase 4, wired into classify.ts. Pure logic only (no Node APIs).
 */
import { parseDecimalInt, stripWs } from '#src/lib/text.ts';
import {
  A,
  ADDR_RE,
  D,
  DOT,
  END,
  itemName,
  parseDuration,
  RARITY,
  rx,
  S,
  stripAddr,
  W,
} from './patterns.ts';
import {
  type Event,
  type ItemLine,
  type PakkomonFightEvent,
  type PakkomonReadiness,
  type PakkomonRecordEvent,
  type PakkomonRole,
  type PakkomonUse,
  type UseEvent,
} from './types.ts';
import { unshaped } from './use-shapes.ts';

type Groups = Record<string, string | undefined>;
const groups = (m: RegExpExecArray): Groups => m.groups ?? {};

/** The name of a Pakkomon as an inventory item ("un Pakkomon di nome Zampirlo 🐯"). */
export const pakkomonItem = (name: string): string => `un Pakkomon di nome ${name}`;

/**
 * The wiki's one item for every Pakkomon: each is a creature of its owner, not an item of
 * the game, so the wiki learns only what holds for any of them.
 */
export const PAKKOMON = 'un Pakkomon';

/** An item name as the wiki keeps it: any Pakkomon as PAKKOMON, a shaped item as the item (unshaped). */
export const wikiItemName = (name: string): string =>
  name.startsWith(pakkomonItem('')) ? PAKKOMON : unshaped(name);

/** The role a use gives the item used, for Pakkomon (equipping gives one to the item taken). */
export const USE_ROLES: Readonly<Record<PakkomonUse, PakkomonRole | null>> = {
  hatch: 'sphere',
  equip: null,
  scan: 'scanner',
  heal: 'heal',
  power_up: 'power_up',
  probe: 'probe',
  scale: 'scale',
  extract: 'extractor',
  customise: 'customisation',
};

/**
 * The ending phrases of a fight, from the narrowest win, each with the loser's stun it
 * states, in minutes (the maximum null: no upper bound).
 */
export const ENDINGS: readonly (readonly [string, number, number | null])[] = [
  ['per un soffio', 0, 9],
  ['di stretta misura', 10, 19],
  ['con discreto margine', 20, 29],
  ["senza difficolta'", 30, 39],
  ['con ampio margine', 40, 49],
  ['accartocciandolo', 50, 59],
  ['riducendolo in piccolissimi pezzettini', 60, 69],
  ['come se fosse di burro', 70, 79],
  ['annientandolo totalmente', 80, 89],
  ['distruggendolo di botte', 90, 99],
  ['demolendolo malamente', 100, 109],
  ['spalmandolo sul terreno', 110, 119],
  ['sparpagliandone le membra', 120, 129],
  ["annichilendolo senza pieta'", 130, 139],
  ['disintegrandone ogni singolo atomo', 140, 199],
  ["annullandone l'esistenza", 200, 249],
  ['annullandone il ricordo', 250, 349],
  ["rimuovendolo dall'universo", 350, null],
];
const ENDING_BY_PHRASE = new Map(ENDINGS.map(([p, lo, hi]) => [p, [lo, hi] as const]));

/** A boss's wounds, from the lightest. */
export const WOUNDS: readonly string[] = [
  "e' appena scalfito",
  'ha qualche graffio',
  'ha qualche ferita',
  'ha diverse ferite',
  "e' ferito superficialmente",
  "e' ferito seriamente",
  "e' gravemente ferito",
  'sanguina abbondantemente',
  "e' in fin di vita",
  "e' a un passo dalla morte",
];

// "NAME [R] [usabile]", the tags optional; some prizes carry one more tag ("[N][#]").
const TAGGED_ITEM = rx(
  `^(?<name>${DOT}+?)(?: \\[(?<r>${RARITY})\\])?(?:\\[#\\])?(?<u> \\[usabile\\])?$`
);

/** An item as a Pakkomon reply names it: name and tags, quantity 1. */
function taggedItem(s: string): ItemLine {
  const g = groups(TAGGED_ITEM.exec(stripWs(s)) as RegExpExecArray);
  return {
    name: itemName(g['name'] as string),
    rarity: g['r'] ?? null,
    usable: Boolean(g['u']),
    qty: 1,
  };
}

// ---- fights ------------------------------------------------------------------------

// Both wordings: "… furiosamente e alla fine …" (until March 2025) and "… furiosamente.
// [MOVE! ]Alla fine …". A move may hold "!" itself: it ends at the first "! Alla fine".
const FIGHT = rx(
  `^(?:\\[N\\] )?(?:${A})?i due pakkomon iniziano a combattere furiosamente(?: e alla fine|\\. (?:(?<move>${DOT}+?!) )?Alla fine) (?<w>${DOT}+?) di @(?<wo>${W}+) (?<verb>sconfigge|colpisce) (?<l>${DOT}+?) di @(?<lo>${W}+)(?: (?<end>${DOT}+?))?!(?<rest>[\\s\\S]*)$`
);
const PRIZE = rx(`^@${W}+ ottiene (?<item>${DOT}+?)!${S}*$`);
const LEARNED = rx(`^${DOT}+ ha imparato qualcosa di nuovo\\.\\.${S}*$`);
const WOUND = rx(`^${DOT}+? (?<w>${WOUNDS.join('|')})!${S}*$`);
const DEFEAT = rx('^Lanciando un ultimo grido rabbioso, ');
const SPOIL = rx(`^• @(?<u>${W}+): (?<n>${D}+)${S}*$`);

/** A fight's reply, or a hit on a boss. */
export function pakkomonFight(t: string): PakkomonFightEvent | null {
  const m = FIGHT.exec(t);
  if (!m) return null;
  const g = groups(m);
  const ending = g['end'] ?? null;
  const stun = ending === null ? undefined : ENDING_BY_PHRASE.get(ending);
  let prize: ItemLine | null = null;
  let learned = false;
  let wound: string | null = null;
  let spoils: PakkomonFightEvent['spoils'] = null;
  for (const line of (g['rest'] as string).split('\n')) {
    let x: RegExpExecArray | null;
    if ((x = PRIZE.exec(line))) prize = taggedItem(groups(x)['item'] as string);
    else if (LEARNED.test(line)) learned = true;
    else if (DEFEAT.test(line)) spoils = [];
    else if (spoils !== null && (x = SPOIL.exec(line)))
      spoils.push({
        player: groups(x)['u'] as string,
        points: parseDecimalInt(groups(x)['n'] as string),
      });
    else if ((x = WOUND.exec(line))) wound = groups(x)['w'] as string;
  }
  return {
    type: 'pakkomon_fight',
    winner: { pakkomon: stripWs(g['w'] as string), owner: g['wo'] as string },
    loser: { pakkomon: stripWs(g['l'] as string), owner: g['lo'] as string },
    hit: g['verb'] === 'colpisce',
    ending,
    stun_min: stun ? stun[0] : null,
    stun_max: stun ? stun[1] : null,
    move: g['move'] === undefined ? null : stripWs(g['move']),
    prize,
    learned,
    wound,
    spoils,
  };
}

// ---- records, challenges, stuns, bosses ---------------------------------------------

const RECORD = rx(
  `^(?:${A})?(?<pk>${DOT}+?) ha vinto (?<w>${D}+) battaglie e ne ha perse (?<l>${D}+)\\.(?<rest>[\\s\\S]*)$`
);
const EQUIPPED = rx(`^E' equipaggiato con (?<item>${DOT}+?)\\.${S}*$`);
const STUN_LINE = rx(
  `^E' ancora rintronato dall'ultimo combattimento\\. Si rimettera' tra (?<d>${DOT}+?)\\.${S}*$`
);
const BORN = rx(
  `^E' nato il giorno (?<d>${D}{2})-(?<m>${D}{2})-(?<y>${D}{4}) dalle mani di @(?<u>${W}+)\\.${S}*$`
);
// A line of power-up icons: emoji only, no letter, digit or punctuation.
const ICONS = rx('^[\\p{Extended_Pictographic}\\uFE0F]+$');

/** `/usa <pakkomon>`: the Pakkomon's record. */
export function pakkomonRecord(t: string): PakkomonRecordEvent | null {
  const m = RECORD.exec(t);
  if (!m) return null;
  const g = groups(m);
  const ev: PakkomonRecordEvent = {
    type: 'pakkomon_record',
    pakkomon: stripWs(g['pk'] as string),
    wins: parseDecimalInt(g['w'] as string),
    losses: parseDecimalInt(g['l'] as string),
    equipment: null,
    stunned_for: 0,
    born: null,
    maker: null,
    power_ups: [],
  };
  for (const raw of (g['rest'] as string).split('\n')) {
    const line = stripWs(raw);
    let x: RegExpExecArray | null;
    if ((x = EQUIPPED.exec(line))) ev.equipment = taggedItem(groups(x)['item'] as string);
    else if ((x = STUN_LINE.exec(line)))
      ev.stunned_for = parseDuration(groups(x)['d'] as string)?.seconds ?? 0;
    else if ((x = BORN.exec(line))) {
      const b = groups(x);
      ev.born = `${b['y'] as string}-${b['m'] as string}-${b['d'] as string}`;
      ev.maker = b['u'] as string;
    } else if (ICONS.test(line)) ev.power_ups = [...line].filter((c) => c !== '️');
  }
  return ev;
}

const READY = rx(`^${A}sei pronto a sfidare chiunque col tuo (?<pk>${DOT}+?) !${S}*${END}`);
const CHALLENGE = rx(
  `^${A}sfidi @(?<o>${W}+)(?: ${DOT}+?)? a combattere contro il tuo (?<pk>${DOT}+?)${S}*${END}`
);
const STUNNED = rx(
  `^(?:${A})?(?<pk>${DOT}+?) e' ancora rintronato dall'ultimo combattimento\\. Si rimettera' tra (?<d>${DOT}+?)\\.${S}*${END}`
);
const OPPONENT_STUNNED = rx(
  `^${A}il pakkomon del tuo avversario e' ancora rintronato per (?<d>${DOT}+?)\\.?${S}*${END}`
);
const BOSS = rx(`^📣 Attenzione!Un Pakkomon Boss (?<e>${DOT}+?) sta sfidando l'arena!`);

/** The other Pakkomon replies that are not uses, by their text alone. */
export function pakkomonStatus(t: string): Event | null {
  let m: RegExpExecArray | null;
  if ((m = READY.exec(t)))
    return { type: 'pakkomon_ready', pakkomon: stripWs(groups(m)['pk'] as string) };
  if ((m = CHALLENGE.exec(t)))
    return {
      type: 'pakkomon_challenge',
      pakkomon: stripWs(groups(m)['pk'] as string),
      opponent: groups(m)['o'] as string,
    };
  const stunned = STUNNED.exec(t) ?? OPPONENT_STUNNED.exec(t);
  if (stunned) {
    const g = groups(stunned);
    const d = parseDuration(g['d'] as string);
    if (d)
      return {
        type: 'pakkomon_stunned',
        pakkomon: g['pk'] === undefined ? null : stripWs(g['pk']),
        remaining: d.seconds,
      };
  }
  if ((m = BOSS.exec(t))) return { type: 'pakkomon_boss', emoji: groups(m)['e'] as string };
  return null;
}

// ---- uses on a Pakkomon -------------------------------------------------------------

const PK_NAMED = `un Pakkomon di nome (?<pk>${DOT}+?)`;
// The uses on a Pakkomon, each with what it does, from its fixed text (after the
// addressee). `item`, when the text names it as the inventory does, is the item used.
const USES: readonly (readonly [RegExp, PakkomonUse])[] = [
  [rx(`^lanci la tua (?<item>${DOT}+?), si apre a mezz'aria ed esce ${PK_NAMED} \\[`), 'hatch'],
  [rx(`^equipaggi il tuo (?<pk>${DOT}+?) con ${DOT}+? \\[${RARITY}\\]`), 'equip'],
  [rx('^esamini i tuoi pakkomon con lo (?<item>scanner):'), 'scan'],
  [rx(`^attivi la sonda su ${PK_NAMED} e leggi il display: indica (?<read>${D}+)\\.`), 'probe'],
  [rx(`^dai da mangiare ${DOT}+? a ${PK_NAMED} che lo mastica con fatica`), 'heal'],
  [rx(`^spalmi ${PK_NAMED} con ${DOT}+? e dopo pochi istanti torna in perfetta forma`), 'heal'],
  [
    rx(`^fai (?:bere|mangiare) (?<item>${DOT}+?) a ${PK_NAMED}\\.\\. Poi lo scruti attentamente`),
    'power_up',
  ],
  [
    rx(
      `^inserisci (?<pk>${DOT}+?) nella sonda e sul display appare una scritta: "(?<read>${DOT}+?)"!`
    ),
    'probe',
  ],
  [
    rx(
      `^metti i due pakkomon (?<pk>${DOT}+?) e (?<pk2>${DOT}+?) sulla bilancia: (?<read>il primo|il secondo) e' piu' forte!`
    ),
    'scale',
  ],
  [rx(`^punti (?<item>${DOT}+?) contro ${PK_NAMED} e premi il grilletto`), 'extract'],
  [rx('^a breve verrai contattato per la customizzazione del tuo Pakkomon!'), 'customise'],
];
/** The fields of a use event that a use on a Pakkomon sets. */
export type PakkomonUseFields = Pick<
  UseEvent,
  'named' | 'pakkomon_use' | 'pakkomon' | 'reading' | 'scan'
>;

const SCAN_LINE = rx(`^${S}*- (?<pk>${DOT}+?): (?<d>${DOT}+?)${S}*$`);

/**
 * What a use on a Pakkomon reads, from the reply's text alone: what it does, the
 * Pakkomon, the item it names as used, what the probe or the scale reads, the scanner's
 * list. Null for any other reply.
 */
export function pakkomonUse(t: string): PakkomonUseFields | null {
  if (!ADDR_RE.test(t)) return null;
  const text = stripAddr(t);
  for (const [re, use] of USES) {
    const m = re.exec(text);
    if (!m) continue;
    const g = groups(m);
    const pakkomon = [g['pk'], g['pk2']].filter((p) => p !== undefined).map((p) => stripWs(p));
    const out: PakkomonUseFields = { pakkomon_use: use };
    if (use === 'equip') out.named = pakkomonItem(pakkomon[0] as string);
    else if (g['item'] !== undefined) out.named = itemName(g['item']);
    if (pakkomon.length > 0) out.pakkomon = pakkomon;
    if (g['read'] !== undefined) out.reading = g['read'];
    if (use === 'scan') out.scan = scanList(text);
    return out;
  }
  return null;
}

/** The scanner's list: each Pakkomon and the seconds before it can fight. */
function scanList(text: string): PakkomonReadiness[] {
  const out: PakkomonReadiness[] = [];
  for (const line of text.split('\n').slice(1)) {
    const m = SCAN_LINE.exec(line);
    if (!m) continue;
    const g = groups(m);
    const d = g['d'] === 'pronto' ? 0 : parseDuration(g['d'] as string)?.seconds;
    if (d !== undefined) out.push({ pakkomon: stripWs(g['pk'] as string), remaining: d });
  }
  return out;
}

/** The usernames a Pakkomon reply names, all of them players (or bots), as text spans. */
const PAKKOMON_PLAYERS = rx(
  "i due pakkomon iniziano a combattere|^(?:@[^ ,]+,? )?sfidi @|dalle mani di @|tutti i Pakkomon di @|non ha piu' il pakkomon con cui"
);
const USERNAME = rx(`@(?<u>${W}+)`, 'gd');

/** Every `@username` of a Pakkomon reply that names players besides its addressee, as spans. */
export function pakkomonUserSpans(text: string): [number, number][] {
  if (!PAKKOMON_PLAYERS.test(text)) return [];
  return [...text.matchAll(USERNAME)].map((m) => m.indices?.groups?.['u'] as [number, number]);
}
