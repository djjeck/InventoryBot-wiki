/**
 * The messages between the web page (main.ts) and its worker (worker.ts, run.ts), which
 * owns the storage (storage.ts) and runs the pipeline. The page asks for the `state`
 * first; then it adds exports, removes them, asks for a rebuild with other options, or
 * clears everything. The worker answers with the list of exports, the progress of each
 * export and of each build, and the results of every build that finishes.
 *
 * Everything sent is structured-cloneable: browser `File` objects (which stay handles to
 * the files on disk: only the export pages are read, in the worker) and plain data.
 */
import { type PlayerState, type Wiki } from '#src/inventorybot/types.ts';
import { type Phase } from '#src/pipeline.ts';
import { type FileLike } from '#src/telegram/export/browser-files.ts';
import { type RecordInfo } from './storage.ts';

/** The options of a build, as the player sets them (the salt stays in the worker). */
export interface BuildOptions {
  /**
   * The IANA time zone of the computer that made the exports (the page proposes this
   * browser's), for the dates of macOS exports, which have no offset.
   */
  timeZone: string;
  /** The owner's @username without `@`; null: the player the bot addresses most in the DM. */
  player: string | null;
}

/**
 * Page -> worker, first: the stored exports and the saved results. `options` are the
 * page's defaults, used until saved results give the player's own; `salt` is a salt an
 * earlier version of the page kept, adopted when storage has none.
 */
export interface StateRequest {
  type: 'state';
  options: BuildOptions;
  salt?: string;
}

/** Page -> worker: read and keep the exports of these picks (each the files of one folder pick). */
export interface AddRequest {
  type: 'add';
  picks: FileLike[][];
}

/** Page -> worker: drop an export of the list (ExportEntry.id), stored or not. */
export interface RemoveRequest {
  type: 'remove';
  id: string;
}

/** Page -> worker: build again with these options, kept for the next builds. */
export interface RebuildRequest {
  type: 'rebuild';
  options: BuildOptions;
}

/** Page -> worker: delete everything kept ("Cancella i miei dati"). */
export interface ClearRequest {
  type: 'clear';
}

export type PageMessage = StateRequest | AddRequest | RemoveRequest | RebuildRequest | ClearRequest;

/**
 * An export of the list. `queued`, `reading` and `error` ones are not stored (yet): their
 * id is the worker's; `ready` and `stale` ones are stored, their id the record's hash.
 * `stale`: kept by a version of the page with another record format, never built from
 * until it is added again.
 */
export interface ExportEntry {
  id: string;
  status: 'queued' | 'reading' | 'ready' | 'stale' | 'error';
  /** The folder's name. */
  folder: string;
  /** Pages: read so far (`reading`); with `total`, the pages to read. */
  done?: number;
  total?: number;
  /** `error`: what went wrong, in Italian, and the listing's warnings. */
  message?: string;
  details?: string[];
  /** `ready` and `stale`: the stored record. */
  info?: RecordInfo;
}

/** Worker -> page: the answer to `state`, and again after `clear`. */
export interface StateMessage {
  type: 'state';
  exports: ExportEntry[];
  /** The options the worker builds with: the saved results', else the page's defaults. */
  options: BuildOptions;
  /** Whether storage works: false, nothing is kept beyond this visit. */
  storage: boolean;
}

/** Worker -> page: the list of exports changed. */
export interface ExportsMessage {
  type: 'exports';
  exports: ExportEntry[];
  storage: boolean;
}

/** Worker -> page: pages of an export read so far. */
export interface ReadMessage {
  type: 'read';
  id: string;
  done: number;
  total: number;
}

/** Worker -> page: a build step started; `parse` is the first, and the results end it. */
export interface PhaseMessage {
  type: 'phase';
  phase: Phase;
}

/** What a build produced: all that the page shows and keeps (storage.ts). */
export interface RunResult {
  /** The export owner the build was made for (given, or found in the DM). */
  owner: string | null;
  /** The wiki: facts about the game, the same for every player. */
  wiki: Wiki;
  /** The owner's own state. */
  player: PlayerState;
  /** The options of the build. */
  options: BuildOptions;
  /** The report lines: warnings, then the summary. */
  report: string[];
  /** Names of the export folders, in merge order. */
  folders: string[];
  /** Number of export pages read. */
  pages: number;
  /** Number of messages after de-duplication, and how many of them are the bot's. */
  messages: number;
  fromBot: number;
  /** Number of the bot's replies after phase 2. */
  replies: number;
  /** Duration of the build in the worker, in milliseconds. */
  ms: number;
}

export type BuildOutcome =
  /** Built (`savedAt`: the results were loaded from storage, saved then). */
  | { status: 'done'; result: RunResult; savedAt?: string }
  /** No export to build from. */
  | { status: 'empty' }
  /** No DM with the bot and no username given: ask for it, then rebuild. */
  | { status: 'no-owner'; report: string[] }
  /** An unexpected failure (a bug). */
  | { status: 'error'; message: string; report: string[] };

/**
 * Worker -> page: a build finished, or the saved results at start. `current`: built from
 * every usable export with the current options, and nothing more is pending; else a
 * newer one follows.
 */
export interface ResultsMessage {
  type: 'results';
  current: boolean;
  outcome: BuildOutcome;
}

/** Worker -> page: something to tell the player, in Italian (an export already present, files skipped). */
export interface NoticeMessage {
  type: 'notice';
  text: string;
  details: string[];
}

export type WorkerMessage =
  StateMessage | ExportsMessage | ReadMessage | PhaseMessage | ResultsMessage | NoticeMessage;
