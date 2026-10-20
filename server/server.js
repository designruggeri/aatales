/*
 * MÖVAT! — server dell'app e del CMS.
 *
 *   node server/server.js
 *
 * - Serve l'app pubblica (cartella ../app) su "/" e il CMS su "/admin/".
 * - Conserva tutti i contenuti in data/db.json e i file caricati in data/uploads/.
 * - API pubbliche: contenuti, invio proposte, voti.
 * - API del CMS: protette da utente e password (sessione con cookie).
 *
 * Variabili d'ambiente (tutte facoltative):
 *   PORT              porta HTTP (predefinita 8000)
 *   DATA_DIR          cartella dei dati (predefinita ../data)
 *   ADMIN_USER        utente del CMS (altrimenti quello salvato in data/admin.json)
 *   ADMIN_PASSWORD    password del CMS (altrimenti quella salvata in data/admin.json)
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *                     per le email di notifica (serve il pacchetto "nodemailer")
 *   COOKIE_SECURE=1   imposta i cookie come Secure (automatico con NODE_ENV=production)
 *
 * Protezioni delle interazioni pubbliche (vedi server/security.js e il README):
 *   NODE_ENV=production            attiva i controlli obbligatori (antibot, cookie Secure)
 *   PUBLIC_URL                     indirizzo pubblico, es. https://movat.example.it (link nelle email, origine, hostname Turnstile)
 *   TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY, TURNSTILE_HOSTNAMES   Cloudflare Turnstile
 *   TRUST_PROXY_HOPS               numero di proxy fidati davanti al server (es. 1)
 *   ANON_ID_DAYS                   durata del cookie anonimo del browser (predefinita 180 giorni)
 *   RATE_LIMITS_JSON               per cambiare i limiti alle richieste
 *   MOVAT_SECRET                   segreto per firme e impronte (altrimenti data/secret.key)
 *   DATA_RETENTION_DAYS            dopo quanti giorni si cancellano i dati tecnici (predefiniti 30)
 *   MESSAGE_RETENTION_DAYS         dopo quanti giorni si cancellano i messaggi dei contatti (predefiniti 365)
 *   MAIL_OUTBOX=1                  solo sviluppo: le email vengono scritte in data/outbox.log invece di essere spedite
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const sec = require('./security');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'app');
const ADMIN_DIR = path.join(ROOT, 'admin');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const PORT = Number(process.env.PORT) || 8000;
const SESSION_HOURS = 12;
const MAX_JSON = 25 * 1024 * 1024; // gli upload del CMS arrivano in base64 dentro il JSON
const MAX_PUBLIC_JSON = 32 * 1024; // voti, contatti, proposte di carte
const MAX_PROPOSAL_JSON = 6 * 1024 * 1024; // proposta di modalità con copertina (max 4 MB in base64)
const RUNTIME_FILE = path.join(DATA_DIR, 'runtime-state.json');
const DAY = 86400e3;
const RETENTION_DAYS = Math.max(1, Number(process.env.DATA_RETENTION_DAYS) || 30);
const MESSAGE_RETENTION_DAYS = Math.max(7, Number(process.env.MESSAGE_RETENTION_DAYS) || 365);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.webm': 'audio/webm',
};
// Tipi accettati negli upload del CMS (niente SVG/HTML: verrebbero serviti dallo stesso dominio).
const UPLOAD_TYPES = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac',
  'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav', 'audio/ogg': '.ogg', 'audio/webm': '.webm',
};

/* ------------------------------------------------------------------ */
/* Database su file JSON (scritture atomiche, in coda)                 */
/* ------------------------------------------------------------------ */
let db;
let writing = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(db, null, 2);
  writing = writing.then(async () => {
    const tmp = DB_FILE + '.tmp';
    await fsp.writeFile(tmp, snapshot);
    await fsp.rename(tmp, DB_FILE);
  }).catch((e) => console.error('Errore di salvataggio:', e));
  return writing;
}
const uid = (prefix = '') => prefix + crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'voce';
}
// 'carte' è riservato: #/scopri/carte è la pagina delle carte dei giocatori.
const RESERVED_IDS = ['carte', 'nuova', 'importa', 'audio'];
function uniqueId(base, list) {
  let id = slugify(base), n = 2;
  while (RESERVED_IDS.includes(id) || list.some((x) => x.id === id)) id = `${slugify(base)}-${n++}`;
  return id;
}

function seedFromDemo() {
  // Primo avvio: importa i contenuti dimostrativi dell'app, così il CMS parte già popolato.
  const sandbox = { window: {} };
  const code = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'data.js'), 'utf8');
  new Function('window', code)(sandbox.window);
  const w = sandbox.window;
  const votes = [];
  const modes = w.MOVAT_MODES.map((m) => {
    // I voti di esempio diventano voti "dimostrativi" eliminabili dal CMS.
    let left = m.ratingSum;
    for (let i = 0; i < m.ratingCount; i++) {
      const remaining = m.ratingCount - i;
      const v = Math.max(1, Math.min(5, Math.round(left / remaining)));
      votes.push({ id: uid('v_'), modeId: m.id, voter: `demo-${m.id}-${i}`, value: v, demo: true, at: m.date + 'T12:00:00.000Z' });
      left -= v;
    }
    return {
      id: m.id, title: m.title, author: m.author, email: '', players: m.players, description: m.description, rules: m.rules || '',
      tried: '', cards: m.cards, status: 'published', source: 'demo', startedFrom: '', note: '',
      createdAt: m.date + 'T10:00:00.000Z', publishedAt: m.date + 'T12:00:00.000Z', updatedAt: now(),
    };
  });
  return {
    version: 1,
    settings: {
      welcome: 'Il gioco continua qui!',
      cardRatio: 63 / 88,
      footerText: 'MÖVAT! è un gioco di Busa Trasporti e Logistica',
      notifyEmails: '',
      privacy: [
        { title: 'Quali dati raccogliamo', text: 'Quando invii una modalità: nome della modalità, descrizione, regole, nickname pubblico e, se lo indichi, un indirizzo email privato.' },
        { title: 'Come li usiamo', text: 'Il nickname viene pubblicato insieme alla modalità dopo il controllo del team Busa. L’email serve solo per eventuali aggiornamenti e non viene mai pubblicata.' },
        { title: 'Voti', text: 'I voti sono anonimi: un cookie tecnico con un codice casuale riconosce il tuo browser, così puoi modificare il tuo voto. Non serve un account.' },
        { title: 'Protezione dallo spam', text: 'Per evitare invii automatici usiamo Cloudflare Turnstile, che al momento dell’invio verifica che non sei un robot. I dati tecnici per i limiti agli invii vengono cancellati dopo 30 giorni.' },
      ],
      privacyIsPlaceholder: true,
      proposalsPerDay: 3,
      rankMinVotes: 5,
    },
    cards: w.MOVAT_CARDS.map((c) => ({ ...c, dialect: c.dialect || '', translation: c.translation || '', text: c.text || '', audio: c.audio || '', image: c.image || '', demo: true })),
    modes,
    votes,
    userCards: (w.MOVAT_USER_CARDS || []).map((c) => {
      let left = c.ratingSum;
      for (let i = 0; i < c.ratingCount; i++) {
        const v = Math.max(1, Math.min(5, Math.round(left / (c.ratingCount - i))));
        votes.push({ id: uid('v_'), cardId: c.id, voter: `demo-${c.id}-${i}`, value: v, demo: true, at: c.date + 'T12:00:00.000Z' });
        left -= v;
      }
      return { id: c.id, title: c.title, dialect: c.dialect, translation: c.translation, text: c.text, author: c.author, email: '', note: '',
        status: 'published', source: 'demo', createdAt: c.date + 'T10:00:00.000Z', publishedAt: c.date + 'T12:00:00.000Z', updatedAt: now() };
    }),
    faqCategories: [...w.MOVAT_FAQ_CATEGORIES],
    faq: w.MOVAT_FAQ.map((f, i) => ({ id: f.id, category: f.category, q: f.q, a: f.a, cardId: f.cardId || '', showInList: f.showInList !== false, actionLabel: f.action?.label || '', actionHref: f.action?.href || '', order: i, demo: /segnaposto/i.test(f.q) })),
  };
}

function loadDb() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    db = seedFromDemo();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    console.log('Creato', path.relative(ROOT, DB_FILE), 'con i contenuti dimostrativi.');
  }
  const before = db.version;
  migrate(db);
  if (before !== db.version) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); console.log('Dati aggiornati alla versione', db.version); }
  db.settings.cardMaker = normCardMaker(db.settings.cardMaker);
}

/*
 * Migrazione dei dati salvati con versioni precedenti (idempotente).
 * v2: voti legati all'impronta dell'identificativo anonimo del browser (campo "voter"), un solo voto
 *     per browser e contenuto, esclusioni dal CMS; messaggi dei contatti; notifiche email con verifica.
 */
