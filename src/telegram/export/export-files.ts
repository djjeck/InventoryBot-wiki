/**
 * Node adapter for phase 1 (export parsing): finds export pages on disk and reads them.
 * Folders only: zip input is not supported.
 *
 * Directory walks are depth-first, take the entries of every folder sorted by name (code
 * point order) and do not follow symlinked folders. A folder comes before its
 * subfolders, which are visited in name order: the same order as comparePaths. The
 * order decides the order of the warnings and of the pages, so output is the same on
 * every OS and file system.
 */
import * as fs from 'node:fs';
import { comparePaths, normalizePath, pathParent, pathSuffix } from '#src/lib/paths.ts';
import { compareCodePoints } from '#src/lib/text.ts';
import { type Message, type Page } from '#src/telegram/messages.ts';
import {
  PAGE,
  pageKey,
  type ParseOptions,
  parsePages,
  type ParseResult,
  summaryLine,
} from './parse-export.ts';

export type Log = (line: string) => void;

const PAGE_GLOB = /^messages[^/]*\.html$/; // glob "messages*.html"
const ZIP_GLOB = /^[^/]*\.zip$/; // glob "*.zip"

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function lexists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Directory entries sorted by name (code point order); empty if the folder cannot be read. */
function readDirEntries(dir: string): fs.Dirent[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => compareCodePoints(a.name, b.name));
  } catch {
    return [];
  }
}

/** Folders under `root`, `root` included, each with a trailing "/": each folder, then its subfolders by name. */
function* walkDirs(root: string): Generator<string> {
  const dir = root.endsWith('/') ? root : root + '/';
  yield dir;
  for (const e of readDirEntries(dir)) if (e.isDirectory()) yield* walkDirs(dir + e.name + '/'); // symlinked folders are not followed
}

/** Entries of `dir` whose name matches a glob regex. */
function* globDir(dir: string, name: RegExp): Generator<string> {
  const dirSlash = dir.endsWith('/') ? dir : dir + '/';
  for (const e of readDirEntries(dirSlash))
    if (name.test(e.name)) yield normalizePath(dirSlash + e.name);
}

/** Entries matching a glob regex in every folder under `root`. */
function* findMatching(root: string, name: RegExp): Generator<string> {
  for (const dir of walkDirs(root)) yield* globDir(dir, name);
}

/** Paths named `name` (any kind of entry, even a broken symlink) in every folder under `root`. */
function* findNamed(root: string, name: string): Generator<string> {
  for (const dir of walkDirs(root)) if (lexists(dir + name)) yield normalizePath(dir + name);
}

/** A text file: strict UTF-8, BOM kept, `\r\n` and `\r` turned into `\n`. */
function readText(p: string): string {
  return utf8.decode(fs.readFileSync(p)).replace(/\r\n?/g, '\n');
}

function warnJson(where: string, log: Log): void {
  log(
    `salto ${where}: esportazione in formato JSON, è supportato solo il formato HTML ` +
      '(Telegram Desktop -> Esporta cronologia chat -> Formato: HTML)'
  );
}

function warnZip(where: string, log: Log): void {
  log(`salto ${where}: i file zip non vengono letti, estrai l'esportazione in una cartella`);
}

/** Every export page under a folder, in (folder, page number) order. */
export function* iterPages(path: string, log: Log): Generator<Page> {
  const p = normalizePath(path);
  if (isDir(p)) {
    for (const j of findNamed(p, 'result.json')) {
      const parent = pathParent(j);
      if (globDir(parent, PAGE_GLOB).next().done) warnJson(parent, log);
    }
    for (const z of [...findMatching(p, ZIP_GLOB)].sort(comparePaths))
      if (isFile(z)) warnZip(z, log);
    const files = [...findMatching(p, PAGE_GLOB)].filter((f) => PAGE.test(f));
    const keyed = files.map((f) => ({ f, parent: pathParent(f), page: pageKey(f) }));
    keyed.sort((a, b) => comparePaths(a.parent, b.parent) || a.page - b.page);
    for (const { f } of keyed) yield { label: f, html: readText(f) };
  } else if (isFile(p) && pathSuffix(p).toLowerCase() === '.zip') {
    warnZip(p, log);
  } else {
    log(`salto ${p}: non è una cartella né un file .zip`);
  }
}

/**
 * Reads, parses, de-duplicates and sorts the messages of all PATHs, logging the
 * warnings (not the summary line, which names the chats: a caller that renames them
 * prints its own). Throws MissingUtcOffsetError when a macOS export's
 * dates cannot be given a UTC offset.
 */
export function readExportPaths(
  paths: readonly string[],
  log: Log,
  options: ParseOptions
): ParseResult {
  const result = parsePages(
    paths.map((p) => iterPages(p, log)),
    options
  );
  for (const line of result.warnings) log(line);
  return result;
}

/** readExportPaths, then the summary line with the chat titles as written. */
export function parseExportPaths(
  paths: readonly string[],
  log: Log,
  options: ParseOptions
): Message[] {
  const result = readExportPaths(paths, log, options);
  log(summaryLine(result));
  return result.messages;
}
