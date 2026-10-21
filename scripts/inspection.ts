/**
 * The work of `npm run inspect` (scripts/inspect.ts): the web app's pipeline on exports
 * read from disk, for development. Each export becomes a record (processExport), kept in
 * the output folder and read back by later runs, then the wiki is built from every record
 * (buildWiki), as the web app's worker does. What it prints is an aggregate summary,
 * without message texts or names; the wiki and the player state go to files.
 *
 * The output folder holds:
 * - `wiki.json`, `player.json`: the wiki and the player state the page draws;
 * - `salt`: the secret salt of the pseudonyms and sender keys, made once;
 * - `records/<hash>.json`: the record of each export read, keyed by the hash of its pages
 *   (ExportRecord.hash), with a fingerprint of the salt that made it. A record of another
 *   format version or salt is dropped and the export read again; without a salt file, the
 *   records are dropped.
 *
 * The tool refuses an output folder inside the repository that git does not ignore:
 * anything derived from exports stays out of git history, and `validate` rewrites every
 * file that is not ignored.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { INVENTORY_BOT } from '#src/inventorybot/bot.ts';
import { type PlayerState, type Wiki } from '#src/inventorybot/types.ts';
import { isTimeZone, parseMacDate, parseWindowsDate } from '#src/lib/dates.ts';
import { buildWiki, type Phase, processExport } from '#src/pipeline.ts';
import { iterPages, type Log } from '#src/telegram/export/export-files.ts';
import { exportKey } from '#src/telegram/export/parse-export.ts';
import {
  exportHash,
  type ExportRecord,
  RECORD_FORMAT_VERSION,
} from '#src/telegram/export/record.ts';
import { type Page } from '#src/telegram/messages.ts';

/** A wrong command line: exit code 2. */
export class UsageError extends Error {}

export const USAGE =
  'usage: npm run inspect -- [FOLDER ...] [--out DIR] [--player NAME] [--time-zone ZONE]';

export interface InspectArgs {
  /** Folders holding one or more exports, as given. */
  folders: string[];
  /** The output folder. */
  out: string;
  /** The owner's username without `@`; null to take it from the DM. */
  player: string | null;
  /** IANA time zone for the dates of macOS exports. */
  timeZone: string;
}

const OPTIONS: Record<string, 'out' | 'player' | 'timeZone'> = {
  '--out': 'out',
  '--player': 'player',
  '--time-zone': 'timeZone',
};

/**
 * The command line, options as `--out X` or `--out=X`; `--` ends the options. Without
 * folders, `defaults.inbox`; without `--out`, `defaults.out`; without `--time-zone`,
 * `defaults.timeZone`. Unknown options, missing values and unknown time zones are
 * UsageErrors.
 */
export function parseInspectArgs(
  argv: readonly string[],
  defaults: { inbox: string; out: string; timeZone: string }
): InspectArgs {
  const folders: string[] = [];
  const values: Partial<Record<'out' | 'player' | 'timeZone', string>> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--') {
      folders.push(...argv.slice(i + 1));
      break;
    }
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const name = eq > 0 ? a.slice(0, eq) : a;
    const key = OPTIONS[name];
    if (key !== undefined) {
      const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
      if (v === undefined || v === '') throw new UsageError(`${name}: missing value`);
      values[key] = v;
    } else if (a.startsWith('-') && a !== '-') {
      throw new UsageError(`unknown option: ${a}`);
    } else {
      folders.push(a);
    }
  }
  const timeZone = values.timeZone ?? defaults.timeZone;
  if (!isTimeZone(timeZone))
    throw new UsageError(`--time-zone: not an IANA time zone (e.g. Europe/Rome): ${timeZone}`);
  const player = values.player?.replace(/^@/u, '') || null;
  return {
    folders: folders.length > 0 ? folders : [defaults.inbox],
    out: values.out ?? defaults.out,
    player,
    timeZone,
  };
}

/** The time zone of this computer, else UTC. */
export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** A path with its symlinks resolved, as far as it exists: the rest appended as given. */
function realPath(p: string): string {
  const abs = path.resolve(p);
  const missing: string[] = [];
  let at = abs;
  while (!fs.existsSync(at)) {
    missing.unshift(path.basename(at));
    at = path.dirname(at);
  }
  return path.join(fs.realpathSync(at), ...missing);
}

/**
 * Why the tool must not write to `out`, or null when it may: a folder inside the
 * repository at `root` must be one git ignores (`git check-ignore`); one outside it is
 * allowed.
 */
