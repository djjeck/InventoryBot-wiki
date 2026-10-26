/**
 * Phase 1 in two steps, so that each export is parsed once: readExport() reads the pages
 * of one export into an ExportRecord, plain JSON data that can be kept and read again;
 * mergeExports() joins the records of a run into the messages of phase 1. parsePages() is
 * the two in a row. Generic: the bot is a parameter (BotIdentity). Pure logic, no Node
 * APIs; the hashes are the platform's Web Crypto (`crypto.subtle`, in browsers, workers
 * and Node), which is asynchronous, so readExport() is too. The merge is synchronous.
 *
 * A record keeps in full only what phase 2 reads the text of: the bot's messages (with
 * the text file one has attached, file_text) and the commands for the bot (not forwarded). Every other message (ordinary chat, commands for
 * other bots, forwarded commands) keeps no text, only what phase 2 still reads of it: its
 * chat, id, date, display name and sender key. The merge gives such a message an empty
 * text, so that phases 2 to 5 give the same results as with the whole chat.
 *
 * Merging needs all the records of a run: the dates of a macOS export get their UTC
 * offset from the other exports that share messages with it, and de-duplication, sorting
 * and the placing of undated messages look across exports. So a record keeps a macOS date
 * as written, and the merge converts it.
 */
import { epochSeconds, formatWindowsDate, parseMacDate, parseWindowsDate } from '#src/lib/dates.ts';
import { pathName } from '#src/lib/paths.ts';
import { compareCodePoints } from '#src/lib/text.ts';
import { type BotIdentity } from '#src/telegram/bot.ts';
import { isBotCommand, resolveCommand } from '#src/telegram/conversation/commands.ts';
import { type Message, type Page } from '#src/telegram/messages.ts';
import {
  type DatedCopy,
  exportKey,
  type ExportOffset,
  exportOffsets,
  ExportParser,
  sortMessages,
} from './parse-export.ts';

/**
 * The shape of ExportRecord, and what it keeps in full; a record of another version must be
 * read again from its pages. 2: the posts of the bot's channels are kept in full.
 */
export const RECORD_FORMAT_VERSION = 2;

/**
 * A message phase 2 reads no text of: `[chat, id, date, sender, sender_key]`, with `chat`
 * an index into ExportRecord.chats and `sender` one into ExportRecord.senders (null for
 * no display name).
 */
export type MessageStub = [
  chat: number,
  id: number,
  date: string | null,
  sender: number | null,
  sender_key: string | null,
];

/** What readExport() keeps of one export: plain JSON data. */
export interface ExportRecord {
  formatVersion: typeof RECORD_FORMAT_VERSION;
  /** The export's folder, as its page labels give it (exportKey). */
  folder: string;
  /**
   * SHA-256 (hex) of the export's pages, file names and HTML, in order: the same for the
   * same export read from anywhere.
   */
  hash: string;
  /** Number of pages read. */
  pages: number;
  /** Chat titles of its messages, in first-appearance order; null for a page without one. */
  chats: (string | null)[];
  /** Display names of the senders of its stubs, in first-appearance order. */
  senders: string[];
  /** Date titles, as written, of its earliest and latest message (null without dates). */
  firstDate: string | null;
  lastDate: string | null;
  /** Messages read; of them, written by the bot; kept in full (as Message). */
  counts: { messages: number; fromBot: number; kept: number };
  /**
   * Every message, in page order: in full when phase 2 reads its text or it is a post of
   * one of the bot's channels, else a stub. A
   * date is as written (a macOS date has no offset yet), and `sender_key` is the salted
   * one of senderKey().
   */
  entries: (Message | MessageStub)[];
}

export interface ReadOptions {
  /** The bot the exports are about. */
  bot: BotIdentity;
  /** The secret salt of the sender keys (senderKey), the same for every record of a run. */
  salt: string;
  /** Keep every message in full, ordinary chat included: only to check that dropping it changes nothing. */
  keepAll?: boolean;
}

const encoder = new TextEncoder();

/** The SHA-256 of bytes, as 64 lower-case hex digits: the platform's (Web Crypto). */
async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Bytes joined into one buffer. */
function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * The bytes of a page that its export's hash covers: its file name, length and HTML, then
 * each of its text files (Page.files), by link: an export read again with its files is
 * another export.
 */
function hashedBytes(page: Page): Uint8Array[] {
  const out = [
    encoder.encode(`${pathName(page.label)}\n${page.html.length}\n`),
    encoder.encode(page.html),
  ];
  for (const [link, text] of [...(page.files ?? [])].sort((a, b) => compareCodePoints(a[0], b[0])))
    out.push(encoder.encode(`${link}\n${text.length}\n`), encoder.encode(text));
  return out;
}

