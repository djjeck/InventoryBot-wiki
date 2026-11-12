/**
 * The grammar module's version discipline (CLAUDE.md, "The grammar module"): any change to a file
 * the module ships needs a new version in its `module.json`. `packages/grammar/module.lock.json`
 * records the version and a hash of the files it ships; `npm run check:grammar` fails when the hash
 * changed and the lock was not stamped again, and `npm run grammar:stamp` stamps it after a bump.
 *
 * The files shipped are those MegaBotTron1999 installs (its `module-files.ts`): all of the
 * package's, but its tests (`*.test.ts`, `*.spec.ts` and the like, and `test/`, `tests/`,
 * `__tests__/`, `__snapshots__/` at any depth) and its top-level `vendor/`. Two differences: the
 * lock itself is left out of its own hash, and the files are those git tracks or would track (as a
 * GitHub install sees the repository), so an ignored file never counts. A `files` list in
 * `module.json` is not supported: the check refuses it.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** The package, from the repository's root. */
export const PACKAGE = 'packages/grammar';
/** The lock, in the package. */
export const LOCK_FILE = 'module.lock.json';

export interface GrammarLock {
  version: string;
  hash: string;
}

const TEST_DIRS = new Set(['test', 'tests', '__tests__', '__snapshots__']);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

/** Whether MegaBotTron1999 ships a file of the module (its path from the module's directory). */
export function shipped(rel: string): boolean {
  const parts = rel.split('/');
  const name = parts.pop() ?? '';
  if (rel === LOCK_FILE || parts.some((p) => p === '.git' || p === 'node_modules')) return false;
  return !(parts[0] === 'vendor' || parts.some((p) => TEST_DIRS.has(p)) || TEST_FILE.test(name));
}

/** The hash of the files shipped: each path, sorted, with the SHA-256 of its bytes. */
export function shippedHash(rels: readonly string[], read: (rel: string) => Uint8Array): string {
  const all = createHash('sha256');
  for (const rel of rels.filter(shipped).sort()) {
    all.update(`${rel}\0${createHash('sha256').update(read(rel)).digest('hex')}\n`);
  }
  return `sha256:${all.digest('hex')}`;
}

/** A `MAJOR.MINOR.PATCH[-pre]` version's order against another: <0, 0 or >0. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): [number[], string | null] => {
    const [core = '', pre] = v.split(/-(.*)/su);
    return [core.split('.').map(Number), pre ?? null];
  };
  const [ca, pa] = parse(a);
  const [cb, pb] = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (ca[i] ?? 0) - (cb[i] ?? 0);
    if (d !== 0) return d;
  }
  if (pa === pb) return 0;
  if (pa === null) return 1;
  if (pb === null) return -1;
  return pa < pb ? -1 : 1;
}

/** What the package's files say now. */
export interface GrammarState {
  /** `module.json`'s version and its `files`, if any. */
  module: { version: string; files?: unknown };
  /** `package.json`'s version. */
  packageVersion: string;
  /** The hash of the files shipped now. */
  hash: string;
  /** The lock recorded, if any. */
  lock: GrammarLock | null;
}

const STAMP = 'npm run grammar:stamp';

/** Why the package fails the check: one line each, none when it passes. */
export function checkGrammar(s: GrammarState): string[] {
  if (s.module.files !== undefined)
    return [
      `${PACKAGE}/module.json has a files list, which ${LOCK_FILE} does not follow: remove it, or teach scripts/grammar-lock.ts`,
    ];
  const out: string[] = [];
  if (s.packageVersion !== s.module.version)
    out.push(
      `${PACKAGE}/package.json is at version ${s.packageVersion}, its module.json at ${s.module.version}: give both the same version`
    );
  if (s.lock === null) out.push(`${PACKAGE}/${LOCK_FILE} is missing: run ${STAMP}`);
  else if (s.lock.version === s.module.version && s.lock.hash !== s.hash)
    out.push(
      `the files the grammar module ships changed, and its version is still ${s.module.version}: bump the version in ${PACKAGE}/module.json and package.json (CLAUDE.md, "The grammar module"), then run ${STAMP}`
    );
  else if (s.lock.version !== s.module.version)
    out.push(
      `${PACKAGE}/module.json is at version ${s.module.version}, its ${LOCK_FILE} at ${s.lock.version}: run ${STAMP}`
    );
  return out;
}

/** The lock to write, or why it is refused. */
export function stampGrammar(s: GrammarState): { lock: GrammarLock } | { error: string } {
  const problems = checkGrammar(s).filter((p) => !p.includes(STAMP));
  if (problems.length > 0) return { error: problems.join('\n') };
  if (s.lock !== null && s.lock.version === s.module.version) {
    return s.lock.hash === s.hash
      ? { lock: s.lock }
      : {
          error: `the version is still ${s.module.version}, as the lock records: bump it in ${PACKAGE}/module.json and package.json first`,
        };
  }
  if (s.lock !== null && compareVersions(s.module.version, s.lock.version) < 0)
    return {
      error: `version ${s.module.version} is older than ${s.lock.version}, the lock's: a version only goes up`,
    };
  return { lock: { version: s.module.version, hash: s.hash } };
}

/** The package's state in a repository: its files as git lists them (new ones included, ignored ones not). */
export function readGrammarState(root: string): GrammarState {
  const dir = path.join(root, PACKAGE);
  const json = (rel: string): unknown => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf-8'));
  const listed = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', PACKAGE],
    { cwd: root, encoding: 'utf-8' }
  );
  const rels = listed
    .split('\n')
    .filter((f) => f !== '' && fs.existsSync(path.join(root, f))) // listed but deleted
    .map((f) => f.slice(PACKAGE.length + 1));
  const lockPath = path.join(dir, LOCK_FILE);
  return {
    module: json('module.json') as GrammarState['module'],
    packageVersion: (json('package.json') as { version: string }).version,
    hash: shippedHash(rels, (rel) => fs.readFileSync(path.join(dir, rel))),
    lock: fs.existsSync(lockPath) ? (json(LOCK_FILE) as GrammarLock) : null,
  };
}

/** The lock's text, as the stamp writes it. */
export const lockText = (lock: GrammarLock): string =>
  `${JSON.stringify({ version: lock.version, hash: lock.hash }, null, 2)}\n`;
