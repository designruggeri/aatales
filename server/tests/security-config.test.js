// Verifiche: produzione senza chiavi, proxy fidati, persistenza dei limiti, migrazione dei dati esistenti.
// Uso: node server/tests/security-config.test.js   (avvia server di prova sulle porte 8911–8914, dati in una cartella temporanea)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const S = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'movat-test-'));
let pass = 0, fail = 0; const out = [];
const check = (n, ok, info = '') => { (ok ? pass++ : fail++); out.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${info ? '  — ' + info : ''}`); };

function start(port, dir, env, { fresh = true } = {}) {
  if (fresh) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); }
  const p = spawn('node', [path.join(ROOT, 'server/server.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, ADMIN_USER: 'admin', ADMIN_PASSWORD: 'testpass123', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d)); p.log = () => log;
  return new Promise((res) => { const t = setInterval(async () => { try { await fetch(`http://localhost:${port}/api/content`); clearInterval(t); res(p); } catch { /* */ } }, 100); });
}
const stop = (p) => new Promise((r) => { p.on('exit', r); p.kill('SIGTERM'); });
async function post(base, url, body, headers = {}, cookie) {
  const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Movat-App': '1', Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: JSON.stringify(body) });
  const sc = r.headers.getSetCookie();
  return { status: r.status, json: await r.json().catch(() => null), cookie: sc.map((c) => c.split(';')[0]).join('; ') || cookie, setCookie: sc };
}

