/**
 * `npm run inspect -- [FOLDER ...] [--out DIR] [--player NAME] [--time-zone ZONE]`: a
 * development tool, not part of the product. Runs the web app's pipeline on exports on
 * disk (by default the folder `inbox/`), writes the wiki and the player state to the
 * output folder (by default `out/`) and prints an aggregate summary. The work is in
 * scripts/inspection.ts. Exit codes: 0 done, 1 stopped, 2 wrong arguments or a refused
 * output folder.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect, parseInspectArgs, systemTimeZone, USAGE, UsageError } from './inspection.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const args = parseInspectArgs(process.argv.slice(2), {
    inbox: path.join(ROOT, 'inbox'),
    out: path.join(ROOT, 'out'),
    timeZone: systemTimeZone(),
  });
  process.exitCode = await inspect(args, ROOT, console.log, console.error);
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  console.error(`${e.message}\n${USAGE}`);
  process.exitCode = 2;
}
