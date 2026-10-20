/** Repeatability of the whole pipeline, as the page runs it on synthetic folder picks. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { iterPages } from '#src/telegram/export/export-files.ts';
import { pickFolder } from '#test/browser-picks.ts';
import { dmChat, GROUP_EXPORT, writeInbox } from '#test/e2e-fixtures.ts';
import { BOT, writeExport } from '#test/helpers.ts';
import { tempDir } from '#test/temp-dir.ts';
import { type RunOptions } from './protocol.ts';
import { handleRun } from './run.ts';

const OPTIONS: RunOptions = { timeZone: 'Europe/Rome', player: null, salt: 'repeatability' };

type Result = [wikiText: string, playerText: string, report: string];

/** The page's run on these folders, each one pick: the wiki (without its timestamp), the player state and the report. */
async function run(...folders: string[]): Promise<Result> {
  const last = await handleRun(
    { type: 'run', picks: folders.map(pickFolder), options: OPTIONS },
    () => {}
  );
  expect(last.type).toBe('done');
  if (last.type !== 'done') throw new Error('not done');
  const { generated, ...wiki } = last.result.wiki;
  expect(generated).toBeTruthy();
  return [
    JSON.stringify(wiki, null, 2),
    JSON.stringify(last.result.player, null, 2),
    last.result.report.filter((l) => !l.startsWith('cartelle di esportazione')).join('\n'),
  ];
}

describe('rerun', () => {
  it('same_folders_twice_give_identical_output', async () => {
    const inbox = writeInbox(path.join(tempDir(), 'inbox'));
    const first = await run(inbox);
    expect(await run(inbox)).toStrictEqual(first);
    expect(JSON.parse(first[0]).items).not.toStrictEqual({}); // not trivially empty
  });
});

describe('order', () => {
  it('order_of_the_picks_does_not_matter', async () => {
    const inbox = writeInbox(path.join(tempDir(), 'inbox'));
    const dm = path.join(inbox, 'ChatExport_2026-10-17');
    const group = path.join(inbox, GROUP_EXPORT);
    expect(await run(group, dm)).toStrictEqual(await run(dm, group));
  });

  it('folder_names_do_not_matter', async () => {
    const root = tempDir();
    const inbox = writeInbox(path.join(root, 'inbox'));
    const other = path.join(root, 'renamed');
    fs.mkdirSync(other);
    fs.cpSync(path.join(inbox, 'ChatExport_2026-10-17'), path.join(other, 'zzz qualcosa'), {
      recursive: true,
    });
    fs.cpSync(path.join(inbox, GROUP_EXPORT), path.join(other, 'aaa'), { recursive: true });
    const [wiki, player] = await run(inbox);
    const [wiki2, player2] = await run(other);
    expect([wiki2, player2]).toStrictEqual([wiki, player]);
  });
});

describe('contained export', () => {
  it('older_shorter_export_changes_nothing', async () => {
    const inbox = writeInbox(path.join(tempDir(), 'inbox'));
    const [wiki, player] = await run(inbox);
    writeExport(path.join(inbox, 'ChatExport_2026-09-01'), BOT, [dmChat().messages.slice(0, 9)]);
    const [wiki2, player2] = await run(inbox);
    expect([wiki2, player2]).toStrictEqual([wiki, player]);
  });
});

describe('folder order on disk', () => {
  it('folders_are_read_in_name_order_whatever_their_creation_order', () => {
    const root = tempDir();
    // Created out of name order; read as a/x, a-c, b (paths compare by components, so
    // a/x comes before a-c), and the JSON warnings in name order too.
    for (const d of ['b', 'a-c', 'a/x', 'json-b', 'json-a'])
      fs.mkdirSync(path.join(root, d), { recursive: true });
    for (const d of ['b', 'a-c', 'a/x'])
      fs.writeFileSync(path.join(root, d, 'messages.html'), '', 'utf-8');
    for (const d of ['json-b', 'json-a'])
      fs.writeFileSync(path.join(root, d, 'result.json'), '{}', 'utf-8');
    const log: string[] = [];
    const labels = [...iterPages(root, (l) => log.push(l))].map((p) =>
      path.relative(root, p.label).replaceAll('\\', '/')
    );
    expect(labels).toStrictEqual(['a/x/messages.html', 'a-c/messages.html', 'b/messages.html']);
    expect(
      log.map((l) => path.basename(/^salto (.*): esportazione in formato JSON/.exec(l)?.[1] ?? l))
    ).toStrictEqual(['json-a', 'json-b']);
  });
});
