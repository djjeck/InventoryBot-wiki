/**
 * `npm run check:grammar`: fails when the files the grammar module ships changed and its version
 * did not (scripts/grammar-lock.ts).
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkGrammar, readGrammarState } from './grammar-lock.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const problems = checkGrammar(readGrammarState(ROOT));
for (const p of problems) console.error(p);
process.exit(problems.length > 0 ? 1 : 0);