function migrate(d) {
  if (!Array.isArray(d.userCards)) d.userCards = [];
  if (!Array.isArray(d.messages)) d.messages = [];
  if (!Array.isArray(d.votes)) d.votes = [];
  d.settings.proposalsPerDay = clampInt(d.settings.proposalsPerDay, 1, 50, 3);
  d.settings.rankMinVotes = clampInt(d.settings.rankMinVotes, 1, 100, 5);
  for (const v of d.votes) {
    if (!v.voter) {
      // I vecchi codici dispositivo (scelti dal browser) non si usano più: restano come voti "precedenti", senza il codice in chiaro.
      v.voter = v.demo ? 'demo-' + (v.deviceId || v.id) : 'legacy-' + sec.hmac('legacy-device', String(v.deviceId || v.id)).slice(0, 24);
    }
    delete v.deviceId;
    if (!v.createdAt) v.createdAt = v.at;
    if (!('excluded' in v)) v.excluded = null;
    if (!Array.isArray(v.history)) v.history = [];
    if (!v.changes) v.changes = 0;
  }
  // Vincolo univoco: un solo voto per combinazione browser + contenuto (si tiene il più recente).
  const seen = new Map();
  for (const v of [...d.votes].sort((a, b) => String(b.at).localeCompare(String(a.at)))) {
    const k = voteKeyOf(v);
    if (!seen.has(k)) seen.set(k, v);
  }
  d.votes = d.votes.filter((v) => seen.get(voteKeyOf(v)) === v);
  for (const list of [d.modes, d.userCards]) for (const x of list) {
    if (!('votingSuspended' in x)) x.votingSuspended = false;
    if (!x.notify) x.notify = { status: 'none' };
  }
  d.version = 2;
}
const clampInt = (v, lo, hi, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : def; };
const voteTargetKey = (v) => (v.cardId ? 'card:' + v.cardId : 'mode:' + v.modeId);
const voteKeyOf = (v) => voteTargetKey(v) + '|' + v.voter;
// Indice dei voti per chiave univoca: le operazioni di lettura e scrittura sono sincrone, quindi
// due richieste simultanee dello stesso browser non possono creare due voti.
let voteIndex = new Map();
function rebuildVoteIndex() { voteIndex = new Map(db.votes.map((v) => [voteKeyOf(v), v])); }

/* Creazione carte: template, limiti di caratteri e posizione dei testi (modificabili dal CMS). */
const CARD_LIMITS = { title: 22, dialect: 70, translation: 80, text: 200 };
const CARD_LAYOUT = { titleY: 8, balloonTop: 14, balloonBottom: 40, tailX: 62, textTop: 62, textBottom: 93 };
function normCardMaker(cm = {}) {
  const clamp = (v, lo, hi, def) => { const n = Math.round(Number(v)); return n >= lo && n <= hi ? n : def; };
  const limits = {}, layout = {};
  for (const [k, d] of Object.entries(CARD_LIMITS)) limits[k] = clamp(cm.limits?.[k], 5, 600, d);
  for (const [k, d] of Object.entries(CARD_LAYOUT)) layout[k] = clamp(cm.layout?.[k], 0, 100, d);
  return { template: str(cm.template, 300), limits, layout };
}

/* ------------------------------------------------------------------ */
/* Credenziali e sessioni                                              */
/* ------------------------------------------------------------------ */
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') };
}
function checkPassword(pw, rec) {
  const h = crypto.scryptSync(String(pw), rec.salt, 64);
  const ref = Buffer.from(rec.hash, 'hex');
  return h.length === ref.length && crypto.timingSafeEqual(h, ref);
}
let admin; // { user, salt, hash, fromEnv }
function loadAdmin() {
  if (process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
    admin = { user: process.env.ADMIN_USER, ...hashPassword(process.env.ADMIN_PASSWORD), fromEnv: true };
    return;
  }
  if (fs.existsSync(ADMIN_FILE)) { admin = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')); return; }
  const pw = crypto.randomBytes(9).toString('base64url');
  admin = { user: 'admin', ...hashPassword(pw) };
  fs.writeFileSync(ADMIN_FILE, JSON.stringify(admin, null, 2), { mode: 0o600 });
  console.log('\n================ ACCESSO AL CMS ================');
  console.log('  Utente:   admin');
  console.log('  Password: ' + pw);
  console.log('  Annotala: non verrà più mostrata. Puoi cambiarla dal CMS.');
  console.log('================================================\n');
}
const sessions = new Map(); // token -> scadenza
function newSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_HOURS * 3600e3);
  return token;
}
const getCookie = sec.getCookie;
function isAuthed(req) {
  const t = getCookie(req, 'movat_admin');
  const exp = t && sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}
function sessionCookie(token, maxAge) {
  return `movat_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${sec.CONFIG.cookieSecure ? '; Secure' : ''}`;
}

/* Limiti alle richieste: contatori persistenti su disco (vedi security.js per soglie e finestre). */
let store; // sec.RuntimeStore, creato all'avvio
function waitText(sec_) {
  if (sec_ < 90) return 'qualche istante';
  const min = Math.ceil(sec_ / 60);
  if (min < 90) return `${min} minuti`;
  const h = Math.ceil(min / 60);
  return h < 30 ? `${h} ore` : 'domani';
}
function tooMany(r, msg) {
  return Object.assign(new HttpError(429, msg || `Hai fatto troppi invii in poco tempo. Riprova tra ${waitText(r.retryAfter)}.`), { retryAfter: r.retryAfter, code: 'rate-limit' });
}
function limit(rules, msg) { const r = store.take(rules); if (!r.ok) throw tooMany(r, typeof msg === 'function' ? msg(r) : msg); }
// Controlla senza contare (per non consumare il limite se poi la verifica antibot fallisce).
function peekLimit(rules, msg) {
  const t = Date.now();
  let wait = 0, which = null;
  for (const r of rules) { const b = store.buckets.get(r.key); if (b && b.reset > t && b.n >= r.max && b.reset - t > wait) { wait = b.reset - t; which = r.name; } }
  if (wait) { const r = { retryAfter: Math.ceil(wait / 1000), rule: which }; throw tooMany(r, typeof msg === 'function' ? msg(r) : msg); }
}

/* ------------------------------------------------------------------ */
/* Email di notifica (facoltative)                                     */
/* ------------------------------------------------------------------ */
let mailer = null;
function setupMailer() {
  if (!process.env.SMTP_HOST) return;
  try {
    const nodemailer = require('nodemailer');
    mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    console.log('Notifiche email attive tramite', process.env.SMTP_HOST);
  } catch {
    console.warn('SMTP configurato ma manca il pacchetto "nodemailer": esegui "npm install" nella cartella server.');
  }
}
// Solo sviluppo: con MAIL_OUTBOX=1 le email vengono scritte in data/outbox.log invece di essere spedite.
if (!mailer && process.env.MAIL_OUTBOX === '1' && !sec.PROD) {
  mailer = { outbox: true, async sendMail(m) { await fsp.appendFile(path.join(DATA_DIR, 'outbox.log'), JSON.stringify({ at: now(), ...m }) + '\n'); } };
}
const mailReady = () => !!mailer;
// Indirizzo pubblico per i link nelle email: PUBLIC_URL; in sviluppo si ricava dalla richiesta.
function baseUrl(req) {
  if (sec.CONFIG.publicUrl) return sec.CONFIG.publicUrl;
  if (sec.PROD || !req) return '';
  return `http://${req.headers.host}`;
}
async function sendMail(msg) {
  if (!mailer) return false;
  try { await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER || 'movat@localhost', ...msg }); return true; }
  catch (e) { console.error('Invio email non riuscito:', e.message); return false; }
}
const teamEmails = () => (db.settings.notifyEmails || '').split(/[,;\s]+/).filter((e) => EMAIL_RE.test(e));
async function notifyNewProposal(mode, req) {
  const to = teamEmails();
  if (!mailer || !to.length) return;
  const base = baseUrl(req);
  const cards = Object.entries(mode.cards).map(([id, q]) => `- ${db.cards.find((c) => c.id === id)?.name || id} ×${q}`).join('\n');
  try {
    await sendMail({
      to,
      subject: `MÖVAT! — nuova proposta: ${mode.title}`.replace(/[\r\n]+/g, ' '),
      text: `È arrivata una nuova proposta da controllare.\n\nNome: ${mode.title}\nNickname: ${mode.author}\nGiocatori: ${mode.players || '—'}\n\n${mode.description}\n\nCarte:\n${cards}\n\n${base ? `Apri il CMS: ${base}/admin/#/${mode.adminPath || 'modalita/' + mode.id}` : 'Apri il CMS per controllarla.'}`,
    });
  } catch (e) { console.error('Invio email non riuscito:', e.message); }
}

