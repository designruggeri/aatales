// Accesso al CMS (password + sessione) e credenziali del telecomando (abbinamento revocabile, con scadenza).
import crypto from 'node:crypto';
import { audit, getSetting, setSetting, type DB } from './db.js';

const SESSION_HOURS = 12;
export const ADMIN_COOKIE = 'tb_admin';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(pw: string, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(pw, salt, 32).toString('hex');
  return { salt, hash };
}

/** Prima installazione: genera una password casuale e la restituisce (una sola volta) per mostrarla in console. */
export function ensureAdminPassword(db: DB, envPassword?: string): string | null {
  if (envPassword) {
    setSetting(db, 'admin', hashPassword(envPassword));
    return null;
  }
  if (getSetting<{ hash?: string } | null>(db, 'admin', null)?.hash) return null;
  const pw = crypto.randomBytes(9).toString('base64url');
  setSetting(db, 'admin', hashPassword(pw));
  return pw;
}

export function setAdminPassword(db: DB, pw: string): void {
  if (pw.length < 8) throw new Error('La password deve avere almeno 8 caratteri');
  setSetting(db, 'admin', hashPassword(pw));
  db.prepare('DELETE FROM sessions').run();
  audit(db, 'admin', 'password_cambiata');
}

export function checkPassword(db: DB, pw: string): boolean {
  const a = getSetting<{ salt: string; hash: string } | null>(db, 'admin', null);
  if (!a) return false;
  const h = hashPassword(String(pw), a.salt).hash;
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(a.hash, 'hex'));
}

export function createSession(db: DB): string {
  const id = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('INSERT INTO sessions(id_hash,created_at,expires_at) VALUES(?,?,?)').run(sha256(id), now, now + SESSION_HOURS * 3600e3);
  return id;
}
export function validSession(db: DB, id: string | undefined): boolean {
  if (!id) return false;
  const r = db.prepare('SELECT expires_at FROM sessions WHERE id_hash=?').get(sha256(id)) as { expires_at: number } | undefined;
  return !!r && r.expires_at > Date.now();
}
export function destroySession(db: DB, id: string | undefined): void {
  if (id) db.prepare('DELETE FROM sessions WHERE id_hash=?').run(sha256(id));
}

export interface PairingView {
  id: number;
  label: string;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
  lastSeenAt: number | null;
}

/** Crea una credenziale per il telefono: il valore in chiaro esce solo qui (per il QR) e non viene salvato. */
export function createPairing(db: DB, label: string, hours: number): { id: number; token: string; expiresAt: number } {
  const token = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  const h = Math.min(72, Math.max(1, Math.round(hours || 12)));
  const expiresAt = now + h * 3600e3;
  const id = Number(
    db
      .prepare('INSERT INTO control_tokens(label,token_hash,created_at,expires_at) VALUES(?,?,?,?)')
      .run(label.trim().slice(0, 40) || 'Telefono conduttore', sha256(token), now, expiresAt).lastInsertRowid,
  );
  audit(db, 'admin', 'telefono_abbinato', { id, label, ore: h });
  return { id, token, expiresAt };
}

export function listPairings(db: DB): PairingView[] {
  return (db.prepare('SELECT * FROM control_tokens ORDER BY id DESC LIMIT 50').all() as Record<string, number | string | null>[]).map((r) => ({
    id: Number(r.id),
    label: String(r.label),
    createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at),
    revoked: r.revoked_at != null,
    lastSeenAt: r.last_seen_at == null ? null : Number(r.last_seen_at),
  }));
}

export function revokePairing(db: DB, id: number): void {
  db.prepare('UPDATE control_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(Date.now(), id);
  audit(db, 'admin', 'telefono_revocato', { id });
}

/** Restituisce l'id dell'abbinamento se il token è valido, non scaduto e non revocato. */
export function checkControlToken(db: DB, token: string | undefined): number | null {
  if (!token || token.length < 20) return null;
  const r = db.prepare('SELECT id, expires_at, revoked_at FROM control_tokens WHERE token_hash=?').get(sha256(token)) as
    | { id: number; expires_at: number; revoked_at: number | null }
    | undefined;
  if (!r || r.revoked_at != null || r.expires_at < Date.now()) return null;
  db.prepare('UPDATE control_tokens SET last_seen_at=? WHERE id=?').run(Date.now(), r.id);
  return r.id;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
