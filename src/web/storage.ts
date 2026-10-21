/**
 * The web app's memory between visits, in IndexedDB, in this browser only: the processed
 * exports (ExportRecord, one per export, read once), the last built results (wiki, player
 * state, report, options) with the records they were built from, and the secret salt of
 * the pseudonyms and sender keys. The export pages themselves are never kept, only their
 * records: the bot's messages and the commands for it in full, and no text of the rest.
 *
 * The salt lives in the same database as the records, since a record (its sender keys)
 * is valid only with the salt that made it: deleting the database drops all three at
 * once, a database found without a salt drops its records and results, and a record or
 * results made with another salt are refused. Being IndexedDB only (no localStorage),
 * the store works the same from the page and from a Web Worker, which has no
 * localStorage. Each call is one transaction, so callers in both contexts may share it.
 *
 * Records are listed in upload order (`seq`), which is the order to merge them in. A
 * record of another RECORD_FORMAT_VERSION is stale: it is never given as usable, its
 * payload is dropped, and its entry stays so that the page can ask for it to be added
 * again; adding that export again puts the new record in the same place.
 *
 * Storage can be missing or refuse (private windows, blocked site data, a full disk):
 * every call is wrapped, and after the first failure `available` is false and every call
 * gives its fallback (no records, no results, false), and `salt()` a salt for this visit
 * alone, so the page works the same, just without memory.
 *
 * The IndexedDB types below are the few members used, so that the module also runs in
 * Node, with the fake of the tests.
 */
import { type ExportRecord, RECORD_FORMAT_VERSION } from '#src/telegram/export/record.ts';
import { type RunResult } from './protocol.ts';

const DB = 'inventorybot-wiki';
/**
 * The schema: 1 kept only the last results ("results", key "last"); 2 adds the records
 * and the salt. Opening an older database drops what it kept: version 1's results were
 * built from no record, so nothing could tell whether they are current.
 */
export const DB_VERSION = 2;
/** `salt`: the salt (string); `seq`: the next upload number. */
const META = 'meta';
/** RecordInfo by record hash: small, listed without the payloads. */
const RECORDS = 'records';
/** ExportRecord by its hash; only for the entries of the current format. */
const PAYLOADS = 'payloads';
/** SavedResults under RESULTS_KEY. */
const RESULTS = 'results';
const RESULTS_KEY = 'last';
const STORES = [META, RECORDS, PAYLOADS, RESULTS];

/** What is kept of a record besides its payload: what the page lists. */
export interface RecordInfo {
  /** The record's content hash (ExportRecord.hash), its key. */
  hash: string;
  /** Upload order: records are merged by increasing `seq`. */
  seq: number;
  /** The record's format; another than RECORD_FORMAT_VERSION: stale, payload dropped. */
  formatVersion: number;
  /** The folder name to show (the picked folder's, else the record's). */
  folder: string;
  /** ISO date of the upload. */
  addedAt: string;
  pages: number;
  chats: (string | null)[];
  firstDate: string | null;
  lastDate: string | null;
  counts: { messages: number; fromBot: number; kept: number };
}

/** What is listed of a record uploaded `seq`-th at `now` (its folder: `folder`, else its own). */
export function recordInfo(
  record: ExportRecord,
  { seq, now, folder }: { seq: number; now: Date; folder?: string }
): RecordInfo {
  return {
    hash: record.hash,
    seq,
    formatVersion: record.formatVersion,
    folder: folder ?? record.folder,
    addedAt: now.toISOString(),
    pages: record.pages,
    chats: record.chats,
    firstDate: record.firstDate,
    lastDate: record.lastDate,
    counts: record.counts,
  };
}

/** A listed record: stale ones must be added again before they count. */
export interface ListedRecord extends RecordInfo {
  stale: boolean;
}

/** What addRecord did. */
export type AddResult =
  /** Stored (`added`), or the same export was already stored (`kept`: nothing changed). */
  | { status: 'added' | 'kept'; info: RecordInfo }
  /** Made with a salt other than the stored one, or of another format: not stored. */
  | { status: 'refused' }
  /** Storage missing or failing. */
  | { status: 'unavailable' };

/** The last built results, with the records they were built from. */
export interface SavedResults {
  /** ISO date of the save. */
  savedAt: string;
  /** Hashes of the records the results were built from, in merge order. */
  sources: string[];
  result: RunResult;
}

