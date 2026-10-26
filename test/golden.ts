/**
 * Golden outputs: the whole pipeline run on the synthetic scenarios of
 * test/synthetic-exports.ts, compared byte for byte with the files in test/golden/.
 *
 * `npm run golden:update` (scripts/golden-update.ts) rewrites them from the pipeline
 * after an intentional change; a golden diff is reviewed like code.
 *
 * Each run is one folder under test/golden/ holding what it produced: the conversation
 * after phase 3 and the events after phase 4 (JSON Lines, one reply or event per line),
 * the wiki and the player state (JSON), the report lines, and the outcome (`done`, or why
 * the run stopped); a file the run did not produce is absent. A diff therefore shows which
 * phase changed. The wiki's `generated` timestamp is normalised. No vitest imports here:
 * the update script reuses it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type EventRecord } from '#src/inventorybot/types.ts';
import {
  buildFromEvents,
  conversationReport,
  converse,
  type Finished,
  finishPipeline,
  type PipelineOptions,
  runPipeline,
} from '#src/pipeline.ts';
import { type BotReply } from '#src/telegram/conversation/conversation.ts';
import { ownerFromDm } from '#src/telegram/conversation/owner.ts';
import { type Message } from '#src/telegram/messages.ts';
import { readPicks } from '#src/web/run.ts';
import { pickFolder } from './browser-picks.ts';
import {
  type Scenario,
  writeStage2Scenarios,
  writeStage3Scenarios,
  writeSyntheticExports,
} from './synthetic-exports.ts';

/** test/golden/. */
export const GOLDEN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden');

export const GENERATED = '<generated>';

/**
 * `exports`: export folders, read as the page's worker reads its picks (readPicks), then
 * the whole pipeline (runPipeline).
 * `messages`: a file of messages (JSON Lines), from phase 2. `events`: a file of events
 * (JSON Lines), through phase 5.
 */
export type RunKind = 'exports' | 'messages' | 'events';

export interface GoldenRun {
  name: string;
  kind: RunKind;
  paths: string[];
  player?: string;
}

/**
 * The time zone and the pseudonyms' salt of every run: fixed, so that the goldens depend
 * neither on the computer nor on a random salt.
 */
export const GOLDEN_OPTIONS: Omit<PipelineOptions, 'player'> = {
  timeZone: 'Europe/Rome',
  salt: 'golden',
};

export interface RunResult {
  /** Golden file name -> content (normalised). */
  files: Map<string, string>;
}

/**
 * Scenarios without a DM with the bot stop when the owner is decided, so they are also
 * run with the username set to the scenario's owner (the DM's sender when the scenario
 * has a DM, otherwise its main group player), to pin their wiki and player outputs.
 */
const SCENARIO_OWNERS: Readonly<Record<string, string>> = {
  'joined-across-pages-and-exports': 'mario',
  'overlap-and-chats': 'djjeck',
  discovery: 'mario',
  'order-and-offsets': 'djjeck',
  'known-defects': 'luigi',
  'stage2-titles': 'aldo',
  'stage2-old-formats': 'mario',
  'macos-and-windows': 'mario',
};

/** Writes every scenario's inputs under `tmp/in` and returns the runs, in a fixed order. */
export function goldenRuns(tmp: string): GoldenRun[] {
  const root = path.join(tmp, 'in');
  const scenarios: Scenario[] = [
    ...writeSyntheticExports(path.join(root, 'stage1')),
    ...writeStage2Scenarios(path.join(root, 'stage2')),
    ...writeStage3Scenarios(path.join(root, 'stage3')),
  ];
  const runs: GoldenRun[] = [];
  const exports: string[] = [];
  for (const s of scenarios) {
    const file =
      s.paths.length === 1 && (s.paths[0] as string).endsWith('.jsonl')
        ? (s.paths[0] as string)
        : null;
    const kind: RunKind =
      file === null ? 'exports' : path.basename(file) === 'events.jsonl' ? 'events' : 'messages';
    runs.push({ name: s.name, kind, paths: s.paths });
    const owner = SCENARIO_OWNERS[s.name];
    if (owner !== undefined)
      runs.push({ name: `${s.name}-player-${owner}`, kind, paths: s.paths, player: owner });
    if (file === null) exports.push(...s.paths);
  }
  // Every export together, without and with a username (most scenarios have no DM).
  runs.push({ name: 'all', kind: 'exports', paths: exports });
  runs.push({ name: 'all-player-mario', kind: 'exports', paths: exports, player: 'mario' });
  return runs;
}

