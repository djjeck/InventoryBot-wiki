import { describe, expect, it } from 'vitest';
import { type Message, type Page } from '#src/telegram/messages.ts';
import { BOT, BOT_IDENTITY, Chat, macPageHtml, pageHtml } from '#test/helpers.ts';
import {
  exportHash,
  mergeExports,
  parsePages,
  readExport,
  RECORD_FORMAT_VERSION,
  senderKey,
  splitExports,
} from './record.ts';

const SALT = 'test-salt';
const READ = { bot: BOT_IDENTITY, salt: SALT };
const MERGE = { bot: BOT_IDENTITY, timeZone: 'America/New_York' };
const IDS = { Mario: 222000222, Luigi: 333000333, [BOT]: 444000444 };

/** A group with every kind of message a record keeps or stubs. */
function group(): Chat {
  const g = new Chat('Gruppo Avventurieri', 10);
  g.user('Mario', 'ciao a tutti', 0);
  g.user('Mario', '/avventura@InventoryBot', 1);
  g.bot('@mario, ti tuffi nel lago e scorgi un sasso [C]!', 2);
  g.user('Luigi', '/start@AltroBot', 3);
  g.forward('Luigi', 'Mario', '/inventario', 4);
  g.forward('Luigi', BOT, '@mario, possiedi:\n- un sasso [C] x1', 5);
  g.user('Luigi', '/inventario', 6);
  return g;
}

const page = (label: string, html: string): Page => ({ label, html });

describe('readExport', () => {
  it('keeps_what_phase_2_reads_in_full_and_stubs_the_rest', async () => {
    const r = await readExport(
      [page('G/messages.html', pageHtml('Gruppo Avventurieri', group().messages))],
      READ
    );
    const kept = r.entries.filter((e): e is Message => !Array.isArray(e));
    expect(kept.map((m) => m.text)).toStrictEqual([
      '/avventura@InventoryBot',
      '@mario, ti tuffi nel lago e scorgi un sasso [C]!',
      '@mario, possiedi:\n- un sasso [C] x1',
      '/inventario',
    ]);
    expect(r.entries.filter((e) => Array.isArray(e))).toStrictEqual([
      [0, 10, group().messages[0]?.date, 0, null],
      [0, 13, group().messages[3]?.date, 1, null],
      [0, 14, group().messages[4]?.date, 1, null],
    ]);
    expect(JSON.stringify(r)).not.toMatch(/ciao a tutti|AltroBot/u);
    expect(r).toMatchObject({
      formatVersion: RECORD_FORMAT_VERSION,
      folder: 'G',
      pages: 1,
      chats: ['Gruppo Avventurieri'],
      senders: ['Mario', 'Luigi'],
      firstDate: group().messages[0]?.date,
      lastDate: group().messages[6]?.date,
      counts: { messages: 7, fromBot: 2, kept: 4 },
    });
  });

  it('keeps_the_posts_of_the_bot_s_channels_in_full', async () => {
    const c = new Chat('Cronache di Valtorbo', 10);
    c.user('Cronache di Valtorbo', 'RICETTA: Torre', 0);
    const read = { bot: { ...BOT_IDENTITY, channels: ['Cronache di Valtorbo'] }, salt: SALT };
    const pages = [page('C/messages.html', pageHtml('Cronache di Valtorbo', c.messages))];
    const kept = (await readExport(pages, read)).entries.filter((e) => !Array.isArray(e));
    expect(kept.map((m) => (m as Message).text)).toStrictEqual(['RICETTA: Torre']);
    const stubbed = (await readExport(pages, READ)).entries.filter((e) => !Array.isArray(e));
    expect(stubbed).toStrictEqual([]);
  });

  it('keep_all_keeps_ordinary_chat', async () => {
    const r = await readExport([page('G/messages.html', pageHtml('G', group().messages))], {
      ...READ,
      keepAll: true,
    });
    expect(r.entries.every((e) => !Array.isArray(e))).toBe(true);
    expect(r.counts.kept).toBe(7);
  });

  it('salted_sender_keys_and_no_user_id', async () => {
    const g = group();
    const r = await readExport([page('G/messages.html', macPageHtml('G', g.messages, IDS))], READ);
    const keys = r.entries.map((e) => (Array.isArray(e) ? e[4] : (e.sender_key ?? null)));
    const mario = await senderKey(SALT, String(IDS.Mario));
    const luigi = await senderKey(SALT, String(IDS.Luigi));
    expect(keys).toStrictEqual([
      mario,
      mario,
      await senderKey(SALT, String(IDS[BOT])),
      luigi,
      luigi,
      luigi,
      luigi,
    ]);
    const text = JSON.stringify(r);
    for (const id of Object.values(IDS)) expect(text).not.toContain(String(id));
  });

  it('one_hash_for_the_same_pages_from_any_folder', async () => {
    const html = pageHtml('G', group().messages);
    const a = await readExport([page('A/messages.html', html)], READ);
    const b = await readExport([page('elsewhere/B/messages.html', html)], READ);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(b.hash).toBe(a.hash);
    const other = await readExport([page('A/messages.html', html + ' ')], READ);
    expect(other.hash).not.toBe(a.hash);
    const renamed = await readExport([page('A/messages2.html', html)], READ);
    expect(renamed.hash).not.toBe(a.hash);
  });

  it('keeps_a_message_s_file_text_and_hashes_the_files', async () => {
    const dm = new Chat(BOT, 10);
    dm.bot('Inventario di @djjeck, al 2025/11/28 00:00:00', 0, { file: 'files/file.txt' });
    const html = pageHtml(BOT, dm.messages);
    const plain = await readExport([page('E/messages.html', html)], READ);
    const withFile = {
      ...page('E/messages.html', html),
      files: new Map([['files/file.txt', 'x']]),
    };
    const r = await readExport([withFile], READ);
    expect(r.entries.map((e) => (e as Message).file_text)).toStrictEqual(['x']);
    expect(plain.entries.map((e) => (e as Message).file_text)).toStrictEqual([undefined]);
    expect(r.hash).not.toBe(plain.hash);
    expect(await exportHash([withFile])).toBe(r.hash);
    const other = { ...withFile, files: new Map([['files/file.txt', 'y']]) };
    expect((await readExport([other], READ)).hash).not.toBe(r.hash);
  });

  it('export_hash_is_the_record_hash_without_parsing', async () => {
    const pages = [
      page('A/messages.html', pageHtml('G', group().messages)),
      page('A/messages2.html', pageHtml('G', [])),
    ];
    expect(await exportHash(pages)).toBe((await readExport(pages, READ)).hash);
  });

  it('one_export_per_record', async () => {
    const html = pageHtml('G', []);
    await expect(
      readExport([page('A/messages.html', html), page('B/messages.html', html)], READ)
    ).rejects.toThrow(/two exports/u);
    await expect(readExport([], READ)).rejects.toThrow(/without pages/u);
    const empty = await readExport([page('A/messages.html', html)], READ);
    expect(empty).toMatchObject({ chats: [], firstDate: null, lastDate: null, entries: [] });
  });

  it('survives_a_json_round_trip', async () => {
    const g = group();
    const r = await readExport([page('G/messages.html', macPageHtml('G', g.messages, IDS))], READ);
    expect(JSON.parse(JSON.stringify(r))).toStrictEqual(r);
  });
});

