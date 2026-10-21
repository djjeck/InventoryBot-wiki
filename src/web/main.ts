/**
 * The web app's page: the list of exports (each folder picked is sent at once to the
 * worker, which reads it, keeps it and builds the wiki again), the time zone (this
 * browser's, proposed), the owner's username when a build asks for it, progress and
 * errors, then the wiki, rendered by the view (view/wiki-view.js). The worker (worker.ts,
 * run.ts) owns the storage and runs the pipeline on the browser `File` objects of the
 * picked folders; nothing is sent over the network (the built page's
 * Content-Security-Policy forbids it).
 *
 * Browser-only wiring, checked in a browser; the logic it relies on (run.ts, storage.ts,
 * the adapters) has its own tests.
 */
import { type Phase } from '#src/pipeline.ts';
import {
  type BuildOptions,
  type ExportEntry,
  type PageMessage,
  type RunResult,
  type WorkerMessage,
} from './protocol.ts';
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

/** The exports, as the worker last listed them. */
let exportList: ExportEntry[] = [];
let shown: RunResult | null = null;
/** A build is running (a phase started, its results not yet in). */
let building = false;
/** Whether the worker can keep data beyond this visit. */
let storage = true;

let worker: Worker | null = null;
try {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
} catch (err) {
  // shown once the page is set up, below
  console.error(err);
}

function send(m: PageMessage): void {
  worker?.postMessage(m);
}

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

// ---- exports ------------------------------------------------------------------------

/** What the list says of an export. */
function entryText(e: ExportEntry): string {
  if (e.status === 'queued') return 'in attesa di lettura';
  if (e.status === 'reading') return `lettura: ${e.done ?? 0} di ${e.total ?? 0} pagine`;
  if (e.status === 'stale')
    return 'letta da una versione precedente: aggiungila di nuovo perché conti';
  if (e.status === 'error') return e.message ?? 'non letta';
  const i = e.info;
  return i ? `${i.pages} pagine di chat, ${i.counts.messages} messaggi` : 'pronta';
}

function renderExports(): void {
  ui.picked.replaceChildren(
    ...exportList.map((e) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = `${e.folder} — ${entryText(e)}`;
      if (e.status === 'error' && e.details?.length) {
        const ul = document.createElement('ul');
        ul.append(
          ...e.details.map((d) => {
            const item = document.createElement('li');
            item.textContent = d;
            return item;
          })
        );
        span.append(ul);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Togli';
      remove.setAttribute('aria-label', `Togli ${e.folder}`);
      remove.addEventListener('click', () => {
        if (
          (e.status === 'ready' || e.status === 'stale') &&
          !confirm(`Togliere ${e.folder}? La wiki verrà ricreata senza.`)
        )
          return;
        send({ type: 'remove', id: e.id });
        ui.pickLabel.focus();
      });
      li.append(span, remove);
      return li;
    })
  );
  ui.pickLabel.textContent = exportList.length
    ? 'Aggiungi un’altra cartella…'
    : 'Aggiungi una cartella…';
  ui.run.disabled = !exportList.some((e) => e.status === 'ready');
  updateProgress();
}

ui.folders.addEventListener('change', () => {
  const files = [...(ui.folders.files ?? [])];
  ui.folders.value = ''; // the same folder can be picked again
  if (files.length === 0) return;
  hideError();
  hideNotice();
  send({ type: 'add', picks: [files] });
  const top = new Set(files.map((f) => (f.webkitRelativePath || f.name).split('/')[0]));
  announce(`Aggiunta la cartella ${[...top].join(', ')}: lettura in corso.`);
});

function hideNotice(): void {
  ui.pickNote.hidden = true;
  ui.pickNote.replaceChildren();
}

