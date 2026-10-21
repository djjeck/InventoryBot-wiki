/**
 * The web app's page: folder picking, the time zone (this browser's, proposed), the owner's
 * username when the run asks for it, progress and errors, then the wiki, rendered by the
 * view (view/wiki-view.js). The pipeline runs in a Web Worker (worker.ts), on the browser
 * `File` objects of the picked folders; nothing is sent over the network (the built page's
 * Content-Security-Policy forbids it). The results and the secret salt of the pseudonyms
 * are kept in IndexedDB (storage.ts; pseudonymSalt).
 *
 * Browser-only wiring, checked in a browser; the logic it relies on (run.ts, storage.ts,
 * the adapters) has its own tests.
 */
import { type FileLike } from '#src/telegram/export/browser-files.ts';
import {
  type ProgressMessage,
  type RunOptions,
  type RunResult,
  type StoppedMessage,
  type WorkerMessage,
} from './protocol.ts';
import { type DatabaseFactory, openStore } from './storage.ts';
import './view/wiki-view.css';
import './view/wiki-view.js';
import './app.css';

declare global {
  interface Window {
    /** Defined by view/wiki-view.js. */
    renderWiki(root: HTMLElement, wiki: unknown, player: unknown, missing?: string): void;
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const ui = {
  start: $('start'),
  result: $('result'),
  folders: $<HTMLInputElement>('folders'),
  pickLabel: $<HTMLLabelElement>('pick-label'),
  clearPicks: $<HTMLButtonElement>('clear-picks'),
  picked: $<HTMLUListElement>('picked'),
  pickNote: $('pick-note'),
  form: $<HTMLFormElement>('options'),
  playerField: $('player-field'),
  player: $<HTMLInputElement>('player'),
  timeZone: $<HTMLSelectElement>('time-zone'),
  run: $<HTMLButtonElement>('run'),
  back: $<HTMLButtonElement>('back'),
  progress: $('progress'),
  progressBar: $<HTMLProgressElement>('progress-bar'),
  progressText: $('progress-text'),
  error: $('error'),
  storageNote: $('storage-note'),
  resultInfo: $('result-info'),
  edit: $<HTMLButtonElement>('edit'),
  clear: $<HTMLButtonElement>('clear'),
  wiki: $('wiki'),
  report: $('report'),
  announce: $('announce'),
};

const store = openStore(
  (() => {
    try {
      return (globalThis as { indexedDB?: DatabaseFactory }).indexedDB;
    } catch {
      return undefined; // reading indexedDB itself can throw where storage is blocked
    }
  })()
);

/** The folders picked in this visit (kept in memory only, never saved). */
const picks: FileLike[][] = [];
let shown: RunResult | null = null;
let running = false;

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );

const fmtDate = (d: string | Date): string =>
  new Date(d).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });

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
  if (picks.length > 0) ui.pickNote.hidden = true;
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

const PHASES: Record<ProgressMessage['phase'], [label: string, percent: number]> = {
  read: ['Lettura delle pagine', 0],
  parse: ['Lettura dei messaggi', 55],
  conversation: ['Abbinamento delle risposte ai comandi', 70],
  interpret: ['Interpretazione delle risposte del bot', 80],
  build: ['Costruzione della wiki', 92],
};

function showProgress(m: ProgressMessage): void {
  const [label, percent] = PHASES[m.phase];
  if (m.phase === 'read' && m.total) {
    ui.progressBar.value = Math.round((50 * (m.done ?? 0)) / m.total);
    ui.progressText.textContent = `${label}: ${m.done ?? 0} di ${m.total}`;
  } else {
    ui.progressBar.value = percent;
    ui.progressText.textContent = `${label}…`;
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
        '<b>Crea la wiki</b>.</p>',
      warnings,
      ui.player
    );
  }
}

// ---- pseudonyms ----------------------------------------------------------------------

/** Where earlier versions of the page kept the salt. */
const LEGACY_SALT_KEY = 'ib-salt';

/**
 * The secret salt of the pseudonyms: random, made once and kept in this browser by the
 * store, so the same players keep the same pseudonyms from run to run. Where storage is
 * blocked, one for this visit. A salt an earlier version kept in localStorage is adopted
 * once, so the pseudonyms stay the same.
 */
async function pseudonymSalt(): Promise<string> {
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_SALT_KEY);
  } catch {
    // storage unavailable: nothing kept there
  }
  const salt = await store.salt(legacy || undefined);
  if (legacy && store.available)
    try {
      localStorage.removeItem(LEGACY_SALT_KEY);
    } catch {
      // kept there; adopted again, harmlessly, next time
    }
  return salt;
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

