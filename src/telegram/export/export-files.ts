/**
 * Node adapter for phase 1 (export parsing): lists the entries of input folders on disk
 * and reads their pages; which entries are pages, and the warnings, are decided by
 * export-listing.ts. Folders only: zip input is not supported.
 *
 * Directory walks are depth-first, take the entries of every folder sorted by name (code
 * point order) and do not follow symlinked folders. A folder comes before its
 * subfolders, which are visited in name order: the same order as comparePaths.
 */
import * as fs from 'node:fs';
import { normalizePath, pathSuffix } from '#src/lib/paths.ts';
import { compareCodePoints } from '#src/lib/text.ts';
import { type Message, type Page } from '#src/telegram/messages.ts';
import {
  decodeText,
  type ExportEntry,
  listExport,
  notAFolderWarning,
  zipWarning,
} from './export-listing.ts';
import { type ParseOptions, parsePages, type ParseResult, summaryLine } from './parse-export.ts';

export type Log = (line: string) => void;

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

/** Every entry under the folder `root` (any kind; symlinked folders are not followed). */
function* walkEntries(root: string): Generator<ExportEntry> {
  const dir = root.endsWith('/') ? root : root + '/';
  for (const e of readDirEntries(dir)) {
    const p = normalizePath(dir + e.name);
    yield { path: p, isFile: () => isFile(p) };
    if (e.isDirectory()) yield* walkEntries(dir + e.name + '/');
  }
}

/** A text file: strict UTF-8, BOM kept, `\r\n` and `\r` turned into `\n` (decodeText). */
function readText(p: string): string {
  return decodeText(fs.readFileSync(p));
}

/** Every export page under a folder, in (folder, page number) order. */
export function* iterPages(path: string, log: Log): Generator<Page> {
  const p = normalizePath(path);
  if (isDir(p)) {
    const { pages, warnings } = listExport([...walkEntries(p)]);
    for (const w of warnings) log(w);
    for (const f of pages) yield { label: f, html: readText(f) };
  } else if (isFile(p) && pathSuffix(p).toLowerCase() === '.zip') {
    log(zipWarning(p));
  } else {
    log(notAFolderWarning(p));
  }
}

/**
 * Reads, parses, de-duplicates and sorts the messages of all paths, logging the
 * warnings (not the summary line, which names the chats: a caller that renames them
 * prints its own).
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
