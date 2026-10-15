/* MÖVAT! — companion web app (vanilla JS, routing via hash). */
(function () {
  'use strict';

  const CONFIG = window.MOVAT_CONFIG;
  const CARDS = [...window.MOVAT_CARDS].sort((a, b) => a.number - b.number);
  const CARD = Object.fromEntries(CARDS.map((c) => [c.id, c]));
  const MODES = window.MOVAT_MODES;
  const FAQ = window.MOVAT_FAQ;
  const FAQ_CATS = window.MOVAT_FAQ_CATEGORIES;

  let $view = document.getElementById('view');
  const $top = document.getElementById('topbar');
  const $tabs = document.getElementById('tabbar');
  const $shell = document.getElementById('app');

  document.documentElement.style.setProperty('--card-ratio', CONFIG.cardRatio);

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
    ascolta: { title: 'Ascolta', icon: 'headphones' },
    scopri: { title: 'Scopri', icon: 'style' },
    crea: { title: 'Crea', icon: 'edit' },
    faq: { title: 'FAQ', icon: 'help' },
  };

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
    $tabs.innerHTML = Object.entries(SECTIONS).map(([k, s]) =>
      `<a class="tab" href="#/${k}" ${k === section ? 'aria-current="page"' : ''}>${icon(s.icon)}<span>${s.title}</span></a>`).join('');
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
      case 'scopri': out = sub ? viewMode(sub, query) : viewModes(query); break;
      case 'crea': out = viewCreate(sub || 'carte', query); break;
      case 'faq': out = viewFaq(query); break;
      case 'privacy': out = viewPrivacy(); break;
      default: out = viewNotFound();
    }
    if (!out) return; // la vista ha già reindirizzato
    renderChrome(out.section, out.back, out.headTitle);
    // Nuovo contenitore a ogni pagina: i listener della vista precedente spariscono con lui.
    const fresh = $view.cloneNode(false); $view.replaceWith(fresh); $view = fresh;
    $view.innerHTML = out.html;
    document.title = out.title ? `${out.title} · MÖVAT!` : 'MÖVAT! — Il gioco continua qui';
    if (!out.keepScroll) window.scrollTo(0, 0);
    out.mount?.();
  }
  window.addEventListener('hashchange', route);

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

  /* ---------------- HOME ---------------- */
  function viewHome() {
    const links = [
      ['ascolta', 'Ascolta', 'Le frasi in dialetto delle carte Busa', 'icona-ascolta.png'],
      ['scopri', 'Scopri', 'Le modalità di gioco create dagli utenti', 'icona-scopri.png'],
      ['crea', 'Crea', 'Le tue modalità di gioco', 'icona-crea.png'],
      ['faq', 'FAQ', 'Le risposte alle domande sul gioco', 'icona-faq.png'],
    ];
    return {
      section: null,
      html: `
      <header class="home-hero">
        <h1><img class="logo" src="assets/img/logo-movat.png" alt="MÖVAT!"></h1>
        <img class="truck" src="assets/img/camioncino.png" alt="Il camioncino Busa che corre tra le carte">
      </header>
      <p class="welcome">Il gioco continua qui!</p>
      <nav class="home-links" aria-label="Sezioni dell'app">
        ${links.map(([k, t, s, img]) => `
          <a class="home-link" href="#/${k}">
            <img src="assets/img/${img}" alt="">
            <span class="txt"><strong>${t}</strong><span class="sub">${s}</span></span>
            <span class="go">${icon('chevron_right')}</span>
          </a>`).join('')}
      </nav>
      <footer class="footer">
        <div class="busa">busa<small>TRASPORTI E LOGISTICA</small></div>
        <p style="margin-top:10px">MÖVAT! è un gioco di Busa Trasporti e Logistica</p>
        <p style="margin-top:6px"><a href="${CONFIG.privacyUrl}">Informativa privacy</a></p>
      </footer>`,
    };
  }

  /* ---------------- ASCOLTA: elenco ---------------- */
  function viewCards(query) {
    const q = query.q || '';
    const html = `
      <div class="page">
        <h1 class="page-title">Le carte parlanti</h1>
        <p class="page-sub">Trova la carta che hai in mano e ascolta la sua frase in dialetto piacentino.</p>
        <div class="search" role="search">
          ${icon('search')}
          <label class="sr-only" for="q">Cerca per numero o nome della carta</label>
          <input id="q" type="search" inputmode="search" placeholder="Numero o nome della carta" value="${esc(q)}" autocomplete="off">
          <button class="icon-btn clear" type="button" aria-label="Cancella ricerca" ${q ? '' : 'hidden'}>${icon('close')}</button>
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
      $r.innerHTML = `<p class="muted" style="font-weight:700;font-size:14px;margin-bottom:10px">${list.length} ${list.length === 1 ? 'carta' : 'carte'}</p>
        <div class="card-grid">${list.map((c) => {
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

  /* ---------------- Voti (senza account, salvati sul dispositivo) ---------------- */
  const votes = store.get('votes', {});
  function ratingOf(mode) {
    const mine = votes[mode.id];
    const sum = mode.ratingSum + (mine || 0), count = mode.ratingCount + (mine ? 1 : 0);
    return { avg: count ? sum / count : 0, count, mine };
  }
  function ratingText(mode, long = false) {
    const r = ratingOf(mode);
    if (!r.count) return `<span class="rating">${icon('star')}<span class="n">Ancora nessun voto</span></span>`;
    return `<span class="rating">${icon('star')}${fmtNum(r.avg)}${long ? ' su 5' : ''}<span class="n">· ${r.count} ${r.count === 1 ? 'voto' : 'voti'}</span></span>`;
  }
  const modeTotal = (m) => Object.values(m.cards).reduce((a, b) => a + b, 0);
  const modeCardList = (m) => Object.entries(m.cards).filter(([id]) => CARD[id]).map(([id, q]) => ({ card: CARD[id], qty: q })).sort((a, b) => a.card.number - b.card.number);
  const BANNERS = [['#28c4d8', '#a6e84a'], ['#ffc300', '#ff7a2f'], ['#8a3ffc', '#1292e8'], ['#52ae32', '#d6f55a']];

  /* ---------------- SCOPRI: gallery ---------------- */
  function viewModes(query) {
    const state = { q: query.q || '', ord: query.ord || 'recenti' };
    const html = `
      <div class="page">
        <div class="toolbar">
          <h1 style="font-size:28px">Modalità dei giocatori</h1>
        </div>
        <p class="muted" style="margin-top:6px;font-weight:600">Inventate da chi gioca, pubblicate dopo il controllo del team Busa.</p>
        <a class="btn block secondary" href="#/crea" style="margin-top:14px">${icon('add_circle')}Crea la tua modalità</a>
        <div class="search" role="search">
          ${icon('search')}
          <label class="sr-only" for="q">Cerca per titolo o descrizione</label>
          <input id="q" type="search" placeholder="Cerca per titolo o descrizione" value="${esc(state.q)}" autocomplete="off">
          <button class="icon-btn clear" type="button" aria-label="Cancella ricerca" ${state.q ? '' : 'hidden'}>${icon('close')}</button>
        </div>
        <div class="seg" role="group" aria-label="Ordina">
          ${[['recenti', 'Più recenti'], ['valutazione', 'Valutazione più alta'], ['voti', 'Più votate']].map(([k, l]) =>
            `<button type="button" data-ord="${k}" aria-pressed="${state.ord === k}">${l}</button>`).join('')}
        </div>
        <div id="results" style="margin-top:16px"></div>
      </div>`;
    function draw() {
      const n = norm(state.q);
      let list = MODES.filter((m) => !n || norm(m.title).includes(n) || norm(m.description).includes(n));
      list.sort((a, b) => {
        if (state.ord === 'valutazione') return ratingOf(b).avg - ratingOf(a).avg || ratingOf(b).count - ratingOf(a).count;
        if (state.ord === 'voti') return ratingOf(b).count - ratingOf(a).count;
        return b.date.localeCompare(a.date);
      });
      const $r = document.getElementById('results');
      if (!list.length) {
        $r.innerHTML = `<div class="empty">${icon('search_off')}<h3>Nessuna modalità trovata</h3>
          <p class="muted">Prova con altre parole, oppure inventane una tu!</p>
          <a class="btn small" href="#/crea" style="margin-top:12px">${icon('add')}Crea la tua modalità</a></div>`;
        return;
      }
      $r.innerHTML = list.map((m) => {
        const cl = modeCardList(m);
        const [b1, b2] = BANNERS[MODES.indexOf(m) % BANNERS.length];
        const shown = cl.slice(0, cl.length > 5 ? 4 : 5);
        return `<article class="mode-card">
          <div class="mode-banner" style="--b1:${b1};--b2:${b2}" aria-hidden="true"><span class="bt">${esc(m.title)}</span><img src="assets/img/camioncino.png" alt=""></div>
          <div class="mode-body">
            <h2>${highlight(m.title, state.q)}</h2>
            <p class="by">di <b>${esc(m.author)}</b></p>
            <p class="desc">${highlight(m.description, state.q)}</p>
            <div class="facts">
              <span>${icon('group')}${esc(m.players)} giocatori</span>
              <span>${icon('style')}${modeTotal(m)} carte Busa</span>
              ${ratingText(m)}
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
    const [b1, b2] = BANNERS[MODES.indexOf(m) % BANNERS.length];
    const html = `
      <div style="margin-bottom:-8px"><div class="mode-banner" style="--b1:${b1};--b2:${b2};height:110px;border-radius:0" aria-hidden="true"><span class="bt">${esc(m.title)}</span><img src="assets/img/camioncino.png" alt=""></div></div>
      <div class="page">
        <header class="mode-head">
          <h1>${esc(m.title)}</h1>
          <p class="by" style="margin-top:4px">di <b>${esc(m.author)}</b></p>
          <div class="facts">
            <span>${icon('group')}${esc(m.players)} giocatori</span>
            <span>${icon('style')}${modeTotal(m)} carte Busa</span>
            <span id="rating-inline">${ratingText(m, true)}</span>
          </div>
          <p style="margin-top:12px">${esc(m.description)}</p>
        </header>
        ${m.rules ? `<section class="info-box"><h3>${icon('rule')}Regole aggiuntive</h3><p>${esc(m.rules)}</p></section>` : ''}
        <div class="actions-row">
          <button class="btn secondary small" id="share">${icon('link')}Condividi</button>
          <button class="btn small" id="variant">${icon('edit')}Crea una variante</button>
        </div>

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

        <section class="vote-box" id="vote" aria-labelledby="vote-title"></section>
      </div>`;

    function drawVote(editing) {
      const r = ratingOf(m);
      const $v = document.getElementById('vote');
      document.getElementById('rating-inline').innerHTML = ratingText(m, true);
      const summary = r.count ? `${fmtNum(r.avg)} su 5 · ${r.count} ${r.count === 1 ? 'voto' : 'voti'}` : 'Ancora nessun voto';
      if (r.mine && !editing) {
        $v.innerHTML = `<h2 id="vote-title">Grazie per il tuo voto!</h2>
          <p class="summary">${summary}</p>
          <div class="stars" aria-hidden="true">${[1, 2, 3, 4, 5].map((n) => `<button tabindex="-1" class="${n <= r.mine ? 'on' : ''}">${icon('star')}</button>`).join('')}</div>
          <p class="voted">${icon('check_circle', 'fill')}Hai dato ${r.mine} ${r.mine === 1 ? 'stella' : 'stelle'}</p>
          <div style="margin-top:12px"><button class="btn ghost small" id="edit-vote">${icon('edit')}Modifica il voto</button></div>`;
        document.getElementById('edit-vote').onclick = () => drawVote(true);
        return;
      }
      let pick = r.mine || 0;
      $v.innerHTML = `<h2 id="vote-title">Hai provato questa modalità? Valutala!</h2>
        <p class="summary">${summary}</p>
        <div class="stars" role="radiogroup" aria-label="Il tuo voto da 1 a 5 stelle">
          ${[1, 2, 3, 4, 5].map((n) => `<button role="radio" aria-checked="${n === pick}" data-star="${n}" aria-label="${n} ${n === 1 ? 'stella' : 'stelle'}">${icon('star')}</button>`).join('')}
        </div>
        <button class="btn block" id="send-vote" ${pick ? '' : 'disabled'}>${pick ? `Conferma ${pick} ${pick === 1 ? 'stella' : 'stelle'}` : 'Scegli da 1 a 5 stelle'}</button>
        ${editing ? `<button class="btn ghost small" id="cancel-vote" style="margin-top:10px">Annulla</button>` : ''}
        <p class="muted" style="font-size:13px;margin-top:10px;font-weight:600">Nessun account: il voto resta su questo dispositivo.</p>`;
      const paint = () => {
        $v.querySelectorAll('[data-star]').forEach((b) => { const n = +b.dataset.star; b.classList.toggle('on', n <= pick); b.setAttribute('aria-checked', n === pick); });
        const sb = document.getElementById('send-vote');
        sb.disabled = !pick; sb.textContent = pick ? `Conferma ${pick} ${pick === 1 ? 'stella' : 'stelle'}` : 'Scegli da 1 a 5 stelle';
      };
      paint();
      $v.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', () => { pick = +b.dataset.star; paint(); }));
      document.getElementById('send-vote').onclick = () => {
        votes[m.id] = pick; store.set('votes', votes);
        toast(editing ? 'Voto aggiornato' : 'Voto registrato, grazie!');
        drawVote(false);
      };
      const c = document.getElementById('cancel-vote'); if (c) c.onclick = () => drawVote(false);
    }

    return {
      section: 'scopri', back: '#/scopri', title: m.title, html, keepScroll: !!query.vista,
      mount() {
        drawVote(false);
        $view.querySelectorAll('[data-vista]').forEach((b) => b.addEventListener('click', () => {
          history.replaceState(null, '', buildHash('scopri/' + m.id, { vista: b.dataset.vista })); route();
        }));
        $view.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
          const card = CARD[b.dataset.zoom];
          openCardModal(card, { extra: `<p class="sub" style="font-size:18px;color:var(--green-dark)">In questa modalità: ×${m.cards[card.id]}</p>` });
        }));
        document.getElementById('share').onclick = async () => {
          const url = location.href.split('#')[0] + '#/scopri/' + m.id;
          toast((await copyText(url)) ? 'Link copiato! Incollalo dove vuoi.' : 'Non è stato possibile copiare il link');
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

  /* ---------------- Modal carta ---------------- */
  function openCardModal(card, { extra = '', body = '', onMount } = {}) {
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
        ${card.audio ? `<a class="btn block secondary" style="margin-top:16px" href="#/ascolta/${card.id}">${icon('headphones')}Ascolta la frase</a>` : ''}
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
  const EMPTY_DRAFT = { start: 'vuota', cards: {}, onlySelected: false, q: '', name: '', description: '', players: '', rules: '', tried: '', nickname: '', email: '', consent: false };
  const draft = {
    get() { return { ...EMPTY_DRAFT, ...store.get('draft', {}) }; },
    update(patch) { const d = { ...this.get(), ...patch }; store.set('draft', d); return d; },
    clear() { store.del('draft'); },
  };
  const totalOf = (cards) => Object.values(cards).reduce((a, b) => a + b, 0);
  function validateDetails(d) {
    const e = {};
    if (!d.name.trim()) e.name = 'Dai un nome alla tua modalità.';
    else if (d.name.trim().length < 3) e.name = 'Il nome deve avere almeno 3 caratteri.';
    if (!d.description.trim()) e.description = 'Racconta in breve come si gioca.';
    else if (d.description.trim().length < 20) e.description = 'Aggiungi qualche dettaglio in più (almeno 20 caratteri).';
    if (!d.nickname.trim()) e.nickname = 'Scegli il nickname che apparirà accanto alla modalità.';
    if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim())) e.email = 'Questo indirizzo email non sembra corretto.';
    return e;
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
    return viewNotFound();
  }

  /* PASSAGGIO 1 — CARTE */
  function viewCreateCards() {
    let d = draft.get();
    const html = `
      <div class="page">
        <h1 class="page-title" style="font-size:26px">Crea la tua modalità</h1>
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
          <button class="chip" id="only-sel" aria-pressed="${d.onlySelected}">${icon('check_circle', d.onlySelected ? 'fill' : '')}Solo selezionate</button>
        </div>
        <div id="pick" class="card-grid" style="margin-top:14px"></div>
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
        $p.innerHTML = list.map((c) => {
          const qty = d.cards[c.id] || 0;
          return `<article class="pick-card ${qty ? 'selected' : ''}" data-card="${c.id}">
            <button class="zoom" type="button" data-zoom="${c.id}" aria-label="Ingrandisci ${esc(c.name)}">${cardArt(c)}</button>
            <div class="nm"><small>#${pad2(c.number)}</small>${esc(c.name)}</div>
            <div class="qc">${qtyControl(c, qty)}</div>
          </article>`;
        }).join('');
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
        art.classList.toggle('selected', !!q);
        art.querySelector('.qc').innerHTML = qtyControl(c, q);
        if (!keepFocus) art.querySelector(delta > 0 ? '[data-inc]' : '[data-dec]')?.focus();
      }
      drawBar();
      return q;
    }
    return {
      section: 'crea', title: 'Crea: scegli le carte', html,
      mount() {
        drawGrid();
        $view.addEventListener('click', (e) => {
          const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]'), z = e.target.closest('[data-zoom]');
          if (inc) setQty(inc.dataset.inc, +1);
          else if (dec) setQty(dec.dataset.dec, -1);
          else if (z) {
            const card = CARD[z.dataset.zoom];
            openCardModal(card, {
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
    const PLAYERS = ['2', '2–3', '2–4', '3–4', '3–5', '3–6', '4–6', '5 o più'];
    const html = `
      <div class="page">
        <h1 class="page-title" style="font-size:26px">Racconta la tua modalità</h1>
        ${stepper('dettagli')}
        ${Object.keys(errs).length ? `<div class="form-error-summary" role="alert">${icon('error', 'fill')}<span>Controlla ${Object.keys(errs).length === 1 ? 'il campo evidenziato' : `i ${Object.keys(errs).length} campi evidenziati`} prima di proseguire.</span></div>` : ''}
        <form class="form" id="form" novalidate style="margin-top:12px">
          ${field('name', 'Nome della modalità', `<input type="text" ${attrs('name', true)} maxlength="60" value="${esc(d.name)}" placeholder="Es. Sorpassi a sorpresa" autocomplete="off">`, { req: true, count: 60 })}
          ${field('description', 'Descrizione', `<textarea ${attrs('description', true)} maxlength="600" placeholder="Come si gioca? Cosa la rende divertente?">${esc(d.description)}</textarea>`, { req: true, count: 600 })}
          ${field('players', 'Giocatori consigliati', `<select ${attrs('players')}><option value="">Non specificato</option>${PLAYERS.map((p) => `<option ${d.players === p ? 'selected' : ''}>${p}</option>`).join('')}</select>`, { opt: ' (facoltativo)' })}
          ${field('rules', 'Regole aggiuntive', `<textarea ${attrs('rules')} maxlength="800" placeholder="Eventuali regole speciali da spiegare agli altri giocatori">${esc(d.rules)}</textarea>`, { opt: ' (facoltative)', count: 800 })}
          <fieldset class="field">
            <legend>L’hai già provata?</legend>
            <div class="chips" role="radiogroup" aria-label="L’hai già provata?">
              ${['Non ancora', 'Una volta', 'Più volte'].map((t) => `<button type="button" class="chip" role="radio" data-tried="${t}" aria-checked="${d.tried === t}" aria-pressed="${d.tried === t}">${t}</button>`).join('')}
            </div>
          </fieldset>
          ${field('nickname', 'Nickname pubblico', `<input type="text" ${attrs('nickname', true)} maxlength="30" value="${esc(d.nickname)}" placeholder="Es. Ruota libera" autocomplete="nickname">`, { req: true, hint: 'Apparirà accanto alla modalità quando sarà pubblicata.' })}
          ${field('email', `Email <span class="private-badge">${icon('lock')}Privata</span>`, `<input type="email" ${attrs('email')} value="${esc(d.email)}" placeholder="nome@esempio.it" autocomplete="email" inputmode="email">`, { opt: ' (facoltativa)', hint: 'Solo per eventuali aggiornamenti sulla tua proposta. Non sarà mai pubblicata.' })}
          <p class="muted" style="font-size:13px;font-weight:600"><span class="req" style="color:var(--red)">*</span> Campo obbligatorio</p>
        </form>
        <div class="sticky-action two">
          <a class="btn ghost" href="#/crea/carte">${icon('arrow_back')}Indietro</a>
          <button class="btn" id="review">Rivedi la proposta</button>
        </div>
      </div>`;
    return {
      section: 'crea', back: '#/crea/carte', title: 'Crea: dettagli', html,
      mount() {
        const $f = document.getElementById('form');
        $f.addEventListener('input', (e) => {
          const t = e.target; if (!t.name) return;
          draft.update({ [t.name]: t.value });
          const c = $view.querySelector(`[data-count="${t.name}"]`); if (c) c.textContent = t.value.length;
          // Rimuove l'errore appena il campo diventa valido.
          const wrap = t.closest('.field');
          if (wrap?.classList.contains('invalid') && !validateDetails(draft.get())[t.name]) {
            wrap.classList.remove('invalid'); t.removeAttribute('aria-invalid'); document.getElementById('e-' + t.name).hidden = true;
          }
        });
        $f.addEventListener('change', (e) => { if (e.target.name) draft.update({ [e.target.name]: e.target.value }); });
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
            <div><dt>Descrizione</dt><dd>${esc(d.description)}</dd></div>
            <div><dt>Nickname pubblico</dt><dd>${esc(d.nickname)}</dd></div>
            <div><dt>Giocatori consigliati</dt><dd>${esc(d.players || 'Non specificato')}</dd></div>
            <div><dt>Regole aggiuntive</dt><dd>${esc(d.rules || 'Nessuna')}</dd></div>
            ${d.tried ? `<div><dt>L’hai già provata?</dt><dd>${esc(d.tried)}</dd></div>` : ''}
            <div><dt>Email ${d.email ? `<span class="private-badge">${icon('lock')}Non pubblicata</span>` : ''}</dt><dd>${esc(d.email || 'Non indicata')}</dd></div>
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
        <div class="notice">${icon('lock')}<span>La tua email resta privata: la usiamo solo per aggiornarti sulla proposta e <b>non sarà mai pubblicata</b>.</span></div>
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
    async function submit(payload) {
      // Simulazione di errore per la demo: aggiungere ?simula=errore all'URL del riepilogo.
      if (query.simula === 'errore' || !navigator.onLine) { await new Promise((r) => setTimeout(r, 900)); throw new Error('rete'); }
      if (!CONFIG.submitUrl) { await new Promise((r) => setTimeout(r, 1100)); return; }
      const res = await fetch(CONFIG.submitUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
    }
    return {
      section: 'crea', back: '#/crea/dettagli', title: 'Crea: riepilogo', html,
      mount() {
        const $c = document.getElementById('consent'), $send = document.getElementById('send'), $state = document.getElementById('send-state');
        $c.addEventListener('change', () => {
          draft.update({ consent: $c.checked });
          if ($c.checked) { document.getElementById('consent-wrap').classList.remove('invalid'); document.getElementById('consent-err').hidden = true; }
        });
        $send.onclick = async () => {
          if (!$c.checked) {
            document.getElementById('consent-wrap').classList.add('invalid'); document.getElementById('consent-err').hidden = false; $c.focus(); return;
          }
          const cur = draft.get();
          $send.disabled = true; $send.innerHTML = icon('progress_activity', 'spin') + 'Invio in corso…'; $state.innerHTML = '';
          try {
            await submit({
              title: cur.name.trim(), description: cur.description.trim(), players: cur.players, rules: cur.rules.trim(), tried: cur.tried,
              nickname: cur.nickname.trim(), email: cur.email.trim() || null, cards: cur.cards, startedFrom: cur.start, consent: true,
              status: 'in_attesa', submittedAt: new Date().toISOString(),
            });
            draft.clear(); store.set('lastSent', { name: cur.name.trim(), email: !!cur.email.trim() });
            go('#/crea/inviata');
          } catch {
            $send.disabled = false; $send.innerHTML = icon('refresh') + 'Riprova';
            $state.innerHTML = `<div class="alert" role="alert">${icon('wifi_off')}<div><b>Invio non riuscito.</b><br>Controlla la connessione e riprova: i dati che hai inserito sono al sicuro.
              <div><button class="btn danger small" id="retry">${icon('refresh')}Riprova l’invio</button></div></div></div>`;
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
        <h1>Proposta ricevuta!</h1>
        <p>Il team Busa la controllerà prima della pubblicazione.</p>
        ${last ? `<p class="muted" style="font-size:15px">“${esc(last.name)}” è in viaggio verso il nostro magazzino.</p>` : ''}
        <ol class="steps">
          <li>${icon('check_circle', 'fill')}Proposta inviata</li>
          <li>${icon('fact_check')}Controllo del team Busa</li>
          <li>${icon('public')}Pubblicazione in Scopri con il tuo nickname</li>
        </ol>
        ${last?.email ? `<p class="muted" style="font-size:14px;margin-bottom:16px">Ti scriveremo all’email indicata quando ci saranno novità.</p>` : ''}
        <div style="display:grid;gap:12px">
          <a class="btn block" href="#/scopri">${icon('style')}Scopri altre modalità</a>
          <a class="btn block secondary" href="#/crea/carte">${icon('add')}Crea un’altra modalità</a>
        </div>
      </div>`;
    return { section: 'crea', title: 'Proposta ricevuta', html };
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
          <input id="q" type="search" placeholder="Parola chiave o nome della carta" value="${esc(state.q)}" autocomplete="off">
          <button class="icon-btn clear" type="button" aria-label="Cancella ricerca" ${state.q ? '' : 'hidden'}>${icon('close')}</button>
        </div>
        <div class="chips" role="group" aria-label="Categorie">
          <button class="chip" data-cat="" aria-pressed="${!state.cat}">Tutte</button>
          ${FAQ_CATS.map((c) => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${state.cat === c}">${esc(c)}</button>`).join('')}
        </div>
        <p class="demo-tag" style="margin-top:10px">${icon('construction')}Domande e risposte segnaposto, da sostituire con i testi ufficiali</p>
        <div id="results" class="faq-list"></div>
      </div>`;
    function draw() {
      const n = norm(state.q);
      const list = FAQ.filter((f) => (!state.cat || f.category === state.cat) && (!n ||
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
  function viewPrivacy() {
    return {
      section: 'privacy', headTitle: 'Privacy', back: '#/', title: 'Informativa privacy',
      html: `<div class="page prose">
        <h1 style="font-size:28px">Informativa privacy</h1>
        <p class="demo-tag" style="margin-top:10px">${icon('construction')}Testo segnaposto da sostituire con l’informativa ufficiale Busa</p>
        <h2>Quali dati raccogliamo</h2>
        <p>Quando invii una modalità: nome della modalità, descrizione, regole, nickname pubblico e, se lo indichi, un indirizzo email privato.</p>
        <h2>Come li usiamo</h2>
        <p>Il nickname viene pubblicato insieme alla modalità dopo il controllo del team Busa. L’email serve solo per eventuali aggiornamenti e non viene mai pubblicata.</p>
        <h2>Voti</h2>
        <p>I voti sono anonimi e il tuo voto viene ricordato solo su questo dispositivo.</p>
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
