/**
 * An in-memory IndexedDB for the tests of the web app's storage (src/web/storage.ts) and
 * of the worker that uses it (src/web/run.ts).
 */
import { type DatabaseFactory } from '#src/web/storage.ts';

export interface FakeDb {
  version: number;
  stores: Map<string, Map<string, unknown>>;
}

/**
 * An in-memory IndexedDB with the members storage.ts uses. Callbacks fire asynchronously;
 * opening a newer version runs the upgrade; a transaction sees its own writes, commits
 * them once no request is pending after the microtasks of the last one (as browsers do),
 * and drops them on abort. `failWrites`: every write fails, as with a full disk.
 */
export function fakeIndexedDb(o: { failOpen?: boolean; failWrites?: boolean } = {}) {
  const dbs = new Map<string, FakeDb>();
  const later = (f: () => void): void => void setTimeout(f, 0);
  const handlers = () => ({
    result: undefined as unknown,
    error: null as unknown,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
  });

  /** Per database, whether a transaction runs, and the ones waiting for it, in order. */
  const lines = new WeakMap<FakeDb, { running: boolean; waiting: (() => void)[] }>();

  /**
   * A transaction on every store of `names`. As in browsers, readwrite transactions on
   * the same stores run one after another, in the order they were created: a later one
   * starts (sees the data, runs its requests) once the earlier one has finished.
   */
  function transaction(data: FakeDb, names: string[]) {
    if (names.some((n) => !data.stores.has(n))) throw new Error('NotFoundError');
    let line = lines.get(data);
    if (line === undefined) lines.set(data, (line = { running: false, waiting: [] }));
    let work = new Map<string, Map<string, unknown>>();
    let started = false;
    /** Requests made before the transaction started. */
    const held: (() => void)[] = [];
    let pending = 0;
    let finished = false;
    const finish = (): void => {
      finished = true;
      const next = line.waiting.shift();
      if (next === undefined) line.running = false;
      else next();
    };
    const tx = {
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      abort() {
        if (finished) throw new Error('InvalidStateError');
        finish();
        later(() => tx.onabort?.());
      },
      objectStore(name: string) {
        if (!names.includes(name)) throw new Error('NotFoundError');
        const m = (): Map<string, unknown> => work.get(name) as Map<string, unknown>;
        const request = (run: () => unknown, write: boolean) => {
          if (finished) throw new Error('TransactionInactiveError');
          pending++;
          const r = handlers();
          const go = (): void =>
            later(() => {
              pending--;
              if (finished) return;
              if (write && o.failWrites) {
                r.error = new Error('QuotaExceededError');
                r.onerror?.();
                tx.onerror?.();
                finish();
                tx.onabort?.();
                return;
              }
              r.result = run();
              r.onsuccess?.();
              commitLater();
            });
          if (started) go();
          else held.push(go);
          return r;
        };
        return {
          get: (k: string) => request(() => structuredClone(m().get(k)), false),
          getAll: () =>
            request(() => [...m().keys()].sort().map((k) => structuredClone(m().get(k))), false),
          put: (v: unknown, k: string) => request(() => void m().set(k, structuredClone(v)), true),
          delete: (k: string) => request(() => void m().delete(k), true),
          clear: () => request(() => m().clear(), true),
        };
      },
    };
    const commitLater = (): void =>
      later(() => {
        if (finished || pending > 0) return;
        for (const [n, m] of work) data.stores.set(n, m);
        finish();
        tx.oncomplete?.();
      });
    const start = (): void => {
      started = true;
      work = new Map(names.map((n) => [n, new Map(data.stores.get(n))]));
      for (const go of held.splice(0)) go();
      commitLater();
    };
    if (line.running) line.waiting.push(start);
    else {
      line.running = true;
      start();
    }
    return tx;
  }

  const factory = {
    open(name: string, version: number) {
      if (o.failOpen) throw new Error('SecurityError');
      const req = Object.assign(handlers(), {
        onupgradeneeded: null as ((e: { oldVersion: number }) => void) | null,
      });
      later(() => {
        const data = dbs.get(name) ?? { version: 0, stores: new Map() };
        if (version < data.version) {
          req.error = new Error('VersionError');
          return req.onerror?.();
        }
        dbs.set(name, data);
        let closed = false;
        req.result = {
          objectStoreNames: { contains: (n: string) => data.stores.has(n) },
          createObjectStore: (n: string) => void data.stores.set(n, new Map()),
          deleteObjectStore: (n: string) => void data.stores.delete(n),
          close: () => void (closed = true),
          transaction(names: string[]) {
            if (closed) throw new Error('InvalidStateError');
            return transaction(data, names);
          },
        };
        if (version > data.version) {
          const oldVersion = data.version;
          data.version = version;
          req.onupgradeneeded?.({ oldVersion });
        }
        req.onsuccess?.();
      });
      return req;
    },
    deleteDatabase(name: string) {
      const req = Object.assign(handlers(), { onblocked: null });
      later(() => {
        dbs.delete(name);
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { factory: factory as unknown as DatabaseFactory, dbs };
}
