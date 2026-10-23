// Generatore e archivio delle cartelle (struttura italiana 3 × 9).
import crypto from 'node:crypto';
import { audit, tx, type DB } from './db.js';
import type { CardMatrix } from '../../shared/types.js';

export type Rand = (maxExclusive: number) => number;
export const secureRand: Rand = (max) => crypto.randomInt(0, max);

/** Intervallo di numeri della colonna c (0..8): 1–9, 10–19, …, 80–90. */
export function columnRange(c: number): [number, number] {
  if (c === 0) return [1, 9];
  if (c === 8) return [80, 90];
  return [c * 10, c * 10 + 9];
}

export function columnOf(n: number): number {
  if (n === 90) return 8;
  return Math.floor(n / 10);
}

function shuffle<T>(arr: T[], rand: Rand): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Genera una cartella valida: 15 numeri, 5 per riga, almeno 1 per colonna, colonne crescenti. */
export function generateMatrix(rand: Rand = secureRand): CardMatrix {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const counts = Array(9).fill(1);
    let extra = 6;
    while (extra > 0) {
      const free = counts.map((c, i) => (c < 3 ? i : -1)).filter((i) => i >= 0);
      counts[free[rand(free.length)]]++;
      extra--;
    }
    const cap = [5, 5, 5];
    const placement: number[][] = Array.from({ length: 9 }, () => []);
    const order = shuffle([...Array(9).keys()], rand).sort((a, b) => counts[b] - counts[a]);
    let ok = true;
    for (const col of order) {
      const rows = shuffle([0, 1, 2], rand).sort((a, b) => cap[b] - cap[a]);
      const chosen = rows.slice(0, counts[col]);
      if (chosen.some((r) => cap[r] <= 0)) {
        ok = false;
        break;
      }
      chosen.forEach((r) => cap[r]--);
      placement[col] = chosen.sort((a, b) => a - b);
    }
    if (!ok || cap.some((c) => c !== 0)) continue;
    const m: CardMatrix = [Array(9).fill(0), Array(9).fill(0), Array(9).fill(0)];
    for (let col = 0; col < 9; col++) {
      const [lo, hi] = columnRange(col);
      const pool = shuffle(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i), rand);
      const nums = pool.slice(0, counts[col]).sort((a, b) => a - b);
      placement[col].forEach((r, i) => (m[r][col] = nums[i]));
    }
    return m;
  }
  throw new Error('Generazione della cartella non riuscita');
}

/** Controlla tutte le regole della cartella italiana; restituisce l'elenco degli errori. */
export function validateMatrix(m: unknown): string[] {
  const errs: string[] = [];
  if (!Array.isArray(m) || m.length !== 3 || m.some((r) => !Array.isArray(r) || r.length !== 9)) {
    return ['La cartella deve avere 3 righe da 9 caselle'];
  }
  const mm = m as number[][];
  const all: number[] = [];
  mm.forEach((row, r) => {
    const filled = row.filter((n) => n !== 0);
    if (filled.length !== 5) errs.push(`Riga ${r + 1}: servono 5 numeri, trovati ${filled.length}`);
    row.forEach((n, c) => {
      if (n === 0) return;
      if (!Number.isInteger(n)) return errs.push(`Riga ${r + 1}: valore non valido`);
      const [lo, hi] = columnRange(c);
      if (n < lo || n > hi) errs.push(`Il numero ${n} non può stare nella colonna ${c + 1}`);
      all.push(n);
    });
  });
  if (new Set(all).size !== all.length) errs.push('Numeri ripetuti');
  if (all.length !== 15) errs.push('La cartella deve contenere 15 numeri');
  for (let c = 0; c < 9; c++) {
    const col = [mm[0][c], mm[1][c], mm[2][c]].filter((n) => n !== 0);
    if (col.length === 0) errs.push(`Colonna ${c + 1} vuota`);
    for (let i = 1; i < col.length; i++) {
      if (col[i] <= col[i - 1]) errs.push(`Colonna ${c + 1}: numeri non crescenti dall'alto in basso`);
    }
  }
  return errs;
}

export function cardNumbers(m: CardMatrix): number[] {
  return m.flat().filter((n) => n !== 0);
}
export function rowNumbers(m: CardMatrix, row: number): number[] {
  return m[row - 1].filter((n) => n !== 0);
}
export function setKey(m: CardMatrix): string {
  return cardNumbers(m)
    .sort((a, b) => a - b)
    .join('-');
}
function rowKey(nums: number[]): string {
  return [...nums].sort((a, b) => a - b).join('-');
}

// --- Codici -------------------------------------------------------------
const PREFIX_LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ'; // niente I, O, Q: si confondono con 1 e 0
export const MAX_PER_BATCH = 9999;

