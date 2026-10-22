/**
 * The web app's page: the wiki, the only view, under a header whose "Esportazioni"
 * button opens a modal panel below it with the list of exports (each removed by its bin button),
 * "Aggiungi esportazione", which opens the folder picker, the options and "Cancella i
 * miei dati"; the panel closes on Escape or on a click outside it. Each folder
 * picked is sent at once to the worker, which reads it, keeps it and builds the wiki
 * again; a change of the options (the time zone, the username once a build asked for it)
 * builds again too. The saved wiki shows at once, and each build's wiki replaces it in
 * place, without moving the focus; reading and building show in the header. The worker
 * (worker.ts, run.ts) owns the storage and runs the pipeline on the browser `File`
 * objects of the picked folders; nothing is sent over the network (the built page's
 * Content-Security-Policy forbids it).
 *
 * Browser-only wiring, checked in a browser; the logic it relies on (run.ts, storage.ts,
 * labels.ts, debounce.ts, the adapters) has its own tests.
 */
import { type Phase } from '#src/pipeline.ts';
import { debounce } from './debounce.ts';
import { activityText, entryLabel } from './labels.ts';
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
  main: $('main'),
  activity: $('activity'),
  activityText: $('activity-text'),
  folders: $<HTMLInputElement>('folders'),
  add: $<HTMLButtonElement>('add'),
  toggle: $<HTMLButtonElement>('panel-toggle'),
  count: $('export-count'),
  panel: $<HTMLDialogElement>('panel'),
  panelClose: $<HTMLButtonElement>('panel-close'),
  exports: $<HTMLUListElement>('exports'),
  exportsNone: $('exports-none'),
  form: $<HTMLFormElement>('options'),
  playerField: $('player-field'),
  player: $<HTMLInputElement>('player'),
  timeZone: $<HTMLSelectElement>('time-zone'),
  storageNote: $('storage-note'),
  clear: $<HTMLButtonElement>('clear'),
  notice: $('notice'),
  noticeText: $('notice-text'),
  error: $('error'),
  errorText: $('error-text'),
  empty: $('empty'),
  wiki: $('wiki'),
  resultInfo: $('result-info'),
  reportBox: $('report-box'),
  report: $('report'),
  announce: $('announce'),
};

/** The exports, as the worker last listed them. */
let exportList: ExportEntry[] = [];
/** The ids of the exports whose error was shown already. */
const errorsShown = new Set<string>();
/** The build's phase while one runs, else null. */
let phase: Phase | null = null;
/** Whether the worker can keep data beyond this visit. */
let storage = true;
/** The options last sent to the worker (or received from it). */
let sent: BuildOptions | null = null;

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

