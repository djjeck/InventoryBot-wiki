/* global window, document, localStorage, location, history, matchMedia, URLSearchParams, getComputedStyle */
import { ENDINGS, PAKKOMON, WOUNDS } from '#src/inventorybot/pakkomon.ts';
import { layoutMap, placeLabels } from '#src/web/map-layout.ts';

/**
 * The wiki view: renders a wiki and, optionally, the owner's player state into an
 * element, below the page's own header (title and actions). As in Telegram's chat list,
 * the categories are tabs of a sidebar fixed to the side of the window, whose list
 * scrolls on its own; the selected entry is in the page, which scrolls as a whole. The
 * web app's page (src/web/main.ts) imports it. The tab and the selected entry are in the
 * URL's fragment (`#oggetti/<slug>`): each change of them is a step of the browser's
 * history, and a reload or a new render keeps them. It defines
 * `window.renderWiki(root, wiki, player, missing)`: `root` gets the whole view, its
 * listeners stay on `root`, so a new render goes in a new element.
 */
(() => {
  /** The history listener of the latest render: a new render replaces it. */
  let onHistory = null;
  /** The resize listener of the latest render, likewise. */
  let onResize = null;
  const MARKUP = `<aside class="sidebar" aria-label="Elenco">
  <div class="side-search">
    <input
      id="q"
      type="search"
      placeholder="Cerca per nome…"
      autocomplete="off"
      aria-label="Cerca"
    />
  </div>
  <div class="tabs" role="tablist" id="tabs">
    <button role="tab" data-tab="oggetti"><span class="tab-name">Oggetti</span><span class="badge" aria-hidden="true"></span></button>
    <button role="tab" data-tab="ricette"><span class="tab-name">Ricette</span><span class="badge" aria-hidden="true"></span></button>
    <button role="tab" data-tab="luoghi"><span class="tab-name">Luoghi</span><span class="badge" aria-hidden="true"></span></button>
    <button role="tab" data-tab="pakkomon" hidden><span class="tab-name">Pakkomon</span><span class="badge" aria-hidden="true"></span></button>
  </div>
  <div class="side-tools" id="side-tools"></div>
  <div class="list" id="list"></div>
</aside>
<div class="wrap content">
  <div id="view"></div>
  <details id="trivia" class="rules"></details>
  <footer id="foot"></footer>
</div>`;

  /**
   * @param {HTMLElement} root the element to render into (its content is replaced)
   * @param {object | null | undefined} W the wiki (wiki.json)
   * @param {object | null | undefined} player the owner's state (player.json), optional
   * @param {string} missing the message shown when there is no wiki
   */
  window.renderWiki = (root, W, player, missing = 'Dati mancanti.') => {
    if (!W) {
      root.innerHTML = `<p class="empty">${missing}</p>`;
      return;
    }
    root.innerHTML = MARKUP;
    const R = W.recipes,
      I = W.items,
      L = W.locations;
    // Personal data (player.js) is optional: without it the page is the plain game wiki.
    const P = player || null;
    const mineR = (n) => P?.recipes[n];
    const have = (n) => P?.inventory[n];
    const visited = (n) => !!P?.locations[n]?.visited;
    const VIA = {
      inventario: '/inventario',
      collezioni: '/collezioni',
      inv2: '/inv2',
      esporta: '/esporta',
      esamina: '/esamina',
      ricetta: '/ricetta',
      dai: '/dai',
      movimento: 'drop o craft',
    };
    const haveTxt = (h) => (h ? (h.exact ? String(h.qty) : '≥' + h.qty) : '0');
    const readyEst = (r) =>
      !!(
        P &&
        r.ingredients &&
        Object.entries(r.ingredients).every(([n, q]) => (have(n)?.qty || 0) >= q)
      );
    const $ = (s, el = root) => el.querySelector(s);
    const esc = (s) =>
      String(s ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
      );
    const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const fmtDate = (d) =>
      d
        ? new Date(d).toLocaleDateString('it-IT', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : '';

    // ---- derived relations -------------------------------------------------------
    const rarityGroup = (r) => (!r ? 'q' : r[0] === 'L' ? 'L' : r[0]);
    // Rarity names come from the wiki's legend (wiki.json "rarities"); "Ln" covers L1, L2, ...
    const RARITY_NAMES = {
      ...Object.fromEntries(
        Object.entries(W.rarities || {}).map(([k, v]) => [k === 'Ln' ? 'L' : k, v])
      ),
      q: 'rarità sconosciuta',
    };
    const rarityName = (g) => RARITY_NAMES[g] || `rarità ${g}, non spiegata dal bot`;
    const ingredientsOf = (r) =>
      r.ingredients ? Object.entries(r.ingredients) : r.partial_ingredients.map((n) => [n, null]);
    for (const r of Object.values(R)) {
      for (const [n] of ingredientsOf(r))
        if (I[n] && !I[n].used_in.includes(r.name)) I[n].used_in.push(r.name);
      if (r.output && I[r.output] && !I[r.output].made_by.includes(r.name))
        I[r.output].made_by.push(r.name);
    }
    const lvl = (name) => R[name]?.level ?? 0;
    const byLevelName = (a, b) => lvl(a) - lvl(b) || a.localeCompare(b, 'it');
    const upstream = (r) =>
      [...new Set(ingredientsOf(r).flatMap(([n]) => I[n]?.made_by || []))]
        .filter((x) => x !== r.name)
        .sort(byLevelName);
    const downstream = (r) =>
      r.output && I[r.output] ? [...I[r.output].used_in].sort(byLevelName) : [];
    // Crafted items (rarity Lk) whose recipe is unknown: candidate outputs for unknown level-k recipes.
    const orphanCrafted = Object.values(I).filter(
      (i) => i.rarity && i.rarity[0] === 'L' && !i.made_by.length
    );
    const candidates = (r) =>
      r.output || !r.level
        ? []
        : orphanCrafted.filter((i) => i.rarity === 'L' + r.level).map((i) => i.name);
    const contention = (r) =>
      ingredientsOf(r).filter(([n]) =>
        (I[n]?.used_in || []).some((o) => o !== r.name && lvl(o) > (r.level || 0))
      ).length;

    // Freshness: until July 2021 the game ran on a previous bot (docs/bot-protocol.md,
    // "Older formats"). A fact last confirmed only then may belong to the game's early
    // days, or to a one-off since removed, and is flagged, with the reason on hover; one
    // confirmed by the current bot is likely still there, however long ago. A fixed date:
    // the flag does not spread to the current game as time passes.
    const PREVIOUS_BOT_UNTIL = new Date('2021-08-01T00:00:00Z');
    const PREVIOUS_BOT_NOTE =
      'Visto l’ultima volta con il bot precedente, in uso fino a luglio 2021: potrebbe non esistere più.';
    const freshness = (d) =>
      !d
        ? ''
        : `aggiornato al ${fmtDate(d)}${new Date(d) < PREVIOUS_BOT_UNTIL ? ` <span class="stale" role="img" title="${PREVIOUS_BOT_NOTE}" aria-label="${PREVIOUS_BOT_NOTE}">⚠️</span>` : ''}`;

    // ---- small renderers ---------------------------------------------------------
    const tag = (rar) =>
      `<span class="tag t-${rarityGroup(rar)}" title="${esc(rarityName(rarityGroup(rar)))}">${esc(rar || '?')}</span>`;
    const lvlTag = (r) =>
      r?.level
        ? `<span class="tag t-L" title="Livello ricetta${r.level_inferred ? ' (dedotto)' : ''}">L${r.level}</span>`
        : `<span class="tag t-q">L?</span>`;
    const current = (n) => (I[n] ? n : W.renames?.[n] || n); // an old name shows as the item's current name
    const itemLink = (n) => {
      n = current(n);
      return `<span class="chip">${tag(I[n]?.rarity)} <button class="link" data-go="item" data-name="${esc(n)}">${esc(n)}</button></span>`;
    };
    const locLink = (n) =>
      `<button class="link" data-go="loc" data-name="${esc(n)}">${esc(L[n]?.label || n)}</button>`;
    const sec = (title, body) => `<div class="section"><h3>${title}</h3>${body}</div>`;
    // ---- the bot's own words ---------------------------------------------------------
    // An entry is shown first as the bot's reply to the command that describes it, in a
    // Telegram bubble, worded for any player ("serve", not "ti serve"), with links; what
    // the bot does not say follows it.
    const bubble = (lines) =>
      `<div class="bubble">${lines.map((l) => `<div class="b-line${l.startsWith('- ') ? ' b-item' : ''}">${l}</div>`).join('')}</div>`;
    /** A plain link, as a name inside a bot's reply. */
    // A real link to the entry's address, so that it wraps as text does and opens in a
    // new tab like any link; a plain click shows the entry in place (see `go`).
    const goLink = (kind, n, text = n) => {
      const tab = { item: 'oggetti', recipe: 'ricette', loc: 'luoghi', pakkomon: 'pakkomon' }[kind];
      return `<a class="link" href="${hashOf(tab, n)}" data-go="${kind}" data-name="${esc(n)}">${esc(text)}</a>`;
    };
    /** An item as the bot writes it: its name, then `[R]` and `[usabile]`. */
    const rarityRef = (i, cls = '') =>
      `<span class="t-${rarityGroup(i?.rarity)}${cls}" title="${esc(rarityName(rarityGroup(i?.rarity)))}">[${esc(i?.rarity || '?')}]</span>`;
    /**
     * An item as the bot writes it in a list: its name, then `[R]` and `[usabile]`; with
     * `added`, these are ours, where the bot names the item without them.
     */
    const itemRef = (n, added = false) => {
      n = current(n);
      const i = I[n];
      const meta = `${rarityRef(i)}${i?.usable ? ' [usabile]' : ''}`;
      return `${goLink('item', n)} ${added ? `<span class="added">${meta}</span>` : meta}`;
    };
    /**
     * A recipe with its level (if known) in brackets, as an item's rarity in the bot's
     * text, coloured as the Ln rarity, which is that of the items a level-n recipe makes.
     */
    const recipeRef = (n, quoted = false) => {
      const link = goLink('recipe', n);
      const level = R[n]?.level;
      return `${quoted ? `"${link}"` : link}${level ? ` <span class="added"><span class="t-L" title="Livello ricetta">[L${level}]</span></span>` : ''}`;
    };
    // The items a reply of the bot names, as links with their rarity: the longest names
    // first, each a whole phrase (not inside a word).
    const itemNames = Object.keys(I).sort((a, b) => b.length - a.length);
    const itemPattern = itemNames.length
      ? new RegExp(
          `(?<![\\p{L}'’])(${itemNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')})(?!\\p{L})(?:(\\s*)\\[([A-Z][0-9]*\\+?)\\])?`,
          'gu'
        )
      : null;
    /** A text of the bot, escaped, with the items it names linked. */
    const linkItems = (text) => {
      if (!itemPattern) return esc(text);
      let out = '',
        at = 0;
      for (const m of text.matchAll(itemPattern)) {
        out += esc(text.slice(at, m.index));
        // The bot's own "[R]" after the name stays, as it was then; else ours is added.
        out += m[3]
          ? `${goLink('item', m[1])}${esc(m[2])}${rarityRef({ rarity: m[3] })}`
          : `${goLink('item', m[1])} <span class="added">${rarityRef(I[m[1]])}</span>`;
        at = m.index + m[0].length;
      }
      return out + esc(text.slice(at));
    };
    /** "a, b e c". */
    const listIt = (xs) =>
      xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}`;
    /**
     * The last line of an entry: its sources (the channel cards behind it, with what of
     * them the page still shows, `what`: field -> its name; and the bot, unless the cards
     * are all), how many observations name it, and when it was last confirmed. `also`:
     * the entry's recipes, shown on its page ({ x, card, what, of: "della ricetta X" }).
     */
    const sourcesLine = (x, card, what = {}, also = []) => {
      const all = [{ x, card, what }, ...also];
      const channels = all
        .filter((a) => a.card)
        .map((a) => {
          const given = a.card.fields.map((f) => a.what[f]).filter(Boolean);
          return `${esc(a.card.name)}${a.card.date ? ` del ${fmtDate(a.card.date)}` : ''}${given.length ? ` (${listIt(given)})` : ''}`;
        });
      const bot = all.some((a) => !a.card || a.x.observations > 1) ? ['InventoryBot'] : [];
      const n = x.observations;
      const counts = [
        n ? `${n} ${n === 1 ? 'osservazione' : 'osservazioni'}` : '',
        ...also.map((a) => (a.x.observations ? `${a.x.observations} ${a.of}` : '')),
      ].filter(Boolean);
      const last = all
        .map((a) => a.x.last_seen)
        .filter(Boolean)
        .sort((p, q) => new Date(q) - new Date(p))[0];
      return `<p class="sources">Fonti: ${[[...channels, ...bot].join(', '), counts.join(', '), freshness(last)].filter(Boolean).join(' · ')}</p>`;
    };
    /** What else is known of an entry, beyond the bot's reply: a channel card's text, trivia. */
    const moreInfo = (...parts) => {
      const body = parts.filter(Boolean).join('');
      return body ? sec('Altre informazioni', body) : '';
    };
    const notesOf = (card) =>
      (card?.notes || []).map((n) => `<p class="note">${esc(n)}</p>`).join('');
    const chips = (xs, f) =>
      xs.length
        ? `<div class="chips">${xs.map(f).join('')}</div>`
        : `<p class="empty">Nessuna osservata.</p>`;

    // ---- state -------------------------------------------------------------------
    const state = {
      tab: 'oggetti',
      sel: { ricette: null, oggetti: null, luoghi: null, pakkomon: null },
      filter: { ricette: 'tutte', oggetti: 'tutti', pakkomon: 'tuoi' },
      // What a recipe's tree shows: what the owner still lacks, or all of it.
      tree: null,
    };
    const store = {
      get(k) {
        try {
          return localStorage.getItem(k);
        } catch {
          return null;
        }
      },
      set(k, v) {
        try {
          localStorage.setItem(k, v);
        } catch {
          // storage unavailable (private window, blocked site data): the tab is not remembered
        }
      },
    };
    state.tree = store.get('ib-tree') === 'tutto' ? 'tutto' : 'mancanti';
    // ---- the owner's Pakkomon -------------------------------------------------------
    // Each Pakkomon is the owner's own (player-pakkomon.ts), never the wiki's: the tab lists
    // theirs, after a page on how Pakkomon work. Pakkomon come late in the game: the tab
    // shows only while the owner has one.
    const GUIDE = 'Come funzionano';
    const MY_PK = P?.pakkomon || [];
    const PK = Object.fromEntries(MY_PK.map((p) => [p.name, p]));
    const pakkomonTab = MY_PK.some((p) => !p.gone);
    const TABS = ['oggetti', 'ricette', 'luoghi', ...(pakkomonTab ? ['pakkomon'] : [])];
    // ---- the URL -------------------------------------------------------------------
    // `#tab` or `#tab/slug`. A slug is the name folded to lower-case ASCII letters and
    // digits, with `_` in place of everything else (`l'oro` is `l_oro`); names with the
    // same slug take `_2`, `_3`, ... in the order of their names, so each is one entry.
    const ENTRIES = { ricette: R, oggetti: I, luoghi: L, pakkomon: { [GUIDE]: {}, ...PK } };
    const slugify = (s) =>
      fold(s)
        .replace(/[^a-z0-9]+/gu, '_')
        .replace(/^_+|_+$/gu, '') || '_';
    function slugTable(names) {
      const bySlug = new Map(),
        byName = new Map();
      for (const name of [...names].sort()) {
        const base = slugify(name);
        let slug = base;
        for (let k = 2; bySlug.has(slug); k++) slug = `${base}_${k}`;
        bySlug.set(slug, name);
        byName.set(name, slug);
      }
      return { bySlug, byName };
    }
    const SLUGS = {
      ricette: slugTable(Object.keys(R)),
      oggetti: slugTable(Object.keys(I)),
      luoghi: slugTable(Object.keys(L)),
      pakkomon: slugTable(Object.keys(ENTRIES.pakkomon)),
    };
    // The old names of renamed items lead to the item, where no current name has the slug.
    for (const [old, name] of Object.entries(W.renames || {}))
      if (I[name] && !SLUGS.oggetti.bySlug.has(slugify(old)))
        SLUGS.oggetti.bySlug.set(slugify(old), name);
    // A recipe whose item is known is shown on the item's page, so its address is the
    // item's, with the list it was opened from: `#oggetti/una_torre?lista=ricette`, and
    // `&ricetta=<slug>` when several recipes make the item. `#ricette/<slug>` stays the
    // address of a recipe whose item is not known, and leads to the item's otherwise.
    /** The item a recipe makes, when the wiki has it. */
    const madeItem = (recipe) => {
      const o = R[recipe]?.output;
      const c = o ? current(o) : null;
      return c && I[c] ? c : null;
    };
    /** The tab and entry of a fragment, or null if it names no tab (e.g. `#main`). */
    function fromHash(hash) {
      const [path, query = ''] = hash.replace(/^#/u, '').split('?');
      const [tab, ...rest] = path.split('/');
      if (!TABS.includes(tab)) return null;
      // An entry the wiki no longer has (an old link, a rebuilt wiki) is not selected.
      const name = SLUGS[tab].bySlug.get(rest.join('/')) ?? null;
      const found = name !== null && ENTRIES[tab][name] ? name : null;
      const params = new URLSearchParams(query);
      const list = params.get('lista');
      if (tab === 'oggetti' && list === 'ricette') {
        const made = found ? I[found].made_by.filter((n) => R[n]) : [];
        const named = SLUGS.ricette.bySlug.get(params.get('ricetta') ?? '');
        return { tab: list, name: made.includes(named) ? named : (made[0] ?? null) };
      }
      return { tab, name: found };
    }
    /** The address of an entry of a tab (its first entry when `name` is null). */
    function hashOf(tab, name) {
      const item = tab === 'ricette' && name ? madeItem(name) : null;
      if (item) {
        const several = I[item].made_by.filter((n) => R[n]).length > 1;
        return `#oggetti/${SLUGS.oggetti.byName.get(item)}?lista=${tab}${several ? `&ricetta=${SLUGS.ricette.byName.get(name)}` : ''}`;
      }
      const slug = name ? SLUGS[tab].byName.get(name) : undefined;
      return `#${tab}${slug ? '/' + slug : ''}`;
    }
    const toHash = () => hashOf(state.tab, state.sel[state.tab]);
    /** Records the tab and entry shown as a new step of the history, if they changed. */
    function pushUrl() {
      store.set('ib-tab', state.tab);
      const hash = toHash();
      if (hash !== location.hash) history.pushState(null, '', hash);
    }
    function applyHash() {
      const at = fromHash(location.hash);
      if (!at) return false;
      state.tab = at.tab;
      // No name: the list's first entry, as when the tab was first opened.
      state.sel[at.tab] = at.name;
      return true;
    }
    // Without a fragment, the tab last used in this browser. The URL then shows what is
    // shown, also in place of a name the wiki no longer has.
    if (!applyHash())
      state.tab = TABS.includes(store.get('ib-tab')) ? store.get('ib-tab') : 'oggetti';
    history.replaceState(null, '', toHash());

    // ---- recipes -----------------------------------------------------------------
    // With the owner's state, the second filter of each list is what they can use now,
    // from the inventory estimate.
    const ESTIMATE = "Secondo la stima dell'inventario";
    const RECIPE_FILTERS = {
      tutte: ['Tutte', () => true],
      ...(P && { pronte: ['Puoi farle ora', readyEst, `${ESTIMATE}, hai tutti gli ingredienti`] }),
      ignoto: ['Output ignoto', (r) => !r.output],
      noto: ['Output noto', (r) => !!r.output],
      contese: ['Ingredienti contesi', (r) => contention(r) > 0],
      catena: ['In una catena', (r) => upstream(r).length || downstream(r).length],
    };
    function recipeRows(q) {
      const f = RECIPE_FILTERS[state.filter.ricette][1];
      return Object.values(R)
        .filter(
          (r) =>
            f(r) && (!q || fold(r.name).includes(q) || (r.output && fold(r.output).includes(q)))
        )
        .sort((a, b) => (a.level || 99) - (b.level || 99) || a.name.localeCompare(b.name, 'it'));
    }
    function recipeRow(r) {
      const n = ingredientsOf(r).length,
        c = contention(r);
      return `<button class="row" data-sel="${esc(r.name)}" aria-current="${state.sel.ricette === r.name}">
    ${lvlTag(r)}<span class="name">${esc(r.name)}</span>
    <span class="meta">${readyEst(r) ? `<span class="mine ok">pronta</span> ` : ''}${mineR(r.name) ? `fatta ×${mineR(r.name).crafted}` : ''}</span>
    <span class="sub">${r.output ? '→ ' + esc(r.output) : '→ output ignoto'} · ${!n ? 'ingredienti ignoti' : `${n} ingredient${n === 1 ? 'e' : 'i'}${r.ingredients ? '' : ' (parziali)'}`}${c ? ` · <span style="color:var(--warn)">${c} contesi</span>` : ''}</span>
  </button>`;
    }
    /**
     * A recipe's parts, for its own page (while its output is unknown) and for the page of
     * the item it makes: its bubbles, notes, tree, and the owner's lines.
     */
    function recipeParts(name) {
      const r = R[name];
      const ingredients = ingredientsOf(r);
      // An ingredient line as the bot writes it, with what else makes or needs the item.
      const ingLine = ([n, q]) => {
        const others = (I[n]?.used_in || [])
          .filter((o) => o !== name)
          .sort((a, b) => lvl(b) - lvl(a));
        const hot = others.some((o) => lvl(o) > (r.level || 0));
        const made = I[n]?.made_by || [];
        const aside = [
          made.length ? `si crea con ${made.map((m) => recipeRef(m)).join(', ')}` : '',
          others.length
            ? `<span class="${hot ? 'hot' : ''}">${hot ? 'conteso, serve anche a' : 'serve anche a'} ${others.map((o) => recipeRef(o)).join(', ')}</span>`
            : '',
        ].filter(Boolean);
        return `- ${itemRef(n)} x${q ?? '?'}${aside.length ? `<span class="aside">${aside.join(' · ')}</span>` : ''}`;
      };
      // /esamina of the recipe, for any player: everything it needs (until it is made).
      const detailBubble = ingredients.length
        ? bubble([`per fare la ricetta <b>${esc(name)}</b> serve:`, ...ingredients.map(ingLine)])
        : '';
      // Its craft, as the bot tells it: what goes in, the story, what comes out; each
      // ingredient with what else makes or needs it.
      const craftBubble =
        r.output || r.craft_text
          ? bubble([
              ...(ingredients.length ? ['prendi in mano:', ...ingredients.map(ingLine)] : []),
              ...(r.craft_text ? [esc(r.craft_text)] : []),
              ...(r.output ? [`Ottieni: ${itemRef(r.output, true)}!`] : []),
            ])
          : '';
      const ingNote = r.ingredients
        ? ''
        : ingredients.length
          ? '<p class="note">Lista parziale: ricavata da /esamina sugli oggetti, quantità ignote.</p>'
          : `<p class="note">Vista solo nell'elenco di /ricetta. Usa /esamina ${esc(name)} per vederne gli ingredienti.</p>`;
      const cand = candidates(r);
      const out = r.output
        ? ''
        : `<p class="note">L'oggetto che si ottiene compare solo dopo aver eseguito la ricetta.</p>` +
          (cand.length
            ? `<details class="cand"><summary>${cand.length} oggetti L${r.level} senza ricetta nota: possibili candidati</summary>${chips(cand, itemLink)}</details>`
            : '');
      const tree = recipeTree(name);
      const me = mineR(name);
      // As /esamina of the recipe would answer the owner: what they lack, what they have.
      const owned = ingredients.map(([n, q]) => {
        const h = have(n);
        return { n, q, own: h?.qty || 0, exact: h ? h.exact : true };
      });
      const count = (k, exact) => `x${exact ? '' : '≥'}${k}`;
      const lacking = owned
        .filter((o) => (o.q ? o.own < o.q : !o.own))
        .map((o) => `- ${itemRef(o.n)} ${o.q ? `x${o.q - o.own}` : 'x?'}`);
      const holding = owned
        .filter((o) => o.own)
        .map((o) => `- ${itemRef(o.n)} ${count(o.q ? Math.min(o.own, o.q) : o.own, o.exact)}`);
      const myLines =
        P && ingredients.length
          ? [
              `@${esc(P.player)}, per fare la ricetta <b>${esc(name)}</b> ti manca:`,
              ...lacking,
              ...(holding.length ? ["Mentre hai gia':", ...holding] : []),
            ]
          : [];
      const myNote = !P
        ? ''
        : me
          ? `${esc(name)}: eseguita ${me.crafted} ${me.crafted === 1 ? 'volta' : 'volte'}, l'ultima il ${fmtDate(me.last_crafted)}.`
          : `${esc(name)}: mai eseguita.`;
      return { r, detailBubble, craftBubble, ingNote, out, tree, myLines, myNote };
    }
    /** The fields a recipe card may give, by name. */
    const RECIPE_FIELDS = {
      level: 'il livello',
      ingredients: 'gli ingredienti',
      output: "l'oggetto ottenuto",
    };
    /** The page of a recipe: its item's, if known, else its own. */
    const recipePage = (name) => (madeItem(name) ? itemDetail(madeItem(name)) : recipeDetail(name));
    /** A recipe's own page, while the item it makes is not known. */
    function recipeDetail(name) {
      if (!R[name]) return `<p class="empty">Seleziona una ricetta dall'elenco.</p>`;
      const { r, detailBubble, craftBubble, ingNote, out, tree, myLines, myNote } =
        recipeParts(name);
      const personal = P ? myCard(myLines, [myNote]) : '';
      // The item it makes is part of the title: a recipe is the way to obtain it.
      const makes = r.output
        ? `<span class="arrow" aria-hidden="true">→</span> ${goLink('item', current(r.output))} ${tag(I[current(r.output)]?.rarity)}`
        : `<span class="arrow" aria-hidden="true">→</span> ? <span class="makes-unknown">non ancora osservato</span>`;
      return page(
        personal,
        `<div class="head"><div class="kicker">${lvlTag(r)}<span>Ricetta</span></div>
    <h2>${esc(name)}</h2>
    <p class="makes"><span class="visually-hidden">Ottieni: </span>${makes}</p>
    ${opensLines(r.output)}${usedWithLine(r.output)}</div>
    ${detailBubble}
    ${ingNote}
    ${craftBubble}
    ${out}
    ${tree}
    ${moreInfo(notesOf(r.channel))}
    ${sourcesLine(r, r.channel, RECIPE_FIELDS)}`
      );
    }

    /**
     * The owner's own state of an entry, as a card beside it (above it when narrow): what
     * the bot would reply to them, from the inventory estimate (`lines`, in its words),
     * then what it would not say (`notes`).
     */
    function myCard(lines, notes) {
      // One bubble per reply: `lines` is a reply's lines, or a list of replies.
      const replies = Array.isArray(lines[0]) ? lines : [lines];
      const body =
        replies
          .filter((r) => r.length)
          .map(bubble)
          .join('') +
        notes
          .filter(Boolean)
          .map((l) => `<p class="note">${l}</p>`)
          .join('');
      return `<aside class="my-card" aria-label="I tuoi dati">
    <div class="my-head"><span class="peer" aria-hidden="true">${esc(P.player.charAt(0).toUpperCase())}</span><div><b>@${esc(P.player)}</b><span class="my-asof">stima al ${fmtDate(P.as_of)}</span></div></div>
    ${body}</aside>`;
    }
    /** An entry's page: the owner's card, if any, and the entry. */
    const page = (card, body) =>
      `<div class="detail-grid">${card}<div class="detail-body">${body}</div></div>`;

    // ---- items -------------------------------------------------------------------
    const ITEM_FILTERS = {
      tutti: ['Tutti', () => true],
      ...(P && {
        posseduti: [
          'Posseduti',
          (i) => (have(i.name)?.qty || 0) > 0,
          `${ESTIMATE}, ne hai almeno uno`,
        ],
      }),
      ingredienti: ['Usati in ricette', (i) => i.used_in.length > 0],
      craftati: ['Craftati', (i) => i.made_by.length || (i.rarity || '')[0] === 'L'],
      esclusivi: ['Esclusivi di un luogo', (i) => i.exclusive],
      pakkomon: ['Per i Pakkomon', (i) => !!i.pakkomon_roles?.length || !!i.from_fight?.length],
      // Nor to open a place, nor with another item: a key is far from useless.
      inutili: [
        'Non usati',
        (i) => !i.used_in.length && !i.used_with?.length && !OPENS.has(i.name),
      ],
    };
    const RARITY_ORDER = ['X', 'U', 'M', 'S', 'R', 'N', 'C', 'L', 'q'];
    function itemRows(q) {
      const f = ITEM_FILTERS[state.filter.oggetti][1];
      return Object.values(I)
        .filter(
          (i) =>
            f(i) &&
            (!q ||
              fold(i.name).includes(q) ||
              (i.old_names || []).some((o) => fold(o.name).includes(q)))
        )
        .sort(
          (a, b) =>
            RARITY_ORDER.indexOf(rarityGroup(a.rarity)) -
              RARITY_ORDER.indexOf(rarityGroup(b.rarity)) ||
            (a.rarity || '').localeCompare(b.rarity || '') ||
            a.name.localeCompare(b.name, 'it')
        );
    }
    function itemRow(i) {
      const bits = [];
      if (i.old_names?.length) bits.push(`prima: ${i.old_names.map((o) => o.name).join(', ')}`);
      if (i.used_in.length)
        bits.push(`in ${i.used_in.length} ricett${i.used_in.length === 1 ? 'a' : 'e'}`);
      if (i.made_by.length) bits.push(`da ${i.made_by.join(', ')}`);
      const opens = OPENS.get(i.name);
      if (opens?.pass.length)
        bits.push(`per passare: ${opens.pass.map((w) => L[w]?.label || w).join(', ')}`);
      if (opens?.see.length)
        bits.push(`per vedere: ${opens.see.map((w) => L[w]?.label || w).join(', ')}`);
      if (i.used_with?.length) bits.push(`si usa con: ${few(i.used_with.map(current), esc)}`);
      if (i.from_use?.length) bits.push(`usando: ${few(i.from_use.map(current), esc)}`);
      if (i.rewards?.includes('level_up')) bits.push('salendo di livello');
      if (i.rewards?.includes('lottery')) bits.push('alla lotteria');
      if (i.from_fight?.length) bits.push(`battendo ${few(i.from_fight, (x) => x)}`);
      if (i.pakkomon_roles?.length)
        bits.push(`Pakkomon: ${i.pakkomon_roles.map((r) => ROLE_NAMES[r]).join(', ')}`);
      if (i.exclusive)
        bits.push(
          i.locations.length
            ? `solo ${i.locations.map((w) => L[w]?.label || w).join(', ')}`
            : 'luogo esclusivo ignoto'
        );
      return `<button class="row" data-sel="${esc(i.name)}" aria-current="${state.sel.oggetti === i.name}">
    ${tag(i.rarity)}<span class="name">${esc(i.name)}</span><span class="meta">${i.usable ? 'usabile' : ''}</span>
    <span class="sub">${esc(bits.join(' · ') || 'nessuna relazione nota')}</span></button>`;
    }
    /**
     * A shape of a use's replies (use-shapes.ts) as the channels' cards write one: the
     * bot's reply, with N, M… for its numbers, […] for an item, @username for a player;
     * then how many uses it covers, and what each part held.
     */
    function shapeHtml(shape) {
      const NUMS = ['N', 'M', 'P', 'Q', 'R', 'S'];
      let numbers = 0;
      const label = shape.slots.map((s) =>
        s.kind === 'number' || s.kind === 'duration' ? (NUMS[numbers++] ?? '#') : null
      );
      const slotText = (i) => {
        const s = shape.slots[i];
        // A list (the scanner's Pakkomon) is lines of its own.
        if (s.kind === 'list') return '<br><span class="slot">- …</span>';
        const t =
          label[i] ??
          {
            user: '@username',
            text: '"…"',
            place: '[luogo]',
            pakkomon: '[pakkomon]',
          }[s.kind] ??
          '[…]';
        return `<span class="slot">${esc(t)}</span>`;
      };
      // The text, line by line, its fixed items linked.
      const html = shape.parts
        .map((p) => (typeof p === 'number' ? `\u0000${p}\u0000` : p))
        .join('')
        .split('\n')
        .map((line) =>
          line
            .split('\u0000')
            .map((x, i) => (i % 2 ? slotText(Number(x)) : linkItems(x)))
            .join('')
        );
      const placeLink = (w) => {
        const l = Object.values(L).find((x) => x.at === w || x.name === w);
        return l ? goLink('loc', l.name, w) : esc(w);
      };
      const list = (xs, f, k = 8) =>
        xs.slice(0, k).map(f).join(', ') + (xs.length > k ? ` e altri ${xs.length - k}` : '');
      const notes = shape.slots
        .map((s, i) => {
          const name = label[i];
          switch (s.kind) {
            case 'number':
              return `${name}: tra ${s.min.toLocaleString('it-IT')} e ${s.max.toLocaleString('it-IT')}${s.decimals ? `, con ${s.decimals} cifre decimali` : ''}`;
            case 'duration':
              return `${name}: da ${duration(s.min)} a ${duration(s.max)}`;
            case 'item':
              // Several item parts (a pack's three figurine) are one list of what they held.
              return shape.slots.findIndex((x) => x.kind === 'item') === i
                ? `[…]: ${list(
                    [...new Set(shape.slots.flatMap((x) => (x.kind === 'item' ? x.values : [])))],
                    (v) => itemRef(v, true)
                  )}`
                : '';
            case 'place':
              return `[luogo]: ${list(s.values, placeLink)}`;
            case 'pakkomon':
              return `[pakkomon]: ${list(s.values, esc)}`;
            case 'symbols':
              return `[…]: ${s.values.map(esc).join(' ')}`;
            default:
              return '';
          }
        })
        .filter(Boolean);
      const times = `${shape.count} ${shape.count === 1 ? 'volta' : 'volte'}`;
      return bubble(html) + `<p class="note shape-note">${[times, ...notes].join(' · ')}</p>`;
    }
    function useHtml(u) {
      const ev = u.consumed_evidence,
        plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
      const result =
        {
          fixed: `Risultato sempre uguale (${plural(u.observations, 'uso osservato', 'usi osservati')}).`,
          variable: `Risultato variabile, su ${u.observations} usi.`,
          single: 'Una sola osservazione: non si sa ancora se il risultato varia.',
        }[u.result] || '';
      const against =
        ev.yes && ev.no
          ? ` ${plural(ev.no, 'intervallo', 'intervalli')} senza calo, probabilmente per un'entrata non visibile nella chat esportata.`
          : '';
      const cons =
        u.consumed === true
          ? `Si consuma (${plural(ev.yes, 'uso verificato', 'usi verificati')} con i conteggi prima e dopo).${against}`
          : u.consumed === false
            ? `Non si consuma (${plural(ev.no, 'uso verificato', 'usi verificati')} con i conteggi prima e dopo).`
            : 'Non ancora verificato se si consuma.';
      const shown = u.shapes.slice(0, 4).map(shapeHtml).join('');
      const more =
        u.shapes.length > 4
          ? `<p class="note">… e altre ${u.shapes.length - 4} risposte diverse.</p>`
          : '';
      const req = u.requirements
        .map((t) => `<p class="note">Uso fallito: «${esc(t)}»</p>`)
        .join('');
      const c = u.cooldown,
        obsN = c ? plural(c.observations, 'osservazione', 'osservazioni') : '';
      const cd = !c
        ? ''
        : c.seconds !== undefined
          ? `<p class="note">Raffreddamento: ${duration(c.seconds)} (stima da ${obsN}).</p>`
          : `<p class="note">Raffreddamento: almeno ${duration(c.min)} (${obsN}).</p>`;
      return `${result ? `<p class="note">${result}</p>` : ''}<p class="note">${cons}</p>${cd}${shown}${more}${req}`;
    }
    /** Seconds as Italian words: "5 minuti", "1 ora e 30 minuti", "2 giorni". */
    function duration(s) {
      const units = [
        [86400, 'giorno', 'giorni'],
        [3600, 'ora', 'ore'],
        [60, 'minuto', 'minuti'],
        [1, 'secondo', 'secondi'],
      ];
      const parts = [];
      for (const [n, one, many] of units) {
        const k = Math.floor(s / n);
        if (k) parts.push(`${k} ${k === 1 ? one : many}`);
        s -= k * n;
      }
      return parts.length ? parts.slice(0, 2).join(' e ') : '0 secondi';
    }
    /** How an item is obtained, as the last lines of /esamina put it. */
    function obtainLines(i) {
      const lines = [];
      if (i.sources.includes('adventure') || i.exclusive)
        lines.push("E' un oggetto trovabile in avventura.");
      if (i.made_by.length)
        lines.push(
          `E' un oggetto che si ottiene con ${i.made_by.length === 1 ? 'la ricetta' : 'le ricette'} ${i.made_by.map((r) => recipeRef(r, true)).join(', ')}.`
        );
      else if (i.sources.includes('recipe'))
        lines.push("E' un oggetto che si ottiene con una ricetta, non ancora identificata.");
      if (i.from_use?.length)
        lines.push(
          `E' un oggetto che si ottiene usando ${few(i.from_use.map(current), (n) => goLink('item', n))}.`
        );
      if (i.rewards?.includes('level_up')) lines.push('Si riceve in omaggio salendo di livello.');
      if (i.rewards?.includes('lottery')) lines.push('Si vince alla lotteria.');
      if (i.from_fight?.length)
        lines.push(`Si vince combattendo con un Pakkomon contro ${listIt(i.from_fight.map(esc))}.`);
      if (i.sources.includes('special')) lines.push("E' un oggetto speciale.");
      if (!lines.length)
        lines.push('<span class="unknown">Non si sa ancora come si ottiene.</span>');
      return lines;
    }
    /** /esamina of an item, for any player. */
    function itemBubble(i) {
      const usedIn = [...i.used_in].sort((a, b) => lvl(b) - lvl(a));
      const cd = i.use?.cooldown?.seconds;
      return bubble([
        `<b>${esc(i.name)}</b> <span class="t-${rarityGroup(i.rarity)}">[${esc(i.rarity || '?')}]</span>${i.usable ? ' [usabile]' : ''} al momento ${usedIn.length ? `serve nelle ricette: ${usedIn.map((r) => recipeRef(r)).join(', ')}.` : 'non serve in nessuna ricetta.'}`,
        ...obtainLines(i),
        ...(cd !== undefined ? [`Raffreddamento: ${duration(cd)}.`] : []),
      ]);
    }
    // The recipes that make an item, under its name: the other half of a recipe's title.
    // The places an item opens: those it takes to pass (to enter), and those it takes to
    // see among the destinations. Among the most precious items of the game.
    const OPENS = new Map();
    for (const l of Object.values(L))
      for (const [kind, items] of [
        ['pass', l.required_items || []],
        ['see', l.sight_items || []],
      ])
        for (const n of items) {
          const o = OPENS.get(current(n)) ?? { pass: [], see: [] };
          o[kind].push(l.name);
          OPENS.set(current(n), o);
        }
    /** What an item opens, under the title of its page and of its recipes' pages. */
    function opensLines(item) {
      const o = item ? OPENS.get(current(item)) : undefined;
      if (!o) return '';
      const line = (label, places) =>
        places.length
          ? `<p class="makes">${label}: ${places.map((k) => goLink('loc', k, at(k))).join(', ')}</p>`
          : '';
      // As the bot says it: "<item> ti serve per passare nelle cripte del monastero 👻".
      return (
        line('Serve per passare', o.pass) + line('Serve per vedere tra le destinazioni', o.see)
      );
    }
    /** The first names of a list, and how many more ("e altri 3"). */
    function few(names, f, k = 5) {
      const shown = [...new Set(names)];
      return (
        shown.slice(0, k).map(f).join(', ') +
        (shown.length > k ? ` e altri ${shown.length - k}` : '')
      );
    }
    /** The items whose use gives an item, under its name, beside the recipes that make it. */
    function fromUseLine(i) {
      const arrow = '<span class="arrow" aria-hidden="true">←</span>';
      return i.from_use?.length
        ? `<p class="makes"><span class="visually-hidden">Si ottiene usando: </span>${arrow} usando ${few(i.from_use.map(current), (n) => goLink('item', n))}</p>`
        : '';
    }
    /**
     * The items an item is used with (the chest a key opens, the machine it goes in, the
     * Pakkomon it equips), under the title of its page and of its recipes' pages.
     */
    function usedWithLine(item) {
      const w = item ? I[current(item)]?.used_with : undefined;
      return w?.length
        ? `<p class="makes">Si usa con: ${few(w.map(current), (n) => goLink('item', n))}</p>`
        : '';
    }
    /** What an item is for, with Pakkomon; the one Pakkomon leads to the owner's. */
    function pakkomonLine(i) {
      if (i.name === PAKKOMON)
        return pakkomonTab
          ? `<p class="makes">Ogni Pakkomon è unico: ${goLink('pakkomon', MY_PK[0].name, 'i tuoi Pakkomon')}</p>`
          : '';
      return i.pakkomon_roles?.length
        ? `<p class="makes">Per i Pakkomon: ${i.pakkomon_roles.map((r) => esc(ROLE_NAMES[r])).join(', ')}.</p>`
        : '';
    }
    function madeBy(i) {
      const arrow = '<span class="arrow" aria-hidden="true">←</span>';
      if (i.made_by.length)
        return `<p class="makes"><span class="visually-hidden">Si ottiene con: </span>${arrow} ${i.made_by.map((r) => `<span class="made">${goLink('recipe', r)} ${lvlTag(R[r])}</span>`).join('<span class="sep">,</span> ')}</p>`;
      if (i.sources.includes('recipe'))
        return `<p class="makes"><span class="visually-hidden">Si ottiene con: </span>${arrow} ? <span class="makes-unknown">ricetta non ancora identificata</span></p>`;
      return '';
    }
    function itemDetail(name) {
      const i = I[name];
      if (!i) return `<p class="empty">Seleziona un oggetto dall'elenco.</p>`;
      // Its recipes are part of its page: a recipe is the way to obtain it.
      const recipes = i.made_by.filter((n) => R[n]).map((n) => [n, recipeParts(n)]);
      const h = have(name),
        mineI = P?.items[name],
        seenAt = mineI?.first_seen;
      // As /esamina of the item would answer the owner.
      const personal = P
        ? myCard(
            [
              [
                // The owner's Pakkomon are counted one by one, not estimated.
                name === PAKKOMON
                  ? [`Hai ${MY_PK.filter((p) => !p.gone).length} Pakkomon.`]
                  : h
                    ? `Ne hai ${h.exact ? '' : 'almeno '}${h.qty}.`
                    : 'Non ne hai neanche uno.',
              ].flat(),
              ...recipes.map(([, p]) => p.myLines),
            ],
            [
              ...recipes.map(([, p]) => p.myNote),
              h ? `Ultimo riscontro con ${VIA[h.via] || h.via} il ${fmtDate(h.date)}.` : '',
              seenAt ? `Visto per la prima volta il ${fmtDate(seenAt)}.` : '',
              i.usable
                ? mineI?.used
                  ? `Usato ${mineI.used} ${mineI.used === 1 ? 'volta' : 'volte'}, l'ultima il ${fmtDate(mineI.last_used)}.`
                  : 'Mai usato.'
                : '',
            ]
          )
        : '';
      return page(
        personal,
        `<div class="head"><div class="kicker">${tag(i.rarity)}<span>${esc(rarityName(rarityGroup(i.rarity)))}</span>${i.usable ? '<span>· usabile</span>' : ''}${i.gives_title ? `<span>· dà ${i.title ? `il titolo «${esc(i.title)}»` : 'un titolo'}</span>` : ''}</div>
    <h2>${esc(name)}</h2>
    ${madeBy(i)}
    ${fromUseLine(i)}
    ${opensLines(name)}
    ${usedWithLine(name)}
    ${pakkomonLine(i)}
    ${
      // A "+" item drops in one place: where, right under its name.
      i.exclusive
        ? `<p class="makes">${i.locations.length ? `Esce solo qui: ${i.locations.map((k) => goLink('loc', k, at(k))).join(', ')}` : '<span class="makes-unknown">Esce in un solo luogo, non ancora identificato.</span>'}</p>`
        : ''
    }
</div>
    ${itemBubble(i)}
    ${i.sources_inferred ? '<p class="note">Come si ottiene è dedotto dalla rarità: il bot non lo ha ancora detto.</p>' : ''}
    ${recipes
      .map(
        ([n, p]) =>
          sec(`Ricetta · ${esc(n)} ${lvlTag(p.r)}`, (p.craftBubble || p.detailBubble) + p.ingNote) +
          p.tree
      )
      .join('')}
    ${i.use ? sec('Effetto di /usa', useHtml(i.use)) : ''}
    ${moreInfo(
      itemCardText(i.channel),
      ...recipes.map(([, p]) => notesOf(p.r.channel)),
      i.old_names?.length
        ? '<h4>Nomi precedenti</h4>' +
            i.old_names
              .map(
                (o) =>
                  `<p class="note"><b>${esc(o.name)}</b>, visto l'ultima volta il ${fmtDate(o.last_seen)}. Rinomina dedotta: ${esc(o.evidence)}.</p>`
              )
              .join('')
        : ''
    )}
    ${sourcesLine(
      i,
      i.channel,
      { rarity: 'la rarità' },
      recipes.map(([n, p]) => ({
        x: p.r,
        card: p.r.channel,
        what: RECIPE_FIELDS,
        of: `della ricetta ${esc(n)}`,
      }))
    )}
`
      );
    }

    /** What an item card says: how the item is obtained, what it is for, what a use does to it. */
    function itemCardText(card) {
      if (!card || !card.obtain) return '';
      const para = (xs) => xs.map((x) => `<p class="note">${esc(x)}</p>`).join('');
      const cooldown =
        card.cooldown === null
          ? ''
          : card.cooldown === 0
            ? 'nessun raffreddamento'
            : `raffreddamento ${duration(card.cooldown)}`;
      const consumed =
        card.consumed === null ? '' : card.consumed ? 'si consuma' : "resta nell'inventario";
      const facts = [consumed, cooldown].filter(Boolean).join(', ');
      return (
        (card.obtain.length ? `<h4>Come si ottiene</h4>${para(card.obtain)}` : '') +
        (card.usage.length ? `<h4>A cosa serve</h4>${para(card.usage)}` : '') +
        (card.effect
          ? `<h4>Dopo l'uso</h4><p class="note">${esc(card.effect)}${facts ? ` (${facts})` : ''}</p>`
          : '') +
        para(card.notes)
      );
    }

    // ---- locations ---------------------------------------------------------------
    function locRows(q) {
      return Object.values(L)
        .filter((l) => !q || fold(l.label).includes(q))
        .sort((a, b) => a.requires_item - b.requires_item || a.label.localeCompare(b.label, 'it'));
    }
    function locRow(l) {
      const excl = l.exclusive_items.length;
      return `<button class="row" data-sel="${esc(l.name)}" aria-current="${state.sel.luoghi === l.name}">
    <span class="tag ${l.requires_item ? 't-X' : 't-q'}">${l.requires_item ? 'serve oggetto' : 'libero'}</span><span class="name">${esc(l.label)}</span>
    <span class="meta">${excl ? excl + ' esclusivi' : ''}</span>
    <span class="sub">${l.exits.length} collegamenti${P ? (visited(l.name) ? ' · <span class="mine ok">visitato</span>' : ' · <span class="mine">mai visitato</span>') : ''}</span></button>`;
    }
    /** A place as the bot writes it, with its preposition ("nel bosco …"), if known. */
    const at = (n) => L[n]?.at || L[n]?.name || n;
    /** /viaggio from the place, for any player: where one is, and where one can go. */
    function placeBubble(l, inbound) {
      const exits = [...new Set([...l.exits, ...inbound])];
      return bubble([
        `ti trovi: <b>${esc(at(l.name))}</b>`,
        ...(exits.length
          ? ['Puoi andare verso:', ...exits.map((x) => `- ${goLink('loc', x, at(x))}`)]
          : []),
      ]);
    }
    function locDetail(name) {
      const l = L[name];
      if (!l) return `<p class="empty">Seleziona un luogo sulla mappa o dall'elenco.</p>`;
      const excl = l.exclusive_items;
      const inbound = Object.values(L)
        .filter((o) => o.exits.includes(name))
        .map((o) => o.name);
      const pl = P?.locations[name];
      const personal = P
        ? myCard(
            [],
            [
              pl?.visited ? 'Visitato.' : 'Mai visitato.',
              pl?.adventures ? `${pl.adventures} avventure fatte qui.` : '',
            ]
          )
        : '';
      return page(
        personal,
        `<div class="head"><div class="kicker"><span>Luogo</span>${l.requires_item ? '<span>· serve un oggetto per entrare</span>' : ''}${l.secret ? '<span>· segreto</span>' : ''}</div>
    <h2>${esc(l.label)}</h2>
    ${
      // What it takes to enter, right under its name.
      (l.required_items || []).length
        ? `<p class="makes">Per entrare serve: ${l.required_items.map((n) => `<span class="made">${goLink('item', current(n))} ${tag(I[current(n)]?.rarity)}</span>`).join('<span class="sep">,</span> ')}</p>`
        : l.requires_item
          ? '<p class="makes"><span class="makes-unknown">Per entrare serve un oggetto non ancora identificato.</span></p>'
          : ''
    }</div>
    ${placeBubble(l, inbound)}
    ${(l.sight_items || []).length ? sec('Per vederlo tra le destinazioni', `<p class="note">Senza questi oggetti il luogo non compare nel pannello di viaggio.</p>` + chips(l.sight_items, itemLink)) : ''}
    ${
      l.unlock_texts.length
        ? sec('Come si sblocca', l.unlock_texts.map((u) => bubble([linkItems(u)])).join(''))
        : l.requires_item
          ? sec(
              'Come si sblocca',
              bubble([`non puoi andare: ${esc(at(name))}.. Forse ti manca qualcosa!`])
            )
          : ''
    }
    ${sec('Oggetti esclusivi', chips(excl, itemLink))}
    ${moreInfo(notesOf(l.channel))}
    ${sourcesLine(l, l.channel, { items: 'gli oggetti esclusivi', route: 'il percorso', access: "l'oggetto per entrare", sight: "l'oggetto per vederlo" })}
`
      );
    }
    // ---- Pakkomon -----------------------------------------------------------------
    /** What an item is for, with Pakkomon (pakkomon_roles). */
    const ROLE_NAMES = {
      sphere: 'fa nascere un Pakkomon',
      equipment: 'equipaggiamento',
      scanner: 'mostra quando i tuoi Pakkomon possono combattere',
      heal: 'cura un Pakkomon rintronato',
      power_up: 'potenziamento',
      probe: 'misura la forza',
      scale: 'confronta due Pakkomon',
      extractor: 'distrugge un Pakkomon',
      customisation: 'cambia nome e icona a un Pakkomon',
    };
    const withRole = (role) =>
      Object.values(I)
        .filter((i) => i.pakkomon_roles?.includes(role))
        .map((i) => i.name)
        .sort((a, b) => a.localeCompare(b, 'it'));
    const fmtDateTime = (d) =>
      d
        ? new Date(d).toLocaleString('it-IT', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
    /** Stunned at the date of the owner's latest event. */
    const stunned = (p) =>
      !!p.stunned_until && !!P?.as_of && new Date(p.stunned_until) > new Date(P.as_of);
    const PAKKOMON_FILTERS = {
      tuoi: ['I tuoi', (p) => !p.gone],
      ceduti: ['Non più tuoi', (p) => !!p.gone, 'Ceduti, distrutti, o non più elencati'],
    };
    /** The guide first, then the owner's Pakkomon of the filter. */
    function pakkomonRows(q) {
      const f = PAKKOMON_FILTERS[state.filter.pakkomon][1];
      return [
        ...(!q || fold(GUIDE).includes(q) ? [{ name: GUIDE }] : []),
        ...MY_PK.filter((p) => f(p) && (!q || fold(p.name).includes(q))),
      ];
    }
    const goneText = (p) =>
      ({
        given: `dato a @${p.gone.to}`,
        extracted: 'distrutto con un estrattore',
        unlisted: 'non più tra i tuoi',
      })[p.gone.via] + (p.gone.date ? ` il ${fmtDate(p.gone.date)}` : '');
    function pakkomonRow(p) {
      const cur = `aria-current="${state.sel.pakkomon === p.name}"`;
      if (p.name === GUIDE)
        return `<button class="row" data-sel="${esc(GUIDE)}" ${cur}><span class="tag t-q">?</span><span class="name">${esc(GUIDE)}</span>
    <span class="sub">combattimenti, equipaggiamento, cure, premi</span></button>`;
      const sub = [
        p.record ? `${p.record.wins} vittorie, ${p.record.losses} sconfitte` : 'scheda mai vista',
        p.gone ? goneText(p) : '',
      ].filter(Boolean);
      return `<button class="row" data-sel="${esc(p.name)}" ${cur}>
    <span class="tag t-X">PK</span><span class="name">${esc(p.name)}</span><span class="meta">${p.gone ? '' : stunned(p) ? 'rintronato' : '<span class="mine ok">pronto</span>'}</span>
    <span class="sub">${esc(sub.join(' · '))}</span></button>`;
    }
    /** The page of the tab's entry: the guide, or one of the owner's Pakkomon. */
    const pakkomonPage = (name) => (PK[name] ? pakkomonDetail(PK[name]) : guideDetail());
    /** One of the owner's Pakkomon: its record as the bot shows it, then its story. */
    function pakkomonDetail(p) {
      const rec = p.record;
      const born = p.born ? p.born.split('-').reverse().join('-') : null;
      const record = rec
        ? bubble([
            `<b>${esc(p.name)}</b> ha vinto ${rec.wins} battaglie e ne ha perse ${rec.losses}.`,
            p.equipment
              ? `E' equipaggiato con ${itemRef(p.equipment)}.`
              : 'Non ha nulla equipaggiato.',
            stunned(p)
              ? `E' ancora rintronato dall'ultimo combattimento. Si rimettera' il ${fmtDateTime(p.stunned_until)}.`
              : "E' pronto a combattere.",
            ...(born ? [`E' nato il giorno ${born} dalle mani di @${esc(p.maker)}.`] : []),
            ...(p.power_ups.length ? [esc(p.power_ups.join(''))] : []),
          ])
        : `<p class="note">La sua scheda non compare nelle chat importate: /usa ${esc(p.name)} la mostra.</p>`;
      const story = [
        p.came
          ? p.came.via === 'hatched'
            ? `Nato da ${I[current(p.came.from)] ? goLink('item', current(p.came.from)) : esc(p.came.from || 'una sfera')}${p.came.date ? ` il ${fmtDate(p.came.date)}` : ''}.`
            : `Ricevuto da @${esc(p.came.from)}${p.came.date ? ` il ${fmtDate(p.came.date)}` : ''}.`
          : '',
        p.first_seen
          ? `Visto per la prima volta il ${fmtDate(p.first_seen)}, l'ultima il ${fmtDate(p.last_seen)}.`
          : '',
        p.gone ? `${esc(goneText(p).replace(/^./u, (c) => c.toUpperCase()))}.` : '',
        rec ? `Scheda del ${fmtDate(rec.date)}.` : '',
      ].filter(Boolean);
      const f = p.fights;
      const ending = p.best_win ? ENDINGS.find(([, lo]) => lo === p.best_win.min)?.[0] : null;
      const fights = [
        f.won + f.lost
          ? `Nelle chat importate: ${f.won} ${f.won === 1 ? 'vittoria' : 'vittorie'} e ${f.lost} ${f.lost === 1 ? 'sconfitta' : 'sconfitte'}${f.learned ? `; ha imparato qualcosa di nuovo ${f.learned} ${f.learned === 1 ? 'volta' : 'volte'}` : ''}.`
          : 'Nessun combattimento nelle chat importate.',
        p.best_win
          ? `La vittoria più netta: «${esc(ending)}», con l'avversario rintronato per ${p.best_win.max === null ? `almeno ${p.best_win.min}` : `${p.best_win.min}-${p.best_win.max}`} minuti: la sua forza, più il bonus dell'equipaggiamento, arriva almeno a ${p.best_win.min}.`
          : '',
        p.probe ? `La sonda lo dice «${esc(p.probe)}».` : '',
        p.power_up_items.length
          ? `Potenziato con ${p.power_up_items.map((n) => goLink('item', current(n))).join(', ')}.`
          : '',
      ].filter(Boolean);
      const notes = (lines) => lines.map((l) => `<p class="note">${l}</p>`).join('');
      return page(
        p.gone ? '' : pakkomonCard(p),
        `<div class="head"><div class="kicker"><span class="tag t-X">PK</span><span>Pakkomon</span><span>· ${p.gone ? 'non più tuo' : 'tuo'}</span></div>
    <h2>${esc(p.name)}</h2></div>
    ${record}
    ${sec('Storia', notes(story))}
    ${sec('Combattimenti', notes(fights))}`
      );
    }
    /**
     * The items for Pakkomon the owner holds, as a card beside one of theirs: its
     * equipment, then the free equipment, then that of their other Pakkomon (an item equips
     * several), the healing items and power-ups (one given to it already marked: each works
     * once), the tools. Equipment is what someone was seen equipping: any item can be.
     */
    function pakkomonCard(p) {
      const held = (n) => (have(n)?.qty || 0) > 0;
      const qty = (n) => {
        const h = have(n);
        return ` x${h.exact ? '' : '≥'}${h.qty}`;
      };
      const aside = (t) => `<span class="aside">${t}</span>`;
      const others = new Map();
      for (const o of MY_PK)
        if (!o.gone && o !== p && o.equipment)
          others.set(o.equipment, [...(others.get(o.equipment) || []), o.name]);
      // A Pakkomon equipped with another is no equipment to offer.
      const kit = withRole('equipment').filter((n) => n !== PAKKOMON && held(n));
      const free = kit.filter((n) => n !== p.equipment && !others.has(n));
      const worn = kit.filter((n) => n !== p.equipment && others.has(n));
      // What is worn, with who wears it; then the free ones.
      const equipment = [
        ...kit
          .filter((n) => n === p.equipment)
          .map((n) => `- ${itemRef(n)}${aside('equipaggiato')}`),
        ...worn.map(
          (n) => `- ${itemRef(n)}${aside(`anche su ${others.get(n).map(esc).join(', ')}`)}`
        ),
        ...(free.length ? ['Liberi:', ...free.map((n) => `- ${itemRef(n)}`)] : []),
      ];
      const list = (title, roles, note = () => '') => {
        const items = [...new Set(roles.flatMap(withRole))].filter(held);
        return items.length
          ? [title, ...items.map((n) => `- ${itemRef(n)}${qty(n)}${note(n)}`)]
          : [];
      };
      const replies = [
        equipment.length ? ['Equipaggiamento che hai:', ...equipment] : [],
        list('Cure che hai:', ['heal']),
        list('Potenziamenti che hai:', ['power_up'], (n) =>
          p.power_up_items.includes(n) ? aside('già dato a lui') : ''
        ),
        list('Strumenti che hai:', ['scanner', 'probe', 'scale', 'extractor', 'customisation']),
      ].filter((r) => r.length);
      return myCard(replies, [
        replies.length ? '' : 'Non hai oggetti per i Pakkomon.',
        equipment.length
          ? "Equipaggiare non consuma l'oggetto: lo stesso può equipaggiare più Pakkomon."
          : '',
      ]);
    }
    /** How Pakkomon work: the game's rules, and the items and prizes the wiki knows. */
    function guideDetail() {
      const spheres = [...new Set([...withRole('sphere'), ...(I[PAKKOMON]?.from_use || [])])];
      const roleSec = (title, roles, note) => {
        const items = roles.flatMap((r) => withRole(r).map((n) => [n, r]));
        return sec(
          title,
          `<p class="note">${note}</p>` +
            (items.length
              ? // A long list (anything can be equipment) is folded, with its size.
                ((list) =>
                  items.length > 12
                    ? `<details class="cand"><summary>${items.length} oggetti osservati</summary>${list}</details>`
                    : list)(
                  `<div class="chips">${items.map(([n, r]) => `${itemLink(n)}${roles.length > 1 ? ` <span class="note">${esc(ROLE_NAMES[r])}</span>` : ''}`).join('')}</div>`
                )
              : '<p class="empty">Nessuno osservato.</p>')
        );
      };
      // The prizes of fights, by the Pakkomon beaten or hit.
      const prizes = new Map();
      for (const i of Object.values(I))
        for (const o of i.from_fight || []) prizes.set(o, [...(prizes.get(o) || []), i.name]);
      const prizeLines = [...prizes]
        .sort((a, b) => a[0].localeCompare(b[0], 'it'))
        .map(([o, items]) => `- ${esc(o)}: ${items.map((n) => itemRef(n)).join(', ')}`);
      const own = MY_PK.filter((p) => !p.gone).length;
      const endings = `<table class="endings"><thead><tr><th>Frase finale</th><th>Rintronato per</th></tr></thead><tbody>${ENDINGS.map(
        ([phrase, lo, hi]) =>
          `<tr><td>${esc(phrase)}</td><td>${hi === null ? `almeno ${lo}` : `${lo}-${hi}`} minuti</td></tr>`
      ).join('')}</tbody></table>`;
      const usage = (s) => `<code>${esc(s)}</code>`;
      // The tab shows only while the owner has a Pakkomon.
      return page(
        myCard([], [`Hai ${own} Pakkomon: li trovi nell'elenco.`]),
        `<div class="head"><div class="kicker"><span class="tag t-q">?</span><span>Pakkomon</span></div>
    <h2>Come funzionano i Pakkomon</h2></div>
    <p class="note">Un Pakkomon è una creatura che combatte contro quelle degli altri giocatori. Ognuno è unico: ha un nome tutto suo, e tiene le sue vittorie, le sue sconfitte, il suo equipaggiamento e i suoi potenziamenti anche se cambia padrone.</p>
    ${sec('Come si ottiene', `<p class="note">Usando una sfera, da cui esce un Pakkomon dal nome e dall'icona casuali.</p>` + (spheres.length ? chips(spheres, itemLink) : '<p class="empty">Nessuna sfera osservata.</p>'))}
    ${sec(
      'Combattimenti',
      `<p class="note">${usage('/usa <pakkomon> # @utente')} sfida un giocatore, ${usage('/usa <pakkomon> # ?')} aspetta uno sfidante qualsiasi, ${usage('/usa <pakkomon>')} mostra la sua scheda.</p>
      <p class="note">Ogni Pakkomon ha una forza che il gioco non mostra. In un combattimento ciascuno tira un numero fino alla sua forza, più il bonus del suo equipaggiamento: vince il più alto, e a parità chi ha sfidato. Chi vince può imparare qualcosa di nuovo, e diventa più forte.</p>
      <p class="note">Chi perde resta rintronato, e non può combattere, per tanti minuti quanta è la differenza tra i due tiri, e la frase con cui finisce il combattimento lo dice. La vittoria più netta di un Pakkomon dice quindi a quanto arrivano almeno la sua forza e il bonus del suo equipaggiamento.</p>
      ${endings}`
    )}
    ${roleSec('Equipaggiamento', ['equipment'], `Un Pakkomon si equipaggia con un oggetto dell'inventario (${usage('/usa <pakkomon> # <oggetto>')}), che resta nell'inventario e può equipaggiarne altri. Il bonus che dà non si vede: alcuni oggetti non ne danno, altri tolgono forza.`)}
    ${roleSec('Potenziamenti', ['power_up'], 'Danno forza per sempre. Ognuno si può dare una volta sola allo stesso Pakkomon, e la sua scheda ne mostra l’icona.')}
    ${roleSec('Cure', ['heal'], `Rimettono subito in forma un Pakkomon rintronato (${usage('/usa <oggetto> # <pakkomon>')}).`)}
    ${roleSec('Strumenti', ['scanner', 'probe', 'scale', 'extractor', 'customisation'], 'Per conoscere i propri Pakkomon, e cambiarli.')}
    ${sec(
      'Avversari del bot e boss',
      `<p class="note">Contro @InventoryBot si affrontano i Pakkomon del bot, molto più forti di quelli dei giocatori: battuto uno, si passa al successivo. Ogni tanto arriva un boss, che si affronta allo stesso modo nei gruppi dell'Arena: ogni colpo dà un oggetto, e le sue ferite crescono da «${esc(WOUNDS[0])}» a «${esc(WOUNDS.at(-1))}», finché è sconfitto.</p>` +
        (prizeLines.length
          ? bubble(['Premi osservati:', ...prizeLines])
          : '<p class="empty">Nessun premio osservato.</p>')
    )}`
      );
    }
    // ---- the map of the places ---------------------------------------------------
    // Drawn on a grid as in classic role-playing games (map-layout.ts): its pixel-art field
    // and dirt roads look the same in both themes. It runs across a wide window and down a
    // tall one; each layout is made once per wiki, with its labels measured in the map's font.
    // Rows a little closer than columns, so that the map fits a desktop screen better.
    const MAP = { cell: 120, row: 96, mark: 7, line: 13, font: "700 11px 'Pixelify Sans'" };
    const mapPlaces = Object.values(L).map((l) => ({ name: l.name, exits: l.exits }));
    const mapCache = {};
    let mapFontAsked = false;
    /** The axis of the map last drawn. */
    let mapShown = null;
    function mapFor(axis) {
      if (mapCache[axis]) return mapCache[axis];
      // Labels measured before the font is in would be measured in another: once it is, the
      // map is drawn again.
      if (!mapFontAsked && !document.fonts.check(MAP.font)) {
        mapFontAsked = true;
        document.fonts.load(MAP.font).then(() => {
          for (const k of Object.keys(mapCache)) delete mapCache[k];
          if (root.isConnected && state.tab === 'luoghi') render();
        });
      }
      const m = layoutMap(mapPlaces, { axis, fold: true });
      const pts = new Map(
        [...m.cells].map(([n, [x, y]]) => [n, { x: x * MAP.cell, y: y * MAP.row }])
      );
      const segs = m.roads.map((r) => [
        pts.get(r.a).x,
        pts.get(r.a).y,
        pts.get(r.b).x,
        pts.get(r.b).y,
      ]);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = MAP.font;
      const labels = placeLabels(
        pts,
        new Map(Object.values(L).map((l) => [l.name, l.label])),
        segs,
        {
          measure: (t) => ctx.measureText(t).width,
          maxWidth: MAP.cell - 14,
          lineHeight: MAP.line,
          radius: MAP.mark + 2,
        }
      );
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const [n, p] of pts) {
        const b = labels.get(n);
        x0 = Math.min(x0, p.x - 12, b?.x0 ?? p.x);
        x1 = Math.max(x1, p.x + 12, b?.x1 ?? p.x);
        y0 = Math.min(y0, p.y - 12, b?.y0 ?? p.y);
        y1 = Math.max(y1, p.y + 12, b?.y1 ?? p.y);
      }
      const pad = 24;
      return (mapCache[axis] = {
        m,
        pts,
        labels,
        box: { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad },
      });
    }
    /** The axis of the map: horizontal in a wide window, vertical in a tall one. */
    const mapAxis = () => (window.innerWidth >= window.innerHeight ? 'h' : 'v');
    /** The map, with `sel` marked and the shortest route to it from the start highlighted. */
    function mapSvg(sel) {
      const axis = (mapShown = mapAxis());
      const { m, pts, labels, box } = mapFor(axis);
      const pair = (a, b) => (a < b ? a + '\n' + b : b + '\n' + a);
      const route = m.route(sel),
        onRoute = new Set(route.slice(1).map((n, i) => pair(route[i], n)));
      const road = (r, cls) => {
        const a = pts.get(r.a),
          b = pts.get(r.b);
        if (!r.oneWay)
          return `<line class="${cls}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
        // a one-way road has an arrow halfway, towards where it leads
        const arrow =
          cls === 'm-road' || cls.startsWith('m-road ') ? ' marker-mid="url(#map-arrow)"' : '';
        return `<path class="${cls}" d="M${a.x} ${a.y}L${(a.x + b.x) / 2} ${(a.y + b.y) / 2}L${b.x} ${b.y}"${arrow}/>`;
      };
      // A road to a secret place: its neighbours list it only to a player holding its item.
      const secret = (r) => (L[r.a]?.secret || L[r.b]?.secret ? ' secret' : '');
      const roads =
        m.roads.map((r) => road(r, `m-verge${secret(r)}`)).join('') +
        m.roads
          .map((r) => road(r, `m-road${r.a === sel || r.b === sel ? ' hi' : ''}${secret(r)}`))
          .join('') +
        m.roads
          .filter((r) => onRoute.has(pair(r.a, r.b)))
          .map((r) => road(r, 'm-route'))
          .join('');
      const places = [...pts]
        .map(([n, { x, y }]) => {
          const l = L[n],
            b = labels.get(n),
            k = MAP.mark;
          const cls = [
            'g-node',
            visited(n) && 'visited',
            l.requires_item && 'locked',
            n === m.root && 'start',
            n === sel && 'sel',
          ]
            .filter(Boolean)
            .join(' ');
          const text = b
            ? `<text class="m-label" text-anchor="${b.anchor}">${b.lines.map((t, i) => `<tspan x="${b.textX}" y="${b.y0 + 10 + i * MAP.line}">${esc(t)}</tspan>`).join('')}</text>`
            : '';
          return `<g class="${cls}" data-go="loc" data-name="${esc(n)}" tabindex="0" role="button" aria-label="${esc(l.label)}">${n === sel ? `<rect class="m-ring" x="${x - k - 5}" y="${y - k - 5}" width="${2 * k + 10}" height="${2 * k + 10}"/>` : ''}<rect class="m-mark" x="${x - k}" y="${y - k}" width="${2 * k}" height="${2 * k}"/>${text}</g>`;
        })
        .join('');
      const { x, y, w, h } = box;
      // At its own size, or narrower to fit, but never below three quarters: past that the
      // box scrolls.
      const width = Math.round(Math.min(w, Math.max($('#view').clientWidth || w, w * 0.75)));
      return `<svg class="map" viewBox="${x} ${y} ${w} ${h}" width="${width}" role="img" aria-label="Mappa dei luoghi">
    <defs>
      <marker id="map-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2" markerHeight="2" orient="auto"><path class="m-arrow" d="M0 0L10 5L0 10z"/></marker>
      <pattern id="map-grass" width="16" height="16" patternUnits="userSpaceOnUse">
        <rect class="m-g0" width="16" height="16"/><rect class="m-g1" width="4" height="4"/><rect class="m-g2" x="8" y="4" width="4" height="4"/>
        <rect class="m-g1" x="4" y="12" width="4" height="4"/><rect class="m-g3" x="12" y="8" width="4" height="4"/><rect class="m-g4" x="12" width="4" height="4"/>
      </pattern>
    </defs>
    <rect class="m-field" x="${x}" y="${y}" width="${w}" height="${h}"/>${roads}${places}
  </svg>`;
    }

    // ---- the tree of a recipe ------------------------------------------------------
    // Everything a recipe takes, down to the items to find: each ingredient made by a
    // recipe opens into that recipe's ingredients, and so on. An item that several of its
    // recipes take is one node, with an edge from each, so the tree may be a graph: each
    // node says how many times to craft it, or how many to find, in all, to make the
    // recipe once (a craft gives one item). An item that only a use gives (a key in a
    // chest) opens into the item used and what the use takes (the chest and its key); a
    // use that gives it only at times (one of the chest's prizes) is a dashed line, and
    // how many it takes is not known.
    /** The items a use of an item takes besides it: the key of a chest. */
    const takenBy = new Map();
    for (const i of Object.values(I))
      for (const u of i.used_with || []) {
        const c = current(u);
        takenBy.set(c, [...(takenBy.get(c) ?? []), i.name]);
      }
    /** Whether every use of `used` gives `n`: it is in the fixed text of each of its replies. */
    const alwaysGives = (used, n) =>
      !!I[used]?.use?.shapes.length &&
      I[used].use.shapes.every((sh) =>
        sh.parts.some((p) => typeof p === 'string' && p.includes(n))
      );
    /**
     * How the tree obtains an item: `{ recipe }` to craft it, `{ use, certain }` to get it by
     * using another item, or null for an item to find (or of no known way).
     */
    function sourceFor(n) {
      const i = I[n];
      // An item found in adventures is found, even if a recipe or a use also gives it.
      if (!i || i.sources.includes('adventure') || i.exclusive) return null;
      const made = i.made_by.filter((r) => R[r]);
      const recipe =
        made.find((r) => R[r].ingredients) ??
        made.find((r) => R[r].partial_ingredients.length) ??
        made[0];
      if (recipe) return { recipe };
      // An item given otherwise (a level-up, the lottery) is not looked for in a use.
      if (i.rewards?.length || !i.from_use?.length) return null;
      // Of the items whose use gives it: one found rather than crafted first (a crafted
      // one is a whole tree more), then one that always gives it.
      const uses = i.from_use
        .map(current)
        .filter((u) => I[u])
        .map((u) => ({ use: u, certain: alwaysGives(u, n) }));
      const rank = (x) => (I[x.use].made_by.length ? 2 : 0) + (x.certain ? 0 : 1);
      const [best, ...others] = uses.sort((a, b) => rank(a) - rank(b));
      return best ? { ...best, others: others.map((x) => x.use) } : null;
    }
    /** The level of an item a recipe makes, by its rarity (L2: 2, 0 if not given), else null. */
    function craftedLevel(n) {
      const r = I[n]?.rarity;
      return r?.[0] === 'L' ? Number(r.slice(1)) || 0 : null;
    }
    /** The tree of a recipe, as a graph in columns, or '' when it takes only items to find. */
    function recipeTree(name) {
      const nodes = new Map();
      // Depth first from the recipe, each item once; an item that leads back to itself
      // (a cycle) is not followed again.
      const visit = (key, source, path) => {
        if (nodes.has(key)) return;
        const node = { key, ...source, kids: [], parents: [], order: nodes.size };
        nodes.set(key, node);
        const parts = node.recipe
          ? ingredientsOf(R[node.recipe])
          : node.use
            ? [node.use, ...(takenBy.get(node.use) ?? [])].map((n) => [n, 1])
            : [];
        for (const [n, q] of parts) {
          const c = current(n);
          if (path.includes(c) || node.kids.some(([k]) => k === c)) continue;
          visit(c, sourceFor(c), [...path, c]);
          node.kids.push([c, q]);
        }
        post.push(node);
      };
      const post = [];
      const rootKey = madeItem(name) ?? '';
      visit(rootKey, { recipe: name }, [rootKey]);
      const top = nodes.get(rootKey);
      const found = (n) => n !== top && !n.recipe && !n.use && craftedLevel(n.key) === null;
      /** A use that gives the item only at times: how many uses it takes is not known. */
      const chance = (n) => !!n.use && !n.certain;
      /** Where the tree stops before reaching items to find: no recipe known, or not all of it. */
      const stopsAt = (n) =>
        n !== top && !found(n) && !n.use && (!n.recipe || !R[n.recipe].ingredients);
      if (top.kids.every(([k]) => found(nodes.get(k)))) return '';
      // Parents before children; the counts flow down. An unknown quantity (a partial list
      // of ingredients) makes unknown all that is below it. Showing what the owner lacks,
      // what they hold (by the inventory estimate) is taken off each item once all the
      // recipes that take it are counted, and an item they hold enough of is not drawn,
      // nor is what it takes.
      const lacking = !!P && state.tree === 'mancanti';
      const topo = post.reverse();
      for (const n of nodes.values()) n.need = 0;
      top.need = 1;
      for (const n of topo) {
        if (lacking && n !== top && n.need !== null)
          n.need = Math.max(0, n.need - (have(n.key)?.qty || 0));
        for (const [k, q] of n.kids) {
          const kid = nodes.get(k);
          const add = n.need === null || q === null || chance(n) ? null : n.need * q;
          if (add === 0) continue;
          kid.need = kid.need === null || add === null ? null : kid.need + add;
          kid.parents.push([n.key, add]);
        }
      }
      const shown = topo.filter((n) => n === top || n.need !== 0);
      for (const n of shown) n.out = n.kids.filter(([k]) => nodes.get(k).need !== 0);
      // A recipe whose ingredients the owner all holds: they can make it now.
      const ready = (n) =>
        lacking && (!!n.use || (!!n.recipe && !!R[n.recipe].ingredients)) && !n.out.length;
      if (lacking && !top.out.length)
        return treeSection(
          name,
          `<p class="note">${ESTIMATE}, hai già tutto quello che serve: puoi eseguirla ora.</p>`
        );
      // Columns: a level each, from the recipe's on the left (an item of level k is N - k
      // columns from it), always right of the recipes that take it, the items to find last.
      const N = lvl(name);
      const levelOf = (n) =>
        (n.recipe ? lvl(n.recipe) : found(n) ? 0 : craftedLevel(n.key)) || null;
      for (const n of shown) {
        const after = Math.max(-1, ...n.parents.map(([p]) => nodes.get(p).col)) + 1;
        const level = levelOf(n);
        n.col = N && level !== null ? Math.max(after, N - level) : after;
      }
      const last = Math.max(0, ...shown.filter((n) => !found(n)).map((n) => n.col)) + 1;
      for (const n of shown) if (found(n)) n.col = Math.max(n.col, last);
      // A level with nothing left to draw takes no column.
      const byCol = [];
      for (const n of [...shown].sort((a, b) => a.order - b.order)) (byCol[n.col] ??= []).push(n);
      const cols = byCol.filter(Boolean);
      // Fewer crossings: each column sorted a few times by where its parents are, then
      // by where its children are.
      const pos = new Map();
      const place = () => cols.forEach((c) => c.forEach((n, i) => pos.set(n.key, i)));
      const mean = (xs, own) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : own);
      place();
      for (let s = 0; s < 4; s++) {
        for (const c of cols.slice(1)) {
          c.sort(
            (a, b) =>
              mean(
                a.parents.map(([p]) => pos.get(p)),
                pos.get(a.key)
              ) -
              mean(
                b.parents.map(([p]) => pos.get(p)),
                pos.get(b.key)
              )
          );
          place();
        }
        for (const c of cols.slice(0, -1).reverse()) {
          c.sort(
            (a, b) =>
              mean(
                a.out.map(([k]) => pos.get(k)),
                pos.get(a.key)
              ) -
              mean(
                b.out.map(([k]) => pos.get(k)),
                pos.get(b.key)
              )
          );
          place();
        }
      }
      // Each node is as wide as its text: the item's rarity (or the recipe's level), its
      // name, and how many of it are needed when not one.
      const ctx = document.createElement('canvas').getContext('2d');
      const fonts = getComputedStyle(root);
      const width = (t, font) => {
        ctx.font = font;
        return Math.ceil(ctx.measureText(t).width);
      };
      const F = {
        tag: `11px ${fonts.getPropertyValue('--font-mono')}`,
        name: `12px ${fonts.getPropertyValue('--font-body')}`,
        n: `600 12px ${fonts.getPropertyValue('--font-body')}`,
      };
      const short = (t) => (t.length > 24 ? t.slice(0, 23) + '…' : t);
      for (const n of shown) {
        const item = n.key ? I[n.key] : null;
        n.tag = item ? `[${item.rarity || '?'}]` : R[name].level ? `[L${R[name].level}]` : '';
        n.label = short(n.key || name);
        n.count = n === top ? '' : n.need === null ? '×?' : n.need === 1 ? '' : `×${n.need}`;
        n.w =
          8 +
          (n.tag ? width(n.tag, F.tag) + 6 : 0) +
          width(n.label, F.name) +
          (n.count ? 6 + width(n.count, F.n) : 0) +
          10;
      }
      const rowH = 34,
        nodeH = 26,
        gap = 36,
        head = 26;
      const colW = cols.map((c) => Math.max(0, ...c.map((n) => n.w)));
      const colX = colW.map((_, c) => 1 + colW.slice(0, c).reduce((a, w) => a + w + gap, 0));
      const rows = Math.max(...cols.map((c) => c.length));
      cols.forEach((c, ci) =>
        c.forEach((n, ri) => {
          n.x = colX[ci];
          n.y = head + ((rows - c.length) * rowH) / 2 + ri * rowH;
        })
      );
      const Wd = colX.at(-1) + colW.at(-1) + 1,
        H = head + rows * rowH;
      // Each column's heading: the level of its items, if they share one.
      const heading = (c) => {
        if (c.length && c.every(found)) return 'DA TROVARE';
        const levels = new Set(c.map(levelOf));
        const [k] = levels;
        return levels.size === 1 && k ? `LIVELLO ${k}` : '';
      };
      const times = (k) => (k === null ? '? volte' : k === 1 ? 'una volta' : `${k} volte`);
      const titleOf = (n) => {
        if (n === top) return n.key ? `${n.key}, con la ricetta ${name}` : `Ricetta ${name}`;
        const split =
          n.parents.length > 1
            ? ` (${n.parents.map(([p, k]) => `${k ?? '?'} per ${p || name}`).join(', ')})`
            : '';
        const still = lacking ? 'ancora ' : '';
        if (found(n))
          return `${n.key}: ${still}da trovare ${n.need === null ? '?' : n.need}${split}`;
        const now = ready(n) ? ', puoi farlo ora' : '';
        if (n.use) {
          const or = n.others.length ? `; si ottiene anche usando ${listIt(n.others)}` : '';
          return chance(n)
            ? `${n.key}: ${still}da ottenere usando ${n.use}, che lo dà solo a volte${now}${split}${or}`
            : `${n.key}: ${still}da ottenere ${times(n.need)} usando ${n.use}${now}${split}${or}`;
        }
        if (!n.recipe)
          return `${n.key}: ${still}da craftare ${times(n.need)}, ricetta non ancora identificata${split}`;
        const open = R[n.recipe].ingredients ? '' : ', ingredienti non ancora tutti noti';
        return `${n.key}: ${still}da craftare ${times(n.need)} con la ricetta ${n.recipe}${open}${now}${split}`;
      };
      const edges = shown.flatMap((n) =>
        n.out.map(([k]) => {
          const kid = nodes.get(k),
            x1 = n.x + n.w,
            y1 = n.y + nodeH / 2,
            x2 = kid.x,
            y2 = kid.y + nodeH / 2,
            mx = (x1 + x2) / 2;
          return `<path class="g-edge${chance(n) ? ' chance' : ''}" data-a="${esc(n.key)}" data-b="${esc(k)}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
        })
      );
      const svgNodes = shown.map((n) => {
        // Where the tree stops before reaching items to find: dashed.
        const open = stopsAt(n);
        const cls = [
          'g-node',
          n === top && 'root sel',
          found(n) && 'found',
          open && 'open',
          ready(n) && 'ready',
        ]
          .filter(Boolean)
          .join(' ');
        const go =
          n !== top && I[n.key]
            ? ` data-go="item" data-name="${esc(n.key)}" tabindex="0" role="button" aria-label="${esc(titleOf(n))}"`
            : '';
        const tagW = n.tag ? width(n.tag, F.tag) + 6 : 0;
        return `<g class="${cls}" data-key="${esc(n.key)}"${go}><title>${esc(titleOf(n))}</title>
      <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${nodeH}" rx="5"/>
      ${n.tag ? `<text class="lv" x="${n.x + 8}" y="${n.y + 17}">${esc(n.tag)}</text>` : ''}
      <text x="${n.x + 8 + tagW}" y="${n.y + 17}">${esc(n.label)}</text>
      ${n.count ? `<text class="n" x="${n.x + n.w - 10}" y="${n.y + 17}" text-anchor="end">${esc(n.count)}</text>` : ''}</g>`;
      });
      const partial = shown.some((n) => n.need === null);
      const stops = shown.some(stopsAt);
      const odds = shown.some((n) => chance(n) && n.out.length);
      const goal = madeItem(name) ? `fare ${esc(madeItem(name))}` : 'eseguire la ricetta';
      const notes = [
        lacking
          ? `Per ${goal} una volta, ${ESTIMATE.toLowerCase()}: solo quello che ti manca, quante volte va ancora craftato o, nell'ultima colonna, quanti vanno ancora trovati. In verde, quello che puoi già craftare. Tocca un oggetto per aprirlo.`
          : `Per ${goal} una volta: ogni oggetto, quante volte va craftato o, nell'ultima colonna, quanti vanno trovati. Tocca un oggetto per aprirlo.`,
        stops
          ? "Dove una ricetta, o parte dei suoi ingredienti, non è ancora nota (bordo tratteggiato), l'albero si ferma."
          : '',
        odds
          ? 'Linea tratteggiata: un oggetto che si ottiene usandone un altro, che però lo dà solo a volte; quante volte va usato non si sa.'
          : '',
        partial ? 'Con ×? la quantità non è ancora nota.' : '',
      ].filter(Boolean);
      return treeSection(
        name,
        `${notes.map((t) => `<p class="note">${t}</p>`).join('')}<div class="tree-box"><svg class="tree" viewBox="0 0 ${Wd} ${H}" width="${Wd}" height="${H}" role="img" aria-label="Albero della ricetta ${esc(name)}">
    ${cols.map((c, ci) => `<text class="g-col" x="${colX[ci]}" y="14">${heading(c)}</text>`).join('')}
    ${edges.join('')}
    ${svgNodes.join('')}
  </svg></div>`
      );
    }
    /** The tree's section: its title and, with the owner's state, what it shows, on the right. */
    function treeSection(name, body) {
      const modes = [
        ['mancanti', 'Ti manca', `${ESTIMATE}, solo quello che ti manca`],
        ['tutto', 'Tutto', 'Tutto quello che serve'],
      ];
      const toggle = P
        ? `<div class="filters" role="group" aria-label="Cosa mostrare">${modes
            .map(
              ([k, label, title]) =>
                `<button data-tree="${k}" aria-pressed="${state.tree === k}" title="${title}">${label}</button>`
            )
            .join('')}</div>`
        : '';
      return `<div class="section tree-section"><div class="tree-head"><h3>Albero della ricetta</h3>${toggle}</div>${body}</div>`;
    }

    // ---- view --------------------------------------------------------------------
    function filtersHtml(kind, defs) {
      return `<div class="filters" role="group" aria-label="Filtri">${Object.entries(defs)
        .map(
          ([k, [label, , title]]) =>
            `<button data-filter="${kind}" data-key="${k}" aria-pressed="${state.filter[kind] === k}"${title ? ` title="${title}"` : ''}>${label}</button>`
        )
        .join('')}</div>`;
    }
    // Each tab shows how many entries it would list, with the search and its own filter,
    // as Telegram's unread counts: the wiki's totals, and while searching, where the
    // matches are, so a search made in the wrong tab still points to the right one. No
    // count is shown for none.
    const TAB_ROWS = {
      ricette: recipeRows,
      oggetti: itemRows,
      luoghi: locRows,
      pakkomon: pakkomonRows,
    };
    function renderTabs(q) {
      $('#tabs [data-tab="pakkomon"]').hidden = !pakkomonTab;
      root.querySelectorAll('#tabs button:not([hidden])').forEach((b) => {
        b.setAttribute('aria-selected', b.dataset.tab === state.tab);
        const n = TAB_ROWS[b.dataset.tab](q).length;
        b.querySelector('.badge').textContent = n ? String(n) : '';
        if (n)
          b.setAttribute(
            'aria-label',
            `${b.querySelector('.tab-name').textContent}, ${n} risultati`
          );
        else b.removeAttribute('aria-label');
      });
    }
    function render() {
      const q = fold($('#q').value.trim());
      renderTabs(q);
      const v = $('#view');
      const list = (rows, rowFn) =>
        rows.map(rowFn).join('') ||
        `<p class="empty" style="padding:12px">Nessun risultato con questa ricerca e questo filtro.</p>`;
      let rows,
        rowFn,
        detail,
        filters = '',
        extra = '';
      if (state.tab === 'ricette') {
        rows = recipeRows(q);
        rowFn = recipeRow;
        detail = recipePage(state.sel.ricette ?? rows[0]?.name);
        filters = filtersHtml('ricette', RECIPE_FILTERS);
      }
      if (state.tab === 'oggetti') {
        rows = itemRows(q);
        rowFn = itemRow;
        detail = itemDetail(state.sel.oggetti ?? rows[0]?.name);
        filters = filtersHtml('oggetti', ITEM_FILTERS);
      }
      if (state.tab === 'luoghi') {
        rows = locRows(q);
        rowFn = locRow;
        const shown = state.sel.luoghi ?? rows[0]?.name;
        detail = locDetail(shown);
        extra = `<div class="graphbox">${mapSvg(shown)}</div><div class="legend"><span>bordo tratteggiato: serve un oggetto per entrare</span>${P ? "<span>riempito d'oro: visitato da te</span>" : ''}<span>freccia: si va solo in quel verso</span>${Object.values(L).some((l) => l.secret) ? '<span>strada tratteggiata: porta a un luogo segreto, che compare tra le destinazioni solo a chi ha il suo oggetto</span>' : ''}</div>`;
      }
      if (state.tab === 'pakkomon') {
        rows = pakkomonRows(q);
        rowFn = pakkomonRow;
        detail = pakkomonPage(state.sel.pakkomon ?? rows[0]?.name);
        filters = MY_PK.some((p) => p.gone) ? filtersHtml('pakkomon', PAKKOMON_FILTERS) : '';
      }
      const curSel = state.sel[state.tab] ?? rows[0]?.name;
      $('#side-tools').innerHTML = filters;
      $('#list').innerHTML = list(rows, rowFn);
      v.innerHTML = `${extra}<section class="detail" aria-live="polite">${detail}</section>`;
      // In a recipe's tree, an item's edges stand out while it is pointed at.
      v.querySelectorAll('.tree .g-node').forEach((el) => {
        const hi = (on) =>
          el
            .closest('svg')
            .querySelectorAll('.g-edge')
            .forEach((e) =>
              e.classList.toggle(
                'hi',
                on && (e.dataset.a === el.dataset.name || e.dataset.b === el.dataset.name)
              )
            );
        el.addEventListener('mouseenter', () => hi(true));
        el.addEventListener('mouseleave', () => hi(false));
      });
      root
        .querySelectorAll('#list .row')
        .forEach((b) => b.setAttribute('aria-current', b.dataset.sel === curSel));
    }
    function go(kind, name) {
      if (kind === 'item' && !I[name] && W.renames?.[name]) name = W.renames[name]; // old name of a renamed item
      const tab = { recipe: 'ricette', item: 'oggetti', loc: 'luoghi', pakkomon: 'pakkomon' }[kind];
      state.sel[tab] = name;
      if (state.tab !== tab) {
        state.tab = tab;
        $('#q').value = '';
      }
      pushUrl();
      render();
      const cur = root.querySelector(`.row[aria-current="true"]`);
      cur?.scrollIntoView({ block: 'nearest' });
      showDetail();
    }
    // Brings the selected entry into view: below the list on a narrow screen, else back
    // up the page when it was scrolled past the entry's start.
    function showDetail() {
      const d = $('.detail');
      if (d && (matchMedia('(max-width: 860px)').matches || d.getBoundingClientRect().top < 0))
        d.scrollIntoView({ block: 'start' });
    }

    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-go],[data-sel],[data-filter],[data-tab],[data-tree]');
      if (!t) return;
      if (t.dataset.tree) {
        state.tree = t.dataset.tree;
        store.set('ib-tree', state.tree);
        render();
        return;
      }
      if (t.dataset.tab) {
        state.tab = t.dataset.tab;
        pushUrl();
        render();
        return;
      }
      if (t.dataset.filter) {
        state.filter[t.dataset.filter] = t.dataset.key;
        render();
        return;
      }
      if (t.dataset.sel) {
        state.sel[state.tab] = t.dataset.sel;
        pushUrl();
        render();
        showDetail();
        return;
      }
      if (t.dataset.go) {
        // A link opened elsewhere (a new tab, a new window) is left to the browser.
        if (
          t.tagName === 'A' &&
          (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        )
          return;
        e.preventDefault();
        go(t.dataset.go, t.dataset.name);
      }
    });
    root.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.g-node[data-go]')) {
        e.preventDefault();
        go(e.target.dataset.go, e.target.dataset.name);
      }
    });
    $('#q').addEventListener('input', render);
    // Back and forward (and a fragment typed in the address bar) show their tab and entry.
    if (onHistory) window.removeEventListener('popstate', onHistory);
    onHistory = () => {
      if (!root.isConnected || !applyHash()) return;
      // An address that is not the entry's own (an old recipe link) is replaced by it.
      if (location.hash !== toHash()) history.replaceState(null, '', toHash());
      render();
      root.querySelector('.row[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('popstate', onHistory);
    // A window that changes shape enough draws the map again, along its other axis.
    if (onResize) window.removeEventListener('resize', onResize);
    onResize = () => {
      if (root.isConnected && state.tab === 'luoghi' && mapAxis() !== mapShown) render();
    };
    window.addEventListener('resize', onResize);

    // How often the estimate agreed with the bot's /ricetta lists, rounded down: 100% only when always.
    const check = P?.inventory_check;
    const agreement =
      check && check.compared > 0
        ? (Math.floor((check.agreed * 1000) / check.compared) / 10).toLocaleString('it-IT')
        : null;
    if (W.trivia?.length)
      $('#trivia').innerHTML = `<summary>Curiosità dai canali</summary>${W.trivia
        .map(
          (t) =>
            `<h4>${esc(t.title)}</h4><p class="note">${esc(t.channel)}${t.date ? `, ${fmtDate(t.date)}` : ''}</p>${t.text
              .split(/\n\s*\n/u)
              .map((p) => `<p class="flavor">${esc(p)}</p>`)
              .join('')}`
        )
        .join('')}`;
    const estimate = !P
      ? ''
      : " Le quantità possedute sono una stima ricostruita dallo storico: l'inventario reale può differire." +
        (agreement === null
          ? ''
          : ` La percentuale della stima, nel pannello «Importa», dice quante volte, a ogni /ricetta, la stima dava per ogni ricetta gli stessi ingredienti mancanti del bot (${check.agreed} su ${check.compared}): se non è 100%, alcune interazioni (oggetti trovati, dati, ricevuti o usati) sono avvenute fuori dalle chat importate.`);
    $('#foot').textContent =
      `Dati generati il ${fmtDate(W.generated)}.${estimate} Le ricette si conoscono solo dopo averne posseduto metà degli ingredienti, e l'output solo dopo averle eseguite: ciò che manca qui non è stato ancora osservato.`;
    render();
  };
})();
