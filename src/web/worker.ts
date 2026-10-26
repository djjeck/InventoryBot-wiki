/**
 * The Web Worker of the web app: owns the storage (IndexedDB works in workers) and runs
 * the pipeline off the page's thread, so the page stays responsive on large exports. All
 * the work is in run.ts.
 */
import { type PageMessage, type WorkerMessage } from './protocol.ts';
import { startWorker } from './run.ts';
import { type DatabaseFactory, openStore } from './storage.ts';

/** The part of a worker's global scope used here (the project's types have no DOM). */
interface WorkerScope {
  onmessage: ((e: { data: PageMessage }) => void) | null;
  postMessage(m: WorkerMessage): void;
  indexedDB?: DatabaseFactory;
}

const scope = globalThis as unknown as WorkerScope;
const store = openStore(
  (() => {
    try {
      return scope.indexedDB;
    } catch {
      return undefined; // reading indexedDB itself can throw where storage is blocked
    }
  })(),
  __BUILD__
);
const worker = startWorker(store, (m) => scope.postMessage(m));
scope.onmessage = (e) => void worker.handle(e.data);
