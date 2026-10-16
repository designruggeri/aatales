/*
 * MÖVAT! — protezioni delle interazioni pubbliche (senza account).
 *
 * - Identificativo anonimo del browser: token casuale firmato dal server, in un cookie HttpOnly.
 * - Limiti alle richieste con contatori salvati su disco (sopravvivono ai riavvii).
 * - Verifica Cloudflare Turnstile (Siteverify) lato server.
 * - IP del client dietro proxy fidati, controllo dell'origine delle richieste.
 *
 * Nessuna dipendenza esterna: solo moduli di Node.js (serve Node 18+ per fetch).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');

const env = process.env;
const PROD = env.NODE_ENV === 'production';
const int = (v, d) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };

/* ------------------------------------------------------------------ */
/* Configurazione (variabili d'ambiente, tutte con un valore predefinito) */
/* ------------------------------------------------------------------ */
const PUBLIC_URL = (env.PUBLIC_URL || '').replace(/\/+$/, '');
const CONFIG = {
  prod: PROD,
  publicUrl: PUBLIC_URL,
  // Numero di proxy fidati davanti al server (es. 1 con Render, Railway, Nginx o Caddy). 0 = connessione diretta.
  trustProxyHops: int(env.TRUST_PROXY_HOPS, 0),
  cookieSecure: env.COOKIE_SECURE === '1' || (PROD && env.COOKIE_SECURE !== '0'),
  // Durata dell'identificativo anonimo del browser, in giorni.
  anonIdDays: Math.max(1, int(env.ANON_ID_DAYS, 180)),
  turnstile: {
    siteKey: env.TURNSTILE_SITE_KEY || '',
    secret: env.TURNSTILE_SECRET_KEY || '',
    hostnames: (env.TURNSTILE_HOSTNAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    verifyUrl: env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  },
};
if (!CONFIG.turnstile.hostnames.length && PUBLIC_URL) {
  try { CONFIG.turnstile.hostnames = [new URL(PUBLIC_URL).hostname.toLowerCase()]; } catch { /* PUBLIC_URL non valido */ }
}

/*
 * Limiti alle richieste: [massimo, finestra in secondi].
 * Si possono cambiare senza toccare il codice con RATE_LIMITS_JSON, per esempio:
 *   RATE_LIMITS_JSON='{"voteNewPerAid":[50,3600]}'
 * Il numero di proposte al giorno per browser si imposta anche dal CMS.
 */
const LIMITS = {
  burstPerAid: [8, 10],            // raffiche: qualsiasi invio protetto, per browser
  burstPerIp: [30, 10],            // raffiche: per IP (più generoso, Wi-Fi condivise)
  proposalPerAid: [3, 86400],      // proposte (modalità + carte insieme) per browser al giorno — sovrascritto dal CMS
  proposalPerIp: [20, 86400],      // proposte per IP al giorno
  proposalPerIpShort: [6, 600],    // proposte per IP in 10 minuti
  voteNewPerAid: [30, 3600],       // nuovi voti per browser all'ora
  voteNewPerIp: [300, 3600],       // nuovi voti per IP all'ora
  voteChangePerAid: [20, 3600],    // modifiche ai voti per browser all'ora
  voteChangePerTarget: [3, 600],   // modifiche allo stesso voto in 10 minuti
  voteChangePerIp: [200, 3600],    // modifiche ai voti per IP all'ora
  contactPerAid: [3, 3600],        // messaggi per browser all'ora
  contactPerAidDay: [6, 86400],    // messaggi per browser al giorno
  contactPerIp: [20, 86400],       // messaggi per IP al giorno
  verifyPerEmail: [3, 86400],      // email di verifica per indirizzo al giorno
  verifyPerAid: [5, 86400],        // email di verifica per browser al giorno
  verifyPerIp: [10, 86400],        // email di verifica per IP al giorno
  emailLinkPerIp: [30, 3600],      // conferme/disattivazioni da link email per IP all'ora
  myVotesPerIp: [240, 60],         // letture "i miei voti" per IP al minuto
  loginPerIp: [10, 900],           // tentativi di accesso al CMS per IP in 15 minuti
};
if (env.RATE_LIMITS_JSON) {
  try {
    for (const [k, v] of Object.entries(JSON.parse(env.RATE_LIMITS_JSON))) {
      if (k in LIMITS && Array.isArray(v) && v.length === 2 && v.every((n) => Number(n) > 0)) LIMITS[k] = [Number(v[0]), Number(v[1])];
    }
  } catch { console.warn('RATE_LIMITS_JSON non valido: uso i limiti predefiniti.'); }
}

/* ------------------------------------------------------------------ */
/* Segreto del server e firme                                          */
/* ------------------------------------------------------------------ */
let SECRET;
function loadSecret(dataDir) {
  if (env.MOVAT_SECRET && env.MOVAT_SECRET.length >= 32) { SECRET = Buffer.from(env.MOVAT_SECRET); return; }
  const file = path.join(dataDir, 'secret.key');
  if (fs.existsSync(file)) SECRET = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  if (!SECRET || SECRET.length < 32) {
    SECRET = crypto.randomBytes(32);
    fs.writeFileSync(file, SECRET.toString('hex'), { mode: 0o600 });
  }
}
// Impronta non reversibile di un valore, distinta per scopo (es. 'aid', 'ip', 'email').
const hmac = (purpose, value) => crypto.createHmac('sha256', SECRET).update(purpose + '\0' + value).digest('hex');
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/* ------------------------------------------------------------------ */
/* Cookie                                                              */
/* ------------------------------------------------------------------ */
function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}
function appendCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, cookie) : cookie);
}