/** Fills the picker with the world's time zones, `selected` (else the browser's) chosen. */
function fillTimeZones(selected?: string): void {
  const proposed = selected ?? browserTimeZone();
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

ui.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (running || picks.length === 0) return;
  const salt = await pseudonymSalt();
  if (running) return; // a second submit while the salt was read
  hideError();
  ui.player.removeAttribute('aria-invalid');
  // The field is shown only when a run has asked for it.
  const player = ui.playerField.hidden ? '' : ui.player.value.trim().replace(/^@/, '');
  const options: RunOptions = {
    timeZone: ui.timeZone.value,
    player: player === '' ? null : player,
    salt,
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
    if (m.type === 'done') return void onResult(m.result, salt);
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

async function onResult(result: RunResult, salt: string): Promise<void> {
  showResult(result);
  // No records are kept yet: the results are saved as built from none.
  const saved = await store.saveResults(result, { sources: [], salt });
  updateStorageNote(saved);
  announce(
    `Wiki pronta: ${Object.keys(result.wiki.recipes).length} ricette, ${Object.keys(result.wiki.items).length} oggetti.`
  );
}

function showResult(result: RunResult): void {
  shown = result;
  // A new element for each render: the view keeps its listeners on its root.
  const root = document.createElement('div');
  ui.wiki.replaceChildren(root);
  window.renderWiki(root, result.wiki, result.player);
  const who = result.owner ? `@${result.owner}` : 'giocatore sconosciuto';
  ui.resultInfo.textContent =
    `Wiki di ${who}, da ${result.folders.join(', ')} (${result.pages} pagine), ` +
    `creata il ${fmtDate(result.wiki.generated)}; altri giocatori con pseudonimi.`;
  ui.report.textContent = result.report.join('\n');
  // A username the player gave stays in its field for the next run; otherwise the field
  // stays hidden and the DM decides again.
  ui.playerField.hidden = result.options.player === null;
  ui.player.value = result.options.player ?? '';
  fillTimeZones(result.options.timeZone);
  ui.start.hidden = true;
  ui.result.hidden = false;
  ui.back.hidden = false;
  $('main').focus();
}

ui.edit.addEventListener('click', () => {
  ui.result.hidden = true;
  ui.start.hidden = false;
  ui.back.hidden = shown === null;
  // After a new visit the folders are gone: the browser does not keep them.
  ui.pickNote.hidden = picks.length > 0;
  ui.pickLabel.focus();
});

ui.back.addEventListener('click', () => {
  if (shown) showResult(shown);
});

ui.clear.addEventListener('click', async () => {
  if (
    !confirm(
      'Cancellare la wiki salvata in questo browser? Le esportazioni sul disco non vengono toccate.'
    )
  )
    return;
  await store.clear();
  try {
    localStorage.removeItem('ib-tab'); // the view's remembered tab
    localStorage.removeItem(LEGACY_SALT_KEY); // an earlier version's salt, if still there
  } catch {
    // storage unavailable: nothing was saved there
  }
  shown = null;
  picks.length = 0;
  renderPicks();
  ui.wiki.replaceChildren();
  ui.report.textContent = '';
  ui.player.value = '';
  ui.playerField.hidden = true;
  fillTimeZones();
  ui.result.hidden = true;
  ui.start.hidden = false;
  ui.back.hidden = true;
  hideError();
  announce('Dati cancellati da questo browser.');
  ui.storageNote.textContent = 'I tuoi dati sono stati cancellati da questo browser.';
  ui.pickLabel.focus();
});

function updateStorageNote(saved: boolean): void {
  ui.storageNote.textContent = saved
    ? 'La wiki è salvata solo in questo browser (non le chat): alla prossima visita la ritrovi. «Cancella i miei dati» la elimina.'
    : 'Questo browser non permette di salvare dati: alla prossima visita la wiki andrà creata di nuovo.';
}

// ---- start ---------------------------------------------------------------------------

if (!('webkitdirectory' in ui.folders)) {
  showError(
    '<p>Questo browser non permette di scegliere una cartella. Usa una versione recente di Chrome, Edge, Firefox o Safari.</p>'
  );
  ui.pickLabel.hidden = true;
}
fillTimeZones();
renderPicks();
// The salt first, so that one an earlier version kept is adopted before anything is stored.
void pseudonymSalt()
  .then(() => store.loadResults())
  .then((loaded) => {
    const saved = loaded?.saved;
    if (saved) {
      showResult(saved.result);
      ui.storageNote.textContent = `Wiki salvata in questo browser il ${fmtDate(saved.savedAt)}.`;
    } else if (!store.available) {
      updateStorageNote(false);
    }
  });
