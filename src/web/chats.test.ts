/** Which exports are of the same chat (chats.ts). Synthetic data only. */
import { describe, expect, it } from 'vitest';
import { type ExportRecord, RECORD_FORMAT_VERSION } from '#src/telegram/export/record.ts';
import { chatKeys, overlap, SAMPLE } from './chats.ts';

/** A Windows date title `minute` minutes and `second` seconds after 10:00 on 3 Oct 2026. */
const date = (minute: number, second: number): string =>
  `03.10.2026 ${String(10 + Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:${String(second).padStart(2, '0')} UTC+02:00`;

/** A record of `title` holding the messages `[id, minute, second]`, as stubs. */
function record(
  hash: string,
  title: string,
  messages: readonly [number, number, number][],
  mac = false
): ExportRecord {
  return {
    formatVersion: RECORD_FORMAT_VERSION,
    folder: hash,
    hash,
    pages: 1,
    chats: [title],
    senders: [],
    firstDate: null,
    lastDate: null,
    counts: { messages: messages.length, fromBot: 0, kept: 0 },
    entries: messages.map(([id, minute, second]) => [
      0,
      id,
      mac
        ? `3 October 2026, ${String(9 + Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:${String(second).padStart(2, '0')}`
        : date(minute, second),
      null,
      null,
    ]),
  };
}

/** Messages with ids `from` to `to`, one a minute, at second id % 60. */
const run = (from: number, to: number): [number, number, number][] =>
  Array.from({ length: to - from + 1 }, (_, i) => [from + i, from + i - 1000, (from + i) % 60]);

const source = (r: ExportRecord, loaded = true) => ({
  hash: r.hash,
  chats: r.chats,
  record: loaded ? r : undefined,
});

describe('overlap', () => {
  it('a_later_export_that_starts_inside_an_earlier_one_overlaps', () => {
    expect(overlap(record('a', 'A', run(1000, 1020)), record('b', 'B', run(1010, 1030)))).toBe(
      true
    );
    expect(overlap(record('b', 'B', run(1010, 1030)), record('a', 'A', run(1000, 1020)))).toBe(
      true
    );
  });

  it('exports_that_do_not_share_messages_do_not', () => {
    expect(overlap(record('a', 'A', run(1000, 1010)), record('b', 'B', run(1011, 1020)))).toBe(
      false
    );
  });

  it('the_same_ids_at_other_seconds_are_another_chat', () => {
    const other = run(1000, 1020).map(([id, m, s]): [number, number, number] => [
      id,
      m,
      (s + 1) % 60,
    ]);
    expect(overlap(record('a', 'A', run(1000, 1020)), record('b', 'B', other))).toBe(false);
  });

  it('every_one_of_the_first_messages_must_match', () => {
    const b = run(1010, 1030);
    b[SAMPLE - 1] = [b[SAMPLE - 1]![0], b[SAMPLE - 1]![1], 59];
    expect(overlap(record('a', 'A', run(1000, 1020)), record('b', 'B', b))).toBe(false);
  });

  it('a_macos_export_in_another_time_zone_still_matches', () => {
    expect(
      overlap(record('a', 'A', run(1000, 1020)), record('b', 'B', run(1010, 1030), true))
    ).toBe(true);
  });

  it('an_export_without_dates_overlaps_nothing', () => {
    const empty: ExportRecord = { ...record('b', 'B', []), entries: [[0, 1000, null, null, null]] };
    expect(overlap(record('a', 'A', run(1000, 1020)), empty)).toBe(false);
  });
});

describe('chat keys', () => {
  it('exports_of_the_same_title_are_one_chat', () => {
    const keys = chatKeys([
      { hash: 'b', chats: ['InventoryBot'] },
      { hash: 'a', chats: [null, 'InventoryBot'] },
      { hash: 'c', chats: ['Gruppo Avventurieri'] },
      { hash: 'd', chats: [null] },
    ]);
    expect([...keys]).toStrictEqual([
      ['b', 'a'],
      ['a', 'a'],
      ['c', 'c'],
      ['d', 'd'],
    ]);
  });

  it('a_renamed_chat_is_one_along_a_chain_of_overlaps', () => {
    const old = record('c', 'Gruppo Avventurieri', run(1000, 1020));
    const renamed = record('b', 'Gruppo Esploratori', run(1015, 1040));
    const again = record('a', 'Gruppo Esploratori', run(1100, 1120));
    const other = record(
      'd',
      'Gruppo Cucina',
      run(1000, 1020).map(([i, m]) => [i, m, 7])
    );
    const keys = chatKeys([old, renamed, again, other].map((r) => source(r)));
    expect([...keys]).toStrictEqual([
      ['c', 'a'],
      ['b', 'a'],
      ['a', 'a'],
      ['d', 'd'],
    ]);
  });

  it('exports_not_loaded_join_by_title_alone', () => {
    const old = record('a', 'Gruppo Avventurieri', run(1000, 1020));
    const renamed = record('b', 'Gruppo Esploratori', run(1015, 1040));
    expect([...chatKeys([source(old), source(renamed, false)]).values()]).toStrictEqual(['a', 'b']);
  });
});
