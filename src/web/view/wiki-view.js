/* global window, document, localStorage, location, history, matchMedia, URLSearchParams */
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
    <button role="tab" data-tab="catene"><span class="tab-name">Catene</span><span class="badge" aria-hidden="true"></span></button>
  </div>
  <div class="side-tools" id="side-tools"></div>
  <div class="list" id="list"></div>
</aside>
<div class="wrap content">
  <div id="view"></div>
  <details id="rules" class="rules"></details>
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
    // Rarity names come from the bot's /faq legend (wiki.json "rarities"); "Ln" covers L1, L2, ...
    const RARITY_NAMES = {
      ...Object.fromEntries(
        Object.entries(W.rarities || {}).map(([k, v]) => [k === 'Ln' ? 'L' : k, v])
      ),
      q: 'rarità sconosciuta',
    };
    const rarityName = (g) =>
      RARITY_NAMES[g] ||
      (W.rarity_hypotheses?.[g]
        ? W.rarity_hypotheses[g].split(':')[0] + ' (ipotesi)'
        : `rarità ${g}, non spiegata nella /faq`);
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
    const recipeLink = (n) =>
      `<span class="chip">${lvlTag(R[n])} <button class="link" data-go="recipe" data-name="${esc(n)}">${esc(n)}</button></span>`;
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
      const tab = { item: 'oggetti', recipe: 'ricette', loc: 'luoghi' }[kind];
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
      sel: { ricette: null, oggetti: null, luoghi: null, catene: null },
      filter: { ricette: 'tutte', oggetti: 'tutti' },
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
    const TABS = ['oggetti', 'ricette', 'luoghi', 'catene'];
    // ---- the URL -------------------------------------------------------------------
    // `#tab` or `#tab/slug`. A slug is the name folded to lower-case ASCII letters and
    // digits, with `_` in place of everything else (`l'oro` is `l_oro`); names with the
    // same slug take `_2`, `_3`, ... in the order of their names, so each is one entry.
    const ENTRIES = { ricette: R, oggetti: I, luoghi: L, catene: R };
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
    const recipeSlugs = slugTable(Object.keys(R));
    const SLUGS = {
      ricette: recipeSlugs,
      catene: recipeSlugs,
      oggetti: slugTable(Object.keys(I)),
      luoghi: slugTable(Object.keys(L)),
    };
    // The old names of renamed items lead to the item, where no current name has the slug.
    for (const [old, name] of Object.entries(W.renames || {}))
      if (I[name] && !SLUGS.oggetti.bySlug.has(slugify(old)))
        SLUGS.oggetti.bySlug.set(slugify(old), name);
    // A recipe whose item is known is shown on the item's page, so its address is the
    // item's, with the list it was opened from: `#oggetti/una_torre?lista=ricette`, and
    // `&ricetta=<slug>` when several recipes make the item. `#ricette/<slug>` stays the
    // address of a recipe whose item is not known, and leads to the item's otherwise.
    const LISTS = ['ricette', 'catene'];
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
      if (tab === 'oggetti' && LISTS.includes(list)) {
        const made = found ? I[found].made_by.filter((n) => R[n]) : [];
        const named = SLUGS.ricette.bySlug.get(params.get('ricetta') ?? '');
        return { tab: list, name: made.includes(named) ? named : (made[0] ?? null) };
      }
      return { tab, name: found };
    }
    /** The address of an entry of a tab (its first entry when `name` is null). */
    function hashOf(tab, name) {
      const item = LISTS.includes(tab) && name ? madeItem(name) : null;
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
     * the item it makes: its bubbles, notes, chain, and the owner's lines.
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
      const up = upstream(r),
        down = downstream(r),
        cand = candidates(r);
      const out = r.output
        ? ''
        : `<p class="note">L'oggetto che si ottiene compare solo dopo aver eseguito la ricetta.</p>` +
          (cand.length
            ? `<details class="cand"><summary>${cand.length} oggetti L${r.level} senza ricetta nota: possibili candidati</summary>${chips(cand, itemLink)}</details>`
            : '');
      const flow =
        up.length || down.length
          ? sec(
              'Catena',
              `<div class="flow">
      <div class="col">${up.length ? up.map((n) => `<div class="box">${recipeLink(n)}</div>`).join('') : `<span class="empty">solo oggetti base</span>`}</div>
      <span class="arrow">→</span><div class="me">${esc(name)}</div><span class="arrow">→</span>
      <div class="col">${down.length ? down.map((n) => `<div class="box">${recipeLink(n)}</div>`).join('') : `<span class="empty">${r.output ? 'output non usato altrove' : '?'}</span>`}</div>
    </div>`
            )
          : '';
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
      return { r, detailBubble, craftBubble, ingNote, out, flow, myLines, myNote };
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
      const { r, detailBubble, craftBubble, ingNote, out, flow, myLines, myNote } =
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
    ${opensLines(r.output)}</div>
    ${detailBubble}
    ${ingNote}
    ${craftBubble}
    ${out}
    ${flow}
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
      inutili: ['Non usati', (i) => !i.used_in.length],
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
              [h ? `Ne hai ${h.exact ? '' : 'almeno '}${h.qty}.` : 'Non ne hai neanche uno.'],
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
    ${opensLines(name)}
    ${
      // A "+" item drops in one place: where, right under its name.
      i.exclusive
        ? `<p class="makes">${i.locations.length ? `Esce solo qui: ${i.locations.map((k) => goLink('loc', k, at(k))).join(', ')}` : '<span class="makes-unknown">Esce in un solo luogo, non ancora identificato.</span>'}</p>`
        : ''
    }
    ${W.rarity_hypotheses?.[rarityGroup(i.rarity)] ? `<p class="note">Rarità ${esc(rarityGroup(i.rarity))}: ${esc(W.rarity_hypotheses[rarityGroup(i.rarity)])}.</p>` : ''}</div>
    ${itemBubble(i)}
    ${i.sources_inferred ? '<p class="note">Come si ottiene è dedotto dalla rarità: il bot non lo ha ancora detto.</p>' : ''}
    ${recipes
      .map(
        ([n, p]) =>
          sec(`Ricetta · ${esc(n)} ${lvlTag(p.r)}`, (p.craftBubble || p.detailBubble) + p.ingNote) +
          p.flow
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
      const roads =
        m.roads.map((r) => road(r, 'm-verge')).join('') +
        m.roads.map((r) => road(r, `m-road${r.a === sel || r.b === sel ? ' hi' : ''}`)).join('') +
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

    // ---- chains graph: recipes linked when one's output is another's ingredient ----
    function chainsSvg(sel) {
      const linked = new Set(),
        edges = [];
      for (const r of Object.values(R))
        for (const d of downstream(r)) {
          edges.push([r.name, d]);
          linked.add(r.name);
          linked.add(d);
        }
      const levels = [...new Set([...linked].map(lvl))].sort((a, b) => a - b);
      const cols = levels.map((lv) =>
        [...linked].filter((n) => lvl(n) === lv).sort((a, b) => a.localeCompare(b, 'it'))
      );
      // barycentre ordering, a few sweeps
      const pos = new Map();
      const place = () => cols.forEach((c) => c.forEach((n, i) => pos.set(n, i)));
      place();
      for (let s = 0; s < 6; s++) {
        for (const c of cols.slice(1)) {
          c.sort((a, b) => bary(a, true) - bary(b, true));
          place();
        }
        for (const c of cols.slice(0, -1).reverse()) {
          c.sort((a, b) => bary(a, false) - bary(b, false));
          place();
        }
      }
      function bary(n, fromLeft) {
        const nb = edges
          .filter(([a, b]) => (fromLeft ? b === n : a === n))
          .map(([a, b]) => pos.get(fromLeft ? a : b));
        return nb.length ? nb.reduce((x, y) => x + y, 0) / nb.length : pos.get(n);
      }
      const colW = 250,
        nodeW = 200,
        rowH = 34,
        top = 40;
      const maxRows = Math.max(...cols.map((c) => c.length), 1);
      const xy = new Map();
      cols.forEach((c, ci) => {
        const off = ((maxRows - c.length) * rowH) / 2;
        c.forEach((n, ri) => xy.set(n, { x: 16 + ci * colW, y: top + off + ri * rowH }));
      });
      const Wd = 16 + cols.length * colW,
        H = top + maxRows * rowH + 10;
      const short = (s) => (s.length > 26 ? s.slice(0, 25) + '…' : s);
      return {
        count: linked.size,
        edges: edges.length,
        svg: `<svg viewBox="0 0 ${Wd} ${H}" width="${Wd}" height="${H}" role="img" aria-label="Catene di ricette">
    ${levels.map((lv, ci) => `<text class="g-col" x="${16 + ci * colW}" y="20">LIVELLO ${lv || '?'}</text>`).join('')}
    ${edges
      .map(([a, b]) => {
        const p = xy.get(a),
          q = xy.get(b),
          x1 = p.x + nodeW,
          y1 = p.y + 13,
          x2 = q.x,
          y2 = q.y + 13,
          mx = (x1 + x2) / 2;
        return `<path class="g-edge" data-a="${esc(a)}" data-b="${esc(b)}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
      })
      .join('')}
    ${[...linked]
      .map((n) => {
        const p = xy.get(n);
        return `<g class="g-node${n === sel ? ' sel' : ''}" data-go="recipe" data-name="${esc(n)}" tabindex="0"><title>${esc(n)}${R[n]?.output ? ' → ' + esc(R[n].output) : ''}</title>
      <rect x="${p.x}" y="${p.y}" width="${nodeW}" height="26" rx="5"/>
      <text x="${p.x + 8}" y="${p.y + 17}">${esc(short(n))}</text></g>`;
      })
      .join('')}
  </svg>`,
      };
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
      catene: recipeRows,
    };
    function renderTabs(q) {
      root.querySelectorAll('#tabs button').forEach((b) => {
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
        extra = `<div class="graphbox">${mapSvg(shown)}</div><div class="legend"><span>bordo tratteggiato: serve un oggetto per entrare</span>${P ? "<span>riempito d'oro: visitato da te</span>" : ''}<span>freccia: si va solo in quel verso</span></div>`;
      }
      // The recipes again, in the graph of their chains: a recipe opens below it.
      if (state.tab === 'catene') {
        rows = recipeRows(q);
        rowFn = recipeRow;
        // The same recipes as Ricette, with the same filter: shown here too.
        filters = filtersHtml('ricette', RECIPE_FILTERS);
        const g = chainsSvg(state.sel.catene ?? rows[0]?.name);
        detail = recipePage(state.sel.catene ?? rows[0]?.name);
        extra = `<div class="section"><p class="note">${g.count} ricette collegate da ${g.edges} passaggi: una freccia va da una ricetta a quella che usa il suo output. Tocca una ricetta per aprirla. Le catene crescono man mano che si scoprono gli output.</p>
      <div class="graphbox">${g.svg}</div></div>`;
      }
      const curSel = state.sel[state.tab] ?? rows[0]?.name;
      $('#side-tools').innerHTML = filters;
      $('#list').innerHTML = list(rows, rowFn);
      v.innerHTML = `${extra}<section class="detail" aria-live="polite">${detail}</section>`;
      v.querySelectorAll('.g-node[data-go="recipe"]').forEach((el) => {
        const hi = (on) =>
          v
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
      // A recipe opened from Catene stays there, in the graph.
      const tab =
        kind === 'recipe' && state.tab === 'catene'
          ? 'catene'
          : { recipe: 'ricette', item: 'oggetti', loc: 'luoghi' }[kind];
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
      const t = e.target.closest('[data-go],[data-sel],[data-filter],[data-tab]');
      if (!t) return;
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
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.g-node')) {
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
    if (W.rules?.length)
      $('#rules').innerHTML =
        `<summary>Regole del gioco (dalla /faq del bot)</summary>${W.rules.map((r) => `<p class="note">${esc(r)}</p>`).join('')}`;
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