/* ------------------------------------------------------------------ */
/* Helper HTTP                                                         */
/* ------------------------------------------------------------------ */
// Intestazioni di sicurezza per tutte le risposte. La CSP blocca script e frame di altri siti
// (sono ammessi solo Cloudflare Turnstile e i font di Google).
const CSP = [
  "default-src 'self'", "script-src 'self' https://challenges.cloudflare.com", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", "media-src 'self' blob:", "connect-src 'self'",
  'frame-src https://challenges.cloudflare.com', "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': CSP };
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > max) { req.resume(); return reject(new HttpError(413, 'Richiesta troppo grande')); }
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(new HttpError(413, 'Richiesta troppo grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJson(req, max = req.maxBody || MAX_JSON) {
  if (!/application\/json/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Serve un corpo JSON');
  const raw = await readBody(req, max);
  let v;
  try { v = JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'Dati non validi'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'Dati non validi');
  return v;
}
async function readForm(req) {
  if (!/application\/x-www-form-urlencoded/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Modulo non valido');
  return Object.fromEntries(new URLSearchParams(await readBody(req, 4096)));
}
const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
const EMAIL_RE = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[a-z]{2,}$/i;
/*
 * Testo semplice inviato dal pubblico: deve essere una stringa (o assente), senza caratteri di controllo,
 * con a capo normalizzati. Restituisce undefined se il tipo non è valido.
 */
function plainText(v, { multiline = false } = {}) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return undefined;
  let t = v.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  t = multiline ? t.replace(/\t/g, ' ').replace(/\n{3,}/g, '\n\n') : t.replace(/\s+/g, ' ');
  return t.trim();
}
// Raccoglie gli errori dei campi: { valore, errori }.
function fieldsCheck() {
  const errors = {};
  const text = (b, k, { label, max, min = 0, required = false, multiline = false }) => {
    const v = plainText(b[k], { multiline });
    if (v === undefined) { errors[k] = `${label}: formato non valido`; return ''; }
    if (required && !v) errors[k] = `${label} mancante`;
    else if (v && v.length < min) errors[k] = `${label}: almeno ${min} caratteri`;
    else if (v.length > max) errors[k] = `${label}: massimo ${max} caratteri`;
    return v;
  };
  const email = (b, k = 'email', required = false) => {
    const v = plainText(b[k]);
    if (v === undefined || (v && (v.length > 200 || !EMAIL_RE.test(v)))) { errors[k] = 'Email non valida'; return ''; }
    if (required && !v) errors[k] = 'Email mancante';
    return v.toLowerCase();
  };
  const fail = () => { if (Object.keys(errors).length) throw Object.assign(new HttpError(422, 'Controlla i campi evidenziati'), { details: errors }); };
  return { errors, text, email, fail };
}

async function serveStatic(req, res, baseDir, relPath, { spa } = {}) {
  let rel = decodeURIComponent(relPath.split('?')[0]);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(baseDir, '.' + path.sep + rel);
  if (!file.startsWith(baseDir + path.sep) && file !== baseDir) return send(res, 403, 'Vietato');
  try {
    const st = await fsp.stat(file);
    if (st.isDirectory()) return serveStatic(req, res, baseDir, rel + '/', { spa });
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, ...SECURITY_HEADERS, 'Cache-Control': /\.(html|js|css|json)$/.test(file) ? 'no-cache' : 'public, max-age=86400' };
    // Supporto Range per l'audio (avanzamento nel player).
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range && type.startsWith('audio/')) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch {
    if (spa) return serveStatic(req, res, baseDir, 'index.html');
    send(res, 404, 'Non trovato');
  }
}

/* ------------------------------------------------------------------ */
/* Dati pubblici                                                       */
/* ------------------------------------------------------------------ */
// Media e conteggio calcolati sul server, solo con i voti validi (non esclusi dal CMS).
function ratingFor(modeId, key = 'modeId') {
  let sum = 0, count = 0;
  for (const v of db.votes) if (v[key] === modeId && !v.excluded) { sum += v.value; count++; }
  return { ratingSum: sum, ratingCount: count };
}
// Testi sotto le 4 voci della Home, modificabili dal CMS.
const HOME_SUBS = { ascolta: 'Le carte e ascolta il dialetto', scopri: 'Le modalità e carte create dagli utenti', crea: 'Le tue modalità di gioco', faq: 'Le risposte alle domande sul gioco' };
const homeSubsOf = (s) => Object.fromEntries(Object.keys(HOME_SUBS).map((k) => [k, (s.homeSubs && s.homeSubs[k]) || HOME_SUBS[k]]));
// Box "Contattaci" in fondo alle FAQ, modificabile dal CMS.
const CONTACT = { text: 'Non trovi la risposta? Contattaci!', email: 'a.ruggeri@busatrasportisrl.it', subject: 'Ho una domanda riguardo a Movat' };
const contactOf = (s) => ({ ...CONTACT, ...Object.fromEntries(Object.entries(s.contact || {}).filter(([, v]) => v)) });
// Grandezza delle carte singole a schermo: % della larghezza disponibile (maker: % dell'altezza dello schermo).
const CARD_SIZES = { list: [78, 40, 100], detail: [68, 40, 100], preview: [74, 40, 100], ucard: [82, 40, 100], maker: [32, 20, 60] };
const cardSizesOf = (v = {}) => Object.fromEntries(Object.entries(CARD_SIZES).map(([k, [d, min, max]]) => {
  const n = Math.round(Number(v && v[k])); return [k, n >= min && n <= max ? n : d];
}));
function publicContent() {
  const s = db.settings;
  return {
    config: {
      turnstileSiteKey: sec.turnstileMode() === 'on' ? sec.CONFIG.turnstile.siteKey : null, antibot: sec.turnstileMode(),
      mail: mailReady(), rankMinVotes: s.rankMinVotes || 5, proposalsPerDay: s.proposalsPerDay || 3,
      cardRatio: Number(s.cardRatio) || 63 / 88, cardMaker: s.cardMaker, welcome: s.welcome, homeSubs: homeSubsOf(s), contact: contactOf(s), cardSizes: cardSizesOf(s.cardSizes), footerText: s.footerText, busaLogo: s.busaLogo || null, privacy: s.privacy, privacyIsPlaceholder: !!s.privacyIsPlaceholder },
    cards: db.cards.map(({ id, number, name, copies, color, icon, dialect, translation, text, audio, image }) =>
      ({ id, number, name, copies, color, icon, dialect: dialect || null, translation: translation || null, text: text || null, audio: audio || null, image: image || null })),
    modes: db.modes.filter((m) => m.status === 'published').map((m) => ({
      id: m.id, title: m.title, author: m.author, date: (m.publishedAt || m.createdAt).slice(0, 10), players: m.players,
      description: m.description, rules: m.rules, cards: m.cards, cover: m.cover || null, official: m.source === 'busa', icon: m.icon || null, iconScale: m.iconScale || 70, iconX: m.iconX || 0, iconY: m.iconY || 0, votingOpen: !m.votingSuspended, ...ratingFor(m.id),
    })),
    userCards: db.userCards.filter((c) => c.status === 'published').map((c) => ({
      id: c.id, title: c.title, dialect: c.dialect, translation: c.translation, text: c.text, author: c.author,
      date: (c.publishedAt || c.createdAt).slice(0, 10), updatedAt: c.updatedAt, votingOpen: !c.votingSuspended, ...ratingFor(c.id, 'cardId'),
    })),
    faqCategories: db.faqCategories,
    faq: [...db.faq].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((f) => ({
      id: f.id, category: f.category, q: f.q, a: f.a, cardId: f.cardId || undefined, showInList: f.cardId ? f.showInList !== false : true,
      action: f.actionLabel && f.actionHref ? { label: f.actionLabel, href: f.actionHref } : undefined,
    })),
  };
}
function cleanCards(input) {
  const out = {};
  for (const [id, q] of Object.entries(input || {})) {
    const card = db.cards.find((c) => c.id === id);
    const n = Math.floor(Number(q));
    if (card && n > 0) out[id] = Math.min(n, Number(card.copies) || n);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */
const routes = [];
const on = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, ...opts });
};

/* --- API pubbliche --- */
on('GET', '/api/content', () => publicContent());

// Copertina inviata da un giocatore: solo JPG/PNG/WEBP veri (controllo dei primi byte), max 4 MB.
async function saveCover(cover) {
  if (!cover || !cover.data) return '';
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[cover.type];
  if (!ext) throw new HttpError(415, 'Copertina in un formato non supportato');
  const buf = Buffer.from(String(cover.data), 'base64');
  if (!buf.length || buf.length > 4 * 1024 * 1024) throw new HttpError(413, 'Copertina troppo grande');
  const magic = buf.subarray(0, 12);
  const ok = (ext === '.jpg' && magic[0] === 0xff && magic[1] === 0xd8)
    || (ext === '.png' && magic.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])))
    || (ext === '.webp' && magic.subarray(0, 4).toString() === 'RIFF' && magic.subarray(8, 12).toString() === 'WEBP');
  if (!ok) throw new HttpError(415, 'Il file della copertina non è un’immagine valida');
  const name = `cover-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}${ext}`;
  await fsp.writeFile(path.join(UPLOAD_DIR, name), buf);
  return 'uploads/' + name;
}

/* --- Protezioni comuni delle interazioni pubbliche --- */
// Origine, identificativo anonimo del browser (cookie firmato) e protezione dalle raffiche.
function publicCtx(req, res) {
  if (!sec.sameOrigin(req) || req.headers['x-movat-app'] !== '1') throw new HttpError(403, 'Richiesta non consentita');
  const aid = sec.ensureAid(req, res);
  const ip = sec.clientIp(req), ipKey = sec.ipBucket(ip);
  limit([sec.rule('burstPerAid', aid.hash), sec.rule('burstPerIp', ipKey)], 'Stai inviando troppe richieste. Aspetta qualche secondo e riprova.');
  return { aid, ip, ipKey };
}
const ANTIBOT_ERRORS = {
  missing: [403, 'Non siamo riusciti a verificare che tu non sia un robot. Riprova.'],
  invalid: [403, 'Non siamo riusciti a verificare che tu non sia un robot. Riprova.'],
  expired: [403, 'La verifica è scaduta. Riprova.'],
  unreachable: [503, 'Non riusciamo a completare la verifica in questo momento. Riprova tra poco.'],
  unavailable: [503, 'Gli invii sono momentaneamente non disponibili. Riprova più tardi.'],
};
async function antibot(b, action, ctx) {
  const r = await sec.verifyTurnstile(b.turnstile, { action, ip: ctx.ip });
  if (r.ok) return;
  const [status, msg] = ANTIBOT_ERRORS[r.code] || ANTIBOT_ERRORS.invalid;
  throw Object.assign(new HttpError(status, msg), { code: r.code === 'unavailable' || r.code === 'unreachable' ? 'antibot-unavailable' : 'antibot' });
}
/*
 * Idempotenza: un doppio clic o un nuovo tentativo dopo un errore di rete (stessa Idempotency-Key)
 * restituisce lo stesso esito senza creare un secondo invio. Le richieste ancora in corso vengono condivise.
 */
