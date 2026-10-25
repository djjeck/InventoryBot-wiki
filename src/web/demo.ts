/**
 * The example the page offers while no export is imported: the chat of demo-chat.ts,
 * written as a Telegram Desktop HTML export (docs/telegram-export.md) and read by the
 * worker like any folder picked, so the page shows what it makes of an export before the
 * player makes one; the page shows the chat too. The export is the same at every call, so
 * adding it again changes nothing, and it is dropped once the player adds an export of
 * their own (run.ts): its chat with the bot must not mix with theirs.
 */
import { type FileLike } from '#src/telegram/export/browser-files.ts';
import { DEMO_CHAT } from './demo-chat.ts';

/** The example's folder: what the list of exports shows, and how the worker knows it. */
export const DEMO_FOLDER = 'Esempio (InventoryBot Wiki)';

/** The example's player, as the bot names them, and their display name. */
export const DEMO_PLAYER = 'esempio';
export const DEMO_DISPLAY_NAME = 'Esempio';
const BOT = 'InventoryBot';

/** The day of the chat, and Italy's offset then. */
const DAY = '01.10.2026';
const OFFSET = 'UTC+02:00';

/** A message of the example: whether the bot sent it, its time (`18:00:02`), its text. */
export interface DemoMessage {
  fromBot: boolean;
  time: string;
  text: string;
}

/** The messages of the chat, in order: each command, then the bot's reply two seconds later. */
export function demoMessages(): DemoMessage[] {
  return DEMO_CHAT.flatMap(([time, command, reply]) => {
    const [h, m, s] = time.split(':').map(Number) as [number, number, number];
    const later = h * 3600 + m * 60 + s + 2;
    const replyTime = [Math.floor(later / 3600), Math.floor(later / 60) % 60, later % 60]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
    return [
      { fromBot: false, time, text: command },
      { fromBot: true, time: replyTime, text: reply },
    ];
  });
}

const escapeHtml = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** The example's one page, `messages.html`, in the markup of a Windows export. */
export function demoPage(): string {
  const messages = demoMessages().map((m, i) => {
    const date = `${DAY} ${m.time} ${OFFSET}`;
    const sender = m.fromBot ? BOT : DEMO_DISPLAY_NAME;
    return [
      `<div class="message default clearfix" id="message${i + 1}">`,
      ` <div class="pull_left userpic_wrap"><div class="userpic" style="width: 42px; height: 42px"><div class="initials" style="line-height: 42px">${sender.charAt(0)}</div></div></div>`,
      ' <div class="body">',
      `  <div class="pull_right date details" title="${date}">${m.time.slice(0, 5)}</div>`,
      `  <div class="from_name">${sender} </div>`,
      `  <div class="text">${escapeHtml(m.text).replaceAll('\n', '<br>')}</div>`,
      ' </div>',
      '</div>',
    ].join('\n');
  });
  return [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8"/><title>Exported Data</title></head><body>',
    '<div class="page_wrap">',
    `<div class="page_header"><div class="content"><div class="text bold">${BOT}</div></div></div>`,
    '<div class="page_body chat_page"><div class="history">',
    ...messages,
    '</div></div></div></body></html>',
  ].join('\n');
}

/** The example as a folder picker gives a folder: its files, under DEMO_FOLDER. */
export function demoFiles(): FileLike[] {
  const bytes = new TextEncoder().encode(demoPage());
  return [
    {
      name: 'messages.html',
      webkitRelativePath: `${DEMO_FOLDER}/messages.html`,
      arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
    },
  ];
}
