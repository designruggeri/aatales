// Operazioni del CMS: serate, partite, premi, attivazione cartelle, numeri, impostazioni.
import { setSetting, type DB } from './db.js';
import { GameError, type Engine, type Branding } from './engine.js';
import { resolveCodes } from './cards.js';
import {
  CATEGORY_LABEL,
  DEFAULT_RULES,
  isCategory,
  type Category,
  type GameRules,
  type GameStatus,
  type PrizeView,
  type SpecialEvent,
} from '../../shared/types.js';

export interface EventView {
  id: number;
  name: string;
  date: string;
  isTest: boolean;
  archived: boolean;
  games: GameView[];
}
export interface GameView {
  id: number;
  eventId: number;
  name: string;
  status: GameStatus;
  isTest: boolean;
  rules: GameRules;
  rulesFrozen: boolean;
  activeCards: number;
  draws: number;
  awards: number;
  current: boolean;
  createdAt: number;
  startedAt: number | null;
  closedAt: number | null;
  closeNote: string;
}

function str(v: unknown, max = 200): string {
  return String(v ?? '').trim().slice(0, max);
}

export function sanitizeRules(input: Partial<GameRules> | undefined): GameRules {
  const r = { ...DEFAULT_RULES };
  if (!input) return r;
  if (typeof input.oneWinPerRow === 'boolean') r.oneWinPerRow = input.oneWinPerRow;
  if (input.tieBreak === 'manuale' || input.tieBreak === 'sorteggio') r.tieBreak = input.tieBreak;
  if (input.prizeAssign === 'prestabilita' || input.prizeAssign === 'sorteggio' || input.prizeAssign === 'manuale') r.prizeAssign = input.prizeAssign;
  const ms = Number(input.minDrawIntervalMs);
  if (Number.isFinite(ms)) r.minDrawIntervalMs = Math.min(10000, Math.max(800, Math.round(ms)));
  return r;
}

export class Admin {
  db: DB;
  constructor(public engine: Engine, private copyUpload: (rel: string) => string | null = () => null) {
    this.db = engine.db;
  }

  // ---------------------------------------------------------------- serate
  listEvents(): EventView[] {
    const evs = this.db.prepare('SELECT * FROM events ORDER BY archived, id DESC').all() as Record<string, unknown>[];
    return evs.map((e) => ({
      id: Number(e.id),
      name: String(e.name),
      date: String(e.date),
      isTest: !!e.is_test,
      archived: !!e.archived,
      games: (this.db.prepare('SELECT id FROM games WHERE event_id=? ORDER BY sort_order, id').all(Number(e.id)) as { id: number }[]).map((g) =>
        this.gameView(g.id),
      ),
    }));
  }

  gameView(id: number): GameView {
    const g = this.engine.game(id);
    const n = (sql: string) => Number((this.db.prepare(sql).get(id) as { c: number }).c);
    return {
      id: g.id,
      eventId: g.event_id,
      name: g.name,
      status: g.status,
      isTest: !!g.is_test,
      rules: this.engine.rules(g),
      rulesFrozen: !!g.rules_frozen_json,
      activeCards: n('SELECT COUNT(*) AS c FROM game_cards WHERE game_id=?'),
      draws: n('SELECT COUNT(*) AS c FROM draws WHERE game_id=?'),
      awards: n("SELECT COUNT(*) AS c FROM awards WHERE game_id=? AND status!='annulled'"),
      current: this.engine.currentGameId() === id,
      createdAt: Number((g as unknown as { created_at: number }).created_at),
      startedAt: (g as unknown as { started_at: number | null }).started_at,
      closedAt: (g as unknown as { closed_at: number | null }).closed_at,
      closeNote: (g as unknown as { close_note: string }).close_note,
    };
  }

  createEvent(input: { name?: string; date?: string; isTest?: boolean }): number {
    return this.engine.mutate('admin', 'serata_creata', () => {
      const name = str(input.name, 80) || 'Nuova serata';
      return Number(
        this.db
          .prepare('INSERT INTO events(name,date,is_test,created_at) VALUES(?,?,?,?)')
          .run(name, str(input.date, 20), input.isTest ? 1 : 0, Date.now()).lastInsertRowid,
      );
    });
  }

