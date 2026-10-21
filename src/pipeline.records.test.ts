/**
 * The records of processExport as a cache: on the golden scenarios (test/golden.ts),
 * building from records added one at a time, in any order, or with one removed, gives what
 * a run over the same exports gives, and so do records read back from JSON and records
 * that keep the whole chat.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pickFolder } from '#test/browser-picks.ts';
import { GOLDEN_OPTIONS, goldenRuns } from '#test/golden.ts';
import { INVENTORY_BOT } from './inventorybot/bot.ts';
import {
  buildWiki,
  type PipelineOptions,
  type PipelineOutcome,
  processExport,
  runPipeline,
} from './pipeline.ts';
import { type ExportRecord, readExport, splitExports } from './telegram/export/record.ts';
import { type Page } from './telegram/messages.ts';
import { readPicks } from './web/run.ts';

/** A golden run over export folders: its options and each export's pages. */
interface ExportsRun {
  name: string;
  options: PipelineOptions;
  /** The pages of each export, in run order. */
  exports: Page[][];
  /** The record of each export (processExport). */
  records: ExportRecord[];
  /** The record of each export with the whole chat kept (ReadOptions.keepAll). */
  full: ExportRecord[];
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inventorybot-records-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const runs: ExportsRun[] = [];

beforeAll(async () => {
  for (const run of goldenRuns(tmp)) {
    if (run.kind !== 'exports') continue;
    const read = await readPicks(run.paths.map(pickFolder));
    const options = { ...GOLDEN_OPTIONS, player: run.player ?? null };
    const exports = read.paths.flatMap(splitExports);
    const records: ExportRecord[] = [];
    const full: ExportRecord[] = [];
    for (const p of exports) {
      records.push(await processExport(p, options));
      full.push(await readExport(p, { bot: INVENTORY_BOT, salt: options.salt, keepAll: true }));
    }
    runs.push({ name: run.name, options, exports, records, full });
  }
});

/** JSON without the wiki's `generated` time, which is the run's. */
const stable = (value: unknown): string =>
  JSON.stringify(value, null, 2).replace(/"generated": "[^"]*"/u, '"generated": ""');

/** Every output of a run, as the golden files write them. */
function outputs(o: PipelineOutcome): string {
  if (o.status !== 'done') return JSON.stringify(o);
  const replies = o.conversed.conversation.replies;
  return stable({ report: o.report, replies, events: o.events, wiki: o.wiki, player: o.player });
}

/** The wiki and the player state only. */
function wikiAndPlayer(o: PipelineOutcome): string {
  if (o.status !== 'done') return o.status;
  return stable({ wiki: o.wiki, player: o.player });
}

/** A run over these exports, from their pages. */
const fromPages = (run: ExportsRun, exports: readonly Page[][]): Promise<PipelineOutcome> =>
  runPipeline(
    exports.map((p) => [...p]),
    run.options
  );

/** Every order of `xs` (n! of them): only for a few items. */
function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])
  );
}

/**
 * Orders to add the exports in, and the steps to check (the number of exports added so
 * far): all orders, every step, for up to 4 exports; else, as read and reversed, at a few
 * steps, and two more orders that move every export, at the end only (a run over every
 * scenario has dozens of exports).
 */
function orders(n: number): [order: number[], steps: Set<number>][] {
  const ids = [...Array(n).keys()];
  if (n <= 4) return permutations(ids).map((o) => [o, new Set(ids.map((i) => i + 1))]);
  const some = new Set([1, 2, n >> 2, n >> 1, (3 * n) >> 2, n]);
  const end = new Set([n]);
  const evensFirst = [...ids.filter((i) => i % 2 === 0), ...ids.filter((i) => i % 2 === 1)];
  const halves = [...ids.slice(n >> 1), ...ids.slice(0, n >> 1)];
  return [
    [ids, some],
    [[...ids].reverse(), some],
    [evensFirst, end],
    [halves, end],
  ];
}

/**
 * Whether two exports hold different copies of one message (same chat and id, another
 * text): then the copy read last wins, and the order of the exports matters. Real exports
 * of one chat agree; the run over every scenario joins unrelated chats with equal titles.
 */
function conflicting(all: readonly ExportRecord[]): boolean {
  const texts = new Map<string, string>();
  for (const r of all)
    for (const e of r.entries) {
      if (Array.isArray(e)) continue;
      const k = JSON.stringify([e.chat, e.id]);
      if ((texts.get(k) ?? e.text) !== e.text) return true;
      texts.set(k, e.text);
    }
  return false;
}

const multi = (): ExportsRun[] => runs.filter((r) => r.exports.length >= 2);

describe('records of the golden scenarios', () => {
  it('several_scenarios_have_several_exports', () => {
    expect(multi().length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...runs.map((r) => r.exports.length))).toBeGreaterThan(10);
    expect(multi().filter((r) => !conflicting(r.records)).length).toBeGreaterThanOrEqual(4);
  });

  it('added_one_at_a_time_in_any_order_as_a_run_over_them', { timeout: 60_000 }, async () => {
    for (const run of multi()) {
      const all = run.records;
      const whole = wikiAndPlayer(await fromPages(run, run.exports));
      const agree = !conflicting(all);
      for (const [order, steps] of orders(all.length)) {
        const label = `${run.name} [${order.join(',')}]`;
        for (const k of steps) {
          const added = order.slice(0, k);
          expect(
            outputs(
              buildWiki(
                added.map((i) => all[i] as ExportRecord),
                run.options
              )
            ),
            `${label} ${k}`
          ).toBe(
            outputs(
              await fromPages(
                run,
                added.map((i) => run.exports[i] as Page[])
              )
            )
          );
        }
        // Where the exports agree, the order they were added in changes neither the wiki
        // nor the player state.
        const last = buildWiki(
          order.map((i) => all[i] as ExportRecord),
          run.options
        );
        if (agree) expect(wikiAndPlayer(last), label).toBe(whole);
      }
    }
  });

  it('a_record_removed_as_a_run_over_the_others', { timeout: 60_000 }, async () => {
    for (const run of multi()) {
      const all = run.records;
      const n = all.length;
      const removed = n <= 4 ? [...all.keys()] : [0, n >> 1, n - 1];
      for (const i of removed) {
        const rest = all.filter((_r, j) => j !== i);
        const pages = run.exports.filter((_p, j) => j !== i);
        expect(outputs(buildWiki(rest, run.options)), `${run.name} -${i}`).toBe(
          outputs(await fromPages(run, pages))
        );
      }
    }
  });

  it('records_survive_a_json_round_trip', () => {
    for (const run of runs) {
      const all = run.records;
      const copies = JSON.parse(JSON.stringify(all)) as ExportRecord[];
      expect(copies, run.name).toStrictEqual(all);
      expect(outputs(buildWiki(copies, run.options)), run.name).toBe(
        outputs(buildWiki(all, run.options))
      );
    }
  });

  it('dropping_ordinary_chat_changes_no_output', () => {
    let stubs = 0;
    for (const run of runs) {
      stubs += run.records.reduce((n, r) => n + r.counts.messages - r.counts.kept, 0);
      expect(outputs(buildWiki(run.records, run.options)), run.name).toBe(
        outputs(buildWiki(run.full, run.options))
      );
    }
    expect(stubs).toBeGreaterThan(0);
  });
});
