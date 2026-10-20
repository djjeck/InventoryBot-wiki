/**
 * The pipeline on every synthetic scenario, byte for byte against test/golden/. See
 * test/golden.ts; `npm run golden:update` rewrites the files after an intentional
 * change, and the diff is reviewed like code.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GOLDEN_DIR, goldenRuns, readGolden, runGoldenRun } from '#test/golden.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inventorybot-golden-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const runs = goldenRuns(tmp);

describe('golden outputs', () => {
  it('has_one_golden_folder_per_run_and_no_other', () => {
    expect(fs.readdirSync(GOLDEN_DIR).sort()).toStrictEqual(runs.map((r) => r.name).sort());
  });

  for (const run of runs) {
    it(run.name, async () => {
      const expected = readGolden(run.name);
      const actual = (await runGoldenRun(run)).files;
      expect([...actual.keys()].sort(), 'files written').toStrictEqual([...expected.keys()].sort());
      for (const [file, text] of expected) {
        // Compare whole files as strings: a byte difference fails with a line diff.
        expect(actual.get(file), `${run.name}/${file}`).toBe(text);
      }
    });
  }
});
