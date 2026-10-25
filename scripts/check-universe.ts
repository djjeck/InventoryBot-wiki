/**
 * `npm run check:universe`: fails when the tests or docs mention an item, recipe, place or
 * Telegram username that is not in the invented world of scripts/universe.md (scripts/universe.ts). Scans every
 * text file git tracks or would track: new files included, ignored ones not.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUniverse, unknownEntities } from './universe.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Text files git tracks or would track, except the universe's own files and the lockfile. */
export function scannedFiles(root: string): string[] {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf-8',
  });
  return listed.split('\n').filter(
    (f) =>
      // Not CSS: its at-rules (media queries) read as usernames, and it holds no game text.
      /\.(ts|js|md|html|json|ya?ml)$/u.test(f) &&
      f !== 'package-lock.json' &&
      !f.startsWith('scripts/universe.') &&
      // Real game content, the example's chat: the one exception (CLAUDE.md).
      f !== 'src/web/demo-chat.ts' &&
      fs.existsSync(path.join(root, f)) // listed but deleted in the working tree
  );
}

/** One line per entity not in the universe, as `file:line: kind not in scripts/universe.md: text`. */
export function checkUniverse(root: string): string[] {
  const universe = parseUniverse(fs.readFileSync(path.join(root, 'scripts/universe.md'), 'utf-8'));
  return scannedFiles(root).flatMap((f) =>
    unknownEntities(fs.readFileSync(path.join(root, f), 'utf-8'), universe).map(
      (x) => `${f}:${x.line}: ${x.kind} not in scripts/universe.md: ${x.text}`
    )
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const unknown = checkUniverse(ROOT);
  for (const line of unknown) console.error(line);
  if (unknown.length > 0) {
    console.error(
      `\n${unknown.length} entities not in scripts/universe.md. Use an invented name from it, or ` +
        'invent a new one and add it there.'
    );
    process.exit(1);
  }
  console.log('Game content: every item, recipe, place and username is in scripts/universe.md.');
}
