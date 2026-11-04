/**
 * What the page (main.ts) writes about the exports and the work in progress, in Italian:
 * the exports grouped by chat (each chat's name, or that it is the example), the days of each
 * export's first and last message and its status, the owner whose wiki it is, and the header's
 * progress line. Pure functions, tested in Node.
 */
import { INVENTORY_BOT } from '#src/inventorybot/bot.ts';
import { type PlayerState } from '#src/inventorybot/types.ts';
import { parseMacDate, parseWindowsDate, type WallClock } from '#src/lib/dates.ts';
import { type Phase } from '#src/pipeline.ts';
import { DEMO_FOLDER } from './demo.ts';
import { type ExportEntry } from './protocol.ts';
import { type RecordInfo } from './storage.ts';

const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

const pad = (n: number): string => String(n).padStart(2, '0');

/** A date title as the export wrote it, as a wall clock; null if not a date. */
const wallClock = (title: string | null): WallClock | null =>
  parseWindowsDate(title) ?? parseMacDate(title);

/**
 * The day of a date title as the export wrote it (`27.11.2025 19:14:19 UTC-05:00`, or
 * the macOS `27 November 2025, 19:14:19`): `2025-11-27`; null if not a date. The wall
 * clock is the export's: the day the player saw in Telegram.
 */
