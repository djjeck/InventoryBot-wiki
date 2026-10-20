/**
 * The web app's memory between visits: the last run's results (wiki, player state,
 * report), in IndexedDB, so that a returning user sees their wiki without picking the
 * folders again. Never the chats: the export pages are read in the worker and dropped.
 *
 * Storage can be missing or refused (private windows, blocked site data, some browsers
 * in some modes): every call is wrapped, and then `available` is false, `load` gives
 * null and `save` / `clear` give false, so the page works the same, just without memory.
 *
 * The IndexedDB types below are the few members used, so that the module also runs in
 * Node, with the fake of the tests.
 */
import { type RunResult } from './protocol.ts';

const DB = 'inventorybot-wiki';
const STORE = 'results';
const KEY = 'last';

/** A run's results as stored, with when they were saved. */
export interface Saved {
  version: 1;
  /** ISO date of the save. */
  savedAt: string;
  result: RunResult;
}

interface Request<T> {
  result: T;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

interface OpenRequest extends Request<Database> {
  onupgradeneeded: (() => void) | null;
  onblocked?: (() => void) | null;
}

interface Database {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string): unknown;
  transaction(store: string, mode: 'readonly' | 'readwrite'): Transaction;
  close(): void;
}

interface Transaction {
  objectStore(name: string): {
    get(key: string): Request<unknown>;
    put(value: unknown, key: string): Request<unknown>;
  };
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
}

/** The part of `indexedDB` used here. */
export interface DatabaseFactory {
  open(name: string, version: number): OpenRequest;
  deleteDatabase(name: string): Request<unknown> & { onblocked?: (() => void) | null };
}

export interface ResultStore {
  /** The last saved results, or null (none, or storage unavailable). */
  load(): Promise<Saved | null>;
  /** Saves the results; false when they could not be saved. */
  save(result: RunResult, now?: Date): Promise<boolean>;
  /** Deletes everything saved; false when storage could not be reached. */
  clear(): Promise<boolean>;
  /** False once storage has failed (or when there is none). */
  readonly available: boolean;
}

function settle<T>(r: Request<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** A store on `factory` (the browser's `indexedDB`; undefined: no storage). */
export function resultStore(factory: DatabaseFactory | undefined): ResultStore {
  let available = factory !== undefined;

  const open = (): Promise<Database> => {
    const req = (factory as DatabaseFactory).open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    return settle(req);
  };

  /** Runs `body` on the store; `fallback` (and storage marked unavailable) on any failure. */
  async function withStore<T>(
    mode: 'readonly' | 'readwrite',
    body: (store: ReturnType<Transaction['objectStore']>) => Request<unknown>,
    fallback: T,
    read: (value: unknown) => T
  ): Promise<T> {
    if (!available) return fallback;
    try {
      const db = await open();
      try {
        const tx = db.transaction(STORE, mode);
        const req = body(tx.objectStore(STORE));
        const done = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(new Error('transaction failed'));
          tx.onabort = () => reject(new Error('transaction aborted'));
        });
        const [value] = await Promise.all([settle(req), done]);
        return read(value);
      } finally {
        db.close();
      }
    } catch {
      available = false;
      return fallback;
    }
  }

  return {
    get available() {
      return available;
    },
    load: () =>
      withStore<Saved | null>(
        'readonly',
        (s) => s.get(KEY),
        null,
        (v) => {
          const saved = v as Saved | undefined;
          return saved?.version === 1 && typeof saved.result === 'object' ? saved : null;
        }
      ),
    save: (result, now = new Date()) =>
      withStore(
        'readwrite',
        (s) => s.put({ version: 1, savedAt: now.toISOString(), result } satisfies Saved, KEY),
        false,
        () => true
      ),
    async clear() {
      if (factory === undefined) return false;
      try {
        const req = factory.deleteDatabase(DB);
        // Blocked: another tab has it open; the deletion completes when that tab lets go.
        req.onblocked = () => {};
        await settle(req);
        return true;
      } catch {
        return false;
      }
    },
  };
}