export function outputRefusal(out: string, root: string): string | null {
  const rel = path.relative(realPath(root), realPath(out));
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const refusal = `refusing to write to ${out}: it is inside the repository and git does not ignore it`;
  if (rel === '') return refusal;
  try {
    execFileSync('git', ['check-ignore', '-q', rel.split(path.sep).join('/') + '/'], {
      cwd: root,
      stdio: 'ignore',
    });
    return null;
  } catch {
    return refusal;
  }
}

export const SALT_FILE = 'salt';
export const RECORDS_DIR = 'records';

/**
 * The salt kept in `dir`, made at random (`make`) when there is none; records left from
 * another salt are dropped with it.
 */
export function saltIn(dir: string, make = (): string => randomBytes(16).toString('hex')): string {
  const file = path.join(dir, SALT_FILE);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf-8').trim();
  fs.rmSync(path.join(dir, RECORDS_DIR), { recursive: true, force: true });
  const salt = make();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, salt + '\n', 'utf-8');
  return salt;
}

/** What a record file holds: the record and a fingerprint of the salt that made it. */
interface CacheEntry {
  salt: string;
  record: ExportRecord;
}

/** A fingerprint of the salt, so a record file tells which salt made it without holding it. */
function saltFingerprint(salt: string): string {
  return createHash('sha256').update(`record-salt\u0000${salt}`).digest('hex').slice(0, 16);
}

const recordFile = (dir: string, hash: string): string =>
  path.join(dir, RECORDS_DIR, `${hash}.json`);

/**
 * The record kept in `dir` for the export whose pages hash to `hash`, if it was made with
 * `salt` and in the current format; any other file there is deleted.
 */
export function cachedRecord(dir: string, hash: string, salt: string): ExportRecord | null {
  const file = recordFile(dir, hash);
  if (!fs.existsSync(file)) return null;
  try {
    const entry = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<CacheEntry>;
    const r = entry.record;
    if (
      entry.salt === saltFingerprint(salt) &&
      r?.formatVersion === RECORD_FORMAT_VERSION &&
      r.hash === hash
    )
      return r;
  } catch {
    // An unreadable file: read the export again.
  }
  fs.rmSync(file, { force: true });
  return null;
}

/** Keeps a record made with `salt` in `dir`, under its hash. */
export function cacheRecord(dir: string, record: ExportRecord, salt: string): void {
  const file = recordFile(dir, record.hash);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entry: CacheEntry = { salt: saltFingerprint(salt), record };
  fs.writeFileSync(file, JSON.stringify(entry), 'utf-8');
}

/** The pages split by export (consecutive pages of one folder), one export in memory at a time. */
export function* exportsOf(pages: Iterable<Page>): Generator<Page[]> {
  let current: Page[] = [];
  for (const page of pages) {
    if (current.length > 0 && exportKey(page.label) !== exportKey((current[0] as Page).label)) {
      yield current;
      current = [];
    }
    current.push(page);
  }
  if (current.length > 0) yield current;
}

/** One export of the run, as the summary shows it. */
export interface ExportLine {
  /** Its folder, under the input folder as given. */
  folder: string;
  dm: boolean;
  firstDate: string | null;
  lastDate: string | null;
  messages: number;
  fromBot: number;
  /** cached: the kept record; parsed: read now; duplicate: the same pages as an earlier one. */
  source: 'cached' | 'parsed' | 'duplicate';
}

/** The day of a date title (Windows or macOS export) as `YYYY-MM-DD`, else `?`. */
export function dayOf(title: string | null): string {
  const d = parseWindowsDate(title) ?? parseMacDate(title);
  if (d === null) return '?';
  const p = (n: number, w: number): string => String(n).padStart(w, '0');
  return `${p(d.year, 4)}-${p(d.month, 2)}-${p(d.day, 2)}`;
}

/** The records of every export under the folders: kept ones read back, the others parsed and kept. */
export async function collectRecords(
  folders: readonly string[],
  out: string,
  salt: string,
  log: Log
): Promise<{ records: ExportRecord[]; lines: ExportLine[] }> {
  const records: ExportRecord[] = [];
  const lines: ExportLine[] = [];
  for (const folder of folders)
    for (const pages of exportsOf(iterPages(folder, log))) {
      const hash = await exportHash(pages);
      const exportFolder = exportKey((pages[0] as Page).label);
      let source: ExportLine['source'] = 'duplicate';
      let record = records.find((r) => r.hash === hash);
      if (record === undefined) {
        const cached = cachedRecord(out, hash, salt);
        source = cached === null ? 'parsed' : 'cached';
        record =
          cached === null
            ? await processExport(pages, { salt })
            : { ...cached, folder: exportFolder };
        if (cached === null) cacheRecord(out, record, salt);
        records.push(record);
      }
      lines.push({
        folder: exportFolder,
        dm: record.chats.includes(INVENTORY_BOT.dmTitle),
        firstDate: record.firstDate,
        lastDate: record.lastDate,
        messages: record.counts.messages,
        fromBot: record.counts.fromBot,
        source,
      });
    }
  return { records, lines };
}