/* ------------------------------------------------------------------ */
/* Identificativo anonimo del browser                                  */
/* ------------------------------------------------------------------ */
// Formato: v1.<id casuale>.<emesso il, base36>.<firma>. Il server accetta solo token firmati da lui e non scaduti.
const AID_COOKIE = 'movat_aid';
function signAid(id, issued) { return crypto.createHmac('sha256', SECRET).update('aid-token\0' + id + '.' + issued).digest('base64url').slice(0, 32); }
function readAid(req) {
  const raw = getCookie(req, AID_COOKIE);
  const m = raw && /^v1\.([A-Za-z0-9_-]{22})\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{32})$/.exec(raw);
  if (!m) return null;
  if (!safeEqual(signAid(m[1], m[2]), m[3])) return null;
  const issuedMs = parseInt(m[2], 36) * 1000;
  if (!(issuedMs <= Date.now() + 60e3) || Date.now() - issuedMs > CONFIG.anonIdDays * 86400e3) return null;
  // Nei dati si salva solo un'impronta dell'identificativo, mai il token del cookie.
  return { hash: hmac('aid', m[1]).slice(0, 32), issuedMs };
}
function ensureAid(req, res) {
  const cur = readAid(req);
  if (cur) return cur;
  const id = crypto.randomBytes(16).toString('base64url');
  const issued = Math.floor(Date.now() / 1000).toString(36);
  const maxAge = CONFIG.anonIdDays * 86400;
  appendCookie(res, `${AID_COOKIE}=v1.${id}.${issued}.${signAid(id, issued)}; Path=/api/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${CONFIG.cookieSecure ? '; Secure' : ''}`);
  return { hash: hmac('aid', id).slice(0, 32), issuedMs: Date.now(), isNew: true };
}

/* ------------------------------------------------------------------ */
/* IP del client                                                       */
/* ------------------------------------------------------------------ */
const normIp = (ip) => String(ip || '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
// Con TRUST_PROXY_HOPS = N si considerano fidati gli ultimi N passaggi di X-Forwarded-For:
// gli indirizzi aggiunti prima (scrivibili dal client) vengono ignorati.
function clientIp(req) {
  const remote = normIp(req.socket.remoteAddress);
  const hops = CONFIG.trustProxyHops;
  if (!hops) return remote || '?';
  const chain = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => normIp(s)).filter((s) => net.isIP(s));
  const all = [...chain, remote];
  return all[Math.max(0, all.length - 1 - hops)] || remote || '?';
}
// Per i limiti, gli IPv6 si raggruppano per /64 (una rete domestica). Si conserva solo un'impronta.
function ipBucket(ip) {
  let base = ip;
  if (net.isIPv6(ip)) {
    const [head, tail = ''] = ip.split('::');
    const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
    const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
    base = full.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
  }
  return hmac('ip', base).slice(0, 24);
}

/* ------------------------------------------------------------------ */
/* Origine delle richieste (protezione da richieste di altri siti)      */
/* ------------------------------------------------------------------ */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host.toLowerCase(); } catch { return false; }
    const allowed = [String(req.headers.host || '').toLowerCase()];
    if (PUBLIC_URL) { try { allowed.push(new URL(PUBLIC_URL).host.toLowerCase()); } catch { /* ignora */ } }
    return allowed.includes(host);
  }
  // Browser che non inviano Origin: si rifiutano solo le richieste dichiarate da altri siti.
  return req.headers['sec-fetch-site'] !== 'cross-site';
}