const inFlight = new Map();
async function idempotent(req, ctx, fn) {
  const k = String(req.headers['idempotency-key'] || '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(k)) return fn();
  // Chiave casuale generata dall'app: vale anche se due richieste simultanee arrivano prima che il browser abbia il cookie.
  const key = 'idem:' + sec.sha256(k).slice(0, 32);
  const done = store.get(key);
  if (done) return done;
  if (inFlight.has(key)) return inFlight.get(key);
  const p = fn();
  inFlight.set(key, p);
  try { const out = await p; store.set(key, out, DAY); return out; } finally { inFlight.delete(key); }
}
const proposalLimitMsg = (r) => (r.rule === 'proposalPerAid'
  ? `Puoi inviare al massimo ${db.settings.proposalsPerDay} proposte al giorno. Riprova tra ${waitText(r.retryAfter)}.`
  : `Sono arrivate troppe proposte da questa rete. Riprova tra ${waitText(r.retryAfter)}.`);
const proposalRules = (ctx) => [
  sec.rule('proposalPerAid', ctx.aid.hash, [db.settings.proposalsPerDay || 3, 86400]),
  sec.rule('proposalPerIp', ctx.ipKey), sec.rule('proposalPerIpShort', ctx.ipKey),
];
// Impronta del contenuto, per riconoscere invii ripetuti e segnalare nel CMS i possibili duplicati.
const normTxt = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const contentHash = (parts) => sec.sha256(parts.map(normTxt).join('|')).slice(0, 32);

// Email facoltativa: le notifiche partono solo dopo la verifica dell'indirizzo.
async function startEmailNotify(rec, email, wantsNotify, ctx, req) {
  const stopToken = sec.randomToken(24);
  rec.notify = { status: 'none', stopHash: sec.sha256(stopToken) };
  if (!email || !wantsNotify) return 'none';
  if (!mailReady()) { rec.notify.status = 'unavailable'; return 'unavailable'; }
  return sendVerification(rec, email, ctx, req, stopToken);
}
async function sendVerification(rec, email, ctx, req, stopToken) {
  const rules = [sec.rule('verifyPerEmail', sec.hmac('email', email).slice(0, 24)), sec.rule('verifyPerAid', ctx.aid.hash), sec.rule('verifyPerIp', ctx.ipKey)];
  if (!store.take(rules).ok) { rec.notify.status = 'pending'; return 'limit'; }
  const token = sec.randomToken(32);
  rec.notify = { ...rec.notify, status: 'pending', tokenHash: sec.sha256(token), tokenExp: Date.now() + 2 * DAY };
  if (!stopToken) { stopToken = sec.randomToken(24); rec.notify.stopHash = sec.sha256(stopToken); }
  const base = baseUrl(req);
  // Testo fisso: nessun contenuto inviato dall'utente, così il modulo non si può usare per spedire messaggi a terzi.
  const ok = await sendMail({
    to: email, subject: 'MÖVAT! — conferma il tuo indirizzo email',
    text: `Ciao,\n\nqualcuno ha inviato una proposta per il gioco MÖVAT! indicando questo indirizzo e chiedendo di ricevere aggiornamenti.\n\nSe sei stato tu, conferma qui (il link vale 48 ore e si può usare una sola volta):\n${base}/api/email/verify?t=${token}\n\nSe non sei stato tu, ignora questa email: non riceverai altri messaggi. Puoi anche bloccare subito le notifiche:\n${base}/api/email/stop?t=${stopToken}\n\nNon ti iscriviamo a newsletter né a comunicazioni promozionali.\n\nIl team Busa`,
  });
  return ok ? 'verification-sent' : 'failed';
}
const NOTIFY_MSG = {
  none: '', 'verification-sent': 'Ti abbiamo inviato un’email per confermare l’indirizzo: le notifiche partiranno solo dopo la conferma.',
  unavailable: 'Le notifiche via email non sono attive al momento: la proposta è comunque arrivata.',
  limit: 'Non possiamo inviare ora l’email di conferma: riprova più tardi dalla pagina di conferma.',
  failed: 'Non siamo riusciti a inviare l’email di conferma: la proposta è comunque arrivata.',
};

async function handleProposal(req, res, kind) {
  const ctx = publicCtx(req, res);
  const b = await readJson(req, kind === 'mode' ? MAX_PROPOSAL_JSON : MAX_PUBLIC_JSON);
  return idempotent(req, ctx, async () => {
    const f = fieldsCheck();
    let data;
    if (kind === 'mode') {
      const title = f.text(b, 'title', { label: 'Nome', max: 60, min: 3, required: true });
      const description = f.text(b, 'description', { label: 'Descrizione', max: 600, min: 20, required: true, multiline: true });
      const rules = f.text(b, 'rules', { label: 'Regole', max: 800, multiline: true });
      const players = normPlayers(b.players);
      if (players === undefined) f.errors.players = 'Numero di giocatori non valido';
      const tried = ['', 'Non ancora', 'Una volta', 'Più volte'].includes(b.tried ?? '') ? (b.tried || '') : (f.errors.tried = 'Valore non valido', '');
      const cards = proposalCards(b.cards, f.errors);
      const startedFrom = typeof b.startedFrom === 'string' && db.modes.some((m) => m.id === b.startedFrom && m.status === 'published') ? b.startedFrom : '';
      data = { title, description, rules, players, tried, cards, startedFrom };
    } else {
      const L = db.settings.cardMaker.limits;
      data = {
        title: f.text(b, 'title', { label: 'Titolo', max: L.title, required: true }),
        dialect: f.text(b, 'dialect', { label: 'Frase in dialetto', max: L.dialect, required: true, multiline: true }),
        translation: f.text(b, 'translation', { label: 'Traduzione', max: L.translation, multiline: true }),
        text: f.text(b, 'text', { label: 'Testo della carta', max: L.text, required: true, multiline: true }),
        note: f.text(b, 'note', { label: 'Note', max: 600, multiline: true }),
      };
    }
    const author = f.text(b, 'nickname', { label: 'Nickname', max: 30, required: true });
    const email = f.email(b);
    if (b.consent !== true) f.errors.consent = 'Consenso mancante';
    if (b.notify === true && !email) f.errors.email = 'Per ricevere le notifiche serve un indirizzo email';
    f.fail();

    const hash = kind === 'mode' ? contentHash([data.title, data.description]) : contentHash([data.title, data.dialect, data.text]);
    const list = kind === 'mode' ? db.modes : db.userCards;
    // Stesso contenuto dallo stesso browser nelle ultime 24 ore: non si crea un doppione.
    const dupKey = 'dup:' + ctx.aid.hash + ':' + kind + ':' + hash;
    const prevId = store.get(dupKey);
    if (prevId && list.some((x) => x.id === prevId)) return { ok: true, duplicate: true, message: 'Proposta già ricevuta: il team Busa la controllerà prima di pubblicarla.', notify: 'none' };

    peekLimit(proposalRules(ctx), proposalLimitMsg);
    await antibot(b, kind === 'mode' ? 'proposal' : 'card_proposal', ctx);
    limit(proposalRules(ctx), proposalLimitMsg);
    if (kind === 'mode') { // le carte potrebbero essere cambiate durante la verifica
      for (const id of Object.keys(data.cards)) if (!db.cards.some((c) => c.id === id)) throw new HttpError(422, 'Alcune carte non sono più disponibili: ricarica la pagina.');
    }

    const receipt = sec.randomToken(24);
    const base = { status: 'pending', source: 'utente', author, email, createdAt: now(), publishedAt: null, updatedAt: now(),
      contentHash: hash, aidHash: ctx.aid.hash, ipKey: ctx.ipKey, receiptHash: sec.sha256(receipt), votingSuspended: false };
    let rec;
    if (kind === 'mode') {
      const cover = await saveCover(b.cover);
      rec = { id: uniqueId(data.title, db.modes), ...data, cover, note: '', ...base };
      db.modes.push(rec);
    } else {
      rec = { id: uniqueId(data.title, db.userCards), ...data, adminNote: '', ...base };
      db.userCards.push(rec);
    }
    store.set(dupKey, rec.id, DAY);
    const notify = await startEmailNotify(rec, email, b.notify === true, ctx, req);
    await save();
    if (kind === 'mode') notifyNewProposal(rec, req);
    else notifyNewProposal({ id: rec.id, adminPath: 'carte-proposte/' + rec.id, title: `[Carta] ${rec.title}`, author, players: '', description: `${rec.dialect}\n${rec.translation}\n\n${rec.text}`, cards: {} }, req);
    return { ok: true, message: 'Proposta inviata! Il team Busa la controllerà prima di pubblicarla.', notify, notifyMessage: NOTIFY_MSG[notify] || '', receipt: email ? receipt : undefined };
  });
}
// Giocatori: "4", "2–5" oppure "5+" (stesse regole dell'app), da 1 a 99.
function normPlayers(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string') return undefined;
  const t = v.trim(); let m;
  if ((m = /^(\d{1,2})$/.exec(t))) return Number(m[1]) >= 1 ? String(Number(m[1])) : undefined;
  if ((m = /^(\d{1,2})\s*\+$/.exec(t))) return Number(m[1]) >= 1 ? `${Number(m[1])}+` : undefined;
  if ((m = /^(\d{1,2})\s*[–-]\s*(\d{1,2})$/.exec(t))) { const a = Number(m[1]), z = Number(m[2]); return a >= 1 && z > a ? `${a}–${z}` : undefined; }
  return undefined;
}
// Carte di una proposta: solo carte esistenti, quantità intere da 1 al numero di copie nella scatola.
function proposalCards(input, errors) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 500) { errors.cards = 'Carte non valide'; return out; }
  for (const [id, q] of Object.entries(input)) {
    const card = db.cards.find((c) => c.id === id);
    if (!card) { errors.cards = 'Una delle carte scelte non esiste più'; continue; }
    if (!Number.isInteger(q) || q < 1 || q > (Number(card.copies) || 1)) { errors.cards = `Quantità non valida per “${card.name}” (massimo ${card.copies})`; continue; }
    out[id] = q;
  }
  if (!errors.cards && !Object.keys(out).length) errors.cards = 'Nessuna carta selezionata';
  return out;
}
on('POST', '/api/proposals', (req, _p, res) => handleProposal(req, res, 'mode'));
on('POST', '/api/card-proposals', (req, _p, res) => handleProposal(req, res, 'card'));

