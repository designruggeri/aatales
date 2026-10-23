// Server HTTP + WebSocket: display pubblico (sola lettura), telecomando (credenziale abbinata), CMS (password).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import { openDb, getSetting, setSetting, audit, type DB } from './db.js';
import { Engine, GameError } from './engine.js';
import { Admin } from './admin.js';
import * as auth from './auth.js';
import {
  deleteBatch,
  exportCardsCsv,
  exportCardsJson,
  generateBatch,
  getCardsByIds,
  importCards,
  listBatches,
  listCards,
  markPrinted,
  resolveCodes,
  MAX_PER_BATCH,
} from './cards.js';
import { renderCardsPdf, sanitizeProfile, layoutInfo, DEFAULT_PROFILE, type PrintProfile } from './pdf.js';
import { autoBackup, createBackupZip, validateBackup } from './backup.js';
import { createDemo } from './demo.js';
import { CLIENT_DIST } from './paths.js';
import type { ControlState, PublicState } from '../../shared/types.js';

export interface ServerOptions {
  dataDir: string;
  port?: number;
  host?: string;
  adminPassword?: string;
  cookieSecure?: boolean;
  log?: (msg: string) => void;
}

export interface Ctx {
  dataDir: string;
  uploadsDir: string;
  dbFile: string;
  db: DB;
  engine: Engine;
  admin: Admin;
  firstPassword: string | null;
}