/* ------------------------------------------------------------------ */
/* Contatori persistenti (limiti) e chiavi di idempotenza               */
/* ------------------------------------------------------------------ */
// I dati stanno in memoria e vengono salvati su disco (scrittura atomica) poco dopo ogni modifica,
// così i limiti restano validi anche dopo un riavvio. Le chiavi contengono solo impronte (niente IP in chiaro).
class RuntimeStore {
  constructor(file) {
    this.file = file; this.buckets = new Map(); this.kv = new Map(); this.timer = null;
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      const t = Date.now();
      for (const [k, v] of Object.entries(d.buckets || {})) if (v.reset > t) this.buckets.set(k, v);
      for (const [k, v] of Object.entries(d.kv || {})) if (v.exp > t) this.kv.set(k, v);
    } catch { /* primo avvio */ }
  }
  schedule() { if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 400); }
  flush() {
    const t = Date.now();
    for (const [k, v] of this.buckets) if (v.reset <= t) this.buckets.delete(k);
    for (const [k, v] of this.kv) if (v.exp <= t) this.kv.delete(k);
    const tmp = this.file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify({ buckets: Object.fromEntries(this.buckets), kv: Object.fromEntries(this.kv) }));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('Salvataggio dei contatori non riuscito:', e.message); }
  }
  // Controlla tutte le regole e, solo se nessuna è superata, le conta tutte. Operazione sincrona: nessuna corsa tra richieste.
  take(rules) {
    const t = Date.now();
    let wait = 0, which = null;
    for (const r of rules) {
      const b = this.buckets.get(r.key);
      if (b && b.reset > t && b.n >= r.max) { const w = b.reset - t; if (w > wait) { wait = w; which = r.name; } }
    }
    if (wait) return { ok: false, retryAfter: Math.ceil(wait / 1000), rule: which };
    for (const r of rules) {
      let b = this.buckets.get(r.key);
      if (!b || b.reset <= t) { b = { n: 0, reset: t + r.windowMs }; this.buckets.set(r.key, b); }
      b.n++;
    }
    this.schedule();
    return { ok: true };
  }
  get(key) { const v = this.kv.get(key); if (!v || v.exp <= Date.now()) return undefined; return v.value; }
  set(key, value, ttlMs) { this.kv.set(key, { value, exp: Date.now() + ttlMs }); this.schedule(); }
  del(key) { this.kv.delete(key); this.schedule(); }
}
// Regola di limite: nome dal catalogo LIMITS + soggetto (impronta del browser, dell'IP, ecc.).
function rule(name, subject, override) {
  const [max, sec] = override || LIMITS[name];
  return { name, key: name + ':' + subject, max, windowMs: sec * 1000 };
}

/* ------------------------------------------------------------------ */
/* Cloudflare Turnstile                                                */
/* ------------------------------------------------------------------ */
// Chiavi di prova pubblicate da Cloudflare (sempre valide/sempre rifiutate): utili in sviluppo.
const isTestSecret = (s) => /^[123]x0{20,}AA$/.test(s);
function turnstileMode() {
  const t = CONFIG.turnstile;
  if (t.siteKey && t.secret) return 'on';
  return PROD ? 'misconfigured' : 'off';
}
/*
 * Esiti: { ok:true } | { ok:false, code } con code:
 *   missing (token assente), expired (scaduto o già usato), invalid (rifiutato o action/hostname inattesi),
 *   unavailable (antibot non configurato in produzione), unreachable (Cloudflare non risponde).
 */
async function verifyTurnstile(token, { action, ip }) {
  const mode = turnstileMode();
  if (mode === 'off') return { ok: true, skipped: true };
  if (mode === 'misconfigured') return { ok: false, code: 'unavailable' };
  if (typeof token !== 'string' || !token || token.length > 2048) return { ok: false, code: 'missing' };
  const t = CONFIG.turnstile;
  let d;
  try {
    const r = await fetch(t.verifyUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: t.secret, response: token, remoteip: ip && ip !== '?' ? ip : undefined, idempotency_key: crypto.randomUUID() }),
      signal: AbortSignal.timeout(8000),
    });
    d = await r.json();
  } catch { return { ok: false, code: 'unreachable' }; }
  if (!d || d.success !== true) {
    const codes = Array.isArray(d && d['error-codes']) ? d['error-codes'] : [];
    return { ok: false, code: codes.includes('timeout-or-duplicate') ? 'expired' : 'invalid' };
  }
  // Con le chiavi di prova Cloudflare non restituisce action e hostname reali.
  if (!isTestSecret(t.secret)) {
    if (action && d.action !== action) return { ok: false, code: 'invalid' };
    if (t.hostnames.length && !t.hostnames.includes(String(d.hostname || '').toLowerCase())) return { ok: false, code: 'invalid' };
  }
  return { ok: true };
}

module.exports = {
  CONFIG, LIMITS, PROD, loadSecret, hmac, sha256, randomToken, safeEqual, getCookie, appendCookie,
  readAid, ensureAid, clientIp, ipBucket, sameOrigin, RuntimeStore, rule, turnstileMode, verifyTurnstile,
};
