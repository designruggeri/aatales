// Motore di gioco: estrazioni, verifiche, dichiarazioni, pari merito, premi.
// Tutte le decisioni (numeri, vincite, regali) avvengono qui, sul server, dentro transazioni.
import { audit, bumpVersion, currentVersion, getSetting, setSetting, tx, type DB } from './db.js';
import { getCardByCode, rowNumbers, cardNumbers, secureRand, type CardRow, type Rand } from './cards.js';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  CATEGORY_PLURAL,
  DEFAULT_RULES,
  LINE_CATEGORIES,
  THRESHOLD,
  isCategory,
  rulesSummary,
  type AwardView,
  type Category,
  type CategoryCount,
  type ClaimView,
  type ControlState,
  type EffectKind,
  type GameRules,
  type GameStatus,
  type NumberInfo,
  type PublicAward,
  type PublicState,
  type RowReport,
  type SpecialEvent,
  type StageType,
  type TieGroupView,
  type VerifyReport,
} from '../../shared/types.js';

export class GameError extends Error {
  constructor(message: string, public code = 'invalid') {
    super(message);
  }
}

export interface Stage {
  type: StageType;
  effectId: number;
  effectKind: EffectKind;
  effectAt: number;
  awardId: number | null;
  zoom: boolean;
  message: string;
}

interface GameRow {
  id: number;
  event_id: number;
  name: string;
  status: GameStatus;
  is_test: number;
  rules_json: string;
  rules_frozen_json: string | null;
  stage_json: string;
}

export interface Branding {
  title: string;
  colors: { primary: string; dark: string; light: string; accent: string };
  christmas: boolean;
  logoPath: string | null;
}
export const DEFAULT_BRANDING: Branding = {
  title: 'Tombola Busa',
  colors: { primary: '#52AE32', dark: '#1F6B2A', light: '#CDEBB8', accent: '#E8432C' },
  christmas: true,
  logoPath: null,
};
export interface DisplayFlags {
  muted: boolean;
  reducedMotion: boolean;
  voice: boolean;
}
const DEFAULT_FLAGS: DisplayFlags = { muted: false, reducedMotion: false, voice: false };

export interface CommandResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
  replayed?: boolean;
  version: number;
}

const lineCategoryForCount = (count: number): Category | null =>
  count === 2 ? 'ambo' : count === 3 ? 'terno' : count === 4 ? 'quaterna' : count === 5 ? 'cinquina' : null;

export class Engine {
  rand: Rand;
  now: () => number;
  onChange: () => void = () => {};

  constructor(public db: DB, opts: { rand?: Rand; now?: () => number } = {}) {
    this.rand = opts.rand ?? secureRand;
    this.now = opts.now ?? Date.now;
  }

  // ---------------------------------------------------------------- comandi
  /**
   * Esegue un comando una sola volta: lo stesso commandId (doppio tocco, retry dopo una
   * risposta persa) restituisce il risultato già salvato senza ripetere l'azione.
   */
  run<T>(commandId: string, kind: string, actor: string, fn: () => T): CommandResult<T> {
    if (!/^[\w-]{8,80}$/.test(commandId)) {
      return { ok: false, error: 'Identificativo del comando non valido', version: currentVersion(this.db) };
    }
    const prev = this.db.prepare('SELECT kind, result_json FROM commands WHERE id=?').get(commandId) as
      | { kind: string; result_json: string }
      | undefined;
    if (prev) {
      const r = JSON.parse(prev.result_json) as CommandResult<T>;
      return { ...r, replayed: true, version: currentVersion(this.db) };
    }
    let out: CommandResult<T>;
    try {
      out = tx(this.db, () => {
        const result = fn();
        const version = bumpVersion(this.db);
        const res: CommandResult<T> = { ok: true, result, version };
        this.db.prepare('INSERT INTO commands(id,kind,result_json,created_at) VALUES(?,?,?,?)').run(
          commandId,
          kind,
          JSON.stringify(res),
          this.now(),
        );
        return res;
      });
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
      out = { ok: false, error: e.message, version: currentVersion(this.db) };
      this.db.prepare('INSERT OR IGNORE INTO commands(id,kind,result_json,created_at) VALUES(?,?,?,?)').run(
        commandId,
        kind,
        JSON.stringify(out),
        this.now(),
      );
      audit(this.db, actor, 'comando_rifiutato', { kind, error: e.message });
      return out;
    }
    audit(this.db, actor, kind, out.result ?? {}, this.currentGameId());
    this.onChange();
    return out;
  }

  /** Mutazione amministrativa (non idempotente per id): transazione + versione + notifica. */
  mutate<T>(actor: string, action: string, fn: () => T, detail?: unknown): T {
    const r = tx(this.db, () => {
      const res = fn();
      bumpVersion(this.db);
      audit(this.db, actor, action, detail ?? res ?? {}, this.currentGameId());
      return res;
    });
    this.onChange();
    return r;
  }