export function exportDay(title: string | null): string | null {
  const d = wallClock(title);
  return d === null ? null : `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

/** The days of an export's first and last message: `2026-10-03 - 2026-10-17`, or one day. */
export function exportDays(info: Pick<RecordInfo, 'firstDate' | 'lastDate'>): string {
  const first = exportDay(info.firstDate);
  const last = exportDay(info.lastDate);
  if (first === null || last === null) return first ?? last ?? 'senza date';
  return first === last ? first : `${first} - ${last}`;
}

/**
 * The chat of an export: the group's title, or `@InventoryBot` for the private chat with
 * the bot; `fallback` (the folder) for an export without a title.
 */
export function chatName(info: Pick<RecordInfo, 'chats'>, fallback: string): string {
  const names = [
    ...new Set(
      info.chats
        .filter((c): c is string => c !== null && c !== '')
        .map((c) => (c === INVENTORY_BOT.dmTitle ? `@${INVENTORY_BOT.name}` : c))
    ),
  ];
  return names.length > 0 ? names.join(', ') : fallback;
}

/** What the panel shows of the owner whose wiki it is. */
export interface AccountLabel {
  /** `@username`. */
  name: string;
  /** The day of their latest observation, as the export wrote it, else null. */
  asOf: string | null;
  /**
   * How often the inventory estimate agreed with the bot's /ricetta lists, as a
   * percentage rounded down (`98,5%`: 100% only when always); null if never compared.
   */
  agreement: string | null;
}

export function accountLabel(
  p: Pick<PlayerState, 'player' | 'as_of' | 'inventory_check'>
): AccountLabel {
  const day = /^(\d{4})-(\d{2})-(\d{2})/u.exec(p.as_of ?? '');
  const { compared, agreed } = p.inventory_check;
  return {
    name: `@${p.player}`,
    asOf:
      day === null
        ? null
        : `${Number(day[3])} ${MONTHS[Number(day[2]) - 1] as string} ${day[1] as string}`,
    agreement:
      compared > 0
        ? `${(Math.floor((agreed * 1000) / compared) / 10).toLocaleString('it-IT')}%`
        : null,
  };
}

/** What the list shows of an export, within the card of its chat. */
export interface EntryLabel {
  /** The days of its messages (exports with a record), else what is going on (in coda, in lettura…). */
  text: string;
  /** Its status, as an emoji. */
  icon: string;
  /** Its status, in words: the emoji's label. */
  status: string;
  /** What the player should know besides: an error, or how to make it count again. */
  detail: string | null;
}

const ICONS: Record<ExportEntry['status'], string> = {
  queued: '⏳',
  reading: '⏳',
  ready: '✅',
  stale: '⚠️',
  error: '❌',
};

export function entryLabel(e: ExportEntry): EntryLabel {
  const recorded = e.info !== undefined && (e.status === 'ready' || e.status === 'stale');
  const label: EntryLabel = { text: '', icon: ICONS[e.status], status: 'pronta', detail: null };
  if (e.status === 'queued') label.status = 'in coda';
  else if (e.status === 'reading')
    label.status = `in lettura: ${e.done ?? 0} di ${e.total ?? 0} pagine`;
  else if (e.status === 'stale') {
    label.status = 'da ricaricare';
    label.detail = `Letta da una versione precedente della pagina: aggiungi di nuovo la cartella ${e.folder} perché conti.`;
  } else if (e.status === 'error') {
    label.status = 'errore';
    label.detail = e.message ?? 'Non è stato possibile leggerla.';
  }
  label.text = recorded ? exportDays(e.info as RecordInfo) : label.status;
  return label;
}

/** A card of the list of exports: a chat, and its exports. */
export interface ChatCard {
  /** The chat's id among the cards. */
  key: string;
  /**
   * The chat's name, as its newest export titles it (a chat may be renamed); the
   * example's; the folder's while the export has no record (queued, reading, failed).
   */
  name: string;
  /** Its exports: oldest first. */
  entries: ExportEntry[];
}

const DM_NAME = `@${INVENTORY_BOT.name}`;
const DEMO_NAME = 'Esempio: un giocatore inventato';

/** A date title as a number that orders dates (by wall clock), -1 without one. */
function dateOrder(title: string | null | undefined): number {
  const d = wallClock(title ?? null);
  return d === null
    ? -1
    : ((((d.year * 13 + d.month) * 32 + d.day) * 24 + d.hour) * 60 + d.minute) * 60 + d.second;
}

/**
 * The cards of the list of exports: one per chat (ExportEntry.chat), the private chat
 * with the bot (or the example) first, then the others by name, then each export without
 * a record yet (queued, being read, failed), in the order added.
 */
export function chatCards(exports: readonly ExportEntry[]): ChatCard[] {
  const chats = new Map<string, ExportEntry[]>();
  const pending: ChatCard[] = [];
  for (const e of exports) {
    if (e.info === undefined) {
      pending.push({
        key: e.id,
        name: e.folder === DEMO_FOLDER ? DEMO_NAME : e.folder,
        entries: [e],
      });
      continue;
    }
    const key = e.chat ?? e.id;
    chats.set(key, [...(chats.get(key) ?? []), e]);
  }
  const cards = [...chats].map(([key, entries]): ChatCard => {
    const ordered = entries.toSorted(
      (a, b) => dateOrder(a.info?.firstDate) - dateOrder(b.info?.firstDate)
    );
    const newest = entries.reduce((n, e) =>
      dateOrder(e.info?.lastDate) > dateOrder(n.info?.lastDate) ? e : n
    );
    const name =
      newest.folder === DEMO_FOLDER
        ? DEMO_NAME
        : chatName(newest.info as RecordInfo, newest.folder);
    return { key, name, entries: ordered };
  });
  const first = (c: ChatCard): number => (c.name === DM_NAME || c.name === DEMO_NAME ? 0 : 1);
  cards.sort((a, b) => first(a) - first(b) || a.name.localeCompare(b.name, 'it'));
  return [...cards, ...pending];
}

export const PHASE_LABELS: Record<Phase, string> = {
  parse: 'Lettura dei messaggi',
  conversation: 'Abbinamento delle risposte ai comandi',
  interpret: 'Interpretazione delle risposte del bot',
  build: 'Costruzione della wiki',
};

/**
 * The header's progress line: the export being read, else the build's phase, else the
 * exports waiting; null when nothing is going on.
 */
export function activityText(exports: readonly ExportEntry[], phase: Phase | null): string | null {
  const reading = exports.find((e) => e.status === 'reading');
  const queued = exports.filter((e) => e.status === 'queued').length;
  const waiting = queued === 1 ? 'un’altra in coda' : `altre ${queued} in coda`;
  if (reading !== undefined)
    return (
      `Lettura di ${reading.folder}: ${reading.done ?? 0} di ${reading.total ?? 0} pagine` +
      (queued > 0 ? ` (${waiting})` : '')
    );
  if (phase !== null) return `${PHASE_LABELS[phase]}…`;
  if (queued > 0)
    return queued === 1 ? 'Un’esportazione in coda' : `${queued} esportazioni in coda`;
  return null;
}
