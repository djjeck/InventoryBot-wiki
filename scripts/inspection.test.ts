/** `npm run inspect` (inspection.ts), on synthetic exports in temporary folders. */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { processExport, runPipeline } from '#src/pipeline.ts';
import { iterPages } from '#src/telegram/export/export-files.ts';
import { RECORD_FORMAT_VERSION } from '#src/telegram/export/record.ts';
import { dmChat, GROUP_EXPORT, writeInbox } from '#test/e2e-fixtures.ts';
import { BOT, writeExport } from '#test/helpers.ts';
import { tempDir } from '#test/temp-dir.ts';
import {
  aggregateReport,
  cachedRecord,
  cacheRecord,
  dayOf,
  exportsOf,
  formatSummary,
  inspect,
  type InspectArgs,
  NO_OWNER,
  outputRefusal,
  parseInspectArgs,
  RECORDS_DIR,
  saltIn,
  shareOf,
  UsageError,
} from './inspection.ts';

const DEFAULTS = { inbox: 'inbox', out: 'out', timeZone: 'Europe/Rome' };

describe('parseInspectArgs', () => {
  it('defaults_without_arguments', () => {
    expect(parseInspectArgs([], DEFAULTS)).toStrictEqual({
      folders: ['inbox'],
      out: 'out',
      player: null,
      timeZone: 'Europe/Rome',
    });
  });

  it('folders_and_options_in_either_form', () => {
    expect(
      parseInspectArgs(
        ['a', '--out', 'o', 'b', '--player=@mario', '--time-zone', 'UTC', '--', '--c'],
        DEFAULTS
      )
    ).toStrictEqual({ folders: ['a', 'b', '--c'], out: 'o', player: 'mario', timeZone: 'UTC' });
  });

  it('wrong_arguments_are_usage_errors', () => {
    expect(() => parseInspectArgs(['--site'], DEFAULTS)).toThrow(UsageError);
    expect(() => parseInspectArgs(['--out'], DEFAULTS)).toThrow(/--out: missing value/u);
    expect(() => parseInspectArgs(['--player='], DEFAULTS)).toThrow(/missing value/u);
    expect(() => parseInspectArgs(['--time-zone', 'Mars/Olympus'], DEFAULTS)).toThrow(
      /not an IANA time zone/u
    );
  });
});

/** A git repository in a temporary folder that ignores `ignored/`. */
function repo(): string {
  const root = tempDir();
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored/\n');
  return root;
}

describe('outputRefusal', () => {
  it('refuses_a_folder_of_the_repository_that_git_does_not_ignore', () => {
    const root = repo();
    expect(outputRefusal(path.join(root, 'kept'), root)).toMatch(/git does not ignore it/u);
    expect(outputRefusal(path.join(root, 'src', 'out'), root)).not.toBeNull();
    expect(outputRefusal(root, root)).not.toBeNull();
  });

  it('allows_ignored_folders_existing_or_not_and_folders_outside', () => {
    const root = repo();
    expect(outputRefusal(path.join(root, 'ignored'), root)).toBeNull();
    expect(outputRefusal(path.join(root, 'ignored', 'deeper'), root)).toBeNull();
    fs.mkdirSync(path.join(root, 'ignored'));
    expect(outputRefusal(path.join(root, 'ignored'), root)).toBeNull();
    expect(outputRefusal(tempDir(), root)).toBeNull();
  });

  it('follows_symlinks_into_the_repository', () => {
    const root = repo();
    const link = path.join(tempDir(), 'link');
    fs.symlinkSync(root, link);
    expect(outputRefusal(path.join(link, 'kept'), root)).not.toBeNull();
    expect(outputRefusal(path.join(link, 'ignored'), root)).toBeNull();
  });
});

