/**
 * Rewrites test/golden/ from the pipeline: `npm run golden:update`.
 *
 * Use it only after an intentional change of the output (a fixed defect, a new field,
 * a new scenario), and review the resulting diff of test/golden/ like code: every
 * changed line must be explained by the change. See test/golden.ts.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GOLDEN_DIR, goldenRuns, runGoldenRun, writeGolden } from '#test/golden.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inventorybot-golden-'));
try {
  const runs = goldenRuns(tmp);
  const names = new Set(runs.map((r) => r.name));
  // Folders of runs that no longer exist.
  if (fs.existsSync(GOLDEN_DIR)) {
    for (const d of fs.readdirSync(GOLDEN_DIR))
      if (!names.has(d)) fs.rmSync(path.join(GOLDEN_DIR, d), { recursive: true, force: true });
  }
  for (const run of runs) writeGolden(run.name, await runGoldenRun(run));
  console.error(
    `${runs.length} golden runs written to ${path.relative(process.cwd(), GOLDEN_DIR) || '.'}; review the diff before committing.`
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
