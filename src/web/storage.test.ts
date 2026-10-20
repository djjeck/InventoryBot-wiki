import { describe, expect, it } from 'vitest';
import { type RunResult } from './protocol.ts';
import { type DatabaseFactory, resultStore } from './storage.ts';

/** An in-memory IndexedDB with the members storage.ts uses; callbacks fire asynchronously. */
function fakeIndexedDb(o: { failOpen?: boolean; failPut?: boolean } = {}) {
  const dbs = new Map<string, Map<string, unknown>>();
  const later = (f: () => void): void => void setTimeout(f, 0);
  const request = <T>(run: () => T, fail = false) => {
    const r = {
      result: undefined as T | undefined,
      error: null as unknown,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    later(() => {
      if (fail) {
        r.error = new Error('failed');
        r.onerror?.();
      } else {
        r.result = run();
        r.onsuccess?.();
      }
    });
    return r;
  };
  const factory = {
    open(name: string) {
      if (o.failOpen) throw new Error('SecurityError');
      const fresh = !dbs.has(name);
      const stores = dbs.get(name) ?? new Map<string, unknown>();
      dbs.set(name, stores);
      const names = new Set<string>();
      const db = {
        objectStoreNames: { contains: (n: string) => names.has(n) },
        createObjectStore: (n: string) => names.add(n),
        close: () => {},
        transaction() {
          const tx = {
            oncomplete: null as (() => void) | null,
            onerror: null as (() => void) | null,
            onabort: null as (() => void) | null,
            objectStore: () => ({
              get: (k: string) => request(() => stores.get(k)),
              put: (v: unknown, k: string) => {
                const r = request(() => void stores.set(k, structuredClone(v)), o.failPut);
                if (o.failPut) later(() => tx.onerror?.());
                return r;
              },
            }),
          };
          later(() => later(() => tx.oncomplete?.()));
          return tx;
        },
      };
      const out = Object.assign(
        request(() => db),
        { onupgradeneeded: null as (() => void) | null }
      );
      // A new database is upgraded first (the success callback is queued after this one).
      queueMicrotask(() => {
        if (fresh) {
          out.result = db;
          out.onupgradeneeded?.();
        }
      });
      return out;
    },
    deleteDatabase(name: string) {
      // Object.assign, not a spread: the callbacks are set on the request that fires.
      return Object.assign(
        request(() => void dbs.delete(name)),
        { onblocked: null }
      );
    },
  };
  return { factory: factory as unknown as DatabaseFactory, dbs };
}

const RESULT = { owner: 'mario', report: ['giocatore: @mario'] } as unknown as RunResult;
const NOW = new Date('2026-01-02T03:04:05Z');

describe('resultStore', () => {
  it('saves_loads_and_clears_the_last_result', async () => {
    const { factory, dbs } = fakeIndexedDb();
    const store = resultStore(factory);
    expect(store.available).toBe(true);
    expect(await store.load()).toBeNull();
    expect(await store.save(RESULT, NOW)).toBe(true);
    expect(await store.load()).toStrictEqual({
      version: 1,
      savedAt: '2026-01-02T03:04:05.000Z',
      result: RESULT,
    });
    expect(await store.clear()).toBe(true);
    expect(dbs.size).toBe(0);
    expect(await store.load()).toBeNull();
  });

  it('no_storage_means_no_memory_and_no_errors', async () => {
    const store = resultStore(undefined);
    expect(store.available).toBe(false);
    expect(await store.load()).toBeNull();
    expect(await store.save(RESULT)).toBe(false);
    expect(await store.clear()).toBe(false);
  });

  it('storage_that_throws_is_marked_unavailable', async () => {
    const store = resultStore(fakeIndexedDb({ failOpen: true }).factory);
    expect(await store.load()).toBeNull();
    expect(store.available).toBe(false);
    expect(await store.save(RESULT)).toBe(false);
  });

  it('a_failed_save_gives_false', async () => {
    const store = resultStore(fakeIndexedDb({ failPut: true }).factory);
    expect(await store.save(RESULT)).toBe(false);
    expect(store.available).toBe(false);
  });

  it('a_record_of_another_version_is_ignored', async () => {
    const { factory, dbs } = fakeIndexedDb();
    const store = resultStore(factory);
    await store.save(RESULT);
    dbs.get('inventorybot-wiki')?.set('last', { version: 2, result: {} });
    expect(await store.load()).toBeNull();
  });
});
