import { describe, expect, it } from 'vitest';
import { type ExportRecord, RECORD_FORMAT_VERSION } from '#src/telegram/export/record.ts';
import { type FakeDb, fakeIndexedDb } from '#test/fake-indexeddb.ts';
import { type RunResult } from './protocol.ts';
import { DB_VERSION, openStore } from './storage.ts';

const DB = 'inventorybot-wiki';
const SALT = 'a1b2c3';
const NOW = new Date('2026-01-02T03:04:05Z');
const RESULT = { owner: 'mario', report: ['giocatore: @mario'] } as unknown as RunResult;

/** A record with no messages: only what storage reads of it. */
function record(hash: string, over: Partial<ExportRecord> = {}): ExportRecord {
  return {
    formatVersion: RECORD_FORMAT_VERSION,
    folder: `ChatExport_${hash}`,
    hash,
    pages: 1,
    chats: ['InventoryBot'],
    senders: [],
    firstDate: '01.01.2026 10:00:00 UTC+01:00',
    lastDate: '02.01.2026 10:00:00 UTC+01:00',
    counts: { messages: 0, fromBot: 0, kept: 0 },
    entries: [],
    ...over,
  };
}

/** A store on a new fake, its salt set to SALT. */
async function freshStore(o: Parameters<typeof fakeIndexedDb>[0] = {}) {
  const fake = fakeIndexedDb(o);
  const store = openStore(fake.factory);
  await store.salt(SALT);
  return { ...fake, store };
}

const stored = (dbs: Map<string, FakeDb>, store: string) => dbs.get(DB)?.stores.get(store);

describe('openStore: salt', () => {
  it('stores_the_candidate_once_then_keeps_it', async () => {
    const store = openStore(fakeIndexedDb().factory);
    expect(await store.salt(SALT)).toBe(SALT);
    expect(await store.salt('other')).toBe(SALT);
  });

  it('makes_a_random_salt_without_a_candidate', async () => {
    const store = openStore(fakeIndexedDb().factory);
    const salt = await store.salt();
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(await store.salt()).toBe(salt);
  });

  it('a_missing_salt_drops_records_and_results', async () => {
    const { store, dbs } = await freshStore();
    await store.addRecord(record('h1'), { salt: SALT });
    await store.saveResults(RESULT, { sources: ['h1'], salt: SALT });
    stored(dbs, 'meta')?.delete('salt');
    expect(await store.listRecords()).toStrictEqual([]);
    expect(await store.loadResults()).toBeNull();
    expect(stored(dbs, 'payloads')?.size).toBe(0);
    expect(await store.salt(SALT)).not.toBe(SALT); // a new salt was made by the first call
  });

  it('an_empty_salt_counts_as_missing', async () => {
    const { store, dbs } = await freshStore();
    await store.addRecord(record('h1'), { salt: SALT });
    stored(dbs, 'meta')?.set('salt', '');
    expect(await store.loadRecords()).toStrictEqual([]);
  });

  it('refuses_records_and_results_made_with_another_salt', async () => {
    const { store } = await freshStore();
    expect(await store.addRecord(record('h1'), { salt: 'other' })).toStrictEqual({
      status: 'refused',
    });
    expect(await store.saveResults(RESULT, { sources: [], salt: 'other' })).toBe(false);
    expect(await store.listRecords()).toStrictEqual([]);
    expect(await store.loadResults()).toBeNull();
  });
});

