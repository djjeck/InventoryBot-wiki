/**
 * The worker's logic (worker.ts is its wiring): it owns the storage (storage.ts) and
 * answers the page's messages (protocol.ts). Each export the page adds is read once into
 * a record (processExport, src/pipeline.ts) and stored; the wiki is built again from every
 * stored record (buildWiki) whenever one is added or removed, and the results are saved.
 *
 * One queue, run one step at a time: the exports added, in order (one input folder each:
 * the browser adapter, src/telegram/export/browser-files.ts), then one build once no
 * export is left to read, however many were added. A build is never abandoned: an export
 * added or removed while it runs (or new options) makes it not current, and one more build
 * follows. An export whose records are all stored already changes nothing and builds
 * nothing. An export that cannot be read is listed with the error, and the queue goes on.
 *
 * Where storage is missing or fails, the records of this visit are kept in memory
 * instead, so the page works the same, without memory beyond the visit.
 *
 * No browser API: the tests run it in Node, with File-like objects and a fake IndexedDB.
 */
import { buildWiki, processExport } from '#src/pipeline.ts';
import {
  type FileLike,
  type InputFolder,
  inputFolders,
  listFolder,
  readFolderPages,
} from '#src/telegram/export/browser-files.ts';
import { type ExportRecord, splitExports } from '#src/telegram/export/record.ts';
import { type Page } from '#src/telegram/messages.ts';
import {
  type BuildOptions,
  type BuildOutcome,
  type ExportEntry,
  type PageMessage,
  type RunResult,
  type WorkerMessage,
} from './protocol.ts';
import { type ListedRecord, recordInfo, type Store } from './storage.ts';

/** The pages of the picked folders, and what reading them found. */
export interface ReadPicks {
  /** Names of the input folders. */
  folders: string[];
  /** The pages of each input folder, in order. */
  paths: Page[][];
  /** Number of pages read. */
  total: number;
  /** The listing's warnings (JSON exports, zip files). */
  warnings: string[];
}

/**
 * Reads the pages of the picks at once: the listing first (the warnings of every folder,
 * and the number of pages to read), then each page; `onRead` is called before the first
 * page and after each one. The golden tests read their exports with it.
 */
export async function readPicks(
  picks: readonly (readonly FileLike[])[],
  onRead: (done: number, total: number) => void = () => {}
): Promise<ReadPicks> {
  const folders = inputFolders(picks);
  const listed = folders.map((f) => ({ folder: f, ...listFolder(f) }));
  const total = listed.reduce((n, l) => n + l.pages.length, 0);
  let done = 0;
  onRead(done, total);
  const paths: Page[][] = [];
  const warnings: string[] = [];
  for (const { folder, pages, warnings: w } of listed) {
    warnings.push(...w);
    paths.push(await readFolderPages(folder, pages, () => onRead(++done, total)));
  }
  return { folders: folders.map((f) => f.name), paths, total, warnings };
}

/** An input folder added and not stored (yet): queued, being read, or failed. */
interface Job {
  id: string;
  status: 'queued' | 'reading' | 'error';
  folder: InputFolder;
  pages: string[];
  warnings: string[];
  done: number;
  message?: string;
}

/** The worker: `handle` takes each message of the page; `idle` waits for the queue to drain. */
export interface WorkerCore {
  /** Resolves once the message is taken in (its reading and building go on in the queue). */
  handle(m: PageMessage): Promise<void>;
  /** Resolves once every message is taken in and the queue is empty. */
  idle(): Promise<void>;
}