  // ------------------------------------------------------------- lettura base
  currentGameId(): number | null {
    const id = getSetting<number | null>(this.db, 'currentGameId', null);
    if (id == null) return null;
    return this.db.prepare('SELECT 1 FROM games WHERE id=?').get(id) ? id : null;
  }
  game(id: number): GameRow {
    const g = this.db.prepare('SELECT * FROM games WHERE id=?').get(id) as GameRow | undefined;
    if (!g) throw new GameError('Partita inesistente', 'not_found');
    return g;
  }
  currentGame(): GameRow {
    const id = this.currentGameId();
    if (id == null) throw new GameError('Nessuna partita selezionata');
    return this.game(id);
  }
  rules(g: GameRow): GameRules {
    return { ...DEFAULT_RULES, ...JSON.parse(g.rules_frozen_json ?? g.rules_json) };
  }
  stage(g: GameRow): Stage {
    const s = JSON.parse(g.stage_json || '{}') as Partial<Stage>;
    return {
      type: s.type ?? (g.status === 'setup' ? 'waiting' : g.status === 'closed' ? 'final' : 'active'),
      effectId: s.effectId ?? 0,
      effectKind: s.effectKind ?? 'none',
      effectAt: s.effectAt ?? 0,
      awardId: s.awardId ?? null,
      zoom: !!s.zoom,
      message: s.message ?? '',
    };
  }
  private setStage(gameId: number, patch: Partial<Stage>, effect?: EffectKind): Stage {
    const g = this.game(gameId);
    const s: Stage = { ...this.stage(g), ...patch };
    if (effect) {
      const n = getSetting<number>(this.db, 'effectCounter', 0) + 1;
      setSetting(this.db, 'effectCounter', n);
      s.effectId = n;
      s.effectKind = effect;
      s.effectAt = this.now();
    }
    this.db.prepare('UPDATE games SET stage_json=? WHERE id=?').run(JSON.stringify(s), gameId);
    return s;
  }
  draws(gameId: number): number[] {
    return (this.db.prepare('SELECT number FROM draws WHERE game_id=? ORDER BY idx').all(gameId) as { number: number }[]).map(
      (r) => r.number,
    );
  }
  private lastDrawAt(gameId: number): number {
    const r = this.db.prepare('SELECT MAX(created_at) AS t FROM draws WHERE game_id=?').get(gameId) as { t: number | null };
    return r.t ?? 0;
  }
  openCheck(gameId: number): { id: number; draw_idx: number } | null {
    return (
      (this.db.prepare("SELECT id, draw_idx FROM checks WHERE game_id=? AND status='open' ORDER BY id DESC").get(gameId) as
        | { id: number; draw_idx: number }
        | undefined) ?? null
    );
  }
  isActiveCard(gameId: number, cardId: number): boolean {
    return !!this.db.prepare('SELECT 1 FROM game_cards WHERE game_id=? AND card_id=?').get(gameId, cardId);
  }

