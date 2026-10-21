/**
 * Synthetic Telegram exports for the golden tests (test/golden.ts): the folder
 * scenarios of src/telegram/export/parse-export.test.ts, plus inputs that exercise
 * once-defective edge cases and the details that keep the output deterministic (key
 * insertion order, code-point sorting and slicing, the report notation).
 * Invented names only. Any change here changes the golden outputs: regenerate them
 * with `npm run golden:update` and review the diff.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ATLANTE, CITTADELLA, GRIMORIO } from '#src/inventorybot/bot.ts';
import { type Message } from '#src/telegram/messages.ts';
import { BAULE_CARD, CRIPTE_CARD, EVENT_CARD, TORRE_CARD } from './channels.ts';
import { examples, readDoc } from './doc-examples.ts';
import { writeInbox } from './e2e-fixtures.ts';
import {
  BOT,
  Chat,
  type Instant,
  pageHtml,
  tgDate,
  writeExport,
  writeMacExport,
} from './helpers.ts';
import * as T from './texts.ts';

export interface Scenario {
  name: string;
  /** Export folders (absolute), or one file of messages (`messages.jsonl`) or of events (`events.jsonl`). */
  paths: string[];
}

const div = (cls: string, inner: string, attrs = ''): string =>
  `<div class="${cls}"${attrs}>${inner}</div>`;

/** A page from hand-written message blocks, for markup the builder cannot produce. */
function rawPage(title: string, blocks: string[]): string {
  return pageHtml(title, []).replace(
    '<div class="history">',
    '<div class="history">\n' + blocks.join('\n')
  );
}

function msg(id: number | string, body: string, joined = false): string {
  return `<div class="message default clearfix${joined ? ' joined' : ''}" id="message${id}">${div('body', body)}</div>`;
}

const date = (t: string): string => `<div class="pull_right date details" title="${t}">00:00</div>`;
const from = (n: string): string => div('from_name', n);
const text = (t: string): string => div('text', t);