describe('splitExports', () => {
  it('consecutive_pages_of_one_folder', () => {
    const p = (label: string): Page => page(label, '');
    const pages = [p('x/A/messages.html'), p('x/A/messages2.html'), p('x/B/messages.html')];
    expect(splitExports(pages).map((e) => e.map((q) => q.label))).toStrictEqual([
      ['x/A/messages.html', 'x/A/messages2.html'],
      ['x/B/messages.html'],
    ]);
    expect(splitExports([])).toStrictEqual([]);
  });
});

describe('mergeExports', () => {
  it('stubs_become_messages_without_text_and_records_stay_unchanged', async () => {
    const g = new Chat('G', 10);
    g.user('Mario', 'ciao', 0);
    g.user('Mario', '/avventura', 1);
    const dm = new Chat(BOT, 900);
    dm.user('Mario', 'ciao bot', 2);
    const mac = await readExport(
      [page('M/messages.html', macPageHtml('G', g.messages, IDS))],
      READ
    );
    const win = await readExport([page('W/messages.html', pageHtml(BOT, dm.messages))], READ);
    const before = JSON.stringify([mac, win]);
    const r = mergeExports([mac, win], MERGE);
    expect(JSON.stringify([mac, win])).toBe(before);
    expect(r.messages.map((m) => [m.chat, m.dm, m.text, m.sender, m.sender_key])).toStrictEqual([
      ['G', false, '', 'Mario', await senderKey(SALT, String(IDS.Mario))],
      ['G', false, '/avventura', 'Mario', await senderKey(SALT, String(IDS.Mario))],
      [BOT, true, '', 'Mario', undefined],
    ]);
    expect(r.messages[0]).toMatchObject({ from_bot: false, forwarded_from: null, reply_to: null });
    expect(r.exports).toBe(2);
    expect(r.warnings).toStrictEqual([
      'M: date senza fuso orario, lette nel fuso orario America/New_York',
    ]);
  });

  it('a_copy_without_its_file_keeps_the_file_text_of_another', async () => {
    const dm = new Chat(BOT, 10);
    dm.bot('Inventario di @djjeck, al 2025/11/28 00:00:00', 0, { file: 'files/file.txt' });
    const html = pageHtml(BOT, dm.messages);
    const files = new Map([['files/file.txt', 'x']]);
    const withFile = await readExport([{ ...page('A/messages.html', html), files }], READ);
    const without = await readExport([page('B/messages.html', html)], READ);
    for (const records of [
      [withFile, without],
      [without, withFile],
    ])
      expect(mergeExports(records, MERGE).messages.map((m) => m.file_text)).toStrictEqual(['x']);
  });

  it('parse_pages_is_read_then_merge', async () => {
    const html = pageHtml('G', group().messages);
    const paths = [[page('A/messages.html', html), page('B/messages.html', html)]];
    const records = [
      await readExport([page('A/messages.html', html)], READ),
      await readExport([page('B/messages.html', html)], READ),
    ];
    expect(await parsePages(paths, { ...READ, ...MERGE })).toStrictEqual(
      mergeExports(records, MERGE)
    );
  });
});