/** JSON Lines read back: one value per line. */
function readJsonLines<T>(file: string): T[] {
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as T);
}

const jsonLines = (values: readonly unknown[]): string =>
  values.map((v) => JSON.stringify(v) + '\n').join('');

const json = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';

const lines = (report: readonly string[]): string => report.map((l) => l + '\n').join('');

/** The conversation as JSON Lines: one reply per line, its context, its text, then its file's. */
const conversationLines = (replies: readonly BotReply[]): string =>
  jsonLines(replies.map(({ text, file_text, context }) => ({ ...context, text, file_text })));

/** Normalises the wiki: the `generated` value is the run's time. */
export function normaliseOutput(text: string): string {
  return text.replace(/^ {2}"generated": "[^"\n]*",$/m, `  "generated": "${GENERATED}",`);
}

/** The files of a run that ran to the end, and its outcome. */
function doneFiles(
  replies: readonly BotReply[] | null,
  finished: Finished,
  report: readonly string[]
): RunResult {
  const files = new Map<string, string>();
  if (replies !== null) {
    files.set('conversation.jsonl', conversationLines(replies));
    files.set('events.jsonl', jsonLines(finished.events));
  }
  files.set('wiki.json', normaliseOutput(json(finished.wiki)));
  files.set('player.json', json(finished.player));
  files.set('report', lines(report));
  files.set('outcome', 'done\n');
  return { files };
}

/** The files of a run that stopped: its report so far, and why. */
const stoppedFiles = (report: readonly string[], reason: string): RunResult => ({
  files: new Map([
    ['report', lines(report)],
    ['outcome', `stopped: ${reason}\n`],
  ]),
});

/** The pipeline on export folders, as the page runs it: each folder one pick. */
async function runExports(run: GoldenRun): Promise<RunResult> {
  const read = await readPicks(run.paths.map(pickFolder));
  if (read.total === 0) return stoppedFiles(read.warnings, 'no-pages');
  const outcome = await runPipeline(read.paths, { ...GOLDEN_OPTIONS, player: run.player ?? null });
  const report = [...read.warnings, ...outcome.report];
  if (outcome.status === 'no-owner') return stoppedFiles(report, 'no-owner');
  return doneFiles(outcome.conversed.conversation.replies, outcome, report);
}

/** Phases 2 to 5 on a file of messages. */
function runMessages(run: GoldenRun): RunResult {
  const messages = readJsonLines<Message>(run.paths[0] as string);
  const c = converse(messages, { player: run.player ?? null, salt: GOLDEN_OPTIONS.salt });
  if (c.ownerMissing) return stoppedFiles([], 'no-owner');
  const finished = finishPipeline(c);
  return doneFiles(c.conversation.replies, finished, [
    ...conversationReport(c),
    ...finished.report,
  ]);
}

/** Phase 5 on a file of events; the owner is the username given, else the DM's. */
function runEvents(run: GoldenRun): RunResult {
  const events = readJsonLines<EventRecord>(run.paths[0] as string);
  const built = buildFromEvents(events, run.player ?? ownerFromDm(events));
  return doneFiles(null, { events, ...built }, built.report);
}

/** Runs the pipeline for one golden run. */
export async function runGoldenRun(run: GoldenRun): Promise<RunResult> {
  if (run.kind === 'exports') return runExports(run);
  return run.kind === 'messages' ? runMessages(run) : runEvents(run);
}

/** Golden file names of a run, as stored (sorted). */
export function readGolden(name: string): Map<string, string> {
  const dir = path.join(GOLDEN_DIR, name);
  const files = new Map<string, string>();
  if (!fs.existsSync(dir)) return files;
  for (const f of fs.readdirSync(dir).sort())
    files.set(f, fs.readFileSync(path.join(dir, f), 'utf-8'));
  return files;
}

/** Replaces the golden folder of one run with `result`. */
export function writeGolden(name: string, result: RunResult): void {
  const dir = path.join(GOLDEN_DIR, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, text] of result.files) fs.writeFileSync(path.join(dir, f), text, 'utf-8');
}