export function writeSyntheticExports(root: string): Scenario[] {
  const out: Scenario[] = [];
  const scenario = (name: string, build: (dir: string) => string[] | void): void => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    out.push({ name, paths: build(dir) ?? [dir] });
  };

  scenario('joined-across-pages-and-exports', (dir) => {
    const c = new Chat('G');
    c.user('Mario', 'fine pagina uno', 0);
    c.user('Mario', 'inizio pagina due', 1);
    writeExport(
      path.join(dir, 'ChatExport'),
      'G',
      [c.messages.slice(0, 1), c.messages.slice(1)],
      new Set([2])
    );
    const b = new Chat('G', 5000);
    b.user('Luigi', 'export due', 10);
    writeExport(path.join(dir, 'Other'), 'G', [b.messages], new Set([1]));
    const p = new Chat('G', 7000);
    for (let i = 0; i < 10; i++) p.user(i < 9 ? 'Mario' : 'Luigi', `m${i}`, 100 + i);
    p.user('Luigi', 'joined on page 11', 111);
    writeExport(
      path.join(dir, 'Eleven'),
      'G',
      p.messages.map((m) => [m]),
      new Set([11])
    );
  });

  scenario('overlap-and-chats', (dir) => {
    const c = new Chat(BOT);
    for (let i = 0; i < 6; i++) c.user('Daniele', `/esamina oggetto ${i}`, i * 10);
    writeExport(path.join(dir, 'ChatExport_2026-10-17'), BOT, [c.messages.slice(0, 4)]);
    writeExport(path.join(dir, 'ChatExport_2026-11-02'), BOT, [c.messages.slice(2)]);
    const g = new Chat('Gruppo Avventurieri', 10);
    g.user('Mario', '/avventura', 5);
    g.bot('@mario, ti tuffi nel lago e scorgi un sasso [C]!', 6, { reply_to: 10 });
    g.forward('Luigi', BOT, '@luigi, possiedi:\n- un sasso [C] x2', 7);
    g.forward('Luigi', 'Original Author', 'ciao', 8);
    g.user('Mario', 'x', 9).text = '/inventario@InventoryBot oro';
    g.user('Mario', 'x', 10).text = '/start@AltroBot';
    g.bot('line one\nline two & more <b> "q" l\'oro', 11);
    writeExport(path.join(dir, 'InventoryBot'), 'Gruppo Avventurieri', [g.messages]);
  });

  scenario('discovery', (dir) => {
    const c = new Chat('G');
    c.user('Mario', 'ciao', 0);
    c.user('Luigi', '/avventura', 1);
    const folder = writeExport(path.join(dir, 'a', 'b', 'c', 'ChatExport'), 'G', [c.messages]);
    const other = new Chat('G', 9000);
    other.user('X', 'intruso', 5);
    fs.writeFileSync(
      path.join(folder, 'messages_old.html'),
      pageHtml('G', other.messages),
      'utf-8'
    );
    fs.writeFileSync(path.join(folder, 'result.json'), '{}');
    fs.mkdirSync(path.join(dir, 'json', 'ChatExport'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'json', 'ChatExport', 'result.json'), '{}');
    fs.mkdirSync(path.join(dir, 'json2'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'json2', 'result.json'), '{}');
    // A stray file in the picked folder: not a page, so not read.
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  });

  scenario('order-and-offsets', (dir) => {
    const dm = new Chat(BOT, 900000);
    const g = new Chat('G', 10);
    const rome: Instant = { epoch: dm.base.epoch, offsetMinutes: 60 };
    const g2 = new Chat('\u{1F600} Gruppo', 10, rome); // astral title: code-point order of chats
    const g3 = new Chat('￿ Gruppo', 10, rome);
    dm.user('Daniele', 'dm a', 0);
    g.user('Mario', 'g b', 5);
    g2.user('Mario', 'same instant, other offset', 5);
    g3.user('Mario', 'same instant, other offset', 5);
    dm.user('Daniele', 'dm c', 10);
    g.user('Mario', 'g d', 15);
    writeExport(path.join(dir, 'A'), BOT, [dm.messages]);
    writeExport(path.join(dir, 'B'), 'G', [g.messages]);
    writeExport(path.join(dir, 'C'), g2.title, [g2.messages]);
    writeExport(path.join(dir, 'D'), g3.title, [g3.messages]);
  });

  scenario('known-defects', (dir) => {
    const t = (s: number): string => tgDate(s);
    const fwd = (author: string | null, body: string): string =>
      '<div class="pull_left forwarded userpic_wrap"></div>' +
      div(
        'forwarded body',
        (author === null
          ? ''
          : from(`${author}<span class="date details" title="${t(0)}"> x</span>`)) + text(body)
      );
    const blocks = [
      msg(
        -999700001,
        date(t(0)) + from('Mario Rossi via @gif') + text('negative id, via @bot in the name')
      ),
      msg(
        -999700000,
        date(t(1)) +
          from('InventoryBot ') +
          div(
            'reply_to details',
            'In reply to <a href="#go_to_message-999700001">this message</a>'
          ) +
          text('reply to a negative id')
      ),
      msg(5, date(t(2)) + from('Luigi') + fwd(BOT, '@luigi, possiedi:<br>- un sasso [C] x2')),
      msg(6, date(t(3)) + fwd(null, '@luigi, possiedi:<br>- una mela [C] x1'), true), // joined forward, author implied
      msg(7, date('garbage') + from('Anna') + text('unparsable date')),
      msg(8, from('Anna') + text('no date')),
      msg(9, date(t(4)) + from('Anna') + text('  spazi e\u0085 ')),
      msg(
        10,
        date(t(5)) +
          `<div class="from_name" class="ignored">Bea</div>` +
          text('a &amp; b &lt;c&gt; &apos;d&apos; &#233; &egrave;')
      ),
      msg(
        11,
        `<div class="pull_right date details" title>00:00</div>` +
          from('Anna') +
          text('valueless title')
      ),
      msg(12, date(t(6)) + from('Anna') + text('<!-- c -->a < b<br/>c<br>d')),
      msg(13, date(t(7)) + from('Anna') + text('/ricetta@InventoryBot Pratica cestina')),
      msg(14, date(t(8)) + from('Anna') + text('/città@ÀltroBot x')),
    ];
    const folder = path.join(dir, 'E');
    fs.mkdirSync(folder, { recursive: true });
    // BOM and CRLF line endings: pages are read with any line ending turned into "\n".
    fs.writeFileSync(
      path.join(folder, 'messages.html'),
      '﻿' + rawPage('Gruppo \u{1F332}', blocks).replaceAll('\n', '\r\n'),
      'utf-8'
    );
    const zero = path.join(dir, 'Zero');
    fs.mkdirSync(zero);
    fs.writeFileSync(
      path.join(zero, 'messages.html'),
      rawPage('Senza ora', [
        msg(1, date('31.12.1969 19:00:00 UTC-05:00') + from('Anna') + text('epoch')),
      ])
    );
    fs.writeFileSync(
      path.join(zero, 'messages01.html'),
      rawPage('Senza ora', [msg(2, from('Anna') + text('page 01 ties with page 1'))])
    );
  });

  // macOS exports alone: no offset to infer, so the dates are read in the run's time zone
  // (GOLDEN_OPTIONS, test/golden.ts). Invented user ids.
  scenario('macos-export', (dir) => {
    const ids = { Daniele: 101000101, [BOT]: 202000202, Carla: 303000303 };
    const dm = new Chat(BOT, 61000);
    dm.user('Daniele', '/inventario', 0);
    dm.bot("@djjeck, possiedi:\n- un sasso [C] x2\n- l'oro [X] x1", 1);
    dm.user('Daniele', '/avventura', 60);
    dm.bot('@djjeck, nel bosco trovi un sasso [C]!', 61);
    writeMacExport(
      path.join(dir, 'ChatExport_InventoryBot'),
      BOT,
      [['day', '27 November 2025'], ...dm.messages],
      ids
    );
    // Two people named Andrea: their keys tell them apart, so both are mapped.
    const g = new Chat('Gruppo Mac', 62000);
    let t = 0;
    for (let i = 0; i < 3; i++) {
      g.user('Andrea', '/avventura', t)._user_id = 404000404;
      g.bot('@andrea_rossi, nel bosco trovi un sasso [C]!', t + 1);
      g.user('Andrea', '/avventura', t + 100)._user_id = 505000505;
      g.bot('@andrea_bianchi, nel lago trovi una conchiglia [C]!', t + 101);
      t += 300;
    }
    g.user('Andrea', '/avventura', t)._user_id = 404000404;
    g.user('Andrea', '/avventura', t + 1)._user_id = 505000505;
    g.user('Carla', '/inventario', t + 2);
    g.bot('@andrea_bianchi, nel lago trovi una conchiglia [C]!', t + 3); // the second Andrea's command
    writeMacExport(path.join(dir, 'ChatExport_Gruppo_Mac'), 'Gruppo Mac', g.messages, ids);
  });

  // The same group exported on Windows and on macOS: the macOS dates take
  // the Windows offset from the shared messages, each message is kept once with the Windows
  // date, and the Windows-only messages share the macOS keys by name.
  scenario('macos-and-windows', (dir) => {
    const ids = { Mario: 606000606, Luigi: 707000707, [BOT]: 808000808 };
    const g = new Chat('Gruppo Misto', 63000);
    let t = 0;
    for (let i = 0; i < 4; i++) {
      g.user('Mario', '/avventura', t);
      g.bot('@mario, nel bosco trovi un sasso [C]!', t + 1);
      g.user('Luigi', '/inventario', t + 2);
      g.bot('@luigi, possiedi:\n- una mela [C] x1', t + 3);
      if (i === 1) g.user('Luigi', 'ciao a tutti', t + 4);
      t += 300;
    }
    const win = g.messages.slice(0, 10).map((m) => ({ ...m }));
    (win[8] as (typeof win)[number]).date = tgDate(304 + 60); // the two copies of "ciao a tutti" disagree
    writeExport(path.join(dir, 'ChatExport_2026-10-17'), g.title, [win]);
    writeMacExport(path.join(dir, 'ChatExport_Gruppo_Misto'), g.title, g.messages.slice(6), ids);
  });

  return out;
}

// ---- stage 2: conversation and interpretation (phases 2 to 4) -----------------------

/** One line of a messages file: a Message as phase 1 gives it (keys in its order). */
function jsonlMessage(m: Partial<Message> & { text: string }): string {
  return JSON.stringify({
    chat: m.chat === undefined ? 'G' : m.chat,
    dm: m.dm ?? false,
    id: m.id ?? 0,
    date: m.date === undefined ? tgDate(0) : m.date,
    from_bot: m.from_bot ?? false,
    sender: m.sender === undefined ? 'Mario' : m.sender,
    forwarded_from: m.forwarded_from ?? null,
    reply_to: m.reply_to ?? null,
    text: m.text,
  });
}

/**
 * Stage-2 scenarios: Telegram exports (run through the whole pipeline by the golden
 * tests) covering titles, broadcasts, group matching, display-name voting, old
 * formats and every docs/bot-protocol.md example, plus one file of messages with
 * values phase 1 rarely produces (null fields, control characters, odd dates).
 */
