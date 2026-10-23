/* global window, localStorage, location, history, matchMedia */
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
    <button role="tab" data-tab="ricette"><span class="tab-name">Ricette</span><span class="badge" aria-hidden="true"></span></button>
    <button role="tab" data-tab="oggetti"><span class="tab-name">Oggetti</span><span class="badge" aria-hidden="true"></span></button>
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

    // Freshness: groups hold years of history and the game changes, so facts last
    // confirmed long before the data was generated are flagged as possibly outdated.
    const OLD_DAYS = 365;
    const isOld = (d) =>
      d && W.generated && (new Date(W.generated) - new Date(d)) / 864e5 > OLD_DAYS;
    const freshness = (d) =>
      !d
        ? ''
        : isOld(d)
          ? `<span class="stale" title="Ultima conferma più di un anno prima della generazione dei dati">· visto l'ultima volta nel ${new Date(d).getFullYear()}: potrebbe essere superato</span>`
          : `<span>· ultima conferma ${fmtDate(d)}</span>`;

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
      `<div class="bubble">${lines.map((l) => `<div class="b-line">${l}</div>`).join('')}</div>`;
    /** A plain link, as a name inside a bot's reply. */
    const goLink = (kind, n, text = n) =>
      `<button class="link" data-go="${kind}" data-name="${esc(n)}">${esc(text)}</button>`;
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
     * Where a channel's card stands behind what the page shows: the card's channel and
     * date, what of it the page still shows (`what`: field -> its name), and its notes.
     * `dated`: the card's fields give way to what the bot showed later (a recipe's); else
     * a card only adds (a place's).
     */
    const channelSec = (card, what, dated = true) => {
      if (!card) return '';
      const from = `una scheda di <b>${esc(card.name)}</b>${card.date ? ` del ${fmtDate(card.date)}` : ''}`;
      const shown = card.fields.map((f) => what[f]).filter(Boolean);
      // "lo" for one masculine singular field ("il livello"), else "li".
      const one = shown.length === 1 && !/^(?:gli|le|i) /u.test(shown[0]);
      const later = dated
        ? `: il bot non ${one ? 'lo' : 'li'} ha ancora ${one ? 'mostrato' : 'mostrati'} più di recente`
        : '';
      const lead = shown.length
        ? `${listIt(shown).replace(/^./, (c) => c.toUpperCase())} ${shown.length === 1 ? 'viene' : 'vengono'} da ${from}${later}.`
        : `C'è anche ${from}; ciò che il bot ha mostrato dopo ha la precedenza.`;
      const notes = card.notes.map((n) => `<p class="note">${esc(n)}</p>`).join('');
      return sec('Dai canali', `<p class="note">${lead}</p>${notes}`);
    };
    const chips = (xs, f) =>
      xs.length
        ? `<div class="chips">${xs.map(f).join('')}</div>`
        : `<p class="empty">Nessuna osservata.</p>`;

    // ---- state -------------------------------------------------------------------
    const state = {
      tab: 'ricette',
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
    const TABS = ['ricette', 'oggetti', 'luoghi', 'catene'];
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
    /** The tab and entry of a fragment, or null if it names no tab (e.g. `#main`). */
    function fromHash(hash) {
      const [tab, ...rest] = hash.replace(/^#/u, '').split('/');
      if (!TABS.includes(tab)) return null;
      // An entry the wiki no longer has (an old link, a rebuilt wiki) is not selected.
      const name = SLUGS[tab].bySlug.get(rest.join('/')) ?? null;
      return { tab, name: name !== null && ENTRIES[tab][name] ? name : null };
    }
    function toHash() {
      const name = state.sel[state.tab];
      const slug = name ? SLUGS[state.tab].byName.get(name) : undefined;
      return `#${state.tab}${slug ? '/' + slug : ''}`;
    }
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
      state.tab = TABS.includes(store.get('ib-tab')) ? store.get('ib-tab') : 'ricette';
    history.replaceState(null, '', toHash());

    // ---- recipes -----------------------------------------------------------------
    const RECIPE_FILTERS = {
      tutte: ['Tutte', () => true],
      ignoto: ['Output ignoto', (r) => !r.output],
      noto: ['Output noto', (r) => !!r.output],
      contese: ['Ingredienti contesi', (r) => contention(r) > 0],
      catena: ['In una catena', (r) => upstream(r).length || downstream(r).length],
    };
    if (P) RECIPE_FILTERS.pronte = ['Pronte per te (stima)', readyEst];
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
    function recipeDetail(name) {
      const r = R[name];
      if (!r) return `<p class="empty">Seleziona una ricetta dall'elenco.</p>`;
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
      // /esamina of the recipe, for any player: everything it needs.
      const detailBubble = ingredients.length
        ? bubble([`per fare la ricetta <b>${esc(name)}</b> serve:`, ...ingredients.map(ingLine)])
        : '';
      // Its craft, as the bot tells it: what goes in, the story, what comes out.
      const craftBubble =
        r.output || r.craft_text
          ? bubble([
              ...(r.ingredients
                ? [
                    'prendi in mano:',
                    ...Object.entries(r.ingredients).map(([n, q]) => `- ${itemRef(n)} x${q}`),
                  ]
                : []),
              ...(r.craft_text ? [esc(r.craft_text)] : []),
              ...(r.output ? [`Ottieni: ${itemRef(r.output, true)}!`] : []),
            ])
          : '';
      const up = upstream(r),
        down = downstream(r),
        cand = candidates(r);
      const out = r.output
        ? ''
        : `<p class="note">Output non ancora osservato: compare solo dopo aver eseguito la ricetta.</p>` +
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
      const personal = P
        ? personalSec([
            me
              ? `Eseguita ${me.crafted} ${me.crafted === 1 ? 'volta' : 'volte'}, l'ultima il ${fmtDate(me.last_crafted)}.`
              : 'Mai eseguita.',
            r.ingredients
              ? readyEst(r)
                ? 'Secondo la stima hai tutti gli ingredienti.'
                : 'Secondo la stima ti mancano degli ingredienti.'
              : '',
            ingredients.length
              ? `Ne hai, secondo la stima: ${ingredients
                  .map(([n, q]) => {
                    const h = have(n);
                    return `${goLink('item', current(n))} <span class="mine${(h?.qty || 0) >= (q || 1) ? ' ok' : ''}">${haveTxt(h)}${q ? '/' + q : ''}</span>`;
                  })
                  .join(', ')}.`
              : '',
          ])
        : '';
      return `<div class="head"><div class="kicker">${lvlTag(r)}<span>Ricetta</span>${freshness(r.last_seen)}</div>
    <h2>${esc(name)}</h2></div>
    ${detailBubble}
    ${
      r.ingredients
        ? ''
        : ingredients.length
          ? '<p class="note">Lista parziale: ricavata da /esamina sugli oggetti, quantità ignote.</p>'
          : `<p class="note">Vista solo nell'elenco di /ricetta. Usa /esamina ${esc(name)} per vederne gli ingredienti.</p>`
    }
    ${craftBubble}
    ${out}
    ${flow}
    ${channelSec(r.channel, { level: 'il livello', ingredients: 'gli ingredienti', output: "l'oggetto ottenuto" })}
    ${personal}`;
    }

    function personalSec(lines) {
      const body = lines
        .filter(Boolean)
        .map((l) => `<p class="note">${l}</p>`)
        .join('');
      return body
        ? `<div class="section personal"><h3>I tuoi dati · @${esc(P.player)}</h3>${body}</div>`
        : '';
    }

    // ---- items -------------------------------------------------------------------
    const ITEM_FILTERS = {
      tutti: ['Tutti', () => true],
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
    function useHtml(u) {
      const ev = u.consumed_evidence,
        plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
      const result =
        {
          fixed: `Risultato sempre uguale (${plural(u.observations, 'uso osservato', 'usi osservati')}).`,
          variable: `Risultato variabile: ${u.outcomes.length} esiti diversi su ${u.observations} usi.`,
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
      const shown = u.outcomes
        .slice(0, 4)
        .map((t) => bubble(t.split('\n').map(linkItems)))
        .join('');
      const more =
        u.outcomes.length > 4
          ? `<p class="note">… e altri ${u.outcomes.length - 4} esiti.</p>`
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
    function itemDetail(name) {
      const i = I[name];
      if (!i) return `<p class="empty">Seleziona un oggetto dall'elenco.</p>`;
      const h = have(name),
        seenAt = P?.items[name]?.first_seen;
      const personal = P
        ? personalSec([
            h
              ? `Ne hai ${h.exact ? '' : 'almeno '}${h.qty} (stima; ultimo riscontro con ${VIA[h.via] || h.via} il ${fmtDate(h.date)}).`
              : 'Non ne hai, secondo la stima.',
            seenAt ? `Visto per la prima volta il ${fmtDate(seenAt)}.` : '',
          ])
        : '';
      return `<div class="head"><div class="kicker">${tag(i.rarity)}<span>${esc(rarityName(rarityGroup(i.rarity)))}</span>${i.usable ? '<span>· usabile</span>' : ''}${i.gives_title ? `<span>· dà ${i.title ? `il titolo «${esc(i.title)}»` : 'un titolo'}</span>` : ''}${freshness(i.last_seen)}</div>
    <h2>${esc(name)}</h2>
    ${i.exclusive ? `<p class="note">Il + nella rarità indica un oggetto che esce in un solo luogo.</p>` : ''}
    ${W.rarity_hypotheses?.[rarityGroup(i.rarity)] ? `<p class="note">Rarità ${esc(rarityGroup(i.rarity))}: ${esc(W.rarity_hypotheses[rarityGroup(i.rarity)])}.</p>` : ''}</div>
    ${itemBubble(i)}
    ${
      i.exclusive
        ? `<p class="note">${i.locations.length ? `Esce solo qui: ${i.locations.map(locLink).join(', ')}.` : 'Esce in un solo luogo, non ancora identificato.'}</p>`
        : ''
    }
    ${i.sources_inferred ? '<p class="note">Come si ottiene è dedotto dalla rarità: il bot non lo ha ancora detto.</p>' : ''}
    ${
      i.old_names?.length
        ? sec(
            'Nomi precedenti',
            i.old_names
              .map(
                (o) =>
                  `<p class="note"><b>${esc(o.name)}</b>, visto l'ultima volta il ${fmtDate(o.last_seen)}. Rinomina dedotta: ${esc(o.evidence)}.</p>`
              )
              .join('')
          )
        : ''
    }
    ${i.use ? sec('Effetto di /usa', useHtml(i.use)) : ''}
    ${itemCardSec(i.channel)}
    ${personal}`;
    }

    /** What an item card says: how the item is obtained, what it is for, what a use does to it. */
    function itemCardSec(card) {
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
      return sec(
        'Dai canali',
        `<p class="note">Da una scheda di <b>${esc(card.name)}</b>${card.date ? ` del ${fmtDate(card.date)}` : ''}${card.fields.includes('rarity') ? '; anche la rarità, che il bot non ha mostrato più di recente' : ''}.</p>` +
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
    function locDetail(name) {
      const l = L[name];
      if (!l) return `<p class="empty">Seleziona un luogo sulla mappa o dall'elenco.</p>`;
      const excl = l.exclusive_items;
      const inbound = Object.values(L)
        .filter((o) => o.exits.includes(name))
        .map((o) => o.name);
      const pl = P?.locations[name];
      const personal = P
        ? personalSec([
            pl?.visited ? 'Visitato.' : 'Mai visitato.',
            pl?.adventures ? `${pl.adventures} avventure fatte qui.` : '',
          ])
        : '';
      return `<div class="head"><div class="kicker"><span>Luogo</span>${l.requires_item ? '<span>· serve un oggetto per entrare</span>' : ''}${l.secret ? '<span>· segreto</span>' : ''}</div>
    <h2>${esc(l.label)}</h2></div>
    ${(l.required_items || []).length ? sec('Oggetti necessari', chips(l.required_items, itemLink)) : ''}
    ${(l.sight_items || []).length ? sec('Per vederlo tra le destinazioni', `<p class="note">Senza questi oggetti il luogo non compare nel pannello di viaggio.</p>` + chips(l.sight_items, itemLink)) : ''}
    ${
      l.unlock_texts.length
        ? sec(
            'Come si sblocca',
            l.unlock_texts.map((u) => `<p class="flavor">${esc(u)}</p>`).join('')
          )
        : l.requires_item && !(l.required_items || []).length
          ? sec(
              'Come si sblocca',
              `<p class="note">Il bot risponde «Forse ti manca qualcosa!»: serve un oggetto non ancora identificato.</p>`
            )
          : ''
    }
    ${sec(
      'Collegamenti',
      chips(
        [...new Set([...l.exits, ...inbound])],
        (n) => `<span class="chip">${locLink(n)}</span>`
      )
    )}
    ${sec('Oggetti esclusivi', chips(excl, itemLink))}
    ${channelSec(l.channel, { items: 'gli oggetti esclusivi', route: 'il percorso', access: "l'oggetto per entrare", sight: "l'oggetto per vederlo" }, false)}
    ${personal}`;
    }
    function mapSvg() {
      const names = Object.keys(L),
        idx = new Map(names.map((n, i) => [n, i]));
      const edges = [];
      for (const l of Object.values(L))
        for (const x of l.exits) {
          const a = idx.get(l.name),
            b = idx.get(x);
          if (
            b !== undefined &&
            !edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))
          )
            edges.push([a, b]);
        }
      const Wd = 760,
        H = 460,
        n = names.length;
      const P = names.map((_, i) => ({
        x: Wd / 2 + 200 * Math.cos((i / n) * 2 * Math.PI),
        y: H / 2 + 160 * Math.sin((i / n) * 2 * Math.PI),
      }));
      for (let it = 0; it < 500; it++) {
        // deterministic spring layout
        const F = P.map(() => ({ x: 0, y: 0 }));
        for (let i = 0; i < n; i++)
          for (let j = i + 1; j < n; j++) {
            const dx = P[i].x - P[j].x,
              dy = P[i].y - P[j].y,
              d2 = Math.max(dx * dx + dy * dy, 25),
              f = 9000 / d2;
            const d = Math.sqrt(d2);
            F[i].x += (f * dx) / d;
            F[i].y += (f * dy) / d;
            F[j].x -= (f * dx) / d;
            F[j].y -= (f * dy) / d;
          }
        for (const [a, b] of edges) {
          const dx = P[b].x - P[a].x,
            dy = P[b].y - P[a].y,
            d = Math.max(Math.hypot(dx, dy), 1),
            f = (d - 110) * 0.05;
          F[a].x += (f * dx) / d;
          F[a].y += (f * dy) / d;
          F[b].x -= (f * dx) / d;
          F[b].y -= (f * dy) / d;
        }
        const t = 1 - it / 500;
        P.forEach((p, i) => {
          p.x += Math.max(-20, Math.min(20, F[i].x)) * t + (Wd / 2 - p.x) * 0.004;
          p.y += Math.max(-20, Math.min(20, F[i].y)) * t + (H / 2 - p.y) * 0.004;
        });
      }
      const xs = P.map((p) => p.x),
        ys = P.map((p) => p.y),
        pad = 90;
      const minX = Math.min(...xs) - pad,
        maxX = Math.max(...xs) + pad,
        minY = Math.min(...ys) - 40,
        maxY = Math.max(...ys) + 40;
      const sel = state.sel.luoghi;
      return `<svg viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" width="${Math.round(maxX - minX)}" style="max-width:100%;height:auto" role="img" aria-label="Mappa dei luoghi">
    ${edges.map(([a, b]) => `<line class="g-edge${sel && (names[a] === sel || names[b] === sel) ? ' hi' : ''}" x1="${P[a].x}" y1="${P[a].y}" x2="${P[b].x}" y2="${P[b].y}"/>`).join('')}
    ${names
      .map((nm, i) => {
        const l = L[nm];
        return `<g class="g-node ${visited(nm) ? 'visited' : ''} ${l.requires_item ? 'locked' : ''}${nm === sel ? ' sel' : ''}" data-go="loc" data-name="${esc(nm)}" tabindex="0">
      <circle cx="${P[i].x}" cy="${P[i].y}" r="9"/>
      <text x="${P[i].x}" y="${P[i].y - 15}" text-anchor="middle">${esc(l.label)}</text></g>`;
      })
      .join('')}
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
          ([k, [label]]) =>
            `<button data-filter="${kind}" data-key="${k}" aria-pressed="${state.filter[kind] === k}">${label}</button>`
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
        `<p class="empty" style="padding:12px">Nessun risultato per questa ricerca.</p>`;
      let rows,
        rowFn,
        detail,
        filters = '',
        extra = '';
      if (state.tab === 'ricette') {
        rows = recipeRows(q);
        rowFn = recipeRow;
        detail = recipeDetail(state.sel.ricette ?? rows[0]?.name);
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
        detail = locDetail(state.sel.luoghi ?? rows[0]?.name);
        extra = `<div class="graphbox">${mapSvg()}</div><div class="legend"><span>◌ tratteggiato: serve un oggetto per entrare</span>${P ? '<span>● bordo colorato: visitato da te</span>' : ''}</div>`;
      }
      // The recipes again, in the graph of their chains: a recipe opens below it.
      if (state.tab === 'catene') {
        rows = recipeRows(q);
        rowFn = recipeRow;
        const g = chainsSvg(state.sel.catene ?? rows[0]?.name);
        detail = recipeDetail(state.sel.catene ?? rows[0]?.name);
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
      if (t.dataset.go) go(t.dataset.go, t.dataset.name);
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
      render();
      root.querySelector('.row[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('popstate', onHistory);

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
