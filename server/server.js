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
 *   COOKIE_SECURE=1   imposta il cookie di sessione come Secure (da usare in HTTPS)
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'app');
const ADMIN_DIR = path.join(ROOT, 'admin');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const PORT = Number(process.env.PORT) || 8000;
const SESSION_HOURS = 12;
const MAX_JSON = 25 * 1024 * 1024; // gli upload arrivano in base64 dentro il JSON

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
const RESERVED_IDS = ['carte', 'nuova', 'importa'];
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
      votes.push({ id: uid('v_'), modeId: m.id, deviceId: 'demo-' + i, value: v, demo: true, at: m.date + 'T12:00:00.000Z' });
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
        { title: 'Voti', text: 'I voti sono anonimi: salviamo solo un codice casuale del dispositivo, così puoi modificare il tuo voto.' },
      ],
      privacyIsPlaceholder: true,
    },
    cards: w.MOVAT_CARDS.map((c) => ({ ...c, dialect: c.dialect || '', translation: c.translation || '', text: c.text || '', audio: c.audio || '', image: c.image || '', demo: true })),
    modes,
    votes,
    userCards: (w.MOVAT_USER_CARDS || []).map((c) => {
      let left = c.ratingSum;
      for (let i = 0; i < c.ratingCount; i++) {
        const v = Math.max(1, Math.min(5, Math.round(left / (c.ratingCount - i))));
        votes.push({ id: uid('v_'), cardId: c.id, deviceId: 'demo-' + i, value: v, demo: true, at: c.date + 'T12:00:00.000Z' });
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
    // Aggiornamento dei dati salvati con versioni precedenti.
    if (!Array.isArray(db.userCards)) db.userCards = [];
  } else {
    db = seedFromDemo();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    console.log('Creato', path.relative(ROOT, DB_FILE), 'con i contenuti dimostrativi.');
  }
  db.settings.cardMaker = normCardMaker(db.settings.cardMaker);
}

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
function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function isAuthed(req) {
  const t = getCookie(req, 'movat_admin');
  const exp = t && sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}
function sessionCookie(token, maxAge) {
  return `movat_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`;
}

/* Limite semplice di richieste per IP (login, proposte, voti). */
const buckets = new Map();
function rateLimited(req, key, max, windowMs) {
  const ip = req.socket.remoteAddress || '?';
  const k = key + ':' + ip, t = Date.now();
  const b = buckets.get(k) || { n: 0, reset: t + windowMs };
  if (t > b.reset) { b.n = 0; b.reset = t + windowMs; }
  b.n++; buckets.set(k, b);
  return b.n > max;
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
async function notifyNewProposal(mode, req) {
  const to = (db.settings.notifyEmails || '').split(/[,;\s]+/).filter(Boolean);
  if (!mailer || !to.length) return;
  const base = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
  const cards = Object.entries(mode.cards).map(([id, q]) => `- ${db.cards.find((c) => c.id === id)?.name || id} ×${q}`).join('\n');
  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER, to,
      subject: `MÖVAT! — nuova proposta: ${mode.title}`,
      text: `È arrivata una nuova modalità da controllare.\n\nNome: ${mode.title}\nNickname: ${mode.author}\nGiocatori: ${mode.players || '—'}\n\n${mode.description}\n\nCarte:\n${cards}\n\nApri il CMS: ${base}/admin/#/${mode.adminPath || 'modalita/' + mode.id}`,
    });
  } catch (e) { console.error('Invio email non riuscito:', e.message); }
}

/* ------------------------------------------------------------------ */
/* Helper HTTP                                                         */
/* ------------------------------------------------------------------ */
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/application\/json/.test(req.headers['content-type'] || '')) return reject(new HttpError(415, 'Serve un corpo JSON'));
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_JSON) { reject(new HttpError(413, 'File troppo grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new HttpError(400, 'JSON non valido')); } });
    req.on('error', reject);
  });
}
const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);