/**
 * The hash of one export's pages (ExportRecord.hash), without parsing them: a caller that
 * keeps records can tell whether it has an export's record already.
 */
export function exportHash(pages: Iterable<Page>): Promise<string> {
  return sha256Hex(concat([...pages].flatMap(hashedBytes)));
}

/**
 * The opaque key of a Telegram user id: a salted SHA-256 of it, 16 hex digits. The same
 * user has the same key in every export read with the same salt, and nobody without the
 * salt can work back to the id, as they could from a hash of the id alone.
 */
export async function senderKey(salt: string, userId: string): Promise<string> {
  return (await sha256Hex(encoder.encode(`${salt}\u0000id:${userId}`))).slice(0, 16);
}

/** The pages of one input path split by export (exportKey): consecutive pages of one folder. */
export function splitExports(pages: Iterable<Page>): Page[][] {
  const out: Page[][] = [];
  let prev: string | null = null;
  for (const page of pages) {
    const exp = exportKey(page.label);
    if (exp !== prev) out.push([]);
    (out[out.length - 1] as Page[]).push(page);
    prev = exp;
  }
  return out;
}

/** A date title's instant for ordering: a macOS wall clock read as UTC; null if no date. */
function roughSeconds(date: string | null): number | null {
  const w = parseWindowsDate(date);
  if (w !== null) return epochSeconds(w);
  const mac = parseMacDate(date);
  return mac === null ? null : epochSeconds({ ...mac, offsetMinutes: 0 });
}

/**
 * Whether a message is kept in full: the bot's, a command for the bot (both read by phase
 * 2), or a post of one of the bot's channels (BotIdentity.channels).
 */
function keptInFull(m: Message, bot: BotIdentity): boolean {
  return (
    m.from_bot ||
    (!m.forwarded_from && isBotCommand(resolveCommand(m, bot.name))) ||
    (m.chat !== null && m.chat !== undefined && (bot.channels ?? []).includes(m.chat))
  );
}

/**
 * Reads the pages of one export (one folder: pages with one exportKey, in page order) into
 * a record. Throws on pages of two folders, and on none.
 */
export async function readExport(
  pages: Iterable<Page>,
  options: ReadOptions
): Promise<ExportRecord> {
  const hashed: Uint8Array[] = [];
  let folder: string | null = null;
  let count = 0;
  let lastSender: string | null = null;
  let lastSenderId: string | null = null;
  const chats = new Map<string | null, number>();
  const senders = new Map<string, number>();
  /** Each entry whose sender's user id is known, with that id: keyed once parsing ends. */
  const ids: [entry: number, id: string][] = [];
  const entries: (Message | MessageStub)[] = [];
  const counts = { messages: 0, fromBot: 0, kept: 0 };
  let first: [number, string] | null = null;
  let last: [number, string] | null = null;
  const index = <K>(map: Map<K, number>, k: K): number => {
    let i = map.get(k);
    if (i === undefined) map.set(k, (i = map.size));
    return i;
  };
  for (const page of pages) {
    const exp = exportKey(page.label);
    if (folder === null) folder = exp;
    else if (exp !== folder)
      throw new Error(`pages of two exports in one record: ${folder}, ${exp}`);
    count++;
    hashed.push(...hashedBytes(page));
    // Pages of one export are consecutive: carry the sender across page breaks.
    const p: ExportParser = new ExportParser(options.bot, lastSender, lastSenderId);
    p.feed(page.html, page.files);
    p.close();
    lastSender = p.lastSender;
    lastSenderId = p.lastSenderId;
    for (const m of p.messages) {
      counts.messages++;
      if (m.from_bot) counts.fromBot++;
      const t = roughSeconds(m.date);
      if (t !== null && m.date !== null) {
        if (first === null || t < first[0]) first = [t, m.date];
        if (last === null || t >= last[0]) last = [t, m.date];
      }
      const id = p.authorIds.get(m);
      if (id !== undefined) ids.push([entries.length, id]);
      index(chats, m.chat);
      if (options.keepAll || keptInFull(m, options.bot)) {
        counts.kept++;
        entries.push(m);
      } else {
        const sender = m.sender === null ? null : index(senders, m.sender);
        entries.push([index(chats, m.chat), m.id, m.date, sender, null]);
      }
    }
  }
  if (folder === null) throw new Error('an export without pages');
  const distinct = [...new Set(ids.map(([, id]) => id))];
  const keys = new Map(
    await Promise.all(
      distinct.map(async (id): Promise<[string, string]> => [id, await senderKey(options.salt, id)])
    )
  );
  for (const [i, id] of ids) {
    const e = entries[i] as Message | MessageStub;
    const key = keys.get(id) as string;
    if (Array.isArray(e)) e[4] = key;
    else entries[i] = { ...e, sender_key: key };
  }
  const hash = await sha256Hex(concat(hashed));
  return {
    formatVersion: RECORD_FORMAT_VERSION,
    folder,
    hash,
    pages: count,
    chats: [...chats.keys()],
    senders: [...senders.keys()],
    firstDate: first?.[1] ?? null,
    lastDate: last?.[1] ?? null,
    counts,
    entries,
  };
}