const IMAGE_TYPES: [string, (b: Buffer) => boolean][] = [
  ['png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['webp', (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'],
  ['gif', (b) => b.subarray(0, 4).toString() === 'GIF8'],
];
const AUDIO_TYPES: [string, (b: Buffer) => boolean][] = [
  ['mp3', (b) => b.subarray(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)],
  ['wav', (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WAVE'],
  ['ogg', (b) => b.subarray(0, 4).toString() === 'OggS'],
  ['m4a', (b) => b.subarray(4, 8).toString() === 'ftyp'],
];
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
};

export function lanAddresses(port: number): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${port}`);
  }
  return out;
}

export function createTombolaServer(opts: ServerOptions) {
  const log = opts.log ?? ((m: string) => console.log(m));
  const dataDir = path.resolve(opts.dataDir);
  const uploadsDir = path.join(dataDir, 'uploads');
  const dbFile = path.join(dataDir, 'tombola.sqlite');
  fs.mkdirSync(uploadsDir, { recursive: true });
  let db = openDb(dbFile);
  const engine = new Engine(db);

  const copyUpload = (rel: string): string | null => {
    const src = safeUploadPath(rel);
    if (!src || !fs.existsSync(src)) return null;
    const kind = rel.split('/')[0];
    const nrel = `${kind}/${crypto.randomUUID()}${path.extname(rel)}`;
    fs.copyFileSync(src, path.join(uploadsDir, nrel));
    return nrel;
  };
  const admin = new Admin(engine, copyUpload);
  const ctx: Ctx = { dataDir, uploadsDir, dbFile, db, engine, admin, firstPassword: auth.ensureAdminPassword(db, opts.adminPassword) };

  function safeUploadPath(rel: string): string | null {
    if (!/^(prizes|numbers|branding)\/[\w-]+\.(png|jpg|webp|gif|mp3|wav|ogg|m4a)$/.test(rel)) return null;
    return path.join(uploadsDir, rel);
  }
  function saveUpload(kind: 'prizes' | 'numbers' | 'branding', buf: Buffer, allowed: 'image' | 'audio'): string {
    if (!buf?.length) throw new GameError('File vuoto');
    const types = allowed === 'image' ? IMAGE_TYPES : AUDIO_TYPES;
    const t = types.find(([, test]) => test(buf));
    if (!t) throw new GameError(allowed === 'image' ? 'Immagine non valida: usa PNG, JPG, WEBP o GIF' : 'Audio non valido: usa MP3, WAV, OGG o M4A');
    fs.mkdirSync(path.join(uploadsDir, kind), { recursive: true });
    const rel = `${kind}/${crypto.randomUUID()}.${t[0]}`;
    fs.writeFileSync(path.join(uploadsDir, rel), buf);
    return rel;
  }
  function removeUpload(rel: string | null) {
    if (!rel) return;
    const p = safeUploadPath(rel);
    if (!p) return;
    // Il file si elimina solo se nessun altro record lo usa (le partite duplicate copiano il file).
    const used =
      db.prepare('SELECT 1 FROM prizes WHERE image_path=?').get(rel) ||
      db.prepare('SELECT 1 FROM numbers WHERE image_path=? OR audio_path=?').get(rel, rel) ||
      engine.branding().logoPath === rel;
    if (!used) fs.rmSync(p, { force: true });
  }
  function sendUpload(res: Response, rel: string | null) {
    const p = rel ? safeUploadPath(rel) : null;
    if (!p || !fs.existsSync(p)) return res.status(404).end();
    res.type(MIME[path.extname(p).slice(1)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(p);
  }

  // ------------------------------------------------------------ express
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === '1');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
    );
    next();
  });
  const json = express.json({ limit: '2mb' });
  const raw = express.raw({ type: () => true, limit: '20mb' });
  const rawBig = express.raw({ type: () => true, limit: '500mb' });

  const cookieOpts = { httpOnly: true, sameSite: 'strict' as const, secure: !!opts.cookieSecure, path: '/' };
  const sessionOf = (req: Request) => auth.parseCookies(req.headers.cookie)[auth.ADMIN_COOKIE];
  const isAdmin = (req: Request) => auth.validSession(db, sessionOf(req));
  const bearer = (req: Request) => {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
  };
  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Accesso al CMS richiesto' });
    next();
  };
  const requireControl = (req: Request, res: Response, next: NextFunction) => {
    if (isAdmin(req)) {
      res.locals.actor = 'portatile';
      return next();
    }
    const id = auth.checkControlToken(db, bearer(req));
    if (id == null) return res.status(401).json({ error: 'Telefono non abbinato, scaduto o revocato' });
    res.locals.actor = `telefono#${id}`;
    next();
  };
  // Le mutazioni accettano solo JSON (niente form cross-site).
  const requireJson = (req: Request, res: Response, next: NextFunction) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Richiesta non valida' });
    next();
  };
  const wrap =
    (fn: (req: Request, res: Response) => unknown) =>
    async (req: Request, res: Response) => {
      try {
        const out = await fn(req, res);
        if (!res.headersSent) res.json(out ?? { ok: true });
      } catch (e) {
        if (e instanceof GameError) return res.status(e.code === 'not_found' ? 404 : 400).json({ error: e.message });
        const msg = (e as Error).message ?? 'Errore';
        if (/UNIQUE|constraint/i.test(msg)) return res.status(400).json({ error: 'Dato duplicato o non valido' });
        log(`Errore: ${(e as Error).stack ?? msg}`);
        res.status(500).json({ error: 'Errore interno del server' });
      }
    };

  // --- autenticazione
  const loginAttempts = new Map<string, { n: number; until: number }>();
  app.post('/api/auth/login', json, requireJson, (req, res) => {
    const ip = req.ip ?? 'x';
    const a = loginAttempts.get(ip);
    if (a && a.until > Date.now() && a.n >= 8) return res.status(429).json({ error: 'Troppi tentativi: riprova fra qualche minuto' });
    if (!auth.checkPassword(db, String(req.body?.password ?? ''))) {
      loginAttempts.set(ip, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 5 * 60e3 });
      audit(db, 'sconosciuto', 'accesso_fallito', { ip });
      return res.status(401).json({ error: 'Password errata' });
    }
    loginAttempts.delete(ip);
    res.cookie(auth.ADMIN_COOKIE, auth.createSession(db), { ...cookieOpts, maxAge: 12 * 3600e3 });
    res.json({ ok: true });
  });
  app.post('/api/auth/logout', (req, res) => {
    auth.destroySession(db, sessionOf(req));
    res.clearCookie(auth.ADMIN_COOKIE, cookieOpts);
    res.json({ ok: true });
  });
  app.get('/api/auth/me', (req, res) => res.json({ admin: isAdmin(req) }));

  // --- pubblico (display)
  app.get('/api/public/state', (_req, res) => res.json(engine.publicState()));
  app.get('/api/public/award/:id/image', (req, res) => {
    const a = db
      .prepare("SELECT p.image_path, p.visible FROM awards a JOIN prizes p ON p.id=a.prize_id WHERE a.id=? AND a.status='revealed'")
      .get(Number(req.params.id)) as { image_path: string | null; visible: number } | undefined;
    if (!a || !a.visible) return res.status(404).end();
    sendUpload(res, a.image_path);
  });
  app.get('/media/:kind/:file', (req, res) => {
    if (req.params.kind === 'prizes') return res.status(404).end(); // i regali segreti non sono pubblici
    sendUpload(res, `${req.params.kind}/${req.params.file}`);
  });

  // --- telecomando
  app.get('/api/control/state', requireControl, (_req, res) => res.json(engine.controlState()));
  app.get('/api/control/verify', requireControl, wrap((req) => {
    const g = engine.currentGame();
    const { card: _card, ...rep } = engine.evaluate(g.id, String(req.query.code ?? ''));
    return rep;
  }));
  app.get('/api/control/annul-impact', requireControl, wrap((req) => ({ impact: engine.annulImpact(Number(req.query.awardId)) })));
  app.get('/api/control/prize/:id/image', requireControl, (req, res) => sendUpload(res, admin.prizeImagePath(Number(req.params.id))));
  app.post('/api/control/command', json, requireJson, requireControl, (req, res) => {
    const { commandId, type, payload = {} } = req.body ?? {};
    const actor = res.locals.actor as string;
    const p = payload as Record<string, unknown>;
    const gid = () => engine.currentGame().id;
    const handlers: Record<string, () => unknown> = {
      draw: () => engine.draw(gid(), Number(p.expectedCount)),
      openCheck: () => engine.openClaimCheck(gid()),
      addClaim: () => engine.addClaim(gid(), { code: String(p.code ?? ''), category: String(p.category), row: p.row as number, winnerName: p.winnerName as string }),
      removeClaim: () => engine.removeClaim(Number(p.claimId)),
      confirm: () => engine.confirmClaims(gid(), (p.prizeChoices as Record<string, number>) ?? {}),
      resolveTie: () => engine.resolveTie(Number(p.tieId), p as never),
      assignReserve: () => engine.assignReserve(Number(p.claimId), Number(p.prizeId)),
      announce: () => engine.announce(Number(p.awardId)),
      reveal: () => engine.reveal(Number(p.awardId), !!p.instant),
      repeat: () => engine.repeat(gid()),
      zoom: () => engine.setZoom(gid(), !!p.zoom),
      resume: () => engine.resume(gid()),
      pause: () => engine.pause(gid(), String(p.message ?? '')),
      final: () => engine.showFinal(gid()),
      close: () => engine.closeGame(gid(), String(p.note ?? '')),
      annul: () => engine.annulAward(Number(p.awardId), String(p.reason ?? '')),
      display: () => engine.setDisplayFlags(p as never),
      selectGame: () => engine.selectGame(Number(p.gameId)),
      startGame: () => engine.startGame(Number(p.gameId)),
    };
    const h = handlers[String(type)];
    if (!h) return res.status(400).json({ ok: false, error: 'Comando sconosciuto' });
    try {
      const out = engine.run(String(commandId ?? ''), String(type), actor, h);
      if (out.ok && type === 'close') {
        try {
          autoBackup(db, dataDir, uploadsDir, 'partita chiusa');
        } catch (e) {
          log(`Backup automatico non riuscito: ${(e as Error).message}`);
        }
      }
      res.status(out.ok ? 200 : 409).json({ ...out, drawWaitMs: engine.drawWaitMs() });
    } catch (e) {
      log(`Errore comando ${type}: ${(e as Error).stack}`);
      res.status(500).json({ ok: false, error: 'Errore interno del server' });
    }
  });

  // --- CMS
  const A = express.Router();
  A.use(requireAdmin);
  A.get('/overview', wrap(() => ({
    events: admin.listEvents(),
    currentGameId: engine.currentGameId(),
    addresses: lanAddresses(Number(opts.port ?? 0) || (server.address() as { port: number } | null)?.port || 0),
    batches: listBatches(db),
    pairings: auth.listPairings(db),
  })));
  A.post('/events', json, requireJson, wrap((req) => ({ id: admin.createEvent(req.body) })));
  A.put('/events/:id', json, requireJson, wrap((req) => admin.updateEvent(Number(req.params.id), req.body)));
  A.post('/events/:id/duplicate', wrap((req) => ({ id: admin.duplicateEvent(Number(req.params.id)) })));
  A.post('/games', json, requireJson, wrap((req) => ({ id: admin.createGame(req.body) })));
  A.get('/games/:id', wrap((req) => ({ game: admin.gameView(Number(req.params.id)), active: admin.activeSummary(Number(req.params.id)) })));
  A.put('/games/:id', json, requireJson, wrap((req) => admin.updateGame(Number(req.params.id), req.body)));
  A.post('/games/:id/duplicate', json, wrap((req) => ({ id: admin.duplicateGame(Number(req.params.id), req.body?.name) })));
  A.post('/games/:id/reset-test', wrap((req) => admin.resetTestGame(Number(req.params.id))));
  A.delete('/games/:id', wrap((req) => admin.deleteGame(Number(req.params.id))));
  A.post('/games/:id/select', wrap((req) => engine.mutate('admin', 'partita_selezionata', () => engine.selectGame(Number(req.params.id)))));
  A.post('/games/:id/activate', json, requireJson, wrap((req) => {
    const id = Number(req.params.id);
    if (req.body?.batchId) return { added: admin.activateBatch(id, Number(req.body.batchId)), errors: [] };
    return admin.activateCards(id, String(req.body?.spec ?? ''));
  }));
  A.post('/games/:id/deactivate', json, requireJson, wrap((req) => ({ removed: admin.deactivateCards(Number(req.params.id), req.body?.all ? null : String(req.body?.spec ?? '')) })));

  A.get('/games/:id/prizes', wrap((req) => admin.listPrizes(Number(req.params.id))));
  A.post('/prizes', json, requireJson, wrap((req) => ({ id: admin.savePrize(req.body) })));
  A.put('/prizes/:id', json, requireJson, wrap((req) => ({ id: admin.savePrize({ ...req.body, id: Number(req.params.id) }) })));
  A.delete('/prizes/:id', wrap((req) => removeUpload(admin.deletePrize(Number(req.params.id)))));
  A.put('/prizes/:id/image', raw, wrap((req) => {
    const rel = saveUpload('prizes', req.body as Buffer, 'image');
    removeUpload(admin.setPrizeImage(Number(req.params.id), rel));
  }));
  A.delete('/prizes/:id/image', wrap((req) => removeUpload(admin.setPrizeImage(Number(req.params.id), null))));
  A.get('/prizes/:id/image', (req, res) => sendUpload(res, admin.prizeImagePath(Number(req.params.id))));

  A.get('/batches', wrap(() => listBatches(db)));
  A.post('/batches', json, requireJson, wrap((req) => {
    const b = generateBatch(db, { count: Number(req.body?.count), name: String(req.body?.name ?? ''), isDemo: !!req.body?.demo });
    engine.onChange();
    return b;
  }));
  A.delete('/batches/:id', wrap((req) => deleteBatch(db, Number(req.params.id))));
  A.get('/cards', wrap((req) => listCards(db, {
    batchId: req.query.batch ? Number(req.query.batch) : undefined,
    q: req.query.q ? String(req.query.q) : undefined,
    limit: Math.min(200, Number(req.query.limit) || 24),
    offset: Number(req.query.offset) || 0,
  })));
  A.get('/cards/export', (req, res) => {
    const batch = req.query.batch ? Number(req.query.batch) : undefined;
    if (req.query.format === 'csv') {
      res.setHeader('Content-Disposition', 'attachment; filename="cartelle.csv"');
      return res.type('text/csv').send(exportCardsCsv(db, batch));
    }
    res.setHeader('Content-Disposition', 'attachment; filename="cartelle.json"');
    res.json(exportCardsJson(db, batch));
  });
  A.post('/cards/import', express.text({ type: () => true, limit: '20mb' }), wrap((req) => {
    const body = String(req.body ?? '');
    const r = body.trim().startsWith('{') ? importCards(db, { json: JSON.parse(body) }) : importCards(db, { csv: body });
    engine.onChange();
    return r;
  }));

  A.get('/print-profile', wrap(() => sanitizeProfile(getSetting<Partial<PrintProfile>>(db, 'printProfile', DEFAULT_PROFILE))));
  A.put('/print-profile', json, requireJson, wrap((req) => {
    const p = sanitizeProfile(req.body);
    engine.mutate('admin', 'profilo_stampa', () => setSetting(db, 'printProfile', p), p);
    return p;
  }));
  A.post('/print', json, requireJson, async (req, res) => {
    try {
      const b = req.body ?? {};
      const format = b.format === 'a4' ? 'a4' : 'a6';
      let ids: number[] = [];
      if (b.batchId) ids = listCards(db, { batchId: Number(b.batchId), limit: MAX_PER_BATCH }).map((c) => c.id);
      else {
        const r = resolveCodes(db, String(b.spec ?? ''));
        if (r.errors.length) return res.status(400).json({ error: r.errors.join('; ') });
        ids = r.ids;
      }
      if (!ids.length) return res.status(400).json({ error: 'Nessuna cartella da stampare' });
      if (ids.length > 2000) return res.status(400).json({ error: 'Al massimo 2.000 cartelle per PDF' });
      const profile = sanitizeProfile({ ...getSetting<Partial<PrintProfile>>(db, 'printProfile', DEFAULT_PROFILE), ...(b.profile ?? {}) });
      const cards = getCardsByIds(db, ids);
      const br = engine.branding();
      const evName = String(b.subtitle ?? '') || (db.prepare('SELECT name FROM events WHERE is_test=0 ORDER BY id DESC').get() as { name: string } | undefined)?.name || '';
      const logo = br.logoPath && /\.(png|jpg)$/.test(br.logoPath) ? fs.readFileSync(path.join(uploadsDir, br.logoPath)) : null;
      const pdf = await renderCardsPdf(cards, { format, profile, title: br.title, subtitle: evName, colors: br.colors, logoPng: logo });
      if (b.mark) {
        const r = markPrinted(db, ids, format);
        res.setHeader('X-Reprints', String(r.reprints));
      }
      res.setHeader('X-Layout', encodeURIComponent(layoutInfo(format, profile, cards.length).note));
      res.setHeader('Content-Disposition', `attachment; filename="cartelle-${format}.pdf"`);
      res.type('application/pdf').send(pdf);
    } catch (e) {
      log(`Errore PDF: ${(e as Error).stack}`);
      res.status(500).json({ error: 'Generazione PDF non riuscita' });
    }
  });

  A.get('/numbers', wrap(() => admin.listNumbers()));
  A.put('/numbers/:n', json, requireJson, wrap((req) => admin.updateNumber(Number(req.params.n), req.body)));
  A.put('/numbers/:n/:kind', raw, wrap((req) => {
    const kind = req.params.kind === 'audio' ? 'audio' : 'image';
    const rel = saveUpload('numbers', req.body as Buffer, kind);
    removeUpload(admin.setNumberMedia(Number(req.params.n), kind, rel));
  }));
  A.delete('/numbers/:n/:kind', wrap((req) => removeUpload(admin.setNumberMedia(Number(req.params.n), req.params.kind === 'audio' ? 'audio' : 'image', null))));
  A.get('/numbers-export', (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="numeri.json"');
    res.json(admin.exportNumbers());
  });
  A.post('/numbers-import', json, requireJson, wrap((req) => ({ imported: admin.importNumbers(req.body) })));

  A.get('/branding', wrap(() => engine.branding()));
  A.put('/branding', json, requireJson, wrap((req) => {
    const { logoPath: _ignored, ...rest } = req.body ?? {};
    return admin.saveBranding(rest);
  }));
  A.put('/branding/logo', raw, wrap((req) => {
    const rel = saveUpload('branding', req.body as Buffer, 'image');
    const old = engine.branding().logoPath;
    admin.saveBranding({ logoPath: rel });
    removeUpload(old);
  }));
  A.delete('/branding/logo', wrap(() => {
    const old = engine.branding().logoPath;
    admin.saveBranding({ logoPath: null });
    removeUpload(old);
  }));
  A.put('/password', json, requireJson, wrap((req) => {
    if (!auth.checkPassword(db, String(req.body?.current ?? ''))) throw new GameError('Password attuale errata');
    auth.setAdminPassword(db, String(req.body?.next ?? ''));
  }));

  A.get('/pairings', wrap(() => auth.listPairings(db)));
  A.post('/pairings', json, requireJson, wrap(async (req) => {
    const base = String(req.body?.baseUrl ?? '').replace(/\/+$/, '');
    if (!/^https?:\/\/[\w.:[\]-]+$/.test(base)) throw new GameError('Indirizzo non valido');
    const p = auth.createPairing(db, String(req.body?.label ?? ''), Number(req.body?.hours ?? 12));
    const url = `${base}/control#t=${p.token}`;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { ...p, url, svg };
  }));
  A.delete('/pairings/:id', wrap((req) => {
    auth.revokePairing(db, Number(req.params.id));
    // Chiude subito le connessioni del telefono revocato.
    for (const c of clients) if (c.pairingId === Number(req.params.id)) c.ws.close(4001, 'revocato');
  }));

  A.get('/audit', wrap((req) => admin.auditLog(Math.min(1000, Number(req.query.limit) || 300), req.query.game ? Number(req.query.game) : undefined)));
  A.get('/winners', wrap((req) => admin.winnersArchive({ includeTest: req.query.test === '1' })));
  A.get('/winners.csv', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="vincitori.csv"');
    res.type('text/csv').send('﻿' + admin.winnersCsv({ includeTest: req.query.test === '1' }));
  });
  A.get('/backup', (_req, res) => {
    const buf = createBackupZip(db, uploadsDir, 'esportazione manuale');
    audit(db, 'admin', 'backup_esportato', { bytes: buf.length });
    res.setHeader('Content-Disposition', `attachment; filename="tombola-backup-${new Date().toISOString().slice(0, 10)}.zip"`);
    res.type('application/zip').send(buf);
  });
  A.post('/restore', rawBig, wrap((req) => {
    const check = validateBackup(req.body as Buffer, dataDir);
    if (!check.ok) throw new GameError(check.errors.join('; '));
    if (req.query.confirm !== '1') {
      fs.rmSync(check.dir!, { recursive: true, force: true });
      return { ok: true, dryRun: true, manifest: check.manifest, summary: check.summary };
    }
    const safety = autoBackup(db, dataDir, uploadsDir, 'prima del ripristino');
    swapData(check.dir!);
    return { ok: true, restored: true, safetyBackup: path.basename(safety), summary: check.summary };
  }));
  A.post('/demo', wrap(() => createDemo(admin)));
  app.use('/api/admin', A);

  function swapData(dir: string) {
    ctx.db.close();
    fs.rmSync(dbFile + '-wal', { force: true });
    fs.rmSync(dbFile + '-shm', { force: true });
    fs.copyFileSync(path.join(dir, 'tombola.sqlite'), dbFile);
    fs.rmSync(uploadsDir, { recursive: true, force: true });
    if (fs.existsSync(path.join(dir, 'uploads'))) fs.cpSync(path.join(dir, 'uploads'), uploadsDir, { recursive: true });
    else fs.mkdirSync(uploadsDir, { recursive: true });
    fs.rmSync(dir, { recursive: true, force: true });
    const ndb = openDb(dbFile);
    ctx.db = ndb;
    engine.db = ndb;
    admin.db = ndb;
    db = ndb;
    audit(ndb, 'admin', 'backup_ripristinato');
    engine.onChange();
  }

  // --- interfacce (build del client)
  if (fs.existsSync(CLIENT_DIST)) {
    app.use('/assets', express.static(path.join(CLIENT_DIST, 'assets'), { immutable: true, maxAge: '30d' }));
    app.use(express.static(CLIENT_DIST, { index: false }));
    app.get(['/', '/display', '/control', '/admin', '/admin/*rest'], (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => res.type('text/plain').send('Interfaccia non compilata: esegui "npm run build".'));
  }
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Non trovato' }));

  // ------------------------------------------------------------ websocket
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  interface Client { ws: WebSocket; control: boolean; pairingId: number | null; alive: boolean }
  const clients = new Set<Client>();

  const snapshot = () => {
    const pub: PublicState = engine.publicState();
    let ctl: ControlState | null = null;
    return { pub, ctl: () => (ctl ??= engine.controlState()) };
  };
  const send = (c: Client, s: ReturnType<typeof snapshot>) => {
    if (c.ws.readyState !== WebSocket.OPEN) return;
    c.ws.send(JSON.stringify({ type: 'public', state: s.pub }));
    if (c.control) c.ws.send(JSON.stringify({ type: 'control', state: s.ctl() }));
  };
  engine.onChange = () => {
    if (!clients.size) return;
    const s = snapshot();
    for (const c of clients) send(c, s);
  };

  wss.on('connection', (ws, req) => {
    const c: Client = { ws, control: false, pairingId: null, alive: true };
    if (auth.validSession(db, auth.parseCookies(req.headers.cookie)[auth.ADMIN_COOKIE]) && /role=control/.test(req.url ?? '')) c.control = true;
    clients.add(c);
    ws.on('pong', () => (c.alive = true));
    ws.on('message', (data) => {
      let msg: { type?: string; token?: string };
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.type === 'auth') {
        const id = auth.checkControlToken(db, msg.token);
        if (id == null) return ws.send(JSON.stringify({ type: 'auth', ok: false }));
        c.control = true;
        c.pairingId = id;
        ws.send(JSON.stringify({ type: 'auth', ok: true }));
        send(c, snapshot());
      } else if (msg.type === 'hello') {
        send(c, snapshot());
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', serverTime: Date.now() }));
      }
    });
    ws.on('close', () => clients.delete(c));
    send(c, snapshot());
  });
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        clients.delete(c);
        continue;
      }
      c.alive = false;
      c.ws.ping();
      // Le credenziali scadute o revocate perdono subito il controllo.
      if (c.pairingId != null && !db.prepare('SELECT 1 FROM control_tokens WHERE id=? AND revoked_at IS NULL AND expires_at>?').get(c.pairingId, Date.now())) {
        c.ws.close(4001, 'scaduto');
      }
    }
  }, 15000);

  try {
    autoBackup(db, dataDir, uploadsDir, 'avvio del server');
  } catch (e) {
    log(`Backup all'avvio non riuscito: ${(e as Error).message}`);
  }

  return {
    app,
    server,
    ctx,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        for (const c of clients) c.ws.terminate();
        wss.close();
        server.close(() => {
          ctx.db.close();
          resolve();
        });
      }),
  };
}
