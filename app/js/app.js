/* MÖVAT! — companion web app (vanilla JS, routing via hash). */
(async function () {
  'use strict';

  // Con il server attivo i contenuti arrivano dal CMS; altrimenti si usano i dati dimostrativi di data.js.
  let API = false;
  try {
    const r = await fetch('api/content', { cache: 'no-store' });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
      const d = await r.json();
      window.MOVAT_CONFIG = { ...window.MOVAT_CONFIG, ...d.config, submitUrl: 'api/proposals' };
      window.MOVAT_CARDS = d.cards;
      window.MOVAT_MODES = d.modes;
      window.MOVAT_FAQ = d.faq;
      window.MOVAT_FAQ_CATEGORIES = d.faqCategories;
      window.MOVAT_USER_CARDS = d.userCards || [];
      API = true;
    }
  } catch { /* nessun server: modalità dimostrativa */ }
  // Voti già dati da questo browser, confermati dal server (cookie anonimo, nessun account).
  let MY_VOTES = {};
  if (API) {
    try { const r = await fetch('api/my-votes', { cache: 'no-store', credentials: 'same-origin' }); if (r.ok) MY_VOTES = (await r.json()).votes || {}; } catch { /* si riprova al prossimo caricamento */ }
    // Il vecchio codice dispositivo scelto dal browser non serve più.
    try { localStorage.removeItem('movat:device'); } catch { /* storage non disponibile */ }
  }

  const CONFIG = window.MOVAT_CONFIG;
  const CARDS = [...window.MOVAT_CARDS].sort((a, b) => a.number - b.number);
  const CARD = Object.fromEntries(CARDS.map((c) => [c.id, c]));
  const MODES = window.MOVAT_MODES;
  const FAQ = window.MOVAT_FAQ;
  const FAQ_CATS = window.MOVAT_FAQ_CATEGORIES;
  const USER_CARDS = window.MOVAT_USER_CARDS || [];
  const UCARD = Object.fromEntries(USER_CARDS.map((c) => [c.id, c]));

  let $view = document.getElementById('view');
  const $top = document.getElementById('topbar');
  const $tabs = document.getElementById('tabbar');
  const $shell = document.getElementById('app');

  document.documentElement.style.setProperty('--card-ratio', CONFIG.cardRatio);
  // Grandezza delle carte singole, impostata dal CMS
  Object.entries({ list: 78, detail: 68, preview: 74, ucard: 82, maker: 32, ...(CONFIG.cardSizes || {}) })
    .forEach(([k, v]) => document.documentElement.style.setProperty('--cs-' + k, v));

  /* ---------------- Utility ---------------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (name, cls = '') => `<span class="ms ${cls}" aria-hidden="true">${name}</span>`;
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const fmtNum = (n) => n.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const pad2 = (n) => String(n).padStart(2, '0');
  let unsubPlayer = null;
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem('movat:' + k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem('movat:' + k, JSON.stringify(v)); } catch { /* storage non disponibile */ } },
    del(k) { try { localStorage.removeItem('movat:' + k); } catch { /* */ } },
  };
  function highlight(text, q) {
    const t = esc(text); if (!q) return t;
    const i = norm(text).indexOf(norm(q));
    if (i < 0) return t;
    const raw = String(text);
    return esc(raw.slice(0, i)) + '<mark>' + esc(raw.slice(i, i + q.length)) + '</mark>' + esc(raw.slice(i + q.length));
  }
  function matchesCard(card, q) {
    if (!q) return true;
    const n = norm(q).replace(/^#/, '').trim();
    if (/^\d+$/.test(n)) return String(card.number).startsWith(String(parseInt(n, 10)));
    return norm(card.name).includes(n);
  }
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch { /* */ }
      ta.remove(); return ok;
    }
  }

  /* ---------------- Router ---------------- */
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: Object.fromEntries(new URLSearchParams(qs || '')) };
  }
  function buildHash(path, query = {}) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v != null)).toString();
    return '#/' + path + (qs ? '?' + qs : '');
  }
  // Aggiorna la query dell'URL senza ridisegnare la pagina (per ricerca/filtri).
  function setQuery(query) {
    const { parts } = parseHash();
    history.replaceState(null, '', buildHash(parts.join('/'), query));
  }
  const go = (hash) => { location.hash = hash; };

  const SECTIONS = {
    ascolta: { title: 'Guarda', icon: 'playing_cards' },
    scopri: { title: 'Scopri', icon: 'style' },
    crea: { title: 'Crea', icon: 'edit' },
    faq: { title: 'FAQ', icon: 'help' },
  };

  let lastSection = null, enterTimer = null;
  function renderChrome(section, back, headTitle) {
    if (!section) {
      $top.hidden = true; $tabs.hidden = true; $shell.classList.remove('has-tabs'); return;
    }
    const meta = SECTIONS[section] || { title: headTitle || '' };
    const leftBtn = back
      ? `<a class="icon-btn" href="${back}" aria-label="Indietro">${icon('arrow_back')}</a>`
      : `<a class="icon-btn" href="#/" aria-label="Torna alla Home">${icon('home', 'fill')}</a>`;
    $top.innerHTML = `${leftBtn}
      <div class="brand"><img src="assets/img/logo-movat.png" alt="MÖVAT!"><span class="section">${esc(meta.title)}</span></div>
      <img class="truck" src="assets/img/camioncino.png" alt="">`;
    $top.hidden = false;
    // L'icona salta solo quando si cambia sezione, non a ogni pagina.
    const changed = section !== lastSection; lastSection = section;
    $tabs.innerHTML = Object.entries(SECTIONS).map(([k, s]) =>
      `<a class="tab${k === section && changed ? ' pop' : ''}" href="#/${k}" ${k === section ? 'aria-current="page"' : ''}>${icon(s.icon)}<span>${s.title}</span></a>`).join('');
    $tabs.hidden = false; $shell.classList.add('has-tabs');
  }

  function route() {
    const { parts, query } = parseHash();
    const [sec, sub] = parts;
    closeModal();
    unsubPlayer?.(); unsubPlayer = null;
    if (sec !== 'ascolta') player.stop();
    let out;
    switch (sec) {
      case undefined: out = viewHome(); break;
      case 'ascolta': out = sub ? viewCard(sub, query) : viewCards(query); break;
      case 'scopri': out = sub === 'carte' ? (parts[2] ? viewUserCard(parts[2]) : viewUserCards(query)) : sub ? viewMode(sub, query) : viewModes(query); break;
      case 'crea': out = sub ? viewCreate(sub, query) : viewCreateChooser(); break;
      case 'faq': out = viewFaq(query); break;
      case 'contatti': out = viewContact(); break;
      case 'privacy': out = viewPrivacy(); break;
      default: out = viewNotFound();
    }
    if (!out) return; // la vista ha già reindirizzato
    renderChrome(out.section, out.back, out.headTitle);
    // Nuovo contenitore a ogni pagina: i listener della vista precedente spariscono con lui.
    const fresh = $view.cloneNode(false); $view.replaceWith(fresh); $view = fresh;
    $view.innerHTML = out.html;
    // Animazione d'ingresso solo all'apertura della pagina (vedi .enter in app.css).
    $view.classList.add('enter'); clearTimeout(enterTimer); enterTimer = setTimeout(() => $view.classList.remove('enter'), 1000);
    document.title = out.title ? `${out.title} · MÖVAT!` : 'MÖVAT! — Il gioco continua qui';
    if (!out.keepScroll) window.scrollTo(0, 0);
    out.mount?.();
  }
  window.addEventListener('hashchange', route);

  /* Menu in basso: sparisce scorrendo verso l'alto (swipe giù), ricompare scorrendo verso il basso
     (swipe su) e sempre in cima o in fondo alla pagina. Evita il menu "tagliato" quando il browser
     mostra di nuovo la barra degli indirizzi. */
  let lastY = window.scrollY, ticking = false;
  function setTabsHidden(hidden) { $shell.classList.toggle('tabs-hidden', hidden); }
  window.addEventListener('scroll', () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const y = window.scrollY, dy = y - lastY;
      const atTop = y < 24, atBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 24;
      if (atTop || atBottom) setTabsHidden(false);
      else if (dy < -6) setTabsHidden(true);
      else if (dy > 6) setTabsHidden(false);
      if (Math.abs(dy) > 6 || atTop) lastY = y;
    });
  }, { passive: true });
  window.addEventListener('hashchange', () => { setTabsHidden(false); lastY = 0; });

  /* ---------------- Illustrazione carta ---------------- */
  function cardArt(card, { label = true } = {}) {
    if (card.image) return `<div class="card-art"><img class="real" src="${esc(card.image)}" alt="${esc(card.name)}"></div>`;
    return `<div class="card-art" role="img" aria-label="Carta ${card.number}: ${esc(card.name)} (illustrazione segnaposto)">
      <div class="art-bg"></div>
      ${label ? `<div class="art-name">${esc(card.name)}</div>` : ''}
      <div class="art-icon" style="background:${card.color}">${icon(card.icon)}</div>
      <img class="art-truck" src="assets/img/camioncino.png" alt="">
      <div class="art-num">${card.number}</div>
    </div>`;
  }

  /* ---------------- Player audio (uno alla volta, nessun autoplay) ---------------- */
  const player = (() => {
    const el = new Audio(); el.preload = 'none';
    let current = null;
    const subs = new Set();
    const emit = () => subs.forEach((f) => f());
    ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange'].forEach((e) => el.addEventListener(e, emit));
    el.addEventListener('ended', () => { el.currentTime = 0; emit(); });
    el.addEventListener('error', () => { if (current) toast('Impossibile riprodurre l’audio. Riprova.'); });
    return {
      get current() { return current; },
      get playing() { return !el.paused && !el.ended; },
      get time() { return el.currentTime; },
      get duration() { return isFinite(el.duration) ? el.duration : 0; },
      isPlaying(id) { return current === id && !el.paused; },
      load(card) { if (current !== card.id) { el.pause(); current = card.id; el.src = card.audio; el.load(); emit(); } },
      toggle(card) {
        if (!card.audio) return;
        if (current !== card.id) { this.load(card); }
        if (el.paused) el.play().catch(() => toast('Tocca di nuovo per ascoltare.')); else el.pause();
      },
      seek(t) { el.currentTime = t; },
      stop() { if (!el.paused) el.pause(); },
      subscribe(f) { subs.add(f); return () => subs.delete(f); },
    };
  })();
  function bindPlayer(fn) { unsubPlayer?.(); unsubPlayer = player.subscribe(fn); fn(); }

  /* ---------------- Opzioni di visualizzazione (ricordate sul dispositivo) ---------------- */
  const VIEWS = {
    ascolta: { def: 'due', opts: [['uno', 'view_agenda', '1 carta per riga'], ['due', 'grid_view', '2 carte per riga'], ['griglia', 'apps', 'Griglia']] },
    scopri: { def: 'schede', opts: [['schede', 'view_day', 'Schede'], ['lista', 'view_list', 'Lista compatta']] },
    scopriCarte: { def: 'due', opts: [['uno', 'view_agenda', '1 carta per riga'], ['due', 'grid_view', '2 carte per riga'], ['griglia', 'apps', 'Griglia']] },
    crea: { def: 'due', opts: [['lista', 'view_list', 'Lista'], ['griglia', 'apps', 'Griglia'], ['uno', 'view_agenda', '1 carta per riga'], ['due', 'grid_view', '2 carte per riga']] },
  };
  function getView(sec) {
    const v = store.get('vista-' + sec, null);
    return VIEWS[sec].opts.some(([k]) => k === v) ? v : VIEWS[sec].def;
  }
  function viewSwitch(sec, cur) {
    return `<div class="view-switch" role="group" aria-label="Visualizzazione">${VIEWS[sec].opts.map(([k, ic, l]) =>
      `<button type="button" data-view="${k}" aria-pressed="${k === cur}" title="${l}" aria-label="${l}">${icon(ic)}</button>`).join('')}</div>`;
  }
  // Collega i pulsanti di visualizzazione: salva la scelta e ridisegna.
  function bindViewSwitch(sec, onChange) {
    $view.querySelectorAll('.view-switch [data-view]').forEach((b) => b.addEventListener('click', () => {
      store.set('vista-' + sec, b.dataset.view);
      $view.querySelectorAll('.view-switch [data-view]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      onChange(b.dataset.view);
    }));
  }

  /* ---------------- HOME ---------------- */
  function viewHome() {
    const subs = CONFIG.homeSubs || {};
    const links = [
      ['ascolta', 'Guarda', subs.ascolta || 'Le carte e ascolta il dialetto', 'icona-guarda.png'],
      ['scopri', 'Scopri', subs.scopri || 'Le modalità e carte create dagli utenti', 'icona-scopri.png'],
      ['crea', 'Crea', subs.crea || 'Le tue modalità di gioco', 'icona-crea.png'],
      ['faq', 'FAQ', subs.faq || 'Le risposte alle domande sul gioco', 'icona-faq.png'],
    ];
    return {
      section: null,
      html: `
      <header class="home-hero">
        <h1><img class="logo" src="assets/img/logo-movat.png" alt="MÖVAT!"></h1>
        <img class="truck" src="assets/img/camioncino.png" alt="Il camioncino Busa che corre tra le carte">
      </header>
      <p class="welcome">${esc(CONFIG.welcome || 'Il gioco continua qui!')}</p>
      <nav class="home-links" aria-label="Sezioni dell'app">
        ${links.map(([k, t, s, img]) => `
          <a class="home-link" href="#/${k}">
            <img src="assets/img/${img}" alt="">
            <span class="txt"><strong>${t}</strong><span class="sub">${esc(s)}</span></span>
            <span class="go">${icon('chevron_right')}</span>
          </a>`).join('')}
      </nav>
      <footer class="footer">
        ${CONFIG.busaLogo ? `<img class="busa-logo" src="${esc(CONFIG.busaLogo)}" alt="Busa Trasporti e Logistica">`
          : `<div class="busa">busa<small>TRASPORTI E LOGISTICA</small></div>`}
        <p style="margin-top:10px">${esc(CONFIG.footerText ?? 'MÖVAT! è un gioco di Busa Trasporti e Logistica')}</p>
        <p style="margin-top:6px"><a href="${CONFIG.privacyUrl}">Informativa privacy</a></p>
      </footer>`,
    };
  }

  /* ---------------- ASCOLTA: elenco ---------------- */
  function viewCards(query) {
    const q = query.q || '';
    let vista = getView('ascolta');
    const html = `
      <div class="page">
        <h1 class="page-title">Le carte parlanti</h1>
        <p class="page-sub">Trova la carta che hai in mano e ascolta la sua frase in dialetto piacentino.</p>
        <div class="search-row">
          <div class="search" role="search">
            ${icon('search')}
            <label class="sr-only" for="q">Cerca per numero o nome della carta</label>
            <input id="q" type="search" inputmode="search" placeholder="Numero o nome" value="${esc(q)}" autocomplete="off">
            <button class="icon-btn clear" type="button" aria-label="Cancella ricerca" ${q ? '' : 'hidden'}>${icon('close')}</button>
          </div>
          ${viewSwitch('ascolta', vista)}
        </div>
        <div id="results"></div>
      </div>`;
    function drawResults(q) {
      const list = CARDS.filter((c) => matchesCard(c, q));
      const $r = document.getElementById('results');
      if (!list.length) {
        $r.innerHTML = `<div class="empty">${icon('search_off')}<h3>Nessuna carta trovata</h3>
          <p class="muted">Controlla il numero stampato sulla carta o prova con un'altra parola.</p></div>`;
        return;
      }
      const count = `<p class="muted" style="font-weight:700;font-size:14px;margin-bottom:10px">${list.length} ${list.length === 1 ? 'carta' : 'carte'}</p>`;
      if (vista === 'griglia') {
        // Griglia: miniature quadrate (ritagliate), 4 per riga; si tocca per aprire la carta.
        $r.innerHTML = count + `<div class="sq-grid">${list.map((c) => `
          <a class="sq-tile" href="${buildHash('ascolta/' + c.id, { q })}" aria-label="Carta ${c.number}, ${esc(c.name)}">
            <span class="sq-art">${cardArt(c)}</span><span class="sq-num">${c.number}</span>
            <span class="sq-name">${esc(c.name)}</span></a>`).join('')}</div>`;
        return;
      }
      $r.innerHTML = count + `
        <div class="card-grid ${vista === 'uno' ? 'cols-1' : ''}">${list.map((c) => {
          const href = buildHash('ascolta/' + c.id, { q });
          return `<article class="talk-card">
            <a class="open" href="${href}" aria-label="Apri la carta ${c.number}, ${esc(c.name)}">${cardArt(c)}</a>
            <div class="meta">
              <div class="t"><div class="num">CARTA #${pad2(c.number)}</div><div class="name">${highlight(c.name, /^\d/.test(q) ? '' : q)}</div></div>
              ${c.audio
                ? `<button class="play-btn" data-play="${c.id}" aria-label="Ascolta ${esc(c.name)}">${icon('play_arrow')}</button>`
                : `<button class="play-btn" disabled aria-label="Audio non ancora disponibile">${icon('volume_off')}</button>`}
            </div>
            ${c.audio ? '' : `<div class="no-audio">${icon('schedule')}Audio non ancora disponibile</div>`}
          </article>`;
        }).join('')}</div>`;
      syncPlayButtons();
    }
    function syncPlayButtons() {
      document.querySelectorAll('[data-play]').forEach((b) => {
        const on = player.isPlaying(b.dataset.play);
        b.classList.toggle('playing', on);
        b.innerHTML = icon(on ? 'pause' : 'play_arrow');
        b.setAttribute('aria-label', (on ? 'Metti in pausa ' : 'Ascolta ') + CARD[b.dataset.play].name);
      });
    }
    return {
      section: 'ascolta', title: 'Le carte parlanti', html,
      mount() {
        const $q = document.getElementById('q');
        const $clear = $view.querySelector('.clear');
        drawResults(q);
        bindViewSwitch('ascolta', (v) => { vista = v; drawResults($q.value); });
        $q.addEventListener('input', () => { setQuery({ q: $q.value }); $clear.hidden = !$q.value; drawResults($q.value); });
        $clear.addEventListener('click', () => { $q.value = ''; $q.dispatchEvent(new Event('input')); $q.focus(); });
        $view.addEventListener('click', (e) => {
          const b = e.target.closest('[data-play]'); if (!b) return;
          player.toggle(CARD[b.dataset.play]);
        });
        bindPlayer(syncPlayButtons);
      },
    };
  }

  /* ---------------- ASCOLTA: dettaglio ---------------- */
  function viewCard(id, query) {
    const card = CARD[id];
    if (!card) return viewNotFound();
    const i = CARDS.indexOf(card);
    const prev = CARDS[i - 1], next = CARDS[i + 1];
    const cardFaq = FAQ.filter((f) => f.cardId === card.id);
    // Modalità pubblicate (dei giocatori e del team Busa) che usano questa carta, prima le più votate.
    const usedIn = MODES.filter((m) => m.cards[card.id]).sort(byRating);
    const back = buildHash('ascolta', { q: query.q });
    const navLink = (c, cls, label, ic) => c
      ? `<a class="${cls}" href="${buildHash('ascolta/' + c.id, { q: query.q })}">${cls === 'prev' ? icon(ic) : ''}<span><small>${label} · #${pad2(c.number)}</small><b>${esc(c.name)}</b></span>${cls === 'next' ? icon(ic) : ''}</a>`
      : `<a class="${cls}" aria-disabled="true">${cls === 'prev' ? icon(ic) : ''}<span><small>${label}</small><b>—</b></span>${cls === 'next' ? icon(ic) : ''}</a>`;
    const html = `
      <div class="page">
        <div class="crumbs">
          <a class="btn ghost small" href="${back}">${icon('grid_view')}Tutte le carte</a>
          <span class="counter">CARTA ${i + 1} DI ${CARDS.length}</span>
        </div>
        <article class="detail-card">
          ${cardArt(card)}
          <h1>${esc(card.name)}</h1>
          <p class="num-line">CARTA N. ${card.number}</p>
          <div class="bubble">
            <div class="lbl">${icon('record_voice_over')}Frase in piacentino</div>
            ${card.dialect ? `<p class="dialect">«${esc(card.dialect)}»</p>` : `<p class="placeholder-text" style="margin-top:6px">Frase in dialetto da inserire</p>`}
            <div class="transl">
              <div class="lbl">${icon('translate')}Traduzione italiana</div>
              ${card.translation ? `<p>“${esc(card.translation)}”</p>` : `<p class="placeholder-text">Traduzione da inserire</p>`}
            </div>
          </div>
          ${card.text ? `<section class="card-text" aria-labelledby="ct-title">
            <h2 id="ct-title">${icon('style')}Testo della carta</h2>
            ${String(card.text).split(/\n\s*\n|\n/).filter(Boolean).map((t) => `<p>${esc(t)}</p>`).join('')}
          </section>` : ''}
          ${card.audio ? `
          <div class="player" id="player">
            <div class="row">
              <button class="play-btn" id="pp" aria-label="Riproduci">${icon('play_arrow')}</button>
              <div class="track">
                <input id="seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Avanzamento audio">
                <div class="times"><span id="cur">0:00</span><span id="dur">--:--</span></div>
              </div>
            </div>
          </div>` : `
          <div class="player unavailable">${icon('schedule')}<strong>Audio non ancora disponibile</strong>
            <span>Stiamo registrando questa frase: torna a trovarci presto!</span></div>`}
        </article>
        <section class="card-modes" aria-labelledby="cm-title">
          <h2 id="cm-title">${icon('stadia_controller')}Modalità con questa carta</h2>
          ${usedIn.length ? `
            <p class="muted small">Usata in ${usedIn.length} ${usedIn.length === 1 ? 'modalità' : 'modalità'}.</p>
            <ul class="cm-list">${usedIn.slice(0, 5).map((m) => `
              <li><a href="#/scopri/${esc(m.id)}">
                <span class="cm-main"><b>${esc(m.title)}</b><span class="by">di <b>${esc(m.author)}</b> · ${ratingText(m)}</span></span>
                <span class="cm-qty" title="Copie di questa carta nella modalità">×${m.cards[card.id]}</span>${icon('chevron_right')}</a></li>`).join('')}
            </ul>
            <a class="btn block secondary" href="${buildHash('scopri', { carta: card.id })}">${icon('filter_alt')}Scopri tutte le modalità${usedIn.length > 5 ? ` (${usedIn.length})` : ''}</a>`
          : `<p class="muted">Non è ancora usata in nessuna modalità pubblicata.</p>
            <a class="btn block secondary" href="#/crea/carte">${icon('add_circle')}Crea una modalità</a>`}
        </section>
        ${cardFaq.length ? `<section class="card-faq" aria-labelledby="cf-title">
          <h2 id="cf-title">${icon('help')}Dubbi su questa carta</h2>
          ${cardFaq.map((f) => `<div class="cf-item">
            <h3>${esc(f.q)}</h3>
            ${f.a.map((p) => `<p>${esc(p)}</p>`).join('')}
            ${f.action ? `<a class="btn small" href="${esc(f.action.href)}">${esc(f.action.label)}${icon('chevron_right')}</a>` : ''}
          </div>`).join('')}
        </section>` : ''}
        <nav class="prevnext" aria-label="Altre carte">
          ${navLink(prev, 'prev', 'Precedente', 'chevron_left')}
          ${navLink(next, 'next', 'Successiva', 'chevron_right')}
        </nav>
      </div>`;
    return {
      section: 'ascolta', back, title: card.name, html,
      mount() {
        if (!card.audio) return;
        player.load(card);
        const $pp = document.getElementById('pp'), $seek = document.getElementById('seek');
        const $cur = document.getElementById('cur'), $dur = document.getElementById('dur');
        let dragging = false;
        $pp.addEventListener('click', () => player.toggle(card));
        $seek.addEventListener('input', () => { dragging = true; $cur.textContent = fmtTime(($seek.value / 100) * player.duration); $seek.style.setProperty('--p', $seek.value + '%'); });
        $seek.addEventListener('change', () => { player.seek(($seek.value / 100) * player.duration); dragging = false; });
        bindPlayer(() => {
          const on = player.isPlaying(card.id);
          $pp.innerHTML = icon(on ? 'pause' : 'play_arrow');
          $pp.classList.toggle('playing', on);
          $pp.setAttribute('aria-label', on ? 'Pausa' : 'Riproduci');
          const d = player.current === card.id ? player.duration : 0;
          $dur.textContent = d ? fmtTime(d) : '--:--';
          if (!dragging) {
            const p = d ? (player.time / d) * 100 : 0;
            $seek.value = p; $seek.style.setProperty('--p', p + '%');
            $cur.textContent = fmtTime(player.current === card.id ? player.time : 0);
          }
        });
      },
    };
  }

  /* ---------------- Invii al server (voti, proposte, contatti) ---------------- */
  // Errore con un messaggio già adatto alle persone (mai dettagli tecnici).
  class SendError extends Error { constructor(msg, extra = {}) { super(msg); Object.assign(this, extra); } }
  const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
  async function apiPost(url, body, { idem } = {}) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Movat-App': '1', ...(idem ? { 'Idempotency-Key': idem } : {}) }, body: JSON.stringify(body) });
    } catch { throw new SendError('Connessione assente o instabile: controlla la rete e riprova.', { network: true }); }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new SendError(out.error && res.status < 500 || out.code ? out.error : 'Il server non risponde come dovrebbe. Riprova tra poco.', { status: res.status, code: out.code, details: out.details });
    return out;
  }
  /* Cloudflare Turnstile: lo script si carica solo quando serve e la verifica parte solo al momento dell'invio.
     Di solito è invisibile; se serve un'interazione compare un piccolo riquadro in basso. */
  const TS = { key: CONFIG.turnstileSiteKey || null, loading: null, id: null };
  function loadTurnstile() {
    if (!API || !TS.key) return Promise.resolve();
    if (window.turnstile) return Promise.resolve();
    if (!TS.loading) TS.loading = loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit').catch((e) => { TS.loading = null; throw e; });
    return TS.loading;
  }
  function tsSlot() {
    let el = document.getElementById('ts-slot');
    if (!el) {
      el = document.createElement('div'); el.id = 'ts-slot'; el.className = 'ts-slot'; el.hidden = true;
      el.innerHTML = `<div class="ts-card" role="dialog" aria-label="Verifica"><p>${icon('verified_user')}Un attimo: confermiamo che non sei un robot.</p><div class="ts-box"></div></div>`;
      document.body.appendChild(el);
    }
    return el;
  }
  async function antibotToken(action) {
    if (!API || !TS.key) return undefined; // antibot non attivo (solo in sviluppo): il server lo sa e non lo chiede
    try { await loadTurnstile(); } catch { throw new SendError('Non riusciamo a caricare la verifica antibot. Controlla la connessione e riprova.'); }
    const slot = tsSlot(), box = slot.querySelector('.ts-box');
    if (TS.id != null) { try { window.turnstile.remove(TS.id); } catch { /* già rimosso */ } TS.id = null; }
    box.innerHTML = '';
    return new Promise((resolve, reject) => {
      let done = false;
      const end = (fn, v) => { if (done) return; done = true; clearTimeout(timer); slot.hidden = true; fn(v); };
      const fail = () => end(reject, new SendError('La verifica antibot non è riuscita. Riprova.', { code: 'antibot' }));
      const timer = setTimeout(fail, 90000);
      TS.id = window.turnstile.render(box, {
        sitekey: TS.key, action, appearance: 'interaction-only', language: 'it', 'refresh-expired': 'manual',
        callback: (t) => end(resolve, t),
        'error-callback': () => { fail(); return true; }, 'expired-callback': fail, 'timeout-callback': fail,
        'before-interactive-callback': () => { slot.hidden = false; }, 'after-interactive-callback': () => { slot.hidden = true; },
      });
    });
  }
  // Identificativo anonimo assegnato dal server (cookie HttpOnly) prima del primo invio della pagina.
  let session = null;
  const ensureSession = () => (session ||= apiPost('api/session', {}).catch((e) => { session = null; throw e; }));
  // Invio protetto: token antibot appena prima dell'invio; se è scaduto o rifiutato si riprova una volta da soli.
  async function protectedPost(url, body, action, opts) {
    await ensureSession();
    try { return await apiPost(url, { ...body, turnstile: await antibotToken(action) }, opts); }
    catch (e) {
      if (e.code !== 'antibot') throw e;
      return apiPost(url, { ...body, turnstile: await antibotToken(action) }, opts);
    }
  }

  /* ---------------- Voti (senza account: un voto per browser, modificabile) ---------------- */
  // Senza server (demo) i voti restano solo su questo dispositivo.
  const localVotes = store.get('votes', {});
  const voteKey = (key) => (String(key).startsWith('carta:') ? 'card:' + String(key).slice(6) : 'mode:' + key);
  function ratingOf(mode, key = mode.id) {
    const mine = API ? MY_VOTES[voteKey(key)] : localVotes[key];
    // Con il server i totali sono calcolati dal server e includono già il voto di questo browser.
    const sum = mode.ratingSum + (API ? 0 : mine || 0), count = mode.ratingCount + (API || !mine ? 0 : 1);
    return { avg: count ? sum / count : 0, count, mine };
  }
  // Classifica per valutazione: entrano solo i contenuti con almeno N voti validi; gli altri restano visibili dopo.
  const RANK_MIN = Number(CONFIG.rankMinVotes) || 5;
  function byRating(a, b) {
    const ra = ratingOf(a), rb = ratingOf(b), ia = ra.count >= RANK_MIN, ib = rb.count >= RANK_MIN;
    if (ia !== ib) return ia ? -1 : 1;
    if (!ia) return String(b.date).localeCompare(String(a.date));
    return rb.avg - ra.avg || rb.count - ra.count;
  }
  function ratingText(mode, long = false, key) {
    const r = ratingOf(mode, key);
    if (!r.count) return `<span class="rating">${icon('star')}<span class="n">Ancora nessun voto</span></span>`;
    return `<span class="rating">${icon('star')}${fmtNum(r.avg)}${long ? ' su 5' : ''}<span class="n">· ${r.count} ${r.count === 1 ? 'voto' : 'voti'}</span></span>`;
  }
  const modeTotal = (m) => Object.values(m.cards).reduce((a, b) => a + b, 0);
  const modeCardList = (m) => Object.entries(m.cards).filter(([id]) => CARD[id]).map(([id, q]) => ({ card: CARD[id], qty: q })).sort((a, b) => a.card.number - b.card.number);
  /* Giocatori consigliati: "2" (uguali), "2–5" (da–a) oppure "5+" (5 o più). */
  function parsePlayers(v) {
    const t = String(v || '').trim();
    let m;
    if ((m = t.match(/^(\d+)\s*(\+|o più)$/))) return { from: m[1], to: '', plus: true };
    if ((m = t.match(/^(\d+)\s*[–-]\s*(\d+)$/))) return { from: m[1], to: m[2], plus: false };
    if ((m = t.match(/^(\d+)$/))) return { from: m[1], to: m[1], plus: false };
    return { from: '', to: '', plus: false };
  }
  // Restituisce { value, error } a partire dai due campi "da" / "a" e dal tasto "+".
  function playersFrom(from, to, plus) {
    const a = String(from || '').trim(), b = String(to || '').trim();
    if (!a && !b) return { value: '', error: plus ? 'Inserisci il numero minimo di giocatori prima del “+”.' : '' };
    if (!a) return { value: '', error: 'Inserisci anche il numero minimo (“da”).' };
    const na = Number(a);
    if (!(na >= 1)) return { value: '', error: 'Il numero di giocatori deve essere almeno 1.' };
    if (plus) return { value: `${na}+`, error: '' };
    if (!b) return { value: String(na), error: '' };
    const nb = Number(b);
    if (nb === na) return { value: String(na), error: '' };
    if (nb < na) return { value: '', error: 'Il primo numero deve essere più piccolo del secondo.' };
    return { value: `${na}–${nb}`, error: '' };
  }
  const playersLabel = (v) => (!v ? '' : v === '1' ? '1 giocatore' : `${v} giocatori`);

  // Modalità pubblicate dal team Busa: quelle ufficiali del gioco.
  // Icona della modalità (caricata dal CMS) in un cerchio verde Busa, alta quanto titolo + autore.
  const modeIcon = (m) => {
    if (!m.icon) return '';
    const sc = Number(m.iconScale) || 70, x = Number(m.iconX) || 0, y = Number(m.iconY) || 0;
    return `<span class="mode-icon" aria-hidden="true"><img src="${esc(m.icon)}" alt="" style="width:${sc}%;height:${sc}%;left:${x}%;top:${y}%"></span>`;
  };
  const officialBadge = `<span class="official-badge">${icon('verified', 'fill')}Team Busa</span>`;
  const BANNERS = [['#28c4d8', '#a6e84a'], ['#ffc300', '#ff7a2f'], ['#8a3ffc', '#1292e8'], ['#52ae32', '#d6f55a']];
  // Copertina caricata dall'autore, oppure banner automatico colorato con il camioncino.
  function modeBanner(m, { detail = false } = {}) {
    if (m.cover) {
      return detail
        ? `<div class="mode-cover detail"><img src="${esc(m.cover)}" alt="Copertina di ${esc(m.title)}"></div>`
        : `<div class="mode-cover"><img src="${esc(m.cover)}" alt="" loading="lazy"></div>`;
    }
    const [b1, b2] = BANNERS[Math.max(0, MODES.indexOf(m)) % BANNERS.length];
    return `<div class="mode-banner" style="--b1:${b1};--b2:${b2}${detail ? ';height:110px;border-radius:0' : ''}" aria-hidden="true"><img src="assets/img/camioncino.png" alt=""></div>`;
  }

  /* ---------------- SCOPRI: gallery ---------------- */
  function viewModes(query) {
    const state = { q: query.q || '', ord: query.ord || 'recenti', carta: CARD[query.carta] ? query.carta : '' };
    let vista = getView('scopri');
    const html = `
      <div class="page">
        ${scopriTabs('modalita')}
        <div class="toolbar" style="margin-top:14px">
          <h1 style="font-size:28px">Modalità dei giocatori</h1>
        </div>
        <p class="muted" style="margin-top:6px;font-weight:600">Inventate da chi gioca, pubblicate dopo il controllo del team Busa.</p>
        <a class="btn block secondary" href="#/crea/carte" style="margin-top:14px">${icon('add_circle')}Crea la tua modalità</a>
        <div class="search-row">
          <div class="search" role="search">
            ${icon('search')}
            <label class="sr-only" for="q">Cerca per titolo o descrizione</label>
            <input id="q" type="search" placeholder="Cerca modalità" value="${esc(state.q)}" autocomplete="off">
            <button class="icon-btn clear" type="button" aria-label="Cancella ricerca" ${state.q ? '' : 'hidden'}>${icon('close')}</button>
          </div>
          ${viewSwitch('scopri', vista)}
        </div>
        <div id="card-filter"></div>
        <div class="seg" role="group" aria-label="Ordina">
          ${[['recenti', 'Più recenti'], ['valutazione', 'Valutazione più alta'], ['voti', 'Più votate']].map(([k, l]) =>
            `<button type="button" data-ord="${k}" aria-pressed="${state.ord === k}">${l}</button>`).join('')}
        </div>
        <p class="muted" id="rank-note" style="font-size:13px;font-weight:600;margin-top:8px" hidden>In classifica le modalità con almeno ${RANK_MIN} voti; le altre seguono, dalle più recenti.</p>
        <div id="results" style="margin-top:16px"></div>
      </div>`;
    function draw() {
      const n = norm(state.q);
      document.getElementById('rank-note').hidden = state.ord !== 'valutazione';
      let list = MODES.filter((m) => (!state.carta || m.cards[state.carta]) && (!n || norm(m.title).includes(n) || norm(m.description).includes(n)));
      const fc = state.carta && CARD[state.carta];
      document.getElementById('card-filter').innerHTML = fc ? `<div class="active-filter">
          <span class="af-art">${cardArt(fc, { label: false })}</span>
          <span class="af-txt">Modalità con la carta <b>${esc(fc.name)}</b><small>${list.length} ${list.length === 1 ? 'modalità' : 'modalità'}</small></span>
          <button type="button" class="icon-btn" id="clear-card" aria-label="Togli il filtro">${icon('close')}</button></div>` : '';
      document.getElementById('clear-card')?.addEventListener('click', () => { state.carta = ''; setQuery(state); draw(); });
      list.sort((a, b) => {
        if (state.ord === 'valutazione') return byRating(a, b);
        if (state.ord === 'voti') return ratingOf(b).count - ratingOf(a).count;
        return b.date.localeCompare(a.date);
      });
      const $r = document.getElementById('results');
      if (!list.length) {
        $r.innerHTML = `<div class="empty">${icon('search_off')}<h3>Nessuna modalità trovata</h3>
          <p class="muted">Prova con altre parole, oppure inventane una tu!</p>
          <a class="btn small" href="#/crea/carte" style="margin-top:12px">${icon('add')}Crea la tua modalità</a></div>`;
        return;
      }
      if (vista === 'lista') {
        // Lista compatta: niente immagini né descrizione, carte in forma di testo.
        $r.innerHTML = `<div class="mode-list">${list.map((m) => `
          <a class="mode-row ${m.official ? 'official' : ''}" href="#/scopri/${m.id}">
            <span class="mr-main">
              ${m.official ? officialBadge : ''}
              <span class="title-row"><span class="tr-text"><b>${highlight(m.title, state.q)}</b>
              <span class="by">di <b>${esc(m.author)}</b></span></span>${modeIcon(m)}</span>
              <span class="facts">${m.players ? `<span>${icon('group')}${esc(m.players)}</span>` : ''}<span>${icon('style')}${modeTotal(m)} carte</span>${ratingText(m)}</span>
              <span class="mr-cards">${modeCardList(m).map(({ card, qty }) => card.id === state.carta ? `<mark>${esc(card.name)} ×${qty}</mark>` : `${esc(card.name)} ×${qty}`).join(' · ')}</span>
            </span>${icon('chevron_right')}</a>`).join('')}</div>`;
        return;
      }
      $r.innerHTML = list.map((m) => {
        const cl = modeCardList(m);
        const shown = cl.slice(0, cl.length > 5 ? 4 : 5);
        return `<article class="mode-card ${m.official ? 'official' : ''}">
          ${modeBanner(m)}${m.official ? `<div class="official-strip">${officialBadge}</div>` : ''}
          <div class="mode-body">
            <div class="title-row"><div class="tr-text"><h2>${highlight(m.title, state.q)}</h2>
            <p class="by">di <b>${esc(m.author)}</b></p></div>${modeIcon(m)}</div>
            <p class="desc">${highlight(m.description, state.q)}</p>
            <div class="facts">
              ${m.players ? `<span>${icon('group')}${esc(playersLabel(m.players))}</span>` : ''}
              <span>${icon('style')}${modeTotal(m)} carte Busa</span>
              ${ratingText(m)}
              ${fc ? `<span class="hl-card">${esc(fc.name)} ×${m.cards[fc.id]}</span>` : ''}
            </div>
            <div class="mini-cards" aria-label="Anteprima carte">
              ${shown.map(({ card, qty }) => `<div class="mini" title="${esc(card.name)} ×${qty}">${cardArt(card, { label: false })}<span class="qty">×${qty}</span></div>`).join('')}
              ${cl.length > shown.length ? `<div class="mini more">+${cl.length - shown.length}</div>` : ''}
            </div>
            <a class="btn block" href="#/scopri/${m.id}">Scopri le carte${icon('chevron_right')}</a>
          </div>
        </article>`;
      }).join('');
    }
    return {
      section: 'scopri', title: 'Modalità dei giocatori', html,
      mount() {
        draw();
        bindViewSwitch('scopri', (v) => { vista = v; draw(); });
        const $q = document.getElementById('q'), $clear = $view.querySelector('.clear');
        $q.addEventListener('input', () => { state.q = $q.value; $clear.hidden = !state.q; setQuery(state); draw(); });
        $clear.addEventListener('click', () => { $q.value = ''; $q.dispatchEvent(new Event('input')); $q.focus(); });
        $view.querySelectorAll('[data-ord]').forEach((b) => b.addEventListener('click', () => {
          state.ord = b.dataset.ord; setQuery(state);
          $view.querySelectorAll('[data-ord]').forEach((x) => x.setAttribute('aria-pressed', x === b));
          draw();
        }));
      },
    };
  }

  /* ---------------- SCOPRI: dettaglio modalità ---------------- */
  function viewMode(id, query) {
    const m = MODES.find((x) => x.id === id);
    if (!m) return viewNotFound();
    const layout = query.vista === 'lista' ? 'lista' : 'griglia';
    const cl = modeCardList(m);
    const html = `
      <div style="margin-bottom:-8px">${modeBanner(m, { detail: true })}</div>
      <div class="page">
        <header class="mode-head">
          <div class="title-row"><div class="tr-text"><h1>${esc(m.title)}</h1>
          <p class="by" style="margin-top:4px">di <b>${esc(m.author)}</b></p></div>${modeIcon(m)}</div>
          <div class="facts">
            ${m.players ? `<span>${icon('group')}${esc(playersLabel(m.players))}</span>` : ''}
            <span>${icon('style')}${modeTotal(m)} carte Busa</span>
            <span id="rating-inline">${ratingText(m, true)}</span>
          </div>
          <p style="margin-top:12px">${esc(m.description)}</p>
        </header>
        ${m.rules ? `<section class="info-box"><h3>${icon('rule')}Regole aggiuntive</h3><p>${esc(m.rules)}</p></section>` : ''}
        <button class="btn block" id="variant" style="margin-top:12px">${icon('edit')}Crea una variante</button>

        <div class="section-title" style="justify-content:space-between">
          <h2 style="font-size:20px">Carte necessarie</h2>
          <div class="seg" role="group" aria-label="Visualizzazione" style="min-width:150px">
            <button type="button" data-vista="griglia" aria-pressed="${layout === 'griglia'}" aria-label="Miniature">${icon('grid_view')}</button>
            <button type="button" data-vista="lista" aria-pressed="${layout === 'lista'}" aria-label="Lista">${icon('view_list')}</button>
          </div>
        </div>
        ${layout === 'griglia' ? `
          <div class="thumb-grid">
            ${cl.map(({ card, qty }) => `<button class="thumb" data-zoom="${card.id}" aria-label="Ingrandisci ${esc(card.name)}, ${qty} copie">
              <div class="wrap">${cardArt(card)}<span class="qty-badge">×${qty}</span></div>
              <span class="lbl">${esc(card.name)}<small>#${pad2(card.number)}</small></span></button>`).join('')}
          </div>` : `
          <ul class="card-list">
            ${cl.map(({ card, qty }) => `<li><span class="n">#${pad2(card.number)}</span><span class="nm">${esc(card.name)}</span><span class="q">×${qty}</span>
              <button class="icon-btn" data-zoom="${card.id}" aria-label="Ingrandisci ${esc(card.name)}">${icon('zoom_in')}</button></li>`).join('')}
            <li class="total"><span class="nm">Totale carte Busa</span><span class="q">${modeTotal(m)}</span></li>
          </ul>`}
        <p class="muted" style="font-size:13px;font-weight:600;margin-top:10px">${icon('info', '')} Le carte del mazzo di base si usano come sempre: qui trovi solo le carte Busa da aggiungere.</p>
        <section class="share-box" aria-labelledby="share-title">
          <h2 id="share-title">${icon('share')}Condividi e stampa</h2>
          <div class="share-actions">
            <button class="btn secondary small" id="copy-link">${icon('link')}Copia link</button>
            ${navigator.share ? `<button class="btn secondary small" id="native-share">${icon('ios_share')}Condividi…</button>` : ''}
            <button class="btn secondary small" id="pdf">${icon('picture_as_pdf')}Scarica PDF</button>
          </div>
          <p class="hint">Il link apre l’app direttamente su questa modalità. Il PDF (15 × 19 cm) riassume tutto quello che serve per giocare ed è pronto da stampare.</p>
        </section>

        <section class="vote-box" id="vote" aria-labelledby="vote-title"></section>
      </div>`;

    return {
      section: 'scopri', back: '#/scopri', title: m.title, html, keepScroll: !!query.vista,
      mount() {
        voteBox(m, { key: m.id, body: { modeId: m.id }, inline: 'rating-inline' });
        $view.querySelectorAll('[data-vista]').forEach((b) => b.addEventListener('click', () => {
          history.replaceState(null, '', buildHash('scopri/' + m.id, { vista: b.dataset.vista })); route();
        }));
        $view.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
          const card = CARD[b.dataset.zoom];
          openCardModal(card, { extra: `<p class="sub" style="font-size:18px;color:var(--green-dark)">In questa modalità: ×${m.cards[card.id]}</p>` });
        }));
        const url = location.href.split('#')[0] + '#/scopri/' + m.id;
        document.getElementById('copy-link').onclick = async () => {
          toast((await copyText(url)) ? 'Link copiato! Incollalo dove vuoi.' : 'Non è stato possibile copiare il link');
        };
        document.getElementById('native-share')?.addEventListener('click', () => {
          navigator.share({ title: `MÖVAT! — ${m.title}`, text: `Prova la modalità “${m.title}” di ${m.author}`, url }).catch(() => {});
        });
        document.getElementById('pdf').onclick = async (e) => {
          const b = e.currentTarget, label = b.innerHTML;
          b.disabled = true; b.innerHTML = icon('progress_activity', 'spin') + 'Preparo il PDF…';
          try { await downloadModePdf(m, url); toast('PDF scaricato'); }
          catch (er) { console.error(er); toast('Non è stato possibile creare il PDF. Riprova.'); }
          finally { b.disabled = false; b.innerHTML = label; }
        };
        document.getElementById('variant').onclick = () => {
          const d = draft.get();
          const hasData = Object.keys(d.cards).length || d.name || d.description;
          if (hasData && !confirm('Hai già una modalità in preparazione. Vuoi sostituirne le carte con quelle di “' + m.title + '”?')) return;
          draft.update({ start: m.id, cards: { ...m.cards }, onlySelected: false, q: '' });
          toast('Carte di “' + m.title + '” caricate');
          go('#/crea/carte');
        };
      },
    };
  }

  // Riquadro di votazione (modalità o carte dei giocatori): scelta delle stelle e conferma con un pulsante.
  // Il voto si aggiorna nell'interfaccia solo dopo la conferma del server.
  function voteBox(m, { key, body, inline, what = 'modalità' }) {
    const drawVote = (editing, errMsg = '') => {
      const r = ratingOf(m, key);
      const $v = document.getElementById('vote');
      if (!$v) return;
      if (inline) document.getElementById(inline).innerHTML = ratingText(m, true, key);
      const summary = r.count ? `${fmtNum(r.avg)} su 5 · ${r.count} ${r.count === 1 ? 'voto' : 'voti'}` : 'Ancora nessun voto';
      if (m.votingOpen === false) {
        $v.innerHTML = `<h2 id="vote-title">Valutazioni</h2><p class="summary">${summary}</p>
          ${r.mine ? `<p class="voted">${icon('check_circle', 'fill')}Hai dato ${r.mine} ${r.mine === 1 ? 'stella' : 'stelle'}</p>` : ''}
          <p class="muted" style="font-size:14px;margin-top:8px;font-weight:600">${icon('pause_circle')} Le votazioni sono momentaneamente sospese.</p>`;
        return;
      }
      if (r.mine && !editing) {
        $v.innerHTML = `<h2 id="vote-title">Grazie per il tuo voto!</h2>
          <p class="summary">${summary}</p>
          <div class="stars" aria-hidden="true">${[1, 2, 3, 4, 5].map((n) => `<button tabindex="-1" class="${n <= r.mine ? 'on' : ''}">${icon('star')}</button>`).join('')}</div>
          <p class="voted">${icon('check_circle', 'fill')}Hai dato ${r.mine} ${r.mine === 1 ? 'stella' : 'stelle'}</p>
          <div style="margin-top:12px"><button class="btn ghost small" id="edit-vote">${icon('edit')}Modifica il voto</button></div>`;
        document.getElementById('edit-vote').onclick = () => drawVote(true);
        return;
      }
      let pick = editing && typeof editing === 'number' ? editing : r.mine || 0;
      $v.innerHTML = `<h2 id="vote-title">${what === 'carta' ? 'Ti piace questa carta? Valutala!' : 'Hai provato questa modalità? Valutala!'}</h2>
        <p class="summary">${summary}</p>
        <div class="stars" role="radiogroup" aria-label="Il tuo voto da 1 a 5 stelle">
          ${[1, 2, 3, 4, 5].map((n) => `<button role="radio" aria-checked="${n === pick}" data-star="${n}" aria-label="${n} ${n === 1 ? 'stella' : 'stelle'}">${icon('star')}</button>`).join('')}
        </div>
        <button class="btn block" id="send-vote" ${pick ? '' : 'disabled'}>${pick ? `Conferma ${pick} ${pick === 1 ? 'stella' : 'stelle'}` : 'Scegli da 1 a 5 stelle'}</button>
        ${editing ? `<button class="btn ghost small" id="cancel-vote" style="margin-top:10px">Annulla</button>` : ''}
        <p class="vote-err" role="alert" ${errMsg ? '' : 'hidden'}>${icon('error', 'fill')}<span>${esc(errMsg)}</span></p>
        <p class="muted" style="font-size:13px;margin-top:10px;font-weight:600">Nessun account: il voto è legato a questo browser e puoi modificarlo quando vuoi.</p>`;
      const paint = () => {
        $v.querySelectorAll('[data-star]').forEach((b) => { const n = +b.dataset.star; b.classList.toggle('on', n <= pick); b.setAttribute('aria-checked', n === pick); });
        const sb = document.getElementById('send-vote');
        sb.disabled = !pick; sb.textContent = pick ? `Conferma ${pick} ${pick === 1 ? 'stella' : 'stelle'}` : 'Scegli da 1 a 5 stelle';
      };
      paint();
      $v.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', () => { pick = +b.dataset.star; paint(); loadTurnstile().catch(() => {}); }));
      document.getElementById('send-vote').onclick = async () => {
        const sb = document.getElementById('send-vote');
        const wasEdit = !!r.mine;
        if (API) {
          sb.disabled = true; sb.innerHTML = icon('progress_activity', 'spin') + 'Invio…';
          try {
            const d = await protectedPost('api/votes', { ...body, value: pick }, 'vote');
            m.ratingSum = d.ratingSum; m.ratingCount = d.ratingCount; MY_VOTES[voteKey(key)] = d.mine;
          } catch (e) {
            if (e.code === 'voting-suspended') m.votingOpen = false;
            // La scelta resta: basta premere di nuovo il pulsante.
            drawVote(pick, e.message || 'Voto non inviato. Riprova.');
            return;
          }
        } else { localVotes[key] = pick; store.set('votes', localVotes); }
        toast(wasEdit ? 'Voto aggiornato' : 'Voto registrato, grazie!');
        drawVote(false);
      };
      const c = document.getElementById('cancel-vote'); if (c) c.onclick = () => drawVote(false);
    };
    drawVote(false);
  }

  /* ---------------- PDF della modalità (15 × 19 cm) ---------------- */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script'); el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('script')); document.head.appendChild(el);
    });
  }
  // Converte un'immagine in JPEG/PNG (data URL) per inserirla nel PDF.
  function imageData(src, type = 'image/png') {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const ctx = cv.getContext('2d');
        if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
        ctx.drawImage(img, 0, 0);
        resolve({ data: cv.toDataURL(type, 0.9), w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = reject; img.src = src;
    });
  }
  async function downloadModePdf(m, url) {
    if (!window.jspdf) await loadScript('assets/vendor/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;
    const W = 150, H = 190, M = 12, FOOT = 12;
    const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'portrait' });
    const GREEN = [67, 150, 38], DARK = [24, 35, 23], MUTED = [92, 105, 87], LIGHT = [234, 248, 228], YELLOW = [255, 195, 0];
    const r = ratingOf(m), cl = modeCardList(m);
    let y = 0;

    const footer = () => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED);
      doc.text('MÖVAT! · Busa Trasporti e Logistica', M, H - 6);
      doc.text(doc.splitTextToSize(url, 80)[0], W - M, H - 6, { align: 'right' });
    };
    const ensure = (h) => { if (y + h > H - FOOT) { footer(); doc.addPage([W, H], 'portrait'); y = M; } };
    const heading = (t) => { ensure(10); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...GREEN); doc.text(t.toUpperCase(), M, y + 4); y += 7; };
    const para = (t, size = 10) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...DARK);
      const lh = size * 0.45;
      for (const line of doc.splitTextToSize(String(t), W - 2 * M)) { ensure(lh); doc.text(line, M, y + lh * 0.8); y += lh; }
      y += 3;
    };
    const star = (cx, cy, rad, fill) => {
      const pts = [];
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? rad * 0.45 : rad; pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
      const segs = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
      doc.setFillColor(...fill); doc.setDrawColor(...fill); doc.lines(segs, pts[0][0], pts[0][1], [1, 1], 'F', true);
    };

    // Intestazione verde con il logo
    doc.setFillColor(...GREEN); doc.rect(0, 0, W, 24, 'F');
    try { const logo = await imageData('assets/img/logo-movat.png'); doc.addImage(logo.data, 'PNG', M, 4.5, 15 * logo.w / logo.h, 15); } catch { /* logo facoltativo */ }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
    doc.text('MODALITÀ DEI GIOCATORI', W - M, 14, { align: 'right' });
    y = 32;

    // Copertina (se presente) e titolo
    let titleW = W - 2 * M;
    if (m.cover) {
      try { const c = await imageData(m.cover, 'image/jpeg'); doc.addImage(c.data, 'JPEG', W - M - 32, 30, 32, 32); titleW -= 36; } catch { /* copertina facoltativa */ }
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...DARK);
    const tl = doc.splitTextToSize(m.title, titleW);
    tl.forEach((line, i) => doc.text(line, M, y + 6 + i * 7.5));
    y += 6 + (tl.length - 1) * 7.5 + 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED);
    doc.text(`di ${m.author}`, M, y); y += 5;
    if (m.cover) y = Math.max(y, 66);
    y += 3;

    // Riquadro con giocatori, carte e voto
    const boxH = 20, colW = (W - 2 * M) / 3;
    doc.setFillColor(...LIGHT); doc.roundedRect(M, y, W - 2 * M, boxH, 3, 3, 'F');
    const fact = (i, label, value) => {
      const x = M + colW * i + 4;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(label, x, y + 6);
      doc.setFontSize(12); doc.setTextColor(...DARK); if (value) doc.text(value, x, y + 13.5);
    };
    fact(0, 'GIOCATORI', m.players || '—');  // es. "2", "2–5", "5+"
    fact(1, 'CARTE BUSA', String(modeTotal(m)));
    fact(2, 'VALUTAZIONE', '');
    const sx = M + colW * 2 + 4;
    const full = Math.round(r.avg);
    for (let i = 0; i < 5; i++) star(sx + 2.2 + i * 5, y + 11.2, 2.2, i < full && r.count ? YELLOW : [205, 214, 200]);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text(r.count ? `${fmtNum(r.avg)} su 5 · ${r.count} ${r.count === 1 ? 'voto' : 'voti'}` : 'Ancora nessun voto', sx, y + 17);
    y += boxH + 7;

    heading('Descrizione'); para(m.description);
    if (m.rules) { heading('Regole aggiuntive'); para(m.rules); }

    // Elenco delle carte
    heading('Carte Busa necessarie');
    doc.setFontSize(10);
    cl.forEach(({ card, qty }, i) => {
      ensure(7);
      if (i % 2 === 0) { doc.setFillColor(246, 250, 243); doc.rect(M, y, W - 2 * M, 7, 'F'); }
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...MUTED); doc.text(`#${pad2(card.number)}`, M + 2, y + 4.8);
      doc.setTextColor(...DARK); doc.text(doc.splitTextToSize(card.name, W - 2 * M - 34)[0], M + 14, y + 4.8);
      doc.setTextColor(...GREEN); doc.text(`×${qty}`, W - M - 2, y + 4.8, { align: 'right' });
      y += 7;
    });
    ensure(9);
    doc.setDrawColor(...GREEN); doc.setLineWidth(0.4); doc.line(M, y + 1, W - M, y + 1);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK); doc.text('Totale carte Busa', M + 2, y + 6.5);
    doc.setTextColor(...GREEN); doc.text(String(modeTotal(m)), W - M - 2, y + 6.5, { align: 'right' });
    y += 11;
    para('Più le carte del mazzo di base, che si usano come sempre.', 8.5);
    footer();
    // Scaricamento gestito direttamente: funziona anche su Android e iPhone.
    const blob = doc.output('blob');
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = `movat-${m.id}.pdf`; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  }

  /* ---------------- Modal carta ---------------- */
  function openCardModal(card, { extra = '', body = '', onMount, listen = true } = {}) {
    const root = document.getElementById('modal-root');
    const opener = document.activeElement;
    root.innerHTML = `<div class="modal-backdrop" data-close>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mtitle">
        <div class="grab"></div>
        <div class="close-row"><button class="icon-btn" data-close aria-label="Chiudi">${icon('close')}</button></div>
        ${cardArt(card)}
        <h2 id="mtitle">${esc(card.name)}</h2>
        <p class="sub">Carta n. ${card.number} · ${card.copies} ${card.copies === 1 ? 'copia' : 'copie'} nella scatola</p>
        ${extra}
        ${body}
        ${card.audio && listen ? `<a class="btn block secondary" style="margin-top:16px" href="#/ascolta/${card.id}">${icon('headphones')}Ascolta la frase</a>` : ''}
      </div></div>`;
    const bd = root.firstElementChild;
    bd.addEventListener('click', (e) => { if (e.target.closest('[data-close]') && (e.target === bd || e.target.closest('button[data-close]'))) closeModal(opener); });
    document.addEventListener('keydown', escClose);
    root.querySelector('button[data-close]').focus();
    onMount?.(root);
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal(opener) {
    const root = document.getElementById('modal-root');
    if (!root.innerHTML) return;
    root.innerHTML = ''; document.removeEventListener('keydown', escClose);
    opener?.focus?.();
  }

  /* ---------------- CREA: bozza persistente ---------------- */
  const EMPTY_DRAFT = { start: 'vuota', cards: {}, onlySelected: false, q: '', name: '', description: '', players: '', pFrom: '', pTo: '', pPlus: false, rules: '', tried: '', nickname: '', email: '', notify: false, consent: false, cover: '', idem: '' };
  // La copertina resta anche in memoria, nel caso il browser non riesca a salvarla sul dispositivo.
  let coverMem = '';
  const draft = {
    get() {
      const saved = store.get('draft', {});
      const d = { ...EMPTY_DRAFT, ...saved };
      if (!d.cover && coverMem) d.cover = coverMem;
      // Bozze salvate prima dei campi "da"/"a": li ricava dal testo.
      if (saved.players && saved.pFrom === undefined) { const p = parsePlayers(saved.players); d.pFrom = p.from; d.pTo = p.plus ? '' : p.to; d.pPlus = p.plus; }
      return d;
    },
    update(patch) {
      if ('cover' in patch) coverMem = patch.cover;
      const d = { ...this.get(), ...patch }; store.set('draft', d); return d;
    },
    clear() { store.del('draft'); coverMem = ''; },
  };
  const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const COVER_MAX_MB = 10;
  // Ritaglia al centro un quadrato e lo riduce a 1024 × 1024 px (JPEG).
  function makeCover(file) {
    return new Promise((resolve, reject) => {
      if (!COVER_TYPES.includes(file.type)) return reject(new Error('Formato non supportato: usa JPG, PNG o WEBP.'));
      if (file.size > COVER_MAX_MB * 1024 * 1024) return reject(new Error(`L’immagine supera i ${COVER_MAX_MB} MB.`));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const out = Math.min(1024, side);
        const cv = document.createElement('canvas'); cv.width = out; cv.height = out;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out, out);
        ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Non riusciamo a leggere questa immagine.')); };
      img.src = url;
    });
  }
  const totalOf = (cards) => Object.values(cards).reduce((a, b) => a + b, 0);
  function validateDetails(d) {
    const e = {};
    if (!d.name.trim()) e.name = 'Dai un nome alla tua modalità.';
    else if (d.name.trim().length < 3) e.name = 'Il nome deve avere almeno 3 caratteri.';
    if (!d.description.trim()) e.description = 'Racconta in breve come si gioca.';
    else if (d.description.trim().length < 20) e.description = 'Aggiungi qualche dettaglio in più (almeno 20 caratteri).';
    if (!d.nickname.trim()) e.nickname = 'Scegli il nickname che apparirà accanto alla modalità.';
    if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim())) e.email = 'Questo indirizzo email non sembra corretto.';
    const pl = playersFrom(d.pFrom, d.pTo, d.pPlus);
    if (pl.error) e.players = pl.error;
    return e;
  }
  // Notifiche via email: solo se richieste e dopo la conferma dell'indirizzo.
  const notifyCheck = (d) => `<label class="check notify-check" ${d.email.trim() ? '' : 'hidden'}>
      <input type="checkbox" name="notify" id="f-notify" ${d.notify ? 'checked' : ''}>
      <span>Avvisami via email quando il team Busa avrà controllato la proposta. <span class="muted">Ti chiederemo di confermare l’indirizzo; niente newsletter.</span></span></label>`;
  function bindNotify($f, dr) {
    const $n = $f.querySelector('#f-notify'), $e = $f.querySelector('[name=email]');
    if (!$n || !$e) return;
    $n.addEventListener('change', () => dr.update({ notify: $n.checked }));
    $e.addEventListener('input', () => { $n.closest('label').hidden = !$e.value.trim(); });
  }
  // Messaggi d'errore dei campi restituiti dal server (es. carta non più disponibile).
  const errList = (e) => (e.details ? `<ul style="margin:6px 0 0 18px">${Object.values(e.details).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  function sendFailBox(e) {
    const offline = e.network;
    return `<div class="alert" role="alert">${icon(offline ? 'wifi_off' : 'error')}<div><b>Invio non riuscito.</b><br>${esc(e.message || 'Riprova tra poco.')}${errList(e)}
      <br>I dati che hai inserito sono al sicuro.
      <div><button class="btn danger small" id="retry">${icon('refresh')}Riprova l’invio</button></div></div></div>`;
  }
  function stepper(step) {
    const steps = [['carte', 'Carte'], ['dettagli', 'Dettagli'], ['riepilogo', 'Invia']];
    const idx = steps.findIndex(([k]) => k === step);
    return `<nav class="stepper" aria-label="Avanzamento">
      <div class="bar" style="width:calc((100% - 48px) * ${idx / 2})"></div>
      ${steps.map(([k, l], i) => {
        const cls = i < idx ? 'done' : i === idx ? 'current' : '';
        const inner = `<span class="dot">${i < idx ? icon('check') : i + 1}</span>${l}`;
        return i < idx ? `<a class="step ${cls}" href="#/crea/${k}" style="text-decoration:none">${inner}</a>`
          : `<span class="step ${cls}" ${i === idx ? 'aria-current="step"' : ''}>${inner}</span>`;
      }).join('')}
    </nav>`;
  }

  function viewCreate(step, query) {
    if (step === 'carte') return viewCreateCards();
    if (step === 'dettagli') return viewCreateDetails(query);
    if (step === 'riepilogo') return viewCreateReview(query);
    if (step === 'inviata') return viewCreateDone();
    if (step === 'carta') return viewCreateCard(query);
    if (step === 'carta-dettagli') return viewCreateCardDetails(query);
    if (step === 'carta-riepilogo') return viewCreateCardReview(query);
    if (step === 'carta-inviata') return viewCreateCardDone();
    return viewNotFound();
  }

  /* PASSAGGIO 1 — CARTE */
  function viewCreateCards() {
    let d = draft.get();
    let vista = getView('crea');
    const html = `
      <div class="page">
        ${flowSwitch('modalita')}
        <h1 class="page-title" style="font-size:26px;margin-top:14px">Crea la tua modalità</h1>
        ${stepper('carte')}
        <section class="start-box">
          <span class="lbl" id="start-lbl" style="font:800 13px/1 var(--font-body);color:var(--ink-muted);display:block;margin:0 4px 8px;letter-spacing:.03em;text-transform:uppercase">Punto di partenza</span>
          <div class="seg" role="group" aria-labelledby="start-lbl">
            <button type="button" data-start="vuota" aria-pressed="${d.start === 'vuota'}">Combinazione vuota</button>
            <button type="button" data-start="modalita" aria-pressed="${d.start !== 'vuota'}">Da una modalità</button>
          </div>
          <div id="start-select" ${d.start === 'vuota' ? 'hidden' : ''}>
            <label class="sr-only" for="from-mode">Modalità di partenza</label>
            <select id="from-mode">
              <option value="">Scegli una modalità esistente…</option>
              ${MODES.map((m) => `<option value="${m.id}" ${d.start === m.id ? 'selected' : ''}>${esc(m.title)} — di ${esc(m.author)}</option>`).join('')}
            </select>
          </div>
        </section>
        <div class="base-note">${icon('info')}<span>Le carte del <b>mazzo di base</b> sono incluse automaticamente: scegli qui solo le <b>carte Busa</b> da aggiungere.</span></div>
        <div class="filter-row">
          <div class="search" role="search">
            ${icon('search')}
            <label class="sr-only" for="q">Cerca per numero o nome della carta</label>
            <input id="q" type="search" placeholder="Numero o nome" value="${esc(d.q)}" autocomplete="off">
          </div>
          <div class="filter-tools">
            <button class="chip" id="only-sel" aria-pressed="${d.onlySelected}">${icon('check_circle', d.onlySelected ? 'fill' : '')}Solo selezionate</button>
            ${viewSwitch('crea', vista)}
          </div>
        </div>
        <div id="pick" style="margin-top:14px"></div>
        <div class="sticky-action" id="bar"></div>
      </div>`;

    function qtyControl(card, qty) {
      return `<div class="qty-step">
          <button type="button" data-dec="${card.id}" aria-label="Togli una ${esc(card.name)}" ${qty <= 0 ? 'disabled' : ''}>${icon('remove')}</button>
          <output aria-live="polite" aria-label="Quantità ${esc(card.name)}">${qty}</output>
          <button type="button" class="plus" data-inc="${card.id}" aria-label="Aggiungi una ${esc(card.name)}" ${qty >= card.copies ? 'disabled' : ''}>${icon('add')}</button>
        </div>
        <div class="max">${qty >= card.copies ? `Massimo raggiunto (${card.copies})` : `Max ${card.copies} ${card.copies === 1 ? 'copia' : 'copie'}`}</div>`;
    }
    // Un elemento della selezione, nella visualizzazione scelta.
    function itemHtml(c, qty) {
      if (vista === 'lista') {
        return `<li class="pick-row ${qty ? 'selected' : ''}" data-card="${c.id}">
          <button class="pr-name" type="button" data-zoom="${c.id}"><small>#${pad2(c.number)}</small>${esc(c.name)}</button>
          <div class="qc">${qtyControl(c, qty)}</div></li>`;
      }
      if (vista === 'griglia') {
        return `<button type="button" class="sq-tile pick ${qty ? 'selected' : ''}" data-card="${c.id}" data-zoom="${c.id}" aria-label="${esc(c.name)}: ${qty} selezionate. Tocca per scegliere la quantità">
          <span class="sq-art">${cardArt(c)}</span><span class="sq-num">${c.number}</span>
          ${qty ? `<span class="sq-qty">×${qty}</span>` : ''}<span class="sq-name">${esc(c.name)}</span></button>`;
      }
      return `<article class="pick-card ${qty ? 'selected' : ''}" data-card="${c.id}">
            <button class="zoom" type="button" data-zoom="${c.id}" aria-label="Ingrandisci ${esc(c.name)}">${cardArt(c)}</button>
            <div class="nm"><small>#${pad2(c.number)}</small>${esc(c.name)}</div>
            <div class="qc">${qtyControl(c, qty)}</div>
          </article>`;
    }
    function drawGrid() {
      d = draft.get();
      let list = CARDS.filter((c) => matchesCard(c, d.q));
      if (d.onlySelected) list = list.filter((c) => d.cards[c.id]);
      const $p = document.getElementById('pick');
      if (!list.length) {
        $p.style.display = 'block';
        $p.innerHTML = `<div class="empty">${icon(d.onlySelected ? 'filter_alt_off' : 'search_off')}
          <h3>${d.onlySelected && !totalOf(d.cards) ? 'Nessuna carta selezionata' : 'Nessuna carta trovata'}</h3>
          <p class="muted">${d.onlySelected ? 'Togli il filtro “Solo selezionate” per vedere tutte le carte.' : 'Prova con un altro numero o nome.'}</p></div>`;
      } else {
        $p.style.display = '';
        const items = list.map((c) => itemHtml(c, d.cards[c.id] || 0)).join('');
        $p.innerHTML = vista === 'lista' ? `<ul class="pick-list">${items}</ul>`
          : vista === 'griglia' ? `<div class="sq-grid">${items}</div>`
          : `<div class="card-grid ${vista === 'uno' ? 'cols-1 big' : ''}">${items}</div>`;
      }
      drawBar();
    }
    function drawBar(err) {
      const t = totalOf(draft.get().cards);
      document.getElementById('bar').innerHTML = `
        <div class="tot"><b>${t}</b>${t === 1 ? 'carta Busa selezionata' : 'carte Busa selezionate'}${err ? `<div class="err" role="alert">${err}</div>` : ''}</div>
        <button class="btn" id="next">Continua${icon('arrow_forward')}</button>`;
      document.getElementById('next').onclick = () => {
        if (!totalOf(draft.get().cards)) { drawBar('Scegli almeno una carta per continuare.'); return; }
        go('#/crea/dettagli');
      };
    }
    function setQty(id, delta, keepFocus) {
      const c = CARD[id]; d = draft.get();
      const cards = { ...d.cards };
      const q = Math.min(c.copies, Math.max(0, (cards[id] || 0) + delta));
      if (q) cards[id] = q; else delete cards[id];
      draft.update({ cards });
      const art = $view.querySelector(`[data-card="${id}"]`);
      if (art) {
        if (d.onlySelected && !q) { drawGrid(); return; }
        art.outerHTML = itemHtml(c, q);
        $view.querySelector(`[data-card="${id}"] output`)?.classList.add('bump');
        if (!keepFocus) $view.querySelector(`[data-card="${id}"] ${delta > 0 ? '[data-inc]' : '[data-dec]'}`)?.focus();
      }
      drawBar();
      return q;
    }
    return {
      section: 'crea', title: 'Crea: scegli le carte', html,
      mount() {
        drawGrid();
        bindViewSwitch('crea', (v) => { vista = v; drawGrid(); });
        $view.addEventListener('click', (e) => {
          const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]'), z = e.target.closest('[data-zoom]');
          if (inc) setQty(inc.dataset.inc, +1);
          else if (dec) setQty(dec.dataset.dec, -1);
          else if (z) {
            const card = CARD[z.dataset.zoom];
            openCardModal(card, {
              listen: false, // in Crea non si esce dal percorso
              body: `<div style="margin-top:16px" id="mq"></div>`,
              onMount(root) {
                const paint = () => { root.querySelector('#mq').innerHTML = qtyControl(card, draft.get().cards[card.id] || 0); };
                paint();
                root.querySelector('#mq').addEventListener('click', (ev) => {
                  if (ev.target.closest('[data-inc]')) setQty(card.id, +1, true);
                  if (ev.target.closest('[data-dec]')) setQty(card.id, -1, true);
                  paint();
                });
              },
            });
          }
        });
        const $q = document.getElementById('q');
        $q.addEventListener('input', () => { draft.update({ q: $q.value }); drawGrid(); });
        document.getElementById('only-sel').onclick = (e) => {
          const on = !draft.get().onlySelected; draft.update({ onlySelected: on });
          e.currentTarget.setAttribute('aria-pressed', on);
          e.currentTarget.innerHTML = icon('check_circle', on ? 'fill' : '') + 'Solo selezionate';
          drawGrid();
        };
        $view.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => {
          const empty = b.dataset.start === 'vuota';
          $view.querySelectorAll('[data-start]').forEach((x) => x.setAttribute('aria-pressed', x === b));
          document.getElementById('start-select').hidden = empty;
          if (empty) {
            const had = totalOf(draft.get().cards);
            if (had && !confirm('Vuoi azzerare le carte selezionate?')) {
              $view.querySelectorAll('[data-start]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.start !== 'vuota')); document.getElementById('start-select').hidden = false; return;
            }
            draft.update({ start: 'vuota', cards: {} }); drawGrid();
          } else document.getElementById('from-mode').focus();
        }));
        document.getElementById('from-mode').addEventListener('change', (e) => {
          const m = MODES.find((x) => x.id === e.target.value); if (!m) return;
          draft.update({ start: m.id, cards: { ...m.cards } });
          toast('Carte di “' + m.title + '” caricate'); drawGrid();
        });
      },
    };
  }

  /* PASSAGGIO 2 — DETTAGLI */
  function viewCreateDetails(query) {
    const d = draft.get();
    if (!totalOf(d.cards)) { history.replaceState(null, '', '#/crea/carte'); route(); return null; }
    const showErrors = query.verifica === '1';
    const errs = showErrors ? validateDetails(d) : {};
    const field = (key, label, input, { req, opt, hint, count } = {}) => `
      <div class="field ${errs[key] ? 'invalid' : ''}" data-field="${key}">
        <label for="f-${key}">${label} ${req ? '<span class="req" aria-hidden="true">*</span>' : ''}${opt ? `<span class="opt">${opt}</span>` : ''}</label>
        ${input}
        ${count ? `<div class="count"><span data-count="${key}">${d[key].length}</span>/${count}</div>` : ''}
        ${hint ? `<p class="hint" id="h-${key}">${hint}</p>` : ''}
        <p class="error" id="e-${key}" ${errs[key] ? '' : 'hidden'}>${icon('error', 'fill')}<span>${esc(errs[key] || '')}</span></p>
      </div>`;
    const attrs = (key, req) => `id="f-${key}" name="${key}" ${req ? 'required aria-required="true"' : ''} aria-describedby="e-${key} h-${key}" ${errs[key] ? 'aria-invalid="true"' : ''}`;
    const html = `
      <div class="page">
        <h1 class="page-title" style="font-size:26px">Racconta la tua modalità</h1>
        ${stepper('dettagli')}
        ${Object.keys(errs).length ? `<div class="form-error-summary" role="alert">${icon('error', 'fill')}<span>Controlla ${Object.keys(errs).length === 1 ? 'il campo evidenziato' : `i ${Object.keys(errs).length} campi evidenziati`} prima di proseguire.</span></div>` : ''}
        <form class="form" id="form" novalidate style="margin-top:12px">
          ${field('name', 'Nome della modalità', `<input type="text" ${attrs('name', true)} maxlength="60" value="${esc(d.name)}" placeholder="Es. Sorpassi a sorpresa" autocomplete="off">`, { req: true, count: 60 })}
          ${field('description', 'Descrizione', `<textarea ${attrs('description', true)} maxlength="600" placeholder="Come si gioca? Cosa la rende divertente?">${esc(d.description)}</textarea>`, { req: true, count: 600 })}
          <fieldset class="field ${errs.players ? 'invalid' : ''}" data-field="players">
            <legend>Giocatori consigliati <span class="opt">(facoltativo)</span></legend>
            <div class="players-row">
              <label class="pl-box"><span>Da</span><input id="p-from" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" value="${esc(d.pFrom)}" aria-label="Numero minimo di giocatori" aria-describedby="e-players p-preview" ${errs.players ? 'aria-invalid="true"' : ''}></label>
              <button type="button" class="plus-toggle" id="p-plus" aria-pressed="${!!d.pPlus}" title="o più" aria-label="Oppure più giocatori (es. 5+)">+</button>
              <label class="pl-box"><span>a</span><input id="p-to" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" value="${esc(d.pPlus ? '' : d.pTo)}" aria-label="Numero massimo di giocatori" ${d.pPlus ? 'disabled' : ''}></label>
            </div>
            <p class="hint" id="p-preview"></p>
            <p class="error" id="e-players" ${errs.players ? '' : 'hidden'}>${icon('error', 'fill')}<span>${esc(errs.players || '')}</span></p>
          </fieldset>
          <div class="field" id="cover-field"></div>
          ${field('rules', 'Regole aggiuntive', `<textarea ${attrs('rules')} maxlength="800" placeholder="Eventuali regole speciali da spiegare agli altri giocatori">${esc(d.rules)}</textarea>`, { opt: ' (facoltative)', count: 800 })}
          <fieldset class="field">
            <legend>L’hai già provata?</legend>
            <div class="chips" role="radiogroup" aria-label="L’hai già provata?">
              ${['Non ancora', 'Una volta', 'Più volte'].map((t) => `<button type="button" class="chip" role="radio" data-tried="${t}" aria-checked="${d.tried === t}" aria-pressed="${d.tried === t}">${t}</button>`).join('')}
            </div>
          </fieldset>
          ${field('nickname', 'Nickname pubblico', `<input type="text" ${attrs('nickname', true)} maxlength="30" value="${esc(d.nickname)}" placeholder="Es. Ruota libera" autocomplete="nickname">`, { req: true, hint: 'Apparirà accanto alla modalità quando sarà pubblicata.' })}
          ${field('email', `Email <span class="private-badge">${icon('lock')}Privata</span>`, `<input type="email" ${attrs('email')} value="${esc(d.email)}" placeholder="nome@esempio.it" autocomplete="email" inputmode="email">`, { opt: ' (facoltativa)', hint: 'Non sarà mai pubblicata. Puoi inviare la proposta anche senza.' })}
          ${notifyCheck(d)}
          <p class="muted" style="font-size:13px;font-weight:600"><span class="req" style="color:var(--red)">*</span> Campo obbligatorio</p>
        </form>
        <div class="sticky-action two">
          <a class="btn ghost" href="#/crea/carte">${icon('arrow_back')}Indietro</a>
          <button class="btn" id="review">Rivedi la proposta</button>
        </div>
      </div>`;
    function drawCover(err) {
      const cur = draft.get();
      const $c = document.getElementById('cover-field');
      $c.innerHTML = `
        <span class="label">Copertina <span class="opt">(facoltativa)</span></span>
        <div class="cover-pick">
          <div class="cover-prev">${cur.cover ? `<img src="${cur.cover}" alt="Anteprima della copertina">`
            : `<div class="cover-auto" aria-label="Copertina automatica"><img src="assets/img/camioncino.png" alt=""></div>`}</div>
          <div class="cover-actions">
            <label class="btn secondary small">${icon('add_photo_alternate')}${cur.cover ? 'Cambia immagine' : 'Carica immagine'}
              <input type="file" id="cover-file" accept="image/jpeg,image/png,image/webp" hidden></label>
            ${cur.cover ? `<button type="button" class="btn ghost small" id="cover-del">${icon('delete')}Rimuovi</button>` : ''}
            <p class="hint"><b>Formato quadrato 1024 × 1024 px</b> · JPG, PNG o WEBP · max ${COVER_MAX_MB} MB. Le immagini non quadrate vengono ritagliate al centro.</p>
            <p class="hint">Se non carichi niente, usiamo una copertina automatica colorata con il camioncino.</p>
          </div>
        </div>
        <p class="error" ${err ? '' : 'hidden'}>${icon('error', 'fill')}<span>${esc(err || '')}</span></p>`;
      document.getElementById('cover-file').addEventListener('change', async (e) => {
        const file = e.target.files[0]; if (!file) return;
        try { draft.update({ cover: await makeCover(file) }); drawCover(); toast('Copertina caricata'); }
        catch (er) { drawCover(er.message); }
      });
      document.getElementById('cover-del')?.addEventListener('click', () => { draft.update({ cover: '' }); drawCover(); });
    }
    return {
      section: 'crea', back: '#/crea/carte', title: 'Crea: dettagli', html,
      mount() {
        drawCover();
        // Giocatori: "da" / "+" / "a"
        const $pf = document.getElementById('p-from'), $pt = document.getElementById('p-to'), $pp = document.getElementById('p-plus');
        const $pe = document.getElementById('e-players'), $pv = document.getElementById('p-preview');
        const syncPlayers = (showErr) => {
          const cur = draft.get();
          const r = playersFrom(cur.pFrom, cur.pTo, cur.pPlus);
          draft.update({ players: r.value });
          $pv.innerHTML = r.value ? `Nell’app apparirà: <b>${esc(playersLabel(r.value))}</b>` : 'Puoi lasciarlo vuoto, oppure usare “+” per indicare “o più” (es. 5+).';
          const err = r.error && (showErr || !$pe.hidden) ? r.error : '';
          $pe.hidden = !err; $pe.querySelector('span:not(.ms)').textContent = err;
          $pe.closest('.field').classList.toggle('invalid', !!err);
          $pf.toggleAttribute('aria-invalid', !!err);
        };
        [$pf, $pt].forEach(($i) => $i.addEventListener('input', (e) => {
          e.stopPropagation();
          $i.value = $i.value.replace(/\D/g, '').slice(0, 2);
          draft.update({ [$i === $pf ? 'pFrom' : 'pTo']: $i.value });
          // Errore subito se il primo numero supera il secondo; gli altri quando si esce dal campo.
          const cur = draft.get();
          syncPlayers(!!(cur.pFrom && cur.pTo && !cur.pPlus && Number(cur.pTo) < Number(cur.pFrom)));
        }));
        [$pf, $pt].forEach(($i) => $i.addEventListener('change', (e) => { e.stopPropagation(); syncPlayers(true); }));
        $pp.addEventListener('click', () => {
          const on = !draft.get().pPlus;
          draft.update({ pPlus: on });
          $pp.setAttribute('aria-pressed', on);
          $pt.disabled = on; if (on) $pt.value = ''; else $pt.value = draft.get().pTo;
          syncPlayers(false);
        });
        syncPlayers(!!errs.players);
        const $f = document.getElementById('form');
        $f.addEventListener('input', (e) => {
          const t = e.target; if (!t.name || t.type === 'checkbox') return;
          draft.update({ [t.name]: t.value });
          const c = $view.querySelector(`[data-count="${t.name}"]`); if (c) c.textContent = t.value.length;
          // Rimuove l'errore appena il campo diventa valido.
          const wrap = t.closest('.field');
          if (wrap?.classList.contains('invalid') && !validateDetails(draft.get())[t.name]) {
            wrap.classList.remove('invalid'); t.removeAttribute('aria-invalid'); document.getElementById('e-' + t.name).hidden = true;
          }
        });
        $f.addEventListener('change', (e) => { if (e.target.name && e.target.type !== 'checkbox') draft.update({ [e.target.name]: e.target.value }); });
        bindNotify($f, draft);
        $view.querySelectorAll('[data-tried]').forEach((b) => b.addEventListener('click', () => {
          const v = draft.get().tried === b.dataset.tried ? '' : b.dataset.tried;
          draft.update({ tried: v });
          $view.querySelectorAll('[data-tried]').forEach((x) => { x.setAttribute('aria-pressed', x.dataset.tried === v); x.setAttribute('aria-checked', x.dataset.tried === v); });
        }));
        document.getElementById('review').onclick = () => {
          const e = validateDetails(draft.get());
          if (Object.keys(e).length) {
            history.replaceState(null, '', '#/crea/dettagli?verifica=1'); route();
            const first = document.querySelector('[aria-invalid="true"]'); first?.focus();
            first?.scrollIntoView({ block: 'center' });
            return;
          }
          go('#/crea/riepilogo');
        };
        $f.addEventListener('submit', (e) => e.preventDefault());
      },
    };
  }

  /* PASSAGGIO 3 — RIEPILOGO E INVIO */
  function viewCreateReview(query) {
    const d = draft.get();
    if (!totalOf(d.cards)) { history.replaceState(null, '', '#/crea/carte'); route(); return null; }
    if (Object.keys(validateDetails(d)).length) { history.replaceState(null, '', '#/crea/dettagli?verifica=1'); route(); return null; }
    const list = Object.entries(d.cards).map(([id, q]) => ({ card: CARD[id], qty: q })).filter((x) => x.card).sort((a, b) => a.card.number - b.card.number);
    const html = `
      <div class="page">
        <h1 class="page-title" style="font-size:26px">Controlla la proposta</h1>
        ${stepper('riepilogo')}
        <section class="review-block">
          <div class="head"><h2>Dettagli</h2><a class="btn ghost small" href="#/crea/dettagli">${icon('edit')}Modifica</a></div>
          <dl>
            <div><dt>Nome</dt><dd style="font:800 20px/1.2 var(--font-head)">${esc(d.name)}</dd></div>
            <div><dt>Copertina</dt><dd>${d.cover ? `<img class="cover-thumb" src="${d.cover}" alt="Copertina">` : 'Automatica, colorata con il camioncino'}</dd></div>
            <div><dt>Descrizione</dt><dd>${esc(d.description)}</dd></div>
            <div><dt>Nickname pubblico</dt><dd>${esc(d.nickname)}</dd></div>
            <div><dt>Giocatori consigliati</dt><dd>${esc(playersLabel(d.players) || 'Non specificato')}</dd></div>
            <div><dt>Regole aggiuntive</dt><dd>${esc(d.rules || 'Nessuna')}</dd></div>
            ${d.tried ? `<div><dt>L’hai già provata?</dt><dd>${esc(d.tried)}</dd></div>` : ''}
            <div><dt>Email ${d.email ? `<span class="private-badge">${icon('lock')}Non pubblicata</span>` : ''}</dt><dd>${esc(d.email || 'Non indicata')}${d.email ? `<br><span class="muted" style="font-size:14px">${d.notify ? 'Notifiche richieste: ti chiederemo di confermare l’indirizzo.' : 'Nessuna notifica richiesta.'}</span>` : ''}</dd></div>
          </dl>
        </section>
        <section class="review-block">
          <div class="head"><h2>Carte Busa</h2><a class="btn ghost small" href="#/crea/carte">${icon('edit')}Modifica</a></div>
          <ul class="card-list">
            ${list.map(({ card, qty }) => `<li><span class="n">#${pad2(card.number)}</span><span class="nm">${esc(card.name)}</span><span class="q">×${qty}</span></li>`).join('')}
            <li class="total"><span class="nm">Totale carte Busa</span><span class="q">${totalOf(d.cards)}</span></li>
          </ul>
          <p class="muted" style="font-size:13px;font-weight:600;margin-top:8px">Più le carte del mazzo di base, incluse automaticamente.</p>
        </section>
        <div class="notice">${icon('lock')}<span>La proposta resta privata finché il team Busa non la controlla. ${d.email ? 'La tua email <b>non sarà mai pubblicata</b> e la useremo solo per la proposta.' : ''}</span></div>
        <label class="check" id="consent-wrap">
          <input type="checkbox" id="consent" ${d.consent ? 'checked' : ''} aria-describedby="consent-err">
          <span>Acconsento alla pubblicazione della proposta con il nickname <b>“${esc(d.nickname)}”</b>, dopo il controllo del team Busa. Ho letto l’<a href="${CONFIG.privacyUrl}">informativa privacy</a>.</span>
        </label>
        <p class="field"><span class="error" id="consent-err" hidden>${icon('error', 'fill')}Per inviare la proposta serve il tuo consenso.</span></p>
        <div id="send-state"></div>
        <div class="sticky-action two">
          <a class="btn ghost" href="#/crea/dettagli">${icon('arrow_back')}Indietro</a>
          <button class="btn" id="send">${icon('send')}Invia la proposta</button>
        </div>
      </div>`;
    async function submit(payload, idem) {
      // Simulazione di errore per la demo: aggiungere ?simula=errore all'URL del riepilogo.
      if (query.simula === 'errore' || !navigator.onLine) { await new Promise((r) => setTimeout(r, 900)); throw new SendError('Connessione assente o instabile: controlla la rete e riprova.', { network: true }); }
      if (!API) { await new Promise((r) => setTimeout(r, 1100)); return { ok: true, notify: 'none' }; }
      return protectedPost('api/proposals', payload, 'proposal', { idem });
    }
    return {
      section: 'crea', back: '#/crea/dettagli', title: 'Crea: riepilogo', html,
      mount() {
        loadTurnstile().catch(() => {});
        const $c = document.getElementById('consent'), $send = document.getElementById('send'), $state = document.getElementById('send-state');
        $c.addEventListener('change', () => {
          draft.update({ consent: $c.checked });
          if ($c.checked) { document.getElementById('consent-wrap').classList.remove('invalid'); document.getElementById('consent-err').hidden = true; }
        });
        $send.onclick = async () => {
          if (!$c.checked) {
            document.getElementById('consent-wrap').classList.add('invalid'); document.getElementById('consent-err').hidden = false; $c.focus(); return;
          }
          // La stessa chiave per tutti i tentativi di questa proposta: un doppio clic o un nuovo tentativo non crea doppioni.
          let cur = draft.get();
          if (!cur.idem) cur = draft.update({ idem: newKey() });
          $send.disabled = true; $send.innerHTML = icon('progress_activity', 'spin') + 'Invio in corso…'; $state.innerHTML = '';
          try {
            const email = cur.email.trim();
            const out = await submit({
              title: cur.name.trim(), description: cur.description.trim(), players: cur.players, rules: cur.rules.trim(), tried: cur.tried,
              nickname: cur.nickname.trim(), email: email || null, notify: !!(email && cur.notify), cards: cur.cards, startedFrom: cur.start, consent: true,
              cover: cur.cover ? { type: 'image/jpeg', data: cur.cover.split(',')[1] } : null,
            }, cur.idem);
            draft.clear(); store.set('lastSent', { name: cur.name.trim(), notify: out.notify || 'none', notifyMessage: out.notifyMessage || '', receipt: out.receipt || '' });
            go('#/crea/inviata');
          } catch (e) {
            $send.disabled = false; $send.innerHTML = icon('refresh') + 'Riprova';
            $state.innerHTML = sendFailBox(e);
            document.getElementById('retry').onclick = () => {
              if (query.simula === 'errore') { history.replaceState(null, '', '#/crea/riepilogo'); query.simula = ''; }
              $send.click();
            };
            $state.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        };
      },
    };
  }

  function viewCreateDone() {
    const last = store.get('lastSent', null);
    const html = `
      <div class="page confirm">
        <div class="burst"><img src="assets/img/camioncino.png" alt=""></div>
        <h1>Proposta inviata!</h1>
        <p>Il team Busa la controllerà prima di pubblicarla.</p>
        ${last ? `<p class="muted" style="font-size:15px">“${esc(last.name)}” è in viaggio verso il nostro magazzino.</p>` : ''}
        <ol class="steps">
          <li>${icon('check_circle', 'fill')}Proposta inviata</li>
          <li>${icon('fact_check')}Controllo del team Busa</li>
          <li>${icon('public')}Pubblicazione in Scopri con il tuo nickname</li>
        </ol>
        ${notifyNote(last)}
        <div style="display:grid;gap:12px">
          <a class="btn block" href="#/scopri">${icon('style')}Scopri altre modalità</a>
          <a class="btn block secondary" href="#/crea/carte">${icon('add')}Crea un’altra modalità</a>
        </div>
      </div>`;
    return { section: 'crea', title: 'Proposta inviata', html, mount: () => bindResend(last) };
  }
  // Stato delle notifiche email dopo l'invio, con la possibilità di richiedere di nuovo la conferma.
  function notifyNote(last) {
    if (!last || !last.notifyMessage) return '';
    const canResend = last.receipt && ['verification-sent', 'limit', 'failed'].includes(last.notify);
    return `<div class="notice" style="margin-bottom:16px;text-align:left">${icon(last.notify === 'verification-sent' ? 'mark_email_unread' : 'info')}<span>${esc(last.notifyMessage)}
      ${canResend ? `<br><button class="btn ghost small" id="resend" style="margin-top:8px">${icon('send')}Invia di nuovo l’email di conferma</button>` : ''}</span></div>`;
  }
  function bindResend(last) {
    const b = document.getElementById('resend'); if (!b) return;
    b.onclick = async () => {
      b.disabled = true;
      try { const out = await apiPost('api/email/resend', { receipt: last.receipt }); toast(out.message); }
      catch (e) { toast(e.message); b.disabled = false; }
    };
  }

  /* ---------------- Carte Busa create dai giocatori ---------------- */
  const CM = {
    template: '', layout: null, ...(CONFIG.cardMaker || {}),
    limits: { title: 22, dialect: 70, translation: 80, text: 200, ...((CONFIG.cardMaker || {}).limits || {}) },
  };
  const cardCfg = (extra = {}) => ({ template: CM.template, ratio: CONFIG.cardRatio, layout: CM.layout, ...extra });
  const thumbs = new Map();
  function ucardThumb(c, width = 420) {
    const k = `${c.id}|${c.updatedAt || ''}|${width}`;
    if (!thumbs.has(k)) thumbs.set(k, window.MovatCardRender.toDataURL(c, cardCfg({ width }), 'image/jpeg', 0.88));
    return thumbs.get(k);
  }
  // Riempie le <img data-ucard> con il disegno della carta (generato nel browser).
  function fillUcardImages(root = $view) {
    root.querySelectorAll('img[data-ucard]:not([src])').forEach(async (img) => {
      const c = UCARD[img.dataset.ucard]; if (!c) return;
      try { img.src = await ucardThumb(c, Number(img.dataset.w) || 420); } catch { /* resta il fondo segnaposto */ }
    });
  }
  const ucardImg = (c, w = 420, cls = '') => `<img class="ucard-img ${cls}" data-ucard="${esc(c.id)}" data-w="${w}" alt="Carta “${esc(c.title)}”">`;
  function downloadBlob(blob, name) {
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  }
  const scopriTabs = (cur) => `<nav class="seg scopri-tabs" aria-label="Cosa scoprire">
      <a href="#/scopri" aria-current="${cur === 'modalita' ? 'page' : 'false'}">${icon('stadia_controller')}Modalità</a>
      <a href="#/scopri/carte" aria-current="${cur === 'carte' ? 'page' : 'false'}">${icon('style')}Carte dei giocatori</a></nav>`;

  /* SCOPRI: carte dei giocatori */
  function viewUserCards(query) {
    const state = { q: query.q || '' };
    let vista = getView('scopriCarte');
    const html = `
      <div class="page">
        ${scopriTabs('carte')}
        <h1 style="font-size:28px;margin-top:14px">Carte dei giocatori</h1>
        <p class="muted" style="margin-top:6px;font-weight:600">Carte Busa inventate da chi gioca, pubblicate dopo il controllo del team Busa.</p>
        <a class="btn block secondary" href="#/crea/carta" style="margin-top:14px">${icon('add_circle')}Crea la tua carta</a>
        <div class="search-row">
          <div class="search" role="search">
            ${icon('search')}
            <label class="sr-only" for="q">Cerca per titolo, autore o testo</label>
            <input id="q" type="search" placeholder="Cerca carta" value="${esc(state.q)}" autocomplete="off">
            <button class="icon-btn clear" type="button" aria-label="Cancella ricerca" ${state.q ? '' : 'hidden'}>${icon('close')}</button>
          </div>
          ${viewSwitch('scopriCarte', vista)}
        </div>
        <div id="results"></div>
      </div>`;
    function draw() {
      const n = norm(state.q);
      const list = USER_CARDS.filter((c) => !n || norm(`${c.title} ${c.author} ${c.dialect} ${c.translation} ${c.text}`).includes(n))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const $r = document.getElementById('results');
      if (!list.length) {
        $r.innerHTML = `<div class="empty">${icon(state.q ? 'search_off' : 'style')}<h3>${state.q ? 'Nessuna carta trovata' : 'Ancora nessuna carta pubblicata'}</h3>
          <p class="muted">${state.q ? 'Prova con altre parole.' : 'Inventane una tu: la pubblichiamo dopo il controllo del team Busa.'}</p>
          <a class="btn small" href="#/crea/carta" style="margin-top:12px">${icon('add')}Crea la tua carta</a></div>`;
        return;
      }
      const count = `<p class="muted" style="font-weight:700;font-size:14px;margin-bottom:10px">${list.length} ${list.length === 1 ? 'carta' : 'carte'}</p>`;
      if (vista === 'griglia') {
        $r.innerHTML = count + `<div class="sq-grid">${list.map((c) => `
          <a class="sq-tile" href="#/scopri/carte/${esc(c.id)}" aria-label="${esc(c.title)}">
            <span class="sq-art">${ucardImg(c, 360, 'sq')}</span><span class="sq-name">${esc(c.title)}</span></a>`).join('')}</div>`;
      } else {
        $r.innerHTML = count + `<div class="card-grid ${vista === 'uno' ? 'cols-1' : ''}">${list.map((c) => `
          <a class="talk-card ucard-tile" href="#/scopri/carte/${esc(c.id)}">
            <span class="open">${ucardImg(c, vista === 'uno' ? 720 : 420)}</span>
            <span class="meta"><span class="t"><span class="name">${highlight(c.title, state.q)}</span>
              <span class="by">di <b>${esc(c.author)}</b></span>${ratingText(c, false, 'carta:' + c.id)}</span></span>
          </a>`).join('')}</div>`;
      }
      fillUcardImages();
    }
    return {
      section: 'scopri', title: 'Carte dei giocatori', html,
      mount() {
        draw();
        bindViewSwitch('scopriCarte', (v) => { vista = v; draw(); });
        const $q = document.getElementById('q'), $clear = $view.querySelector('.clear');
        $q.addEventListener('input', () => { state.q = $q.value; $clear.hidden = !state.q; setQuery(state); draw(); });
        $clear.addEventListener('click', () => { $q.value = ''; $q.dispatchEvent(new Event('input')); $q.focus(); });
      },
    };
  }

  function viewUserCard(id) {
    const c = UCARD[id];
    if (!c) return viewNotFound();
    const canShareFiles = !!(navigator.canShare && window.File && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] }));
    const html = `
      <div class="page">
        <div class="ucard-detail"><canvas id="uc-canvas" role="img" aria-label="Carta “${esc(c.title)}”"></canvas></div>
        <header class="mode-head" style="margin-top:14px">
          <h1>${esc(c.title)}</h1>
          <p class="by" style="margin-top:4px">di <b>${esc(c.author)}</b></p>
          <div class="facts"><span id="rating-inline">${ratingText(c, true, 'carta:' + c.id)}</span></div>
        </header>
        <div class="bubble">
          <div class="lbl">${icon('record_voice_over')}Frase in dialetto</div>
          <p class="dialect">«${esc(c.dialect)}»</p>
          ${c.translation ? `<div class="transl"><div class="lbl">${icon('translate')}Traduzione italiana</div><p>“${esc(c.translation)}”</p></div>` : ''}
        </div>
        ${c.text ? `<section class="card-text"><h2>${icon('style')}Testo della carta</h2>${String(c.text).split(/\n+/).map((t) => `<p>${esc(t)}</p>`).join('')}</section>` : ''}
        <section class="share-box" aria-labelledby="share-title">
          <h2 id="share-title">${icon('share')}Condividi la carta</h2>
          <div class="share-actions">
            ${canShareFiles ? `<button class="btn secondary small" id="share-img">${icon('ios_share')}Condividi immagine</button>` : ''}
            <button class="btn secondary small" data-dl="image/png">${icon('image')}Scarica PNG</button>
            <button class="btn secondary small" data-dl="image/jpeg">${icon('photo')}Scarica JPG</button>
            <button class="btn secondary small" id="copy-link">${icon('link')}Copia link</button>
          </div>
          <p class="hint">L’immagine è in alta risoluzione (1080 px di larghezza), pronta per chat e social.</p>
        </section>
        <section class="vote-box" id="vote" aria-labelledby="vote-title"></section>
      </div>`;
    return {
      section: 'scopri', back: '#/scopri/carte', title: c.title, html,
      mount() {
        window.MovatCardRender.render(document.getElementById('uc-canvas'), c, cardCfg({ width: 720 }));
        voteBox(c, { key: 'carta:' + c.id, body: { cardId: c.id }, inline: 'rating-inline', what: 'carta' });
        const name = (ext) => `movat-carta-${c.id}.${ext}`;
        $view.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', async () => {
          const type = b.dataset.dl;
          const blob = await window.MovatCardRender.toBlob(c, cardCfg({ width: 1080 }), type, 0.92);
          downloadBlob(blob, name(type === 'image/png' ? 'png' : 'jpg')); toast('Immagine scaricata');
        }));
        document.getElementById('share-img')?.addEventListener('click', async () => {
          const blob = await window.MovatCardRender.toBlob(c, cardCfg({ width: 1080 }), 'image/png');
          const file = new File([blob], name('png'), { type: 'image/png' });
          navigator.share({ files: [file], title: `MÖVAT! — ${c.title}`, text: `La carta “${c.title}” di ${c.author}` }).catch(() => {});
        });
        document.getElementById('copy-link').onclick = async () => {
          const u = location.href.split('#')[0] + '#/scopri/carte/' + c.id;
          toast((await copyText(u)) ? 'Link copiato!' : 'Non è stato possibile copiare il link');
        };
      },
    };
  }

  /* CREA: scelta del percorso */
  const flowSwitch = (cur) => `<nav class="seg scopri-tabs flow-switch" aria-label="Cosa vuoi creare">
      <a href="#/crea/carte" aria-current="${cur === 'modalita' ? 'page' : 'false'}">${icon('stadia_controller')}Una modalità</a>
      <a href="#/crea/carta" aria-current="${cur === 'carta' ? 'page' : 'false'}">${icon('style')}Una carta Busa</a></nav>`;
  function viewCreateChooser() {
    return {
      section: 'crea', title: 'Crea', html: `
      <div class="page">
        <h1 class="page-title" style="font-size:28px">Cosa vuoi creare?</h1>
        <p class="page-sub">Scegli un percorso: la tua proposta arriva al team Busa, che la controlla prima di pubblicarla.</p>
        <div class="chooser">
          <a class="choice" href="#/crea/carte">
            <span class="ch-ic">${icon('stadia_controller')}</span>
            <span><b>Crea una modalità</b><span>Scegli le carte Busa e le regole per un nuovo modo di giocare.</span></span>${icon('chevron_right')}</a>
          <a class="choice" href="#/crea/carta">
            <span class="ch-ic">${icon('style')}</span>
            <span><b>Crea una carta Busa</b><span>Inventa titolo, frase del camioncino e testo, e guardala prendere forma.</span></span>${icon('chevron_right')}</a>
        </div>
      </div>` };
  }

  /* CREA: carta Busa */
  const EMPTY_CARD = { title: '', dialect: '', translation: '', text: '', nickname: '', email: '', notify: false, note: '', consent: false, idem: '' };
  const cardDraft = {
    get() { return { ...EMPTY_CARD, ...store.get('draftCard', {}) }; },
    update(p) { const d = { ...this.get(), ...p }; store.set('draftCard', d); return d; },
    clear() { store.del('draftCard'); },
  };
  function validateCard(d) {
    const e = {};
    if (!d.title.trim()) e.title = 'Dai un titolo alla tua carta.';
    if (!d.dialect.trim()) e.dialect = 'Scrivi la frase che dice il camioncino.';
    if (!d.text.trim()) e.text = 'Scrivi il testo della carta: cosa succede quando la giochi.';
    for (const k of ['title', 'dialect', 'translation', 'text']) if (d[k].length > CM.limits[k]) e[k] = `Massimo ${CM.limits[k]} caratteri.`;
    return e;
  }
  function validateCardDetails(d) {
    const e = {};
    if (!d.nickname.trim()) e.nickname = 'Scegli il nickname che apparirà accanto alla carta.';
    if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim())) e.email = 'Questo indirizzo email non sembra corretto.';
    return e;
  }
  function cardStepper(step) {
    const steps = [['carta', 'Carta'], ['carta-dettagli', 'Dettagli'], ['carta-riepilogo', 'Invia']];
    const idx = steps.findIndex(([k]) => k === step);
    return `<nav class="stepper" aria-label="Avanzamento">
      <div class="bar" style="width:calc((100% - 48px) * ${idx / 2})"></div>
      ${steps.map(([k, l], i) => {
        const cls = i < idx ? 'done' : i === idx ? 'current' : '';
        const inner = `<span class="dot">${i < idx ? icon('check') : i + 1}</span>${l}`;
        return i < idx ? `<a class="step ${cls}" href="#/crea/${k}" style="text-decoration:none">${inner}</a>` : `<span class="step ${cls}" ${i === idx ? 'aria-current="step"' : ''}>${inner}</span>`;
      }).join('')}
    </nav>`;
  }
  const cfield = (d, errs, key, label, input, { req, opt, hint, count } = {}) => `
      <div class="field ${errs[key] ? 'invalid' : ''}" data-field="${key}">
        <label for="f-${key}">${label} ${req ? '<span class="req" aria-hidden="true">*</span>' : ''}${opt ? `<span class="opt">${opt}</span>` : ''}</label>
        ${input}
        ${count ? `<div class="count"><span data-count="${key}">${d[key].length}</span>/${count}</div>` : ''}
        ${hint ? `<p class="hint">${hint}</p>` : ''}
        <p class="error" id="e-${key}" ${errs[key] ? '' : 'hidden'}>${icon('error', 'fill')}<span>${esc(errs[key] || '')}</span></p>
      </div>`;

  function viewCreateCard(query) {
    const d = cardDraft.get();
    const errs = query.verifica === '1' ? validateCard(d) : {};
    const L = CM.limits;
    const html = `
      <div class="page">
        ${flowSwitch('carta')}
        <h1 class="page-title" style="font-size:26px;margin-top:14px">Crea la tua carta</h1>
        ${cardStepper('carta')}
        <div class="card-maker">
          <div class="cm-preview" aria-hidden="true"><canvas id="cm-canvas"></canvas><span class="cm-badge">${icon('visibility')}Anteprima dal vivo</span></div>
          <form class="form" id="form" novalidate>
            ${Object.keys(errs).length ? `<div class="form-error-summary" role="alert">${icon('error', 'fill')}<span>Completa i campi evidenziati.</span></div>` : ''}
            ${cfield(d, errs, 'title', 'Titolo della carta', `<input id="f-title" name="title" type="text" maxlength="${L.title}" value="${esc(d.title)}" placeholder="Es. Fermo lì!" autocomplete="off">`, { req: true, count: L.title })}
            ${cfield(d, errs, 'dialect', 'Frase del camioncino, in dialetto', `<textarea id="f-dialect" name="dialect" maxlength="${L.dialect}" rows="2" placeholder="Cosa dice il camioncino nel fumetto?">${esc(d.dialect)}</textarea>`, { req: true, count: L.dialect })}
            ${cfield(d, errs, 'translation', 'Traduzione in italiano', `<textarea id="f-translation" name="translation" maxlength="${L.translation}" rows="2" placeholder="Compare nel fumetto, sotto la frase">${esc(d.translation)}</textarea>`, { opt: ' (facoltativa)', count: L.translation })}
            ${cfield(d, errs, 'text', 'Testo della carta', `<textarea id="f-text" name="text" maxlength="${L.text}" rows="4" placeholder="Cosa succede quando qualcuno gioca questa carta?">${esc(d.text)}</textarea>`, { req: true, count: L.text })}
          </form>
        </div>
        <div class="sticky-action"><div class="tot" style="font-weight:700">La carta si aggiorna mentre scrivi</div>
          <button class="btn" id="next">Continua${icon('arrow_forward')}</button></div>
      </div>`;
    return {
      section: 'crea', title: 'Crea una carta', html,
      mount() {
        const canvas = document.getElementById('cm-canvas');
        let pending = false;
        const draw = () => { if (pending) return; pending = true; requestAnimationFrame(async () => { pending = false; await window.MovatCardRender.render(canvas, cardDraft.get(), cardCfg({ width: 600, placeholders: true })); }); };
        draw();
        const $f = document.getElementById('form');
        $f.addEventListener('input', (e) => {
          const t = e.target; if (!t.name) return;
          cardDraft.update({ [t.name]: t.value });
          const c = $view.querySelector(`[data-count="${t.name}"]`); if (c) c.textContent = t.value.length;
          const wrap = t.closest('.field');
          if (wrap?.classList.contains('invalid') && !validateCard(cardDraft.get())[t.name]) { wrap.classList.remove('invalid'); document.getElementById('e-' + t.name).hidden = true; }
          draw();
        });
        $f.addEventListener('submit', (e) => e.preventDefault());
        document.getElementById('next').onclick = () => {
          if (Object.keys(validateCard(cardDraft.get())).length) {
            history.replaceState(null, '', '#/crea/carta?verifica=1'); route();
            const first = $view.querySelector('.field.invalid input, .field.invalid textarea'); first?.focus(); first?.scrollIntoView({ block: 'center' });
            return;
          }
          go('#/crea/carta-dettagli');
        };
      },
    };
  }

  function viewCreateCardDetails(query) {
    const d = cardDraft.get();
    if (Object.keys(validateCard(d)).length) { history.replaceState(null, '', '#/crea/carta?verifica=1'); route(); return null; }
    const errs = query.verifica === '1' ? validateCardDetails(d) : {};
    const html = `
      <div class="page">
        <h1 class="page-title" style="font-size:26px">Chi l’ha inventata?</h1>
        ${cardStepper('carta-dettagli')}
        <form class="form" id="form" novalidate>
          ${cfield(d, errs, 'nickname', 'Nickname pubblico', `<input id="f-nickname" name="nickname" type="text" maxlength="30" value="${esc(d.nickname)}" placeholder="Es. Ruota libera" autocomplete="nickname">`, { req: true, hint: 'Apparirà accanto alla carta quando sarà pubblicata.' })}
          ${cfield(d, errs, 'email', `Email <span class="private-badge">${icon('lock')}Privata</span>`, `<input id="f-email" name="email" type="email" value="${esc(d.email)}" placeholder="nome@esempio.it" autocomplete="email" inputmode="email">`, { opt: ' (facoltativa)', hint: 'Non sarà mai pubblicata. Puoi inviare la carta anche senza.' })}
          ${notifyCheck(d)}
          ${cfield(d, errs, 'note', 'Note per il team Busa', `<textarea id="f-note" name="note" maxlength="600" rows="3" placeholder="Come ti è venuta l’idea? Come si gioca?">${esc(d.note)}</textarea>`, { opt: ' (facoltative, non pubblicate)', count: 600 })}
        </form>
        <div class="sticky-action two">
          <a class="btn ghost" href="#/crea/carta">${icon('arrow_back')}Indietro</a>
          <button class="btn" id="review">Rivedi la proposta</button>
        </div>
      </div>`;
    return {
      section: 'crea', back: '#/crea/carta', title: 'Crea una carta: dettagli', html,
      mount() {
        const $f = document.getElementById('form');
        $f.addEventListener('input', (e) => {
          const t = e.target; if (!t.name || t.type === 'checkbox') return;
          cardDraft.update({ [t.name]: t.value });
          const c = $view.querySelector(`[data-count="${t.name}"]`); if (c) c.textContent = t.value.length;
        });
        bindNotify($f, cardDraft);
        $f.addEventListener('submit', (e) => e.preventDefault());
        document.getElementById('review').onclick = () => {
          if (Object.keys(validateCardDetails(cardDraft.get())).length) {
            history.replaceState(null, '', '#/crea/carta-dettagli?verifica=1'); route();
            $view.querySelector('.field.invalid input')?.focus(); return;
          }
          go('#/crea/carta-riepilogo');
        };
      },
    };
  }

  function viewCreateCardReview(query) {
    const d = cardDraft.get();
    if (Object.keys(validateCard(d)).length) { history.replaceState(null, '', '#/crea/carta?verifica=1'); route(); return null; }
    if (Object.keys(validateCardDetails(d)).length) { history.replaceState(null, '', '#/crea/carta-dettagli?verifica=1'); route(); return null; }
    const html = `
      <div class="page">
        <h1 class="page-title" style="font-size:26px">Controlla la proposta</h1>
        ${cardStepper('carta-riepilogo')}
        <div class="ucard-detail small"><canvas id="rv-canvas"></canvas></div>
        <section class="review-block">
          <div class="head"><h2>La carta</h2><a class="btn ghost small" href="#/crea/carta">${icon('edit')}Modifica</a></div>
          <dl>
            <div><dt>Titolo</dt><dd style="font:800 20px/1.2 var(--font-head)">${esc(d.title)}</dd></div>
            <div><dt>Frase in dialetto</dt><dd>${esc(d.dialect)}</dd></div>
            <div><dt>Traduzione</dt><dd>${esc(d.translation || '—')}</dd></div>
            <div><dt>Testo della carta</dt><dd>${esc(d.text)}</dd></div>
          </dl>
        </section>
        <section class="review-block">
          <div class="head"><h2>Dettagli</h2><a class="btn ghost small" href="#/crea/carta-dettagli">${icon('edit')}Modifica</a></div>
          <dl>
            <div><dt>Nickname pubblico</dt><dd>${esc(d.nickname)}</dd></div>
            <div><dt>Email ${d.email ? `<span class="private-badge">${icon('lock')}Non pubblicata</span>` : ''}</dt><dd>${esc(d.email || 'Non indicata')}${d.email ? `<br><span class="muted" style="font-size:14px">${d.notify ? 'Notifiche richieste: ti chiederemo di confermare l’indirizzo.' : 'Nessuna notifica richiesta.'}</span>` : ''}</dd></div>
            ${d.note ? `<div><dt>Note per il team Busa</dt><dd>${esc(d.note)}</dd></div>` : ''}
          </dl>
        </section>
        <label class="check" id="consent-wrap">
          <input type="checkbox" id="consent" ${d.consent ? 'checked' : ''}>
          <span>Acconsento alla pubblicazione della carta con il nickname <b>“${esc(d.nickname)}”</b>, dopo il controllo del team Busa. Ho letto l’<a href="${CONFIG.privacyUrl}">informativa privacy</a>.</span>
        </label>
        <p class="field"><span class="error" id="consent-err" hidden>${icon('error', 'fill')}Per inviare la proposta serve il tuo consenso.</span></p>
        <div id="send-state"></div>
        <div class="sticky-action two">
          <a class="btn ghost" href="#/crea/carta-dettagli">${icon('arrow_back')}Indietro</a>
          <button class="btn" id="send">${icon('send')}Invia la proposta</button>
        </div>
      </div>`;
    async function submit(payload, idem) {
      if (query.simula === 'errore' || !navigator.onLine) { await new Promise((r) => setTimeout(r, 900)); throw new SendError('Connessione assente o instabile: controlla la rete e riprova.', { network: true }); }
      if (!API) { await new Promise((r) => setTimeout(r, 1000)); return { ok: true, notify: 'none' }; }
      return protectedPost('api/card-proposals', payload, 'card_proposal', { idem });
    }
    return {
      section: 'crea', back: '#/crea/carta-dettagli', title: 'Crea una carta: riepilogo', html,
      mount() {
        window.MovatCardRender.render(document.getElementById('rv-canvas'), d, cardCfg({ width: 600 }));
        loadTurnstile().catch(() => {});
        const $c = document.getElementById('consent'), $send = document.getElementById('send'), $state = document.getElementById('send-state');
        $c.addEventListener('change', () => { cardDraft.update({ consent: $c.checked }); if ($c.checked) { document.getElementById('consent-wrap').classList.remove('invalid'); document.getElementById('consent-err').hidden = true; } });
        $send.onclick = async () => {
          if (!$c.checked) { document.getElementById('consent-wrap').classList.add('invalid'); document.getElementById('consent-err').hidden = false; $c.focus(); return; }
          let cur = cardDraft.get();
          if (!cur.idem) cur = cardDraft.update({ idem: newKey() });
          $send.disabled = true; $send.innerHTML = icon('progress_activity', 'spin') + 'Invio in corso…'; $state.innerHTML = '';
          try {
            const email = cur.email.trim();
            const out = await submit({ title: cur.title.trim(), dialect: cur.dialect.trim(), translation: cur.translation.trim(), text: cur.text.trim(),
              nickname: cur.nickname.trim(), email: email || null, notify: !!(email && cur.notify), note: cur.note.trim(), consent: true }, cur.idem);
            store.set('lastSentCard', { title: cur.title.trim(), notify: out.notify || 'none', notifyMessage: out.notifyMessage || '', receipt: out.receipt || '', data: { title: cur.title, dialect: cur.dialect, translation: cur.translation, text: cur.text } });
            cardDraft.clear(); go('#/crea/carta-inviata');
          } catch (e) {
            $send.disabled = false; $send.innerHTML = icon('refresh') + 'Riprova';
            $state.innerHTML = sendFailBox(e);
            document.getElementById('retry').onclick = () => { if (query.simula === 'errore') { history.replaceState(null, '', '#/crea/carta-riepilogo'); query.simula = ''; } $send.click(); };
          }
        };
      },
    };
  }

  function viewCreateCardDone() {
    const last = store.get('lastSentCard', null);
    return {
      section: 'crea', title: 'Proposta ricevuta', html: `
      <div class="page confirm">
        ${last?.data ? `<div class="ucard-detail small"><canvas id="done-canvas"></canvas></div>` : `<div class="burst"><img src="assets/img/camioncino.png" alt=""></div>`}
        <h1>Proposta inviata!</h1>
        <p>Il team Busa controllerà la tua carta prima di pubblicarla.</p>
        <ol class="steps">
          <li>${icon('check_circle', 'fill')}Carta inviata</li>
          <li>${icon('fact_check')}Controllo del team Busa</li>
          <li>${icon('public')}Pubblicazione in Scopri con il tuo nickname</li>
        </ol>
        ${notifyNote(last)}
        <div style="display:grid;gap:12px">
          <a class="btn block" href="#/scopri/carte">${icon('style')}Guarda le carte dei giocatori</a>
          <a class="btn block secondary" href="#/crea/carta">${icon('add')}Crea un’altra carta</a>
        </div>
      </div>`,
      mount() { if (last?.data) window.MovatCardRender.render(document.getElementById('done-canvas'), last.data, cardCfg({ width: 600 })); bindResend(last); },
    };
  }

  /* ---------------- Contatti ---------------- */
  // Bozza salvata sul dispositivo: se l'invio non riesce i dati restano.
  const EMPTY_CONTACT = { topic: 'domanda', message: '', wantsReply: false, email: '', idem: '' };
  const contactDraft = {
    get() { return { ...EMPTY_CONTACT, ...store.get('draftContact', {}) }; },
    update(p) { const d = { ...this.get(), ...p }; store.set('draftContact', d); return d; },
    clear() { store.del('draftContact'); },
  };
  const TOPICS = [['domanda', 'Domanda sul gioco'], ['segnalazione', 'Segnalazione'], ['altro', 'Altro']];
  function validateContact(d) {
    const e = {};
    if (d.message.trim().length < 10) e.message = d.message.trim() ? 'Scrivi qualche parola in più (almeno 10 caratteri).' : 'Scrivi il tuo messaggio.';
    if (d.wantsReply && !d.email.trim()) e.email = 'Per risponderti ci serve un indirizzo email.';
    else if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim())) e.email = 'Questo indirizzo email non sembra corretto.';
    return e;
  }
  function viewContact() {
    const c = { email: 'a.ruggeri@busatrasportisrl.it', subject: 'Ho una domanda riguardo a Movat', ...(CONFIG.contact || {}) };
    const d = contactDraft.get();
    const html = `
      <div class="page">
        <h1 class="page-title">Scrivici</h1>
        <p class="page-sub">Dubbi sul gioco o qualcosa che non va? Il messaggio arriva solo al team Busa.</p>
        <div id="contact-body">
        <form class="form" id="form" novalidate style="margin-top:12px">
          <fieldset class="field">
            <legend>Argomento</legend>
            <div class="chips" role="radiogroup" aria-label="Argomento">
              ${TOPICS.map(([k, l]) => `<button type="button" class="chip" role="radio" data-topic="${k}" aria-checked="${d.topic === k}" aria-pressed="${d.topic === k}">${l}</button>`).join('')}
            </div>
          </fieldset>
          <div class="field" data-field="message">
            <label for="f-message">Messaggio <span class="req" aria-hidden="true">*</span></label>
            <textarea id="f-message" name="message" maxlength="2000" rows="6" aria-required="true" aria-describedby="e-message" placeholder="Scrivi qui la tua domanda o la segnalazione">${esc(d.message)}</textarea>
            <div class="count"><span data-count="message">${d.message.length}</span>/2000</div>
            <p class="error" id="e-message" hidden>${icon('error', 'fill')}<span></span></p>
          </div>
          <label class="check"><input type="checkbox" id="f-reply" ${d.wantsReply ? 'checked' : ''}><span>Voglio una risposta</span></label>
          <div class="field" data-field="email" id="email-field" ${d.wantsReply || d.email ? '' : 'hidden'}>
            <label for="f-email">Email <span class="private-badge">${icon('lock')}Privata</span> <span class="opt" id="email-opt">${d.wantsReply ? '' : ' (facoltativa)'}</span></label>
            <input id="f-email" name="email" type="email" value="${esc(d.email)}" placeholder="nome@esempio.it" autocomplete="email" inputmode="email" aria-describedby="e-email">
            <p class="hint">La usiamo solo per risponderti. Non riceverai altre email.</p>
            <p class="error" id="e-email" hidden>${icon('error', 'fill')}<span></span></p>
          </div>
          <p class="muted" style="font-size:13px;font-weight:600">Inviando accetti l’<a href="#/privacy">informativa privacy</a>. Per evitare lo spam usiamo una verifica antibot automatica.</p>
        </form>
        <div id="send-state"></div>
        <div class="sticky-action"><button class="btn block" id="send">${icon('send')}Invia il messaggio</button></div>
        <p class="muted" style="font-size:13px;font-weight:600;margin-top:14px;text-align:center">Preferisci la tua app di posta? Scrivi a <a href="mailto:${esc(encodeURIComponent(c.email).replace(/%40/g, '@'))}?subject=${esc(encodeURIComponent(c.subject))}">${esc(c.email)}</a></p>
        </div>
      </div>`;
    return {
      section: 'faq', back: '#/faq', title: 'Contatti', html,
      mount() {
        if (API) loadTurnstile().catch(() => {});
        const $f = document.getElementById('form'), $send = document.getElementById('send'), $state = document.getElementById('send-state');
        const $reply = document.getElementById('f-reply'), $ef = document.getElementById('email-field');
        const showErr = (k, msg) => {
          const el = document.getElementById('e-' + k); if (!el) return;
          el.hidden = !msg; el.querySelector('span:not(.ms)').textContent = msg || '';
          el.closest('.field').classList.toggle('invalid', !!msg);
          const inp = el.closest('.field').querySelector('input,textarea'); if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid');
        };
        $f.addEventListener('input', (e) => {
          const t = e.target; if (!t.name) return;
          contactDraft.update({ [t.name]: t.value });
          const n = $view.querySelector(`[data-count="${t.name}"]`); if (n) n.textContent = t.value.length;
          if (!validateContact(contactDraft.get())[t.name]) showErr(t.name, '');
        });
        $f.addEventListener('submit', (e) => e.preventDefault());
        $view.querySelectorAll('[data-topic]').forEach((b) => b.addEventListener('click', () => {
          contactDraft.update({ topic: b.dataset.topic });
          $view.querySelectorAll('[data-topic]').forEach((x) => { x.setAttribute('aria-pressed', x === b); x.setAttribute('aria-checked', x === b); });
        }));
        $reply.addEventListener('change', () => {
          contactDraft.update({ wantsReply: $reply.checked });
          $ef.hidden = !$reply.checked && !contactDraft.get().email;
          document.getElementById('email-opt').textContent = $reply.checked ? '' : ' (facoltativa)';
          if (!$reply.checked) showErr('email', '');
        });
        $send.onclick = async () => {
          const cur0 = contactDraft.get();
          const errs = validateContact(cur0);
          showErr('message', errs.message); showErr('email', errs.email);
          if (Object.keys(errs).length) { $view.querySelector('[aria-invalid="true"]')?.focus(); return; }
          const cur = cur0.idem ? cur0 : contactDraft.update({ idem: newKey() });
          $send.disabled = true; $send.innerHTML = icon('progress_activity', 'spin') + 'Invio in corso…'; $state.innerHTML = '';
          try {
            let out = { message: 'Grazie! Il team Busa lo leggerà presto.' };
            if (API) out = await protectedPost('api/contact', { topic: cur.topic, message: cur.message.trim(), wantsReply: cur.wantsReply, email: cur.email.trim() || null }, 'contact', { idem: cur.idem });
            else await new Promise((r) => setTimeout(r, 800));
            contactDraft.clear();
            document.getElementById('contact-body').innerHTML = `<div class="confirm" style="padding-top:12px">
              <div class="burst"><img src="assets/img/camioncino.png" alt=""></div>
              <h1>Messaggio inviato!</h1><p>${esc(out.message)}</p>
              <div style="display:grid;gap:12px;margin-top:16px"><a class="btn block" href="#/faq">${icon('help')}Torna alle FAQ</a></div></div>`;
          } catch (e) {
            $send.disabled = false; $send.innerHTML = icon('refresh') + 'Riprova';
            if (e.details) Object.entries(e.details).forEach(([k, v]) => showErr(k, v));
            $state.innerHTML = sendFailBox(e);
            document.getElementById('retry').onclick = () => $send.click();
            $state.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        };
      },
    };
  }

  /* ---------------- FAQ ---------------- */
  function viewFaq(query) {
    const state = { q: query.q || '', cat: query.cat || '', open: query.open || '' };
    const html = `
      <div class="page">
        <h1 class="page-title">Dubbi e risposte</h1>
        <p class="page-sub">Trova la risposta senza fermare la partita.</p>
        <div class="search" role="search">
          ${icon('search')}
          <label class="sr-only" for="q">Cerca per parola chiave o nome della carta</label>
          <input id="q" type="search" placeholder="Parola o nome della carta" value="${esc(state.q)}" autocomplete="off">
          <button class="icon-btn clear" type="button" aria-label="Cancella ricerca" ${state.q ? '' : 'hidden'}>${icon('close')}</button>
        </div>
        <div class="chips" role="group" aria-label="Categorie">
          <button class="chip" data-cat="" aria-pressed="${!state.cat}">Tutte</button>
          ${FAQ_CATS.map((c) => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${state.cat === c}">${esc(c)}</button>`).join('')}
        </div>
        ${FAQ.some((f) => /segnaposto/i.test(f.q)) ? `<p class="demo-tag" style="margin-top:10px">${icon('construction')}Domande e risposte segnaposto, da sostituire con i testi ufficiali</p>` : ''}
        <div id="results" class="faq-list"></div>
        ${(() => {
          const c = { text: 'Non trovi la risposta? Contattaci!', email: 'a.ruggeri@busatrasportisrl.it', subject: 'Ho una domanda riguardo a Movat', ...(CONFIG.contact || {}) };
          return `<a class="faq-contact" href="${API ? '#/contatti' : `mailto:${encodeURIComponent(c.email).replace(/%40/g, '@')}?subject=${encodeURIComponent(c.subject)}`}">
            <span class="fc-ic">${icon('mail', 'fill')}</span><span class="fc-txt"><b>${esc(c.text)}</b><span>Scrivici un messaggio, ti rispondiamo noi.</span></span>${icon('chevron_right')}</a>`;
        })()}
      </div>`;
    function draw() {
      const n = norm(state.q);
      // Le FAQ marcate "solo sulla carta" compaiono nel dettaglio della carta, non qui.
      const list = FAQ.filter((f) => f.showInList !== false && (!state.cat || f.category === state.cat) && (!n ||
        norm(f.q).includes(n) || f.a.some((p) => norm(p).includes(n)) || (f.cardId && norm(CARD[f.cardId]?.name).includes(n))));
      const $r = document.getElementById('results');
      if (!list.length) {
        $r.innerHTML = `<div class="empty">${icon('help')}<h3>Nessuna risposta trovata</h3>
          <p class="muted">Prova con un'altra parola, il nome di una carta oppure guarda tutte le categorie.</p>
          <button class="btn small" id="reset" style="margin-top:12px">${icon('restart_alt')}Mostra tutte le domande</button></div>`;
        document.getElementById('reset').onclick = () => { state.q = ''; state.cat = ''; setQuery(state); route(); };
        return;
      }
      $r.innerHTML = list.map((f) => {
        const open = state.open === f.id;
        const card = f.cardId && CARD[f.cardId];
        return `<div class="faq-item ${open ? 'open' : ''}">
          <button class="faq-q" aria-expanded="${open}" aria-controls="a-${f.id}" data-faq="${f.id}">${highlight(f.q, state.q)}<span class="chev">${icon('expand_more')}</span></button>
          <div class="faq-a" id="a-${f.id}" ${open ? '' : 'hidden'}>
            <span class="cat">${esc(f.category)}</span>
            ${f.a.map((p) => `<p>${highlight(p, state.q)}</p>`).join('')}
            ${card ? `<a class="faq-card-link" href="#/ascolta/${card.id}">${cardArt(card, { label: false })}<span><small>Carta citata · #${pad2(card.number)}</small><b>${esc(card.name)}</b></span>${icon('chevron_right')}</a>` : ''}
            ${f.action ? `<a class="btn block" href="${f.action.href}">${esc(f.action.label)}${icon('chevron_right')}</a>` : ''}
          </div>
        </div>`;
      }).join('');
    }
    return {
      section: 'faq', title: 'Dubbi e risposte', html,
      mount() {
        draw();
        if (state.open) document.getElementById('a-' + state.open)?.closest('.faq-item')?.scrollIntoView({ block: 'center' });
        const $q = document.getElementById('q'), $clear = $view.querySelector('.clear');
        $q.addEventListener('input', () => { state.q = $q.value; $clear.hidden = !state.q; setQuery(state); draw(); });
        $clear.addEventListener('click', () => { $q.value = ''; $q.dispatchEvent(new Event('input')); $q.focus(); });
        $view.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
          state.cat = b.dataset.cat; setQuery(state);
          $view.querySelectorAll('[data-cat]').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw();
        }));
        document.getElementById('results').addEventListener('click', (e) => {
          const b = e.target.closest('[data-faq]'); if (!b) return;
          state.open = state.open === b.dataset.faq ? '' : b.dataset.faq; setQuery(state); draw();
          document.querySelector(`[data-faq="${b.dataset.faq}"]`)?.focus();
        });
      },
    };
  }

  /* ---------------- Privacy / 404 ---------------- */
  // Paragrafo dell'informativa: righe con "•" diventano un elenco, gli indirizzi web diventano link (dopo l'escape).
  const linkify = (t) => esc(t).replace(/https?:\/\/[^\s<]+[^\s<.,;:)]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  function privacyBlock(block) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const items = lines.filter((l) => /^[•\-–]\s/.test(l));
    if (!items.length) return `<p>${lines.map(linkify).join('<br>')}</p>`;
    const intro = lines.filter((l) => !/^[•\-–]\s/.test(l));
    return `${intro.length ? `<p>${intro.map(linkify).join('<br>')}</p>` : ''}<ul>${items.map((l) => `<li>${linkify(l.replace(/^[•\-–]\s*/, ''))}</li>`).join('')}</ul>`;
  }
  function viewPrivacy() {
    return {
      section: 'privacy', headTitle: 'Privacy', back: '#/', title: 'Informativa privacy',
      html: `<div class="page prose">
        <h1 style="font-size:28px">Informativa privacy</h1>
        ${CONFIG.privacyIsPlaceholder !== false ? `<p class="demo-tag" style="margin-top:10px">${icon('construction')}Testo segnaposto da sostituire con l’informativa ufficiale Busa</p>` : ''}
        ${(CONFIG.privacy || [
          { title: 'Quali dati raccogliamo', text: 'Quando invii una modalità: nome della modalità, descrizione, regole, nickname pubblico e, se lo indichi, un indirizzo email privato.' },
          { title: 'Come li usiamo', text: 'Il nickname viene pubblicato insieme alla modalità dopo il controllo del team Busa. L’email serve solo per eventuali aggiornamenti e non viene mai pubblicata.' },
          { title: 'Voti', text: 'I voti sono anonimi e il tuo voto viene ricordato solo su questo dispositivo.' },
        ]).map((x) => `${x.title ? `<h2>${esc(x.title)}</h2>` : ''}${String(x.text || '').split(/\n\s*\n/).map(privacyBlock).join('')}`).join('')}
        <p style="margin-top:20px"><a class="btn secondary" href="#/">${icon('home')}Torna alla Home</a></p>
      </div>`,
    };
  }
  function viewNotFound() {
    return {
      section: 'altro', headTitle: 'Pagina non trovata', back: '#/', title: 'Pagina non trovata',
      html: `<div class="page"><div class="empty">${icon('wrong_location')}<h3>Questa strada non porta da nessuna parte</h3>
        <p class="muted">La pagina che cerchi non esiste o è stata spostata.</p>
        <a class="btn small" href="#/" style="margin-top:12px">${icon('home')}Torna alla Home</a></div></div>`,
    };
  }

  route();
})();
