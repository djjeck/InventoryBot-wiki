/**
 * What the worker does with a RunRequest: reads the export pages of the picked folders
 * (the browser adapter, src/telegram/export/browser-files.ts; readPicks), runs phases 1 to
 * 5 in memory (runPipeline, src/pipeline.ts) and posts the progress and the outcome. No
 * browser API: the tests run it in Node with File-like objects.
 */
import { runPipeline } from '#src/pipeline.ts';
import {
  type FileLike,
  inputFolders,
  listFolder,
  readFolderPages,
} from '#src/telegram/export/browser-files.ts';
import { type Page } from '#src/telegram/messages.ts';
import { type RunRequest, type WorkerMessage } from './protocol.ts';

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
 * Reads the pages of the picks: the listing first (the warnings of every folder, and the
 * number of pages to read), then each page; `onRead` is called before the first page
 * and after each one.
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

/** Runs one request, posting progress, then one final message (also returned). */
export async function handleRun(
  request: RunRequest,
  post: (m: WorkerMessage) => void
): Promise<WorkerMessage> {
  const start = Date.now();
  const report: string[] = [];
  const end = (m: WorkerMessage): WorkerMessage => {
    post(m);
    return m;
  };
  try {
    const read = await readPicks(request.picks, (done, total) =>
      post({ type: 'progress', phase: 'read', done, total })
    );
    report.push(...read.warnings);
    if (read.total === 0) return end({ type: 'stopped', reason: 'no-pages', report });
    const { timeZone, player } = request.options;
    const run = await runPipeline(read.paths, request.options, (phase) =>
      post({ type: 'progress', phase })
    );
    report.push(...run.report);
    if (run.status === 'no-owner') return end({ type: 'stopped', reason: 'no-owner', report });
    return end({
      type: 'done',
      result: {
        owner: run.conversed.owner,
        wiki: run.wiki,
        player: run.player,
        options: { timeZone, player },
        report,
        folders: read.folders,
        pages: read.total,
        messages: run.messages.length,
        fromBot: run.messages.filter((m) => m.from_bot).length,
        replies: run.conversed.conversation.replies.length,
        ms: Date.now() - start,
      },
    });
  } catch (e) {
    return end({ type: 'error', message: e instanceof Error ? e.message : String(e), report });
  }
}
