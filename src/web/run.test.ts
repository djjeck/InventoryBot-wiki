/** The worker's run (run.ts): what the page receives for a pick. Synthetic data only. */
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileLike, pickFolder } from '#test/browser-picks.ts';
import { BOT, Chat, writeExport, writeMacExport } from '#test/helpers.ts';
import { tempDir } from '#test/temp-dir.ts';
import { type RunOptions, type WorkerMessage } from './protocol.ts';
import { handleRun } from './run.ts';

const OPTIONS: RunOptions = { timeZone: 'Europe/Rome' };

/** Runs a request on these picks, returning every message posted. */
async function run(picks: ReturnType<typeof pickFolder>[], options: Partial<RunOptions> = {}) {
  const posted: WorkerMessage[] = [];
  const last = await handleRun({ type: 'run', picks, options: { ...OPTIONS, ...options } }, (m) =>
    posted.push(m)
  );
  expect(posted.at(-1)).toBe(last);
  return { posted, last };
}

/** A DM with the bot over two pages, and a group, each exported in its own folder. */
function writeInbox(): string[] {
  const dir = tempDir();
  const dm = new Chat(BOT);
  dm.user('Mario', '/avventura', 0);
  dm.bot('@mario_r, ti tuffi nel lago e scorgi un sasso [C]!', 1);
  dm.user('Mario', '/inventario', 2);
  const group = new Chat('Gruppo Avventurieri', 5000);
  group.user('Luigi', 'ciao', 3);
  return [
    writeExport(path.join(dir, 'ChatExport_dm'), BOT, [
      dm.messages.slice(0, 2),
      dm.messages.slice(2),
    ]),
    writeExport(path.join(dir, 'ChatExport_gruppo'), 'Gruppo Avventurieri', [group.messages]),
  ];
}

describe('handleRun', () => {
  it('progress_then_done_with_the_summary', async () => {
    const { posted, last } = await run(writeInbox().map(pickFolder));
    const reads = posted.flatMap((m) => (m.type === 'progress' && m.phase === 'read' ? [m] : []));
    expect(reads.map((m) => m.done)).toStrictEqual([0, 1, 2, 3]);
    expect(reads.every((m) => m.total === 3)).toBe(true);
    expect(posted.at(-2)).toStrictEqual({ type: 'progress', phase: 'parse' });
    expect(last.type).toBe('done');
    if (last.type !== 'done') return;
    expect(last.result).toMatchObject({
      folders: ['ChatExport_dm', 'ChatExport_gruppo'],
      pages: 3,
      messages: 4,
      fromBot: 1,
      report: [
        'cartelle di esportazione: 2; chat: Gruppo Avventurieri, InventoryBot',
        'messaggi: 4 (dal bot: 1)',
      ],
    });
  });

  it('no_pages_stops_with_the_warnings', async () => {
    const { posted, last } = await run([
      [fileLike('Export/result.json', '{}'), fileLike('Export/backup.zip', 'PK')],
    ]);
    expect(posted.map((m) => m.type)).toStrictEqual(['progress', 'stopped']);
    expect(last).toStrictEqual({
      type: 'stopped',
      reason: 'no-pages',
      report: [
        'salto Export: esportazione in formato JSON, è supportato solo il formato HTML (Telegram Desktop -> Esporta cronologia chat -> Formato: HTML)',
        "salto Export/backup.zip: i file zip non vengono letti, estrai l'esportazione in una cartella",
      ],
    });
  });

  it('macos_dates_read_in_the_chosen_time_zone', async () => {
    const c = new Chat(BOT);
    c.user('Mario', '/avventura', 0);
    const mac = writeMacExport(path.join(tempDir(), 'Mac'), BOT, c.messages);
    const done = await run([pickFolder(mac)], { timeZone: 'Asia/Tokyo' });
    expect(done.last.type === 'done' && done.last.result.report).toStrictEqual([
      'Mac: date senza fuso orario, lette nel fuso orario Asia/Tokyo',
      'cartelle di esportazione: 1; chat: InventoryBot',
      'messaggi: 1 (dal bot: 0)',
    ]);
  });

  it('a_page_that_is_not_utf8_is_an_error', async () => {
    const { last } = await run([
      [fileLike('Export/messages.html', new Uint8Array([0xff, 0xfe, 0x00]))],
    ]);
    expect(last.type).toBe('error');
  });
});
