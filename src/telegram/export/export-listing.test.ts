import { describe, expect, it } from 'vitest';
import { decodeText, type ExportEntry, listExport } from './export-listing.ts';

const file = (path: string): ExportEntry => ({ path, isFile: () => true });
const folder = (path: string): ExportEntry => ({ path, isFile: () => false });

describe('listExport', () => {
  it('pages_in_folder_then_page_number_order_whatever_the_entry_order', () => {
    const entries = [
      'in/b/messages.html',
      'in/a/messages10.html',
      'in/a/messages2.html',
      'in/a/sub/messages.html',
      'in/a/messages.html',
      'in/a-c/messages.html',
      'in/a/messages1.html', // not a page name
      'in/a/messages01.html', // not a page name
      'in/a/photos/photo_1.jpg',
    ].map(file);
    const expected = [
      'in/a/messages.html',
      'in/a/messages2.html',
      'in/a/messages10.html',
      'in/a/sub/messages.html',
      'in/a-c/messages.html',
      'in/b/messages.html',
    ];
    expect(listExport(entries).pages).toStrictEqual(expected);
    expect(listExport([...entries].reverse()).pages).toStrictEqual(expected);
  });

  it('json_export_without_pages_and_zip_files_are_warned_in_order', () => {
    const { pages, warnings } = listExport([
      file('in/z.zip'),
      folder('in/dir.zip'),
      file('in/json/result.json'),
      file('in/both/result.json'),
      file('in/both/messages.html'),
      file('in/a/result.json'),
    ]);
    expect(pages).toStrictEqual(['in/both/messages.html']);
    expect(warnings).toStrictEqual([
      'salto in/a: esportazione in formato JSON, è supportato solo il formato HTML (Telegram Desktop -> Esporta cronologia chat -> Formato: HTML)',
      'salto in/json: esportazione in formato JSON, è supportato solo il formato HTML (Telegram Desktop -> Esporta cronologia chat -> Formato: HTML)',
      "salto in/z.zip: i file zip non vengono letti, estrai l'esportazione in una cartella",
    ]);
  });
});

describe('decodeText', () => {
  it('keeps_the_bom_and_turns_line_ends_into_lf', () => {
    const bytes = new TextEncoder().encode('﻿a\r\nb\rc\n');
    expect(decodeText(bytes)).toBe('﻿a\nb\nc\n');
  });

  it('rejects_invalid_utf8', () => {
    expect(() => decodeText(new Uint8Array([0xc3]))).toThrow();
  });
});