describe('openStore: records', () => {
  it('adds_lists_and_loads_in_upload_order', async () => {
    const { store } = await freshStore();
    const zz = record('zz', { chats: ['InventoryBot', null] });
    const add = await store.addRecord(zz, { salt: SALT, folder: 'Telegram/Bot', now: NOW });
    expect(add).toStrictEqual({
      status: 'added',
      info: {
        hash: 'zz',
        seq: 0,
        formatVersion: RECORD_FORMAT_VERSION,
        folder: 'Telegram/Bot',
        addedAt: '2026-01-02T03:04:05.000Z',
        pages: 1,
        chats: ['InventoryBot', null],
        firstDate: '01.01.2026 10:00:00 UTC+01:00',
        lastDate: '02.01.2026 10:00:00 UTC+01:00',
        counts: { messages: 0, fromBot: 0, kept: 0 },
      },
    });
    await store.addRecord(record('aa'), { salt: SALT });
    // Upload order, not hash order.
    expect((await store.listRecords()).map((r) => [r.hash, r.seq, r.stale])).toStrictEqual([
      ['zz', 0, false],
      ['aa', 1, false],
    ]);
    expect(await store.loadRecords()).toStrictEqual([zz, record('aa')]);
  });

  it('the_folder_defaults_to_the_records', async () => {
    const { store } = await freshStore();
    const add = await store.addRecord(record('h1'), { salt: SALT });
    expect(add.status === 'added' && add.info.folder).toBe('ChatExport_h1');
  });

  it('adding_a_stored_hash_is_a_no_op_giving_the_entry', async () => {
    const { store } = await freshStore();
    const first = await store.addRecord(record('h1'), { salt: SALT, folder: 'a', now: NOW });
    await store.addRecord(record('h2'), { salt: SALT });
    const again = await store.addRecord(record('h1', { pages: 9 }), { salt: SALT, folder: 'b' });
    expect(first.status).toBe('added');
    expect(again).toStrictEqual({
      status: 'kept',
      info: first.status === 'added' ? first.info : null,
    });
    expect((await store.loadRecords()).map((r) => [r.hash, r.pages])).toStrictEqual([
      ['h1', 1],
      ['h2', 1],
    ]);
  });

  it('refuses_a_record_of_another_format', async () => {
    const { store } = await freshStore();
    const old = { ...record('h1'), formatVersion: 0 } as unknown as ExportRecord;
    expect(await store.addRecord(old, { salt: SALT })).toStrictEqual({ status: 'refused' });
  });

  it('a_stale_record_is_listed_not_loaded_and_its_payload_dropped', async () => {
    const { store, dbs } = await freshStore();
    await store.addRecord(record('h1'), { salt: SALT });
    await store.addRecord(record('h2'), { salt: SALT });
    // As if written by a version of the page with another record format.
    const info = stored(dbs, 'records')?.get('h1') as { formatVersion: number };
    info.formatVersion = RECORD_FORMAT_VERSION + 1;
    const listed = await store.listRecords();
    expect(listed.map((r) => [r.hash, r.stale])).toStrictEqual([
      ['h1', true],
      ['h2', false],
    ]);
    expect(listed[0]?.chats).toStrictEqual(['InventoryBot']); // kept for display
    expect(stored(dbs, 'payloads')?.has('h1')).toBe(false);
    expect((await store.loadRecords()).map((r) => r.hash)).toStrictEqual(['h2']);
    // Added again: a usable record, in its old place.
    expect((await store.addRecord(record('h1'), { salt: SALT })).status).toBe('added');
    expect((await store.loadRecords()).map((r) => r.hash)).toStrictEqual(['h1', 'h2']);
  });

  it('removes_one_record_and_the_results', async () => {
    const { store } = await freshStore();
    await store.addRecord(record('h1'), { salt: SALT });
    await store.addRecord(record('h2'), { salt: SALT });
    await store.saveResults(RESULT, { sources: ['h1', 'h2'], salt: SALT });
    expect(await store.removeRecord('h1')).toBe(true);
    expect((await store.loadRecords()).map((r) => r.hash)).toStrictEqual(['h2']);
    expect(await store.loadResults()).toBeNull();
    // A new upload comes after every earlier one, removed ones included.
    const add = await store.addRecord(record('h1'), { salt: SALT });
    expect(add.status === 'added' && add.info.seq).toBe(2);
  });
});

describe('openStore: results', () => {
  it('saves_and_loads_the_results_with_their_sources', async () => {
    const { store } = await freshStore();
    expect(await store.loadResults()).toBeNull();
    await store.addRecord(record('h1'), { salt: SALT });
    expect(await store.saveResults(RESULT, { sources: ['h1'], salt: SALT, now: NOW })).toBe(true);
    expect(await store.loadResults()).toStrictEqual({
      saved: { savedAt: '2026-01-02T03:04:05.000Z', sources: ['h1'], build: '', result: RESULT },
      current: true,
    });
  });

  it('results_are_current_only_for_the_usable_records_in_order', async () => {
    const { store, dbs } = await freshStore();
    await store.addRecord(record('h1'), { salt: SALT });
    await store.addRecord(record('h2'), { salt: SALT });
    const current = async (sources: string[]) => {
      await store.saveResults(RESULT, { sources, salt: SALT });
      return (await store.loadResults())?.current;
    };
    expect(await current(['h1', 'h2'])).toBe(true);
    expect(await current(['h2', 'h1'])).toBe(false);
    expect(await current(['h1'])).toBe(false); // h2 added since
    expect(await current(['h1', 'h2', 'h3'])).toBe(false);
    const info = stored(dbs, 'records')?.get('h2') as { formatVersion: number };
    info.formatVersion = RECORD_FORMAT_VERSION + 1;
    expect(await current(['h1', 'h2'])).toBe(false); // h2 is stale
    expect(await current(['h1'])).toBe(true);
  });

  it('results_of_another_build_of_the_page_are_not_current', async () => {
    const fake = fakeIndexedDb();
    const older = openStore(fake.factory, '0.9.0');
    await older.salt(SALT);
    await older.addRecord(record('h1'), { salt: SALT });
    await older.saveResults(RESULT, { sources: ['h1'], salt: SALT });
    expect((await older.loadResults())?.current).toBe(true);
    const newer = openStore(fake.factory, '0.10.0');
    // Shown at once, and built again.
    expect(await newer.loadResults()).toMatchObject({ saved: { result: RESULT }, current: false });
  });

  it('results_from_no_records_are_current_without_records', async () => {
    const { store } = await freshStore();
    await store.saveResults(RESULT, { sources: [], salt: SALT });
    expect((await store.loadResults())?.current).toBe(true);
  });
});

