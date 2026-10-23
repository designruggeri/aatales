// Tipi e costanti condivisi fra server e client.

export type Category = 'ambo' | 'terno' | 'quaterna' | 'cinquina' | 'tombola';
export const CATEGORIES: Category[] = ['ambo', 'terno', 'quaterna', 'cinquina', 'tombola'];
export const LINE_CATEGORIES: Category[] = ['ambo', 'terno', 'quaterna', 'cinquina'];
/** Numeri della riga (o della cartella, per la tombola) da raggiungere. */
export const THRESHOLD: Record<Category, number> = { ambo: 2, terno: 3, quaterna: 4, cinquina: 5, tombola: 15 };
export const CATEGORY_LABEL: Record<Category, string> = {
  ambo: 'Ambo', terno: 'Terno', quaterna: 'Quaterna', cinquina: 'Cinquina', tombola: 'Tombola',
};
export const CATEGORY_PLURAL: Record<Category, string> = {
  ambo: 'Ambi', terno: 'Terni', quaterna: 'Quaterne', cinquina: 'Cinquine', tombola: 'Tombole',
};
export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as string[]).includes(v);
}

/** Matrice 3 righe × 9 colonne; 0 = casella vuota. */
export type CardMatrix = number[][];

export interface GameRules {
  /** Una sola vincita (ambo/terno/quaterna/cinquina) per riga in tutta la partita. */
  oneWinPerRow: boolean;
  /** Le categorie abilitate restano aperte insieme finché hanno premi. */
  openingMode: 'simultanea';
  /** La combinazione deve completarsi con l'ultimo numero estratto. */
  claimMode: 'ultimo_numero';
  /** Procedura di spareggio annunciata prima dell'inizio. */
  tieBreak: 'manuale' | 'sorteggio';
  /** Come si sceglie il regalo fisico al momento della conferma. */
  prizeAssign: 'prestabilita' | 'sorteggio' | 'manuale';
  /** Intervallo minimo fra due estrazioni (copre l'animazione). */
  minDrawIntervalMs: number;
}

export const DEFAULT_RULES: GameRules = {
  oneWinPerRow: true,
  openingMode: 'simultanea',
  claimMode: 'ultimo_numero',
  tieBreak: 'manuale',
  prizeAssign: 'prestabilita',
  minDrawIntervalMs: 2200,
};

export function rulesSummary(r: GameRules): string[] {
  const out: string[] = [];
  out.push('Si vince solo con i numeri della stessa riga: righe e cartelle diverse non si sommano.');
  if (r.oneWinPerRow) {
    out.push('Una sola vincita per riga: una riga premiata non vince più ambo, terno, quaterna o cinquina.');
  }
  out.push('La tombola è sempre valida, anche per le cartelle con righe già premiate.');
  out.push('Tutte le categorie con premi sono aperte insieme, finché ci sono premi.');
  out.push("Si dichiara la vincita subito, con l'ultimo numero estratto: dopo la prossima estrazione non vale più.");
  out.push(
    r.tieBreak === 'sorteggio'
      ? 'Pari merito con premi insufficienti: spareggio con sorteggio digitale separato dalle estrazioni.'
      : 'Pari merito con premi insufficienti: decide il conduttore con la procedura annunciata a inizio serata.',
  );
  return out;
}

export type GameStatus = 'setup' | 'active' | 'closed';
export type StageType = 'waiting' | 'active' | 'check' | 'winner' | 'gift' | 'pause' | 'final';
export type EffectKind = 'draw' | 'winner' | 'gift' | 'none';
export type SpecialEvent = 'none' | 'clacson' | 'camioncino';

export interface PublicAward {
  awardId: number;
  category: Category;
  cardCode: string;
  row: number | null;
  winnerName: string | null;
}
export interface PublicPrize {
  title: string;
  description: string;
  imageUrl: string | null;
}
export interface NumberInfo {
  number: number;
  traditional: string;
  busaText: string;
  imageUrl: string | null;
  audioUrl: string | null;
  special: SpecialEvent;
}
export interface CategoryCount {
  category: Category;
  total: number;
  remaining: number;
}

