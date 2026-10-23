// Persistenza SQLite (modulo node:sqlite, nessuna dipendenza nativa da compilare).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT '',
  is_test INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'setup',          -- setup | active | closed
  is_test INTEGER NOT NULL DEFAULT 0,
  rules_json TEXT NOT NULL,                       -- modificabile solo in setup
  rules_frozen_json TEXT,                         -- snapshot congelato all'avvio
  stage_json TEXT NOT NULL DEFAULT '{}',
  close_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  closed_at INTEGER
);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY,
  prefix TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  seq INTEGER NOT NULL,
  matrix_json TEXT NOT NULL,
  set_key TEXT NOT NULL UNIQUE,                   -- i 15 numeri ordinati: niente cartelle uguali
  print_count INTEGER NOT NULL DEFAULT 0,
  first_printed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cards_batch ON cards(batch_id, seq);

CREATE TABLE IF NOT EXISTS game_cards (
  game_id INTEGER NOT NULL REFERENCES games(id),
  card_id INTEGER NOT NULL REFERENCES cards(id),
  activated_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, card_id)
);

CREATE TABLE IF NOT EXISTS draws (
  game_id INTEGER NOT NULL REFERENCES games(id),
  idx INTEGER NOT NULL,                           -- 1..90
  number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 90),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, idx),
  UNIQUE (game_id, number)
);

CREATE TABLE IF NOT EXISTS prizes (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_path TEXT,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  reserve INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id),
  draw_idx INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',            -- open | closed
  opened_at INTEGER NOT NULL,
  closed_at INTEGER
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id),
  check_id INTEGER NOT NULL REFERENCES checks(id),
  draw_idx INTEGER NOT NULL,
  card_id INTEGER REFERENCES cards(id),
  card_code TEXT NOT NULL,
  category TEXT NOT NULL,
  row INTEGER,
  winner_name TEXT,
  status TEXT NOT NULL,                           -- valid | rejected | tie | awarded | tie_lost | dismissed
  reason TEXT NOT NULL DEFAULT '',
  tie_group_id INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tie_groups (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id),
  check_id INTEGER NOT NULL,
  draw_idx INTEGER NOT NULL,
  category TEXT NOT NULL,
  available INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  method TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

-- Sorteggi di spareggio: separati dalle 90 estrazioni.
CREATE TABLE IF NOT EXISTS tiebreak_draws (
  id INTEGER PRIMARY KEY,
  tie_group_id INTEGER NOT NULL REFERENCES tie_groups(id),
  candidates_json TEXT NOT NULL,
  winners_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS awards (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id),
  claim_id INTEGER NOT NULL REFERENCES claims(id),
  card_id INTEGER NOT NULL REFERENCES cards(id),
  row INTEGER,
  category TEXT NOT NULL,
  prize_id INTEGER NOT NULL REFERENCES prizes(id),
  reserve INTEGER NOT NULL DEFAULT 0,
  winner_name TEXT,
  draw_idx INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned',        -- assigned | revealed | annulled
  created_at INTEGER NOT NULL,
  revealed_at INTEGER,
  annulled_at INTEGER,
  annul_reason TEXT
);
CREATE INDEX IF NOT EXISTS awards_game ON awards(game_id, status);

CREATE TABLE IF NOT EXISTS numbers (
  n INTEGER PRIMARY KEY CHECK (n BETWEEN 1 AND 90),
  traditional TEXT NOT NULL DEFAULT '',
  busa_text TEXT NOT NULL DEFAULT '',
  host_joke TEXT NOT NULL DEFAULT '',
  image_path TEXT,
  audio_path TEXT,
  special TEXT NOT NULL DEFAULT 'none'
);

CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  game_id INTEGER,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS print_log (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  format TEXT NOT NULL,
  card_ids_json TEXT NOT NULL,
  reprint INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS control_tokens (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_seen_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

export type DB = DatabaseSync;

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  const v = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string } | undefined;
  if (!v) db.prepare("INSERT INTO meta(key,value) VALUES('schema_version',?)").run(String(SCHEMA_VERSION));
  else if (Number(v.value) > SCHEMA_VERSION) {
    throw new Error(`Database creato da una versione più recente (schema ${v.value}).`);
  }
  if (!db.prepare("SELECT 1 FROM meta WHERE key='version'").get()) {
    db.prepare("INSERT INTO meta(key,value) VALUES('version','0')").run();
  }
  const count = db.prepare('SELECT COUNT(*) AS c FROM numbers').get() as { c: number };
  if (count.c < 90) {
    const ins = db.prepare('INSERT OR IGNORE INTO numbers(n) VALUES (?)');
    for (let n = 1; n <= 90; n++) ins.run(n);
  }
  return db;
}

/** Esegue fn in una transazione IMMEDIATE: tutto o niente. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function bumpVersion(db: DB): number {
  db.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key='version'").run();
  return currentVersion(db);
}
export function currentVersion(db: DB): number {
  const r = db.prepare("SELECT value FROM meta WHERE key='version'").get() as { value: string };
  return Number(r.value);
}

export function getSetting<T>(db: DB, key: string, fallback: T): T {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
  if (!r) return fallback;
  try {
    return JSON.parse(r.value) as T;
  } catch {
    return fallback;
  }
}
export function setSetting(db: DB, key: string, value: unknown): void {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
    key,
    JSON.stringify(value),
  );
}

export function audit(db: DB, actor: string, action: string, detail: unknown = {}, gameId: number | null = null): void {
  db.prepare('INSERT INTO audit(ts,actor,game_id,action,detail_json) VALUES(?,?,?,?,?)').run(
    Date.now(),
    actor,
    gameId,
    action,
    JSON.stringify(detail),
  );
}
