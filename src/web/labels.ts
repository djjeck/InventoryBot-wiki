/**
 * What the page (main.ts) writes about the exports and the work in progress, in Italian:
 * an export's chat name, the days of its first and last message, its status, the owner
 * whose wiki it is, and the header's progress line. Pure functions, tested in Node.
 */
import { INVENTORY_BOT } from '#src/inventorybot/bot.ts';
import { type PlayerState } from '#src/inventorybot/types.ts';
import { parseMacDate, parseWindowsDate, type WallClock } from '#src/lib/dates.ts';
import { type Phase } from '#src/pipeline.ts';
import { type ExportEntry } from './protocol.ts';
import { type RecordInfo } from './storage.ts';

const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

/**
 * The day of a date title as the export wrote it (`27.11.2025 19:14:19 UTC-05:00`, or
 * the macOS `27 November 2025, 19:14:19`), in Italian: `27 nov 2025`; null if not a date.
 * The wall clock is the export's: the day the player saw in Telegram.
 */
export function exportDay(title: string | null): string | null {
  const d: WallClock | null = parseWindowsDate(title) ?? parseMacDate(title);
  return d === null ? null : `${d.day} ${MONTHS[d.month - 1] as string} ${d.year}`;
}

/** The days of an export's first and last message: `dal 3 ott 2026 al 17 ott 2026`, or one day. */
export function exportDays(info: Pick<RecordInfo, 'firstDate' | 'lastDate'>): string {
  const first = exportDay(info.firstDate);
  const last = exportDay(info.lastDate);
  if (first === null || last === null) return first ?? last ?? 'senza date';
  return first === last ? first : `dal ${first} al ${last}`;
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

/** What the list shows of an export. */
export interface EntryLabel {
  /** The chat's name; the folder's while the export has no record (queued, reading, failed). */
  name: string;
  /** The days of its messages (exports with a record), else null. */
  days: string | null;
  /** Its status, short. */
  status: string;
  /** What the player should know besides: an error, or how to make it count again. */
  detail: string | null;
}

export function entryLabel(e: ExportEntry): EntryLabel {
  const recorded = e.info !== undefined && (e.status === 'ready' || e.status === 'stale');
  const label: EntryLabel = {
    name: recorded ? chatName(e.info as RecordInfo, e.folder) : e.folder,
    days: recorded ? exportDays(e.info as RecordInfo) : null,
    status: 'pronta',
    detail: null,
  };
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
  return label;
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