export interface PublicState {
  version: number;
  serverTime: number;
  branding: {
    title: string;
    colors: { primary: string; dark: string; light: string; accent: string };
    christmas: boolean;
    logoUrl: string | null;
  };
  event: { name: string } | null;
  game: null | {
    id: number;
    name: string;
    status: GameStatus;
    isTest: boolean;
    rules: string[];
    categories: CategoryCount[];
    draws: number[];
  };
  stage: {
    type: StageType;
    effectId: number;
    effectKind: EffectKind;
    effectAt: number;
    lastNumber: NumberInfo | null;
    award: PublicAward | null;
    /** Presente solo dopo la rivelazione. */
    prize: PublicPrize | null;
    zoom: boolean;
    winners: (PublicAward & { prizeTitle: string | null })[];
    message: string;
  };
  display: { muted: boolean; reducedMotion: boolean; voice: boolean };
}

export type ClaimStatus = 'valid' | 'rejected' | 'tie' | 'awarded' | 'tie_lost' | 'dismissed';
export interface ClaimView {
  id: number;
  cardCode: string;
  category: Category;
  row: number | null;
  status: ClaimStatus;
  reason: string;
  winnerName: string | null;
  drawIdx: number;
}
export interface TieGroupView {
  id: number;
  category: Category;
  drawIdx: number;
  claimIds: number[];
  available: number;
  status: 'open' | 'resolved';
}
export type AwardStatus = 'assigned' | 'revealed' | 'annulled';
export interface AwardView {
  id: number;
  category: Category;
  cardCode: string;
  row: number | null;
  winnerName: string | null;
  prizeId: number;
  prizeTitle: string;
  reserve: boolean;
  status: AwardStatus;
  drawIdx: number;
  createdAt: number;
  annulReason: string | null;
}
export interface PrizeView {
  id: number;
  gameId: number;
  title: string;
  description: string;
  category: Category;
  quantity: number;
  assigned: number;
  revealed: number;
  sortOrder: number;
  visible: boolean;
  reserve: boolean;
  hasImage: boolean;
}

export interface ControlState {
  version: number;
  serverTime: number;
  eventName: string | null;
  game: null | {
    id: number;
    name: string;
    status: GameStatus;
    isTest: boolean;
    rules: GameRules;
    draws: number[];
  };
  stageType: StageType;
  stageAwardId: number | null;
  zoom: boolean;
  lastNumber: (NumberInfo & { hostJoke: string }) | null;
  canDraw: boolean;
  drawBlockReason: string;
  /** Ora del server da cui si può estrarre di nuovo (fine animazione). */
  drawReadyAt: number;
  check: null | { drawIdx: number; claims: ClaimView[]; ties: TieGroupView[] };
  awards: AwardView[];
  categories: CategoryCount[];
  reserves: { prizeId: number; title: string; category: Category; remaining: number }[];
  /** Premi in palio ancora disponibili (per l'assegnazione manuale). */
  prizeOptions: { prizeId: number; title: string; category: Category; remaining: number }[];
  warnings: string[];
  otherGames: { id: number; name: string; status: GameStatus }[];
  display: { muted: boolean; reducedMotion: boolean; voice: boolean };
}

export interface RowReport {
  row: number;
  numbers: number[];
  drawn: number[];
  count: number;
  containsLast: boolean;
  lockedBy: Category | null;
  qualifies: Category | null;
  reason: string;
}
export interface VerifyReport {
  code: string;
  found: boolean;
  active: boolean;
  matrix: CardMatrix | null;
  drawIdx: number;
  lastNumber: number | null;
  rows: RowReport[];
  tombola: { count: number; qualifies: boolean; reason: string };
  message: string;
}