export function formatCode(prefix: string, seq: number): string {
  return `${prefix}${String(seq).padStart(4, '0')}`;
}
/** "b42", "B-0042", " B0042 " → "B0042". Restituisce null se il formato non è valido. */
export function normalizeCode(input: string): string | null {
  const s = String(input || '')
    .toUpperCase()
    .replace(/[\s\-_.]/g, '');
  const m = /^([A-Z]{1,2})0*(\d{1,4})$/.exec(s);
  if (!m) return null;
  const seq = Number(m[2]);
  if (seq < 1) return null;
  return formatCode(m[1], seq);
}

function nextPrefix(db: DB): string {
  const used = new Set((db.prepare('SELECT prefix FROM batches').all() as { prefix: string }[]).map((r) => r.prefix));
  for (const a of PREFIX_LETTERS) if (!used.has(a)) return a;
  for (const a of PREFIX_LETTERS) for (const b of PREFIX_LETTERS) if (!used.has(a + b)) return a + b;
  throw new Error('Prefissi dei lotti esauriti');
}

export interface BatchInfo {
  id: number;
  prefix: string;
  name: string;
  isDemo: boolean;
  count: number;
  printed: number;
  activeInGames: number;
  createdAt: number;
}

export function generateBatch(
  db: DB,
  opts: { count: number; name: string; isDemo?: boolean; actor?: string },
  rand: Rand = secureRand,
): BatchInfo {
  const count = Math.floor(opts.count);
  if (!(count >= 1 && count <= MAX_PER_BATCH)) throw new Error(`Quantità fra 1 e ${MAX_PER_BATCH}`);
  return tx(db, () => {
    const prefix = nextPrefix(db);
    const now = Date.now();
    const batchId = Number(
      db
        .prepare('INSERT INTO batches(prefix,name,is_demo,created_at) VALUES(?,?,?,?)')
        .run(prefix, opts.name.trim() || `Lotto ${prefix}`, opts.isDemo ? 1 : 0, now).lastInsertRowid,
    );
    const exists = db.prepare('SELECT 1 FROM cards WHERE set_key=?');
    const ins = db.prepare(
      'INSERT INTO cards(code,batch_id,seq,matrix_json,set_key,created_at) VALUES(?,?,?,?,?,?)',
    );
    const rowsInBatch = new Set<string>();
    const keysInBatch = new Set<string>();
    for (let seq = 1; seq <= count; seq++) {
      let m: CardMatrix | null = null;
      for (let attempt = 0; attempt < 200; attempt++) {
        const cand = generateMatrix(rand);
        const key = setKey(cand);
        if (keysInBatch.has(key) || exists.get(key)) continue;
        const rk = [1, 2, 3].map((r) => rowKey(rowNumbers(cand, r)));
        // Evita righe identiche nel lotto (se dopo molti tentativi non si riesce, si accetta).
        if (attempt < 150 && rk.some((k) => rowsInBatch.has(k))) continue;
        rk.forEach((k) => rowsInBatch.add(k));
        keysInBatch.add(key);
        m = cand;
        break;
      }
      if (!m) throw new Error('Impossibile generare cartelle tutte diverse');
      ins.run(formatCode(prefix, seq), batchId, seq, JSON.stringify(m), setKey(m), now);
    }
    audit(db, opts.actor ?? 'admin', 'lotto_generato', { prefix, count, demo: !!opts.isDemo });
    return getBatch(db, batchId)!;
  });
}