/* --- Voti: uno per browser e contenuto, modificabile --- */
function voteTarget(b) {
  const type = b.cardId ? 'card' : 'mode';
  const id = b.cardId || b.modeId;
  if (typeof id !== 'string') return null;
  const target = (type === 'card' ? db.userCards : db.modes).find((x) => x.id === id && x.status === 'published');
  return target ? { type, id, key: type === 'card' ? 'cardId' : 'modeId', target } : null;
}
on('POST', '/api/votes', async (req, _p, res) => {
  const ctx = publicCtx(req, res);
  const b = await readJson(req, MAX_PUBLIC_JSON);
  const value = b.value;
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new HttpError(422, 'Il voto va da 1 a 5 stelle');
  let t = voteTarget(b);
  if (!t) throw new HttpError(404, 'Contenuto non trovato o non ancora pubblicato');
  if (t.target.votingSuspended) throw Object.assign(new HttpError(409, 'Le votazioni su questo contenuto sono momentaneamente sospese.'), { code: 'voting-suspended' });
  const vkey = `${t.type}:${t.id}|${ctx.aid.hash}`;
  const existing = voteIndex.get(vkey);
  const result = () => ({ ok: true, mine: value, ...ratingFor(t.id, t.key) });
  if (existing && existing.value === value) return { ...result(), unchanged: true };
  const rules = existing
    ? [sec.rule('voteChangePerAid', ctx.aid.hash), sec.rule('voteChangePerTarget', ctx.aid.hash + ':' + t.type + ':' + t.id), sec.rule('voteChangePerIp', ctx.ipKey)]
    : [sec.rule('voteNewPerAid', ctx.aid.hash), sec.rule('voteNewPerIp', ctx.ipKey)];
  const msg = existing ? 'Hai modificato questo voto troppe volte. Riprova più tardi.' : undefined;
  peekLimit(rules, msg);
  await antibot(b, 'vote', ctx);
  // Dopo la verifica (asincrona) si ricontrolla tutto: da qui in poi è sincrono, quindi senza corse.
  t = voteTarget(b);
  if (!t) throw new HttpError(404, 'Contenuto non trovato o non ancora pubblicato');
  if (t.target.votingSuspended) throw Object.assign(new HttpError(409, 'Le votazioni su questo contenuto sono momentaneamente sospese.'), { code: 'voting-suspended' });
  limit(rules, msg);
  const cur = voteIndex.get(vkey);
  let updated = false;
  if (cur) {
    if (cur.value !== value) { cur.value = value; cur.at = now(); cur.changes = (cur.changes || 0) + 1; cur.ipKey = ctx.ipKey; updated = true; }
  } else {
    const v = { id: uid('v_'), [t.key]: t.id, voter: ctx.aid.hash, value, createdAt: now(), at: now(), changes: 0, ipKey: ctx.ipKey, excluded: null, history: [] };
    db.votes.push(v); voteIndex.set(vkey, v);
  }
  await save();
  return { ...result(), updated };
});
// Assegna l'identificativo anonimo prima del primo invio (così un doppio clic non crea due identificativi).
on('POST', '/api/session', (req, _p, res) => {
  if (!sec.sameOrigin(req) || req.headers['x-movat-app'] !== '1') throw new HttpError(403, 'Richiesta non consentita');
  limit([sec.rule('myVotesPerIp', sec.ipBucket(sec.clientIp(req)))]);
  sec.ensureAid(req, res);
  return { ok: true };
});
// Voti già espressi da questo browser (per mostrarli e permettere di modificarli).
on('GET', '/api/my-votes', (req) => {
  limit([sec.rule('myVotesPerIp', sec.ipBucket(sec.clientIp(req)))]);
  const aid = sec.readAid(req);
  if (!aid) return { votes: {} };
  const votes = {};
  for (const v of db.votes) if (v.voter === aid.hash) votes[voteTargetKey(v)] = v.value;
  return { votes };
});

