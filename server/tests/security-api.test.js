// Verifiche delle protezioni pubbliche di MÖVAT! (server reale + Siteverify finto + outbox email).
// Uso: node server/tests/security-api.test.js   (porte 8899 e 8901, dati in una cartella temporanea, nessuna dipendenza)
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const S = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'movat-test-'));
let pass = 0, fail = 0;
const results = [];
function check(name, ok, info = '') { (ok ? pass++ : fail++); results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }

// --- Siteverify finto: "ok-<action>" valido per quell'azione; "host-<action>" valido ma da un altro hostname; "expired" scaduto.
const verifyCalls = [];
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const b = JSON.parse(body); verifyCalls.push(b);
    let out = { success: false, 'error-codes': ['invalid-input-response'] };
    let m;
    if (b.secret !== 'test-secret') out = { success: false, 'error-codes': ['invalid-input-secret'] };
    else if ((m = /^ok-(\w+)-\d+$/.exec(b.response))) out = { success: true, action: m[1], hostname: 'movat.test', challenge_ts: new Date().toISOString() };
    else if ((m = /^host-(\w+)-\d+$/.exec(b.response))) out = { success: true, action: m[1], hostname: 'evil.example', challenge_ts: new Date().toISOString() };
    else if (b.response === 'expired') out = { success: false, 'error-codes': ['timeout-or-duplicate'] };
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
  });
});
let tokN = 0;
const tok = (action) => `ok-${action}-${++tokN}`;

