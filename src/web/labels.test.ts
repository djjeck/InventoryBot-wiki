/** What the page writes about the exports (labels.ts). Synthetic data only. */
import { describe, expect, it } from 'vitest';
import {
  accountLabel,
  activityText,
  chatName,
  entryLabel,
  exportDay,
  exportDays,
} from './labels.ts';
import { type ExportEntry } from './protocol.ts';
import { type RecordInfo } from './storage.ts';

const info = (over: Partial<RecordInfo> = {}): RecordInfo => ({
  hash: 'h',
  seq: 0,
  formatVersion: 1,
  folder: 'ChatExport_2026-10-17',
  addedAt: '2026-10-17T10:00:00.000Z',
  pages: 2,
  chats: ['InventoryBot'],
  firstDate: '03.10.2026 09:15:00 UTC+02:00',
  lastDate: '17.10.2026 23:59:00 UTC+02:00',
  counts: { messages: 20, fromBot: 10, kept: 20 },
  ...over,
});

describe('dates', () => {
  it('a_windows_date_gives_the_day_as_written', () => {
    expect(exportDay('03.10.2026 23:30:00 UTC-05:00')).toBe('3 ott 2026');
  });

  it('a_macos_date_gives_its_day', () => {
    expect(exportDay('27 November 2025, 19:14:19')).toBe('27 nov 2025');
  });

  it('anything_else_is_no_day', () => {
    expect(exportDay(null)).toBeNull();
    expect(exportDay('ieri')).toBeNull();
  });

  it('first_and_last_day_make_a_range_or_one_day', () => {
    expect(exportDays(info())).toBe('dal 3 ott 2026 al 17 ott 2026');
    expect(exportDays(info({ lastDate: '03.10.2026 18:00:00 UTC+02:00' }))).toBe('3 ott 2026');
    expect(exportDays(info({ firstDate: null }))).toBe('17 ott 2026');
    expect(exportDays(info({ firstDate: null, lastDate: null }))).toBe('senza date');
  });
});

describe('chat names', () => {
  it('the_private_chat_is_the_bot', () => {
    expect(chatName(info(), 'cartella')).toBe('@InventoryBot');
  });

  it('a_group_is_its_title', () => {
    expect(chatName(info({ chats: ['Gruppo Avventurieri', null] }), 'cartella')).toBe(
      'Gruppo Avventurieri'
    );
  });

  it('no_title_gives_the_folder', () => {
    expect(chatName(info({ chats: [null, ''] }), 'cartella')).toBe('cartella');
  });
});

describe('entries', () => {
  const entry = (over: Partial<ExportEntry>): ExportEntry => ({
    id: 'job-0',
    status: 'ready',
    folder: 'inbox/ChatExport_2026-10-17',
    ...over,
  });

  it('a_ready_export_shows_its_chat_and_days', () => {
    expect(entryLabel(entry({ id: 'h', info: info() }))).toStrictEqual({
      name: '@InventoryBot',
      days: 'dal 3 ott 2026 al 17 ott 2026',
      status: 'pronta',
      detail: null,
    });
  });

  it('a_stale_export_asks_for_its_folder_again', () => {
    const l = entryLabel(
      entry({ status: 'stale', info: info({ chats: ['Gruppo Avventurieri'] }) })
    );
    expect(l.name).toBe('Gruppo Avventurieri');
    expect(l.status).toBe('da ricaricare');
    expect(l.detail).toBe(
      'Letta da una versione precedente della pagina: aggiungi di nuovo la cartella inbox/ChatExport_2026-10-17 perché conti.'
    );
  });

  it('exports_without_a_record_show_their_folder', () => {
    expect(entryLabel(entry({ status: 'queued' }))).toStrictEqual({
      name: 'inbox/ChatExport_2026-10-17',
      days: null,
      status: 'in coda',
      detail: null,
    });
    expect(entryLabel(entry({ status: 'reading', done: 1, total: 3 })).status).toBe(
      'in lettura: 1 di 3 pagine'
    );
    expect(entryLabel(entry({ status: 'reading' })).status).toBe('in lettura: 0 di 0 pagine');
    expect(entryLabel(entry({ status: 'error', message: 'Non va.' }))).toMatchObject({
      status: 'errore',
      detail: 'Non va.',
    });
    expect(entryLabel(entry({ status: 'error' })).detail).toBe('Non è stato possibile leggerla.');
  });
});

describe('activity', () => {
  const reading: ExportEntry = { id: 'a', status: 'reading', folder: 'A', done: 2, total: 5 };
  const queued = (id: string): ExportEntry => ({ id, status: 'queued', folder: id });

  it('reading_comes_first_with_the_queue', () => {
    expect(activityText([reading], 'build')).toBe('Lettura di A: 2 di 5 pagine');
    expect(activityText([reading, queued('B')], null)).toBe(
      'Lettura di A: 2 di 5 pagine (un’altra in coda)'
    );
    expect(activityText([reading, queued('B'), queued('C')], null)).toBe(
      'Lettura di A: 2 di 5 pagine (altre 2 in coda)'
    );
    expect(activityText([{ id: 'a', status: 'reading', folder: 'A' }], null)).toBe(
      'Lettura di A: 0 di 0 pagine'
    );
  });

  it('then_the_build_phase_then_the_queue', () => {
    expect(activityText([], 'conversation')).toBe('Abbinamento delle risposte ai comandi…');
    expect(activityText([queued('B')], null)).toBe('Un’esportazione in coda');
    expect(activityText([queued('B'), queued('C')], null)).toBe('2 esportazioni in coda');
  });

  it('nothing_going_on_is_null', () => {
    expect(activityText([{ id: 'h', status: 'ready', folder: 'A' }], null)).toBeNull();
  });
});

describe('account', () => {
  const player = { player: 'mario', as_of: '2025-11-27T22:18:21-05:00' };

  it('the_owner_is_named_with_the_day_of_their_latest_observation', () => {
    const l = accountLabel({ ...player, inventory_check: { compared: 0, agreed: 0 } });
    expect(l).toEqual({ name: '@mario', asOf: '27 nov 2025', agreement: null });
  });

  it('the_agreement_is_rounded_down_so_only_always_is_100', () => {
    const check = (agreed: number, compared: number): string | null =>
      accountLabel({ ...player, inventory_check: { compared, agreed } }).agreement;
    expect(check(197, 200)).toBe('98,5%');
    expect(check(1999, 2000)).toBe('99,9%');
    expect(check(5, 5)).toBe('100%');
  });

  it('without_observations_there_is_no_day', () => {
    const l = accountLabel({
      player: 'mario',
      as_of: null,
      inventory_check: { compared: 0, agreed: 0 },
    });
    expect(l.asOf).toBeNull();
  });
});
