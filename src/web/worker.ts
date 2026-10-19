/**
 * The Web Worker of the web app: runs the pipeline off the page's thread, so the page
 * stays responsive on large exports. All the work is in run.ts.
 */
import { type RunRequest, type WorkerMessage } from './protocol.ts';
import { handleRun } from './run.ts';

/** The part of a worker's global scope used here (the project's types have no DOM). */
interface WorkerScope {
  onmessage: ((e: { data: RunRequest }) => void) | null;
  postMessage(m: WorkerMessage): void;
}

const scope = globalThis as unknown as WorkerScope;
scope.onmessage = (e) => void handleRun(e.data, (m) => scope.postMessage(m));