function startServer(port, dir, extraEnv = {}) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const env = { ...process.env, PORT: String(port), DATA_DIR: dir, ADMIN_USER: 'admin', ADMIN_PASSWORD: 'testpass123', ...extraEnv };
  const p = spawn('node', [path.join(ROOT, 'server/server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
  p.getLog = () => log;
  return new Promise((resolve) => {
    const t = setInterval(async () => { try { await fetch(`http://localhost:${port}/api/content`); clearInterval(t); resolve(p); } catch { /* attende */ } }, 100);
  });
}

class Client {
  constructor(base) { this.base = base; this.cookies = {}; }
  cookieHeader() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(method, url, body, headers = {}) {
    const h = { Origin: this.base, ...headers };
    if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
    if (Object.keys(this.cookies).length) h.Cookie = this.cookieHeader();
    const r = await fetch(this.base + url, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), redirect: 'manual' });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    this.lastSetCookie = sc;
    for (const c of sc) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) this.cookies[kv.slice(0, i)] = v; else delete this.cookies[kv.slice(0, i)]; }
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, json, text, headers: r.headers };
  }
  post(url, body, headers = {}) { return this.req('POST', url, body, { 'X-Movat-App': '1', ...headers }); }
  get(url) { return this.req('GET', url); }
}
async function adminClient(base) {
  const a = new Client(base);
  const r = await a.req('POST', '/api/admin/login', { user: 'admin', password: 'testpass123' }, { 'X-Movat-Cms': '1' });
  if (r.status !== 200) throw new Error('login ' + r.status + ' ' + r.text);
  a.adm = (m, u, b) => a.req(m, '/api/admin/' + u, b, { 'X-Movat-Cms': '1' });
  return a;
}
const outbox = (dir) => { try { return fs.readFileSync(path.join(dir, 'outbox.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const modeProposal = (cards, extra = {}) => ({ title: 'Prova sicurezza ' + Math.random().toString(36).slice(2, 7), description: 'Descrizione abbastanza lunga per passare la validazione.', nickname: 'Tester', cards, consent: true, ...extra });

(async () => {
  await new Promise((r) => mock.listen(8899, r));
  const DIR = path.join(S, 'data-main');
  const PORT = 8901, B = `http://localhost:${PORT}`;
  const srv = await startServer(PORT, DIR, {
    TURNSTILE_SITE_KEY: 'test-site', TURNSTILE_SECRET_KEY: 'test-secret', TURNSTILE_VERIFY_URL: 'http://localhost:8899/', TURNSTILE_HOSTNAMES: 'movat.test',
    MAIL_OUTBOX: '1', RATE_LIMITS_JSON: JSON.stringify({ burstPerIp: [10000, 10], proposalPerIp: [10000, 86400], proposalPerIpShort: [10000, 600], voteNewPerIp: [10000, 3600], voteChangePerIp: [10000, 3600], contactPerIp: [10000, 86400], verifyPerIp: [10000, 86400] }),
  });
  try {
    const content = (await new Client(B).get('/api/content')).json;
    const card = content.cards.find((c) => c.copies >= 2) || content.cards[0];
    const mode = content.modes[0];
    const admin = await adminClient(B);
    await admin.adm('PUT', 'settings', { notifyEmails: 'team@busa.test' });

    /* 1. Moderazione: il client non può pubblicare */
    {
      const c = new Client(B);
      const r = await c.post('/api/proposals', modeProposal({ [card.id]: 1 }, { status: 'published', source: 'busa', turnstile: tok('proposal'), email: 'secret.person@example.com' }));
      check('Proposta accettata (200) e messaggio di revisione', r.status === 200 && /controllerà prima di pubblicarla/.test(r.json?.message), JSON.stringify(r.json));
      const data = (await admin.adm('GET', 'data')).json;
      const rec = data.modes.find((m) => m.email === 'secret.person@example.com');
      check('Proposta salvata "In attesa" anche se il client chiede "published"', rec && rec.status === 'pending' && rec.source === 'utente', rec && rec.status);
      const pub = await new Client(B).get('/api/content');
      check('Proposta in attesa assente dalle API pubbliche', !pub.json.modes.some((m) => m.id === rec.id));
      const pubNoContact = JSON.stringify({ ...pub.json, config: { ...pub.json.config, contact: undefined } });
      const leak = /secret\.person|aidHash|ipKey|receiptHash|tokenHash|stopHash|"voter"|"email"|"notify"|contentHash/.exec(pubNoContact);
      check('Email e dati tecnici assenti dalle API pubbliche', !leak, leak ? leak[0] : 'solo l’indirizzo pubblico del box Contattaci');
      const mv = await c.get('/api/my-votes');
      check('API "i miei voti" non espone dati di altri', mv.status === 200 && JSON.stringify(mv.json) === '{"votes":{}}');
      const noAuth = await new Client(B).req('PUT', '/api/admin/modes/' + rec.id, { status: 'published' }, { 'X-Movat-Cms': '1' });
      check('Utente anonimo non può cambiare stato (401)', noAuth.status === 401);
      const noAuthData = await new Client(B).get('/api/admin/data');
      check('Utente anonimo non legge i dati del CMS (401)', noAuthData.status === 401);
      const cardP = await c.post('/api/card-proposals', { title: 'Carta prova', dialect: 'Frase', text: 'Testo della carta', nickname: 'Tester', consent: true, status: 'published', turnstile: tok('card_proposal') });
      const d2 = (await admin.adm('GET', 'data')).json;
      check('Carta proposta salvata "In attesa" e non pubblica', cardP.status === 200 && d2.userCards.some((x) => x.title === 'Carta prova' && x.status === 'pending')
        && !(await new Client(B).get('/api/content')).json.userCards.some((x) => x.title === 'Carta prova'));
    }

    /* 2. Antibot */
    {
      const c = new Client(B);
      const body = (t) => ({ ...modeProposal({ [card.id]: 1 }), turnstile: t });
      const r1 = await c.post('/api/proposals', body(undefined));
      check('Token antibot assente → 403', r1.status === 403 && r1.json.code === 'antibot', r1.status);
      const r2 = await c.post('/api/proposals', body('garbage'));
      check('Token antibot non valido → 403', r2.status === 403);
      const r3 = await c.post('/api/proposals', body('expired'));
      check('Token antibot scaduto/già usato → 403 con messaggio "scaduta"', r3.status === 403 && /scaduta/.test(r3.json.error));
      const r4 = await c.post('/api/proposals', body(tok('vote')));
      check('Token emesso per un’altra action → 403', r4.status === 403);
      const r5 = await c.post('/api/proposals', body(`host-proposal-${++tokN}`));
      check('Token emesso per un altro hostname → 403', r5.status === 403);
      const r6 = await c.post('/api/votes', { modeId: mode.id, value: 4, turnstile: 'garbage' });
      check('Voto con token non valido → 403', r6.status === 403);
      const r7 = await c.post('/api/contact', { topic: 'domanda', message: 'Messaggio di prova abbastanza lungo', turnstile: 'garbage' });
      check('Contatto con token non valido → 403', r7.status === 403);
      check('Segreto Turnstile inviato solo a Siteverify dal server', verifyCalls.every((v) => v.secret === 'test-secret') && !(await new Client(B).get('/api/content')).text.includes('test-secret'));
      check('remoteip e idempotency_key inviati a Siteverify', verifyCalls.some((v) => v.remoteip && v.idempotency_key));
      const data = (await admin.adm('GET', 'data')).json;
      check('Nessuna proposta creata dai tentativi rifiutati', data.modes.filter((m) => m.source === 'utente').length === 1);
    }

    /* 3. Origine e intestazioni (richieste da altri siti) */
    {
      const c = new Client(B);
      const r1 = await c.req('POST', '/api/votes', { modeId: mode.id, value: 3, turnstile: tok('vote') }, { 'X-Movat-App': '1', Origin: 'https://evil.example' });
      check('Richiesta da altra origine → 403', r1.status === 403);
      const r2 = await c.req('POST', '/api/votes', { modeId: mode.id, value: 3, turnstile: tok('vote') }, {});
      check('Richiesta senza intestazione dell’app → 403', r2.status === 403);
      const r3 = await c.req('POST', '/api/votes', 'modeId=x', { 'X-Movat-App': '1', 'Content-Type': 'application/x-www-form-urlencoded' });
      check('Corpo non JSON (form di altri siti) → 415', r3.status === 415);
      const r4 = await admin.req('POST', '/api/admin/votes/clear', { demoOnly: true }, { 'X-Movat-Cms': '1', Origin: 'https://evil.example' });
      check('CMS: richiesta da altra origine → 403 anche con sessione valida', r4.status === 403);
    }

    /* 4. Cookie anonimo */
    {
      const c = new Client(B);
      await c.post('/api/votes', { modeId: mode.id, value: 5, turnstile: tok('vote') });
      const sc = c.lastSetCookie.find((x) => x.startsWith('movat_aid=')) || '';
      check('Cookie anonimo HttpOnly, SameSite=Lax, Path=/api/, durata esplicita', /HttpOnly/.test(sc) && /SameSite=Lax/.test(sc) && /Path=\/api\//.test(sc) && /Max-Age=15552000/.test(sc), sc.replace(/=v1\.[^;]+/, '=…'));
      const forged = new Client(B); forged.cookies.movat_aid = 'v1.AAAAAAAAAAAAAAAAAAAAAA.tn00aa.' + 'x'.repeat(32);
      await forged.post('/api/votes', { modeId: mode.id, value: 2, turnstile: tok('vote') });
      check('Cookie falsificato ignorato: il server emette un nuovo identificativo', forged.lastSetCookie.some((x) => x.startsWith('movat_aid=v1.')) && !forged.cookies.movat_aid.startsWith('v1.AAAA'));
      const db = JSON.parse(fs.readFileSync(path.join(DIR, 'db.json'), 'utf8'));
      const raw = c.cookies.movat_aid.split('.')[1];
      check('Nei dati non c’è il token del cookie (solo un’impronta)', !JSON.stringify(db).includes(raw));
      check('Nessun indirizzo IP in chiaro nei dati e nei contatori', !/127\.0\.0\.1|::1"/.test(fs.readFileSync(path.join(DIR, 'db.json'), 'utf8')) && !/127\.0\.0\.1/.test(fs.existsSync(path.join(DIR, 'runtime-state.json')) ? fs.readFileSync(path.join(DIR, 'runtime-state.json'), 'utf8') : ''));
    }

    /* 5. Voti: niente doppioni con richieste simultanee, aggiornamento e media */
    {
      const before = (await new Client(B).get('/api/content')).json.modes.find((m) => m.id === mode.id);
      const c = new Client(B);
      await c.post('/api/votes', { modeId: mode.id, value: 1, turnstile: tok('vote') }); // ottiene il cookie
      const afterFirst = (await new Client(B).get('/api/content')).json.modes.find((m) => m.id === mode.id);
      check('Primo voto: conteggio +1 e somma +1', afterFirst.ratingCount === before.ratingCount + 1 && afterFirst.ratingSum === before.ratingSum + 1);
      // 25 richieste simultanee dello stesso browser con valori diversi.
      const rs = await Promise.all([...Array(25)].map((_, i) => c.post('/api/votes', { modeId: mode.id, value: (i % 5) + 1, turnstile: tok('vote') })));
      const db = JSON.parse(fs.readFileSync(path.join(DIR, 'db.json'), 'utf8'));
      const mine = (await c.get('/api/my-votes')).json.votes['mode:' + mode.id];
      const voterVotes = db.votes.filter((v) => v.modeId === mode.id && !v.demo);
      const keys = new Set(voterVotes.map((v) => v.voter));
      check('Richieste simultanee: un solo voto per browser e contenuto', keys.size === voterVotes.length, `${voterVotes.length} voti, ${keys.size} browser`);
      const after = (await new Client(B).get('/api/content')).json.modes.find((m) => m.id === mode.id);
      check('Richieste simultanee: il conteggio non aumenta', after.ratingCount === afterFirst.ratingCount, `${afterFirst.ratingCount} → ${after.ratingCount}`);
      check('Limite modifiche allo stesso voto applicato (429 con Retry-After)', rs.some((r) => r.status === 429 && r.headers.get('retry-after')), rs.map((r) => r.status).join(','));
      const expectedSum = afterFirst.ratingSum - 1 + mine;
      check('Media corretta dopo l’aggiornamento (somma = precedente − vecchio + nuovo)', after.ratingSum === expectedSum, `${after.ratingSum} vs ${expectedSum}`);
      // Aggiornamento esplicito con un altro browser
      const c2 = new Client(B);
      const v1 = await c2.post('/api/votes', { modeId: mode.id, value: 2, turnstile: tok('vote') });
      const v2 = await c2.post('/api/votes', { modeId: mode.id, value: 5, turnstile: tok('vote') });
      check('Nuovo invio dello stesso browser aggiorna il voto (updated=true, mine=5)', v1.json.ok && v2.json.updated === true && v2.json.mine === 5 && v2.json.ratingCount === v1.json.ratingCount && v2.json.ratingSum === v1.json.ratingSum + 3);
      check('Al ritorno il browser ritrova il proprio voto', (await c2.get('/api/my-votes')).json.votes['mode:' + mode.id] === 5);
      const bad = await c2.post('/api/votes', { modeId: mode.id, value: 6, turnstile: tok('vote') });
      const bad2 = await c2.post('/api/votes', { modeId: mode.id, value: '4', turnstile: tok('vote') });
      const bad3 = await c2.post('/api/votes', { modeId: mode.id, value: 2.5, turnstile: tok('vote') });
      check('Valore delle stelle validato sul server (6, "4", 2.5 → 422)', [bad, bad2, bad3].every((r) => r.status === 422));
      const data = (await admin.adm('GET', 'data')).json;
      const pending = data.modes.find((m) => m.status === 'pending');
      const np = await c2.post('/api/votes', { modeId: pending.id, value: 4, turnstile: tok('vote') });
      check('Voto su contenuto non pubblicato → 404', np.status === 404);
    }

    /* 6. Esclusione e ripristino dal CMS */
    {
      const c = new Client(B);
      await c.post('/api/votes', { modeId: mode.id, value: 1, turnstile: tok('vote') });
      const pub = async () => (await new Client(B).get('/api/content')).json.modes.find((m) => m.id === mode.id);
      const before = await pub();
      const data = (await admin.adm('GET', 'data')).json;
      const v = data.votes.filter((x) => x.modeId === mode.id && x.value === 1 && !x.demo).sort((a, b) => b.at.localeCompare(a.at))[0];
      const noReason = await admin.adm('POST', `votes/${v.id}/exclude`, { reason: '' });
      check('Esclusione senza motivo rifiutata', noReason.status === 422);
      await admin.adm('POST', `votes/${v.id}/exclude`, { reason: 'Test: attività sospetta' });
      const ex = await pub();
      check('Esclusione: conteggio −1 e somma −1', ex.ratingCount === before.ratingCount - 1 && ex.ratingSum === before.ratingSum - 1);
      const d2 = (await admin.adm('GET', 'data')).json.votes.find((x) => x.id === v.id);
      check('Esclusione registrata con motivo e autore', d2.excluded && d2.excluded.reason === 'Test: attività sospetta' && d2.excluded.by === 'admin' && d2.history.length === 1);
      await admin.adm('POST', `votes/${v.id}/restore`, { reason: 'Verificato: voto legittimo' });
      const rs = await pub();
      check('Ripristino: media e conteggio tornano come prima', rs.ratingCount === before.ratingCount && rs.ratingSum === before.ratingSum);
      check('Storico con esclusione e ripristino', (await admin.adm('GET', 'data')).json.votes.find((x) => x.id === v.id).history.length === 2);
      // Sospensione
      await admin.adm('PUT', 'modes/' + mode.id, { votingSuspended: true });
      const sus = await c.post('/api/votes', { modeId: mode.id, value: 3, turnstile: tok('vote') });
      check('Votazioni sospese → 409, e votingOpen=false nelle API pubbliche', sus.status === 409 && (await pub()).votingOpen === false);
      await admin.adm('PUT', 'modes/' + mode.id, { votingSuspended: false });
      const ok = await c.post('/api/votes', { modeId: mode.id, value: 3, turnstile: tok('vote') });
      check('Votazioni riattivate → voto accettato', ok.status === 200);
    }

    /* 7. Limiti */
    {
      const c = new Client(B);
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await c.post('/api/proposals', { ...modeProposal({ [card.id]: 1 }), turnstile: tok('proposal') })).status);
      // Una carta in più: modalità e carte contano insieme
      const r5 = await c.post('/api/card-proposals', { title: 'Oltre il limite', dialect: 'Frase', text: 'Testo', nickname: 'T', consent: true, turnstile: tok('card_proposal') });
      check('Max 3 proposte al giorno per browser (la 4ª → 429)', statuses.join(',') === '200,200,200,429', statuses.join(','));
      check('Modalità e carte contano insieme (carta dopo 3 modalità → 429)', r5.status === 429 && /al massimo 3 proposte/.test(r5.json.error));
      const t429 = await c.post('/api/proposals', { ...modeProposal({ [card.id]: 1 }), turnstile: tok('proposal') });
      check('429 con Retry-After e messaggio comprensibile', t429.status === 429 && Number(t429.headers.get('retry-after')) > 3600 && !/Error|stack/i.test(t429.json.error), t429.json.error);
      const other = new Client(B);
      const ro = await other.post('/api/proposals', { ...modeProposal({ [card.id]: 1 }), turnstile: tok('proposal') });
      check('Un altro browser sulla stessa rete può ancora inviare', ro.status === 200);
      // Raffica
      const burst = new Client(B);
      await burst.post('/api/votes', { modeId: 'non-esiste', value: 3 }); // ottiene il cookie
      const bs = await Promise.all([...Array(12)].map(() => burst.post('/api/votes', { modeId: 'non-esiste', value: 3 })));
      check('Raffica dallo stesso browser bloccata (429)', bs.some((r) => r.status === 429), bs.map((r) => r.status).join(','));
      // Contatti
      const cc = new Client(B);
      const cs = [];
      for (let i = 0; i < 4; i++) cs.push((await cc.post('/api/contact', { topic: 'domanda', message: 'Messaggio numero ' + i + ' abbastanza lungo', turnstile: tok('contact') })).status);
      check('Contatti: max 3 all’ora per browser', cs.join(',') === '200,200,200,429', cs.join(','));
      // Limite modificabile dal CMS
      await admin.adm('PUT', 'settings', { proposalsPerDay: 1 });
      const c3 = new Client(B);
      const a1 = await c3.post('/api/proposals', { ...modeProposal({ [card.id]: 1 }), turnstile: tok('proposal') });
      const a2 = await c3.post('/api/proposals', { ...modeProposal({ [card.id]: 1 }), turnstile: tok('proposal') });
      check('Soglia proposte modificabile dal CMS (1 al giorno)', a1.status === 200 && a2.status === 429);
      await admin.adm('PUT', 'settings', { proposalsPerDay: 3 });
      // I tentativi con antibot fallito non consumano il limite
      const c4 = new Client(B);
      for (let i = 0; i < 3; i++) await c4.post('/api/proposals', { ...modeProposal({ [card.id]: 1 }), turnstile: 'garbage' });
      const okAfter = await c4.post('/api/proposals', { ...modeProposal({ [card.id]: 1 }), turnstile: tok('proposal') });
      check('Tentativi con verifica fallita non consumano il limite giornaliero', okAfter.status === 200);
    }

    /* 8. Validazione */
    {
      const c = new Client(B);
      const v = async (body) => (await new Client(B).post('/api/proposals', { ...body, turnstile: tok('proposal') })).status;
      check('Carta inesistente → 422', await v(modeProposal({ 'non-esiste': 1 })) === 422);
      check('Quantità oltre le copie → 422', await v(modeProposal({ [card.id]: card.copies + 1 })) === 422);
      check('Quantità non intera → 422', await v(modeProposal({ [card.id]: 1.5 })) === 422);
      check('Nessuna carta → 422', await v(modeProposal({})) === 422);
      check('Titolo non stringa → 422', await v(modeProposal({ [card.id]: 1 }, { title: { $gt: '' } })) === 422);
      check('Descrizione troppo lunga → 422', await v(modeProposal({ [card.id]: 1 }, { description: 'x'.repeat(601) })) === 422);
      check('Email non valida → 422', await v(modeProposal({ [card.id]: 1 }, { email: 'non-una-email' })) === 422);
      check('Giocatori non validi → 422', await v(modeProposal({ [card.id]: 1 }, { players: '5–2' })) === 422);
      check('Senza consenso → 422', await v(modeProposal({ [card.id]: 1 }, { consent: false })) === 422);
      const big = await c.post('/api/votes', { modeId: mode.id, value: 3, pad: 'x'.repeat(40000) });
      check('Corpo troppo grande → 413', big.status === 413);
      const cr = await new Client(B).post('/api/contact', { topic: 'domanda', message: 'Voglio una risposta per favore', wantsReply: true, turnstile: tok('contact') });
      check('Contatto con risposta richiesta ma senza email → 422', cr.status === 422 && cr.json.details.email);
    }

    /* 9. Doppio clic, retry e duplicati */
    {
      const c = new Client(B);
      await c.post('/api/session', {}); // come fa l'app prima del primo invio
      const body = { ...modeProposal({ [card.id]: 1 }, { title: 'Doppio clic' }) };
      const key = 'idem-' + Date.now().toString(36) + '-abcdefgh';
      const [r1, r2] = await Promise.all([c.post('/api/proposals', { ...body, turnstile: tok('proposal') }, { 'Idempotency-Key': key }), c.post('/api/proposals', { ...body, turnstile: tok('proposal') }, { 'Idempotency-Key': key })]);
      const r3 = await c.post('/api/proposals', { ...body, turnstile: tok('proposal') }, { 'Idempotency-Key': key });
      const data = (await admin.adm('GET', 'data')).json;
      check('Doppio clic + retry con la stessa chiave → una sola proposta', [r1, r2, r3].every((r) => r.status === 200) && data.modes.filter((m) => m.title === 'Doppio clic').length === 1);
      const r4 = await c.post('/api/proposals', { ...body, turnstile: tok('proposal') });
      check('Stesso contenuto dallo stesso browser senza chiave → riconosciuto come già ricevuto', r4.status === 200 && r4.json.duplicate === true && (await admin.adm('GET', 'data')).json.modes.filter((m) => m.title === 'Doppio clic').length === 1);
      const other = new Client(B);
      await other.post('/api/proposals', { ...body, turnstile: tok('proposal') });
      // Doppio clic di un browser nuovo, senza cookie e senza chiave: viene segnalato come duplicato, non scartato.
      const d2 = (await admin.adm('GET', 'data')).json.modes.filter((m) => m.title === 'Doppio clic');
      check('Proposta simile da un altro browser: ricevuta e segnalata come possibile duplicato', d2.length === 2 && d2.every((m) => m.possibleDuplicates.length === 1));
    }

    /* 10. Email facoltativa, verifica e notifiche */
    {
      const before = outbox(DIR).length;
      const c = new Client(B);
      const r = await c.post('/api/proposals', { ...modeProposal({ [card.id]: 1 }, { title: 'Senza email' }), turnstile: tok('proposal') });
      const data = (await admin.adm('GET', 'data')).json;
      const rec = data.modes.find((m) => m.title === 'Senza email');
      check('Proposta senza email ricevuta', r.status === 200 && rec && rec.status === 'pending');
      await admin.adm('PUT', 'modes/' + rec.id, { status: 'published' });
      check('Proposta senza email approvabile', (await new Client(B).get('/api/content')).json.modes.some((m) => m.id === rec.id));
      const toUser = outbox(DIR).slice(before).filter((m) => [].concat(m.to).some((t) => t !== 'team@busa.test'));
      check('Nessuna email a utenti per proposte senza email', toUser.length === 0);

      // Email senza richiesta di notifiche: nessuna email all'indirizzo
      const n0 = outbox(DIR).length;
      const c1 = new Client(B);
      await c1.post('/api/proposals', { ...modeProposal({ [card.id]: 1 }, { title: 'Email senza notifiche', email: 'nonotify@example.com' }), turnstile: tok('proposal') });
      const recN = (await admin.adm('GET', 'data')).json.modes.find((m) => m.title === 'Email senza notifiche');
      await admin.adm('PUT', 'modes/' + recN.id, { status: 'published' });
      await sleep(200);
      check('Email indicata ma notifiche non richieste: nessuna email inviata', !outbox(DIR).slice(n0).some((m) => m.to === 'nonotify@example.com'));

      // Notifiche richieste ma indirizzo NON verificato → nessuna notifica di pubblicazione
      const n1 = outbox(DIR).length;
      const c2 = new Client(B);
      const rv = await c2.post('/api/proposals', { ...modeProposal({ [card.id]: 1 }, { title: 'Non verificata', email: 'unverified@example.com', notify: true }), turnstile: tok('proposal') });
      const mails1 = outbox(DIR).slice(n1).filter((m) => m.to === 'unverified@example.com');
      check('Notifiche richieste → solo email di verifica (testo fisso, senza contenuti dell’utente)', rv.json.notify === 'verification-sent' && mails1.length === 1 && /conferma/.test(mails1[0].subject) && !mails1[0].text.includes('Non verificata'));
      const recU = (await admin.adm('GET', 'data')).json.modes.find((m) => m.title === 'Non verificata');
      check('CMS: stato notifica "in attesa di conferma"', recU.notifyStatus === 'pending');
      await admin.adm('PUT', 'modes/' + recU.id, { status: 'published' });
      await sleep(300);
      check('Nessuna notifica a indirizzi non verificati', outbox(DIR).slice(n1).filter((m) => m.to === 'unverified@example.com').length === 1);

      // Verifica e notifica
      const n2 = outbox(DIR).length;
      const c3 = new Client(B);
      await c3.post('/api/proposals', { ...modeProposal({ [card.id]: 1 }, { title: 'Verificata', email: 'verified@example.com', notify: true }), turnstile: tok('proposal') });
      const vm = outbox(DIR).slice(n2).find((m) => m.to === 'verified@example.com');
      const link = /\/api\/email\/verify\?t=([A-Za-z0-9_-]+)/.exec(vm.text)[1];
      const getPage = await new Client(B).get('/api/email/verify?t=' + link);
      const recV0 = (await admin.adm('GET', 'data')).json.modes.find((m) => m.title === 'Verificata');
      check('Aprire il link (GET) non conferma da solo', /Conferma il tuo indirizzo/.test(getPage.text) && recV0.notifyStatus === 'pending');
      const conf = await new Client(B).req('POST', '/api/email/verify', 't=' + link, { 'Content-Type': 'application/x-www-form-urlencoded' });
      check('Conferma con il pulsante (POST) riuscita', /Indirizzo confermato/.test(conf.text));
      const again = await new Client(B).req('POST', '/api/email/verify', 't=' + link, { 'Content-Type': 'application/x-www-form-urlencoded' });
      check('Token monouso: secondo utilizzo rifiutato', /non valido/.test(again.text));
      const recV = (await admin.adm('GET', 'data')).json.modes.find((m) => m.title === 'Verificata');
      await admin.adm('PUT', 'modes/' + recV.id, { status: 'published' });
      await sleep(300);
      const pubMail = outbox(DIR).slice(n2).find((m) => m.to === 'verified@example.com' && /pubblicata/.test(m.subject));
      check('Indirizzo verificato → notifica di pubblicazione con link per disattivare', !!pubMail && /\/api\/email\/stop\?t=/.test(pubMail.text));
      const stopTok = /\/api\/email\/stop\?t=([A-Za-z0-9_-]+)/.exec(pubMail.text)[1];
      const st = await new Client(B).req('POST', '/api/email/stop', 't=' + stopTok, { 'Content-Type': 'application/x-www-form-urlencoded' });
      check('Disattivazione notifiche dal link', /Notifiche disattivate/.test(st.text) && (await admin.adm('GET', 'data')).json.modes.find((m) => m.id === recV.id).notifyStatus === 'off');
      const fakeTok = await new Client(B).get('/api/email/verify?t=' + 'A'.repeat(43));
      check('Token di verifica inventato rifiutato', /non valido/.test(fakeTok.text));
      // Limite verifiche per indirizzo (abusi verso terzi)
      const n3 = outbox(DIR).length;
      const outs = [];
      for (let i = 0; i < 5; i++) { const cx = new Client(B); outs.push((await cx.post('/api/proposals', { ...modeProposal({ [card.id]: 1 }, { email: 'victim@example.com', notify: true }), turnstile: tok('proposal') })).json.notify); }
      check('Max 3 email di verifica al giorno allo stesso indirizzo', outbox(DIR).slice(n3).filter((m) => m.to === 'victim@example.com').length === 3 && outs.slice(3).every((x) => x === 'limit'), outs.join(','));
      // Contatti: nessuna copia all'utente
      const n4 = outbox(DIR).length;
      const cc = new Client(B);
      const rc = await cc.post('/api/contact', { topic: 'segnalazione', message: 'Spam verso terzi? Non deve arrivare.', wantsReply: true, email: 'thirdparty@example.com', turnstile: tok('contact') });
      await sleep(200);
      const after = outbox(DIR).slice(n4);
      check('Contatto: messaggio salvato, avviso solo al team, nessuna copia all’indirizzo indicato', rc.status === 200 && after.every((m) => m.to !== 'thirdparty@example.com' && [].concat(m.to).includes('team@busa.test')) && (await admin.adm('GET', 'data')).json.messages.some((m) => m.email === 'thirdparty@example.com'));
      const cn = await new Client(B).post('/api/contact', { topic: 'segnalazione', message: 'Segnalazione anonima senza email', turnstile: tok('contact') });
      check('Segnalazione senza email accettata', cn.status === 200);
    }

    /* 11. Testi dell'utente come testo semplice */
    {
      const c = new Client(B);
      const evil = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
      await c.post('/api/proposals', { ...modeProposal({ [card.id]: 1 }, { title: 'XSS ' + evil.slice(0, 40), description: 'Descrizione con HTML ' + evil, nickname: '<b>hacker</b>' }), turnstile: tok('proposal') });
      await c.post('/api/card-proposals', { title: '<svg onload=x>', dialect: evil.slice(0, 60), text: evil.slice(0, 190), nickname: '<i>x</i>', consent: true, turnstile: tok('card_proposal') });
      const d = (await admin.adm('GET', 'data')).json;
      const m = d.modes.find((x) => x.title.startsWith('XSS'));
      const uc = d.userCards.find((x) => x.title === '<svg onload=x>');
      await admin.adm('PUT', 'modes/' + m.id, { status: 'published' });
      await admin.adm('PUT', 'user-cards/' + uc.id, { status: 'published' });
      fs.writeFileSync(path.join(S, 'xss-ids.json'), JSON.stringify({ mode: m.id, card: uc.id }));
      check('Testo salvato così com’è (nessuna alterazione), da mostrare come testo', m.description.includes('<script>'));
      const html = await new Client(B).get('/');
      check('Intestazione Content-Security-Policy presente', /script-src 'self' https:\/\/challenges\.cloudflare\.com/.test(html.headers.get('content-security-policy') || '') && html.headers.get('x-frame-options') === 'DENY');
    }
  } catch (e) { check('Errore imprevisto nei test', false, e.stack); }

  console.log(results.join('\n'));
  console.log(`\n${pass} superate, ${fail} fallite`);
  fs.writeFileSync(path.join(S, 'main-port.txt'), String(PORT));
  if (process.argv.includes('--keep')) { console.log('Server lasciato attivo su', PORT); return; }
  srv.kill(); mock.close();
  process.exit(fail ? 1 : 0);
})();