/* --- Modulo contatti --- */
const TOPICS = { domanda: 'Domanda sul gioco', segnalazione: 'Segnalazione', altro: 'Altro' };
on('POST', '/api/contact', async (req, _p, res) => {
  const ctx = publicCtx(req, res);
  const b = await readJson(req, MAX_PUBLIC_JSON);
  return idempotent(req, ctx, async () => {
    const f = fieldsCheck();
    const topic = Object.prototype.hasOwnProperty.call(TOPICS, b.topic) ? b.topic : (f.errors.topic = 'Scegli un argomento', 'altro');
    const message = f.text(b, 'message', { label: 'Messaggio', max: 2000, min: 10, required: true, multiline: true });
    const wantsReply = b.wantsReply === true;
    // L'email serve solo se si chiede una risposta.
    const email = f.email(b, 'email', wantsReply);
    f.fail();
    const rules = [sec.rule('contactPerAid', ctx.aid.hash), sec.rule('contactPerAidDay', ctx.aid.hash), sec.rule('contactPerIp', ctx.ipKey)];
    peekLimit(rules, (r) => `Hai già inviato diversi messaggi. Riprova tra ${waitText(r.retryAfter)}.`);
    await antibot(b, 'contact', ctx);
    limit(rules, (r) => `Hai già inviato diversi messaggi. Riprova tra ${waitText(r.retryAfter)}.`);
    const msg = { id: uid('msg_'), topic, message, wantsReply, email: wantsReply ? email : (email || ''), status: 'new', adminNote: '', createdAt: now(), aidHash: ctx.aid.hash, ipKey: ctx.ipKey };
    db.messages.push(msg);
    await save();
    // Avviso solo al team (indirizzi impostati nel CMS): nessuna copia viene inviata all'indirizzo indicato dall'utente.
    const to = teamEmails();
    if (mailReady() && to.length) {
      const base = baseUrl(req);
      sendMail({ to, subject: `MÖVAT! — nuovo messaggio: ${TOPICS[topic]}`, text: `È arrivato un nuovo messaggio dal modulo contatti (${TOPICS[topic]}${wantsReply ? ', chiede una risposta' : ''}).\n\n${base ? `Leggilo nel CMS: ${base}/admin/#/messaggi/${msg.id}` : 'Leggilo nel CMS, sezione Messaggi.'}` });
    }
    return { ok: true, message: wantsReply ? 'Ti risponderemo all’indirizzo indicato.' : 'Grazie! Il team Busa lo leggerà presto.' };
  });
});

/* --- Conferma email e disattivazione notifiche (link nelle email) --- */
// Il link apre una pagina con un pulsante: la conferma avviene con un POST, così i programmi che
// aprono in anticipo i link delle email non confermano l'indirizzo al posto della persona.
const findByHash = (field, hash) => [...db.modes, ...db.userCards].find((x) => x.notify && x.notify[field] && sec.safeEqual(x.notify[field], hash));
function emailPage(title, body, form) {
  const e = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return { __html: `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${e(title)} · MÖVAT!</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f8faf5;color:#182317;margin:0;padding:32px 16px}main{max-width:440px;margin:0 auto;background:#fff;border:1.5px solid #cbe0c2;border-radius:20px;padding:24px}h1{color:#1e6a00;font-size:24px;margin:0 0 8px}button,a.btn{display:inline-block;margin-top:16px;background:#439626;color:#fff;border:0;border-radius:14px;padding:12px 18px;font:700 16px system-ui,sans-serif;text-decoration:none;cursor:pointer}</style></head>
<body><main><h1>${e(title)}</h1><p>${e(body)}</p>${form ? `<form method="post" action="${e(form.action)}"><input type="hidden" name="t" value="${e(form.token)}"><button type="submit">${e(form.label)}</button></form>` : '<a class="btn" href="/">Vai all’app</a>'}</main></body></html>` };
}
const tokenParam = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{20,80}$/.test(v) ? v : '');
on('GET', '/api/email/verify', (req) => {
  const t = tokenParam(new URL(req.url, 'http://x').searchParams.get('t'));
  const rec = t && findByHash('tokenHash', sec.sha256(t));
  if (!rec || rec.notify.tokenExp < Date.now()) return emailPage('Link non valido', 'Il link è scaduto o è già stato usato.');
  return emailPage('Conferma il tuo indirizzo', 'Premi il pulsante per ricevere via email gli aggiornamenti sulla tua proposta.', { action: '/api/email/verify', token: t, label: 'Conferma l’indirizzo' });
});
on('POST', '/api/email/verify', async (req) => {
  if (!sec.sameOrigin(req)) throw new HttpError(403, 'Richiesta non consentita');
  limit([sec.rule('emailLinkPerIp', sec.ipBucket(sec.clientIp(req)))]);
  const t = tokenParam((await readForm(req)).t);
  const rec = t && findByHash('tokenHash', sec.sha256(t));
  if (!rec || rec.notify.tokenExp < Date.now()) return emailPage('Link non valido', 'Il link è scaduto o è già stato usato.');
  // Token monouso: viene cancellato subito.
  rec.notify = { status: 'verified', stopHash: rec.notify.stopHash, verifiedAt: now() };
  await save();
  return emailPage('Indirizzo confermato', 'Grazie! Ti scriveremo quando il team Busa avrà controllato la tua proposta. Ogni email contiene un link per disattivare le notifiche.');
});
on('GET', '/api/email/stop', (req) => {
  const t = tokenParam(new URL(req.url, 'http://x').searchParams.get('t'));
  const rec = t && findByHash('stopHash', sec.sha256(t));
  if (!rec) return emailPage('Link non valido', 'Il link non è valido.');
  if (rec.notify.status === 'off') return emailPage('Notifiche disattivate', 'Non riceverai altre email su questa proposta.');
  return emailPage('Disattiva le notifiche', 'Premi il pulsante per non ricevere più email su questa proposta.', { action: '/api/email/stop', token: t, label: 'Disattiva le notifiche' });
});
on('POST', '/api/email/stop', async (req) => {
  if (!sec.sameOrigin(req)) throw new HttpError(403, 'Richiesta non consentita');
  limit([sec.rule('emailLinkPerIp', sec.ipBucket(sec.clientIp(req)))]);
  const t = tokenParam((await readForm(req)).t);
  const rec = t && findByHash('stopHash', sec.sha256(t));
  if (!rec) return emailPage('Link non valido', 'Il link non è valido.');
  rec.notify = { status: 'off', stopHash: rec.notify.stopHash, stoppedAt: now() };
  await save();
  return emailPage('Notifiche disattivate', 'Non riceverai altre email su questa proposta.');
});
// Nuovo invio dell'email di conferma, dalla pagina "Proposta inviata" (serve la ricevuta segreta della proposta).
on('POST', '/api/email/resend', async (req, _p, res) => {
  const ctx = publicCtx(req, res);
  const b = await readJson(req, MAX_PUBLIC_JSON);
  const r = tokenParam(b.receipt);
  const rec = r && [...db.modes, ...db.userCards].find((x) => x.receiptHash && sec.safeEqual(x.receiptHash, sec.sha256(r)));
  if (!rec || !rec.email || !['pending', 'expired'].includes(rec.notify?.status)) throw new HttpError(404, 'Non c’è nessuna conferma in sospeso per questa proposta.');
  if (!mailReady()) throw new HttpError(503, 'Le notifiche via email non sono attive al momento.');
  const out = await sendVerification(rec, rec.email, ctx, req);
  await save();
  if (out === 'limit') throw tooMany({ retryAfter: 3600 }, 'Abbiamo già inviato diverse email di conferma. Riprova più tardi.');
  if (out !== 'verification-sent') throw new HttpError(503, 'Invio non riuscito. Riprova più tardi.');
  return { ok: true, message: 'Ti abbiamo inviato di nuovo l’email di conferma.' };
});

// Notifica all'autore quando la proposta viene pubblicata o rifiutata (solo indirizzi verificati).
async function notifyAuthor(rec, kind, status, req) {
  if (rec.notify?.status !== 'verified' || !rec.email || !mailReady()) return;
  const base = baseUrl(req);
  const what = kind === 'mode' ? 'modalità' : 'carta';
  const link = status === 'published' && base ? `\n\nLa trovi qui: ${base}/#/scopri/${kind === 'mode' ? rec.id : 'carte/' + rec.id}` : '';
  // Per il link di disattivazione si genera un nuovo token (nei dati c'è solo l'impronta di quello vecchio).
  const stop = sec.randomToken(24);
  rec.notify.stopHash = sec.sha256(stop);
  await sendMail({
    to: rec.email,
    subject: status === 'published' ? `MÖVAT! — la tua ${what} è stata pubblicata` : `MÖVAT! — aggiornamento sulla tua ${what}`,
    text: `Ciao ${rec.author},\n\n${status === 'published' ? `la tua ${what} “${rec.title}” è stata pubblicata in MÖVAT!.${link}` : `il team Busa ha controllato la tua ${what} “${rec.title}” e per ora ha deciso di non pubblicarla. Grazie per averla proposta!`}\n\nNon vuoi più ricevere email su questa proposta? ${base}/api/email/stop?t=${stop}\n\nIl team Busa`,
  });
  await save();
}

/* --- Autenticazione CMS --- */
on('POST', '/api/admin/login', async (req, _p, res) => {
  if (!sec.sameOrigin(req)) throw new HttpError(403, 'Richiesta non consentita');
  limit([sec.rule('loginPerIp', sec.ipBucket(sec.clientIp(req)))], 'Troppi tentativi. Riprova tra qualche minuto.');
  const b = await readJson(req);
  const ok = str(b.user, 100) === admin.user && checkPassword(str(b.password, 200), admin);
  if (!ok) { await new Promise((r) => setTimeout(r, 400)); throw new HttpError(401, 'Utente o password non corretti'); }
  res.setHeader('Set-Cookie', sessionCookie(newSession(), SESSION_HOURS * 3600));
  return { ok: true, user: admin.user };
}, { public: true });
on('POST', '/api/admin/logout', async (req, _p, res) => {
  sessions.delete(getCookie(req, 'movat_admin'));
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  return { ok: true };
}, { public: true });
// Se i file del server vengono aggiornati senza riavviarlo, il CMS mostra un avviso.
const sourceHash = () => { try { return crypto.createHash('sha1').update(fs.readFileSync(__filename)).update(fs.readFileSync(path.join(__dirname, 'security.js'))).digest('hex'); } catch { return null; } };
const STARTED_HASH = sourceHash();
const restartNeeded = () => { const h = sourceHash(); return !!(h && STARTED_HASH && h !== STARTED_HASH); };
on('GET', '/api/admin/me', (req) => (isAuthed(req) ? { user: admin.user, passwordFromEnv: !!admin.fromEnv, restartNeeded: restartNeeded(), security: securityStatus() } : Promise.reject(new HttpError(401, 'Accesso richiesto'))), { public: true });
// Stato delle protezioni, mostrato nel CMS (nessun segreto).
function securityStatus() {
  return {
    production: sec.PROD, antibot: sec.turnstileMode(), mail: mailReady() ? (mailer.outbox ? 'outbox' : 'smtp') : 'off',
    publicUrl: !!sec.CONFIG.publicUrl, turnstileHostnames: sec.CONFIG.turnstile.hostnames, trustProxyHops: sec.CONFIG.trustProxyHops,
    anonIdDays: sec.CONFIG.anonIdDays, retentionDays: RETENTION_DAYS, messageRetentionDays: MESSAGE_RETENTION_DAYS,
  };
}

/* --- Dati completi per il CMS --- */
// Al CMS non arrivano token né impronte complete: solo etichette brevi per riconoscere lo stesso browser o la stessa rete.
const tag = (h) => (h ? String(h).slice(0, 8) : '');
function adminProposal(x, list, kind) {
  const { aidHash, ipKey, receiptHash, notify, ...rest } = x;
  // Possibili duplicati: stesso contenuto o stesso titolo di un'altra proposta (solo segnalazione, nessuna esclusione automatica).
  const nt = normTxt(x.title);
  const dups = list.filter((y) => y.id !== x.id && ((x.contentHash && y.contentHash === x.contentHash) || (nt && normTxt(y.title) === nt)))
    .map((y) => ({ id: y.id, title: y.title, status: y.status, sameBrowser: !!(aidHash && y.aidHash === aidHash) }));
  return { ...rest, kind, browserTag: tag(aidHash), networkTag: tag(ipKey), notifyStatus: notify?.status || 'none', possibleDuplicates: dups,
    ...ratingFor(x.id, kind === 'mode' ? 'modeId' : 'cardId') };
}
on('GET', '/api/admin/data', () => ({
  ...db,
  modes: db.modes.map((m) => adminProposal(m, db.modes, 'mode')),
  userCards: db.userCards.map((c) => adminProposal(c, db.userCards, 'card')),
  votes: db.votes.map(({ voter, ipKey, ...v }) => ({ ...v, voterTag: voter.startsWith('demo-') ? 'demo' : voter.startsWith('legacy-') ? 'prec-' + voter.slice(7, 13) : tag(voter), networkTag: tag(ipKey) })),
  messages: db.messages.map(({ aidHash, ipKey, ...m }) => ({ ...m, browserTag: tag(aidHash), networkTag: tag(ipKey) })),
}));

/* Carte */
function cardFrom(b, existing = {}) {
  const number = Math.floor(Number(b.number));
  const copies = Math.floor(Number(b.copies));
  if (!(number >= 0)) throw new HttpError(422, 'Numero della carta non valido');
  if (!(copies >= 1 && copies <= 99)) throw new HttpError(422, 'Le copie devono essere almeno 1');
  if (!str(b.name, 60)) throw new HttpError(422, 'Il nome della carta è obbligatorio');
  return {
    ...existing, number, copies, name: str(b.name, 60), color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : (existing.color || '#439626'),
    icon: str(b.icon, 40) || existing.icon || 'style', dialect: str(b.dialect, 300), translation: str(b.translation, 300), text: str(b.text, 1500),
    audio: str(b.audio, 300), image: str(b.image, 300), demo: false,
  };
}
on('POST', '/api/admin/cards', async (req) => {
  const b = await readJson(req);
  const card = { id: uniqueId(b.name, db.cards), ...cardFrom(b) };
  if (db.cards.some((c) => c.number === card.number)) throw new HttpError(409, `Esiste già una carta con il numero ${card.number}`);
  db.cards.push(card); await save(); return card;
});
on('PUT', '/api/admin/cards/:id', async (req, p) => {
  const i = db.cards.findIndex((c) => c.id === p.id); if (i < 0) throw new HttpError(404, 'Carta non trovata');
  const b = await readJson(req);
  const card = cardFrom(b, db.cards[i]);
  if (db.cards.some((c) => c.number === card.number && c.id !== p.id)) throw new HttpError(409, `Esiste già una carta con il numero ${card.number}`);
  db.cards[i] = card; await save(); return card;
});
on('DELETE', '/api/admin/cards/:id', async (req, p) => {
  const used = db.modes.filter((m) => m.cards[p.id]);
  const url = new URL(req.url, 'http://x');
  if (used.length && url.searchParams.get('force') !== '1') throw new HttpError(409, `La carta è usata in ${used.length} modalità: ${used.map((m) => m.title).join(', ')}`);
  db.cards = db.cards.filter((c) => c.id !== p.id);
  for (const m of used) delete m.cards[p.id];
  db.faq.forEach((f) => { if (f.cardId === p.id) f.cardId = ''; });
  await save(); return { ok: true };
});

/* Modalità */
const STATUSES = ['pending', 'published', 'rejected'];
// Dimensione dell'icona nel cerchio verde, in % del diametro (30–130, predefinita 70).
const iconScaleFrom = (v) => { const n = Math.round(Number(v)); return n >= 30 && n <= 130 ? n : 70; };
// Spostamento dell'icona dal centro del cerchio, in % del diametro (−50…50, predefinito 0).
const iconOffsetFrom = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(-50, Math.min(50, n)) : 0; };
on('POST', '/api/admin/modes', async (req) => {
  const b = await readJson(req);
  if (!str(b.title, 60)) throw new HttpError(422, 'Il nome della modalità è obbligatorio');
  const status = STATUSES.includes(b.status) ? b.status : 'published';
  const mode = {
    id: uniqueId(b.title, db.modes), title: str(b.title, 60), author: str(b.author, 30) || 'Team Busa', email: str(b.email, 200),
    players: str(b.players, 20), description: str(b.description, 1000), rules: str(b.rules, 1500), tried: str(b.tried, 20),
    cards: cleanCards(b.cards), cover: str(b.cover, 300), icon: str(b.icon, 300), iconScale: iconScaleFrom(b.iconScale), iconX: iconOffsetFrom(b.iconX), iconY: iconOffsetFrom(b.iconY), status, source: 'busa', startedFrom: '', note: str(b.note, 1000),
    createdAt: now(), publishedAt: status === 'published' ? now() : null, updatedAt: now(),
  };
  db.modes.push(mode); await save(); return mode;
});
on('PUT', '/api/admin/modes/:id', async (req, p) => {
  const m = db.modes.find((x) => x.id === p.id); if (!m) throw new HttpError(404, 'Modalità non trovata');
  const b = await readJson(req);
  if ('title' in b && !str(b.title, 60)) throw new HttpError(422, 'Il nome della modalità è obbligatorio');
  // Se il team cambia l'email, le notifiche si fermano: il nuovo indirizzo non è verificato.
  if ('email' in b && str(b.email, 200) !== (m.email || '') && m.notify?.status && m.notify.status !== 'none') m.notify = { status: 'none', stopHash: m.notify.stopHash };
  for (const [k, max] of [['title', 60], ['author', 30], ['email', 200], ['players', 20], ['description', 1000], ['rules', 1500], ['tried', 20], ['note', 1000], ['cover', 300], ['icon', 300]]) {
    if (k in b) m[k] = str(b[k], max);
  }
  if ('cards' in b) m.cards = cleanCards(b.cards);
  if ('iconScale' in b) m.iconScale = iconScaleFrom(b.iconScale);
  if ('iconX' in b) m.iconX = iconOffsetFrom(b.iconX);
  if ('iconY' in b) m.iconY = iconOffsetFrom(b.iconY);
  if ('votingSuspended' in b) m.votingSuspended = b.votingSuspended === true || b.votingSuspended === 'true';
  let changed = null;
  if ('status' in b && STATUSES.includes(b.status) && b.status !== m.status) {
    if (m.status === 'pending') changed = b.status;
    m.status = b.status;
    if (b.status === 'published' && !m.publishedAt) m.publishedAt = now();
  }
  m.updatedAt = now(); await save();
  if (changed && changed !== 'pending') notifyAuthor(m, 'mode', changed, req);
  return adminProposal(m, db.modes, 'mode');
});
on('DELETE', '/api/admin/modes/:id', async (req, p) => {
  db.modes = db.modes.filter((m) => m.id !== p.id);
  db.votes = db.votes.filter((v) => v.modeId !== p.id); rebuildVoteIndex();
  await save(); return { ok: true };
});