export interface LoadedResults {
  saved: SavedResults;
  /** Whether `sources` are exactly the usable records, in upload order. */
  current: boolean;
}

interface Request<T> {
  result: T;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

interface OpenRequest extends Request<Database> {
  onupgradeneeded: ((event: { oldVersion: number }) => void) | null;
  onblocked?: (() => void) | null;
}

interface Database {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string): unknown;
  deleteObjectStore(name: string): void;
  transaction(stores: string[], mode: 'readwrite'): Transaction;
  close(): void;
}

interface ObjectStore {
  get(key: string): Request<unknown>;
  getAll(): Request<unknown[]>;
  put(value: unknown, key: string): Request<unknown>;
  delete(key: string): Request<unknown>;
  clear(): Request<unknown>;
}

interface Transaction {
  objectStore(name: string): ObjectStore;
  abort(): void;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
}

/** The part of `indexedDB` used here (a window's or a worker's). */
export interface DatabaseFactory {
  open(name: string, version: number): OpenRequest;
  deleteDatabase(name: string): Request<unknown> & { onblocked?: (() => void) | null };
}

export interface Store {
  /**
   * The salt of the pseudonyms and sender keys: the stored one; without one, `candidate`
   * (else a new random one) is stored and given. Unavailable: the same salt for every
   * call of this store (the last one known, else `candidate` or a new one).
   */
  salt(candidate?: string): Promise<string>;
  /** Every record entry, stale ones included, in upload order; drops stale payloads. */
  listRecords(): Promise<ListedRecord[]>;
  /** The usable records, in upload order: the input of buildWiki. */
  loadRecords(): Promise<ExportRecord[]>;
  /** Stores a record made with `salt` (no-op if its hash is already stored and usable). */
  addRecord(
    record: ExportRecord,
    options: { salt: string; folder?: string; now?: Date }
  ): Promise<AddResult>;
  /** Removes one record and the results; false if storage could not be reached. */
  removeRecord(hash: string): Promise<boolean>;
  /** The last results and whether they are current, or null (none, or unavailable). */
  loadResults(): Promise<LoadedResults | null>;
  /**
   * Saves results built with `salt` from the records `sources` (hashes, in merge order);
   * false when refused (another salt) or not saved.
   */
  saveResults(
    result: RunResult,
    options: { sources: readonly string[]; salt: string; now?: Date }
  ): Promise<boolean>;
  /** Deletes everything ("Cancella i miei dati"); false when storage could not be reached. */
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

/** A new random salt: 16 bytes as hex. */
function newSalt(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface Stores {
  meta: ObjectStore;
  records: ObjectStore;
  payloads: ObjectStore;
  results: ObjectStore;
}

const bySeq = (a: RecordInfo, b: RecordInfo): number => a.seq - b.seq;
const isStale = (i: RecordInfo): boolean => i.formatVersion !== RECORD_FORMAT_VERSION;

/** A store on `factory` (the page's or the worker's `indexedDB`; undefined: no storage). */
export function openStore(factory: DatabaseFactory | undefined): Store {
  let available = factory !== undefined;
  /** The salt last read or stored, or the one of this visit when storage is unavailable. */
  let known: string | null = null;

  const open = (): Promise<Database> => {
    const req = (factory as DatabaseFactory).open(DB, DB_VERSION);
    req.onupgradeneeded = ({ oldVersion }) => {
      const db = req.result;
      if (oldVersion < 2 && db.objectStoreNames.contains(RESULTS)) db.deleteObjectStore(RESULTS);
      for (const name of STORES)
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    return settle(req);
  };

  /**
   * Runs `body` in one transaction on every store; `fallback` (and storage marked
   * unavailable) on any failure. `body` must await only requests of the transaction, or
   * the browser commits it early.
   */
  async function run<T>(body: (s: Stores) => Promise<T>, fallback: T): Promise<T> {
    if (!available) return fallback;
    try {
      const db = await open();
      try {
        const tx = db.transaction(STORES, 'readwrite');
        const done = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(new Error('transaction failed'));
          tx.onabort = () => reject(new Error('transaction aborted'));
        });
        done.catch(() => {}); // awaited below; a failure while `body` runs is not unhandled
        const s: Stores = {
          meta: tx.objectStore(META),
          records: tx.objectStore(RECORDS),
          payloads: tx.objectStore(PAYLOADS),
          results: tx.objectStore(RESULTS),
        };
        const value = await body(s).catch((e: unknown) => {
          try {
            tx.abort();
          } catch {
            // already finished
          }
          throw e;
        });
        await done;
        return value;
      } finally {
        db.close();
      }
    } catch {
      available = false;
      return fallback;
    }
  }

  /**
   * The stored salt. Without one, whatever records and results there are were made with
   * another salt: they are dropped, and `candidate` (else a new salt) is stored.
   */
  async function storedSalt(s: Stores, candidate?: string): Promise<string> {
    const kept = await settle(s.meta.get('salt'));
    if (typeof kept === 'string' && kept !== '') return (known = kept);
    await Promise.all([s.records, s.payloads, s.results].map((o) => settle(o.clear())));
    const salt = candidate ?? newSalt();
    await settle(s.meta.put(salt, 'salt'));
    return (known = salt);
  }

  /** Every entry, in upload order; the payloads of stale ones deleted. */
  async function entries(s: Stores): Promise<RecordInfo[]> {
    const all = ((await settle(s.records.getAll())) as RecordInfo[]).sort(bySeq);
    await Promise.all(all.filter(isStale).map((i) => settle(s.payloads.delete(i.hash))));
    return all;
  }

  return {
    get available() {
      return available;
    },

    async salt(candidate) {
      const fallback = known ?? candidate ?? newSalt();
      const salt = await run((s) => storedSalt(s, candidate), fallback);
      known = salt;
      return salt;
    },

    listRecords: () =>
      run(async (s) => {
        await storedSalt(s);
        return (await entries(s)).map((i) => ({ ...i, stale: isStale(i) }));
      }, []),

    loadRecords: () =>
      run(async (s) => {
        await storedSalt(s);
        const usable = (await entries(s)).filter((i) => !isStale(i));
        const records = await Promise.all(
          usable.map((i) => settle(s.payloads.get(i.hash)) as Promise<ExportRecord | undefined>)
        );
        return records.filter((r): r is ExportRecord => r?.formatVersion === RECORD_FORMAT_VERSION);
      }, []),

    addRecord: (record, { salt, folder, now = new Date() }) =>
      run<AddResult>(
        async (s) => {
          if ((await storedSalt(s)) !== salt || record.formatVersion !== RECORD_FORMAT_VERSION)
            return { status: 'refused' };
          const prev = (await settle(s.records.get(record.hash))) as RecordInfo | undefined;
          if (prev !== undefined && !isStale(prev)) return { status: 'kept', info: prev };
          let seq = prev?.seq;
          if (seq === undefined) {
            const next = await settle(s.meta.get('seq'));
            seq = typeof next === 'number' ? next : 0;
            await settle(s.meta.put(seq + 1, 'seq'));
          }
          const info = recordInfo(record, {
            seq,
            now,
            ...(folder === undefined ? {} : { folder }),
          });
          await Promise.all([
            settle(s.records.put(info, record.hash)),
            settle(s.payloads.put(record, record.hash)),
          ]);
          return { status: 'added', info };
        },
        { status: 'unavailable' }
      ),

    removeRecord: (hash) =>
      run(async (s) => {
        await Promise.all([
          settle(s.records.delete(hash)),
          settle(s.payloads.delete(hash)),
          settle(s.results.delete(RESULTS_KEY)),
        ]);
        return true;
      }, false),

    loadResults: () =>
      run(async (s) => {
        await storedSalt(s);
        const saved = (await settle(s.results.get(RESULTS_KEY))) as SavedResults | undefined;
        if (saved === undefined || !Array.isArray(saved.sources)) return null;
        const usable = (await entries(s)).filter((i) => !isStale(i)).map((i) => i.hash);
        const current =
          usable.length === saved.sources.length && usable.every((h, i) => h === saved.sources[i]);
        return { saved, current };
      }, null),

    saveResults: (result, { sources, salt, now = new Date() }) =>
      run(async (s) => {
        if ((await storedSalt(s)) !== salt) return false;
        const saved: SavedResults = { savedAt: now.toISOString(), sources: [...sources], result };
        await settle(s.results.put(saved, RESULTS_KEY));
        return true;
      }, false),

    async clear() {
      known = null;
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
