import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkGrammar,
  compareVersions,
  type GrammarState,
  readGrammarState,
  shipped,
  shippedHash,
  stampGrammar,
} from './grammar-lock.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A package's files, by path, as text. */
const FILES: Record<string, string> = {
  'module.json': '{"version":"0.1.0"}',
  'package.json': '{"version":"0.1.0"}',
  'src/index.ts': 'export {};',
  'src/index.test.ts': 'test',
};
const hashOf = (files: Record<string, string>): string =>
  shippedHash(Object.keys(files), (rel) => new TextEncoder().encode(files[rel]));

const state = (over: Partial<GrammarState> = {}): GrammarState => ({
  module: { version: '0.1.0' },
  packageVersion: '0.1.0',
  hash: hashOf(FILES),
  lock: { version: '0.1.0', hash: hashOf(FILES) },
  ...over,
});

describe('the files shipped', () => {
  it('all_but_tests_vendor_and_the_lock', () => {
    const files = [
      'module.json',
      'package.json',
      'LICENSE',
      'src/index.ts',
      'src/lib/text.ts',
      'src/index.test.ts',
      'src/x.spec.js',
      'src/test/fixture.ts',
      'src/__snapshots__/a.snap',
      'vendor/x.ts',
      'module.lock.json',
    ];
    expect(files.filter(shipped)).toStrictEqual([
      'module.json',
      'package.json',
      'LICENSE',
      'src/index.ts',
      'src/lib/text.ts',
    ]);
  });

  it('the_hash_follows_contents_and_paths_not_tests_nor_order', () => {
    const h = hashOf(FILES);
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(hashOf({ ...FILES, 'src/index.test.ts': 'other test' })).toBe(h);
    expect(hashOf(Object.fromEntries(Object.entries(FILES).reverse()))).toBe(h);
    expect(hashOf({ ...FILES, 'src/index.ts': 'export const a = 1;' })).not.toBe(h);
    expect(hashOf({ ...FILES, 'src/more.ts': '' })).not.toBe(h);
  });
});

describe('the check', () => {
  it('passes_when_nothing_shipped_changed', () => {
    expect(checkGrammar(state())).toStrictEqual([]);
  });

  it('passes_when_only_tests_changed', () => {
    const changed = hashOf({ ...FILES, 'src/index.test.ts': 'another test' });
    expect(checkGrammar(state({ hash: changed }))).toStrictEqual([]);
  });

  it('fails_when_a_shipped_file_changed_and_the_version_did_not', () => {
    const changed = hashOf({ ...FILES, 'src/index.ts': 'export const a = 1;' });
    const [problem, ...more] = checkGrammar(state({ hash: changed }));
    expect(more).toStrictEqual([]);
    expect(problem).toContain('bump the version');
    expect(problem).toContain('npm run grammar:stamp');
  });

  it('fails_when_bumped_but_not_stamped', () => {
    const bumped = state({ module: { version: '0.1.1' }, packageVersion: '0.1.1', hash: 'x' });
    expect(checkGrammar(bumped)).toStrictEqual([
      'packages/grammar/module.json is at version 0.1.1, its module.lock.json at 0.1.0: run npm run grammar:stamp',
    ]);
  });

  it('fails_on_versions_that_differ_a_missing_lock_or_a_files_list', () => {
    expect(checkGrammar(state({ packageVersion: '0.2.0' }))[0]).toContain('give both the same');
    expect(checkGrammar(state({ lock: null }))[0]).toContain('is missing');
    expect(checkGrammar(state({ module: { version: '0.1.0', files: ['src'] } }))[0]).toContain(
      'has a files list'
    );
  });
});

describe('the stamp', () => {
  it('records_a_bumped_version_and_the_hash', () => {
    const s = state({ module: { version: '0.2.0' }, packageVersion: '0.2.0', hash: 'h2' });
    expect(stampGrammar(s)).toStrictEqual({ lock: { version: '0.2.0', hash: 'h2' } });
  });

  it('records_the_first_lock', () => {
    expect(stampGrammar(state({ lock: null, hash: 'h' }))).toStrictEqual({
      lock: { version: '0.1.0', hash: 'h' },
    });
  });

  it('refuses_a_change_without_a_bump', () => {
    const r = stampGrammar(state({ hash: 'changed' }));
    expect('error' in r && r.error).toContain('bump it');
  });

  it('keeps_a_current_lock', () => {
    expect(stampGrammar(state())).toStrictEqual({ lock: state().lock });
  });

  it('refuses_an_older_version_or_versions_that_differ', () => {
    const older = stampGrammar(state({ module: { version: '0.0.9' }, packageVersion: '0.0.9' }));
    expect('error' in older && older.error).toContain('only goes up');
    const apart = stampGrammar(state({ module: { version: '0.2.0' } }));
    expect('error' in apart && apart.error).toContain('give both the same');
  });

  it('orders_versions_with_pre_releases', () => {
    expect(
      [
        ['0.1.0', '0.1.0'],
        ['0.1.1', '0.1.0'],
        ['0.1.0', '0.2.0'],
        ['1.0.0', '1.0.0-alpha.1'],
        ['1.0.0-alpha.1', '1.0.0'],
        ['1.0.0-alpha.1', '1.0.0-alpha.2'],
        ['1.0.0-beta', '1.0.0-alpha'],
      ].map(([a, b]) => Math.sign(compareVersions(a as string, b as string)))
    ).toStrictEqual([0, 1, -1, 1, -1, -1, 1]);
  });
});

describe('this repository', () => {
  it('reads_the_package_as_it_is', () => {
    const s = readGrammarState(ROOT);
    expect(s.module.version).toBe(s.packageVersion);
    expect(s.hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
});