export function writeStage2Scenarios(root: string): Scenario[] {
  const out: Scenario[] = [];
  const scenario = (name: string, chats: Chat[]): void => {
    const dir = path.join(root, name);
    chats.forEach((c, i) => writeExport(path.join(dir, `Export${i}`), c.title, [c.messages]));
    out.push({ name: `stage2-${name}`, paths: [dir] });
  };

  // Every documented reply, after its command, in the DM and in a group.
  {
    const dm = new Chat(BOT, 1000);
    const g = new Chat('Gruppo Esempi', 1000);
    examples(readDoc()).forEach(({ attrs, body }, i) => {
      const q = attrs.get('query');
      const t = i * 30;
      if (q) dm.user('Daniele', q, t);
      dm.bot(body, t + 1);
      if (q) g.user(i % 2 ? 'Mario' : 'Luigi', q, t);
      g.bot(
        attrs.get('chat') === 'group'
          ? body
          : body.replace(/^@mario_r/u, i % 2 ? '@mario_r' : '@lucia_b'),
        t + 2
      );
    });
    scenario('docs-examples', [dm, g]);
  }

  // Titles: learned from the comma form (twice), with regex metacharacters, emoji,
  // overlapping titles, leaderboard counts, recipient form, Sua Maestà.
  {
    const g = new Chat('Gruppo Titoli');
    const titles = [
      'il cartografo',
      'il re',
      'il re magno',
      'la [regina]|x',
      'il $uper*+?',
      'lo sc\\emo',
      "l'incappellato",
      'il 🍕🍕',
      'gli abcde',
    ];
    let t = 0;
    for (const title of titles) {
      for (const u of ['aldo', 'bice']) {
        g.user(u === 'aldo' ? 'Aldo' : 'Bice', '/inventario', t);
        g.bot(`@${u} ${title}, possiedi:\n- un sasso [C] x1`, t + 1);
        t += 200;
      }
    }
    g.user('Aldo', '/esamina fango', t);
    g.bot(
      '@aldo il re magno un secchio di fango [C] al momento non ti serve in nessuna ricetta.',
      t + 1
    );
    g.user('Aldo', '/esamina fango', t + 200);
    g.bot(
      '@aldo il re un secchio di fango [C] al momento non ti serve in nessuna ricetta.',
      t + 201
    );
    g.user('Bice', '/dai 1 bottone @aldo', t + 400);
    g.bot('@bice la [regina]|x, dai 1x un bottone a @aldo il $uper*+?', t + 401);
    g.user('Bice', '/stats', t + 600);
    g.bot(
      'Eroi di Sempre:\nLivelli: @aldo il 🍕🍕 (11), @bice lo sc\\emo (3), @carlo il nuovo (2)',
      t + 601
    );
    g.user('Carlo', '/mostra sasso', t + 800);
    g.bot('@carlo il nuovo, mostri orgogliosamente di possedere 1x un sasso [C]', t + 801); // seen once: not learned
    g.user('Admin', '/inventario', t + 1000);
    g.bot('Sua Maestà @msx80 il cartografo, possiedi:\n- una corona [U] x1', t + 1001);
    g.user('Admin', '/stats msx80', t + 1200);
    g.bot('Avventuriero Sua Maestà @msx80\n- Livello: ∞', t + 1201);
    scenario('titles', [g]);
  }

  // Broadcasts: [W] stripped and unmatched, [N], [BAN]; not broadcasts in the DM.
  {
    const g = new Chat('Gruppo Annunci');
    g.user('Luigi', '/avventura', 0);
    g.bot('[W] @x, nel bosco trovi un sasso [C]!', 1);
    g.bot('[N] @y ti ha dato 1x un bottone', 2);
    g.bot('[N] i due pakkomon iniziano a combattere', 3);
    g.bot('[BAN] Sei stato bannato per: 2 ore. Motivazione: spam', 4);
    g.bot('[X] @y ti ha dato 1x un bottone', 5);
    g.bot('@luigi, nel bosco trovi un sasso [C]!', 6);
    const dm = new Chat(BOT, 5000);
    dm.user('Daniele', '/avventura', 0);
    dm.bot('[W] @djjeck, nel bosco trovi un sasso [C]!', 1);
    dm.bot('[N] Sua Maestà @msx80 ti ha dato 1x una ruota della fortuna 🎡', 2);
    scenario('broadcasts', [g, dm]);
  }

  // Group matching and display-name voting.
  {
    const dm = new Chat(BOT, 9000);
    dm.user('Daniele', '/inventario', 0);
    dm.bot('@djjeck, possiedi:\n- un sasso [C] x1', 1);
    const g = new Chat('Gruppo Avventurieri');
    let t = 0;
    const vote = (sender: string, user: string, n: number): void => {
      for (let i = 0; i < n; i++) {
        g.user(sender, '/avventura', t);
        g.bot(`@${user}, nel bosco trovi un sasso [C]!`, t + 1);
        t += 300;
      }
    };
    vote('Mario', 'mario', 3);
    vote('Mario', 'luigi', 2); // 60%: still mapped
    vote('Anna', 'anna', 3);
    vote('Anna Bis', 'anna', 3); // same votes: the first name keeps the username
    vote('Andrea', 'andrea_r', 4);
    vote('Andrea', 'andrea_b', 4); // 50%: unmapped
    vote('Deleted Account', 'ghost', 4);
    vote('Daniele', 'djjeck', 1); // the seed
    vote('Bea', 'bea', 2); // too few votes
    const q = g.user('Luigi', '/inventario', t);
    g.user('Mario', '/inventario', t + 1);
    g.bot('@luigi, possiedi:\n- un sasso [C] x1', t + 2, { reply_to: q.id });
    g.bot('@mario, possiedi:\n- un sasso [C] x1', t + 3);
    t += 1000;
    g.user('Luigi', '/Avventura', t);
    g.user('Bea', '/avventura', t + 1);
    g.bot('@luigi, nel bosco trovi un sasso [C]!', t + 2); // ambiguous
    g.bot('@bea, nel bosco trovi un sasso [C]!', t + 3);
    t += 1000;
    g.user('Mario', '/avventura', t);
    g.bot('Troppo presto, devi riposare ancora per 9 minuti e 29 secondi', t + 120); // single, player from the map
    g.user('Mario', '/avventura', t + 200);
    g.bot('@mario, nel bosco trovi un sasso [C]!', t + 321); // outside the window
    g.user('Luigi', '/inventario', t + 400);
    g.bot('@luigi, dai 1x un bottone a @zeta', t + 401); // incompatible
    g.user('Anna', '/dai 1 bottone @zeta', t + 402);
    g.bot('@anna, dai 1x un bottone a @zeta', t + 403);
    g.bot('@anna, dai 1x un bottone a @zeta', t + 404); // the command answers once
    g.bot('@carlo, nel bosco trovi un sasso [C]!', t + 399); // before any command
    t += 1000;
    g.user('Luigi', "ciao, faccio un'avventura", t);
    g.user('Luigi', '/avventura@AltroBot', t + 1);
    g.forward('Luigi', 'Anna', '/avventura', t + 2);
    g.forward('Luigi', BOT, '@luigi, nel bosco trovi un sasso [C]!', t + 3);
    g.bot('@luigi, nel bosco trovi un sasso [C]!', t + 4);
    g.user('Daniele', '/viaggio', t + 10);
    g.bot(
      '@djjeck, ti trovi: nel bosco nebbioso di Valtorbo 🌲\nPuoi andare verso:\n - nella valle ventosa 🏞',
      t + 11
    );
    g.user('Zoë', '/avventura', t + 20);
    g.bot('@zoë_ò, nel bosco trovi un sasso [C]!', t + 21); // Unicode \w in usernames
    t += 1000;
    g.user('Mario', '/inventario', t);
    g.bot(
      '@mario, possiedi:\n- una lampada magica [X] [usabile] x1\n- una vuvuzela 🎺 [X] [usabile] x1',
      t + 1
    );
    for (let i = 0; i < 10; i++) {
      g.user('Mario', '/usa vuvu', t + 10 + i * 5);
      g.bot('@mario, soffi con tutto il fiato e .. 🎺 TUUUU', t + 11 + i * 5);
    }
    g.user('Mario', '/usa vuvu', t + 100);
    g.bot('@mario, cosa desideri?', t + 101); // another item's reply: the pair is dissolved
    g.user('Luigi', '/usa lampada', t + 200);
    g.bot('@luigi, cosa desideri?', t + 201);
    const h = new Chat('\u{1F332} Altro gruppo', 3000);
    h.user('Mario', '/avventura', 0);
    h.bot('@mario, nel bosco trovi un sasso [C]!', 1);
    h.user('Rita', '/esamina sasso', 2);
    h.bot('@rita un sasso [C] al momento non ti serve in nessuna ricetta.', 3, { reply_to: 9000 }); // DM id, other chat
    scenario('group-matching', [dm, g, h]);
  }

  // Older formats, unknown replies across years, Unicode digits and boundaries.
  {
    const y2017: Instant = { epoch: Date.UTC(2017, 5, 1) / 1000, offsetMinutes: 120 };
    const y2018: Instant = { epoch: Date.UTC(2018, 0, 2) / 1000, offsetMinutes: 60 };
    const g = new Chat('Gruppo Storico', 100, y2017);
    g.user('Mario', '/esamina dado', 0);
    g.bot(
      "@mario un dado [C] [usabile] al momento non ti serve in nessuna ricetta.\n\nRaffreddamento: pronto all'uso.",
      1
    );
    g.user('Mario', '/esamina sasso', 10);
    g.bot('@mario un sasso [C] al momento non ti serve in nessuna ricetta.', 11);
    g.user('Mario', '/viaggio cima', 20);
    g.bot(
      '@mario, ti metti in cammino e dopo un lunghissimo viaggio arrivi in cima al monte Grevolo 🏔',
      21
    );
    g.user('Mario', '/viaggio baia', 30);
    g.bot('@mario, arrivi esausto nella baia di Scogliola 🦀', 31);
    g.user('Mario', '/titolo', 40);
    g.bot(
      '@mario, ora non hai nessun titolo. Ecco gli oggetti che danno titoli che possiedi:\n- un astrolabio da cartografo [L1]',
      41
    );
    g.bot(
      "Complimenti! Hai trovato tutti gli oggetti! Il vecchio ti ricompensa donandoti:\n- una moneta d'oro [X] x10",
      50
    );
    g.bot("IL FORTUNATO E': @mario ! Vince 100 monete", 60);
    g.bot('Inventario di @mario, al 2017/06/01 12:00:00', 70);
    g.user('Mario', '/inventario s', 80);
    g.bot('@mario puoi usare solo i seguenti parametri: C, N, R, S, L, X, U, M.', 81);
    const h = new Chat('Gruppo Storico', 500, y2018);
    h.user('Mario', '/avventura', 0);
    h.bot('@mario, nel bosco trovi un sasso [C]', 1); // no "!"
    h.user('Mario', '/mostra fischietto', 10);
    h.bot(
      '[.. una presenza indistinta..], mostri orgogliosamente di possedere 241x un fischietto [C]',
      11
    );
    h.user('Mario', '/remove pippo', 20);
    h.bot('Errore NumberFormatException For input string: "pippo"', 21);
    h.user('Mario', '/inventario', 30);
    h.bot('@mario, possiedi:\n- un sasso [C] x١٢\n- una mela [C] x3 ', 31); // Unicode digits and spaces
    h.user('Mario', '/esamina sasso', 40);
    h.bot(
      "@mario un sasso [C] al momento ti serve nelle ricette: Muro, Torre.\nNe hai ٣.\nE' un oggetto che si ottiene con una ricetta, ma non sai quale..",
      41
    );
    h.user('Mario', '/start', 50);
    h.bot('🍕'.repeat(70) + 'Benvenuto!', 51); // "Benvenuto!" ends at code point 80
    h.bot('🍕'.repeat(71) + 'Benvenuto!', 52);
    h.user('Mario', '/faq', 60);
    h.bot(
      'Ciao, sono InventoryBot!\n\nLegenda oggetti\nàC = comune, N = non comune (davvero), Ln = ricette.\n\nLivelli\n\nregola\n\nfine',
      61
    );
    h.user('Mario', '/ricetta torre', 70);
    h.bot(
      "@mario, prendi in mano:\n- un sasso [C] x2\ne costruisci\nOttieni: una torre!\n\nHai raggiunto il livello ٢! Per te 20x una moneta d'oro",
      71
    );
    h.user('Mario', '/ricetta', 80);
    h.bot(
      '@mario, ecco le ricette a tua disposizione:\n- Torre L١ [*]\n- Gran Torre L11 [manca ٣]\n- Gara di cucina L3 [manca TRONCATO!',
      81
    );
    h.user('Mario', '/stats mario', 90);
    h.bot(
      'Avventuriero @mario\n- Livello: 3\n- Città natale: Roma\n- Oggetti unici:\n   - un assegno [U]',
      91
    );
    scenario('old-formats', [g, h]);
  }

  // A messages dump written directly: null chat/sender/date, unparsable dates (also a
  // Windows title with offset seconds, which Telegram does not write), control characters
  // and line separators, whitespace that JavaScript's \s does not cover.
  {
    const dir = path.join(root, 'raw');
    fs.mkdirSync(dir, { recursive: true });
    const d = (s: number): string => tgDate(s);
    const lines = [
      jsonlMessage({ chat: BOT, dm: true, id: 1, sender: null, text: '/inventario' }),
      jsonlMessage({
        chat: BOT,
        dm: true,
        id: 2,
        from_bot: true,
        sender: BOT,
        text: '@nicolò, possiedi:\r\n- un sasso [C] x1\r',
      }),
      jsonlMessage({ chat: null, id: 3, date: d(10), text: '/avventura' }),
      jsonlMessage({
        chat: null,
        id: 4,
        date: d(11),
        from_bot: true,
        sender: BOT,
        text: '@mario, nel bosco trovi un sasso [C]!\x85',
      }),
      jsonlMessage({
        chat: null,
        id: 5,
        date: null,
        from_bot: true,
        sender: BOT,
        text: 'Il bot sta dormendo',
      }),
      jsonlMessage({
        chat: null,
        id: 6,
        date: 'garbage',
        from_bot: true,
        sender: BOT,
        text: 'Il bot sta ancora dormendo',
      }),
      jsonlMessage({
        chat: 'G',
        id: 7,
        date: '27.11.2025 19:00:20 UTC-05:00:30.5',
        text: '/esamina\x85sasso',
      }),
      jsonlMessage({
        chat: 'G',
        id: 8,
        date: d(-10),
        from_bot: true,
        sender: BOT,
        text: '@mario per fare Torre alta ti manca:\n- un sasso [C] x1\x1c',
      }),
      jsonlMessage({ chat: 'G', id: 9, date: d(30), text: '/stats' }),
      jsonlMessage({
        chat: 'G',
        id: 10,
        date: d(31),
        from_bot: true,
        sender: BOT,
        text: 'Avventuriero @mario\n- __proto__: x\n- Date: y\n- Player: z\n- Livello: 3',
      }),
      jsonlMessage({ chat: 'G', id: 11, date: d(40), text: '/stats' }),
      jsonlMessage({
        chat: 'G',
        id: 12,
        date: d(41),
        from_bot: true,
        sender: BOT,
        text: 'Avventuriero @mario\n- Type: altro\n- Livello: 4',
      }),
      jsonlMessage({
        chat: 'G',
        id: 13,
        date: d(50),
        sender: 'Mario',
        text: '/avventura',
      }),
      jsonlMessage({
        chat: 'G',
        id: 14,
        date: d(51),
        from_bot: true,
        sender: BOT,
        text: '@mario, oggi è la tua avventura FORTUNATA del giorno! Hai vinto: un 🍀 [R]!',
        reply_to: 13,
      }),
      // Matched to id 7 only if its first word is "/esamina" (U+0085 is whitespace for splitWords).
      jsonlMessage({
        chat: 'G',
        id: 15,
        date: d(60),
        from_bot: true,
        sender: BOT,
        text: '@mario un sasso [C] al momento non ti serve in nessuna ricetta.',
      }),
    ];
    const file = path.join(dir, 'messages.jsonl');
    fs.writeFileSync(file, lines.join('\n') + '\n', 'utf-8');
    out.push({ name: 'stage2-raw-messages', paths: [file] });
  }

  return out;
}

