/* MÖVAT! — CMS (vanilla JS, routing via hash). */
(function () {
  'use strict';

  const $root = document.getElementById('root');
  let DATA = null;
  let ME = null;

  /* ---------------- Utility ---------------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n, cls = '') => `<span class="ms ${cls}" aria-hidden="true">${n}</span>`;
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const fmtAvg = (sum, count) => (count ? (sum / count).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—');
  const asset = (u) => (!u ? '' : /^(https?:)?\//.test(u) ? u : '/' + u);
  const STATUS = { pending: 'In attesa', published: 'Pubblicata', rejected: 'Rifiutata' };
  const statusBadge = (s) => `<span class="badge ${s}">${STATUS[s] || s}</span>`;
  let toastTimer;
  function toast(msg, err) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  async function api(method, url, body) {
    const res = await fetch('/api/admin/' + url, {
      method, credentials: 'same-origin',
      headers: { 'X-Movat-Cms': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const out = await res.json().catch(() => ({}));
    if (res.status === 401 && !['login', 'password', 'me'].includes(url)) { ME = null; DATA = null; go('#/login'); throw new Error('Sessione scaduta: accedi di nuovo.'); }
    if (!res.ok) throw new Error(out.error || 'Operazione non riuscita');
    return out;
  }
  async function reload() { DATA = await api('GET', 'data'); document.documentElement.style.setProperty('--card-ratio', DATA.settings.cardRatio); }
  // Esegue un salvataggio, ricarica i dati e mostra un messaggio.
  async function act(btn, fn, okMsg) {
    const label = btn?.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = icon('progress_activity', 'spin') + 'Attendi…'; }
    try { const r = await fn(); await reload(); if (okMsg) toast(okMsg); return r ?? true; }
    catch (e) { toast(e.message, true); return false; }
    finally { if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = label; } }
  }
  function readFileB64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = reject; r.readAsDataURL(file);
    });
  }
  const cardById = (id) => DATA.cards.find((c) => c.id === id);
  const sortedCards = () => [...DATA.cards].sort((a, b) => a.number - b.number);
  const modeTotal = (m) => Object.values(m.cards || {}).reduce((a, b) => a + b, 0);
  function cardArt(c) {
    if (c.image) return `<div class="card-art"><img class="real" src="${esc(asset(c.image))}" alt=""></div>`;
    return `<div class="card-art"><div class="art-bg"></div><div class="art-name">${esc(c.name)}</div>
      <div class="art-icon" style="background:${esc(c.color || '#439626')}">${icon(esc(c.icon || 'style'))}</div>
      <img class="art-truck" src="/assets/img/camioncino.png" alt=""><div class="art-num">${esc(c.number)}</div></div>`;
  }
  // Avviso per le modifiche non salvate.
  let dirty = false;
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  function watchDirty(form) { dirty = false; form.addEventListener('input', () => { dirty = true; }); }

  /* ---------------- Router ---------------- */
  const go = (h) => { if (location.hash === h) route(); else location.hash = h; };
  let lastHash = location.hash;
  // A ogni cambio di sezione i dati vengono riletti dal server (es. nuove proposte o voti).
  let stale = false;
  window.addEventListener('hashchange', () => {
    if (dirty && !confirm('Ci sono modifiche non salvate. Vuoi uscire comunque?')) { history.replaceState(null, '', lastHash); return; }
    dirty = false; stale = true; route();
  });

  const NAV = [
    ['', 'dashboard', 'Panoramica'],
    ['carte', 'style', 'Carte'],
    ['modalita', 'stadia_controller', 'Modalità'],
    ['voti', 'star', 'Voti'],
    ['faq', 'help', 'FAQ'],
    ['impostazioni', 'tune', 'Testi e impostazioni'],
    ['backup', 'cloud_download', 'Backup'],
  ];

  async function route() {
    lastHash = location.hash;
    const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
    if (!ME) {
      try { ME = await api('GET', 'me'); } catch { ME = null; }
    }
    if (!ME) return viewLogin();
    if (parts[0] === 'login') return go('#/');
    if (DATA && stale) { stale = false; try { await reload(); } catch { /* si usano i dati già caricati */ } }
    if (!DATA) { $root.innerHTML = `<div class="empty">${icon('progress_activity', 'spin')} Caricamento…</div>`; try { await reload(); } catch (e) { $root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; } }
    const [sec, id] = parts;
    const views = { carte: id === 'importa' ? viewImport : id ? viewCard : viewCards, modalita: id ? viewMode : viewModes, voti: viewVotes, faq: id ? viewFaqItem : viewFaq, impostazioni: viewSettings, backup: viewBackup };
    const view = sec ? views[sec] : viewDashboard;
    if (!view) return go('#/');
    const pending = DATA.modes.filter((m) => m.status === 'pending').length;
    $root.innerHTML = `<div class="layout">
      <nav class="side" aria-label="Sezioni del CMS">
        <a class="brand" href="#/"><img src="/assets/img/logo-movat.png" alt="MÖVAT!"><span>CMS</span></a>
        ${NAV.map(([k, ic, l]) => `<a class="nav-link" href="#/${k}" ${(sec || '') === k ? 'aria-current="page"' : ''}>${icon(ic)}<span class="lbl">${l}</span>${k === 'modalita' && pending ? `<span class="badge count" title="Proposte in attesa">${pending}</span>` : ''}</a>`).join('')}
        <div class="bottom">
          <a class="nav-link" href="/" target="_blank" rel="noopener">${icon('open_in_new')}<span class="lbl">Apri l’app</span></a>
          <a class="nav-link" href="#" id="logout">${icon('logout')}<span class="lbl">Esci</span></a>
        </div>
      </nav>
      <main class="main" id="main"></main>
    </div>`;
    document.getElementById('logout').onclick = async (e) => {
      e.preventDefault(); await api('POST', 'logout', {}).catch(() => {}); ME = null; DATA = null; go('#/login');
    };
    const $main = document.getElementById('main');
    view($main, id);
    window.scrollTo(0, 0);
  }

  /* ---------------- Login ---------------- */
  function viewLogin() {
    if (!location.hash.startsWith('#/login')) history.replaceState(null, '', '#/login');
    $root.innerHTML = `<div class="login"><form class="box form" id="f" novalidate>
      <img src="/assets/img/logo-movat.png" alt="MÖVAT!">
      <h1>Gestione contenuti</h1>
      <div class="field"><label for="u">Utente</label><input id="u" type="text" autocomplete="username" required autofocus></div>
      <div class="field"><label for="p">Password</label><input id="p" type="password" autocomplete="current-password" required></div>
      <p class="notice err" id="err" hidden></p>
      <button class="btn" type="submit" style="min-height:48px">${icon('login')}Accedi</button>
    </form></div>`;
    document.getElementById('f').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'), $err = document.getElementById('err');
      btn.disabled = true; $err.hidden = true;
      try {
        const r = await api('POST', 'login', { user: document.getElementById('u').value, password: document.getElementById('p').value });
        ME = { user: r.user }; ME = await api('GET', 'me'); await reload(); go('#/');
      } catch (er) { $err.textContent = er.message; $err.hidden = false; btn.disabled = false; }
    };
  }

  /* ---------------- Panoramica ---------------- */
  function viewDashboard($m) {
    const pending = DATA.modes.filter((m) => m.status === 'pending');
    const published = DATA.modes.filter((m) => m.status === 'published');
    const demoCards = DATA.cards.filter((c) => c.demo).length;
    const noAudio = DATA.cards.filter((c) => !c.audio).length;
    const noImg = DATA.cards.filter((c) => !c.image).length;
    const demoFaq = DATA.faq.filter((f) => f.demo || /segnaposto/i.test(f.q)).length;
    const demoVotes = DATA.votes.filter((v) => v.demo).length;
    const demoModes = DATA.modes.filter((m) => m.source === 'demo').length;
    const todo = [
      demoCards && `<b>${demoCards}</b> carte hanno ancora i dati dimostrativi. <a href="#/carte">Aggiorna le carte</a>`,
      noImg && `<b>${noImg}</b> carte non hanno l’immagine reale (viene mostrata l’illustrazione segnaposto). <a href="#/carte">Carica le immagini</a>`,
      noAudio && `<b>${noAudio}</b> carte non hanno l’audio (nell’app compare “Audio non ancora disponibile”). <a href="#/carte">Carica gli audio</a>`,
      demoFaq && `<b>${demoFaq}</b> domande FAQ sono segnaposto. <a href="#/faq">Scrivi le FAQ</a>`,
      DATA.settings.privacyIsPlaceholder && `L’informativa privacy è ancora un segnaposto. <a href="#/impostazioni">Inserisci il testo</a>`,
      demoModes && `<b>${demoModes}</b> modalità sono di esempio. <a href="#/modalita?filtro=demo">Rivedile o eliminale</a>`,
      demoVotes && `<b>${demoVotes}</b> voti sono dimostrativi. <a href="#/voti">Gestisci i voti</a>`,
      !DATA.settings.notifyEmails && `Nessuna email impostata per le notifiche delle nuove proposte. <a href="#/impostazioni">Impostala</a>`,
    ].filter(Boolean);
    $m.innerHTML = `
      <div class="page-head"><div><h1>Ciao ${esc(ME.user)}!</h1><p class="muted">Da qui gestisci tutti i contenuti dell’app MÖVAT!.</p></div></div>
      <div class="grid-4">
        <a class="stat ${pending.length ? 'warn' : ''}" href="#/modalita?filtro=pending"><b>${pending.length}</b><span>Proposte da controllare</span></a>
        <a class="stat" href="#/modalita?filtro=published"><b>${published.length}</b><span>Modalità pubblicate</span></a>
        <a class="stat" href="#/carte"><b>${DATA.cards.length}</b><span>Carte nel catalogo</span></a>
        <a class="stat" href="#/voti"><b>${DATA.votes.length}</b><span>Voti ricevuti</span></a>
      </div>
      <div class="panel" style="margin-top:16px">
        <div class="panel-head"><h2>Proposte in attesa</h2><a class="btn secondary sm" href="#/modalita?filtro=pending">Vedi tutte</a></div>
        ${pending.length ? `<div class="table-wrap"><table><tbody>${pending.slice(0, 6).map((m) => `
          <tr class="clickable" data-href="#/modalita/${esc(m.id)}"><td><span class="title">${esc(m.title)}</span><div class="muted small">di ${esc(m.author)} · ${modeTotal(m)} carte</div></td>
          <td class="muted small">${fmtDate(m.createdAt)}</td><td style="text-align:right"><span class="btn sm">Controlla${icon('chevron_right')}</span></td></tr>`).join('')}</tbody></table></div>`
          : `<p class="empty">${icon('task_alt')} Nessuna proposta da controllare.</p>`}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Da completare</h2></div>
        ${todo.length ? todo.map((t) => `<div class="notice warn">${icon('construction')}<span>${t}</span></div>`).join('') : `<p class="notice">${icon('verified')}Tutti i contenuti segnaposto sono stati sostituiti.</p>`}
      </div>`;
    bindRows($m);
  }
  function bindRows($m) { $m.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => go(tr.dataset.href))); }

  /* ---------------- Carte ---------------- */
  function viewCards($m) {
    const q = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '';
    $m.innerHTML = `
      <div class="page-head"><div><h1>Carte</h1><p class="muted">Catalogo delle carte Busa: nomi, copie, frasi in dialetto, immagini e audio.</p></div>
        <div class="row"><a class="btn secondary" href="#/carte/importa">${icon('photo_library')}Caricamento massivo</a><a class="btn" href="#/carte/nuova">${icon('add')}Nuova carta</a></div></div>
      <div class="panel">
        <div class="panel-head"><div class="search-box">${icon('search')}<input type="search" id="q" placeholder="Cerca per numero o nome" value="${esc(q)}"></div>
          <span class="muted small">Le “copie” sono il massimo selezionabile nel configuratore Crea.</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th></th><th>N.</th><th>Nome</th><th>Copie</th><th>Frase</th><th>Immagine</th><th>Audio</th><th></th></tr></thead>
          <tbody id="rows"></tbody></table></div>
      </div>`;
    const draw = (q) => {
      const n = norm(q);
      const list = sortedCards().filter((c) => !n || norm(c.name).includes(n) || String(c.number) === n.replace('#', ''));
      document.getElementById('rows').innerHTML = list.map((c) => `
        <tr class="clickable" data-href="#/carte/${esc(c.id)}">
          <td><div class="thumb">${cardArt(c)}</div></td><td class="num"><b>#${pad2(c.number)}</b></td>
          <td><span class="title">${esc(c.name)}</span> ${c.demo ? '<span class="badge demo">Demo</span>' : ''}</td>
          <td class="num">${c.copies}</td>
          <td>${c.dialect ? icon('check_circle', 'fill yes') : icon('remove', 'no')}</td>
          <td>${c.image ? icon('check_circle', 'fill yes') : icon('remove', 'no')}</td>
          <td>${c.audio ? icon('check_circle', 'fill yes') : icon('remove', 'no')}</td>
          <td style="text-align:right">${icon('chevron_right', 'muted')}</td>
        </tr>`).join('') || `<tr><td colspan="8" class="empty">Nessuna carta trovata.</td></tr>`;
      bindRows($m);
    };
    draw(q);
    document.getElementById('q').addEventListener('input', (e) => { history.replaceState(null, '', '#/carte' + (e.target.value ? '?q=' + encodeURIComponent(e.target.value) : '')); draw(e.target.value); });
  }

  // kind: 'image' o 'audio'. name: campo del modulo. empty: testo quando non c'è nessun file.
  function uploadField(kind, value, { name = kind, empty = '' } = {}) {
    const isImg = kind === 'image';
    return `<div class="upload" data-upload="${kind}" data-name="${esc(name)}" data-empty="${esc(empty)}">
      <div class="preview">${value && isImg ? `<img src="${esc(asset(value))}" alt="">` : icon(isImg ? 'image' : 'graphic_eq')}</div>
      <div class="info">
        <b>${value ? esc(value.split('/').pop()) : empty ? esc(empty) : isImg ? 'Nessuna immagine: si usa l’illustrazione segnaposto' : 'Nessun audio: compare “Audio non ancora disponibile”'}</b>
        ${value && !isImg ? `<audio controls preload="none" src="${esc(asset(value))}"></audio>` : ''}
      </div>
      <input type="hidden" name="${esc(name)}" value="${esc(value || '')}">
      <label class="btn secondary sm">${icon('upload')}${value ? 'Sostituisci' : 'Carica'}<input type="file" accept="${isImg ? 'image/png,image/jpeg,image/webp,image/gif' : 'audio/*'}" hidden></label>
      ${value ? `<button type="button" class="btn danger sm" data-remove>${icon('delete')}Rimuovi</button>` : ''}
    </div>`;
  }
  function bindUploads($scope, onChange) {
    $scope.querySelectorAll('[data-upload]:not([data-bound])').forEach((box) => {
      box.dataset.bound = '1';
      const kind = box.dataset.upload;
      const setVal = (v) => { box.outerHTML = uploadField(kind, v, { name: box.dataset.name, empty: box.dataset.empty }); bindUploads($scope, onChange); dirty = true; onChange?.(); };
      box.querySelector('input[type=file]').addEventListener('change', async (e) => {
        const file = e.target.files[0]; if (!file) return;
        if (file.size > 15 * 1024 * 1024) return toast('Il file supera i 15 MB', true);
        box.querySelector('.info b').textContent = 'Caricamento in corso…';
        try {
          const r = await api('POST', 'upload', { name: file.name, type: file.type, data: await readFileB64(file) });
          setVal(r.url); toast('File caricato: ricordati di salvare');
        } catch (er) { toast(er.message, true); setVal(box.querySelector('input[type=hidden]').value); }
      });
      box.querySelector('[data-remove]')?.addEventListener('click', () => setVal(''));
    });
  }

  function viewCard($m, id) {
    const isNew = id === 'nuova';
    const c = isNew ? { number: Math.max(0, ...DATA.cards.map((x) => x.number)) + 1, name: '', copies: 1, color: '#439626', icon: 'style', dialect: '', translation: '', text: '', image: '', audio: '' } : cardById(id);
    if (!c) { $m.innerHTML = `<p class="empty">Carta non trovata. <a href="#/carte">Torna alle carte</a></p>`; return; }
    const usedIn = isNew ? [] : DATA.modes.filter((m) => m.cards[c.id]);
    $m.innerHTML = `
      <a class="crumb" href="#/carte">${icon('arrow_back')}Carte</a>
      <div class="page-head"><h1>${isNew ? 'Nuova carta' : esc(c.name)}</h1>
        ${c.demo ? '<span class="badge demo">Dati dimostrativi: sostituiscili</span>' : ''}</div>
      <form class="split" id="f" novalidate>
        <div>
          <div class="panel form">
            <div class="grid-3">
              <div class="field"><label for="number">Numero</label><input id="number" name="number" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${esc(c.number)}" required></div>
              <div class="field" style="grid-column:span 2"><label for="name">Nome della carta</label><input id="name" name="name" type="text" maxlength="60" value="${esc(c.name)}" required></div>
            </div>
            <div class="field"><label for="copies">Copie presenti nella scatola</label><input id="copies" name="copies" type="number" min="1" max="99" value="${esc(c.copies)}" required style="max-width:140px">
              <p class="help">È il massimo che i giocatori possono selezionare in “Crea”. Nell’elenco Ascolta la carta compare comunque una sola volta.</p></div>
          </div>
          <div class="panel form">
            <h2>Frase parlante</h2>
            <div class="field"><label for="dialect">Frase in piacentino</label><textarea id="dialect" name="dialect" maxlength="300" rows="2">${esc(c.dialect)}</textarea></div>
            <div class="field"><label for="translation">Traduzione italiana</label><textarea id="translation" name="translation" maxlength="300" rows="2">${esc(c.translation)}</textarea></div>
            <div class="field"><label for="text">Testo della carta <span class="opt">(effetto o regola stampati sulla carta)</span></label><textarea id="text" name="text" maxlength="1500" rows="3">${esc(c.text || '')}</textarea>
              <p class="help">Nell’app compare sotto la frase, quando si apre la carta.</p></div>
            <div class="field"><span class="label">Audio</span>${uploadField('audio', c.audio)}
              <p class="help">MP3 o M4A consigliati, massimo 15 MB.</p></div>
          </div>
          <div class="panel form">
            <h2>Immagine</h2>
            <div class="field">${uploadField('image', c.image)}
              <p class="help">Carica la scansione o il file grafico della carta (PNG, JPG o WEBP). Viene ritagliata alle proporzioni impostate in “Testi e impostazioni”.</p></div>
            <details><summary class="muted" style="cursor:pointer;font-weight:700">Illustrazione segnaposto (usata se manca l’immagine)</summary>
              <div class="grid-2" style="margin-top:12px">
                <div class="field"><label for="color">Colore</label><input id="color" name="color" type="color" value="${esc(c.color || '#439626')}"></div>
                <div class="field"><label for="icon">Icona</label><input id="icon" name="icon" type="text" value="${esc(c.icon || '')}">
                  <p class="help">Nome di un’icona <a href="https://fonts.google.com/icons" target="_blank" rel="noopener">Material Symbols</a>, ad esempio “back_hand”.</p></div>
              </div></details>
          </div>
          ${usedIn.length ? `<div class="notice">${icon('info')}<span>Usata in ${usedIn.length} modalità: ${usedIn.map((m) => `<a href="#/modalita/${esc(m.id)}">${esc(m.title)}</a>`).join(', ')}.</span></div>` : ''}
          ${isNew ? '' : `<div class="panel" style="margin-top:16px"><div class="panel-head"><h2>FAQ di questa carta</h2><a class="btn secondary sm" href="#/faq/nuova?carta=${esc(c.id)}">${icon('add')}Nuova FAQ</a></div>
            ${(() => { const fq = DATA.faq.filter((f) => f.cardId === c.id); return fq.length
              ? fq.map((f) => `<p style="margin-top:6px"><a href="#/faq/${esc(f.id)}"><b>${esc(f.q)}</b></a> ${f.showInList === false ? '<span class="badge">Solo sulla carta</span>' : '<span class="badge">Anche nella lista FAQ</span>'}</p>`).join('')
              : '<p class="muted">Nessuna FAQ collegata. Quelle che crei compaiono nell’app sotto la carta.</p>'; })()}</div>`}
        </div>
        <aside class="sticky">
          <div class="panel"><div class="preview-card" id="preview"></div>
            <div class="row" style="margin-top:16px;flex-direction:column;align-items:stretch">
              <button class="btn" type="submit">${icon('save')}${isNew ? 'Crea la carta' : 'Salva le modifiche'}</button>
              ${!isNew ? `<a class="btn secondary" href="/#/ascolta/${esc(c.id)}" target="_blank" rel="noopener">${icon('open_in_new')}Vedi nell’app</a>
              <button class="btn danger" type="button" id="del">${icon('delete')}Elimina la carta</button>` : ''}
            </div></div>
        </aside>
      </form>`;
    const $f = document.getElementById('f');
    const values = () => Object.fromEntries(new FormData($f));
    const preview = () => { const v = values(); document.getElementById('preview').innerHTML = cardArt({ ...v, number: v.number || '?' }); };
    preview(); watchDirty($f);
    // Il numero accetta solo cifre (campo di testo, senza frecce su/giù).
    const $num = document.getElementById('number');
    $num.addEventListener('input', () => { const v = $num.value.replace(/\D/g, ''); if (v !== $num.value) $num.value = v; });
    $f.addEventListener('input', preview);
    bindUploads($f, preview);
    $f.onsubmit = async (e) => {
      e.preventDefault();
      const v = values();
      if (!v.name.trim()) return toast('Inserisci il nome della carta', true);
      const r = await act(e.submitter, () => (isNew ? api('POST', 'cards', v) : api('PUT', 'cards/' + c.id, v)), isNew ? 'Carta creata' : 'Modifiche salvate');
      if (r) { dirty = false; if (isNew) go('#/carte/' + r.id); else route(); }
    };
    document.getElementById('del')?.addEventListener('click', async (e) => {
      const msg = usedIn.length ? `La carta è usata in ${usedIn.length} modalità e verrà tolta anche da lì. Eliminarla definitivamente?` : 'Eliminare definitivamente questa carta?';
      if (!confirm(msg)) return;
      if (await act(e.currentTarget, () => api('DELETE', 'cards/' + c.id + (usedIn.length ? '?force=1' : '')), 'Carta eliminata')) { dirty = false; go('#/carte'); }
    });
  }

  /* ---------------- Carte: caricamento massivo ---------------- */
  // Lo stato resta in memoria finché la pagina del CMS è aperta, anche cambiando sezione.
  const IMPORT = { rows: [], seq: 0, queue: [], running: 0 };
  // Ridimensiona l'immagine nel browser prima di caricarla, così l'app resta leggera.
  function resizeImage(file, maxSide, type, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        cv.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Immagine non leggibile'))), type, quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Immagine non leggibile')); };
      img.src = url;
    });
  }
  const blobB64 = (blob) => readFileB64(blob);
  function guessNumber(name) { const m = String(name).match(/\d+/); return m ? Number(m[0]) : null; }
  function matchFor(row) { return row.number != null && row.number !== '' ? DATA.cards.find((c) => c.number === Number(row.number)) : null; }

  async function processRow(row) {
    try {
      row.status = 'upload'; drawImportRow(row);
      const forApp = await resizeImage(row.file, 1400, 'image/webp', 0.9);
      const appType = forApp.type || 'image/png';
      const up = await api('POST', 'upload', { name: row.file.name, type: appType, data: await blobB64(forApp) });
      row.image = up.url;
      const m = matchFor(row);
      row.action = m ? 'update' : 'create';
      if (m && !row.copies) row.copies = m.copies;
      row.status = 'ready';
    } catch (e) { row.status = 'error'; row.error = e.message; }
    drawImportRow(row); drawImportBar();
  }
  function pumpQueue() {
    while (IMPORT.running < 2 && IMPORT.queue.length) {
      const row = IMPORT.queue.shift(); IMPORT.running++;
      processRow(row).finally(() => { IMPORT.running--; pumpQueue(); });
    }
  }
  const STATUS_LBL = {
    wait: [icon('schedule'), 'In coda'], upload: [icon('progress_activity', 'spin'), 'Caricamento…'],
    ready: [icon('edit_note'), 'Da compilare'], error: [icon('error', 'fill'), 'Errore'], saved: [icon('task_alt', 'fill yes'), 'Salvata'],
  };
  function rowHtml(r) {
    const m = matchFor(r);
    const dup = r.number != null && r.number !== '' && IMPORT.rows.filter((x) => x.status !== 'saved' && x.action !== 'skip' && String(x.number) === String(r.number)).length > 1;
    const busy = ['wait', 'upload'].includes(r.status);
    const locked = busy || r.status === 'saved';
    const missCopies = r.action === 'create' && !(Number(r.copies) >= 1);
    return `<div class="imp-row ${r.status}" data-row="${r.key}">
      <div class="imp-thumb">${r.preview ? `<img src="${r.preview}" alt="">` : ''}</div>
      <div class="imp-body">
        <div class="row" style="justify-content:space-between">
          <span class="imp-status">${STATUS_LBL[r.status][0]}${STATUS_LBL[r.status][1]} <span class="muted small">· ${esc(r.file.name)}</span></span>
          <div class="row">
            ${r.status === 'error' ? `<button type="button" class="btn secondary sm" data-retry="${r.key}">${icon('refresh')}Riprova</button>` : ''}
            ${r.status !== 'saved' ? `<button type="button" class="btn ghost sm icon" data-drop="${r.key}" aria-label="Togli dall’elenco">${icon('close')}</button>` : ''}
          </div>
        </div>
        ${r.status === 'error' ? `<p class="notice err small">${icon('error')}${esc(r.error)}</p>` : ''}
        <fieldset ${locked ? 'disabled' : ''} class="imp-fields">
          <div class="imp-grid">
            <div class="field"><label>N.</label><input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-k="number" value="${esc(r.number ?? '')}"></div>
            <div class="field"><label>Nome</label><input type="text" maxlength="60" data-k="name" value="${esc(r.name || '')}"></div>
            <div class="field ${missCopies ? 'need' : ''}"><label>Copie nel mazzo</label><input type="number" min="1" max="99" data-k="copies" value="${esc(r.copies || '')}" placeholder="?"></div>
            <div class="field"><label>Azione</label><select data-k="action">
              <option value="create" ${r.action === 'create' ? 'selected' : ''}>Crea nuova carta</option>
              ${m ? `<option value="update" ${r.action === 'update' ? 'selected' : ''}>Aggiorna #${pad2(m.number)} ${esc(m.name)}</option>` : ''}
              <option value="skip" ${r.action === 'skip' ? 'selected' : ''}>Non importare</option></select></div>
          </div>
          <div class="imp-grid-3">
            <div class="field"><label>Frase in piacentino</label><textarea rows="2" maxlength="300" data-k="dialect">${esc(r.dialect || '')}</textarea></div>
            <div class="field"><label>Traduzione</label><textarea rows="2" maxlength="300" data-k="translation">${esc(r.translation || '')}</textarea></div>
            <div class="field"><label>Testo della carta</label><textarea rows="2" maxlength="1500" data-k="text">${esc(r.text || '')}</textarea></div>
          </div>
          ${dup ? `<p class="notice warn small">${icon('content_copy')}Ci sono più carte con il numero ${esc(r.number)} in questo caricamento.</p>` : ''}
          ${m && r.action === 'create' ? `<p class="notice warn small">${icon('warning')}Esiste già la carta #${pad2(m.number)} “${esc(m.name)}”: scegli “Aggiorna” per sostituirla.</p>` : ''}
        </fieldset>
      </div>
    </div>`;
  }
  function drawImportRow(r) {
    const el = document.querySelector(`[data-row="${r.key}"]`);
    if (el) el.outerHTML = rowHtml(r);
  }
  function drawImportBar() {
    const bar = document.getElementById('imp-bar'); if (!bar) return;
    const todo = IMPORT.rows.filter((r) => r.status === 'ready' && r.action !== 'skip');
    const busy = IMPORT.rows.filter((r) => ['wait', 'upload'].includes(r.status)).length;
    const miss = todo.filter((r) => r.action === 'create' && !(Number(r.copies) >= 1) || !String(r.name || '').trim() || r.number === '' || r.number == null).length;
    bar.innerHTML = `<span class="muted">${busy ? `${busy} in lavorazione · ` : ''}${todo.length} pronte${miss ? ` · <b style="color:var(--red)">${miss} da completare</b>` : ''}</span>
      <button class="btn" id="imp-save" ${todo.length && !busy ? '' : 'disabled'}>${icon('save')}Salva ${todo.length || ''} ${todo.length === 1 ? 'carta' : 'carte'}</button>`;
    document.getElementById('imp-save').onclick = saveImport;
    dirty = IMPORT.rows.some((r) => r.status !== 'saved');
  }
  async function saveImport(e) {
    const todo = IMPORT.rows.filter((r) => r.status === 'ready' && r.action !== 'skip');
    const bad = todo.filter((r) => !String(r.name || '').trim() || r.number === '' || r.number == null || (r.action === 'create' && !(Number(r.copies) >= 1)));
    if (bad.length) { toast(`Completa nome, numero e copie di ${bad.length} ${bad.length === 1 ? 'carta' : 'carte'}`, true); document.querySelector(`[data-row="${bad[0].key}"]`)?.scrollIntoView({ block: 'center' }); return; }
    const btn = e.currentTarget; btn.disabled = true;
    let ok = 0;
    for (const r of todo) {
      const fields = { number: r.number, name: r.name, dialect: r.dialect || '', translation: r.translation || '', text: r.text || '', image: r.image };
      try {
        if (r.action === 'update') {
          const c = matchFor(r);
          if (!c) throw new Error('La carta da aggiornare non esiste più');
          await api('PUT', 'cards/' + c.id, { ...c, ...fields, copies: Number(r.copies) || c.copies });
        } else await api('POST', 'cards', { ...fields, copies: Number(r.copies), color: '#439626', icon: 'style', audio: '' });
        r.status = 'saved'; ok++;
      } catch (er) { r.status = 'error'; r.error = er.message; }
      drawImportRow(r);
    }
    await reload().catch(() => {});
    IMPORT.rows.forEach((r) => r.status !== 'saved' && drawImportRow(r));
    drawImportBar();
    toast(`${ok} ${ok === 1 ? 'carta salvata' : 'carte salvate'}`, ok !== todo.length);
  }

  async function viewImport($m) {
    $m.innerHTML = `
      <a class="crumb" href="#/carte">${icon('arrow_back')}Carte</a>
      <div class="page-head"><div><h1>Caricamento massivo</h1>
        <p class="muted">Carica tutte le immagini delle carte insieme, poi compila per ognuna numero, nome, copie nel mazzo, frase, traduzione e testo. Se il nome del file contiene un numero (es. “carta-07.png”) viene usato come numero della carta.</p></div></div>
      <label class="drop" id="drop">
        <input type="file" id="files" accept="image/png,image/jpeg,image/webp" multiple hidden>
        ${icon('add_photo_alternate')}<b>Trascina qui le immagini delle carte</b><span class="muted">oppure clicca per sceglierle (PNG, JPG o WEBP)</span>
      </label>
      <div id="rows" class="imp-list"></div>
      <div class="imp-bar" id="imp-bar"></div>`;
    const $rows = document.getElementById('rows');
    $rows.innerHTML = IMPORT.rows.map(rowHtml).join('');
    drawImportBar();
    const addFiles = (files) => {
      const imgs = [...files].filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type));
      if (!imgs.length) return toast('Seleziona immagini PNG, JPG o WEBP', true);
      imgs.sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true }));
      for (const file of imgs) {
        const row = { key: 'r' + ++IMPORT.seq, file, preview: URL.createObjectURL(file), status: 'wait', number: guessNumber(file.name), name: '', dialect: '', translation: '', text: '', copies: '', action: 'create' };
        IMPORT.rows.push(row); IMPORT.queue.push(row);
        $rows.insertAdjacentHTML('beforeend', rowHtml(row));
      }
      drawImportBar(); pumpQueue();
    };
    document.getElementById('files').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
    const $drop = document.getElementById('drop');
    ['dragenter', 'dragover'].forEach((t) => $drop.addEventListener(t, (e) => { e.preventDefault(); $drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => $drop.addEventListener(t, (e) => { e.preventDefault(); $drop.classList.remove('over'); }));
    $drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
    const rowOf = (el) => IMPORT.rows.find((r) => r.key === el.closest('[data-row]')?.dataset.row);
    $rows.addEventListener('input', (e) => {
      const r = rowOf(e.target), k = e.target.dataset.k; if (!r || !k) return;
      if (k === 'number') e.target.value = e.target.value.replace(/\D/g, '');
      r[k] = k === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
      // Il numero aggiorna l'abbinamento con le carte esistenti quando si esce dal campo (evento change).
      if (k === 'copies') { const f = e.target.closest('.field'); f.classList.toggle('need', r.action === 'create' && !(Number(r.copies) >= 1)); }
      drawImportBar();
    });
    $rows.addEventListener('change', (e) => {
      const k = e.target.dataset.k, r = rowOf(e.target); if (!r) return;
      if (k === 'action') r.action = e.target.value;
      else if (k === 'number') { const m = matchFor(r); r.action = m ? 'update' : 'create'; if (m && !r.copies) r.copies = m.copies; }
      else return;
      drawImportRow(r); drawImportBar();
    });
    $rows.addEventListener('click', (e) => {
      const rt = e.target.closest('[data-retry]'), dp = e.target.closest('[data-drop]');
      if (rt) { const r = rowOf(rt); r.status = 'wait'; r.error = ''; drawImportRow(r); IMPORT.queue.push(r); pumpQueue(); }
      if (dp) { const r = rowOf(dp); if (r.status === 'upload') return toast('Attendi la fine del caricamento', true); IMPORT.rows.splice(IMPORT.rows.indexOf(r), 1); IMPORT.queue = IMPORT.queue.filter((x) => x !== r); dp.closest('[data-row]').remove(); drawImportBar(); }
    });
  }

  /* ---------------- Modalità ---------------- */
  function viewModes($m) {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const state = { filtro: params.get('filtro') || (DATA.modes.some((x) => x.status === 'pending') ? 'pending' : 'published'), q: params.get('q') || '' };
    const counts = { pending: 0, published: 0, rejected: 0, demo: 0 };
    DATA.modes.forEach((x) => { counts[x.status]++; if (x.source === 'demo') counts.demo++; });
    $m.innerHTML = `
      <div class="page-head"><div><h1>Modalità</h1><p class="muted">Proposte dei giocatori e modalità pubblicate in “Scopri”.</p></div>
        <a class="btn" href="#/modalita/nuova">${icon('add')}Nuova modalità</a></div>
      <div class="tabs" role="group" aria-label="Filtra">
        ${[['pending', 'In attesa'], ['published', 'Pubblicate'], ['rejected', 'Rifiutate'], ['tutte', 'Tutte'], ['demo', 'Di esempio']].map(([k, l]) =>
          `<button class="tab" data-f="${k}" aria-pressed="${state.filtro === k}">${l} <span class="badge">${k === 'tutte' ? DATA.modes.length : counts[k]}</span></button>`).join('')}
      </div>
      <div class="panel">
        <div class="panel-head"><div class="search-box">${icon('search')}<input type="search" id="q" placeholder="Cerca per nome, autore o descrizione" value="${esc(state.q)}"></div></div>
        <div class="table-wrap"><table><thead><tr><th>Modalità</th><th>Stato</th><th>Carte</th><th>Voto</th><th>Data</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
      </div>`;
    const draw = () => {
      const n = norm(state.q);
      const list = DATA.modes.filter((x) => (state.filtro === 'tutte' || (state.filtro === 'demo' ? x.source === 'demo' : x.status === state.filtro))
        && (!n || norm(x.title + ' ' + x.author + ' ' + x.description).includes(n)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      document.getElementById('rows').innerHTML = list.map((x) => `
        <tr class="clickable" data-href="#/modalita/${esc(x.id)}">
          <td><span class="title">${esc(x.title)}</span> ${x.source === 'demo' ? '<span class="badge demo">Esempio</span>' : ''}${x.source === 'busa' ? '<span class="badge">Team Busa</span>' : ''}
            <div class="muted small">di ${esc(x.author)}${x.email ? ' · ' + icon('mail') : ''}</div></td>
          <td>${statusBadge(x.status)}</td><td class="num">${modeTotal(x)}</td>
          <td class="num">${x.ratingCount ? `<span class="stars">★</span> ${fmtAvg(x.ratingSum, x.ratingCount)} <span class="muted">(${x.ratingCount})</span>` : '<span class="muted">—</span>'}</td>
          <td class="muted small">${fmtDate(x.createdAt)}</td><td style="text-align:right">${icon('chevron_right', 'muted')}</td>
        </tr>`).join('') || `<tr><td colspan="6" class="empty">Nessuna modalità in questo elenco.</td></tr>`;
      bindRows($m);
    };
    const sync = () => history.replaceState(null, '', '#/modalita?' + new URLSearchParams(Object.entries(state).filter(([, v]) => v)));
    draw();
    $m.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { state.filtro = b.dataset.f; $m.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-pressed', x === b)); sync(); draw(); });
    document.getElementById('q').addEventListener('input', (e) => { state.q = e.target.value; sync(); draw(); });
  }

  function viewMode($m, id) {
    const isNew = id === 'nuova';
    const m = isNew ? { title: '', author: 'Team Busa', email: '', players: '', description: '', rules: '', tried: '', cards: {}, status: 'published', note: '', ratingSum: 0, ratingCount: 0 } : DATA.modes.find((x) => x.id === id);
    if (!m) { $m.innerHTML = `<p class="empty">Modalità non trovata. <a href="#/modalita">Torna alle modalità</a></p>`; return; }
    const cards = { ...m.cards };
    const votes = isNew ? [] : DATA.votes.filter((v) => v.modeId === m.id).sort((a, b) => b.at.localeCompare(a.at));
    const PLAYERS = ['', '2', '2–3', '2–4', '3–4', '3–5', '3–6', '4–6', '5 o più'];
    if (m.players && !PLAYERS.includes(m.players)) PLAYERS.push(m.players);
    $m.innerHTML = `
      <a class="crumb" href="#/modalita">${icon('arrow_back')}Modalità</a>
      <div class="page-head"><div><h1>${isNew ? 'Nuova modalità' : esc(m.title)}</h1>
        ${isNew ? '<p class="muted">Creata dal team Busa: puoi pubblicarla subito.</p>' : `<p class="muted">${statusBadge(m.status)} · ${m.source === 'utente' ? 'Proposta da un giocatore' : m.source === 'demo' ? 'Modalità di esempio' : 'Creata dal team Busa'} il ${fmtDate(m.createdAt)}</p>`}</div></div>
      ${!isNew && m.status === 'pending' ? `<div class="notice warn" style="margin-bottom:16px">${icon('pending_actions')}<span>Questa proposta non è visibile nell’app. Controllala, correggi eventuali errori e poi pubblicala o rifiutala.</span></div>` : ''}
      <form class="split" id="f" novalidate>
        <div>
          <div class="panel form">
            <div class="grid-2">
              <div class="field"><label for="title">Nome della modalità</label><input id="title" name="title" type="text" maxlength="60" value="${esc(m.title)}" required></div>
              <div class="field"><label for="author">Nickname pubblico</label><input id="author" name="author" type="text" maxlength="30" value="${esc(m.author)}"></div>
            </div>
            <div class="field"><label for="description">Descrizione</label><textarea id="description" name="description" maxlength="1000" rows="4">${esc(m.description)}</textarea></div>
            <div class="field"><label for="rules">Regole aggiuntive <span class="opt">(facoltative)</span></label><textarea id="rules" name="rules" maxlength="1500" rows="3">${esc(m.rules)}</textarea></div>
            <div class="grid-2">
              <div class="field"><label for="players">Giocatori consigliati</label><select id="players" name="players">${PLAYERS.map((p) => `<option value="${esc(p)}" ${p === m.players ? 'selected' : ''}>${p || 'Non specificato'}</option>`).join('')}</select></div>
              <div class="field"><label for="tried">L’ha già provata?</label><select id="tried" name="tried">${['', 'Non ancora', 'Una volta', 'Più volte'].map((p) => `<option value="${p}" ${p === m.tried ? 'selected' : ''}>${p || 'Non indicato'}</option>`).join('')}</select></div>
            </div>
          </div>
          <div class="panel">
            <div class="panel-head"><h2>Carte Busa</h2><span class="badge" id="tot"></span></div>
            <div class="qty-grid" id="qty"></div>
          </div>
          ${isNew ? '' : `<div class="panel">
            <div class="panel-head"><h2>Voti</h2><span class="muted">${m.ratingCount ? `Media ${fmtAvg(m.ratingSum, m.ratingCount)} su 5 · ${m.ratingCount} voti` : 'Ancora nessun voto'}</span></div>
            ${votes.length ? `<div class="table-wrap"><table><thead><tr><th>Voto</th><th>Dispositivo</th><th>Data</th><th></th></tr></thead><tbody>
              ${votes.map((v) => `<tr><td><span class="stars">${'★'.repeat(v.value)}</span><span class="muted">${'★'.repeat(5 - v.value)}</span></td>
                <td class="muted small">${v.demo ? '<span class="badge demo">Demo</span>' : esc(v.deviceId.slice(0, 10)) + '…'}</td><td class="muted small">${fmtDate(v.at)}</td>
                <td style="text-align:right"><button type="button" class="btn danger sm icon" data-del-vote="${esc(v.id)}" aria-label="Elimina voto">${icon('delete')}</button></td></tr>`).join('')}
              </tbody></table></div>
              <div class="row end" style="margin-top:12px"><button type="button" class="btn danger sm" id="clear-votes">${icon('delete_sweep')}Azzera tutti i voti</button></div>` : '<p class="muted">Nessun voto da mostrare.</p>'}
          </div>`}
        </div>
        <aside class="sticky">
          <div class="panel form">
            <div class="field"><label for="status">Stato</label>
              <select id="status" name="status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === m.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
              <p class="help">Solo le modalità “Pubblicate” compaiono in Scopri.</p></div>
            ${!isNew && m.status === 'pending' ? `<button type="button" class="btn" id="approve">${icon('check_circle')}Approva e pubblica</button>
              <button type="button" class="btn danger" id="reject">${icon('block')}Rifiuta</button><hr style="margin:4px 0">` : ''}
            <button class="btn ${!isNew && m.status === 'pending' ? 'secondary' : ''}" type="submit">${icon('save')}${isNew ? 'Crea la modalità' : 'Salva le modifiche'}</button>
            ${!isNew && m.status === 'published' ? `<a class="btn secondary" href="/#/scopri/${esc(m.id)}" target="_blank" rel="noopener">${icon('open_in_new')}Vedi nell’app</a>` : ''}
          </div>
          <div class="panel form">
            <div class="field"><span class="label">Copertina</span>${uploadField('image', m.cover, { name: 'cover', empty: 'Nessuna copertina: si usa quella automatica colorata con il camioncino' })}
              ${m.cover ? `<img src="${esc(asset(m.cover))}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;margin-top:8px">` : ''}
              <p class="help">Quadrata, 1024 × 1024 px · JPG, PNG o WEBP.</p></div>
          </div>
          <div class="panel form">
            <div class="field"><label for="email">Email privata ${icon('lock')}</label><input id="email" name="email" type="email" value="${esc(m.email)}" placeholder="Non indicata">
              <p class="help">Mai pubblicata.${m.email ? ` <a href="mailto:${esc(m.email)}?subject=${encodeURIComponent('La tua modalità MÖVAT! “' + m.title + '”')}">Scrivi al giocatore</a>` : ''}</p></div>
            <div class="field"><label for="note">Note interne</label><textarea id="note" name="note" rows="3" placeholder="Visibili solo nel CMS">${esc(m.note)}</textarea></div>
            ${!isNew ? `<button type="button" class="btn danger" id="del">${icon('delete')}Elimina la modalità</button>` : ''}
          </div>
        </aside>
      </form>`;
    const drawQty = () => {
      document.getElementById('qty').innerHTML = sortedCards().map((c) => {
        const q = cards[c.id] || 0;
        return `<div class="qty-item ${q ? 'on' : ''}"><div class="thumb" style="width:30px">${cardArt(c)}</div>
          <div class="nm"><small>#${pad2(c.number)} · max ${c.copies}</small>${esc(c.name)}</div>
          <div class="stepper"><button type="button" data-q="${esc(c.id)}" data-d="-1" ${q ? '' : 'disabled'} aria-label="Togli">${icon('remove')}</button>
          <output>${q}</output><button type="button" data-q="${esc(c.id)}" data-d="1" ${q >= c.copies ? 'disabled' : ''} aria-label="Aggiungi">${icon('add')}</button></div></div>`;
      }).join('');
      document.getElementById('tot').textContent = Object.values(cards).reduce((a, b) => a + b, 0) + ' carte';
    };
    drawQty();
    const $f = document.getElementById('f'); watchDirty($f);
    bindUploads($f);
    document.getElementById('qty').addEventListener('click', (e) => {
      const b = e.target.closest('[data-q]'); if (!b) return;
      const c = cardById(b.dataset.q);
      const q = Math.max(0, Math.min(c.copies, (cards[c.id] || 0) + Number(b.dataset.d)));
      if (q) cards[c.id] = q; else delete cards[c.id];
      dirty = true; drawQty();
    });
    const payload = (extra = {}) => ({ ...Object.fromEntries(new FormData($f)), cards, ...extra });
    const saveWith = async (btn, extra, msg) => {
      const v = payload(extra);
      if (!v.title.trim()) { toast('Inserisci il nome della modalità', true); return; }
      const r = await act(btn, () => (isNew ? api('POST', 'modes', v) : api('PUT', 'modes/' + m.id, v)), msg);
      if (r) { dirty = false; if (isNew) go('#/modalita/' + r.id); else route(); }
    };
    $f.onsubmit = (e) => { e.preventDefault(); saveWith(e.submitter, {}, isNew ? 'Modalità creata' : 'Modifiche salvate'); };
    document.getElementById('approve')?.addEventListener('click', (e) => saveWith(e.currentTarget, { status: 'published' }, 'Modalità pubblicata in Scopri'));
    document.getElementById('reject')?.addEventListener('click', (e) => { if (confirm('Rifiutare questa proposta? Non comparirà nell’app.')) saveWith(e.currentTarget, { status: 'rejected' }, 'Proposta rifiutata'); });
    document.getElementById('del')?.addEventListener('click', async (e) => {
      if (!confirm('Eliminare definitivamente questa modalità e i suoi voti?')) return;
      if (await act(e.currentTarget, () => api('DELETE', 'modes/' + m.id), 'Modalità eliminata')) { dirty = false; go('#/modalita'); }
    });
    $m.querySelectorAll('[data-del-vote]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Eliminare questo voto?')) return;
      if (await act(b, () => api('DELETE', 'votes/' + b.dataset.delVote), 'Voto eliminato')) route();
    }));
    document.getElementById('clear-votes')?.addEventListener('click', async (e) => {
      if (!confirm(`Eliminare tutti i ${votes.length} voti di questa modalità?`)) return;
      if (await act(e.currentTarget, () => api('POST', 'votes/clear', { modeId: m.id }), 'Voti azzerati')) route();
    });
  }

  /* ---------------- Voti ---------------- */
  function viewVotes($m) {
    const demo = DATA.votes.filter((v) => v.demo).length;
    const rows = DATA.modes.filter((x) => x.ratingCount || x.status === 'published').sort((a, b) => b.ratingCount - a.ratingCount);
    const recent = [...DATA.votes].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
    const title = (id) => DATA.modes.find((x) => x.id === id)?.title || id;
    $m.innerHTML = `
      <div class="page-head"><div><h1>Voti</h1><p class="muted">Voti anonimi dati dai giocatori alle modalità pubblicate. Ogni dispositivo ha un solo voto per modalità e può modificarlo.</p></div>
        ${demo ? `<button class="btn danger" id="clear-demo">${icon('delete_sweep')}Elimina i ${demo} voti dimostrativi</button>` : ''}</div>
      <div class="panel"><div class="panel-head"><h2>Per modalità</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Modalità</th><th>Media</th><th>Voti</th><th>Di cui demo</th><th></th></tr></thead><tbody>
        ${rows.map((x) => `<tr class="clickable" data-href="#/modalita/${esc(x.id)}"><td><span class="title">${esc(x.title)}</span> ${statusBadge(x.status)}</td>
          <td class="num">${x.ratingCount ? `<span class="stars">★</span> ${fmtAvg(x.ratingSum, x.ratingCount)}` : '—'}</td><td class="num">${x.ratingCount}</td>
          <td class="num">${DATA.votes.filter((v) => v.modeId === x.id && v.demo).length}</td><td style="text-align:right">${icon('chevron_right', 'muted')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Ancora nessun voto.</td></tr>'}
        </tbody></table></div></div>
      <div class="panel"><div class="panel-head"><h2>Ultimi voti</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Modalità</th><th>Voto</th><th>Data</th><th></th></tr></thead><tbody>
        ${recent.map((v) => `<tr><td>${esc(title(v.modeId))} ${v.demo ? '<span class="badge demo">Demo</span>' : ''}</td><td><span class="stars">${'★'.repeat(v.value)}</span></td>
          <td class="muted small">${fmtDate(v.at)}</td><td style="text-align:right"><button class="btn danger sm icon" data-del-vote="${esc(v.id)}" aria-label="Elimina voto">${icon('delete')}</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Ancora nessun voto.</td></tr>'}
        </tbody></table></div></div>`;
    bindRows($m);
    document.getElementById('clear-demo')?.addEventListener('click', async (e) => {
      if (!confirm('Eliminare tutti i voti dimostrativi? Resteranno solo quelli veri dei giocatori.')) return;
      if (await act(e.currentTarget, () => api('POST', 'votes/clear', { demoOnly: true }), 'Voti dimostrativi eliminati')) route();
    });
    $m.querySelectorAll('[data-del-vote]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Eliminare questo voto?')) return;
      if (await act(b, () => api('DELETE', 'votes/' + b.dataset.delVote), 'Voto eliminato')) route();
    }));
  }

  /* ---------------- FAQ ---------------- */
  function viewFaq($m) {
    const faq = [...DATA.faq].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    $m.innerHTML = `
      <div class="page-head"><div><h1>FAQ</h1><p class="muted">Domande e risposte mostrate nella sezione “FAQ” dell’app.</p></div>
        <a class="btn" href="#/faq/nuova">${icon('add')}Nuova domanda</a></div>
      <div class="panel"><div class="panel-head"><h2>Domande</h2><span class="muted small">Usa le frecce per cambiare l’ordine.</span></div>
        <div class="table-wrap"><table><thead><tr><th>Domanda</th><th>Categoria</th><th>Carta</th><th>Ordine</th></tr></thead><tbody>
        ${faq.map((f, i) => `<tr><td><a href="#/faq/${esc(f.id)}" class="title" style="text-decoration:none;color:inherit">${esc(f.q)}</a> ${f.demo || /segnaposto/i.test(f.q) ? '<span class="badge demo">Segnaposto</span>' : ''} ${f.cardId && f.showInList === false ? `<span class="badge" title="Non compare nella lista FAQ">${icon('style')}Solo sulla carta</span>` : ''}</td>
          <td><span class="badge">${esc(f.category)}</span></td><td class="small">${f.cardId ? esc(cardById(f.cardId)?.name || '') : '<span class="muted">—</span>'}</td>
          <td><div class="row" style="flex-wrap:nowrap"><button class="btn secondary sm icon" data-move="${i}" data-d="-1" ${i ? '' : 'disabled'} aria-label="Sposta su">${icon('arrow_upward')}</button>
            <button class="btn secondary sm icon" data-move="${i}" data-d="1" ${i < faq.length - 1 ? '' : 'disabled'} aria-label="Sposta giù">${icon('arrow_downward')}</button>
            <a class="btn ghost sm icon" href="#/faq/${esc(f.id)}" aria-label="Modifica">${icon('edit')}</a></div></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nessuna domanda.</td></tr>'}
        </tbody></table></div></div>
      <div class="panel"><div class="panel-head"><h2>Categorie</h2><button class="btn secondary sm" id="add-cat">${icon('add')}Aggiungi</button></div>
        <form id="cats" class="list-edit"></form>
        <div class="row end" style="margin-top:12px"><button class="btn" id="save-cats">${icon('save')}Salva le categorie</button></div>
        <p class="help muted small" style="margin-top:8px">Rinominando una categoria, le domande collegate vengono spostate automaticamente. Eliminandola, finiscono nella prima categoria.</p>
      </div>`;
    $m.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', async () => {
      const i = Number(b.dataset.move), j = i + Number(b.dataset.d);
      [faq[i], faq[j]] = [faq[j], faq[i]];
      if (await act(b, () => api('POST', 'faq-order', { ids: faq.map((f) => f.id) }))) route();
    }));
    let cats = DATA.faqCategories.map((c) => ({ orig: c, name: c }));
    const drawCats = () => {
      document.getElementById('cats').innerHTML = cats.map((c, i) => `<div class="row" style="flex-wrap:nowrap">
        <input type="text" data-cat="${i}" value="${esc(c.name)}" maxlength="40" aria-label="Nome categoria">
        <span class="badge" style="min-width:70px">${DATA.faq.filter((f) => f.category === c.orig).length} dom.</span>
        <button type="button" class="btn danger sm icon" data-rm="${i}" aria-label="Elimina categoria" ${cats.length > 1 ? '' : 'disabled'}>${icon('delete')}</button></div>`).join('');
    };
    drawCats();
    document.getElementById('cats').addEventListener('input', (e) => { if (e.target.dataset.cat) { cats[e.target.dataset.cat].name = e.target.value; dirty = true; } });
    document.getElementById('cats').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { cats.splice(Number(b.dataset.rm), 1); dirty = true; drawCats(); } });
    document.getElementById('add-cat').onclick = () => { cats.push({ orig: null, name: '' }); drawCats(); document.querySelector(`[data-cat="${cats.length - 1}"]`).focus(); };
    document.getElementById('save-cats').onclick = async (e) => {
      const renames = Object.fromEntries(cats.filter((c) => c.orig && c.orig !== c.name.trim()).map((c) => [c.orig, c.name.trim()]));
      if (await act(e.currentTarget, () => api('PUT', 'faq-categories', { categories: cats.map((c) => c.name), renames }), 'Categorie salvate')) { dirty = false; route(); }
    };
  }

  function viewFaqItem($m, id) {
    const isNew = id === 'nuova';
    const f = isNew ? { q: '', a: [], category: DATA.faqCategories[0], cardId: new URLSearchParams(location.hash.split('?')[1] || '').get('carta') || '', showInList: true, actionLabel: '', actionHref: '' } : DATA.faq.find((x) => x.id === id);
    if (!f) { $m.innerHTML = `<p class="empty">Domanda non trovata. <a href="#/faq">Torna alle FAQ</a></p>`; return; }
    const LINKS = [['', 'Nessun collegamento'], ['#/ascolta', 'Guarda'], ['#/scopri', 'Scopri'], ['#/crea', 'Crea'], ['#/faq', 'FAQ']];
    const customLink = f.actionHref && !LINKS.some(([h]) => h === f.actionHref);
    $m.innerHTML = `
      <a class="crumb" href="#/faq">${icon('arrow_back')}FAQ</a>
      <div class="page-head"><h1>${isNew ? 'Nuova domanda' : 'Modifica domanda'}</h1></div>
      <form class="panel form" id="f" novalidate style="max-width:760px">
        <div class="field"><label for="q">Domanda</label><input id="q" name="q" type="text" maxlength="300" value="${esc(f.q)}" required></div>
        <div class="field"><label for="a">Risposta</label><textarea id="a" name="a" rows="7">${esc(f.a.join('\n\n'))}</textarea>
          <p class="help">Lascia una riga vuota per iniziare un nuovo paragrafo. Meglio paragrafi brevi, da leggere durante la partita.</p></div>
        <div class="grid-2">
          <div class="field"><label for="category">Categoria</label><select id="category" name="category">${DATA.faqCategories.map((c) => `<option ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
          <div class="field"><label for="cardId">Carta citata <span class="opt">(facoltativa)</span></label><select id="cardId" name="cardId"><option value="">Nessuna</option>
            ${sortedCards().map((c) => `<option value="${esc(c.id)}" ${c.id === f.cardId ? 'selected' : ''}>#${pad2(c.number)} ${esc(c.name)}</option>`).join('')}</select>
            <p class="help">La risposta compare anche quando si apre la carta nell’app.</p></div>
        </div>
        <fieldset class="field" id="vis" ${f.cardId ? '' : 'hidden'} style="border:0;padding:0;margin:0">
          <legend class="label">Dove mostrarla</legend>
          <label class="check"><input type="radio" name="showInList" value="true" ${f.showInList !== false ? 'checked' : ''}>Nella lista FAQ e sulla carta</label>
          <label class="check" style="margin-top:6px"><input type="radio" name="showInList" value="false" ${f.showInList === false ? 'checked' : ''}>Solo sulla carta</label>
        </fieldset>
        <div class="grid-2">
          <div class="field"><label for="actionLabel">Pulsante <span class="opt">(facoltativo)</span></label><input id="actionLabel" name="actionLabel" type="text" maxlength="40" value="${esc(f.actionLabel)}" placeholder="Es. Vai a Crea"></div>
          <div class="field"><label for="actionHref">Porta a</label><select id="actionHref" name="actionHref">
            ${LINKS.map(([h, l]) => `<option value="${h}" ${h === (f.actionHref || '') ? 'selected' : ''}>${l}</option>`).join('')}
            ${customLink ? `<option value="${esc(f.actionHref)}" selected>${esc(f.actionHref)}</option>` : ''}</select></div>
        </div>
        <div class="row">
          <button class="btn" type="submit">${icon('save')}${isNew ? 'Crea la domanda' : 'Salva le modifiche'}</button>
          ${isNew ? '' : `<a class="btn secondary" href="/#/faq?open=${esc(f.id)}" target="_blank" rel="noopener">${icon('open_in_new')}Vedi nell’app</a><span class="spacer"></span>
          <button class="btn danger" type="button" id="del">${icon('delete')}Elimina</button>`}
        </div>
      </form>`;
    const $f = document.getElementById('f'); watchDirty($f);
    document.getElementById('cardId').addEventListener('change', (e) => { document.getElementById('vis').hidden = !e.target.value; });
    $f.onsubmit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData($f));
      v.showInList = v.showInList !== 'false';
      if (!v.q.trim() || !v.a.trim()) return toast('Domanda e risposta sono obbligatorie', true);
      if (v.actionHref && !v.actionLabel.trim()) return toast('Scrivi il testo del pulsante oppure togli il collegamento', true);
      const r = await act(e.submitter, () => (isNew ? api('POST', 'faq', v) : api('PUT', 'faq/' + f.id, v)), isNew ? 'Domanda creata' : 'Modifiche salvate');
      if (r) { dirty = false; go('#/faq'); }
    };
    document.getElementById('del')?.addEventListener('click', async (e) => {
      if (!confirm('Eliminare questa domanda?')) return;
      if (await act(e.currentTarget, () => api('DELETE', 'faq/' + f.id), 'Domanda eliminata')) { dirty = false; go('#/faq'); }
    });
  }

  /* ---------------- Testi e impostazioni ---------------- */
  function viewSettings($m) {
    const s = DATA.settings;
    const RATIOS = [['63x88', 'Poker 63 × 88 mm', 63 / 88], ['57x89', 'Bridge 57 × 89 mm', 57 / 89], ['70x120', 'Tarocco 70 × 120 mm', 70 / 120], ['1x1', 'Quadrata', 1]];
    const curRatio = RATIOS.find(([, , r]) => Math.abs(r - s.cardRatio) < 0.002);
    let privacy = (s.privacy || []).map((p) => ({ ...p }));
    $m.innerHTML = `
      <div class="page-head"><div><h1>Testi e impostazioni</h1><p class="muted">Testi generali dell’app, informativa privacy, notifiche e accesso al CMS.</p></div></div>
      <form class="panel form" id="general" novalidate>
        <h2>Testi generali</h2>
        <div class="field"><label for="welcome">Frase di benvenuto in Home</label><input id="welcome" name="welcome" type="text" maxlength="80" value="${esc(s.welcome)}"></div>
        <div class="field"><span class="label">Logo Busa (in fondo alla Home)</span>${uploadField('image', s.busaLogo, { name: 'busaLogo', empty: 'Nessun logo: si usa la scritta “busa” segnaposto' })}
          <p class="help">PNG con sfondo trasparente consigliato, circa 600 px di larghezza. Accettati anche JPG e WEBP.</p></div>
        <div class="field"><label for="footerText">Testo del footer</label><input id="footerText" name="footerText" type="text" maxlength="200" value="${esc(s.footerText)}"></div>
        <div class="field"><label for="ratio">Formato delle carte</label>
          <div class="row"><select id="ratio" style="max-width:260px">${RATIOS.map(([k, l]) => `<option value="${k}" ${curRatio?.[0] === k ? 'selected' : ''}>${l}</option>`).join('')}<option value="custom" ${curRatio ? '' : 'selected'}>Personalizzato…</option></select>
            <span id="custom" ${curRatio ? 'hidden' : ''}><input type="number" id="rw" min="10" max="300" style="width:90px" placeholder="larg."> × <input type="number" id="rh" min="10" max="300" style="width:90px" placeholder="alt."> mm</span></div>
          <p class="help">Proporzioni usate per mostrare le immagini delle carte.</p></div>
        <div class="field"><label for="notifyEmails">Email per le notifiche delle nuove proposte</label><input id="notifyEmails" name="notifyEmails" type="text" value="${esc(s.notifyEmails)}" placeholder="team@busa.it, altro@busa.it">
          <p class="help">Separale con una virgola. Le email partono solo se sul server è configurato l’invio (vedi la guida).</p></div>
        <div class="row"><button class="btn" type="submit">${icon('save')}Salva</button></div>
      </form>
      <form class="panel form" id="privacy" novalidate>
        <div class="panel-head" style="margin:0"><h2>Informativa privacy</h2><a class="btn secondary sm" href="/#/privacy" target="_blank" rel="noopener">${icon('open_in_new')}Vedi nell’app</a></div>
        <div class="list-edit" id="psec"></div>
        <div class="row"><button type="button" class="btn secondary sm" id="add-sec">${icon('add')}Aggiungi sezione</button></div>
        <label class="check"><input type="checkbox" id="placeholder" ${s.privacyIsPlaceholder ? 'checked' : ''}>Mostra l’avviso “testo segnaposto” nell’app</label>
        <div class="row"><button class="btn" type="submit">${icon('save')}Salva l’informativa</button></div>
      </form>
      <form class="panel form" id="pw" novalidate>
        <h2>Accesso al CMS</h2>
        ${ME.passwordFromEnv ? `<p class="notice">${icon('info')}Utente e password sono impostati nelle variabili d’ambiente del server (ADMIN_USER e ADMIN_PASSWORD): per cambiarli modifica lì.</p>` : `
        <div class="grid-3">
          <div class="field"><label for="user">Utente</label><input id="user" name="user" type="text" value="${esc(ME.user)}" autocomplete="username"></div>
          <div class="field"><label for="current">Password attuale</label><input id="current" name="current" type="password" autocomplete="current-password"></div>
          <div class="field"><label for="next">Nuova password</label><input id="next" name="next" type="password" minlength="10" autocomplete="new-password"><p class="help">Almeno 10 caratteri.</p></div>
        </div>
        <div class="row"><button class="btn" type="submit">${icon('key')}Aggiorna l’accesso</button></div>`}
      </form>`;
    watchDirty(document.getElementById('general')); bindUploads(document.getElementById('general')); document.getElementById('privacy').addEventListener('input', () => { dirty = true; });
    const $ratio = document.getElementById('ratio');
    $ratio.onchange = () => { document.getElementById('custom').hidden = $ratio.value !== 'custom'; dirty = true; };
    document.getElementById('general').onsubmit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target));
      if ($ratio.value === 'custom') {
        const w = Number(document.getElementById('rw').value), h = Number(document.getElementById('rh').value);
        if (w && h) v.cardRatio = w / h;
      } else v.cardRatio = RATIOS.find(([k]) => k === $ratio.value)[2];
      if (await act(e.submitter, () => api('PUT', 'settings', v), 'Impostazioni salvate')) { dirty = false; route(); }
    };
    const drawP = () => {
      document.getElementById('psec').innerHTML = privacy.map((p, i) => `<div class="item">
        <div class="row" style="flex-wrap:nowrap"><input type="text" data-p="${i}" data-k="title" value="${esc(p.title)}" placeholder="Titolo della sezione">
          <button type="button" class="btn secondary sm icon" data-pm="${i}" data-d="-1" ${i ? '' : 'disabled'} aria-label="Sposta su">${icon('arrow_upward')}</button>
          <button type="button" class="btn secondary sm icon" data-pm="${i}" data-d="1" ${i < privacy.length - 1 ? '' : 'disabled'} aria-label="Sposta giù">${icon('arrow_downward')}</button>
          <button type="button" class="btn danger sm icon" data-prm="${i}" aria-label="Elimina sezione">${icon('delete')}</button></div>
        <textarea data-p="${i}" data-k="text" rows="4" placeholder="Testo (riga vuota = nuovo paragrafo)">${esc(p.text)}</textarea></div>`).join('') || '<p class="muted">Nessuna sezione.</p>';
    };
    drawP();
    const $ps = document.getElementById('psec');
    $ps.addEventListener('input', (e) => { const t = e.target; if (t.dataset.p) privacy[t.dataset.p][t.dataset.k] = t.value; });
    $ps.addEventListener('click', (e) => {
      const mv = e.target.closest('[data-pm]'), rm = e.target.closest('[data-prm]');
      if (mv) { const i = Number(mv.dataset.pm), j = i + Number(mv.dataset.d); [privacy[i], privacy[j]] = [privacy[j], privacy[i]]; drawP(); dirty = true; }
      if (rm && confirm('Eliminare questa sezione?')) { privacy.splice(Number(rm.dataset.prm), 1); drawP(); dirty = true; }
    });
    document.getElementById('add-sec').onclick = () => { privacy.push({ title: '', text: '' }); drawP(); };
    document.getElementById('privacy').onsubmit = async (e) => {
      e.preventDefault();
      if (await act(e.submitter, () => api('PUT', 'settings', { privacy, privacyIsPlaceholder: document.getElementById('placeholder').checked }), 'Informativa salvata')) { dirty = false; route(); }
    };
    document.getElementById('pw').onsubmit = async (e) => {
      e.preventDefault(); if (ME.passwordFromEnv) return;
      const v = Object.fromEntries(new FormData(e.target));
      const r = await act(e.submitter, () => api('PUT', 'password', v), 'Accesso aggiornato');
      if (r) { ME.user = r.user || v.user; route(); }
    };
  }

  /* ---------------- Backup ---------------- */
  function viewBackup($m) {
    $m.innerHTML = `
      <div class="page-head"><div><h1>Backup</h1><p class="muted">Scarica una copia di tutti i contenuti o ripristinane una.</p></div></div>
      <div class="grid-2">
        <div class="panel form"><h2>Scarica un backup</h2>
          <p>Un file JSON con carte, modalità (anche quelle in attesa, con le email), voti, FAQ e testi. Le immagini e gli audio restano nella cartella <code>data/uploads</code> del server.</p>
          <div class="row"><a class="btn" href="/api/admin/export" download>${icon('download')}Scarica il backup</a></div></div>
        <form class="panel form" id="imp"><h2>Ripristina un backup</h2>
          <p class="notice warn">${icon('warning')}<span>Sostituisce <b>tutti</b> i contenuti attuali. Prima del ripristino il server salva comunque una copia dei dati correnti.</span></p>
          <input type="file" id="file" accept="application/json,.json" required>
          <div class="row"><button class="btn danger solid" type="submit">${icon('restore')}Ripristina</button></div></form>
      </div>`;
    document.getElementById('imp').onsubmit = async (e) => {
      e.preventDefault();
      const file = document.getElementById('file').files[0]; if (!file) return toast('Scegli un file di backup', true);
      let json; try { json = JSON.parse(await file.text()); } catch { return toast('Il file non è un backup valido', true); }
      if (!confirm('Sostituire tutti i contenuti con quelli del backup?')) return;
      if (await act(e.submitter, () => api('POST', 'import', json), 'Backup ripristinato')) go('#/');
    };
  }

  route();
})();