/* Carte proposte dai giocatori */
on('PUT', '/api/admin/user-cards/:id', async (req, p) => {
  const c = db.userCards.find((x) => x.id === p.id); if (!c) throw new HttpError(404, 'Carta non trovata');
  const b = await readJson(req);
  const L = db.settings.cardMaker.limits;
  if ('title' in b && !str(b.title, L.title)) throw new HttpError(422, 'Il titolo è obbligatorio');
  for (const k of ['title', 'dialect', 'translation', 'text']) if (k in b) c[k] = str(b[k], L[k]);
  if ('email' in b && str(b.email, 200) !== (c.email || '') && c.notify?.status && c.notify.status !== 'none') c.notify = { status: 'none', stopHash: c.notify.stopHash };
  for (const [k, max] of [['author', 30], ['email', 200], ['adminNote', 1000]]) if (k in b) c[k] = str(b[k], max);
  if ('votingSuspended' in b) c.votingSuspended = b.votingSuspended === true || b.votingSuspended === 'true';
  let changed = null;
  if ('status' in b && STATUSES.includes(b.status) && b.status !== c.status) {
    if (c.status === 'pending') changed = b.status;
    c.status = b.status;
    if (b.status === 'published' && !c.publishedAt) c.publishedAt = now();
  }
  c.updatedAt = now(); await save();
  if (changed && changed !== 'pending') notifyAuthor(c, 'card', changed, req);
  return adminProposal(c, db.userCards, 'card');
});
on('DELETE', '/api/admin/user-cards/:id', async (req, p) => {
  db.userCards = db.userCards.filter((c) => c.id !== p.id);
  db.votes = db.votes.filter((v) => v.cardId !== p.id); rebuildVoteIndex();
  await save(); return { ok: true };
});

/* Voti */
// Esclusione e ripristino: il voto resta registrato (con il motivo), ma non entra in media, conteggi e classifiche.
on('POST', '/api/admin/votes/:id/exclude', async (req, p) => {
  const v = db.votes.find((x) => x.id === p.id); if (!v) throw new HttpError(404, 'Voto non trovato');
  const reason = str((await readJson(req)).reason, 300);
  if (!reason) throw new HttpError(422, 'Indica il motivo dell’esclusione');
  v.excluded = { reason, at: now(), by: admin.user };
  v.history = [...(v.history || []), { action: 'exclude', reason, at: now(), by: admin.user }].slice(-20);
  await save(); return { ok: true };
});
on('POST', '/api/admin/votes/:id/restore', async (req, p) => {
  const v = db.votes.find((x) => x.id === p.id); if (!v) throw new HttpError(404, 'Voto non trovato');
  const reason = str((await readJson(req)).reason, 300);
  if (!reason) throw new HttpError(422, 'Indica il motivo del ripristino');
  v.excluded = null;
  v.history = [...(v.history || []), { action: 'restore', reason, at: now(), by: admin.user }].slice(-20);
  await save(); return { ok: true };
});
on('DELETE', '/api/admin/votes/:id', async (req, p) => { db.votes = db.votes.filter((v) => v.id !== p.id); rebuildVoteIndex(); await save(); return { ok: true }; });
on('POST', '/api/admin/votes/clear', async (req) => {
  const b = await readJson(req);
  const before = db.votes.length;
  db.votes = db.votes.filter((v) => !((!b.modeId || v.modeId === b.modeId) && (!b.cardId || v.cardId === b.cardId) && (!b.demoOnly || v.demo)));
  rebuildVoteIndex();
  await save(); return { ok: true, removed: before - db.votes.length };
});

/* Messaggi del modulo contatti (visibili solo nel CMS) */
on('PUT', '/api/admin/messages/:id', async (req, p) => {
  const m = db.messages.find((x) => x.id === p.id); if (!m) throw new HttpError(404, 'Messaggio non trovato');
  const b = await readJson(req);
  if (['new', 'read', 'answered', 'archived'].includes(b.status)) m.status = b.status;
  if ('adminNote' in b) m.adminNote = str(b.adminNote, 1000);
  m.updatedAt = now(); await save(); return { ok: true };
});
on('DELETE', '/api/admin/messages/:id', async (req, p) => { db.messages = db.messages.filter((m) => m.id !== p.id); await save(); return { ok: true }; });

/* FAQ */
function faqFrom(b, existing = {}) {
  if (!str(b.q, 300)) throw new HttpError(422, 'La domanda è obbligatoria');
  const a = (Array.isArray(b.a) ? b.a : String(b.a || '').split(/\n\s*\n/)).map((x) => str(x, 2000)).filter(Boolean);
  if (!a.length) throw new HttpError(422, 'La risposta è obbligatoria');
  const category = db.faqCategories.includes(b.category) ? b.category : db.faqCategories[0];
  const cardId = db.cards.some((c) => c.id === b.cardId) ? b.cardId : '';
  // Una FAQ collegata a una carta può comparire solo sulla carta, senza entrare nella lista FAQ.
  const showInList = !cardId || !(b.showInList === false || b.showInList === 'false' || b.showInList === 'card');
  return { ...existing, q: str(b.q, 300), a, category, cardId, showInList,
    actionLabel: str(b.actionLabel, 40), actionHref: str(b.actionHref, 300), demo: false };
}
on('POST', '/api/admin/faq', async (req) => {
  const b = await readJson(req);
  const f = { id: uid('faq_'), ...faqFrom(b), order: Math.max(-1, ...db.faq.map((x) => x.order ?? 0)) + 1 };
  db.faq.push(f); await save(); return f;
});
on('PUT', '/api/admin/faq/:id', async (req, p) => {
  const i = db.faq.findIndex((f) => f.id === p.id); if (i < 0) throw new HttpError(404, 'Domanda non trovata');
  db.faq[i] = faqFrom(await readJson(req), db.faq[i]); await save(); return db.faq[i];
});
on('DELETE', '/api/admin/faq/:id', async (req, p) => { db.faq = db.faq.filter((f) => f.id !== p.id); await save(); return { ok: true }; });
on('POST', '/api/admin/faq-order', async (req) => {
  const { ids } = await readJson(req);
  (ids || []).forEach((id, i) => { const f = db.faq.find((x) => x.id === id); if (f) f.order = i; });
  await save(); return { ok: true };
});
on('PUT', '/api/admin/faq-categories', async (req) => {
  const { categories, renames } = await readJson(req);
  const list = [...new Set((categories || []).map((c) => str(c, 40)).filter(Boolean))];
  if (!list.length) throw new HttpError(422, 'Serve almeno una categoria');
  for (const [from, to] of Object.entries(renames || {})) db.faq.forEach((f) => { if (f.category === from) f.category = str(to, 40); });
  db.faq.forEach((f) => { if (!list.includes(f.category)) f.category = list[0]; });
  db.faqCategories = list; await save(); return { ok: true, categories: list };
});