/**
 * The report lines without the entries listed under each `-- kind: N` section, which quote
 * the bot's texts: what is left are counts.
 */
export function aggregateReport(report: readonly string[]): string[] {
  const out: string[] = [];
  let inSection = false;
  for (const line of report) {
    if (!line.startsWith(' ')) inSection = line.startsWith('-- ');
    else if (inSection) continue;
    out.push(line);
  }
  return out;
}

/** `87.5% (7/8)`, or `n/a (0/0)` when nothing was compared. */
export function shareOf(agreed: number, compared: number): string {
  const share = compared === 0 ? 'n/a' : `${((100 * agreed) / compared).toFixed(1)}%`;
  return `${share} (${agreed}/${compared})`;
}

/** What the summary shows of a finished run. */
export interface Summary {
  exports: readonly ExportLine[];
  /** Phase name -> milliseconds, in order. */
  timings: readonly [string, number][];
  report: readonly string[];
  wiki: Pick<Wiki, 'recipes' | 'items' | 'locations'>;
  player: Pick<PlayerState, 'inventory_check'>;
  written: readonly string[];
}

/** The lines of the summary: aggregates, with no message text and no name but the owner's. */
export function formatSummary(s: Summary): string[] {
  const exportLine = (e: ExportLine): string =>
    `  ${e.folder}: ${e.dm ? 'DM' : 'group'}, ${dayOf(e.firstDate)} to ${dayOf(e.lastDate)}, ` +
    `${e.messages} messages, ${e.fromBot} from the bot, ${e.source}`;
  const { compared, agreed } = s.player.inventory_check;
  return [
    `exports: ${s.exports.length}`,
    ...s.exports.map(exportLine),
    'timings:',
    ...s.timings.map(([name, ms]) => `  ${name}: ${(ms / 1000).toFixed(2)} s`),
    'report:',
    ...aggregateReport(s.report).map((l) => `  ${l}`),
    `wiki: ${Object.keys(s.wiki.recipes).length} recipes, ${Object.keys(s.wiki.items).length} ` +
      `items, ${Object.keys(s.wiki.locations).length} places`,
    `inventory check: ${shareOf(agreed, compared)} of the estimates agreed with the bot`,
    'written:',
    ...s.written.map((f) => `  ${f}`),
  ];
}

/** The line when no export names the owner. */
export const NO_OWNER =
  'stopped: no private chat with the bot among the exports, so the owner is unknown: ' +
  'pass --player NAME';

/** Milliseconds since `start`. */
const since = (start: number): number => performance.now() - start;

/**
 * A run of the tool: reads the exports, builds the wiki, writes the outputs and prints the
 * summary. Returns the exit code: 0 done, 1 stopped (no export, no owner), 2 refused
 * output folder.
 */
export async function inspect(
  args: InspectArgs,
  root: string,
  print: Log,
  warn: Log
): Promise<number> {
  const refusal = outputRefusal(args.out, root);
  if (refusal !== null) {
    warn(refusal);
    return 2;
  }
  const salt = saltIn(args.out);
  let start = performance.now();
  const { records, lines } = await collectRecords(args.folders, args.out, salt, warn);
  const timings: [string, number][] = [['read exports', since(start)]];
  if (records.length === 0) {
    warn(`stopped: no Telegram HTML export in ${args.folders.join(', ')}`);
    return 1;
  }
  const names: Record<Phase, string> = {
    parse: 'read exports',
    conversation: 'conversation and anonymisation (phases 2-3)',
    interpret: 'interpretation (phase 4)',
    build: 'wiki and player state (phase 5)',
  };
  let current = 'merge (end of phase 1)';
  start = performance.now();
  const outcome = buildWiki(
    records,
    { player: args.player, salt, timeZone: args.timeZone },
    (phase) => {
      timings.push([current, since(start)]);
      current = names[phase];
      start = performance.now();
    }
  );
  timings.push([current, since(start)]);
  if (outcome.status === 'no-owner') {
    warn(NO_OWNER);
    return 1;
  }
  start = performance.now();
  const written = [
    ['wiki.json', outcome.wiki],
    ['player.json', outcome.player],
  ].map(([name, value]) => {
    const file = path.join(args.out, name as string);
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf-8');
    return file;
  });
  written.push(path.join(args.out, SALT_FILE), path.join(args.out, RECORDS_DIR) + path.sep);
  timings.push(['write', since(start)]);
  for (const line of formatSummary({
    exports: lines,
    timings,
    report: outcome.report,
    wiki: outcome.wiki,
    player: outcome.player,
    written,
  }))
    print(line);
  return 0;
}