export function getBatch(db: DB, id: number): BatchInfo | null {
  const r = db
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM cards c WHERE c.batch_id=b.id) AS cnt,
        (SELECT COUNT(*) FROM cards c WHERE c.batch_id=b.id AND c.print_count>0) AS printed,
        (SELECT COUNT(DISTINCT gc.game_id) FROM game_cards gc JOIN cards c ON c.id=gc.card_id WHERE c.batch_id=b.id) AS games
       FROM batches b WHERE b.id=?`,
    )
    .get(id) as Record<string, number | string> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    prefix: String(r.prefix),
    name: String(r.name),
    isDemo: !!r.is_demo,
    count: Number(r.cnt),
    printed: Number(r.printed),
    activeInGames: Number(r.games),
    createdAt: Number(r.created_at),
  };
}

export function listBatches(db: DB): BatchInfo[] {
  const ids = db.prepare('SELECT id FROM batches WHERE deleted=0 ORDER BY id').all() as { id: number }[];
  return ids.map((r) => getBatch(db, r.id)!);
}

/** Un lotto si elimina solo se nessuna cartella è stata stampata o attivata. Il prefisso resta riservato. */
export function deleteBatch(db: DB, id: number): void {
  tx(db, () => {
    const b = getBatch(db, id);
    if (!b) throw new Error('Lotto inesistente');
    if (b.printed > 0 || b.activeInGames > 0) {
      throw new Error('Il lotto ha cartelle stampate o attivate: i numeri sono immutabili e non si può eliminare');
    }
    db.prepare('DELETE FROM cards WHERE batch_id=?').run(id);
    db.prepare('UPDATE batches SET deleted=1 WHERE id=?').run(id);
    audit(db, 'admin', 'lotto_eliminato', { prefix: b.prefix });
  });
}

export interface CardRow {
  id: number;
  code: string;
  batchId: number;
  matrix: CardMatrix;
  printCount: number;
}
function toCard(r: Record<string, unknown>): CardRow {
  return {
    id: Number(r.id),
    code: String(r.code),
    batchId: Number(r.batch_id),
    matrix: JSON.parse(String(r.matrix_json)),
    printCount: Number(r.print_count),
  };
}
export function getCardByCode(db: DB, code: string): CardRow | null {
  const norm = normalizeCode(code);
  if (!norm) return null;
  const r = db.prepare('SELECT * FROM cards WHERE code=?').get(norm) as Record<string, unknown> | undefined;
  return r ? toCard(r) : null;
}
export function getCardsByIds(db: DB, ids: number[]): CardRow[] {
  const st = db.prepare('SELECT * FROM cards WHERE id=?');
  return ids.map((id) => st.get(id) as Record<string, unknown> | undefined).filter(Boolean).map((r) => toCard(r!));
}
export function listCards(db: DB, opts: { batchId?: number; q?: string; limit?: number; offset?: number }): CardRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.batchId) {
    where.push('batch_id=?');
    args.push(opts.batchId);
  }
  if (opts.q) {
    const norm = normalizeCode(opts.q);
    where.push('(code LIKE ? OR code = ?)');
    args.push(`%${opts.q.toUpperCase()}%`, norm ?? '');
  }
  const sql = `SELECT * FROM cards ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY batch_id, seq LIMIT ? OFFSET ?`;
  args.push(opts.limit ?? 50, opts.offset ?? 0);
  return (db.prepare(sql).all(...args) as Record<string, unknown>[]).map(toCard);
}

/** Risolve un'espressione come "B0001-B0070, C0005" in id di cartelle esistenti. */
export function resolveCodes(db: DB, spec: string): { ids: number[]; errors: string[] } {
  const ids = new Set<number>();
  const errors: string[] = [];
  const parts = spec
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    const range = p.split(/\s*(?:-|–|\.\.)\s*(?=[A-Za-z])/);
    if (range.length === 2) {
      const a = normalizeCode(range[0]);
      const b = normalizeCode(range[1]);
      if (!a || !b) {
        errors.push(`Intervallo non valido: ${p}`);
        continue;
      }
      const pa = a.replace(/\d+$/, '');
      const pb = b.replace(/\d+$/, '');
      if (pa !== pb) {
        errors.push(`L'intervallo ${p} deve restare nello stesso lotto`);
        continue;
      }
      const rows = db
        .prepare(
          'SELECT c.id FROM cards c JOIN batches b ON b.id=c.batch_id WHERE b.prefix=? AND c.seq BETWEEN ? AND ?',
        )
        .all(pa, Number(a.slice(pa.length)), Number(b.slice(pb.length))) as { id: number }[];
      if (!rows.length) errors.push(`Nessuna cartella in ${p}`);
      rows.forEach((r) => ids.add(r.id));
    } else {
      const c = getCardByCode(db, p);
      if (!c) errors.push(`Cartella ${p} inesistente`);
      else ids.add(c.id);
    }
  }
  return { ids: [...ids], errors };
}

export function markPrinted(db: DB, ids: number[], format: string): { reprints: number } {
  return tx(db, () => {
    let reprints = 0;
    const now = Date.now();
    const st = db.prepare(
      'UPDATE cards SET print_count=print_count+1, first_printed_at=COALESCE(first_printed_at,?) WHERE id=?',
    );
    const pc = db.prepare('SELECT print_count FROM cards WHERE id=?');
    for (const id of ids) {
      if (Number((pc.get(id) as { print_count: number }).print_count) > 0) reprints++;
      st.run(now, id);
    }
    db.prepare('INSERT INTO print_log(ts,format,card_ids_json,reprint) VALUES(?,?,?,?)').run(
      now,
      format,
      JSON.stringify(ids),
      reprints,
    );
    audit(db, 'admin', 'stampa', { format, cards: ids.length, reprints });
    return { reprints };
  });
}

