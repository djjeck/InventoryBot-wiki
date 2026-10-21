/** The worker's logic (run.ts): its queue, its storage and what it posts. Synthetic data only. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { RECORD_FORMAT_VERSION } from '#src/telegram/export/record.ts';
import { fileLike, pickFolder } from '#test/browser-picks.ts';
import { fakeIndexedDb } from '#test/fake-indexeddb.ts';
import { GOLDEN_OPTIONS, goldenRuns, normaliseOutput, readGolden } from '#test/golden.ts';
import { BOT, Chat, writeExport, writeMacExport } from '#test/helpers.ts';
import { tempDir } from '#test/temp-dir.ts';
import { startHarness, WORKER_SALT } from '#test/web-worker.ts';
import { type RunResult, type WorkerMessage } from './protocol.ts';
import { startWorker } from './run.ts';

/** A DM with the bot over two pages, and a group, each exported in its own folder. */
function writeInbox(): { dm: string; group: string } {
  const dir = tempDir();
  const dm = new Chat(BOT);
  dm.user('Mario', '/avventura', 0);
  dm.bot('@mario_r, ti tuffi nel lago e scorgi un sasso [C]!', 1);
  dm.user('Mario', '/inventario', 2);
  const group = new Chat('Gruppo Avventurieri', 5000);
  group.user('Luigi', 'ciao', 3);
  return {
    dm: writeExport(path.join(dir, 'ChatExport_dm'), BOT, [
      dm.messages.slice(0, 2),
      dm.messages.slice(2),
    ]),
    group: writeExport(path.join(dir, 'ChatExport_gruppo'), 'Gruppo Avventurieri', [
      group.messages,
    ]),
  };
}

/** A DM export of its own, dated `hour`, in `dir`. */
function writeDm(dir: string, hour: number): string {
  const c = new Chat(BOT, 100 * hour);
  c.user('Mario', '/avventura', hour * 60);
  c.bot('@mario_r, nel bosco trovi un sasso [C]!', hour * 60 + 1);
  return writeExport(path.join(tempDir(), dir), BOT, [c.messages]);
}

const statuses = (h: { exports(): { folder: string; status: string }[] }) =>
  h.exports().map((e) => [e.folder, e.status]);

const phases = (h: { posted: WorkerMessage[] }): string[] =>
  h.posted.flatMap((m) => (m.type === 'phase' ? [m.phase] : []));