describe('the record cache', () => {
  async function record(salt: string) {
    const dir = writeExport(path.join(tempDir(), 'E'), BOT, [dmChat().messages]);
    return processExport(
      iterPages(dir, () => {}),
      { salt }
    );
  }

  it('keyed_by_content_salt_and_format_version', async () => {
    const out = tempDir();
    const salt = saltIn(out, () => 'one');
    const r = await record(salt);
    expect(cachedRecord(out, r.hash, salt)).toBeNull();
    cacheRecord(out, r, salt);
    expect(cachedRecord(out, r.hash, salt)).toStrictEqual(r);
    expect(cachedRecord(out, '0'.repeat(64), salt)).toBeNull();
    // Another salt: refused and dropped.
    expect(cachedRecord(out, r.hash, 'two')).toBeNull();
    expect(cachedRecord(out, r.hash, salt)).toBeNull();
    // Another format version, or an unreadable file: dropped.
    cacheRecord(out, { ...r, formatVersion: (RECORD_FORMAT_VERSION + 1) as 1 }, salt);
    expect(cachedRecord(out, r.hash, salt)).toBeNull();
    fs.writeFileSync(path.join(out, RECORDS_DIR, `${r.hash}.json`), '{');
    expect(cachedRecord(out, r.hash, salt)).toBeNull();
    expect(fs.readdirSync(path.join(out, RECORDS_DIR))).toStrictEqual([]);
  });

  it('the_salt_is_made_once_and_a_new_one_drops_the_records', async () => {
    const out = path.join(tempDir(), 'new');
    const salt = saltIn(out);
    expect(salt).toMatch(/^[0-9a-f]{32}$/u);
    expect(saltIn(out, () => 'other')).toBe(salt);
    cacheRecord(out, await record(salt), salt);
    fs.rmSync(path.join(out, 'salt'));
    expect(saltIn(out, () => 'other')).toBe('other');
    expect(fs.existsSync(path.join(out, RECORDS_DIR))).toBe(false);
  });
});

describe('exportsOf', () => {
  it('splits_consecutive_pages_by_folder', () => {
    const p = (label: string) => ({ label, html: '' });
    const pages = [p('x/A/messages.html'), p('x/A/messages2.html'), p('x/B/messages.html')];
    expect([...exportsOf(pages)].map((e) => e.map((q) => q.label))).toStrictEqual([
      ['x/A/messages.html', 'x/A/messages2.html'],
      ['x/B/messages.html'],
    ]);
    expect([...exportsOf([])]).toStrictEqual([]);
  });
});

describe('the summary', () => {
  it('days_shares_and_aggregate_report', () => {
    expect(dayOf('05.03.2026 19:14:19 UTC-05:00')).toBe('2026-03-05');
    expect(dayOf('27 November 2025, 19:14:19')).toBe('2025-11-27');
    expect(dayOf(null)).toBe('?');
    expect(shareOf(7, 8)).toBe('87.5% (7/8)');
    expect(shareOf(0, 0)).toBe('n/a (0/0)');
    expect(
      aggregateReport([
        'risposte del bot: 3',
        '  Gruppo VolpeVeloce: risposte del bot abbinate a un comando: single=3',
        '-- unresolved_travel: 1',
        '  unresolved_travel: query="/viaggio valle" text="arrivi"',
        'oggetti: 1',
      ])
    ).toStrictEqual([
      'risposte del bot: 3',
      '  Gruppo VolpeVeloce: risposte del bot abbinate a un comando: single=3',
      '-- unresolved_travel: 1',
      'oggetti: 1',
    ]);
  });

  it('formats_every_part', () => {
    expect(
      formatSummary({
        exports: [
          {
            folder: 'inbox/E',
            dm: true,
            firstDate: '05.03.2026 19:14:19 UTC-05:00',
            lastDate: null,
            messages: 4,
            fromBot: 2,
            source: 'cached',
          },
        ],
        timings: [['read exports', 1234]],
        report: ['oggetti: 1'],
        wiki: { recipes: {}, items: { a: {} as never }, locations: {} },
        player: { inventory_check: { compared: 4, agreed: 3 } },
        written: ['out/wiki.json'],
      })
    ).toStrictEqual([
      'exports: 1',
      '  inbox/E: DM, 2026-03-05 to ?, 4 messages, 2 from the bot, cached',
      'timings:',
      '  read exports: 1.23 s',
      'report:',
      '  oggetti: 1',
      'wiki: 0 recipes, 1 items, 0 places',
      'inventory check: 75.0% (3/4) of the estimates agreed with the bot',
      'written:',
      '  out/wiki.json',
    ]);
  });
});