async function serveStatic(req, res, baseDir, relPath, { spa } = {}) {
  let rel = decodeURIComponent(relPath.split('?')[0]);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(baseDir, '.' + path.sep + rel);
  if (!file.startsWith(baseDir + path.sep) && file !== baseDir) return send(res, 403, 'Vietato');
  try {
    const st = await fsp.stat(file);
    if (st.isDirectory()) return serveStatic(req, res, baseDir, rel + '/', { spa });
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': /\.(html|js|css|json)$/.test(file) ? 'no-cache' : 'public, max-age=86400' };
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
function ratingFor(modeId, key = 'modeId') {
  let sum = 0, count = 0;
  for (const v of db.votes) if (v[key] === modeId) { sum += v.value; count++; }
  return { ratingSum: sum, ratingCount: count };
}
// Testi sotto le 4 voci della Home, modificabili dal CMS.
const HOME_SUBS = { ascolta: 'Le carte e ascolta il dialetto', scopri: 'Le modalità e carte create dagli utenti', crea: 'Le tue modalità di gioco', faq: 'Le risposte alle domande sul gioco' };
const homeSubsOf = (s) => Object.fromEntries(Object.keys(HOME_SUBS).map((k) => [k, (s.homeSubs && s.homeSubs[k]) || HOME_SUBS[k]]));
// Box "Contattaci" in fondo alle FAQ, modificabile dal CMS.
const CONTACT = { text: 'Non trovi la risposta? Contattaci!', email: 'a.ruggeri@busatrasportisrl.it', subject: 'Ho una domanda riguardo a Movat' };
const contactOf = (s) => ({ ...CONTACT, ...Object.fromEntries(Object.entries(s.contact || {}).filter(([, v]) => v)) });
function publicContent() {
  const s = db.settings;
  return {
    config: { cardRatio: Number(s.cardRatio) || 63 / 88, cardMaker: s.cardMaker, welcome: s.welcome, homeSubs: homeSubsOf(s), contact: contactOf(s), footerText: s.footerText, busaLogo: s.busaLogo || null, privacy: s.privacy, privacyIsPlaceholder: !!s.privacyIsPlaceholder },
    cards: db.cards.map(({ id, number, name, copies, color, icon, dialect, translation, text, audio, image }) =>
      ({ id, number, name, copies, color, icon, dialect: dialect || null, translation: translation || null, text: text || null, audio: audio || null, image: image || null })),
    modes: db.modes.filter((m) => m.status === 'published').map((m) => ({
      id: m.id, title: m.title, author: m.author, date: (m.publishedAt || m.createdAt).slice(0, 10), players: m.players,
      description: m.description, rules: m.rules, cards: m.cards, cover: m.cover || null, official: m.source === 'busa', icon: m.icon || null, iconScale: m.iconScale || 70, iconX: m.iconX || 0, iconY: m.iconY || 0, ...ratingFor(m.id),
    })),
    userCards: db.userCards.filter((c) => c.status === 'published').map((c) => ({
      id: c.id, title: c.title, dialect: c.dialect, translation: c.translation, text: c.text, author: c.author,
      date: (c.publishedAt || c.createdAt).slice(0, 10), updatedAt: c.updatedAt, ...ratingFor(c.id, 'cardId'),
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

on('POST', '/api/proposals', async (req) => {
  if (rateLimited(req, 'proposal', 10, 3600e3)) throw new HttpError(429, 'Troppe proposte in poco tempo. Riprova più tardi.');
  const b = await readJson(req);
  const title = str(b.title, 60), description = str(b.description, 600), author = str(b.nickname, 30);
  const email = str(b.email, 200);
  const errors = {};
  if (title.length < 3) errors.title = 'Nome mancante o troppo corto';
  if (description.length < 20) errors.description = 'Descrizione mancante o troppo corta';
  if (!author) errors.nickname = 'Nickname mancante';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Email non valida';
  if (!b.consent) errors.consent = 'Consenso mancante';
  const cards = cleanCards(b.cards);
  if (!Object.keys(cards).length) errors.cards = 'Nessuna carta selezionata';
  if (Object.keys(errors).length) throw Object.assign(new HttpError(422, 'Dati non validi'), { details: errors });
  const cover = await saveCover(b.cover);
  const mode = {
    id: uniqueId(title, db.modes), title, author, email, players: str(b.players, 20), description, rules: str(b.rules, 800),
    tried: str(b.tried, 20), cards, cover, status: 'pending', source: 'utente', startedFrom: str(b.startedFrom, 80), note: '',
    createdAt: now(), publishedAt: null, updatedAt: now(),
  };
  db.modes.push(mode); await save();
  notifyNewProposal(mode, req);
  return { ok: true };
});

on('POST', '/api/card-proposals', async (req) => {
  if (rateLimited(req, 'card-proposal', 10, 3600e3)) throw new HttpError(429, 'Troppe proposte in poco tempo. Riprova più tardi.');
  const b = await readJson(req);
  const L = db.settings.cardMaker.limits;
  const errors = {};
  const field = (k, required, label) => {
    const v = String(b[k] ?? '').trim();
    if (required && !v) errors[k] = `${label} mancante`;
    if (v.length > L[k]) errors[k] = `${label}: massimo ${L[k]} caratteri`;
    return v.slice(0, L[k]);
  };
  const title = field('title', true, 'Titolo'), dialect = field('dialect', true, 'Frase in dialetto');
  const translation = field('translation', false, 'Traduzione'), text = field('text', true, 'Testo della carta');
  const author = str(b.nickname, 30), email = str(b.email, 200);
  if (!author) errors.nickname = 'Nickname mancante';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Email non valida';
  if (!b.consent) errors.consent = 'Consenso mancante';
  if (Object.keys(errors).length) throw Object.assign(new HttpError(422, 'Dati non validi'), { details: errors });
  const card = {
    id: uniqueId(title, db.userCards), title, dialect, translation, text, author, email, note: str(b.note, 600), adminNote: '',
    status: 'pending', source: 'utente', createdAt: now(), publishedAt: null, updatedAt: now(),
  };
  db.userCards.push(card); await save();
  notifyNewProposal({ id: card.id, adminPath: 'carte-proposte/' + card.id, title: `[Carta] ${card.title}`, author, players: '', description: `${dialect}\n${translation}\n\n${text}`, cards: {} }, req);
  return { ok: true };
});

on('POST', '/api/votes', async (req) => {
  if (rateLimited(req, 'vote', 60, 600e3)) throw new HttpError(429, 'Troppi voti in poco tempo.');
  const b = await readJson(req);
  // Voto a una modalità (modeId) oppure a una carta dei giocatori (cardId).
  const key = b.cardId ? 'cardId' : 'modeId';
  const list = key === 'cardId' ? db.userCards : db.modes;
  const mode = list.find((m) => m.id === b[key] && m.status === 'published');
  if (!mode) throw new HttpError(404, key === 'cardId' ? 'Carta non trovata' : 'Modalità non trovata');
  const value = Math.round(Number(b.value));
  const deviceId = str(b.deviceId, 64);
  if (!(value >= 1 && value <= 5)) throw new HttpError(400, 'Il voto va da 1 a 5');
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(deviceId)) throw new HttpError(400, 'Dispositivo non valido');
  const existing = db.votes.find((v) => v[key] === mode.id && v.deviceId === deviceId);
  if (existing) { existing.value = value; existing.at = now(); } else db.votes.push({ id: uid('v_'), [key]: mode.id, deviceId, value, at: now() });
  await save();
  return { ok: true, ...ratingFor(mode.id, key) };
});

/* --- Autenticazione CMS --- */
on('POST', '/api/admin/login', async (req, _p, res) => {
  if (rateLimited(req, 'login', 10, 900e3)) throw new HttpError(429, 'Troppi tentativi. Riprova tra qualche minuto.');
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
const sourceHash = () => { try { return crypto.createHash('sha1').update(fs.readFileSync(__filename)).digest('hex'); } catch { return null; } };
const STARTED_HASH = sourceHash();
const restartNeeded = () => { const h = sourceHash(); return !!(h && STARTED_HASH && h !== STARTED_HASH); };
on('GET', '/api/admin/me', (req) => (isAuthed(req) ? { user: admin.user, passwordFromEnv: !!admin.fromEnv, restartNeeded: restartNeeded() } : Promise.reject(new HttpError(401, 'Accesso richiesto'))), { public: true });

/* --- Dati completi per il CMS --- */
on('GET', '/api/admin/data', () => ({
  ...db,
  modes: db.modes.map((m) => ({ ...m, ...ratingFor(m.id) })),
  userCards: db.userCards.map((c) => ({ ...c, ...ratingFor(c.id, 'cardId') })),
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
  for (const [k, max] of [['title', 60], ['author', 30], ['email', 200], ['players', 20], ['description', 1000], ['rules', 1500], ['tried', 20], ['note', 1000], ['cover', 300], ['icon', 300]]) {
    if (k in b) m[k] = str(b[k], max);
  }
  if ('cards' in b) m.cards = cleanCards(b.cards);
  if ('iconScale' in b) m.iconScale = iconScaleFrom(b.iconScale);
  if ('iconX' in b) m.iconX = iconOffsetFrom(b.iconX);
  if ('iconY' in b) m.iconY = iconOffsetFrom(b.iconY);
  if ('status' in b && STATUSES.includes(b.status) && b.status !== m.status) {
    m.status = b.status;
    if (b.status === 'published' && !m.publishedAt) m.publishedAt = now();
  }
  m.updatedAt = now(); await save(); return { ...m, ...ratingFor(m.id) };
});
on('DELETE', '/api/admin/modes/:id', async (req, p) => {
  db.modes = db.modes.filter((m) => m.id !== p.id);
  db.votes = db.votes.filter((v) => v.modeId !== p.id);
  await save(); return { ok: true };
});

/* Carte proposte dai giocatori */
on('PUT', '/api/admin/user-cards/:id', async (req, p) => {
  const c = db.userCards.find((x) => x.id === p.id); if (!c) throw new HttpError(404, 'Carta non trovata');
  const b = await readJson(req);
  const L = db.settings.cardMaker.limits;
  if ('title' in b && !str(b.title, L.title)) throw new HttpError(422, 'Il titolo è obbligatorio');
  for (const k of ['title', 'dialect', 'translation', 'text']) if (k in b) c[k] = str(b[k], L[k]);
  for (const [k, max] of [['author', 30], ['email', 200], ['adminNote', 1000]]) if (k in b) c[k] = str(b[k], max);
  if ('status' in b && STATUSES.includes(b.status) && b.status !== c.status) {
    c.status = b.status;
    if (b.status === 'published' && !c.publishedAt) c.publishedAt = now();
  }
  c.updatedAt = now(); await save(); return { ...c, ...ratingFor(c.id, 'cardId') };
});
on('DELETE', '/api/admin/user-cards/:id', async (req, p) => {
  db.userCards = db.userCards.filter((c) => c.id !== p.id);
  db.votes = db.votes.filter((v) => v.cardId !== p.id);
  await save(); return { ok: true };
});

/* Voti */
on('DELETE', '/api/admin/votes/:id', async (req, p) => { db.votes = db.votes.filter((v) => v.id !== p.id); await save(); return { ok: true }; });
on('POST', '/api/admin/votes/clear', async (req) => {
  const b = await readJson(req);
  const before = db.votes.length;
  db.votes = db.votes.filter((v) => !((!b.modeId || v.modeId === b.modeId) && (!b.cardId || v.cardId === b.cardId) && (!b.demoOnly || v.demo)));
  await save(); return { ok: true, removed: before - db.votes.length };
});

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
  await fsp.copyFile(DB_FILE, path.join(DATA_DIR, `db-prima-dell-import-${Date.now()}.json`));
  db = b; await save(); return { ok: true };
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
      // Le chiamate del CMS che modificano dati devono arrivare dal CMS stesso.
      if (isAdmin && req.method !== 'GET' && req.headers['x-movat-cms'] !== '1') throw new HttpError(403, 'Richiesta non consentita');
      const m = r.re.exec(p);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const out = await r.handler(req, params, res);
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
    send(res, status, { error: status === 500 ? 'Errore del server' : e.message, details: e.details });
  }
});

loadDb();
loadAdmin();
setupMailer();
server.listen(PORT, () => {
  console.log(`MÖVAT! in esecuzione:`);
  console.log(`  App pubblica  http://localhost:${PORT}/`);
  console.log(`  CMS           http://localhost:${PORT}/admin/`);
  // Indirizzi per aprire l'app da telefono o tablet collegati alla stessa rete Wi-Fi.
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  for (const ip of lan) console.log(`  Dal telefono  http://${ip}:${PORT}/   (stessa rete Wi-Fi)`);
});
