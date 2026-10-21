/* global window, localStorage, location, matchMedia */
/**
 * The wiki view: renders a wiki and, optionally, the owner's player state into an
 * element, below the page's own header (title and actions). The web app's page
 * (src/web/main.ts) imports it. It defines
 * `window.renderWiki(root, wiki, player, missing)`: `root` gets the whole view, its
 * listeners stay on `root`, so a new render goes in a new element.
 */
(() => {
  const MARKUP = `<div class="wrap">
  <div class="tally" id="tally"></div>

  <div class="bar">
    <div class="tabs" role="tablist" id="tabs">
      <button role="tab" data-tab="ricette">Ricette</button>
      <button role="tab" data-tab="oggetti">Oggetti</button>
      <button role="tab" data-tab="luoghi">Luoghi</button>
      <button role="tab" data-tab="catene">Catene</button>
    </div>
    <input
      id="q"
      type="search"
      placeholder="Cerca per nome…"
      autocomplete="off"
      aria-label="Cerca"
    />
  </div>

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
    root.innerHTML = MARKUP;
    if (!W) {
      root.querySelector('#view').innerHTML = `<p class="empty">${missing}</p>`;
      return;
    }
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
        ? `<span class="lvl" title="Livello ricetta${r.level_inferred ? ' (dedotto)' : ''}">L${r.level}</span>`
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
      sel: { ricette: null, oggetti: null, luoghi: null },
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
    const initial = location.hash.slice(1);
    state.tab = TABS.includes(initial)
      ? initial
      : TABS.includes(store.get('ib-tab'))
        ? store.get('ib-tab')
        : 'ricette';

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
      const ingr = ingredientsOf(r)
        .map(([n, q]) => {
          const others = (I[n]?.used_in || [])
            .filter((o) => o !== name)
            .sort((a, b) => lvl(b) - lvl(a));
          const hot = others.some((o) => lvl(o) > (r.level || 0));
          const made = I[n]?.made_by || [];
          const h = have(n),
            mine = P
              ? ` <span class="mine${(h?.qty || 0) >= (q || 1) ? ' ok' : ''}" title="Stima dal tuo storico">hai ${haveTxt(h)}</span>`
              : '';
          return `<div class="ing"><span class="qty">${q ? '×' + q : '?'}</span><span>${itemLink(n)}${mine}</span>
      ${made.length ? `<div class="also">si crea con ${made.map(recipeLink).join(' ')}</div>` : ''}
      ${others.length ? `<div class="also${hot ? ' hot' : ''}">${hot ? 'conteso, serve anche a' : 'serve anche a'} ${others.map(recipeLink).join(' ')}</div>` : ''}
    </div>`;
        })
        .join('');
      const up = upstream(r),
        down = downstream(r),
        cand = candidates(r);
      const out = r.output
        ? itemLink(r.output)
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
          ])
        : '';
      return `<div class="head"><div class="kicker">${lvlTag(r)}<span>Ricetta</span>${freshness(r.last_seen)}</div>
    <h2>${esc(name)}</h2></div>
    ${sec(
      'Ingredienti',
      r.ingredients
        ? `<div class="ingr">${ingr}</div>`
        : ingr
          ? `<p class="note">Lista parziale: ricavata da /esamina sugli oggetti, quantità ignote.</p><div class="ingr">${ingr}</div>`
          : `<p class="note">Vista solo nell'elenco di /ricetta. Usa /esamina ${esc(name)} per vederne gli ingredienti.</p>`
    )}
    ${sec('Ottieni', out)}
    ${flow}
    ${r.craft_text ? sec('Descrizione', `<p class="flavor">${esc(r.craft_text)}</p>`) : ''}
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
        .map((t) => `<p class="flavor">${esc(t)}</p>`)
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
    const SOURCE = {
      adventure: 'trovabile in avventura',
      recipe: 'si ottiene con una ricetta',
      special: 'oggetto speciale',
    };
    function itemDetail(name) {
      const i = I[name];
      if (!i) return `<p class="empty">Seleziona un oggetto dall'elenco.</p>`;
      const where = i.exclusive
        ? i.locations.length
          ? `<p class="note">Esce solo qui:</p><div class="chips">${i.locations.map((k) => `<span class="chip">${locLink(k)}</span>`).join('')}</div>`
          : `<p class="note">Esce in un solo luogo, non ancora identificato.</p>`
        : `<p class="note">Esce in qualsiasi luogo con la stessa probabilità.</p>`;
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
      const usedIn = [...i.used_in].sort((a, b) => lvl(b) - lvl(a));
      return `<div class="head"><div class="kicker">${tag(i.rarity)}<span>${esc(rarityName(rarityGroup(i.rarity)))}</span>${i.usable ? '<span>· usabile</span>' : ''}${i.gives_title ? `<span>· dà ${i.title ? `il titolo «${esc(i.title)}»` : 'un titolo'}</span>` : ''}${i.sources.map((s) => `<span>· ${SOURCE[s] || s}${i.sources_inferred ? ' (dedotto dalla rarità)' : ''}</span>`).join('')}${freshness(i.last_seen)}</div>
    <h2>${esc(name)}</h2>
    ${i.exclusive ? `<p class="note">Il + nella rarità indica un oggetto che esce in un solo luogo.</p>` : ''}
    ${W.rarity_hypotheses?.[rarityGroup(i.rarity)] ? `<p class="note">Rarità ${esc(rarityGroup(i.rarity))}: ${esc(W.rarity_hypotheses[rarityGroup(i.rarity)])}.</p>` : ''}</div>
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
    ${sec('Serve nelle ricette', chips(usedIn, recipeLink))}
    ${sec('Si ottiene con', i.made_by.length ? chips(i.made_by, recipeLink) : `<p class="empty">${i.sources.includes('recipe') ? 'Ricetta non ancora identificata.' : 'Non è un oggetto craftato.'}</p>`)}
    ${i.sources.includes('adventure') || i.exclusive ? sec('Dove si trova', where) : ''}
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
    ${sec('Oggetti esclusivi', `<p class="note">Gli altri oggetti escono ovunque con la stessa probabilità.</p>` + chips(excl, itemLink))}
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
    function chainsSvg() {
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
        return `<g class="g-node" data-go="recipe" data-name="${esc(n)}" tabindex="0"><title>${esc(n)}${R[n]?.output ? ' → ' + esc(R[n].output) : ''}</title>
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
    function render() {
      const q = fold($('#q').value.trim());
      root
        .querySelectorAll('#tabs button')
        .forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === state.tab));
      const v = $('#view');
      if (state.tab === 'catene') {
        const g = chainsSvg();
        v.innerHTML = `<div class="listpane"><p class="note">${g.count} ricette collegate da ${g.edges} passaggi: una freccia va da una ricetta a quella che usa il suo output. Tocca una ricetta per aprirla. Le catene crescono man mano che si scoprono gli output.</p>
      <div class="graphbox">${g.svg}</div></div>`;
        v.querySelectorAll('.g-node').forEach((el) => {
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
        return;
      }
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
        extra = `<div class="graphbox">${mapSvg()}</div><div class="legend"><span>◌ tratteggiato: serve un oggetto per entrare</span>${P ? '<span>● bordo blu: visitato da te</span>' : ''}</div>`;
      }
      const curSel = state.sel[state.tab] ?? rows[0]?.name;
      v.innerHTML = `${extra}<div class="split">
    <div class="listpane">${filters}<span class="count">${rows.length} risultati</span>
      <div class="list" id="list">${rows.map(rowFn).join('') || `<p class="empty" style="padding:12px">Nessun risultato per questa ricerca.</p>`}</div></div>
    <aside class="detail" aria-live="polite">${detail}</aside></div>`;
      v.querySelectorAll('.row').forEach((b) =>
        b.setAttribute('aria-current', b.dataset.sel === curSel)
      );
    }
    function go(kind, name) {
      if (kind === 'item' && !I[name] && W.renames?.[name]) name = W.renames[name]; // old name of a renamed item
      const tab = { recipe: 'ricette', item: 'oggetti', loc: 'luoghi' }[kind];
      state.sel[tab] = name;
      if (state.tab !== tab) {
        state.tab = tab;
        $('#q').value = '';
        store.set('ib-tab', tab);
      }
      render();
      const cur = root.querySelector(`.row[aria-current="true"]`);
      cur?.scrollIntoView({ block: 'nearest' });
      if (matchMedia('(max-width: 860px)').matches)
        $('.detail')?.scrollIntoView({ block: 'start' });
    }

    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-go],[data-sel],[data-filter],[data-tab]');
      if (!t) return;
      if (t.dataset.tab) {
        state.tab = t.dataset.tab;
        store.set('ib-tab', state.tab);
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
        render();
        if (matchMedia('(max-width: 860px)').matches)
          $('.detail')?.scrollIntoView({ block: 'start' });
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

    const rs = Object.values(R);
    $('#tally').innerHTML =
      `<span><b>${rs.length}</b> ricette</span><span><b>${rs.filter((r) => r.output).length}</b> con output noto</span><span><b>${Object.keys(I).length}</b> oggetti</span><span><b>${Object.keys(L).length}</b> luoghi</span>`;
    // How often the estimate agreed with the bot's /ricetta lists, rounded down: 100% only when always.
    const check = P?.inventory_check;
    const agreement =
      check && check.compared > 0
        ? (Math.floor((check.agreed * 1000) / check.compared) / 10).toLocaleString('it-IT')
        : null;
    if (P)
      $('#tally').insertAdjacentHTML(
        'beforeend',
        `<span>dati personali di <b>@${esc(P.player)}</b> al ${fmtDate(P.as_of)}</span>` +
          (agreement === null ? '' : `<span>stima dell'inventario: <b>${agreement}%</b></span>`)
      );
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
          : ` La percentuale della stima dice quante volte, a ogni /ricetta, la stima dava per ogni ricetta gli stessi ingredienti mancanti del bot (${check.agreed} su ${check.compared}): se non è 100%, alcune interazioni (oggetti trovati, dati, ricevuti o usati) sono avvenute fuori dalle chat importate.`);
    $('#foot').textContent =
      `Dati generati il ${fmtDate(W.generated)}.${estimate} Le ricette si conoscono solo dopo averne posseduto metà degli ingredienti, e l'output solo dopo averle eseguite: ciò che manca qui non è stato ancora osservato.`;
    render();
  };
})();