describe('inspect', () => {
  function args(over: Partial<InspectArgs>): InspectArgs {
    return { folders: [], out: tempDir(), player: null, timeZone: 'UTC', ...over };
  }

  async function run(a: InspectArgs, root = repo()) {
    const printed: string[] = [];
    const warned: string[] = [];
    const code = await inspect(
      a,
      root,
      (l) => printed.push(l),
      (l) => warned.push(l)
    );
    return { code, printed, warned };
  }

  it('writes_what_the_web_app_draws_and_reads_each_export_once', async () => {
    const inbox = writeInbox(path.join(tempDir(), 'inbox'));
    const a = args({ folders: [inbox, path.join(inbox, GROUP_EXPORT)] });
    const first = await run(a);
    expect(first.code).toBe(0);
    const text = first.printed.join('\n');
    expect(text).toMatch(/: DM, .*, parsed\n.*: group, .*, parsed\n.*: group, .*, duplicate/u);
    expect(text).toContain('giocatore: @djjeck');
    // No chat titles, display names, other usernames or texts.
    for (const name of ['Gruppo Avventurieri', 'Daniele', 'Mario', 'Luigi', '@luigi', 'sasso'])
      expect(text).not.toContain(name);

    const salt = fs.readFileSync(path.join(a.out, 'salt'), 'utf-8').trim();
    const expected = await runPipeline([iterPages(inbox, () => {})], {
      salt,
      player: null,
      timeZone: 'UTC',
    });
    if (expected.status !== 'done') throw new Error('no owner');
    const read = (f: string) => JSON.parse(fs.readFileSync(path.join(a.out, f), 'utf-8'));
    const { generated } = read('wiki.json');
    expect(generated).toBeTruthy();
    expect(read('wiki.json')).toStrictEqual({ ...expected.wiki, generated });
    expect(read('player.json')).toStrictEqual(JSON.parse(JSON.stringify(expected.player)));
    expect(fs.readdirSync(path.join(a.out, RECORDS_DIR))).toHaveLength(2);

    const second = await run(a);
    expect(second.code).toBe(0);
    expect(second.printed.filter((l) => l.endsWith(', cached'))).toHaveLength(2);
    expect(second.printed.filter((l) => l.endsWith(', parsed'))).toHaveLength(0);
  });

  it('stops_without_an_owner_or_an_export', async () => {
    const group = writeInbox(path.join(tempDir(), 'inbox'));
    const noOwner = await run(args({ folders: [path.join(group, GROUP_EXPORT)] }));
    expect(noOwner).toMatchObject({ code: 1, printed: [], warned: [NO_OWNER] });
    const named = await run(args({ folders: [path.join(group, GROUP_EXPORT)], player: 'djjeck' }));
    expect(named.code).toBe(0);
    const empty = await run(args({ folders: [tempDir()] }));
    expect(empty.code).toBe(1);
    expect(empty.warned.join('\n')).toMatch(/no Telegram HTML export/u);
  });

  it('refuses_an_output_folder_git_does_not_ignore', async () => {
    const root = repo();
    const refused = await run(args({ folders: [tempDir()], out: path.join(root, 'kept') }), root);
    expect(refused.code).toBe(2);
    expect(fs.existsSync(path.join(root, 'kept'))).toBe(false);
  });
});