const listHtml = (details: readonly string[]): string =>
  details.length ? `<ul>${details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '';

// ---- notices and errors --------------------------------------------------------------

function hideNotice(): void {
  ui.notice.hidden = true;
  ui.noticeText.replaceChildren();
}

function showNotice(text: string, details: readonly string[]): void {
  ui.noticeText.innerHTML = `<p>${esc(text)}</p>${listHtml(details)}`;
  ui.notice.hidden = false;
}

function hideError(): void {
  ui.error.hidden = true;
  ui.errorText.replaceChildren();
}

/** Shows an error (its role=alert announces it); the focus moves only to `focus`, if given. */
function showError(html: string, details: readonly string[] = [], focus?: HTMLElement): void {
  ui.errorText.innerHTML = html + listHtml(details);
  ui.error.hidden = false;
  focus?.focus();
}

$('notice-close').addEventListener('click', () => {
  hideNotice();
  ui.toggle.focus();
});
$('error-close').addEventListener('click', () => {
  hideError();
  ui.toggle.focus();
});

// ---- the panel -----------------------------------------------------------------------

// A modal dialog: the page behind it is inert, Escape closes it, and so does a click on
// the backdrop (outside the panel's box, where the dialog itself is the target). It is
// drawn below the button that opens it, following it as the page scrolls or resizes.

function placePanel(): void {
  const r = ui.toggle.getBoundingClientRect();
  ui.panel.style.setProperty('--panel-top', `${Math.max(8, r.bottom + 8)}px`);
  ui.panel.style.setProperty(
    '--panel-right',
    `${Math.max(16, document.documentElement.clientWidth - r.right)}px`
  );
}

function openPanel(): void {
  if (ui.panel.open) return;
  placePanel();
  ui.panel.showModal();
  ui.panel.focus();
  ui.toggle.setAttribute('aria-expanded', 'true');
  window.addEventListener('scroll', placePanel, { passive: true });
  window.addEventListener('resize', placePanel);
}

function closePanel(): void {
  if (ui.panel.open) ui.panel.close();
}

ui.panel.addEventListener('close', () => {
  window.removeEventListener('scroll', placePanel);
  window.removeEventListener('resize', placePanel);
  ui.toggle.setAttribute('aria-expanded', 'false');
  ui.toggle.focus();
});
ui.toggle.addEventListener('click', openPanel);
ui.panelClose.addEventListener('click', closePanel);
// Both ends of the click on the backdrop, so that selecting text in the panel and
// releasing outside it does not close it.
let pressedOutside = false;
ui.panel.addEventListener('pointerdown', (e) => (pressedOutside = e.target === ui.panel));
ui.panel.addEventListener('click', (e) => {
  if (pressedOutside && e.target === ui.panel) closePanel();
  pressedOutside = false;
});

// ---- exports --------------------------------------------------------------------------

const BIN_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/></svg>';

function renderExports(): void {
  ui.exports.replaceChildren(
    ...exportList.map((e) => {
      const l = entryLabel(e);
      const li = document.createElement('li');
      li.className = `export s-${e.status}`;
      const text = document.createElement('div');
      text.className = 'export-text';
      const name = document.createElement('span');
      name.className = 'export-name';
      name.textContent = l.name;
      if (l.name !== e.folder) name.title = e.folder;
      const meta = document.createElement('span');
      meta.className = 'export-meta';
      const status = document.createElement('span');
      status.className = 'export-status';
      status.textContent = l.status;
      if (l.days !== null) meta.append(`${l.days} · `);
      meta.append(status);
      text.append(name, meta);
      if (l.detail !== null) {
        const detail = document.createElement('span');
        detail.className = 'export-detail';
        detail.textContent = l.detail;
        if (e.details?.length) {
          const ul = document.createElement('ul');
          ul.append(
            ...e.details.map((d) => {
              const item = document.createElement('li');
              item.textContent = d;
              return item;
            })
          );
          detail.append(ul);
        }
        text.append(detail);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn export-remove';
      remove.innerHTML = BIN_ICON;
      const what = l.days === null ? l.name : `${l.name} (${l.days})`;
      remove.setAttribute('aria-label', `Togli ${what}`);
      remove.title = 'Togli';
      remove.addEventListener('click', () => {
        if (
          (e.status === 'ready' || e.status === 'stale') &&
          !confirm(`Togliere l’esportazione ${what}? La wiki verrà ricreata senza.`)
        )
          return;
        send({ type: 'remove', id: e.id });
        ui.panel.focus();
      });
      li.append(text, remove);
      return li;
    })
  );
  ui.exportsNone.hidden = exportList.length > 0;
  ui.count.textContent = exportList.length ? ` (${exportList.length})` : '';
  // An export that cannot be read is told once, also with the panel closed.
  for (const e of exportList)
    if (e.status === 'error' && !errorsShown.has(e.id)) {
      errorsShown.add(e.id);
      showError(
        `<p>${esc(e.message ?? `Non è stato possibile leggere ${e.folder}.`)}</p>`,
        e.details
      );
    }
  updateActivity();
}

ui.add.addEventListener('click', () => ui.folders.click());

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

/** The header's progress line, hidden when idle. */
function updateActivity(): void {
  const text = activityText(exportList, phase);
  ui.activity.hidden = text === null;
  ui.activityText.textContent = text ?? '';
  ui.main.setAttribute('aria-busy', String(text !== null));
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

// ---- options -------------------------------------------------------------------------

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

/** The options of the panel. */
function formOptions(): BuildOptions {
  // The field is shown only when a build has asked for it, or a username was given.
  const player = ui.playerField.hidden ? '' : ui.player.value.trim().replace(/^@/, '');
  return { timeZone: ui.timeZone.value, player: player === '' ? null : player };
}

/** Sends the panel's options, if they changed: the worker builds with them. */
function sendOptions(): void {
  const options = formOptions();
  if (sent !== null && sent.timeZone === options.timeZone && sent.player === options.player) return;
  sent = options;
  hideError();
  ui.player.removeAttribute('aria-invalid');
  send({ type: 'options', options });
  announce('La wiki viene ricreata con le nuove opzioni.');
}

/** The username: built with once the player stops typing. */
const typed = debounce(sendOptions, 600);
ui.player.addEventListener('input', () => typed.call());
ui.timeZone.addEventListener('change', () => {
  typed.flush();
  sendOptions();
});
ui.form.addEventListener('submit', (e) => {
  e.preventDefault();
  typed.cancel();
  sendOptions();
});

// ---- results -------------------------------------------------------------------------

/** No DM with the bot and no username given: the field to fill. */
function showNoOwner(): void {
  // Asked only here: the owner is normally found in the private chat with the bot.
  ui.playerField.hidden = false;
  ui.player.setAttribute('aria-invalid', 'true');
  openPanel();
  showError(
    '<p>Tra le esportazioni non c’è la chat privata con il bot, da cui ricavare il tuo nome utente. ' +
      'Scrivilo nel campo <b>Il tuo nome utente Telegram</b>, nel pannello delle esportazioni: ' +
      'la wiki si crea appena smetti di scrivere.</p>',
    [],
    ui.player
  );
}

function showEmpty(): void {
  ui.wiki.replaceChildren();
  ui.empty.hidden = false;
  ui.resultInfo.textContent = '';
  ui.report.textContent = '';
  ui.reportBox.hidden = true;
}

/** Renders a wiki in place of the one shown, keeping the search and its focus. */
function showResult(result: RunResult): void {
  const old = ui.wiki.querySelector<HTMLInputElement>('#q');
  const query = old?.value ?? '';
  const active = document.activeElement;
  const hadFocus = active !== null && ui.wiki.contains(active);
  const inSearch = active === old && old !== null;
  // A new element for each render: the view keeps its listeners on its root.
  const root = document.createElement('div');
  ui.wiki.replaceChildren(root);
  window.renderWiki(root, result.wiki, result.player);
  const q = root.querySelector<HTMLInputElement>('#q');
  if (q !== null && query !== '') {
    q.value = query;
    q.dispatchEvent(new Event('input'));
  }
  if (inSearch) q?.focus({ preventScroll: true });
  else if (hadFocus) ui.main.focus({ preventScroll: true });
  ui.empty.hidden = true;
  const who = result.owner ? `@${result.owner}` : 'giocatore sconosciuto';
  ui.resultInfo.textContent =
    `Wiki di ${who}, da ${result.folders.length === 1 ? 'un’esportazione' : `${result.folders.length} esportazioni`} ` +
    `(${result.pages} ${result.pages === 1 ? 'pagina' : 'pagine'}), creata il ${fmtDate(result.wiki.generated)}; gli altri giocatori hanno uno pseudonimo.`;
  ui.report.textContent = result.report.join('\n');
  ui.reportBox.hidden = false;
}

function updateStorageNote(savedAt?: string): void {
  ui.storageNote.textContent = !storage
    ? 'Questo browser non permette di salvare dati: alla prossima visita le cartelle andranno aggiunte di nuovo.'
    : (savedAt === undefined ? '' : `Wiki salvata in questo browser il ${fmtDate(savedAt)}. `) +
      'Le esportazioni lette (non le chat intere) e la wiki restano solo in questo browser: alla prossima visita le ritrovi. «Cancella i miei dati» le elimina.';
}

function onMessage(m: WorkerMessage): void {
  if (m.type === 'state' || m.type === 'exports') {
    exportList = m.exports;
    storage = m.storage;
    if (m.type === 'state') {
      if (storage) dropLegacySalt();
      typed.cancel();
      ui.playerField.hidden = m.options.player === null;
      ui.player.value = m.options.player ?? '';
      fillTimeZones(m.options.timeZone);
      sent = m.options;
      updateStorageNote();
    }
    return renderExports();
  }
  if (m.type === 'read') {
    const e = exportList.find((x) => x.id === m.id);
    if (e) Object.assign(e, { status: 'reading', done: m.done, total: m.total });
    return renderExports();
  }
  if (m.type === 'phase') {
    phase = m.phase;
    return updateActivity();
  }
  if (m.type === 'notice') {
    showNotice(m.text, m.details);
    return announce(m.text);
  }
  phase = null;
  updateActivity();
  const o = m.outcome;
  if (o.status === 'done') {
    showResult(o.result);
    updateStorageNote(o.savedAt);
    if (m.current && o.savedAt === undefined)
      announce(
        `Wiki aggiornata: ${Object.keys(o.result.wiki.recipes).length} ricette, ${Object.keys(o.result.wiki.items).length} oggetti.`
      );
  } else if (o.status === 'empty') {
    showEmpty();
  } else if (!m.current) {
    // a newer build follows
  } else if (o.status === 'no-owner') {
    showEmpty();
    showNoOwner();
  } else {
    showError(
      `<p>Qualcosa è andato storto durante l’elaborazione: ${esc(o.message)}</p>` +
        '<p>Se le cartelle scelte sono esportazioni HTML di Telegram Desktop, è un difetto dello strumento.</p>',
      o.report.slice(-5)
    );
  }
}

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
  typed.cancel();
  errorsShown.clear();
  showEmpty();
  hideError();
  hideNotice();
  closePanel();
  announce('Dati cancellati da questo browser.');
});

// ---- start ---------------------------------------------------------------------------

fillTimeZones();
renderExports();
if (!('webkitdirectory' in ui.folders)) {
  showError(
    '<p>Questo browser non permette di scegliere una cartella. Usa una versione recente di Chrome, Edge, Firefox o Safari.</p>'
  );
  ui.add.disabled = true;
} else if (worker === null) {
  showError('<p>Il browser non ha potuto avviare l’elaborazione.</p>');
  ui.add.disabled = true;
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
