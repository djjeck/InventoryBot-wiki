/**
 * The web app's page: folder picking, the time zone (this browser's, proposed), the owner's
 * username when the run asks for it, progress and errors, then a summary of what phases 1
 * to 4 read. The secret salt of the pseudonyms is kept in this browser (pseudonymSalt).
 * The pipeline runs in a Web Worker (worker.ts), on the browser `File` objects of the
 * picked folders; nothing is sent over the network.
 *
 * Browser-only wiring, checked in a browser; the logic it relies on (run.ts, the
 * adapters) has its own tests.
 */
import { type FileLike } from '#src/telegram/export/browser-files.ts';
import {
  type ProgressMessage,
  type RunOptions,
  type RunResult,
  type StoppedMessage,
  type WorkerMessage,
} from './protocol.ts';
import './app.css';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const ui = {
  start: $('start'),
  result: $('result'),
  folders: $<HTMLInputElement>('folders'),
  pickLabel: $<HTMLLabelElement>('pick-label'),
  clearPicks: $<HTMLButtonElement>('clear-picks'),
  picked: $<HTMLUListElement>('picked'),
  form: $<HTMLFormElement>('options'),
  playerField: $('player-field'),
  player: $<HTMLInputElement>('player'),
  timeZone: $<HTMLSelectElement>('time-zone'),
  run: $<HTMLButtonElement>('run'),
  progress: $('progress'),
  progressBar: $<HTMLProgressElement>('progress-bar'),
  progressText: $('progress-text'),
  error: $('error'),
  resultInfo: $('result-info'),
  edit: $<HTMLButtonElement>('edit'),
  report: $('report'),
  announce: $('announce'),
};

/** The folders picked in this visit (kept in memory only, never saved). */
const picks: FileLike[][] = [];
let running = false;

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );

function announce(text: string): void {
  ui.announce.textContent = '';
  // A change after a tick, so that screen readers announce the same text twice.
  setTimeout(() => (ui.announce.textContent = text), 50);
}

// ---- folders -------------------------------------------------------------------------

function topName(files: readonly FileLike[]): string {
  const names = new Set(files.map((f) => (f.webkitRelativePath || f.name).split('/')[0]));
  return [...names].join(', ');
}

function renderPicks(): void {
  ui.picked.replaceChildren(
    ...picks.map((files, i) => {
      const li = document.createElement('li');
      const pages = files.filter((f) => /^messages\d*\.html$/.test(f.name)).length;
      const span = document.createElement('span');
      span.textContent = `${topName(files)} — ${files.length} file, ${pages} pagine di chat`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Togli';
      remove.setAttribute('aria-label', `Togli ${topName(files)}`);
      remove.addEventListener('click', () => {
        picks.splice(i, 1);
        renderPicks();
        ui.pickLabel.focus();
      });
      li.append(span, remove);
      return li;
    })
  );
  ui.clearPicks.hidden = picks.length === 0;
  ui.pickLabel.textContent = picks.length ? 'Aggiungi un’altra cartella…' : 'Scegli una cartella…';
  ui.run.disabled = running || picks.length === 0;
}

ui.folders.addEventListener('change', () => {
  const files = [...(ui.folders.files ?? [])];
  ui.folders.value = ''; // the same folder can be picked again
  if (files.length === 0) return;
  picks.push(files);
  renderPicks();
  hideError();
  announce(`Aggiunta la cartella ${topName(files)}.`);
});

ui.clearPicks.addEventListener('click', () => {
  picks.length = 0;
  renderPicks();
});

// The pick label works as a button from the keyboard too.
ui.pickLabel.tabIndex = 0;
ui.pickLabel.setAttribute('role', 'button');
ui.pickLabel.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    ui.folders.click();
  }
});

// ---- errors and progress -------------------------------------------------------------

function hideError(): void {
  ui.error.hidden = true;
  ui.error.replaceChildren();
}