// --- Import / export ----------------------------------------------------
export const CSV_HEADER = ['codice', 'lotto', ...[1, 2, 3].flatMap((r) => [...Array(9).keys()].map((c) => `r${r}c${c + 1}`))];

export function exportCardsCsv(db: DB, batchId?: number): string {
  const rows = db
    .prepare(
      `SELECT c.code, b.prefix, c.matrix_json FROM cards c JOIN batches b ON b.id=c.batch_id
       ${batchId ? 'WHERE c.batch_id=?' : ''} ORDER BY c.batch_id, c.seq`,
    )
    .all(...(batchId ? [batchId] : [])) as { code: string; prefix: string; matrix_json: string }[];
  const lines = [CSV_HEADER.join(';')];
  for (const r of rows) {
    const m = JSON.parse(r.matrix_json) as CardMatrix;
    lines.push([r.code, r.prefix, ...m.flat()].join(';'));
  }
  return lines.join('\n') + '\n';
}

export function exportCardsJson(db: DB, batchId?: number) {
  const batches = (batchId ? [getBatch(db, batchId)!] : listBatches(db)).filter(Boolean);
  return {
    format: 'tombola-busa-cartelle',
    version: 1,
    note: 'matrix: 3 righe × 9 colonne, 0 = casella vuota. Colonne: 1-9, 10-19, …, 80-90.',
    batches: batches.map((b) => ({
      prefix: b.prefix,
      name: b.name,
      demo: b.isDemo,
      cards: listCards(db, { batchId: b.id, limit: MAX_PER_BATCH }).map((c) => ({ code: c.code, matrix: c.matrix })),
    })),
  };
}

/** Importa cartelle (JSON esportato o CSV). Rifiuta codici o combinazioni già presenti. */
export function importCards(db: DB, input: { csv?: string; json?: unknown }): { imported: number; errors: string[] } {
  const items: { code: string; matrix: CardMatrix; batchName: string; demo: boolean }[] = [];
  const errors: string[] = [];
  if (input.csv) {
    const lines = input.csv.split(/\r?\n/).filter((l) => l.trim());
    const sep = lines[0]?.includes(';') ? ';' : ',';
    lines.slice(1).forEach((line, i) => {
      const cols = line.split(sep).map((s) => s.trim());
      if (cols.length < 29) return errors.push(`Riga ${i + 2}: servono 29 colonne`);
      const nums = cols.slice(2, 29).map(Number);
      items.push({
        code: cols[0],
        matrix: [nums.slice(0, 9), nums.slice(9, 18), nums.slice(18, 27)],
        batchName: 'Importato',
        demo: false,
      });
    });
  } else if (input.json && typeof input.json === 'object') {
    const j = input.json as { batches?: { name?: string; demo?: boolean; cards?: { code: string; matrix: CardMatrix }[] }[] };
    for (const b of j.batches ?? []) {
      for (const c of b.cards ?? []) items.push({ code: c.code, matrix: c.matrix, batchName: b.name ?? 'Importato', demo: !!b.demo });
    }
  }
  if (!items.length && !errors.length) errors.push('Nessuna cartella trovata nel file');
  let imported = 0;
  tx(db, () => {
    const now = Date.now();
    for (const it of items) {
      const code = normalizeCode(it.code);
      if (!code) {
        errors.push(`Codice non valido: ${it.code}`);
        continue;
      }
      const v = validateMatrix(it.matrix);
      if (v.length) {
        errors.push(`${code}: ${v[0]}`);
        continue;
      }
      if (db.prepare('SELECT 1 FROM cards WHERE code=?').get(code)) {
        errors.push(`${code}: codice già presente`);
        continue;
      }
      if (db.prepare('SELECT 1 FROM cards WHERE set_key=?').get(setKey(it.matrix))) {
        errors.push(`${code}: stessi 15 numeri di una cartella esistente`);
        continue;
      }
      const prefix = code.replace(/\d+$/, '');
      let b = db.prepare('SELECT id FROM batches WHERE prefix=?').get(prefix) as { id: number } | undefined;
      if (!b) {
        b = {
          id: Number(
            db
              .prepare('INSERT INTO batches(prefix,name,is_demo,created_at) VALUES(?,?,?,?)')
              .run(prefix, it.batchName, it.demo ? 1 : 0, now).lastInsertRowid,
          ),
        };
      }
      db.prepare('INSERT INTO cards(code,batch_id,seq,matrix_json,set_key,created_at) VALUES(?,?,?,?,?,?)').run(
        code,
        b.id,
        Number(code.slice(prefix.length)),
        JSON.stringify(it.matrix),
        setKey(it.matrix),
        now,
      );
      imported++;
    }
    audit(db, 'admin', 'cartelle_importate', { imported, errors: errors.length });
  });
  return { imported, errors };
}
