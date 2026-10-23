// Backup completo (database + file caricati) e ripristino validato, con copia di sicurezza prima di sovrascrivere.
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION, type DB } from './db.js';

export interface BackupManifest {
  app: 'tombola-busa';
  schemaVersion: number;
  createdAt: string;
  reason: string;
}

const REQUIRED_TABLES = ['events', 'games', 'cards', 'draws', 'prizes', 'awards', 'numbers', 'settings'];

export function createBackupZip(db: DB, uploadsDir: string, reason: string): Buffer {
  const tmp = path.join(path.dirname(uploadsDir), `.snapshot-${process.pid}-${Date.now()}.sqlite`);
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const zip = new AdmZip();
    const manifest: BackupManifest = { app: 'tombola-busa', schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), reason };
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
    zip.addFile('tombola.sqlite', fs.readFileSync(tmp));
    if (fs.existsSync(uploadsDir)) zip.addLocalFolder(uploadsDir, 'uploads');
    return zip.toBuffer();
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Salva un backup automatico in data/backups e conserva solo gli ultimi `keep`. */
export function autoBackup(db: DB, dataDir: string, uploadsDir: string, reason: string, keep = 30): string {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = reason.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  const file = path.join(dir, `backup-${stamp}-${slug}.zip`);
  fs.writeFileSync(file, createBackupZip(db, uploadsDir, reason));
  const all = fs.readdirSync(dir).filter((f) => f.startsWith('backup-')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(dir, old), { force: true });
  return file;
}

export interface RestoreCheck {
  ok: boolean;
  errors: string[];
  manifest?: BackupManifest;
  summary?: { events: number; games: number; cards: number; awards: number };
}

/** Estrae il backup in una cartella temporanea e verifica che sia integro, senza toccare i dati attuali. */
export function validateBackup(zipBuf: Buffer, workDir: string): RestoreCheck & { dir?: string } {
  const errors: string[] = [];
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuf);
  } catch {
    return { ok: false, errors: ['Il file non è uno zip valido'] };
  }
  const names = zip.getEntries().map((e) => e.entryName);
  if (!names.includes('manifest.json') || !names.includes('tombola.sqlite')) {
    return { ok: false, errors: ['Il file non è un backup della Tombola Busa (manca manifest.json o tombola.sqlite)'] };
  }
  for (const n of names) {
    if (n.includes('..') || path.isAbsolute(n) || !(n === 'manifest.json' || n === 'tombola.sqlite' || n.startsWith('uploads/'))) {
      return { ok: false, errors: [`Percorso non ammesso nel backup: ${n}`] };
    }
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(zip.readAsText('manifest.json'));
  } catch {
    return { ok: false, errors: ['manifest.json illeggibile'] };
  }
  if (manifest.app !== 'tombola-busa') errors.push('Backup di un\'altra applicazione');
  if (manifest.schemaVersion > SCHEMA_VERSION) errors.push('Backup creato da una versione più recente: aggiorna prima l\'applicazione');
  const dir = fs.mkdtempSync(path.join(workDir, 'restore-'));
  zip.extractAllTo(dir, true);
  let summary: RestoreCheck['summary'];
  try {
    const test = new DatabaseSync(path.join(dir, 'tombola.sqlite'), { readOnly: true });
    const integ = test.prepare('PRAGMA integrity_check').get() as Record<string, string>;
    if (Object.values(integ)[0] !== 'ok') errors.push('Il database del backup è danneggiato');
    const tables = (test.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
    if (missing.length) errors.push(`Tabelle mancanti: ${missing.join(', ')}`);
    else {
      const c = (t: string) => Number((test.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c);
      summary = { events: c('events'), games: c('games'), cards: c('cards'), awards: c('awards') };
    }
    test.close();
  } catch (e) {
    errors.push(`Database non leggibile: ${(e as Error).message}`);
  }
  if (errors.length) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: false, errors, manifest };
  }
  return { ok: true, errors, manifest, summary, dir };
}
