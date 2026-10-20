/**
 * The messages between the web page (main.ts) and the worker that runs the pipeline
 * (worker.ts, run.ts). The page sends one RunRequest; the worker answers with progress
 * messages, then exactly one final message: `done`, `stopped` or `error`.
 *
 * Everything sent is structured-cloneable: browser `File` objects (which stay handles to
 * the files on disk: only the export pages are read, in the worker) and plain data.
 */
import { type PlayerState, type Wiki } from '#src/inventorybot/types.ts';
import { type FileLike } from '#src/telegram/export/browser-files.ts';

export interface RunOptions {
  /**
   * The IANA time zone of the computer that made the exports (the page proposes this
   * browser's), for the dates of macOS exports, which have no offset.
   */
  timeZone: string;
  /** The owner's @username without `@`; null: the player the bot addresses most in the DM. */
  player: string | null;
  /** The secret salt of the pseudonyms, kept by the page in this browser. */
  salt: string;
}

/** Page -> worker: run the pipeline on these picks (each the files of one folder pick). */
export interface RunRequest {
  type: 'run';
  picks: FileLike[][];
  options: RunOptions;
}

/** Worker -> page: a step started. `read` counts the pages read so far. */
export interface ProgressMessage {
  type: 'progress';
  phase: 'read' | 'parse' | 'conversation' | 'interpret' | 'build';
  done?: number;
  total?: number;
}

/** What a run produced. */
export interface RunResult {
  /** The export owner the run was made for (given, or found in the DM). */
  owner: string | null;
  /** The wiki: facts about the game, the same for every player. */
  wiki: Wiki;
  /** The owner's own state. */
  player: PlayerState;
  /** The report lines: warnings, then the summary. */
  report: string[];
  /** Names of the input folders. */
  folders: string[];
  /** Number of export pages read. */
  pages: number;
  /** Number of messages after de-duplication, and how many of them are the bot's. */
  messages: number;
  fromBot: number;
  /** Number of the bot's replies after phase 2. */
  replies: number;
  /** Duration of the run in the worker, in milliseconds. */
  ms: number;
}

export interface DoneMessage {
  type: 'done';
  result: RunResult;
}

/**
 * The run stopped on something the user can fix: no export page in the picked folders
 * (`no-pages`), or no DM with the bot and no username given (`no-owner`).
 */
export interface StoppedMessage {
  type: 'stopped';
  reason: 'no-pages' | 'no-owner';
  /** The lines logged until then. */
  report: string[];
}

/** An unexpected failure (a page that is not UTF-8, a bug). */
export interface ErrorMessage {
  type: 'error';
  message: string;
  report: string[];
}

export type WorkerMessage = ProgressMessage | DoneMessage | StoppedMessage | ErrorMessage;
