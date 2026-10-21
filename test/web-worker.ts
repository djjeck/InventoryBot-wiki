/**
 * The web app's worker logic (src/web/run.ts) in Node: on the fake IndexedDB, with every
 * message it posts recorded. Synthetic data only.
 */
import { type FileLike } from '#src/telegram/export/browser-files.ts';
import {
  type BuildOptions,
  type ExportEntry,
  type PageMessage,
  type ResultsMessage,
  type RunResult,
  type WorkerMessage,
} from '#src/web/protocol.ts';
import { startWorker, type WorkerCore } from '#src/web/run.ts';
import { type DatabaseFactory, openStore, type Store } from '#src/web/storage.ts';
import { fakeIndexedDb } from './fake-indexeddb.ts';

export const WORKER_OPTIONS: BuildOptions = { timeZone: 'Europe/Rome', player: null };
export const WORKER_SALT = 'test-salt';

export interface Harness {
  worker: WorkerCore;
  store: Store;
  factory: DatabaseFactory | undefined;
  /** Every message posted, in order. */
  posted: WorkerMessage[];
  /** Called on each message posted, after it is recorded. */
  onPost: ((m: WorkerMessage) => void) | null;
  /** Sends a message and waits until the queue is empty. */
  send(m: PageMessage): Promise<void>;
  /** Adds picks, one message each, then waits. */
  add(...picks: FileLike[][]): Promise<void>;
  /** The results messages posted. */
  results(): ResultsMessage[];
  /** The last list of exports posted. */
  exports(): ExportEntry[];
  /** The result of the last results message, which must be a current `done`. */
  last(): RunResult;
}

/**
 * A worker on `factory` (a new fake when omitted; null: no storage), started with the
 * `state` message, its salt WORKER_SALT unless storage holds one.
 */
export async function startHarness(
  db?: DatabaseFactory | null,
  options: Partial<BuildOptions> & { salt?: string } = {}
): Promise<Harness> {
  const factory = db === undefined ? fakeIndexedDb().factory : (db ?? undefined);
  const store = openStore(factory);
  const { salt = WORKER_SALT, ...over } = options;
  const h: Harness = {
    worker: startWorker(store, (m) => {
      h.posted.push(m);
      h.onPost?.(m);
    }),
    store,
    factory,
    posted: [],
    onPost: null,
    async send(m) {
      await h.worker.handle(m);
      await h.worker.idle();
    },
    async add(...picks) {
      for (const p of picks) await h.worker.handle({ type: 'add', picks: [p] });
      await h.worker.idle();
    },
    results: () => h.posted.filter((m): m is ResultsMessage => m.type === 'results'),
    exports() {
      for (let i = h.posted.length - 1; i >= 0; i--) {
        const m = h.posted[i] as WorkerMessage;
        if (m.type === 'exports' || m.type === 'state') return m.exports;
      }
      return [];
    },
    last() {
      const r = h.results().at(-1);
      if (r?.outcome.status !== 'done' || !r.current)
        throw new Error(`not a current build: ${JSON.stringify(r)}`);
      return r.outcome.result;
    },
  };
  await h.send({ type: 'state', options: { ...WORKER_OPTIONS, ...over }, salt });
  return h;
}