describe('start-up', () => {
  it('empty_storage_gives_an_empty_list_and_an_empty_wiki', async () => {
    const h = await startHarness();
    expect(h.posted).toStrictEqual([
      {
        type: 'state',
        exports: [],
        options: { timeZone: 'Europe/Rome', player: null },
        storage: true,
      },
      { type: 'results', current: true, outcome: { status: 'empty' } },
    ]);
    expect(await h.store.salt()).toBe(WORKER_SALT);
  });

  it('current_saved_results_are_sent_at_once_and_not_rebuilt', async () => {
    const { factory } = fakeIndexedDb();
    const first = await startHarness(factory, { timeZone: 'Asia/Tokyo' });
    await first.add(pickFolder(writeInbox().dm));
    const built = first.last();
    const again = await startHarness(factory); // the page's defaults differ: the saved options win
    expect(again.posted[0]).toMatchObject({
      type: 'state',
      options: { timeZone: 'Asia/Tokyo', player: null },
      exports: [{ folder: 'ChatExport_dm', status: 'ready' }],
    });
    expect(again.results()).toMatchObject([
      { current: true, outcome: { status: 'done', result: built, savedAt: expect.any(String) } },
    ]);
    expect(phases(again)).toStrictEqual([]);
  });

  it('results_not_current_are_sent_then_rebuilt', async () => {
    const { factory } = fakeIndexedDb();
    const { dm, group } = writeInbox();
    const first = await startHarness(factory);
    await first.add(pickFolder(dm));
    const old = first.last();
    await first.add(pickFolder(group));
    const sources = first.exports().map((e) => e.id);
    // As if the page had closed before the second build was saved.
    await first.store.saveResults(old, { sources: sources.slice(0, 1), salt: WORKER_SALT });
    const again = await startHarness(factory);
    expect(again.results().map((r) => [r.current, r.outcome.status])).toStrictEqual([
      [false, 'done'],
      [true, 'done'],
    ]);
    expect(again.last().folders).toStrictEqual(['ChatExport_dm', 'ChatExport_gruppo']);
  });

  it('records_without_results_are_built', async () => {
    const { factory } = fakeIndexedDb();
    const { dm, group } = writeInbox();
    const first = await startHarness(factory);
    await first.add(pickFolder(dm), pickFolder(group));
    await first.store.removeRecord(first.exports()[1]?.id as string); // drops the results too
    const again = await startHarness(factory);
    expect(again.results()).toHaveLength(1);
    expect(again.last().folders).toStrictEqual(['ChatExport_dm']);
  });

  it('stale_records_are_listed_and_never_built', async () => {
    const { factory, dbs } = fakeIndexedDb();
    const { dm, group } = writeInbox();
    const first = await startHarness(factory);
    await first.add(pickFolder(group), pickFolder(dm));
    const staleId = first.exports()[0]?.id as string;
    const info = dbs.get('inventorybot-wiki')?.stores.get('records')?.get(staleId) as {
      formatVersion: number;
    };
    info.formatVersion = RECORD_FORMAT_VERSION + 1;
    const again = await startHarness(factory);
    expect(statuses(again)).toStrictEqual([
      ['ChatExport_gruppo', 'stale'],
      ['ChatExport_dm', 'ready'],
    ]);
    expect(again.last().folders).toStrictEqual(['ChatExport_dm']);
    // Only stale records left: an empty wiki.
    await again.send({ type: 'remove', id: again.exports()[1]?.id as string });
    expect(again.results().at(-1)?.outcome).toStrictEqual({ status: 'empty' });
    expect(statuses(again)).toStrictEqual([['ChatExport_gruppo', 'stale']]);
    // Added again, it counts.
    await again.add(pickFolder(group));
    expect(statuses(again)).toStrictEqual([['ChatExport_gruppo', 'ready']]);
  });

  it('a_salt_an_earlier_page_kept_is_adopted', async () => {
    const h = await startHarness(undefined, { salt: 'legacy' });
    expect(await h.store.salt()).toBe('legacy');
  });
});