// ---- stage 3: the wiki and the player state (phase 5) ---------------------------------

/**
 * Stage-3 scenarios: the end-to-end inbox of the tests, and exports covering renames
 * and chains, /usa consumption intervals, unnamed recipes, latest-wins across UTC
 * offsets, /inventario filters (rarity letters, L1, M, text, truncated), gift dedupe,
 * and report entries whose report notation needs escaping. Plus one file of events written
 * directly with dates phase 1 rarely produces (phase 5 only).
 */
export function writeStage3Scenarios(root: string): Scenario[] {
  const out: Scenario[] = [];
  const scenario = (name: string, chats: Chat[]): void => {
    const dir = path.join(root, name);
    chats.forEach((c, i) => writeExport(path.join(dir, `Export${i}`), c.title, [c.messages]));
    out.push({ name: `stage3-${name}`, paths: [dir] });
  };
  /** A DM command and its reply, `t` seconds after the chat's base. */
  const say = (c: Chat, t: number, cmd: string | null, reply: string, user = 'Daniele'): void => {
    if (cmd !== null) c.user(user, cmd, t);
    c.bot(reply, t + 1);
  };
  const DAY = 86400;

  {
    const dir = path.join(root, 'e2e-inbox');
    writeInbox(dir);
    out.push({ name: 'stage3-e2e-inbox', paths: [dir] });
  }

  // Renames: a swap with the same rarity, a chain A -> B -> C over months, a swap
  // with another rarity, an old name seen again after the new one, an exclusive
  // renamed item with a drop location, and a different quantity.
  {
    const dm = new Chat(BOT, 1000);
    say(dm, 0, '/viaggio', T.where('nel bosco nebbioso di Valtorbo 🌲', ['nella valle ventosa 🏞']));
    say(
      dm,
      10,
      '/inventario',
      T.inventory([
        ["un Gufetto d'Argento", 'R+', 1],
        ['un A', 'R', 1],
        ['un nastro', 'C', 2],
      ])
    );
    say(dm, 20, '/avventura', T.drop("nel bosco trovi un Gufetto d'Argento", 'R+'));
    say(
      dm,
      30,
      '/ricetta premiazione',
      T.detail('Premiazione', [['un sasso', 'C', 1]], [["un Gufetto d'Argento", 'R+', 1]])
    );
    say(
      dm,
      40,
      '/ricetta catena',
      T.detail(
        'Catena',
        [],
        [
          ['un nastro', 'C', 1],
          ['un A', 'R', 1],
        ]
      )
    );
    say(dm, 50, '/ricetta altare', T.detail('Altare', [["un Gufetto d'Argento", 'R+', 2]], []));
    say(
      dm,
      60,
      '/ricetta muro',
      T.detail(
        'Muro',
        [],
        [
          ['un sasso', 'C', 2],
          ['un Papa Ratzinger', 'R', 1],
        ]
      )
    );
    say(
      dm,
      70,
      '/esamina gufetto',
      T.info("un Gufetto d'Argento", 'R+', { count: 1, usedIn: 'Premiazione, Altare' })
    );
    say(
      dm,
      80,
      '/ricetta',
      T.recipeList([
        ['Premiazione', 1, 0],
        ['Catena', 2, 1],
        ['Altare', 3, 2],
      ])
    );
    say(
      dm,
      40 * DAY,
      '/ricetta premiazione',
      T.detail('Premiazione', [['un sasso', 'C', 1]], [['un Premio Sgranocchio', 'R+', 1]])
    );
    say(
      dm,
      40 * DAY + 10,
      '/ricetta catena',
      T.detail(
        'Catena',
        [],
        [
          ['un nastro', 'C', 1],
          ['un B', 'R', 1],
        ]
      )
    );
    say(
      dm,
      40 * DAY + 20,
      '/ricetta muro',
      T.detail(
        'Muro',
        [],
        [
          ['un sasso', 'C', 2],
          ['un Papa Bergoglio', 'N', 1],
        ]
      )
    );
    say(
      dm,
      40 * DAY + 30,
      '/ricetta torre',
      T.detail(
        'Torre',
        [],
        [
          ['un sasso', 'C', 1],
          ['un Vecchio', 'C', 1],
        ]
      )
    );
    say(
      dm,
      40 * DAY + 40,
      '/inventario',
      T.inventory([
        ['un Premio Sgranocchio', 'R+', 1],
        ['un B', 'R', 1],
        ['un nastro', 'C', 2],
      ])
    );
    say(
      dm,
      80 * DAY,
      '/ricetta catena',
      T.detail(
        'Catena',
        [],
        [
          ['un nastro', 'C', 1],
          ['un C', 'R', 1],
        ]
      )
    );
    say(
      dm,
      80 * DAY + 10,
      '/ricetta torre',
      T.detail(
        'Torre',
        [],
        [
          ['un sasso', 'C', 1],
          ['un Nuovo', 'C', 1],
        ]
      )
    );
    say(
      dm,
      80 * DAY + 20,
      '/inventario',
      T.inventory([
        ['un Vecchio', 'C', 1],
        ['un C', 'R', 1],
      ])
    );
    say(
      dm,
      80 * DAY + 30,
      '/ricetta torre',
      T.detail(
        'Torre',
        [],
        [
          ['un sasso', 'C', 2],
          ['un Nuovo', 'C', 1],
        ]
      )
    );
    say(
      dm,
      80 * DAY + 40,
      '/ricetta premiazione',
      T.craft(
        [
          ['un sasso', 'C', 1],
          ['un Premio Sgranocchio', 'R+', 1],
        ],
        'una coppa'
      )
    );
    scenario('renames', [dm]);
  }

  // /usa: consumption intervals (yes, no, invalidated by drops/gifts/crafts/level-up/
  // /usa output, conflicting), failed uses, noise, ambiguous queries, unknown replies
  // with a known shape, trailing arguments.
  {
    const dm = new Chat(BOT, 1000);
    let t = 0;
    const next = (cmd: string | null, reply: string): void => {
      say(dm, t, cmd, reply);
      t += 10;
    };
    next(
      '/inventario',
      T.inventory([
        ['una pozione', 'C', 3, true],
        ['un elisir', 'C', 2, true],
        ['un dado a dodici facce', 'C', 1, true],
        ['un dado truccato', 'C', 1, true],
        ['una caps rossa', 'C', 2, true],
        ['un baule', 'C', 1, true],
        ['una chiave', 'C', 1, true],
        ['un sasso', 'C', 1],
      ])
    );
    next('/usa pozione', '@djjeck, bevi la pozione e ti senti meglio');
    next('/usa pozione', '@djjeck, bevi la pozione e ti senti meglio');
    next('/esamina pozione', T.info('una pozione', 'C', { count: 1, usable: true }));
    next('/usa pozione', '@djjeck, bevi la pozione e ti senti meglio');
    next('/esamina pozione', T.info('una pozione', 'C', { count: 1, usable: true }));
    next('/usa elisir', "@djjeck, l'elisir brilla e svanisce");
    next('/avventura', T.drop('nel bosco trovi un elisir', 'C'));
    next('/esamina elisir', T.info('un elisir', 'C', { count: 2, usable: true }));
    next('/usa elisir', "@djjeck, l'elisir brilla e svanisce");
    next(null, T.gift(1, 'un elisir', 'luigi'));
    next('/usa elisir', "@djjeck, l'elisir brilla e svanisce");
    next(
      '/ricetta muro',
      T.craft([['un sasso', 'C', 1]], 'un muro', 'djjeck', [5, 'Per te 1x un elisir in omaggio!'])
    );
    next('/inventario', T.inventory([['un elisir', 'C', 2, true]], 'djjeck', true));
    next('/usa elisir', "@djjeck, l'elisir brilla e svanisce");
    next('/inventario', T.inventory([['un elisir', 'C', 1, true]]));
    next(
      '/usa baule',
      "@djjeck, apri il baule e trovi:\n- una moneta d'oro [X] x3\n- un elisir [C] x1"
    );
    next('/usa elisir', "@djjeck, l'elisir brilla e svanisce");
    next('/inventario elisir', T.inventory([['un elisir', 'C', 2, true]]));
    next('/usa dado a dodici', '@djjeck, tiri il dado e fai 5!');
    next('/usa dado', '@djjeck, tiri il dado e fai 2!');
    next('/usa dado', '@djjeck, tiri il dado e fai 12!');
    next(null, '@djjeck, tiri il dado e fai 3!');
    next('/usa caps # palude', '@djjeck, lanci il tappo nella palude');
    next('/usa caps', '@djjeck, lanci il tappo lontano');
    next('/usa chiave', '@djjeck, non hai la chiave giusta per aprire questo baule..');
    next('/usa chiave', '@djjeck, non hai la chiave giusta per aprire questo baule..');
    next('/usa niente', '@djjeck, non hai niente del genere di usabile.');
    next('/use', '@djjeck, si ma cosa vuoi usare?');
    next(
      '/usa truccato',
      '@djjeck, il dado rotola sotto il tavolo e sparisce, \' " \\   🧑‍🚀 ' + 'lungo '.repeat(20)
    );
    next('/usa d', '@djjeck, un messaggio mai visto 🎲');
    next('/esamina pozione', T.info('una pozione', 'C', { count: 0, usable: true }));
    // Cooldowns: a refusal without a command and an /esamina remaining time, each after a use.
    next('/usa baule', '@djjeck, apri il baule ma è vuoto');
    next(
      null,
      '@djjeck, un baule deve raffreddarsi ancora per 4 minuti e 31 secondi prima di poterlo usare di nuovo.'
    );
    next('/usa baule', '@djjeck, apri il baule ma è vuoto');
    next(
      '/esamina baule',
      '@djjeck un baule [C] [usabile] al momento non ti serve in nessuna ricetta.\nNe hai 1.\nRaffreddamento: 4 minuti e 40 secondi'
    );
    next(
      null,
      'un baule deve raffreddarsi ancora per 3 ore e 2 minuti prima di poterlo dare in giro.'
    );
    scenario('uses', [dm]);
  }

  // The channels' exports: a Cittadella card (in another spelling of a name, older than the
  // bot's craft) and its other posts, which are no cards, an Atlante card and the Grimorio's
  // item and event cards, next to the DM.
  {
    const dm = new Chat(BOT, 1000);
    say(dm, 0, '/ricetta', T.recipeList([['Torre alta', 2, 1]]));
    say(dm, 10, '/inventario', T.inventory([['una trave', 'N', 1]]));
    const ch = new Chat(CITTADELLA, 10);
    ch.user(CITTADELLA, '‼️ Benvenuti nella Cittadella! ‼️', -100);
    // A no-break space in a name, and no space before the quantity.
    const typed = TORRE_CARD.replace('una trave [N] x2', 'una\u00a0trave ' + '[N]x2');
    ch.user(CITTADELLA, typed, -50);
    say(
      dm,
      20,
      '/ricetta torre alta',
      T.craft(
        [
          ['una torre', 'L1', 1],
          ['una trave', 'N', 3],
        ],
        'una torre altissima'
      )
    );
    const atlas = new Chat(ATLANTE, 10);
    atlas.user(ATLANTE, CRIPTE_CARD, -40);
    const grimoire = new Chat(GRIMORIO, 10);
    grimoire.user(GRIMORIO, BAULE_CARD, -30);
    grimoire.user(GRIMORIO, EVENT_CARD, -20);
    scenario('channels', [dm, ch, atlas, grimoire]);
  }

  // Recipe names: by signature, query, output; unnamed group crafts (one entry per
  // output, "?" without output); ambiguous queries; recipe names with ", "; level and
  // source inference; partial ingredients not in the full list; output conflicts.
  {
    const dm = new Chat(BOT, 1000);
    say(
      dm,
      0,
      '/ricetta',
      T.recipeList([
        ['Pizza', 1, 0],
        ['Pizza della nonna', 1, 0],
        ['Sale, pepe e olio', 1, 1],
        ['Muro', 1, 2],
      ])
    );
    say(
      dm,
      10,
      '/esamina sasso',
      T.info('un sasso', 'C', {
        count: 3,
        usedIn: 'Muro, Sale, pepe e olio, Torre',
        source: 'special',
      })
    );
    say(
      dm,
      20,
      '/ricetta torre',
      T.detail('Torre', [['un sasso', 'C', 2]], [['una trave', 'N', 1]])
    );
    say(
      dm,
      30,
      '/ricetta',
      T.craft(
        [
          ['un sasso', 'C', 2],
          ['una trave', 'N', 1],
        ],
        'una torre'
      )
    );
    say(
      dm,
      40,
      '/esamina vortice',
      T.info('un vortice', 'L3', { count: 0, source: 'Fonduta cosmica' })
    );
    say(dm, 50, null, T.craft([['un biscotto', 'C', 2]], 'un vortice'));
    say(dm, 60, '/ricetta izz', T.craft([['un laccio', 'C', 1]], 'una pizza'));
    say(dm, 70, '/ricetta pizza', T.craft([['un laccio', 'C', 1]], 'una pizza'));
    say(dm, 80, '/ricetta pizza', T.craft([['un laccio', 'C', 1]], 'una pizza margherita'));
    say(dm, 90, '/ricetta muro', T.craft([['un sasso', 'C', 3]], 'un muro'));
    const g = new Chat('Gruppo Cucina', 500);
    g.bot(T.craft([['un laccio', 'C', 1]], 'una cestina', 'luigi'), 100);
    g.bot(T.craft([['un laccio', 'C', 1]], 'una cestina', 'luigi'), 110);
    g.bot(T.craft([['un sasso', 'C', 3]], 'un muro', 'anna'), 120);
    g.bot('@anna, prendi in mano:\n- un sasso [C] x1\ne lo guardi a lungo...', 130);
    g.user('Luigi', '/ricetta cest', 140);
    g.bot(T.craft([['un laccio', 'C', 2]], 'una cestina', 'luigi'), 141);
    scenario('crafts', [dm, g]);
  }

  // Latest wins by instant across UTC offsets: a group in UTC+01:00 whose local clock
  // is ahead of the DM's UTC-05:00, rarity and ingredient changes, first and last seen.
  {
    const dm = new Chat(BOT, 1000);
    const rome: Instant = { epoch: dm.base.epoch, offsetMinutes: 60 };
    const tokyo: Instant = { epoch: dm.base.epoch, offsetMinutes: 540 };
    const g = new Chat('Gruppo Roma', 2000, rome);
    const h = new Chat('Gruppo Tokyo', 3000, tokyo);
    say(dm, 0, '/esamina sasso', T.info('un sasso', 'C', { count: 1 }));
    g.user('Luigi', '/esamina sasso', 3600);
    g.bot(T.info('un sasso', 'N', { count: 2, user: 'luigi' }), 3601);
    say(dm, 7200, '/esamina sasso', T.info('un sasso', 'R', { count: 1 }));
    h.user('Anna', '/esamina sasso', 5000);
    h.bot(T.info('un sasso', 'S', { count: 2, user: 'anna' }), 5001);
    say(dm, 100, '/ricetta torre', T.detail('Torre', [['un sasso', 'C', 2]], []));
    g.user('Luigi', '/ricetta torre', 50);
    g.bot(T.detail('Torre', [['un sasso', 'C', 3]], [], 'luigi'), 51);
    h.user('Anna', '/ricetta torre', 9000);
    h.bot(T.craft([['un sasso', 'C', 4]], 'una torre', 'anna'), 9001);
    say(dm, 8000, '/ricetta torre', T.craft([['un sasso', 'C', 2]], 'una torre alta'));
    say(dm, 8100, '/viaggio', T.where('nel bosco nebbioso di Valtorbo 🌲', []));
    g.user('Luigi', '/viaggio valle', 8200);
    g.bot(
      T.travel(
        'nella valle ventosa 🏞',
        ['sul banco corallino 🐠'],
        'luigi',
        "inghiotti l'Respirella e"
      ),
      8201
    );
    scenario('offsets', [dm, g, h]);
  }

  // /inventario filters: full, C, C+, L, L1, M, [C], text, truncated, and an
  // unmatched group reply; /mostra, /ricetta lower bounds, "ti manca".
  {
    const dm = new Chat(BOT, 1000);
    const items: T.ItemSpec[] = [
      ['una mela', 'C', 2],
      ['un fiore', 'C+', 1],
      ['una cosa', 'N', 3],
      ['un drago', 'M', 1],
      ['uno scudo', 'L1', 1],
      ['una L1 rara', 'L2', 1],
      ['un sasso', 'C', 4],
      ["una moneta d'Oro", 'X', 3],
      ['un oro falso', 'U', 1],
    ];
    let t = 0;
    for (const [q, listed, truncated] of [
      ['/inventario', items, false],
      ['/inventario C', [['un sasso', 'C', 4]], false],
      ['/inventario', items, false],
      ['/inventario C+', [], false],
      ['/inventario', items, false],
      ['/inventario L', [], false],
      ['/inventario', items, false],
      ['/inventario L1', [], false],
      ['/inventario M', [], false],
      ['/inventario [C]', [], false],
      ['/inventario oro', [['un oro falso', 'U', 1]], false],
      ['/inventario', items, false],
      ['/inventario moneta oro', [], false],
      ['/inventario', items.slice(0, 3), true],
      ['/INVENTARIO   c  ', [], false],
    ] as [string, T.ItemSpec[], boolean][]) {
      say(dm, t, q, T.inventory(listed, 'djjeck', truncated));
      t += 10;
    }
    say(
      dm,
      t,
      '/ricetta torre',
      T.detail(
        'Torre',
        [['un sasso', 'C', 1]],
        [
          ['un sasso', 'C', 2],
          ['una trave', 'N', 1],
        ]
      )
    );
    say(dm, t + 10, '/mostra cappello', T.show(3, 'un cappello piumato', 'N'));
    say(
      dm,
      t + 20,
      '/ricetta',
      T.recipeList([
        ['Torre', 1, 0],
        ['Muro', 2, 3],
      ])
    );
    const g = new Chat('Gruppo Inventari', 500);
    g.bot(T.inventory([['un sasso', 'C', 1]]), t + 30);
    scenario('inventory', [dm, g]);
  }

  // Gifts: a group /dai to the owner and its DM notice (30 s: once; 121 s: twice),
  // the owner's own /dai, gives between other players.
  {
    const dm = new Chat(BOT, 1000);
    const g = new Chat('Gruppo Regali', 500);
    say(dm, 0, '/esamina bottone', T.info('un bottone', 'C', { count: 1 }));
    g.user('Luigi', '/dai 2 bottone @djjeck', 10);
    g.bot(T.give(2, 'un bottone', 'djjeck', 'luigi'), 11);
    dm.bot(T.gift(2, 'un bottone', 'luigi'), 41);
    g.user('Anna', '/dai 1 bottone @djjeck', 100);
    g.bot(T.give(1, 'un bottone', 'djjeck', 'anna'), 101);
    dm.bot(T.gift(1, 'un bottone', 'anna'), 222);
    g.user('Daniele', '/dai 1 bottone @luigi', 300);
    g.bot(T.give(1, 'un bottone', 'luigi'), 301);
    g.user('Luigi', '/dai 5 sasso @anna', 400);
    g.bot(T.give(5, 'un sasso', 'anna', 'luigi'), 401);
    g.bot('[N] @luigi ti ha dato 3x un sasso', 402);
    scenario('gifts', [dm, g]);
  }

  // Report lines: names with quotes, backslashes, non-printable characters and emoji;
  // unresolved and empty-prefix drops; exclusive items in many places; source and
  // rarity contradictions; an item named __proto__.
  {
    const dm = new Chat(BOT, 1000);
    const odd = [
      'l\'ascia "vera"',
      'un \\ rovescio',
      'un nbsp qui',
      'un astronauta 🧑‍🚀',
      '__proto__',
      'un "dolce"',
    ];
    say(dm, 0, '/inventario', T.inventory(odd.map((n): T.ItemSpec => [n, 'C', 1])));
    odd.forEach((n, i) =>
      say(
        dm,
        10 + i * 10,
        `/esamina ${n}`,
        T.info(n, 'N', { count: 1, source: i % 2 ? 'special' : 'adventure' })
      )
    );
    say(
      dm,
      100,
      '/viaggio',
      T.where('nel bosco nebbioso di Valtorbo 🌲', ['nella valle ventosa 🏞'])
    );
    say(dm, 110, '/avventura', T.drop('un sasso', 'C'));
    say(dm, 120, '/avventura', T.drop('nel fosso vedi una cosa strana', 'C'));
    say(dm, 130, '/avventura', T.drop(`nel bosco trovi ${odd[0]}`, 'C+'));
    say(
      dm,
      140,
      '/viaggio valle',
      T.travel('nella valle ventosa 🏞', ['nel bosco nebbioso di Valtorbo 🌲'])
    );
    say(dm, 150, '/avventura', T.drop(`nel bosco trovi ${odd[0]}`, 'C+'));
    say(dm, 160, '/avventura', T.drop("sulla spiaggia raccogli una conchiglia  '", 'C'));
    say(dm, 170, '/ricetta', T.recipeList([["Ricetta 'strana'", 1, 0]]));
    say(dm, 180, '/ricetta strana', T.detail("Ricetta 'strana'", [], [[odd[3] as string, 'C', 1]]));
    say(
      dm,
      190,
      '/esamina proto',
      T.info('__proto__', 'N', { count: 2, usedIn: "Ricetta 'strana'" })
    );
    scenario('report-special-characters', [dm]);
  }

  // events.jsonl written directly (phase 5 only): missing, empty and unparsable dates
  // (also offset seconds and a "Z" offset, which are not Telegram's form), a missing player.
  {
    const dir = path.join(root, 'raw');
    fs.mkdirSync(dir, { recursive: true });
    const ctx = (
      date: string | null,
      o: Record<string, unknown> = {}
    ): Record<string, unknown> => ({
      chat: BOT,
      dm: true,
      msg: 1,
      date,
      player: 'djjeck',
      query: null,
      match: 'dm',
      forwarded: false,
      broadcast: false,
      ...o,
    });
    const info = (rarity: string, count: number): Record<string, unknown> => ({
      type: 'item_info',
      item: 'un sasso',
      rarity,
      usable: false,
      used_in_raw: null,
      count,
      source: null,
      from_recipe: null,
    });
    const lines = [
      { ...info('C', 1), ...ctx(null) },
      { ...info('N', 2), ...ctx('') },
      { ...info('R', 3), ...ctx('garbage') },
      { ...info('S', 4), ...ctx('27.11.2025 19:00:20 UTC-05:00:30.5') },
      { ...info('U', 5), ...ctx('28.11.2025 00:00:20 UTC+00:00') },
      { ...info('X', 6), ...ctx('28.11.2025 00:00:20 Z') },
      { ...info('C', 7), ...ctx('27.11.2025 19:00:20 UTC-00:00', { player: null }) },
      {
        type: 'gift',
        from: 'luigi',
        qty: 1,
        item: 'un sasso',
        ...ctx('27.11.2025 19:00:20 UTC-05:00:30.5'),
      },
      {
        type: 'give',
        to: 'djjeck',
        qty: 1,
        item: 'un sasso',
        ...ctx('28.11.2025 00:01:50 UTC+00:00', { dm: false, chat: 'G', player: 'luigi' }),
      },
      { type: 'unknown', ...ctx('27.11.2025 19:00:21 UTC-05:00'), text: '@djjeck, qualcosa' },
    ];
    const file = path.join(dir, 'events.jsonl');
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l) + '\n').join(''), 'utf-8');
    out.push({ name: 'stage3-raw-events', paths: [file] });
  }

  return out;
}