  updateEvent(id: number, input: { name?: string; date?: string; archived?: boolean }): void {
    this.engine.mutate('admin', 'serata_modificata', () => {
      const e = this.db.prepare('SELECT * FROM events WHERE id=?').get(id) as Record<string, unknown> | undefined;
      if (!e) throw new GameError('Serata inesistente');
      this.db
        .prepare('UPDATE events SET name=?, date=?, archived=? WHERE id=?')
        .run(
          input.name !== undefined ? str(input.name, 80) || String(e.name) : String(e.name),
          input.date !== undefined ? str(input.date, 20) : String(e.date),
          input.archived !== undefined ? (input.archived ? 1 : 0) : Number(e.archived),
          id,
        );
    }, { id, ...input });
  }

  /** Duplica la serata: copia partite (in preparazione), regole, premi e cartelle attive. Niente estrazioni né vincite. */
  duplicateEvent(id: number): number {
    return this.engine.mutate('admin', 'serata_duplicata', () => {
      const e = this.db.prepare('SELECT * FROM events WHERE id=?').get(id) as Record<string, unknown> | undefined;
      if (!e) throw new GameError('Serata inesistente');
      const newId = Number(
        this.db
          .prepare('INSERT INTO events(name,date,is_test,created_at) VALUES(?,?,?,?)')
          .run(`${e.name} (copia)`, '', Number(e.is_test), Date.now()).lastInsertRowid,
      );
      const games = this.db.prepare('SELECT id FROM games WHERE event_id=? ORDER BY sort_order, id').all(id) as { id: number }[];
      for (const g of games) this.copyGame(g.id, newId, null);
      return newId;
    });
  }

  // --------------------------------------------------------------- partite
  createGame(input: { eventId: number; name?: string; rules?: Partial<GameRules>; isTest?: boolean }): number {
    return this.engine.mutate('admin', 'partita_creata', () => {
      const ev = this.db.prepare('SELECT * FROM events WHERE id=?').get(input.eventId) as Record<string, unknown> | undefined;
      if (!ev) throw new GameError('Serata inesistente');
      const count = (this.db.prepare('SELECT COUNT(*) AS c FROM games WHERE event_id=?').get(input.eventId) as { c: number }).c;
      return Number(
        this.db
          .prepare('INSERT INTO games(event_id,name,sort_order,status,is_test,rules_json,created_at) VALUES(?,?,?,?,?,?,?)')
          .run(
            input.eventId,
            str(input.name, 80) || `Partita ${count + 1}`,
            count + 1,
            'setup',
            input.isTest || ev.is_test ? 1 : 0,
            JSON.stringify(sanitizeRules(input.rules)),
            Date.now(),
          ).lastInsertRowid,
      );
    });
  }

  updateGame(id: number, input: { name?: string; rules?: Partial<GameRules> }): void {
    this.engine.mutate('admin', 'partita_modificata', () => {
      const g = this.engine.game(id);
      if (input.rules && g.status !== 'setup') {
        throw new GameError('Le regole sono congelate all\'avvio della partita e non si cambiano in corso');
      }
      this.db
        .prepare('UPDATE games SET name=?, rules_json=? WHERE id=?')
        .run(
          input.name !== undefined ? str(input.name, 80) || g.name : g.name,
          input.rules ? JSON.stringify(sanitizeRules({ ...JSON.parse(g.rules_json), ...input.rules })) : g.rules_json,
          id,
        );
    }, { id, ...input });
  }