describe('queue', () => {
  it('reads_in_order_one_at_a_time_and_builds_once', async () => {
    const h = await startHarness();
    const dirs = [writeDm('Primo', 1), writeDm('Secondo', 2), writeDm('Terzo', 3)];
    const lists: string[][] = [];
    h.onPost = (m) => {
      if (m.type === 'exports') lists.push(m.exports.map((e) => e.status));
    };
    await Promise.all(dirs.map((d) => h.worker.handle({ type: 'add', picks: [pickFolder(d)] })));
    await h.worker.idle();
    expect(lists).toContainEqual(['queued', 'queued', 'queued']);
    expect(lists).toContainEqual(['reading', 'queued', 'queued']);
    expect(lists).toContainEqual(['ready', 'reading', 'queued']);
    expect(lists.every((l) => l.filter((s) => s === 'reading').length <= 1)).toBe(true);
    const reads = h.posted.flatMap((m) => (m.type === 'read' ? [[m.id, m.done, m.total]] : []));
    expect(reads).toStrictEqual([
      ['job-0', 0, 1],
      ['job-0', 1, 1],
      ['job-1', 0, 1],
      ['job-1', 1, 1],
      ['job-2', 0, 1],
      ['job-2', 1, 1],
    ]);
    expect(statuses(h)).toStrictEqual([
      ['Primo', 'ready'],
      ['Secondo', 'ready'],
      ['Terzo', 'ready'],
    ]);
    // One build, after the queue drained, with every phase.
    expect(h.results()).toHaveLength(2); // the empty one at start, then the build
    expect(phases(h)).toStrictEqual(['parse', 'conversation', 'interpret', 'build']);
    expect(h.last()).toMatchObject({
      owner: 'mario_r',
      folders: ['Primo', 'Secondo', 'Terzo'],
      pages: 3,
      messages: 6,
      fromBot: 3,
      replies: 3,
      options: { timeZone: 'Europe/Rome', player: null },
    });
    expect(h.last().report[0]).toBe('cartelle di esportazione: 3; chat: InventoryBot');
  });

  it('shows_the_pages_read_while_reading', async () => {
    const h = await startHarness();
    const seen: unknown[] = [];
    h.onPost = (m) => {
      if (m.type === 'exports' && m.exports[0]?.status === 'reading') seen.push(m.exports[0]);
    };
    await h.add(pickFolder(writeInbox().dm));
    expect(seen).toStrictEqual([
      { id: 'job-0', status: 'reading', folder: 'ChatExport_dm', done: 0, total: 2 },
    ]);
  });

  it('an_export_already_stored_changes_nothing', async () => {
    const h = await startHarness();
    const { dm } = writeInbox();
    await h.add(pickFolder(dm));
    const builds = h.results().length;
    await h.add(pickFolder(dm));
    expect(h.results()).toHaveLength(builds);
    expect(statuses(h)).toStrictEqual([['ChatExport_dm', 'ready']]);
    expect(h.posted.at(-2)).toStrictEqual({
      type: 'notice',
      text: 'La cartella ChatExport_dm è già tra le esportazioni: non cambia nulla.',
      details: [],
    });
  });

  it('an_upload_during_a_build_makes_it_not_current_and_one_more_build_follows', async () => {
    const h = await startHarness();
    const { dm, group } = writeInbox();
    let sent = false;
    h.onPost = (m) => {
      if (m.type === 'phase' && !sent) {
        sent = true;
        void h.worker.handle({ type: 'add', picks: [pickFolder(group)] });
      }
    };
    await h.add(pickFolder(dm));
    const builds = h.results().slice(1);
    expect(builds.map((r) => r.current)).toStrictEqual([false, true]);
    const folders = builds.map((r) => r.outcome.status === 'done' && r.outcome.result.folders);
    expect(folders).toStrictEqual([['ChatExport_dm'], ['ChatExport_dm', 'ChatExport_gruppo']]);
  });

  it('new_options_during_a_build_are_built_after_it', async () => {
    const h = await startHarness();
    let sent = false;
    h.onPost = (m) => {
      if (m.type === 'phase' && !sent) {
        sent = true;
        void h.worker.handle({
          type: 'rebuild',
          options: { timeZone: 'Europe/Rome', player: 'luigi' },
        });
      }
    };
    await h.add(pickFolder(writeInbox().dm));
    expect(
      h
        .results()
        .slice(1)
        .map((r) => r.current)
    ).toStrictEqual([false, true]);
    expect(h.last().owner).toBe('luigi');
  });

  it('an_export_that_fails_is_listed_and_the_queue_goes_on', async () => {
    const h = await startHarness();
    await h.add(
      [fileLike('Rotta/messages.html', new Uint8Array([0xff, 0xfe, 0x00]))],
      [fileLike('Vuota/result.json', '{}')],
      pickFolder(writeInbox().dm)
    );
    const [dm, broken, empty] = h.exports();
    expect(broken).toMatchObject({ folder: 'Rotta', status: 'error', details: [] });
    expect(broken?.message).toMatch(/^Non è stato possibile leggere la cartella Rotta: /);
    expect(empty).toMatchObject({ folder: 'Vuota', status: 'error' });
    expect(empty?.message).toMatch(/^Nella cartella Vuota non c’è nessuna pagina di chat/);
    expect(empty?.details).toStrictEqual([
      'salto Vuota: esportazione in formato JSON, è supportato solo il formato HTML (Telegram Desktop -> Esporta cronologia chat -> Formato: HTML)',
    ]);
    expect(dm).toMatchObject({ folder: 'ChatExport_dm', status: 'ready' });
    // Errors are not pending work: the build is current.
    expect(h.last().folders).toStrictEqual(['ChatExport_dm']);
    // A failed entry goes when removed, and builds nothing.
    const builds = h.results().length;
    await h.send({ type: 'remove', id: broken?.id as string });
    expect(statuses(h)).toStrictEqual([
      ['ChatExport_dm', 'ready'],
      ['Vuota', 'error'],
    ]);
    expect(h.results()).toHaveLength(builds);
  });

  it('skipped_files_are_told', async () => {
    const h = await startHarness();
    const dm = writeInbox().dm;
    await h.add([...pickFolder(dm), fileLike('ChatExport_dm/backup.zip', 'PK')]);
    expect(h.posted).toContainEqual({
      type: 'notice',
      text: 'Nella cartella ChatExport_dm alcuni file sono stati saltati.',
      details: [
        "salto ChatExport_dm/backup.zip: i file zip non vengono letti, estrai l'esportazione in una cartella",
      ],
    });
  });

  it('a_queued_export_removed_is_never_read', async () => {
    const h = await startHarness();
    const { dm, group } = writeInbox();
    await h.worker.handle({ type: 'add', picks: [pickFolder(dm)] });
    await h.worker.handle({ type: 'add', picks: [pickFolder(group)] });
    await h.worker.handle({ type: 'remove', id: 'job-1' });
    await h.worker.idle();
    expect(statuses(h)).toStrictEqual([['ChatExport_dm', 'ready']]);
    expect(h.last().folders).toStrictEqual(['ChatExport_dm']);
  });

  it('an_export_removed_while_read_is_not_kept', async () => {
    const h = await startHarness();
    h.onPost = (m) => {
      if (m.type === 'read' && m.done === 1) void h.worker.handle({ type: 'remove', id: m.id });
    };
    await h.add(pickFolder(writeInbox().dm));
    expect(h.exports()).toStrictEqual([]);
    expect(h.results()).toHaveLength(1); // the empty one at start
  });

  it('one_pick_of_several_exports_stores_each', async () => {
    const h = await startHarness();
    const { dm, group } = writeInbox();
    await h.add(pickFolder(path.dirname(dm)));
    expect(h.exports().map((e) => e.folder)).toStrictEqual([
      path.join(path.basename(path.dirname(dm)), 'ChatExport_dm'),
      path.join(path.basename(path.dirname(group)), 'ChatExport_gruppo'),
    ]);
    expect(h.results()).toHaveLength(2);
  });
});