function showNotice(text: string, details: readonly string[]): void {
  ui.pickNote.innerHTML =
    esc(text) +
    (details.length ? `<ul>${details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '');
  ui.pickNote.hidden = false;
  announce(text);
}

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

const PHASES: Record<Phase, [label: string, percent: number]> = {
  parse: ['Lettura dei messaggi', 10],
  conversation: ['Abbinamento delle risposte ai comandi', 40],
  interpret: ['Interpretazione delle risposte del bot', 60],
  build: ['Costruzione della wiki', 85],
};

/** Shows the reading of the export being read, else the build's phase; hidden when idle. */
function updateProgress(phase?: Phase): void {
  const reading = exportList.find((e) => e.status === 'reading');
  const queued = exportList.filter((e) => e.status === 'queued').length;
  const busy = reading !== undefined || queued > 0 || building;
  ui.progress.hidden = !busy;
  ui.form.setAttribute('aria-busy', String(busy));
  if (reading) {
    const total = reading.total ?? 0;
    ui.progressBar.value = total ? Math.round((100 * (reading.done ?? 0)) / total) : 0;
    ui.progressText.textContent =
      `Lettura di ${reading.folder}: ${reading.done ?? 0} di ${total} pagine` +
      (queued ? ` (altre ${queued} in attesa)` : '');
  } else if (phase !== undefined) {
    const [label, percent] = PHASES[phase];
    ui.progressBar.value = percent;
    ui.progressText.textContent = `${label}…`;
  } else if (queued > 0) {
    ui.progressBar.value = 0;
    ui.progressText.textContent = `${queued} cartelle in attesa di lettura`;
  }
}

/** No DM with the bot and no username given: the field to fill. */
function showNoOwner(): void {
  // Asked only here: the owner is normally found in the private chat with the bot.
  ui.playerField.hidden = false;
  ui.player.setAttribute('aria-invalid', 'true');
  showStart();
  showError(
    '<p>Tra le esportazioni non c’è la chat privata con il bot, da cui ricavare il tuo nome utente. ' +
      'Scrivilo nel campo <b>Il tuo nome utente Telegram</b> e premi <b>Aggiorna la wiki</b>.</p>',
    [],
    ui.player
  );
}

// ---- pseudonyms ----------------------------------------------------------------------

/**
 * Where earlier versions of the page kept the secret salt of the pseudonyms: the worker,
 * which keeps it now, adopts it once, so the pseudonyms stay the same.
 */
const LEGACY_SALT_KEY = 'ib-salt';

function legacySalt(): string | null {
  try {
    return localStorage.getItem(LEGACY_SALT_KEY);
  } catch {
    return null; // storage unavailable: nothing kept there
  }
}

function dropLegacySalt(): void {
  try {
    localStorage.removeItem(LEGACY_SALT_KEY);
  } catch {
    // kept there; adopted again, harmlessly, next time
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

// ---- building -------------------------------------------------------------------------

/** The options of the form. */
function formOptions(): BuildOptions {
  // The field is shown only when a build has asked for it, or a username was given.
  const player = ui.playerField.hidden ? '' : ui.player.value.trim().replace(/^@/, '');
  return { timeZone: ui.timeZone.value, player: player === '' ? null : player };
}

ui.form.addEventListener('submit', (e) => {
  e.preventDefault();
  hideError();
  ui.player.removeAttribute('aria-invalid');
  send({ type: 'rebuild', options: formOptions() });
  announce('La wiki viene ricreata.');
});

function onMessage(m: WorkerMessage): void {
  if (m.type === 'state' || m.type === 'exports') {
    exportList = m.exports;
    storage = m.storage;
    if (m.type === 'state') {
      if (storage) dropLegacySalt();
      ui.playerField.hidden = m.options.player === null;
      ui.player.value = m.options.player ?? '';
      fillTimeZones(m.options.timeZone);
    }
    return renderExports();
  }
  if (m.type === 'read') {
    const e = exportList.find((x) => x.id === m.id);
    if (e) Object.assign(e, { status: 'reading', done: m.done, total: m.total });
    return renderExports();
  }
  if (m.type === 'phase') {
    building = true;
    return updateProgress(m.phase);
  }
  if (m.type === 'notice') return showNotice(m.text, m.details);
  building = false;
  updateProgress();
  const o = m.outcome;
  if (o.status === 'done') {
    // The wiki is updated whenever a build ends; the view moves to it once it is current,
    // or at once for the wiki kept from an earlier visit.
    showResult(o.result, m.current || o.savedAt !== undefined);
    if (o.savedAt !== undefined)
      ui.storageNote.textContent = `Wiki salvata in questo browser il ${fmtDate(o.savedAt)}.`;
    else updateStorageNote();
    if (m.current)
      announce(
        `Wiki pronta: ${Object.keys(o.result.wiki.recipes).length} ricette, ${Object.keys(o.result.wiki.items).length} oggetti.`
      );
  } else if (o.status === 'empty') {
    shown = null;
    ui.wiki.replaceChildren();
    ui.report.textContent = '';
    showStart();
    if (!storage) updateStorageNote();
  } else if (o.status === 'no-owner') {
    showNoOwner();
  } else {
    showError(
      `<p>Qualcosa è andato storto durante l’elaborazione: ${esc(o.message)}</p>` +
        '<p>Se le cartelle scelte sono esportazioni HTML di Telegram Desktop, è un difetto dello strumento.</p>',
      o.report.slice(-5)
    );
  }
}

// ---- results -------------------------------------------------------------------------

function showStart(): void {
  ui.result.hidden = true;
  ui.start.hidden = false;
  ui.back.hidden = shown === null;
}

function showResult(result: RunResult, focus: boolean): void {
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
  if (!focus) return;
  ui.start.hidden = true;
  ui.result.hidden = false;
  ui.back.hidden = false;
  $('main').focus();
}

ui.edit.addEventListener('click', () => {
  showStart();
  ui.pickLabel.focus();
});

ui.back.addEventListener('click', () => {
  if (shown) showResult(shown, true);
});

ui.clear.addEventListener('click', () => {
  if (
    !confirm(
      'Cancellare le esportazioni e la wiki salvate in questo browser? Le esportazioni sul disco non vengono toccate.'
    )
  )
    return;
  send({ type: 'clear' });
  try {
    localStorage.removeItem('ib-tab'); // the view's remembered tab
  } catch {
    // storage unavailable: nothing was saved there
  }
  dropLegacySalt();
  shown = null;
  ui.wiki.replaceChildren();
  ui.report.textContent = '';
  ui.player.value = '';
  ui.playerField.hidden = true;
  fillTimeZones();
  showStart();
  hideError();
  hideNotice();
  announce('Dati cancellati da questo browser.');
  ui.storageNote.textContent = 'I tuoi dati sono stati cancellati da questo browser.';
  ui.pickLabel.focus();
});

function updateStorageNote(): void {
  ui.storageNote.textContent = storage
    ? 'Le esportazioni lette (non le chat intere) e la wiki restano solo in questo browser: alla prossima visita le ritrovi. «Cancella i miei dati» le elimina.'
    : 'Questo browser non permette di salvare dati: alla prossima visita le cartelle andranno aggiunte di nuovo.';
}

// ---- start ---------------------------------------------------------------------------

fillTimeZones();
renderExports();
if (!('webkitdirectory' in ui.folders)) {
  showError(
    '<p>Questo browser non permette di scegliere una cartella. Usa una versione recente di Chrome, Edge, Firefox o Safari.</p>'
  );
  ui.pickLabel.hidden = true;
} else if (worker === null) {
  showError('<p>Il browser non ha potuto avviare l’elaborazione.</p>');
  ui.pickLabel.hidden = true;
} else {
  worker.onmessage = (ev: MessageEvent<WorkerMessage>) => onMessage(ev.data);
  worker.onerror = (ev) => {
    showError(`<p>L’elaborazione si è interrotta: ${esc(ev.message || 'errore sconosciuto')}</p>`);
  };
  const salt = legacySalt();
  send({
    type: 'state',
    options: { timeZone: browserTimeZone(), player: null },
    ...(salt ? { salt } : {}),
  });
}