(async () => {
  // 1. Produzione senza chiavi Turnstile: niente disattivazione silenziosa
  {
    const B = 'http://localhost:8911';
    const p = await start(8911, path.join(S, 'data-prod'), { NODE_ENV: 'production', PUBLIC_URL: B });
    const c = await (await fetch(B + '/api/content')).json();
    const r = await post(B, '/api/votes', { modeId: c.modes[0].id, value: 4 });
    check('Produzione senza chiavi Turnstile: voto rifiutato (503)', r.status === 503 && r.json.code === 'antibot-unavailable', r.status + ' ' + r.json.error);
    const r2 = await post(B, '/api/proposals', { title: 'Test prod', description: 'Descrizione abbastanza lunga ok', nickname: 'x', consent: true, cards: { [c.cards[0].id]: 1 } });
    check('Produzione senza chiavi: proposta rifiutata (503)', r2.status === 503);
    check('Produzione: avviso chiaro nel log del server', /mancano TURNSTILE_SITE_KEY e TURNSTILE_SECRET_KEY/.test(p.log()));
    check('Produzione: cookie anonimo con Secure', r.setCookie.some((x) => /movat_aid=.*; Secure/.test(x)));
    check('Produzione: nessuna chiave antibot esposta, stato "misconfigured"', c.config.turnstileSiteKey === null && c.config.antibot === 'misconfigured');
    await stop(p);
  }
  // 2. IP: X-Forwarded-For ignorato senza proxy fidati, usato con TRUST_PROXY_HOPS=1
  {
    const B = 'http://localhost:8912';
    const p = await start(8912, path.join(S, 'data-ip'), { RATE_LIMITS_JSON: JSON.stringify({ proposalPerIpShort: [3, 600] }) });
    const c = await (await fetch(B + '/api/content')).json();
    const body = (i) => ({ title: 'IP test ' + i, description: 'Descrizione abbastanza lunga ok ' + i, nickname: 'x', consent: true, cards: { [c.cards[0].id]: 1 } });
    const st = [];
    for (let i = 0; i < 5; i++) st.push((await post(B, '/api/proposals', body(i), { 'X-Forwarded-For': `10.0.0.${i}` })).status);
    check('Senza proxy fidati, X-Forwarded-For falso non aggira il limite per IP', st.join(',') === '200,200,200,429,429', st.join(','));
    await stop(p);
    const p2 = await start(8912, path.join(S, 'data-ip2'), { TRUST_PROXY_HOPS: '1', RATE_LIMITS_JSON: JSON.stringify({ proposalPerIpShort: [3, 600] }) });
    const st2 = [];
    for (let i = 0; i < 5; i++) st2.push((await post(B, '/api/proposals', body(i), { 'X-Forwarded-For': `10.0.0.${i}` })).status);
    check('Con TRUST_PROXY_HOPS=1 l’IP arriva dal proxy (reti diverse non si bloccano a vicenda)', st2.every((s) => s === 200), st2.join(','));
    const st3 = [];
    for (let i = 0; i < 5; i++) st3.push((await post(B, '/api/proposals', body('s' + i), { 'X-Forwarded-For': `6.6.6.${i}, 10.9.9.9` })).status);
    check('Con proxy fidato, gli indirizzi aggiunti dal client prima del proxy sono ignorati', st3.join(',') === '200,200,200,429,429', st3.join(','));
    await stop(p2);
  }
  // 3. I limiti sopravvivono al riavvio
  {
    const B = 'http://localhost:8913', dir = path.join(S, 'data-persist');
    let p = await start(8913, dir, {});
    const c = await (await fetch(B + '/api/content')).json();
    let cookie;
    for (let i = 0; i < 3; i++) cookie = (await post(B, '/api/proposals', { title: 'Persist ' + i, description: 'Descrizione abbastanza lunga ok ' + i, nickname: 'x', consent: true, cards: { [c.cards[0].id]: 1 } }, {}, cookie)).cookie;
    await stop(p);
    p = await start(8913, dir, {}, { fresh: false });
    const r = await post(B, '/api/proposals', { title: 'Persist 4', description: 'Descrizione abbastanza lunga ok 4', nickname: 'x', consent: true, cards: { [c.cards[0].id]: 1 } }, {}, cookie);
    check('Dopo un riavvio il limite di 3 proposte al giorno resta valido', r.status === 429, r.status);
    const my = await (await fetch(B + '/api/my-votes', { headers: { Cookie: cookie } })).json();
    check('Dopo un riavvio il cookie anonimo resta valido (segreto persistente)', my && typeof my.votes === 'object' && r.status === 429);
    await stop(p);
  }
  // 4. Migrazione dei dati salvati con la versione precedente
  {
    const dir = path.join(S, 'data-migr');
    // Crea i dati dimostrativi, poi li riporta al formato della versione precedente (voti con deviceId).
    const seed = await start(8914, dir, {});
    await stop(seed);
    for (const f of ['runtime-state.json', 'secret.key']) fs.rmSync(path.join(dir, f), { force: true });
    const old = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    old.votes.forEach((v) => { v.deviceId = v.voter; delete v.voter; delete v.excluded; delete v.history; delete v.changes; delete v.createdAt; });
    // Simula i voti vecchi: codice dispositivo scelto dal browser, con un doppione
    const m0 = old.modes[0].id;
    old.votes.push({ id: 'v_old1', modeId: m0, deviceId: 'dabc123xyz', value: 2, at: '2026-10-01T10:00:00.000Z' });
    old.votes.push({ id: 'v_old2', modeId: m0, deviceId: 'dabc123xyz', value: 5, at: '2026-10-02T10:00:00.000Z' });
    delete old.version; delete old.messages;
    fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(old));
    const B = 'http://localhost:8914';
    const p = await start(8914, dir, {}, { fresh: false });
    const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    check('Migrazione: versione 2, messaggi e impostazioni aggiunti', db.version === 2 && Array.isArray(db.messages) && db.settings.proposalsPerDay === 3 && db.settings.rankMinVotes === 5);
    check('Migrazione: codici dispositivo sostituiti da impronte, doppioni rimossi', !JSON.stringify(db).includes('dabc123xyz') && db.votes.filter((v) => v.voter && v.voter.startsWith('legacy-') && v.modeId === m0).length === 1 && db.votes.find((v) => v.voter.startsWith('legacy-') && v.modeId === m0).value === 5);
    check('Migrazione: ogni voto ha un solo record per browser e contenuto', new Set(db.votes.map((v) => (v.cardId ? 'c' + v.cardId : 'm' + v.modeId) + v.voter)).size === db.votes.length);
    const c = await (await fetch(B + '/api/content')).json();
    check('Migrazione: contenuti pubblici invariati e consultabili', c.modes.length === old.modes.filter((m) => m.status === 'published').length);
    await stop(p);
  }
  console.log(out.join('\n')); console.log(`\n${pass} superate, ${fail} fallite`);
  process.exit(fail ? 1 : 0);
})();