describe('openStore: clear, migration, unavailable storage', () => {
  it('clear_deletes_records_results_and_salt', async () => {
    const { store, dbs } = await freshStore();
    await store.addRecord(record('h1'), { salt: SALT });
    await store.saveResults(RESULT, { sources: ['h1'], salt: SALT });
    expect(await store.clear()).toBe(true);
    expect(dbs.size).toBe(0);
    expect(await store.listRecords()).toStrictEqual([]);
    expect(await store.loadResults()).toBeNull();
    expect(await store.salt('new')).not.toBe(SALT);
  });

  it('migrates_from_the_results_only_schema_dropping_the_old_results', async () => {
    const { factory, dbs } = fakeIndexedDb();
    dbs.set(DB, {
      version: 1,
      stores: new Map([
        ['results', new Map<string, unknown>([['last', { version: 1, result: RESULT }]])],
      ]),
    });
    const store = openStore(factory);
    expect(await store.loadResults()).toBeNull();
    expect(dbs.get(DB)?.version).toBe(DB_VERSION);
    expect([...(dbs.get(DB)?.stores.keys() ?? [])].sort()).toStrictEqual([
      'meta',
      'payloads',
      'records',
      'results',
    ]);
    expect(stored(dbs, 'results')?.size).toBe(0);
    const salt = await store.salt();
    expect((await store.addRecord(record('h1'), { salt })).status).toBe('added');
  });

  it('no_storage_means_no_memory_and_no_errors', async () => {
    const store = openStore(undefined);
    expect(store.available).toBe(false);
    const salt = await store.salt();
    expect(await store.salt()).toBe(salt); // one salt for the visit
    expect(await store.listRecords()).toStrictEqual([]);
    expect(await store.loadRecords()).toStrictEqual([]);
    expect(await store.addRecord(record('h1'), { salt })).toStrictEqual({ status: 'unavailable' });
    expect(await store.removeRecord('h1')).toBe(false);
    expect(await store.loadResults()).toBeNull();
    expect(await store.saveResults(RESULT, { sources: [], salt })).toBe(false);
    expect(await store.clear()).toBe(false);
  });

  it('storage_that_throws_is_marked_unavailable', async () => {
    const store = openStore(fakeIndexedDb({ failOpen: true }).factory);
    expect(await store.salt(SALT)).toBe(SALT);
    expect(store.available).toBe(false);
    expect(await store.loadResults()).toBeNull();
    expect(await store.saveResults(RESULT, { sources: [], salt: SALT })).toBe(false);
  });

  it('refused_writes_store_nothing_and_mark_storage_unavailable', async () => {
    const { factory, dbs } = fakeIndexedDb({ failWrites: true });
    const store = openStore(factory);
    expect(await store.addRecord(record('h1'), { salt: SALT })).toStrictEqual({
      status: 'unavailable',
    });
    expect(store.available).toBe(false);
    expect(stored(dbs, 'records')?.size).toBe(0);
    // Unavailable from then on, with one salt for the rest of the visit.
    const salt = await store.salt(SALT);
    expect(await store.salt()).toBe(salt);
  });

  it('a_salt_already_known_stays_when_storage_fails_later', async () => {
    const fake = fakeIndexedDb();
    const store = openStore(fake.factory);
    expect(await store.salt(SALT)).toBe(SALT);
    fake.dbs.get(DB)?.stores.delete('meta'); // the next transaction fails
    expect(await store.listRecords()).toStrictEqual([]);
    expect(store.available).toBe(false);
    expect(await store.salt('other')).toBe(SALT);
  });
});