  private copyGame(srcId: number, eventId: number, name: string | null): number {
    const g = this.engine.game(srcId) as unknown as Record<string, unknown>;
    const count = (this.db.prepare('SELECT COUNT(*) AS c FROM games WHERE event_id=?').get(eventId) as { c: number }).c;
    const newId = Number(
      this.db
        .prepare('INSERT INTO games(event_id,name,sort_order,status,is_test,rules_json,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(eventId, name ?? String(g.name), count + 1, 'setup', Number(g.is_test), String(g.rules_json), Date.now()).lastInsertRowid,
    );
    const prizes = this.db.prepare('SELECT * FROM prizes WHERE game_id=? ORDER BY sort_order, id').all(srcId) as Record<string, unknown>[];
    for (const p of prizes) {
      this.db
        .prepare(
          'INSERT INTO prizes(game_id,title,description,image_path,category,quantity,sort_order,visible,reserve,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          newId,
          String(p.title),
          String(p.description),
          p.image_path ? this.copyUpload(String(p.image_path)) : null,
          String(p.category),
          Number(p.quantity),
          Number(p.sort_order),
          Number(p.visible),
          Number(p.reserve),
          Date.now(),
        );
    }
    this.db
      .prepare('INSERT INTO game_cards(game_id,card_id,activated_at) SELECT ?, card_id, ? FROM game_cards WHERE game_id=?')
      .run(newId, Date.now(), srcId);
    return newId;
  }

  /** Duplica la partita (stessa serata): utile anche per "ricominciare" una partita reale senza cancellarne la storia. */
  duplicateGame(id: number, name?: string): number {
    return this.engine.mutate('admin', 'partita_duplicata', () => {
      const g = this.engine.game(id);
      return this.copyGame(id, g.event_id, str(name, 80) || `${g.name} (copia)`);
    });
  }

  deleteGame(id: number): void {
    this.engine.mutate('admin', 'partita_eliminata', () => {
      const g = this.engine.game(id);
      if (g.status !== 'setup' && !g.is_test) throw new GameError('Una partita reale avviata non si elimina: resta in archivio');
      this.wipeGameData(id);
      this.db.prepare('DELETE FROM prizes WHERE game_id=?').run(id);
      this.db.prepare('DELETE FROM game_cards WHERE game_id=?').run(id);
      this.db.prepare('DELETE FROM games WHERE id=?').run(id);
      if (this.engine.currentGameId() === id) setSetting(this.db, 'currentGameId', null);
    }, { id });
  }

  private wipeGameData(id: number) {
    for (const t of ['awards', 'claims', 'tiebreak_draws', 'tie_groups', 'checks', 'draws']) {
      if (t === 'tiebreak_draws') this.db.prepare('DELETE FROM tiebreak_draws WHERE tie_group_id IN (SELECT id FROM tie_groups WHERE game_id=?)').run(id);
      else this.db.prepare(`DELETE FROM ${t} WHERE game_id=?`).run(id);
    }
  }

  /** Solo per le partite di prova: riporta la partita in preparazione, ripetibile all'infinito. */
  resetTestGame(id: number): void {
    this.engine.mutate('admin', 'prova_azzerata', () => {
      const g = this.engine.game(id);
      if (!g.is_test) throw new GameError('Solo le partite di prova si azzerano. Per una partita reale usa "Duplica".');
      this.wipeGameData(id);
      this.db.prepare("UPDATE games SET status='setup', rules_frozen_json=NULL, stage_json='{}', started_at=NULL, closed_at=NULL WHERE id=?").run(id);
    }, { id });
  }

  // ----------------------------------------------------------- attivazione
  activateCards(gameId: number, spec: string): { added: number; errors: string[] } {
    const { ids, errors } = resolveCodes(this.db, spec);
    if (!ids.length) return { added: 0, errors: errors.length ? errors : ['Nessuna cartella indicata'] };
    const added = this.engine.mutate('admin', 'cartelle_attivate', () => {
      const g = this.engine.game(gameId);
      if (g.status === 'closed') throw new GameError('La partita è chiusa');
      const st = this.db.prepare('INSERT OR IGNORE INTO game_cards(game_id,card_id,activated_at) VALUES(?,?,?)');
      let n = 0;
      for (const id of ids) n += Number(st.run(gameId, id, Date.now()).changes);
      return n;
    }, { gameId, spec: spec.slice(0, 200) });
    return { added, errors };
  }
  activateBatch(gameId: number, batchId: number): number {
    return this.engine.mutate('admin', 'lotto_attivato', () => {
      const g = this.engine.game(gameId);
      if (g.status === 'closed') throw new GameError('La partita è chiusa');
      return Number(
        this.db
          .prepare('INSERT OR IGNORE INTO game_cards(game_id,card_id,activated_at) SELECT ?, id, ? FROM cards WHERE batch_id=?')
          .run(gameId, Date.now(), batchId).changes,
      );
    }, { gameId, batchId });
  }
  deactivateCards(gameId: number, spec: string | null): number {
    return this.engine.mutate('admin', 'cartelle_disattivate', () => {
      const g = this.engine.game(gameId);
      if (g.status !== 'setup') throw new GameError('Le cartelle si disattivano solo prima dell\'avvio');
      if (spec == null) return Number(this.db.prepare('DELETE FROM game_cards WHERE game_id=?').run(gameId).changes);
      const { ids } = resolveCodes(this.db, spec);
      const st = this.db.prepare('DELETE FROM game_cards WHERE game_id=? AND card_id=?');
      return ids.reduce((n, id) => n + Number(st.run(gameId, id).changes), 0);
    }, { gameId, spec });
  }
  activeSummary(gameId: number): { batch: string; count: number; total: number }[] {
    return this.db
      .prepare(
        `SELECT b.prefix AS batch, COUNT(gc.card_id) AS count, (SELECT COUNT(*) FROM cards c2 WHERE c2.batch_id=b.id) AS total
         FROM game_cards gc JOIN cards c ON c.id=gc.card_id JOIN batches b ON b.id=c.batch_id
         WHERE gc.game_id=? GROUP BY b.id ORDER BY b.id`,
      )
      .all(gameId) as { batch: string; count: number; total: number }[];
  }

  // ----------------------------------------------------------------- premi
  listPrizes(gameId: number): PrizeView[] {
    return (this.db
      .prepare(
        `SELECT p.*,
          (SELECT COUNT(*) FROM awards a WHERE a.prize_id=p.id AND a.status!='annulled') AS assigned,
          (SELECT COUNT(*) FROM awards a WHERE a.prize_id=p.id AND a.status='revealed') AS revealed
         FROM prizes p WHERE p.game_id=? ORDER BY p.reserve, p.sort_order, p.id`,
      )
      .all(gameId) as Record<string, unknown>[]).map((p) => ({
      id: Number(p.id),
      gameId: Number(p.game_id),
      title: String(p.title),
      description: String(p.description),
      category: p.category as Category,
      quantity: Number(p.quantity),
      assigned: Number(p.assigned),
      revealed: Number(p.revealed),
      sortOrder: Number(p.sort_order),
      visible: !!p.visible,
      reserve: !!p.reserve,
      hasImage: !!p.image_path,
    }));
  }

  savePrize(input: {
    id?: number;
    gameId: number;
    title?: string;
    description?: string;
    category?: string;
    quantity?: number;
    sortOrder?: number;
    visible?: boolean;
    reserve?: boolean;
  }): number {
    return this.engine.mutate('admin', input.id ? 'premio_modificato' : 'premio_creato', () => {
      const g = this.engine.game(input.gameId);
      if (g.status === 'closed') throw new GameError('La partita è chiusa: i premi restano in archivio');
      const title = str(input.title, 80);
      if (!title) throw new GameError('Il premio deve avere un titolo');
      if (!isCategory(input.category)) throw new GameError('Categoria non valida');
      const qty = Math.floor(Number(input.quantity));
      if (!(qty >= 0 && qty <= 500)) throw new GameError('Quantità fra 0 e 500');
      const desc = str(input.description, 400);
      if (input.id) {
        const p = this.db.prepare('SELECT * FROM prizes WHERE id=? AND game_id=?').get(input.id, input.gameId) as Record<string, unknown> | undefined;
        if (!p) throw new GameError('Premio inesistente');
        const used = (this.db.prepare("SELECT COUNT(*) AS c FROM awards WHERE prize_id=? AND status!='annulled'").get(input.id) as { c: number }).c;
        if (qty < used) throw new GameError(`Ne sono già stati assegnati ${used}: la quantità non può scendere sotto`);
        if (used && (p.category !== input.category || !!p.reserve !== !!input.reserve)) {
          throw new GameError('Premio già assegnato: categoria e riserva non si cambiano più');
        }
        this.db
          .prepare('UPDATE prizes SET title=?, description=?, category=?, quantity=?, sort_order=?, visible=?, reserve=? WHERE id=?')
          .run(title, desc, input.category, qty, Number(input.sortOrder ?? p.sort_order) || 0, input.visible === false ? 0 : 1, input.reserve ? 1 : 0, input.id);
        return input.id;
      }
      const order = (this.db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS o FROM prizes WHERE game_id=?').get(input.gameId) as { o: number }).o;
      return Number(
        this.db
          .prepare(
            'INSERT INTO prizes(game_id,title,description,category,quantity,sort_order,visible,reserve,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
          )
          .run(input.gameId, title, desc, input.category, qty, Number(input.sortOrder ?? order) || order, input.visible === false ? 0 : 1, input.reserve ? 1 : 0, Date.now())
          .lastInsertRowid,
      );
    }, { ...input, category: input.category && isCategory(input.category) ? CATEGORY_LABEL[input.category] : input.category });
  }

  deletePrize(id: number): string | null {
    return this.engine.mutate('admin', 'premio_eliminato', () => {
      const p = this.db.prepare('SELECT * FROM prizes WHERE id=?').get(id) as Record<string, unknown> | undefined;
      if (!p) throw new GameError('Premio inesistente');
      if (this.db.prepare('SELECT 1 FROM awards WHERE prize_id=?').get(id)) {
        throw new GameError('Il premio compare in una vincita (anche annullata): imposta la quantità a quella già assegnata invece di eliminarlo');
      }
      if (this.engine.game(Number(p.game_id)).status !== 'setup' && !this.engine.game(Number(p.game_id)).is_test) {
        throw new GameError('A partita avviata i premi non si eliminano: riduci la quantità');
      }
      this.db.prepare('DELETE FROM prizes WHERE id=?').run(id);
      return (p.image_path as string) ?? null;
    }, { id });
  }

  setPrizeImage(id: number, rel: string | null): string | null {
    return this.engine.mutate('admin', 'premio_immagine', () => {
      const p = this.db.prepare('SELECT image_path FROM prizes WHERE id=?').get(id) as { image_path: string | null } | undefined;
      if (!p) throw new GameError('Premio inesistente');
      this.db.prepare('UPDATE prizes SET image_path=? WHERE id=?').run(rel, id);
      return p.image_path;
    }, { id });
  }
  prizeImagePath(id: number): string | null {
    const p = this.db.prepare('SELECT image_path FROM prizes WHERE id=?').get(id) as { image_path: string | null } | undefined;
    return p?.image_path ?? null;
  }

  // ---------------------------------------------------------------- numeri
  listNumbers() {
    return (this.db.prepare('SELECT * FROM numbers ORDER BY n').all() as Record<string, unknown>[]).map((r) => ({
      n: Number(r.n),
      traditional: String(r.traditional),
      busaText: String(r.busa_text),
      hostJoke: String(r.host_joke),
      image: (r.image_path as string) ?? null,
      audio: (r.audio_path as string) ?? null,
      special: String(r.special) as SpecialEvent,
    }));
  }
  updateNumber(n: number, input: { traditional?: string; busaText?: string; hostJoke?: string; special?: string }): void {
    if (!(n >= 1 && n <= 90)) throw new GameError('Numero fuori intervallo');
    this.engine.mutate('admin', 'numero_modificato', () => {
      const r = this.db.prepare('SELECT * FROM numbers WHERE n=?').get(n) as Record<string, string>;
      const special = ['none', 'clacson', 'camioncino'].includes(String(input.special)) ? String(input.special) : r.special;
      this.db
        .prepare('UPDATE numbers SET traditional=?, busa_text=?, host_joke=?, special=? WHERE n=?')
        .run(
          input.traditional !== undefined ? str(input.traditional, 120) : r.traditional,
          input.busaText !== undefined ? str(input.busaText, 160) : r.busa_text,
          input.hostJoke !== undefined ? str(input.hostJoke, 300) : r.host_joke,
          special,
          n,
        );
    }, { n });
  }
  setNumberMedia(n: number, kind: 'image' | 'audio', rel: string | null): string | null {
    return this.engine.mutate('admin', 'numero_media', () => {
      const col = kind === 'image' ? 'image_path' : 'audio_path';
      const r = this.db.prepare(`SELECT ${col} AS p FROM numbers WHERE n=?`).get(n) as { p: string | null };
      this.db.prepare(`UPDATE numbers SET ${col}=? WHERE n=?`).run(rel, n);
      return r.p;
    }, { n, kind });
  }
  exportNumbers() {
    return {
      format: 'tombola-busa-numeri',
      version: 1,
      note: 'traditional = significato tradizionale (indicare la fonte); busaText = testo Busa inventato; hostJoke = battuta solo per il conduttore.',
      numbers: this.listNumbers().map(({ n, traditional, busaText, hostJoke, special }) => ({ n, traditional, busaText, hostJoke, special })),
    };
  }
  importNumbers(json: unknown): number {
    const list = (json as { numbers?: unknown[] })?.numbers;
    if (!Array.isArray(list)) throw new GameError('File non valido: manca "numbers"');
    let n = 0;
    this.engine.mutate('admin', 'numeri_importati', () => {
      for (const item of list as Record<string, unknown>[]) {
        const num = Number(item.n);
        if (!(num >= 1 && num <= 90)) continue;
        const special = ['none', 'clacson', 'camioncino'].includes(String(item.special)) ? String(item.special) : 'none';
        this.db
          .prepare('UPDATE numbers SET traditional=?, busa_text=?, host_joke=?, special=? WHERE n=?')
          .run(str(item.traditional, 120), str(item.busaText, 160), str(item.hostJoke, 300), special, num);
        n++;
      }
      return { n };
    });
    return n;
  }

  // ---------------------------------------------------------- impostazioni
  saveBranding(input: Partial<Branding>): Branding {
    return this.engine.mutate('admin', 'aspetto_modificato', () => {
      const b = this.engine.branding();
      const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
      const next: Branding = {
        title: input.title !== undefined ? str(input.title, 40) || b.title : b.title,
        christmas: typeof input.christmas === 'boolean' ? input.christmas : b.christmas,
        logoPath: input.logoPath !== undefined ? input.logoPath : b.logoPath,
        colors: {
          primary: hex(input.colors?.primary, b.colors.primary),
          dark: hex(input.colors?.dark, b.colors.dark),
          light: hex(input.colors?.light, b.colors.light),
          accent: hex(input.colors?.accent, b.colors.accent),
        },
      };
      setSetting(this.db, 'branding', next);
      return next;
    });
  }

  // -------------------------------------------------------------- archivio
  winnersArchive(opts: { includeTest?: boolean } = {}) {
    return this.db
      .prepare(
        `SELECT e.name AS event, g.name AS game, g.is_test AS test, a.id, a.category, c.code, a.row, a.winner_name,
                p.title AS prize, a.reserve, a.status, a.draw_idx, a.created_at, a.revealed_at, a.annul_reason
         FROM awards a JOIN games g ON g.id=a.game_id JOIN events e ON e.id=g.event_id
         JOIN cards c ON c.id=a.card_id JOIN prizes p ON p.id=a.prize_id
         ${opts.includeTest ? '' : 'WHERE g.is_test=0'}
         ORDER BY a.created_at`,
      )
      .all() as Record<string, string | number | null>[];
  }

  winnersCsv(opts: { includeTest?: boolean } = {}): string {
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ['serata', 'partita', 'prova', 'categoria', 'cartella', 'riga', 'vincitore', 'premio', 'riserva', 'stato', 'estrazione_n', 'data_ora', 'motivo_annullamento'];
    const lines = [head.join(';')];
    for (const r of this.winnersArchive(opts)) {
      lines.push(
        [
          r.event, r.game, r.test ? 'si' : 'no', CATEGORY_LABEL[r.category as Category], r.code, r.row ?? '', r.winner_name ?? '', r.prize,
          r.reserve ? 'si' : 'no', r.status, r.draw_idx, new Date(Number(r.created_at)).toISOString(), r.annul_reason ?? '',
        ].map(esc).join(';'),
      );
    }
    return lines.join('\n') + '\n';
  }

  auditLog(limit = 300, gameId?: number) {
    return (this.db
      .prepare(`SELECT * FROM audit ${gameId ? 'WHERE game_id=?' : ''} ORDER BY id DESC LIMIT ?`)
      .all(...(gameId ? [gameId, limit] : [limit])) as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      ts: Number(r.ts),
      actor: String(r.actor),
      gameId: r.game_id == null ? null : Number(r.game_id),
      action: String(r.action),
      detail: JSON.parse(String(r.detail_json)),
    }));
  }
}