  /** Premi in palio (non di riserva) e quanti ne restano, per categoria. */
  categoryCounts(gameId: number): CategoryCount[] {
    return CATEGORIES.map((category) => {
      const total = Number(
        (this.db
          .prepare('SELECT COALESCE(SUM(quantity),0) AS q FROM prizes WHERE game_id=? AND category=? AND reserve=0')
          .get(gameId, category) as { q: number }).q,
      );
      const used = Number(
        (this.db
          .prepare("SELECT COUNT(*) AS c FROM awards WHERE game_id=? AND category=? AND reserve=0 AND status!='annulled'")
          .get(gameId, category) as { c: number }).c,
      );
      return { category, total, remaining: Math.max(0, total - used) };
    });
  }
  private remaining(gameId: number, category: Category): number {
    return this.categoryCounts(gameId).find((c) => c.category === category)!.remaining;
  }
  private availablePrizes(gameId: number, category: Category, reserve: boolean) {
    return (this.db
      .prepare(
        `SELECT p.id, p.title, p.quantity - (SELECT COUNT(*) FROM awards a WHERE a.prize_id=p.id AND a.status!='annulled') AS left
         FROM prizes p WHERE p.game_id=? AND p.category=? AND p.reserve=? ORDER BY p.sort_order, p.id`,
      )
      .all(gameId, category, reserve ? 1 : 0) as { id: number; title: string; left: number }[]).filter((p) => p.left > 0);
  }
  private rowLocks(gameId: number, cardId: number): Map<number, Category> {
    const rows = this.db
      .prepare("SELECT row, category FROM awards WHERE game_id=? AND card_id=? AND row IS NOT NULL AND status!='annulled'")
      .all(gameId, cardId) as { row: number; category: Category }[];
    return new Map(rows.map((r) => [r.row, r.category]));
  }
  private hasTombola(gameId: number, cardId: number): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM awards WHERE game_id=? AND card_id=? AND category='tombola' AND status!='annulled'")
      .get(gameId, cardId);
  }

  // ---------------------------------------------------------------- verifica
  /** Analisi della cartella all'estrazione congelata drawIdx. Non modifica nulla. */
  evaluate(gameId: number, code: string, drawIdx?: number): VerifyReport & { card: CardRow | null } {
    const g = this.game(gameId);
    const rules = this.rules(g);
    const allDraws = this.draws(gameId);
    const idx = drawIdx ?? this.openCheck(gameId)?.draw_idx ?? allDraws.length;
    const drawn = new Set(allDraws.slice(0, idx));
    const last = idx > 0 ? allDraws[idx - 1] : null;
    const card = getCardByCode(this.db, code);
    const base = {
      code: card?.code ?? code.toUpperCase().trim(),
      drawIdx: idx,
      lastNumber: last,
      card,
    };
    if (!card) {
      return { ...base, found: false, active: false, matrix: null, rows: [], tombola: { count: 0, qualifies: false, reason: '' }, message: 'Cartella inesistente: controlla il codice' };
    }
    const active = this.isActiveCard(gameId, card.id);
    const counts = new Map(this.categoryCounts(gameId).map((c) => [c.category, c]));
    const locks = this.rowLocks(gameId, card.id);
    const rows: RowReport[] = [1, 2, 3].map((row) => {
      const numbers = rowNumbers(card.matrix, row);
      const hit = numbers.filter((n) => drawn.has(n));
      const containsLast = last != null && numbers.includes(last);
      const lockedBy = rules.oneWinPerRow ? locks.get(row) ?? null : null;
      const cat = lineCategoryForCount(hit.length);
      let qualifies: Category | null = null;
      let reason: string;
      if (!active) reason = 'Cartella non attiva in questa partita';
      else if (!cat) reason = 'nessuna combinazione';
      else if (!containsLast) reason = `${CATEGORY_LABEL[cat]} non completato con l'ultimo numero${last ? ` (${last})` : ''}`;
      else if (lockedBy) reason = `Riga già premiata con ${CATEGORY_LABEL[lockedBy].toLowerCase()} (una vincita per riga)`;
      else if (!counts.get(cat)!.total) reason = `${CATEGORY_LABEL[cat]} non è in palio in questa partita`;
      else if (!counts.get(cat)!.remaining) reason = `Categoria ${CATEGORY_LABEL[cat].toLowerCase()} esaurita`;
      else {
        qualifies = cat;
        reason = `${CATEGORY_LABEL[cat]} valido sulla riga ${row}`;
      }
      return { row, numbers, drawn: hit, count: hit.length, containsLast, lockedBy, qualifies, reason };
    });
    const all = cardNumbers(card.matrix);
    const tCount = all.filter((n) => drawn.has(n)).length;
    let tReason: string;
    let tQual = false;
    if (!active) tReason = 'Cartella non attiva in questa partita';
    else if (tCount < 15) tReason = `${tCount} numeri su 15`;
    else if (!(last != null && all.includes(last))) tReason = "Tombola non completata con l'ultimo numero";
    else if (this.hasTombola(gameId, card.id)) tReason = 'Cartella già premiata per la tombola';
    else if (!counts.get('tombola')!.total) tReason = 'La tombola non è in palio in questa partita';
    else if (!counts.get('tombola')!.remaining) tReason = 'Categoria tombola esaurita';
    else {
      tQual = true;
      tReason = 'Tombola valida';
    }
    const anyQ = rows.some((r) => r.qualifies) || tQual;
    return {
      ...base,
      found: true,
      active,
      matrix: card.matrix,
      rows,
      tombola: { count: tCount, qualifies: tQual, reason: tReason },
      message: !active ? 'Cartella non attiva in questa partita' : anyQ ? 'Vincita possibile: scegli categoria e riga' : 'Nessuna vincita valida con l\'ultimo numero',
    };
  }

  // ------------------------------------------------------------- operazioni
  draw(gameId: number, expectedCount: number): { number: number; idx: number } {
    const g = this.game(gameId);
    const block = this.drawBlock(g);
    if (block) throw new GameError(block, 'blocked');
    const draws = this.draws(gameId);
    if (expectedCount !== draws.length) {
      throw new GameError('Lo stato è cambiato (estrazione già eseguita da un altro comando): ricontrolla il tabellone', 'stale');
    }
    const drawn = new Set(draws);
    const remaining: number[] = [];
    for (let n = 1; n <= 90; n++) if (!drawn.has(n)) remaining.push(n);
    const number = remaining[this.rand(remaining.length)];
    const idx = draws.length + 1;
    this.db.prepare('INSERT INTO draws(game_id,idx,number,created_at) VALUES(?,?,?,?)').run(gameId, idx, number, this.now());
    this.setStage(gameId, { type: 'active', awardId: null, zoom: false, message: '' }, 'draw');
    return { number, idx };
  }

  drawBlock(g: GameRow, checkInterval = true): string {
    if (g.status === 'setup') return 'La partita non è ancora iniziata';
    if (g.status === 'closed') return 'La partita è chiusa';
    const st = this.stage(g);
    if (st.type === 'check') return 'Verifica in corso: premi Riprendi per continuare';
    if (st.type === 'winner' || st.type === 'gift') return 'Annuncio in corso: premi Riprendi per continuare';
    if (st.type === 'pause') return 'Gioco in pausa: premi Riprendi';
    if (st.type === 'final') return 'Riepilogo finale in corso';
    if (this.openCheck(g.id)) return 'Verifica aperta: premi Riprendi';
    const n = this.draws(g.id).length;
    if (n >= 90) return 'Tutti i 90 numeri sono stati estratti';
    const wait = this.rules(g).minDrawIntervalMs - (this.now() - this.lastDrawAt(g.id));
    if (checkInterval && wait > 0) return 'Attendi la fine dell\'animazione';
    return '';
  }

  /** "Vincita dichiarata / Pausa": congela le estrazioni sull'ultimo numero. */
  openClaimCheck(gameId: number): { checkId: number; drawIdx: number } {
    const g = this.game(gameId);
    if (g.status !== 'active') throw new GameError('La partita non è in corso');
    const open = this.openCheck(gameId);
    if (open) {
      this.setStage(gameId, { type: 'check', awardId: null, zoom: false }, 'none');
      return { checkId: open.id, drawIdx: open.draw_idx };
    }
    const drawIdx = this.draws(gameId).length;
    const id = Number(
      this.db
        .prepare("INSERT INTO checks(game_id,draw_idx,status,opened_at) VALUES(?,?,'open',?)")
        .run(gameId, drawIdx, this.now()).lastInsertRowid,
    );
    this.setStage(gameId, { type: 'check', awardId: null, zoom: false, message: '' }, 'none');
    return { checkId: id, drawIdx };
  }

  addClaim(gameId: number, input: { code: string; category: string; row?: number | null; winnerName?: string }): ClaimView {
    const g = this.game(gameId);
    if (g.status !== 'active') throw new GameError('La partita non è in corso');
    const check = this.openCheck(gameId);
    if (!check) throw new GameError('Premi prima "Vincita dichiarata / Pausa"');
    if (!isCategory(input.category)) throw new GameError('Categoria non valida');
    const category = input.category;
    const isLine = category !== 'tombola';
    const row = isLine ? Number(input.row) : null;
    if (isLine && !(row! >= 1 && row! <= 3)) throw new GameError('Indica la riga (1, 2 o 3)');
    const rep = this.evaluate(gameId, input.code, check.draw_idx);
    const name = (input.winnerName ?? '').trim().slice(0, 60) || null;
    let status: 'valid' | 'rejected' = 'rejected';
    let reason: string;
    if (!rep.found) reason = 'Cartella inesistente';
    else if (!rep.active) reason = 'Cartella non attiva in questa partita';
    else if (isLine) {
      const r = rep.rows[row! - 1];
      if (r.qualifies === category) {
        status = 'valid';
        reason = r.reason;
      } else if (r.qualifies) reason = `La riga ${row} vale ${CATEGORY_LABEL[r.qualifies].toLowerCase()}, non ${CATEGORY_LABEL[category].toLowerCase()}`;
      else if (r.containsLast && lineCategoryForCount(r.count) && lineCategoryForCount(r.count) !== category && !r.lockedBy)
        reason = `La riga ${row} ha ${r.count} numeri: non è ${CATEGORY_LABEL[category].toLowerCase()}`;
      else reason = r.reason;
    } else {
      status = rep.tombola.qualifies ? 'valid' : 'rejected';
      reason = rep.tombola.reason;
    }
    if (status === 'valid') {
      const dup = this.db
        .prepare("SELECT 1 FROM claims WHERE check_id=? AND card_id=? AND category=? AND COALESCE(row,0)=? AND status IN ('valid','tie','awarded')")
        .get(check.id, rep.card!.id, category, row ?? 0);
      if (dup) throw new GameError('Dichiarazione già inserita per questa cartella');
    }
    const id = Number(
      this.db
        .prepare(
          'INSERT INTO claims(game_id,check_id,draw_idx,card_id,card_code,category,row,winner_name,status,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(gameId, check.id, check.draw_idx, rep.card?.id ?? null, rep.code, category, row, name, status, reason, this.now())
        .lastInsertRowid,
    );
    return this.claimView(id);
  }

  removeClaim(claimId: number): void {
    const c = this.db.prepare('SELECT * FROM claims WHERE id=?').get(claimId) as Record<string, unknown> | undefined;
    if (!c) throw new GameError('Dichiarazione inesistente');
    if (c.status !== 'valid' && c.status !== 'rejected') throw new GameError('Dichiarazione già confermata');
    this.db.prepare("UPDATE claims SET status='dismissed' WHERE id=?").run(claimId);
  }

  /**
   * Conferma le dichiarazioni valide dell'estrazione congelata. Nessuna precedenza per ordine di inserimento:
   * se i premi bastano li assegna tutti, altrimenti apre un gruppo di pari merito per quella categoria.
   */
  confirmClaims(gameId: number, prizeChoices: Record<string, number> = {}): { awards: number[]; ties: number[] } {
    const g = this.game(gameId);
    if (g.status !== 'active') throw new GameError('La partita non è in corso');
    const check = this.openCheck(gameId);
    if (!check) throw new GameError('Nessuna verifica aperta');
    const rules = this.rules(g);
    const claims = this.db
      .prepare("SELECT * FROM claims WHERE check_id=? AND status='valid' ORDER BY id")
      .all(check.id) as { id: number; card_id: number; category: Category; row: number | null; card_code: string }[];
    if (!claims.length) throw new GameError('Nessuna dichiarazione valida da confermare');
    if (rules.oneWinPerRow) {
      const seen = new Set<string>();
      for (const c of claims.filter((c) => c.row != null)) {
        const k = `${c.card_id}:${c.row}`;
        if (seen.has(k)) throw new GameError(`Due vincite sulla stessa riga di ${c.card_code}: ne è ammessa una sola`);
        seen.add(k);
      }
    }
    const awards: number[] = [];
    const ties: number[] = [];
    for (const category of CATEGORIES) {
      const group = claims.filter((c) => c.category === category);
      if (!group.length) continue;
      // Ricontrolla la validità al momento della conferma (un annullamento o un'altra conferma può averla cambiata).
      for (const c of group) {
        const rep = this.evaluate(gameId, c.card_code, check.draw_idx);
        const ok = c.row == null ? rep.tombola.qualifies : rep.rows[c.row - 1].qualifies === category;
        if (!ok) throw new GameError(`La dichiarazione di ${c.card_code} non è più valida: rimuovila`);
      }
      const available = this.remaining(gameId, category);
      if (group.length <= available) {
        for (const c of group) awards.push(this.award(gameId, c.id, rules, prizeChoices[String(c.id)]));
      } else {
        const tieId = Number(
          this.db
            .prepare('INSERT INTO tie_groups(game_id,check_id,draw_idx,category,available,status,created_at) VALUES(?,?,?,?,?,?,?)')
            .run(gameId, check.id, check.draw_idx, category, available, 'open', this.now()).lastInsertRowid,
        );
        const st = this.db.prepare("UPDATE claims SET status='tie', tie_group_id=? WHERE id=?");
        group.forEach((c) => st.run(tieId, c.id));
        ties.push(tieId);
      }
    }
    return { awards, ties };
  }

  private pickPrize(gameId: number, category: Category, rules: GameRules, chosen?: number, reserve = false): number {
    const avail = this.availablePrizes(gameId, category, reserve);
    if (!avail.length) throw new GameError(`Nessun premio ${reserve ? 'di riserva ' : ''}disponibile per ${CATEGORY_LABEL[category].toLowerCase()}`);
    if (reserve || rules.prizeAssign === 'manuale') {
      if (chosen == null) {
        if (avail.length === 1 && !reserve) return avail[0].id;
        throw new GameError(`Scegli il premio da assegnare (${CATEGORY_LABEL[category].toLowerCase()})`);
      }
      if (!avail.some((p) => p.id === chosen)) throw new GameError('Il premio scelto non è disponibile');
      return chosen;
    }
    if (rules.prizeAssign === 'sorteggio') {
      // Ogni unità disponibile ha la stessa probabilità.
      const total = avail.reduce((s, p) => s + p.left, 0);
      let k = this.rand(total);
      for (const p of avail) {
        if (k < p.left) return p.id;
        k -= p.left;
      }
    }
    return avail[0].id;
  }

  private award(gameId: number, claimId: number, rules: GameRules, chosenPrize?: number, reserve = false): number {
    const c = this.db.prepare('SELECT * FROM claims WHERE id=?').get(claimId) as {
      id: number; card_id: number; category: Category; row: number | null; winner_name: string | null; draw_idx: number;
    };
    if (rules.oneWinPerRow && c.row != null && this.rowLocks(gameId, c.card_id).has(c.row)) {
      throw new GameError('Riga già premiata (una vincita per riga)');
    }
    if (c.category === 'tombola' && this.hasTombola(gameId, c.card_id)) throw new GameError('Cartella già premiata per la tombola');
    const prizeId = this.pickPrize(gameId, c.category, rules, chosenPrize, reserve);
    const id = Number(
      this.db
        .prepare(
          "INSERT INTO awards(game_id,claim_id,card_id,row,category,prize_id,reserve,winner_name,draw_idx,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'assigned',?)",
        )
        .run(gameId, c.id, c.card_id, c.row, c.category, prizeId, reserve ? 1 : 0, c.winner_name, c.draw_idx, this.now())
        .lastInsertRowid,
    );
    this.db.prepare("UPDATE claims SET status='awarded' WHERE id=?").run(c.id);
    return id;
  }

  resolveTie(
    tieId: number,
    input: { method: 'manuale' | 'sorteggio'; winners?: number[]; reason?: string; prizeChoices?: Record<string, number> },
  ): { awards: number[]; losers: number[]; drawn?: number[] } {
    const t = this.db.prepare('SELECT * FROM tie_groups WHERE id=?').get(tieId) as
      | { id: number; game_id: number; category: Category; available: number; status: string }
      | undefined;
    if (!t) throw new GameError('Pari merito inesistente');
    if (t.status !== 'open') throw new GameError('Pari merito già risolto');
    const g = this.game(t.game_id);
    const rules = this.rules(g);
    if (input.method !== rules.tieBreak) {
      throw new GameError(`La procedura annunciata per questa partita è: ${rules.tieBreak === 'manuale' ? 'scelta manuale' : 'sorteggio digitale'}`);
    }
    const claimIds = (this.db.prepare("SELECT id FROM claims WHERE tie_group_id=? AND status='tie' ORDER BY id").all(tieId) as { id: number }[]).map(
      (r) => r.id,
    );
    const slots = Math.min(t.available, this.remaining(t.game_id, t.category));
    let winners: number[];
    let drawn: number[] | undefined;
    const reason = (input.reason ?? '').trim();
    if (input.method === 'manuale') {
      winners = [...new Set(input.winners ?? [])];
      if (winners.length !== slots) throw new GameError(`Seleziona esattamente ${slots} vincitor${slots === 1 ? 'e' : 'i'}`);
      if (winners.some((w) => !claimIds.includes(w))) throw new GameError('Vincitore non presente nel pari merito');
      if (reason.length < 5) throw new GameError("Scrivi il motivo della scelta (obbligatorio)");
    } else {
      const pool = [...claimIds];
      winners = [];
      for (let i = 0; i < slots; i++) winners.push(pool.splice(this.rand(pool.length), 1)[0]);
      drawn = winners;
      this.db.prepare('INSERT INTO tiebreak_draws(tie_group_id,candidates_json,winners_json,created_at) VALUES(?,?,?,?)').run(
        tieId,
        JSON.stringify(claimIds),
        JSON.stringify(winners),
        this.now(),
      );
    }
    const awards = winners.map((cid) => {
      this.db.prepare("UPDATE claims SET status='valid' WHERE id=?").run(cid);
      return this.award(t.game_id, cid, rules, input.prizeChoices?.[String(cid)]);
    });
    const losers = claimIds.filter((id) => !winners.includes(id));
    const lost = this.db.prepare("UPDATE claims SET status='tie_lost', reason=? WHERE id=?");
    losers.forEach((id) => lost.run('Spareggio perso: la riga resta libera', id));
    this.db
      .prepare("UPDATE tie_groups SET status='resolved', method=?, reason=?, resolved_at=? WHERE id=?")
      .run(input.method, reason || 'Sorteggio digitale di spareggio', this.now(), tieId);
    return { awards, losers, drawn };
  }

  /** Premio di riserva a chi ha perso uno spareggio. */
  assignReserve(claimId: number, prizeId: number): number {
    const c = this.db.prepare('SELECT * FROM claims WHERE id=?').get(claimId) as { game_id: number; status: string } | undefined;
    if (!c) throw new GameError('Dichiarazione inesistente');
    if (c.status !== 'tie_lost') throw new GameError('Il premio di riserva si assegna solo a chi ha perso lo spareggio');
    const g = this.game(c.game_id);
    if (g.status !== 'active') throw new GameError('La partita non è in corso');
    this.db.prepare("UPDATE claims SET status='valid' WHERE id=?").run(claimId);
    return this.award(c.game_id, claimId, this.rules(g), prizeId, true);
  }

  private requireAward(awardId: number) {
    const a = this.db.prepare('SELECT * FROM awards WHERE id=?').get(awardId) as
      | { id: number; game_id: number; status: string; category: Category; prize_id: number; card_id: number; row: number | null; draw_idx: number }
      | undefined;
    if (!a) throw new GameError('Vincita inesistente');
    if (a.status === 'annulled') throw new GameError('Vincita annullata');
    return a;
  }

  announce(awardId: number): void {
    const a = this.requireAward(awardId);
    this.setStage(a.game_id, { type: 'winner', awardId, zoom: false }, 'winner');
  }

  /** Rivela il regalo già assegnato: non sorteggia nulla. Ripetere la rivelazione non cambia il premio. */
  reveal(awardId: number, instant = false): void {
    const a = this.requireAward(awardId);
    if (a.status === 'assigned') {
      this.db.prepare("UPDATE awards SET status='revealed', revealed_at=? WHERE id=?").run(this.now(), awardId);
    }
    this.setStage(a.game_id, { type: 'gift', awardId, zoom: false, message: instant ? 'instant' : '' }, instant ? 'none' : 'gift');
  }

  repeat(gameId: number): void {
    const g = this.game(gameId);
    const s = this.stage(g);
    if (s.type === 'winner') this.setStage(gameId, {}, 'winner');
    else if (s.type === 'gift') this.setStage(gameId, { message: '' }, 'gift');
    else if (s.type === 'active' && this.draws(gameId).length) this.setStage(gameId, {}, 'draw');
    else throw new GameError('Niente da ripetere in questo momento');
  }

  setZoom(gameId: number, zoom: boolean): void {
    const s = this.stage(this.game(gameId));
    if (s.type !== 'gift') throw new GameError('Il premio non è in mostra');
    this.setStage(gameId, { zoom });
  }

  resume(gameId: number): void {
    const g = this.game(gameId);
    if (g.status !== 'active') throw new GameError('La partita non è in corso');
    const check = this.openCheck(gameId);
    if (check) {
      const open = this.db.prepare("SELECT 1 FROM tie_groups WHERE check_id=? AND status='open'").get(check.id);
      if (open) throw new GameError('Prima risolvi il pari merito');
      // Le dichiarazioni non confermate non bloccano nulla.
      this.db.prepare("UPDATE claims SET status='dismissed' WHERE check_id=? AND status='valid'").run(check.id);
      this.db.prepare("UPDATE checks SET status='closed', closed_at=? WHERE id=?").run(this.now(), check.id);
    }
    this.setStage(gameId, { type: 'active', awardId: null, zoom: false, message: '' }, 'none');
  }

  pause(gameId: number, message = ''): void {
    const g = this.game(gameId);
    if (g.status === 'closed') throw new GameError('La partita è chiusa');
    this.setStage(gameId, { type: 'pause', awardId: null, zoom: false, message: message.slice(0, 120) }, 'none');
  }

  showFinal(gameId: number): void {
    const g = this.game(gameId);
    if (g.status === 'setup') throw new GameError('La partita non è iniziata');
    if (this.openCheck(gameId) && g.status === 'active') throw new GameError('Chiudi prima la verifica con Riprendi');
    this.setStage(gameId, { type: 'final', awardId: null, zoom: false }, 'none');
  }

  closeGame(gameId: number, note = ''): { unassigned: CategoryCount[] } {
    const g = this.game(gameId);
    if (g.status !== 'active') throw new GameError('La partita non è in corso');
    if (this.db.prepare("SELECT 1 FROM tie_groups WHERE game_id=? AND status='open'").get(gameId)) {
      throw new GameError('Prima risolvi il pari merito');
    }
    const check = this.openCheck(gameId);
    if (check) {
      this.db.prepare("UPDATE claims SET status='dismissed' WHERE check_id=? AND status='valid'").run(check.id);
      this.db.prepare("UPDATE checks SET status='closed', closed_at=? WHERE id=?").run(this.now(), check.id);
    }
    this.db.prepare("UPDATE games SET status='closed', closed_at=?, close_note=? WHERE id=?").run(this.now(), note.slice(0, 300), gameId);
    this.setStage(gameId, { type: 'final', awardId: null, zoom: false }, 'none');
    return { unassigned: this.categoryCounts(gameId).filter((c) => c.remaining > 0) };
  }

  /** Annulla una vincita: libera la riga e il premio, conservando la traccia. */
  annulAward(awardId: number, reason: string): { impact: string[] } {
    const a = this.requireAward(awardId);
    const g = this.game(a.game_id);
    if (g.status !== 'active') throw new GameError('Si possono annullare solo vincite di una partita in corso');
    if (reason.trim().length < 5) throw new GameError('Scrivi il motivo dell\'annullamento');
    const impact = this.annulImpact(awardId);
    this.db.prepare("UPDATE awards SET status='annulled', annulled_at=?, annul_reason=? WHERE id=?").run(this.now(), reason.trim(), awardId);
    this.db.prepare("UPDATE claims SET status='dismissed', reason=? WHERE id=(SELECT claim_id FROM awards WHERE id=?)").run(
      `Vincita annullata: ${reason.trim()}`,
      awardId,
    );
    const s = this.stage(g);
    if (s.awardId === awardId) {
      this.setStage(a.game_id, { type: this.openCheck(a.game_id) ? 'check' : 'active', awardId: null, zoom: false }, 'none');
    }
    return { impact };
  }

  annulImpact(awardId: number): string[] {
    const a = this.requireAward(awardId);
    const code = (this.db.prepare('SELECT code FROM cards WHERE id=?').get(a.card_id) as { code: string }).code;
    const prize = this.db.prepare('SELECT title FROM prizes WHERE id=?').get(a.prize_id) as { title: string };
    const out = [`Torna disponibile 1 × "${prize.title}" (${CATEGORY_LABEL[a.category].toLowerCase()})`];
    if (a.row != null) out.push(`La riga ${a.row} di ${code} torna libera per le prossime vincite`);
    else out.push(`${code} potrà di nuovo vincere la tombola`);
    if (a.status === 'revealed') out.push('Il premio era già stato rivelato al pubblico: ricordati di ritirarlo');
    const later = this.db
      .prepare("SELECT COUNT(*) AS c FROM awards WHERE game_id=? AND id>? AND status!='annulled'")
      .get(a.game_id, awardId) as { c: number };
    if (later.c) out.push(`${later.c} vincite successive restano valide e invariate (le dichiarazioni passate non vengono riaperte)`);
    return out;
  }

  // --------------------------------------------------------- partite (CMS)
  startGame(gameId: number): void {
    const g = this.game(gameId);
    if (g.status !== 'setup') throw new GameError('La partita è già stata avviata');
    const cur = this.currentGameId();
    if (cur != null && cur !== gameId && this.game(cur).status === 'active') {
      throw new GameError('C\'è un\'altra partita in corso: chiudila prima');
    }
    const cards = this.db.prepare('SELECT COUNT(*) AS c FROM game_cards WHERE game_id=?').get(gameId) as { c: number };
    if (!cards.c) throw new GameError('Attiva prima le cartelle distribuite per questa partita');
    if (!this.categoryCounts(gameId).some((c) => c.total > 0)) throw new GameError('Aggiungi almeno un premio');
    this.db
      .prepare("UPDATE games SET status='active', rules_frozen_json=rules_json, started_at=? WHERE id=?")
      .run(this.now(), gameId);
    setSetting(this.db, 'currentGameId', gameId);
    this.setStage(gameId, { type: 'active', awardId: null, zoom: false, message: '' }, 'none');
  }

  selectGame(gameId: number): void {
    this.game(gameId);
    const cur = this.currentGameId();
    if (cur != null && cur !== gameId && this.game(cur).status === 'active') {
      throw new GameError('La partita in corso va chiusa prima di passare a un\'altra');
    }
    setSetting(this.db, 'currentGameId', gameId);
  }

  setDisplayFlags(patch: Partial<DisplayFlags>): DisplayFlags {
    const f = { ...DEFAULT_FLAGS, ...getSetting<Partial<DisplayFlags>>(this.db, 'displayFlags', {}) };
    for (const k of ['muted', 'reducedMotion', 'voice'] as const) if (typeof patch[k] === 'boolean') f[k] = patch[k]!;
    setSetting(this.db, 'displayFlags', f);
    return f;
  }

  // ------------------------------------------------------------ stati
  numberInfo(n: number): NumberInfo & { hostJoke: string } {
    const r = this.db.prepare('SELECT * FROM numbers WHERE n=?').get(n) as Record<string, string | null>;
    return {
      number: n,
      traditional: r?.traditional ?? '',
      busaText: r?.busa_text ?? '',
      hostJoke: r?.host_joke ?? '',
      imageUrl: r?.image_path ? `/media/${r.image_path}` : null,
      audioUrl: r?.audio_path ? `/media/${r.audio_path}` : null,
      special: ((r?.special as SpecialEvent) ?? 'none'),
    };
  }

  private publicAward(awardId: number): (PublicAward & { prizeId: number; status: string; prizeTitle: string; prizeVisible: boolean; prizeDescription: string; hasImage: boolean }) | null {
    const r = this.db
      .prepare(
        `SELECT a.*, c.code, p.title, p.description, p.visible, p.image_path FROM awards a
         JOIN cards c ON c.id=a.card_id JOIN prizes p ON p.id=a.prize_id WHERE a.id=?`,
      )
      .get(awardId) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      awardId: Number(r.id),
      category: r.category as Category,
      cardCode: String(r.code),
      row: r.row == null ? null : Number(r.row),
      winnerName: (r.winner_name as string) ?? null,
      prizeId: Number(r.prize_id),
      status: String(r.status),
      prizeTitle: String(r.title),
      prizeDescription: String(r.description ?? ''),
      prizeVisible: !!r.visible,
      hasImage: !!r.image_path,
    };
  }

  branding(): Branding {
    const b = getSetting<Partial<Branding>>(this.db, 'branding', {});
    return { ...DEFAULT_BRANDING, ...b, colors: { ...DEFAULT_BRANDING.colors, ...(b.colors ?? {}) } };
  }
  displayFlags(): DisplayFlags {
    return { ...DEFAULT_FLAGS, ...getSetting<Partial<DisplayFlags>>(this.db, 'displayFlags', {}) };
  }

  /** Stato pubblico: niente segreti, niente premi non ancora rivelati. */
  publicState(): PublicState {
    const b = this.branding();
    const id = this.currentGameId();
    const empty: PublicState['stage'] = {
      type: 'waiting', effectId: 0, effectKind: 'none', effectAt: 0, lastNumber: null, award: null, prize: null, zoom: false, winners: [], message: '',
    };
    const base: PublicState = {
      version: currentVersion(this.db),
      serverTime: this.now(),
      branding: { title: b.title, colors: b.colors, christmas: b.christmas, logoUrl: b.logoPath ? `/media/${b.logoPath}` : null },
      event: null,
      game: null,
      stage: empty,
      display: this.displayFlags(),
    };
    if (id == null) return base;
    const g = this.game(id);
    const ev = this.db.prepare('SELECT name FROM events WHERE id=?').get(g.event_id) as { name: string } | undefined;
    const draws = this.draws(id);
    const s = this.stage(g);
    const last = draws.length ? draws[draws.length - 1] : null;
    let award: PublicAward | null = null;
    let prize: PublicState['stage']['prize'] = null;
    if ((s.type === 'winner' || s.type === 'gift') && s.awardId) {
      const a = this.publicAward(s.awardId);
      if (a && a.status !== 'annulled') {
        award = { awardId: a.awardId, category: a.category, cardCode: a.cardCode, row: a.row, winnerName: a.winnerName };
        if (s.type === 'gift' && a.status === 'revealed') {
          prize = a.prizeVisible
            ? { title: a.prizeTitle, description: a.prizeDescription, imageUrl: a.hasImage ? `/api/public/award/${a.awardId}/image` : null }
            : { title: 'Premio a sorpresa', description: 'Lo consegna il conduttore', imageUrl: null };
        }
      }
    }
    let winners: PublicState['stage']['winners'] = [];
    if (s.type === 'final') {
      winners = (this.db.prepare("SELECT id FROM awards WHERE game_id=? AND status!='annulled' ORDER BY id").all(id) as { id: number }[]).map((r) => {
        const a = this.publicAward(r.id)!;
        return {
          awardId: a.awardId, category: a.category, cardCode: a.cardCode, row: a.row, winnerName: a.winnerName,
          prizeTitle: a.status === 'revealed' && a.prizeVisible ? a.prizeTitle : null,
        };
      });
    }
    const info = last ? this.numberInfo(last) : null;
    return {
      ...base,
      event: ev ? { name: ev.name } : null,
      game: {
        id,
        name: g.name,
        status: g.status,
        isTest: !!g.is_test,
        rules: rulesSummary(this.rules(g)),
        categories: this.categoryCounts(id).filter((c) => c.total > 0),
        draws,
      },
      stage: {
        type: s.type,
        effectId: s.effectId,
        effectKind: s.effectKind,
        effectAt: s.effectAt,
        lastNumber: info ? { number: info.number, traditional: info.traditional, busaText: info.busaText, imageUrl: info.imageUrl, audioUrl: info.audioUrl, special: info.special } : null,
        award,
        prize,
        zoom: s.zoom,
        winners,
        message: s.type === 'pause' ? s.message : '',
      },
    };
  }

  claimView(id: number): ClaimView {
    const r = this.db.prepare('SELECT * FROM claims WHERE id=?').get(id) as Record<string, unknown>;
    return {
      id: Number(r.id),
      cardCode: String(r.card_code),
      category: r.category as Category,
      row: r.row == null ? null : Number(r.row),
      status: r.status as ClaimView['status'],
      reason: String(r.reason),
      winnerName: (r.winner_name as string) ?? null,
      drawIdx: Number(r.draw_idx),
    };
  }

  awards(gameId: number): AwardView[] {
    return (this.db
      .prepare(
        `SELECT a.*, c.code, p.title FROM awards a JOIN cards c ON c.id=a.card_id JOIN prizes p ON p.id=a.prize_id
         WHERE a.game_id=? ORDER BY a.id`,
      )
      .all(gameId) as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      category: r.category as Category,
      cardCode: String(r.code),
      row: r.row == null ? null : Number(r.row),
      winnerName: (r.winner_name as string) ?? null,
      prizeId: Number(r.prize_id),
      prizeTitle: String(r.title),
      reserve: !!r.reserve,
      status: r.status as AwardView['status'],
      drawIdx: Number(r.draw_idx),
      createdAt: Number(r.created_at),
      annulReason: (r.annul_reason as string) ?? null,
    }));
  }

  controlState(): ControlState {
    const base: ControlState = {
      version: currentVersion(this.db),
      serverTime: this.now(),
      eventName: null,
      game: null,
      stageType: 'waiting',
      stageAwardId: null,
      zoom: false,
      lastNumber: null,
      canDraw: false,
      drawBlockReason: 'Nessuna partita selezionata',
      drawReadyAt: 0,
      check: null,
      awards: [],
      categories: [],
      reserves: [],
      prizeOptions: [],
      warnings: [],
      otherGames: [],
      display: this.displayFlags(),
    };
    const id = this.currentGameId();
    if (id == null) return base;
    const g = this.game(id);
    const rules = this.rules(g);
    const s = this.stage(g);
    const draws = this.draws(id);
    const ev = this.db.prepare('SELECT name FROM events WHERE id=?').get(g.event_id) as { name: string } | undefined;
    const block = this.drawBlock(g, false);
    const check = this.openCheck(id);
    let checkView: ControlState['check'] = null;
    if (check) {
      const claims = (this.db.prepare("SELECT id FROM claims WHERE check_id=? AND status!='dismissed' ORDER BY id").all(check.id) as { id: number }[]).map(
        (r) => this.claimView(r.id),
      );
      const ties: TieGroupView[] = (this.db.prepare('SELECT * FROM tie_groups WHERE check_id=? ORDER BY id').all(check.id) as Record<string, unknown>[]).map(
        (t) => ({
          id: Number(t.id),
          category: t.category as Category,
          drawIdx: Number(t.draw_idx),
          available: Math.min(Number(t.available), this.remaining(id, t.category as Category)),
          status: t.status as 'open' | 'resolved',
          claimIds: (this.db.prepare('SELECT id FROM claims WHERE tie_group_id=? ORDER BY id').all(Number(t.id)) as { id: number }[]).map((x) => x.id),
        }),
      );
      checkView = { drawIdx: check.draw_idx, claims, ties };
    }
    const categories = this.categoryCounts(id).filter((c) => c.total > 0);
    const awards = this.awards(id);
    const warnings: string[] = [];
    const tombolaAwarded = awards.some((a) => a.category === 'tombola' && a.status !== 'annulled');
    const minorLeft = categories.filter((c) => c.category !== 'tombola' && c.remaining > 0);
    const tombolaPending = checkView?.claims.some((c) => c.category === 'tombola' && (c.status === 'valid' || c.status === 'tie'));
    if ((tombolaAwarded || tombolaPending) && minorLeft.length && g.status === 'active') {
      warnings.push(
        `Tombola ${tombolaAwarded ? 'assegnata' : 'dichiarata'} mentre restano premi minori: ${minorLeft
          .map((c) => `${c.remaining} ${CATEGORY_PLURAL[c.category].toLowerCase()}`)
          .join(', ')}. Nessuna chiusura automatica: decidi tu se continuare o chiudere.`,
      );
    }
    if (checkView?.ties.some((t) => t.status === 'open')) warnings.push('Pari merito da risolvere prima di riprendere.');
    const hidden = awards.filter((a) => a.status === 'assigned');
    if (hidden.length) warnings.push(`${hidden.length} premi assegnati non ancora rivelati.`);
    if (draws.length >= 90) warnings.push('Tutti i 90 numeri sono stati estratti.');
    const reserves = CATEGORIES.flatMap((cat) =>
      this.availablePrizes(id, cat, true).map((p) => ({ prizeId: p.id, title: p.title, category: cat, remaining: p.left })),
    );
    const prizeOptions = CATEGORIES.flatMap((cat) =>
      this.availablePrizes(id, cat, false).map((p) => ({ prizeId: p.id, title: p.title, category: cat, remaining: p.left })),
    );
    const others = (this.db.prepare('SELECT id, name, status FROM games WHERE event_id=? ORDER BY sort_order, id').all(g.event_id) as {
      id: number; name: string; status: GameStatus;
    }[]).filter((x) => x.id !== id);
    return {
      ...base,
      eventName: ev?.name ?? null,
      game: { id, name: g.name, status: g.status, isTest: !!g.is_test, rules, draws },
      stageType: s.type,
      stageAwardId: s.awardId,
      zoom: s.zoom,
      lastNumber: draws.length ? this.numberInfo(draws[draws.length - 1]) : null,
      canDraw: !block,
      drawBlockReason: block,
      drawReadyAt: this.lastDrawAt(id) + rules.minDrawIntervalMs,
      check: checkView,
      awards,
      categories,
      reserves,
      prizeOptions,
      warnings,
      otherGames: others,
    };
  }

  /** Suggerimento al client: fra quanti ms potrà estrarre di nuovo. */
  drawWaitMs(): number {
    const id = this.currentGameId();
    if (id == null) return 0;
    const g = this.game(id);
    return Math.max(0, this.rules(g).minDrawIntervalMs - (this.now() - this.lastDrawAt(id)));
  }
}

export { LINE_CATEGORIES, THRESHOLD };
