/**
 * What the worker does with a RunRequest: reads the export pages of the picked folders
 * (the browser adapter, src/telegram/export/browser-files.ts), runs phase 1 in memory and
 * posts the progress and the outcome. No browser API: the tests run it in Node with
 * File-like objects.
 */
import { INVENTORY_BOT } from '#src/inventorybot/bot.ts';
import { inputFolders, listFolder, readFolderPages } from '#src/telegram/export/browser-files.ts';
import { parsePages, summaryLine } from '#src/telegram/export/parse-export.ts';
import { type Page } from '#src/telegram/messages.ts';
import { type RunRequest, type WorkerMessage } from './protocol.ts';

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
    const folders = inputFolders(request.picks);
    // Listing first: the warnings of every folder, and the number of pages to read.
    const listed = folders.map((f) => ({ folder: f, ...listFolder(f) }));
    const total = listed.reduce((n, l) => n + l.pages.length, 0);
    let done = 0;
    post({ type: 'progress', phase: 'read', done, total });
    const paths: Page[][] = [];
    for (const { folder, pages, warnings } of listed) {
      report.push(...warnings);
      paths.push(
        await readFolderPages(folder, pages, () =>
          post({ type: 'progress', phase: 'read', done: ++done, total })
        )
      );
    }
    if (total === 0) return end({ type: 'stopped', reason: 'no-pages', report });
    post({ type: 'progress', phase: 'parse' });
    const parsed = parsePages(paths, { bot: INVENTORY_BOT, timeZone: request.options.timeZone });
    const fromBot = parsed.messages.filter((m) => m.from_bot).length;
    report.push(
      ...parsed.warnings,
      summaryLine(parsed),
      `messaggi: ${parsed.messages.length} (dal bot: ${fromBot})`
    );
    return end({
      type: 'done',
      result: {
        report,
        folders: folders.map((f) => f.name),
        pages: total,
        messages: parsed.messages.length,
        fromBot,
        ms: Date.now() - start,
      },
    });
  } catch (e) {
    return end({ type: 'error', message: e instanceof Error ? e.message : String(e), report });
  }
}