describe('removal', () => {
  it('removing_an_export_rebuilds_from_the_rest', async () => {
    const h = await startHarness();
    const dirs = [writeDm('Primo', 1), writeDm('Secondo', 2)];
    await h.add(...dirs.map(pickFolder));
    const both = h.last();
    await h.send({ type: 'remove', id: h.exports()[0]?.id as string });
    expect(statuses(h)).toStrictEqual([['Secondo', 'ready']]);
    expect(h.last().folders).toStrictEqual(['Secondo']);
    expect(h.last().replies).toBe(both.replies - 1);
    // Saved: a new visit sees the rebuilt results, current.
    const loaded = await h.store.loadResults();
    expect(loaded?.current).toBe(true);
    expect(loaded?.saved.result.folders).toStrictEqual(['Secondo']);
  });

  it('removing_the_last_export_gives_an_empty_wiki', async () => {
    const h = await startHarness();
    await h.add(pickFolder(writeInbox().dm));
    await h.send({ type: 'remove', id: h.exports()[0]?.id as string });
    expect(h.exports()).toStrictEqual([]);
    expect(h.results().at(-1)).toStrictEqual({
      type: 'results',
      current: true,
      outcome: { status: 'empty' },
    });
    expect(await h.store.loadResults()).toBeNull();
  });
});

describe('stops and errors', () => {
  it('no_dm_and_no_username_stops_keeping_the_records_then_the_username_lets_it_through', async () => {
    const h = await startHarness();
    await h.add(pickFolder(writeInbox().group));
    const stop = h.results().at(-1);
    expect(stop).toMatchObject({ current: true, outcome: { status: 'no-owner' } });
    // The group's real title is not printed before the build can anonymise it.
    expect(JSON.stringify(h.posted.filter((m) => m.type === 'results'))).not.toContain(
      'Avventurieri'
    );
    expect(statuses(h)).toStrictEqual([['ChatExport_gruppo', 'ready']]);
    expect(await h.store.loadRecords()).toHaveLength(1);
    await h.send({ type: 'rebuild', options: { timeZone: 'Europe/Rome', player: 'luigi' } });
    expect(h.last().owner).toBe('luigi');
    expect(h.last().options).toStrictEqual({ timeZone: 'Europe/Rome', player: 'luigi' });
  });

  it('macos_dates_are_read_in_the_chosen_time_zone', async () => {
    const c = new Chat(BOT);
    c.user('Mario', '/avventura', 0);
    c.bot('@mario_r, nel bosco trovi un sasso [C]!', 1);
    const mac = writeMacExport(path.join(tempDir(), 'Mac'), BOT, c.messages);
    const h = await startHarness(undefined, { timeZone: 'Asia/Tokyo' });
    await h.add(pickFolder(mac));
    expect(h.last().report[0]).toBe(
      'Mac: date senza fuso orario, lette nel fuso orario Asia/Tokyo'
    );
  });
});