function showError(html: string, details: readonly string[] = [], focus?: HTMLElement): void {
  ui.error.innerHTML =
    html + (details.length ? `<ul>${details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '');
  ui.error.hidden = false;
  (focus ?? ui.error).focus();
}

function showProgress(m: ProgressMessage): void {
  if (m.phase === 'read') {
    const total = m.total ?? 0;
    ui.progressBar.value = total ? Math.round((90 * (m.done ?? 0)) / total) : 0;
    ui.progressText.textContent = `Lettura delle pagine: ${m.done ?? 0} di ${total}`;
  } else if (m.phase === 'parse') {
    ui.progressBar.value = 92;
    ui.progressText.textContent = 'Lettura dei messaggi…';
  } else if (m.phase === 'conversation') {
    ui.progressBar.value = 94;
    ui.progressText.textContent = 'Abbinamento delle risposte ai comandi…';
  } else {
    ui.progressBar.value = 97;
    ui.progressText.textContent = 'Interpretazione delle risposte del bot…';
  }
}

/** The Italian explanation of a stop, and the field to fill. */
function showStop(m: StoppedMessage): void {
  const warnings = m.report.filter((l) => l.startsWith('salto '));
  if (m.reason === 'no-pages') {
    showError(
      '<p>Nelle cartelle scelte non c’è nessuna pagina di chat esportata (<code>messages.html</code>). ' +
        'Scegli la cartella creata da Telegram Desktop con <b>Esporta cronologia chat</b>, in formato <b>HTML</b>.</p>',
      warnings
    );
  } else {
    // Asked only here: the owner is normally found in the private chat with the bot.
    ui.playerField.hidden = false;
    ui.player.setAttribute('aria-invalid', 'true');
    showError(
      '<p>Tra le esportazioni non c’è la chat privata con il bot, da cui ricavare il tuo nome utente. ' +
        'Scrivilo nel campo <b>Il tuo nome utente Telegram</b> e premi di nuovo ' +
        '<b>Leggi le esportazioni</b>.</p>',
      warnings,
      ui.player
    );
  }
}

// ---- pseudonyms ----------------------------------------------------------------------

const SALT_KEY = 'ib-salt';

/**
 * The secret salt of the pseudonyms: random, made once and kept in this browser, so the
 * same players keep the same pseudonyms from run to run. Where storage is blocked, a new
 * one for this visit.
 */
function pseudonymSalt(): string {
  const fresh = (): string =>
    [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  try {
    const kept = localStorage.getItem(SALT_KEY);
    if (kept) return kept;
    const salt = fresh();
    localStorage.setItem(SALT_KEY, salt);
    return salt;
  } catch {
    return fresh();
  }
}

// ---- time zone -----------------------------------------------------------------------

/** The time zone the picker proposes: this browser's, else Italy's. */
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome';
  } catch {
    return 'Europe/Rome';
  }
}

/** Fills the picker with the world's time zones, the browser's selected. */
function fillTimeZones(): void {
  const proposed = browserTimeZone();
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    // an older browser: only the proposed zone and Italy's
  }
  const all = [...new Set([...zones, proposed, 'Europe/Rome', 'UTC'])].sort();
  ui.timeZone.replaceChildren(
    ...all.map((z) => {
      const option = document.createElement('option');
      option.value = z;
      option.textContent = z.replaceAll('_', ' ');
      return option;
    })
  );
  ui.timeZone.value = proposed;
}

// ---- running -------------------------------------------------------------------------

function setRunning(on: boolean): void {
  running = on;
  ui.run.disabled = on || picks.length === 0;
  ui.folders.disabled = on;
  ui.timeZone.disabled = on;
  ui.progress.hidden = !on;
  ui.form.setAttribute('aria-busy', String(on));
}

ui.form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (running || picks.length === 0) return;
  hideError();
  ui.player.removeAttribute('aria-invalid');
  // The field is shown only when a run has asked for it.
  const player = ui.playerField.hidden ? '' : ui.player.value.trim().replace(/^@/, '');
  const options: RunOptions = {
    timeZone: ui.timeZone.value,
    player: player === '' ? null : player,
    salt: pseudonymSalt(),
  };
  let worker: Worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch (err) {
    showError(`<p>Il browser non ha potuto avviare l’elaborazione: ${esc(String(err))}</p>`);
    return;
  }
  setRunning(true);
  showProgress({ type: 'progress', phase: 'read', done: 0, total: 0 });
  announce('Elaborazione avviata.');
  const finish = (): void => {
    worker.terminate();
    setRunning(false);
  };
  worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
    const m = ev.data;
    if (m.type === 'progress') return showProgress(m);
    finish();
    if (m.type === 'done') return showResult(m.result);
    if (m.type === 'stopped') return showStop(m);
    showError(
      `<p>Qualcosa è andato storto durante l’elaborazione: ${esc(m.message)}</p>` +
        '<p>Se le cartelle scelte sono esportazioni HTML di Telegram Desktop, è un difetto dello strumento.</p>',
      m.report.slice(-5)
    );
  };
  worker.onerror = (ev) => {
    finish();
    showError(`<p>L’elaborazione si è interrotta: ${esc(ev.message || 'errore sconosciuto')}</p>`);
  };
  worker.postMessage({ type: 'run', picks, options });
});

// ---- results -------------------------------------------------------------------------

function showResult(result: RunResult): void {
  const who = result.owner ? `@${result.owner}` : 'giocatore sconosciuto';
  ui.resultInfo.textContent =
    `Esportazioni di ${who}, da ${result.folders.join(', ')}: ${result.pages} pagine, ` +
    `${result.messages} messaggi, ${result.replies} risposte del bot, in ` +
    `${(result.ms / 1000).toFixed(1)} s. Gli altri giocatori compaiono con nomi inventati.`;
  ui.report.textContent = result.report.join('\n');
  ui.start.hidden = true;
  ui.result.hidden = false;
  $('main').focus();
  announce(`Lettura completata: ${result.messages} messaggi.`);
}

ui.edit.addEventListener('click', () => {
  ui.result.hidden = true;
  ui.start.hidden = false;
  ui.pickLabel.focus();
});

// ---- start ---------------------------------------------------------------------------

if (!('webkitdirectory' in ui.folders)) {
  showError(
    '<p>Questo browser non permette di scegliere una cartella. Usa una versione recente di Chrome, Edge, Firefox o Safari.</p>'
  );
  ui.pickLabel.hidden = true;
}
fillTimeZones();
renderPicks();