export interface MergeOptions {
  /** The bot the exports are about. */
  bot: BotIdentity;
  /**
   * The IANA time zone (`Europe/Rome`) of the computer that made the exports, for the
   * dates of macOS exports, which have no offset, when the run gives none (exportOffsets).
   */
  timeZone: string;
}

export interface ParseResult {
  /**
   * De-duplicated by (chat, id), the copy read last winning, except that a date read with
   * its UTC offset is kept over one converted from a macOS export, and a known sender key
   * and a known file text are kept; sorted by sortKey. A stub's message has an empty text and no forward or reply.
   */
  messages: Message[];
  /** Number of exports (records). */
  exports: number;
  /** Chat titles, sorted by code point; a missing or empty title is "?". */
  chats: string[];
  /** Lines for the user about the UTC offset given to the dates of macOS exports. */
  warnings: string[];
}

/** A stub as a message of phase 1: no text, no forward, no reply. */
function stubMessage(r: ExportRecord, s: MessageStub, bot: BotIdentity): Message {
  const [chatIndex, id, date, sender, key] = s;
  const chat = r.chats[chatIndex] ?? null;
  const m: Message = {
    chat,
    dm: chat === bot.dmTitle,
    id,
    date,
    from_bot: false,
    sender: sender === null ? null : (r.senders[sender] ?? null),
    forwarded_from: null,
    reply_to: null,
    text: '',
  };
  if (key !== null) m.sender_key = key;
  return m;
}

/**
 * Joins the records of a run, in order, into the messages of phase 1. Gives macOS dates
 * their UTC offset (exportOffsets) and converts them to the Windows form, so later phases
 * see one date format, then de-duplicates and sorts. The records are left unchanged.
 */
export function mergeExports(records: readonly ExportRecord[], options: MergeOptions): ParseResult {
  // The records' own messages are copied: the dates are converted in place.
  const copies: (DatedCopy & { m: Message })[] = [];
  records.forEach((r, i) => {
    for (const e of r.entries) {
      const m = Array.isArray(e) ? stubMessage(r, e, options.bot) : { ...e };
      copies.push({ m, exp: String(i), local: parseMacDate(m.date) });
    }
  });
  const warnings: string[] = [];
  const label = (exp: string): string => (records[Number(exp)] as ExportRecord).folder;
  const offsets = exportOffsets(copies, options.timeZone, warnings, label);
  const byKey = new Map<string, { m: Message; local: boolean }>();
  for (const c of copies) {
    const m = c.m;
    let local = c.local !== null;
    if (c.local !== null)
      m.date = formatWindowsDate({
        ...c.local,
        offsetMinutes: (offsets.get(c.exp) as ExportOffset)(c.local),
      });
    const k = JSON.stringify([m.chat, m.id]);
    const prev = byKey.get(k);
    if (prev !== undefined) {
      // One date per message: a converted date gives way to one Telegram wrote with its offset.
      if (local && !prev.local && parseWindowsDate(prev.m.date) !== null) {
        m.date = prev.m.date;
        local = false;
      }
      if (m.sender_key === undefined && prev.m.sender_key !== undefined)
        m.sender_key = prev.m.sender_key;
      // An export made without its files keeps no file text: another copy's is the message's.
      if (m.file_text === undefined && prev.m.file_text !== undefined)
        m.file_text = prev.m.file_text;
    }
    byKey.set(k, { m, local });
  }
  const messages = sortMessages([...byKey.values()].map((c) => c.m));
  const chats = [...new Set(messages.map((m) => m.chat || '?'))].sort(compareCodePoints);
  return { messages, exports: records.length, chats, warnings };
}

export type ParseOptions = ReadOptions & MergeOptions;

/**
 * Parses the pages of each input path: each export of each path (splitExports) read into
 * a record (readExport), then the records merged (mergeExports).
 */
export async function parsePages(
  paths: Iterable<Iterable<Page>>,
  options: ParseOptions
): Promise<ParseResult> {
  const records: ExportRecord[] = [];
  for (const pages of paths)
    for (const p of splitExports(pages)) records.push(await readExport(p, options));
  return mergeExports(records, options);
}

/** The report line printed after parsing. */
export function summaryLine(r: Pick<ParseResult, 'exports' | 'chats'>): string {
  return `cartelle di esportazione: ${r.exports}; chat: ${r.chats.join(', ')}`;
}