describe('clear and missing storage', () => {
  it('clear_deletes_everything_and_makes_a_new_salt', async () => {
    const h = await startHarness();
    await h.add(pickFolder(writeInbox().dm));
    await h.send({ type: 'clear' });
    expect(h.posted.slice(-2)).toStrictEqual([
      {
        type: 'state',
        exports: [],
        options: { timeZone: 'Europe/Rome', player: null },
        storage: true,
      },
      { type: 'results', current: true, outcome: { status: 'empty' } },
    ]);
    expect(await h.store.loadRecords()).toStrictEqual([]);
    expect(await h.store.salt()).not.toBe(WORKER_SALT);
    // The worker goes on with the new salt.
    await h.add(pickFolder(writeInbox().dm));
    expect(h.last().owner).toBe('mario_r');
  });

  it('a_clear_while_reading_drops_the_export', async () => {
    const h = await startHarness();
    h.onPost = (m) => {
      if (m.type === 'read' && m.done === 1) void h.worker.handle({ type: 'clear' });
    };
    await h.add(pickFolder(writeInbox().dm));
    expect(h.exports()).toStrictEqual([]);
    expect(await h.store.loadRecords()).toStrictEqual([]);
    expect(h.results().at(-1)?.outcome).toStrictEqual({ status: 'empty' });
  });

  it('without_storage_the_exports_of_the_visit_are_kept_in_memory', async () => {
    const h = await startHarness(null);
    const { dm, group } = writeInbox();
    await h.add(pickFolder(dm), pickFolder(group));
    expect(h.posted.at(-1)).toMatchObject({ type: 'results', current: true });
    expect(statuses(h)).toStrictEqual([
      ['ChatExport_dm', 'ready'],
      ['ChatExport_gruppo', 'ready'],
    ]);
    expect(h.exports().map((e) => e.info?.seq)).toStrictEqual([0, 1]);
    expect(h.posted.find((m) => m.type === 'state')).toMatchObject({ storage: false });
    await h.add(pickFolder(dm));
    expect(h.posted.at(-2)).toMatchObject({ type: 'notice' });
    await h.send({ type: 'remove', id: h.exports()[1]?.id as string });
    expect(h.last().folders).toStrictEqual(['ChatExport_dm']);
  });

  it('messages_before_the_state_request_start_the_worker_with_defaults', async () => {
    const h = await startHarness();
    const store = h.store;
    const posted: string[] = [];
    const w = startWorker(store, (m) => posted.push(m.type));
    await w.handle({ type: 'rebuild', options: { timeZone: 'UTC', player: null } });
    await w.idle();
    expect(posted).toStrictEqual(['state', 'results', 'phase', 'results']);
    await w.handle({ type: 'state', options: { timeZone: 'UTC', player: null } });
    expect(posted.at(-1)).toBe('state');
  });
});

describe('parity with one run', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inventorybot-worker-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const runs = goldenRuns(tmp);
  const all = runs.find((r) => r.name === 'all')?.paths ?? [];

  /** The wiki and player files of a build, as the golden tests write them. */
  const files = (r: RunResult): string[] => [
    normaliseOutput(JSON.stringify(r.wiki, null, 2) + '\n'),
    JSON.stringify(r.player, null, 2) + '\n',
  ];
  const golden = (name: string): string[] => {
    const g = readGolden(name);
    return [g.get('wiki.json') as string, g.get('player.json') as string];
  };

  it('the_golden_exports_added_one_message_at_a_time_give_the_golden_wiki', async () => {
    expect(all.length).toBeGreaterThan(10);
    const h = await startHarness(undefined, {
      timeZone: GOLDEN_OPTIONS.timeZone,
      salt: GOLDEN_OPTIONS.salt,
    });
    const half = Math.floor(all.length / 2);
    await h.add(...all.slice(0, half).map(pickFolder)); // a build in between
    await h.add(...all.slice(half).map(pickFolder));
    expect(files(h.last())).toStrictEqual(golden('all'));
    await h.send({
      type: 'rebuild',
      options: { timeZone: GOLDEN_OPTIONS.timeZone, player: 'mario' },
    });
    expect(files(h.last())).toStrictEqual(golden('all-player-mario'));
  });
});