/* Impostazioni e testi */
on('PUT', '/api/admin/settings', async (req) => {
  const b = await readJson(req);
  const s = db.settings;
  if ('welcome' in b) s.welcome = str(b.welcome, 80) || 'Il gioco continua qui!';
  if ('footerText' in b) s.footerText = str(b.footerText, 200);
  for (const k of Object.keys(HOME_SUBS)) {
    if (`homeSub_${k}` in b) s.homeSubs = { ...homeSubsOf(s), [k]: str(b[`homeSub_${k}`], 80) || HOME_SUBS[k] };
  }
  if ('busaLogo' in b) s.busaLogo = str(b.busaLogo, 300);
  if ('cardSizes' in b) s.cardSizes = cardSizesOf(b.cardSizes);
  if ('contactText' in b) s.contact = { ...contactOf(s), text: str(b.contactText, 80) || CONTACT.text };
  if ('contactSubject' in b) s.contact = { ...contactOf(s), subject: str(b.contactSubject, 120) || CONTACT.subject };
  if ('contactEmail' in b) {
    const e = str(b.contactEmail, 200);
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(422, 'L’email di contatto non è valida');
    s.contact = { ...contactOf(s), email: e || CONTACT.email };
  }
  if ('cardMaker' in b) s.cardMaker = normCardMaker(b.cardMaker);
  if ('notifyEmails' in b) s.notifyEmails = str(b.notifyEmails, 500);
  if ('cardRatio' in b) { const r = Number(b.cardRatio); if (r > 0.3 && r < 3) s.cardRatio = r; }
  if ('proposalsPerDay' in b) s.proposalsPerDay = clampInt(b.proposalsPerDay, 1, 50, s.proposalsPerDay || 3);
  if ('rankMinVotes' in b) s.rankMinVotes = clampInt(b.rankMinVotes, 1, 100, s.rankMinVotes || 5);
  if ('privacy' in b && Array.isArray(b.privacy)) {
    s.privacy = b.privacy.map((x) => ({ title: str(x.title, 120), text: str(x.text, 5000) })).filter((x) => x.title || x.text);
    s.privacyIsPlaceholder = !!b.privacyIsPlaceholder;
  }
  await save(); return s;
});
on('PUT', '/api/admin/password', async (req) => {
  if (admin.fromEnv) throw new HttpError(400, 'La password è impostata dalle variabili d’ambiente del server: va cambiata lì.');
  const b = await readJson(req);
  if (!checkPassword(str(b.current, 200), admin)) throw new HttpError(401, 'La password attuale non è corretta');
  if (str(b.next, 200).length < 10) throw new HttpError(422, 'La nuova password deve avere almeno 10 caratteri');
  admin = { user: str(b.user, 100) || admin.user, ...hashPassword(str(b.next, 200)) };
  fs.writeFileSync(ADMIN_FILE, JSON.stringify(admin, null, 2), { mode: 0o600 });
  return { ok: true, user: admin.user };
});

/* Upload di immagini e audio */
on('POST', '/api/admin/upload', async (req) => {
  const b = await readJson(req);
  const ext = UPLOAD_TYPES[String(b.type || '').toLowerCase()];
  if (!ext) throw new HttpError(415, 'Formato non supportato. Usa PNG, JPG, WEBP, GIF per le immagini; MP3, M4A, WAV, OGG per l’audio.');
  const buf = Buffer.from(String(b.data || ''), 'base64');
  if (!buf.length) throw new HttpError(400, 'File vuoto');
  const name = `${Date.now().toString(36)}-${slugify(path.parse(String(b.name || 'file')).name)}${ext}`;
  await fsp.writeFile(path.join(UPLOAD_DIR, name), buf);
  return { url: 'uploads/' + name, size: buf.length };
});

/* Backup */
on('GET', '/api/admin/export', (req, _p, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="movat-backup-${now().slice(0, 10)}.json"`);
  return db;
});
on('POST', '/api/admin/import', async (req) => {
  const b = await readJson(req);
  for (const k of ['settings', 'cards', 'modes', 'votes', 'faqCategories', 'faq']) if (!(k in b)) throw new HttpError(422, `Backup non valido: manca "${k}"`);
  if (!Array.isArray(b.userCards)) b.userCards = [];
  b.settings.cardMaker = normCardMaker(b.settings.cardMaker);
  migrate(b);
  await fsp.copyFile(DB_FILE, path.join(DATA_DIR, `db-prima-dell-import-${Date.now()}.json`));
  db = b; rebuildVoteIndex(); await save(); return { ok: true };
});

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p.startsWith('/api/')) {
      const r = routes.find((x) => x.method === req.method && x.re.test(p));
      if (!r) throw new HttpError(404, 'Endpoint non trovato');
      const isAdmin = p.startsWith('/api/admin/');
      if (isAdmin && !r.public && !isAuthed(req)) throw new HttpError(401, 'Accesso richiesto');
      // Le chiamate del CMS che modificano dati devono arrivare dal CMS stesso (header dedicato + stessa origine).
      if (isAdmin && req.method !== 'GET' && (req.headers['x-movat-cms'] !== '1' || !sec.sameOrigin(req))) throw new HttpError(403, 'Richiesta non consentita');
      req.maxBody = isAdmin ? MAX_JSON : MAX_PUBLIC_JSON;
      const m = r.re.exec(p);
      let params;
      try { params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); } catch { throw new HttpError(400, 'Indirizzo non valido'); }
      const out = await r.handler(req, params, res);
      if (out && out.__html) return send(res, 200, out.__html, { 'Content-Type': 'text/html; charset=utf-8' });
      return send(res, 200, out ?? { ok: true });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Metodo non consentito');
    if (p === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
    if (p.startsWith('/admin/')) return serveStatic(req, res, ADMIN_DIR, p.slice('/admin/'.length));
    if (p.startsWith('/uploads/')) return serveStatic(req, res, UPLOAD_DIR, p.slice('/uploads/'.length));
    return serveStatic(req, res, PUBLIC_DIR, p.slice(1));
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (res.headersSent) return res.end();
    send(res, status, { error: status === 500 ? 'Errore del server' : e.message, details: e.details, code: e.code, retryAfter: e.retryAfter },
      e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : {});
  }
});

/* ------------------------------------------------------------------ */
/* Conservazione dei dati tecnici                                      */
/* ------------------------------------------------------------------ */
// Impronte di rete e del browser servono solo per limiti e controllo degli abusi: dopo RETENTION_DAYS
// si cancellano. L'impronta del browser resta solo sui voti (serve a evitare voti doppi finché il voto esiste).
function cleanup() {
  const t = Date.now(), old = (iso, days) => iso && t - Date.parse(iso) > days * DAY;
  let n = 0;
  for (const v of db.votes) if (v.ipKey && old(v.at, RETENTION_DAYS)) { delete v.ipKey; n++; }
  for (const x of [...db.modes, ...db.userCards]) {
    if ((x.ipKey || x.aidHash) && old(x.createdAt, RETENTION_DAYS)) { delete x.ipKey; delete x.aidHash; n++; }
    if (x.receiptHash && old(x.createdAt, 7)) { delete x.receiptHash; n++; }
    if (x.notify?.tokenHash && x.notify.tokenExp < t) { x.notify = { status: 'expired', stopHash: x.notify.stopHash }; n++; }
    // Email delle proposte rifiutate: cancellata dopo 180 giorni.
    if (x.status === 'rejected' && x.email && old(x.updatedAt || x.createdAt, 180)) { x.email = ''; x.notify = { status: 'none' }; n++; }
  }
  for (const m of db.messages) if ((m.ipKey || m.aidHash) && old(m.createdAt, RETENTION_DAYS)) { delete m.ipKey; delete m.aidHash; n++; }
  const before = db.messages.length;
  db.messages = db.messages.filter((m) => !old(m.createdAt, MESSAGE_RETENTION_DAYS));
  n += before - db.messages.length;
  if (n) save();
}

fs.mkdirSync(DATA_DIR, { recursive: true });
sec.loadSecret(DATA_DIR);
store = new sec.RuntimeStore(RUNTIME_FILE);
loadDb();
rebuildVoteIndex();
loadAdmin();
setupMailer();
cleanup();
setInterval(cleanup, 6 * 3600e3).unref();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { store.flush(); process.exit(0); });
// Avvisi di configurazione: in produzione le protezioni non vengono mai disattivate in silenzio.
{
  const ts = sec.turnstileMode();
  if (ts === 'misconfigured') console.error('ATTENZIONE: NODE_ENV=production ma mancano TURNSTILE_SITE_KEY e TURNSTILE_SECRET_KEY. Voti, proposte e contatti verranno rifiutati finché non le imposti.');
  else if (ts === 'off') console.warn('Antibot (Cloudflare Turnstile) non configurato: in sviluppo i controlli antibot sono saltati. In produzione sono obbligatori.');
  if (sec.PROD && !sec.CONFIG.publicUrl) console.warn('ATTENZIONE: imposta PUBLIC_URL (es. https://movat.example.it): serve per i link nelle email e per il controllo dell’hostname di Turnstile.');
  if (!mailReady()) console.log('Email non configurate: le proposte arrivano comunque, ma le notifiche agli autori non sono attive.');
}
server.listen(PORT, () => {
  console.log(`MÖVAT! in esecuzione:`);
  console.log(`  App pubblica  http://localhost:${PORT}/`);
  console.log(`  CMS           http://localhost:${PORT}/admin/`);
  // Indirizzi per aprire l'app da telefono o tablet collegati alla stessa rete Wi-Fi.
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  for (const ip of lan) console.log(`  Dal telefono  http://${ip}:${PORT}/   (stessa rete Wi-Fi)`);
});