/** Until the page says otherwise: Italy's time zone, and the owner from the DM. */
const DEFAULT_OPTIONS: BuildOptions = { timeZone: 'Europe/Rome', player: null };

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The worker's logic on `store`, posting its messages with `post`. */
export function startWorker(store: Store, post: (m: WorkerMessage) => void): WorkerCore {
  let salt = '';
  let options = DEFAULT_OPTIONS;
  /** Initialisation (salt, saved results): once, by the first message. */
  let started: Promise<void> | null = null;
  /** The stored entries, as last listed. */
  let listed: ListedRecord[] = [];
  /** Records of this visit that storage could not take. */
  const memory = new Map<string, { info: ListedRecord; record: ExportRecord }>();
  const jobs: Job[] = [];
  let nextJob = 0;
  /** A build is due once no export is left to read. */
  let buildWanted = false;
  /** Raised by `clear`: work begun before it is dropped. */
  let generation = 0;
  let busy = false;
  let drained: Promise<void> = Promise.resolve();
  const handling = new Set<Promise<void>>();

  const pending = (): boolean => buildWanted || jobs.some((j) => j.status !== 'error');

  function entries(): ExportEntry[] {
    const stored = [...listed, ...[...memory.values()].map((m) => m.info)].map(
      (i): ExportEntry => ({
        id: i.hash,
        status: i.stale ? 'stale' : 'ready',
        folder: i.folder,
        info: i,
      })
    );
    const unstored = jobs.map((j): ExportEntry => {
      const e: ExportEntry = { id: j.id, status: j.status, folder: j.folder.name };
      if (j.status === 'reading') Object.assign(e, { done: j.done, total: j.pages.length });
      if (j.status === 'error') Object.assign(e, { message: j.message, details: j.warnings });
      return e;
    });
    return [...stored, ...unstored];
  }

  /** Lists the stored entries again and posts the list. */
  async function postExports(): Promise<void> {
    listed = await store.listRecords();
    post({ type: 'exports', exports: entries(), storage: store.available });
  }

  async function start(defaults: BuildOptions, candidate?: string): Promise<void> {
    salt = await store.salt(candidate);
    listed = await store.listRecords();
    const loaded = await store.loadResults();
    options = loaded?.saved.result.options ?? defaults;
    post({ type: 'state', exports: entries(), options, storage: store.available });
    if (loaded !== null) {
      const { saved } = loaded;
      post({
        type: 'results',
        current: loaded.current && !pending(),
        outcome: { status: 'done', result: saved.result, savedAt: saved.savedAt },
      });
      if (!loaded.current) buildWanted = true;
    } else if (listed.some((i) => !i.stale)) {
      buildWanted = true;
    } else {
      post({ type: 'results', current: !pending(), outcome: { status: 'empty' } });
    }
    kick();
  }

  const ensureStarted = (defaults = DEFAULT_OPTIONS, candidate?: string): Promise<void> =>
    (started ??= start(defaults, candidate));

  /** Starts draining the queue, unless it is already. */
  function kick(): void {
    if (busy) return;
    busy = true;
    drained = drain();
  }

  async function drain(): Promise<void> {
    try {
      for (;;) {
        const job = jobs.find((j) => j.status === 'queued');
        if (job !== undefined) await read(job);
        else if (buildWanted) {
          buildWanted = false;
          await rebuild();
        } else return;
      }
    } finally {
      busy = false;
    }
  }

  /** Whether a job was removed, or everything cleared, since `gen`. */
  const dropped = (job: Job, gen: number): boolean => gen !== generation || !jobs.includes(job);

  /** Stores a record: in storage, else in memory; `kept` if it was there already. */
  async function keep(record: ExportRecord): Promise<'added' | 'kept'> {
    if (memory.has(record.hash)) return 'kept';
    const r = await store.addRecord(record, { salt });
    if (r.status === 'refused')
      throw new Error('i dati di questo browser sono cambiati nel frattempo, aggiungila di nuovo');
    if (r.status !== 'unavailable') return r.status;
    const seq = Math.max(
      -1,
      ...listed.map((i) => i.seq),
      ...[...memory.values()].map((m) => m.info.seq)
    );
    const info = { ...recordInfo(record, { seq: seq + 1, now: new Date() }), stale: false };
    memory.set(record.hash, { info, record });
    return 'added';
  }

  /** Reads one queued job into its records, and stores them. */
  async function read(job: Job): Promise<void> {
    const gen = generation;
    job.status = 'reading';
    job.done = 0;
    await postExports();
    try {
      const total = job.pages.length;
      post({ type: 'read', id: job.id, done: 0, total });
      const pages = await readFolderPages(job.folder, job.pages, () =>
        post({ type: 'read', id: job.id, done: ++job.done, total })
      );
      const outcomes: ('added' | 'kept')[] = [];
      for (const exp of splitExports(pages)) {
        // Hashed and parsed before storage is touched: no transaction spans the work.
        const record = await processExport(exp, { salt });
        if (dropped(job, gen)) break;
        outcomes.push(await keep(record));
      }
      // Removed half-way: what was stored stays, and counts.
      if (gen === generation && outcomes.includes('added')) buildWanted = true;
      if (dropped(job, gen)) return;
      jobs.splice(jobs.indexOf(job), 1);
      if (!outcomes.includes('added'))
        post({
          type: 'notice',
          text: `La cartella ${job.folder.name} è già tra le esportazioni: non cambia nulla.`,
          details: [],
        });
      if (job.warnings.length > 0)
        post({
          type: 'notice',
          text: `Nella cartella ${job.folder.name} alcuni file sono stati saltati.`,
          details: job.warnings,
        });
    } catch (e) {
      if (dropped(job, gen)) return;
      job.status = 'error';
      job.message = `Non è stato possibile leggere la cartella ${job.folder.name}: ${errorText(e)}`;
    }
    await postExports();
  }

  /** Builds from every usable record, saves the results and posts them. */
  async function rebuild(): Promise<void> {
    const gen = generation;
    const begun = Date.now();
    const built = options;
    post({ type: 'phase', phase: 'parse' });
    const records = [...(await store.loadRecords()), ...[...memory.values()].map((m) => m.record)];
    if (gen !== generation) return;
    let outcome: BuildOutcome;
    if (records.length === 0) outcome = { status: 'empty' };
    else {
      try {
        const run = buildWiki(records, { ...built, salt }, (phase) =>
          post({ type: 'phase', phase })
        );
        if (run.status === 'no-owner') outcome = { status: 'no-owner', report: run.report };
        else {
          const result: RunResult = {
            owner: run.conversed.owner,
            wiki: run.wiki,
            player: run.player,
            options: built,
            report: run.report,
            folders: records.map((r) => r.folder),
            pages: records.reduce((n, r) => n + r.pages, 0),
            messages: run.messages.length,
            fromBot: run.messages.filter((m) => m.from_bot).length,
            replies: run.conversed.conversation.replies.length,
            ms: Date.now() - begun,
          };
          outcome = { status: 'done', result };
          await store.saveResults(result, { sources: records.map((r) => r.hash), salt });
          if (gen !== generation) return;
        }
      } catch (e) {
        outcome = { status: 'error', message: errorText(e), report: [] };
      }
    }
    post({ type: 'results', current: !pending(), outcome });
  }

  async function add(picks: readonly (readonly FileLike[])[]): Promise<void> {
    for (const folder of inputFolders(picks)) {
      const { pages, warnings } = listFolder(folder);
      const job: Job = {
        id: `job-${nextJob++}`,
        status: 'queued',
        folder,
        pages,
        warnings,
        done: 0,
      };
      if (pages.length === 0) {
        job.status = 'error';
        job.message =
          `Nella cartella ${folder.name} non c’è nessuna pagina di chat esportata (messages.html): ` +
          'scegli la cartella creata da Telegram Desktop con «Esporta cronologia chat», in formato HTML.';
      }
      jobs.push(job);
    }
    await postExports();
    kick();
  }

  async function remove(id: string): Promise<void> {
    const job = jobs.find((j) => j.id === id);
    if (job !== undefined) {
      jobs.splice(jobs.indexOf(job), 1);
      return postExports();
    }
    if (memory.delete(id) || (await store.removeRecord(id))) buildWanted = true;
    await postExports();
    kick();
  }

  async function clear(): Promise<void> {
    generation++;
    jobs.length = 0;
    memory.clear();
    buildWanted = false;
    await store.clear();
    salt = await store.salt();
    listed = [];
    post({ type: 'state', exports: entries(), options, storage: store.available });
    post({ type: 'results', current: true, outcome: { status: 'empty' } });
  }

  async function take(m: PageMessage): Promise<void> {
    if (m.type === 'state') {
      if (started !== null) {
        await started;
        listed = await store.listRecords();
        post({ type: 'state', exports: entries(), options, storage: store.available });
        return;
      }
      return ensureStarted(m.options, m.salt);
    }
    await ensureStarted();
    if (m.type === 'add') return add(m.picks);
    if (m.type === 'remove') return remove(m.id);
    if (m.type === 'clear') return clear();
    options = m.options;
    buildWanted = true;
    kick();
  }

  return {
    handle(m) {
      const p = take(m).finally(() => handling.delete(p));
      handling.add(p);
      return p;
    },
    async idle() {
      for (;;) {
        if (handling.size > 0) await Promise.allSettled([...handling]);
        else if (busy) await drained;
        else return;
      }
    },
  };
}
