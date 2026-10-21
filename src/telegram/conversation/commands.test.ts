import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOT, Chat, runParse, writeExport } from '#test/helpers.ts';
import { tempDir } from '#test/temp-dir.ts';
import { firstWord, isBotCommand, resolveCommand } from './commands.ts';

type Cmd = { text: string; other_bot?: boolean };

describe('resolveCommand', () => {
  it('command_for_the_bot_stripped', () => {
    const m = resolveCommand<Cmd>({ text: '/ricetta@InventoryBot Pratica cestina' }, BOT);
    expect(m.text).toBe('/ricetta Pratica cestina');
    expect(m.other_bot).toBe(false);
  });

  it('bot_name_case_insensitive', () => {
    const m = resolveCommand<Cmd>({ text: '/avventura@inventorybot' }, BOT);
    expect([m.text, m.other_bot]).toStrictEqual(['/avventura', false]);
  });

  it('other_bot_flagged', () => {
    const m = resolveCommand<Cmd>({ text: '/start@AltroBot' }, BOT);
    expect([m.text, m.other_bot]).toStrictEqual(['/start', true]);
  });

  it('plain_command_untouched', () => {
    const m = { text: '/avventura' };
    expect(resolveCommand<Cmd>(m, BOT)).toBe(m);
  });

  it('commands_as_phase_1_reads_them_from_html', async () => {
    const dir = tempDir();
    const c = new Chat('G');
    c.user('Mario', 'x', 0).text = '/inventario@InventoryBot oro'; // raw, as in the HTML
    c.user('Mario', 'x', 1).text = '/start@AltroBot';
    writeExport(path.join(dir, 'E'), 'G', [c.messages]);
    const { msgs } = await runParse([dir]);
    expect(msgs.map((m) => resolveCommand(m, BOT)).map((m) => [m.text, m.other_bot])).toStrictEqual(
      [
        ['/inventario oro', false],
        ['/start', true],
      ]
    );
  });
});

describe('command words', () => {
  it('isBotCommand_and_firstWord', () => {
    expect(isBotCommand({ text: '/avventura' })).toBe(true);
    expect(isBotCommand({ text: '/start', other_bot: true })).toBe(false);
    expect(isBotCommand({ text: 'ciao /avventura' })).toBe(false);
    expect(firstWord('/Avventura  subito')).toBe('/avventura');
  });
});
