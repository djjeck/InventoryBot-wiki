/**
 * `npm run grammar:stamp`: records the grammar module's version and the hash of the files it
 * ships in its lock, after a bump of its version; refuses when the version was not bumped
 * (scripts/grammar-lock.ts).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCK_FILE, lockText, PACKAGE, readGrammarState, stampGrammar } from './grammar-lock.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const result = stampGrammar(readGrammarState(ROOT));
if ('error' in result) {
  console.error(result.error);
  process.exit(1);
}
fs.writeFileSync(path.join(ROOT, PACKAGE, LOCK_FILE), lockText(result.lock));
console.log(`${PACKAGE}/${LOCK_FILE}: ${result.lock.version} ${result.lock.hash}`);
