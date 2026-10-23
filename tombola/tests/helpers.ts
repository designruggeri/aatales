// Fixture di test: separate dai dati reali, con estrazioni pilotate solo nel test.
import { openDb } from '../server/src/db.js';
import { Engine } from '../server/src/engine.js';
import { Admin } from '../server/src/admin.js';
import { importCards, secureRand } from '../server/src/cards.js';
import type { CardMatrix, GameRules } from '../shared/types.js';

const z = 0;
export const CARD_T1: CardMatrix = [
  [1, 12, 23, 34, 45, z, z, z, z],
  [z, z, z, z, 46, 56, 66, 76, 86],
  [5, 15, 25, 35, z, z, z, z, 90],
];
export const CARD_T2: CardMatrix = [
  [1, 12, 24, 36, 47, z, z, z, z],
  [z, z, z, z, 48, 57, 67, 77, 87],
  [6, 16, 26, 37, z, z, z, z, 88],
];
export const CARD_T3: CardMatrix = [
  [2, 13, 27, 38, 49, z, z, z, z],
  [z, z, z, 39, z, 58, 68, 78, 89],
  [3, 14, 28, z, z, 59, z, z, 90],
];

export function setup(opts: { rules?: Partial<GameRules>; prizes?: [string, string, number, boolean?][]; file?: string } = {}) {
  const db = openDb(opts.file ?? ':memory:');
  let clock = 1_700_000_000_000;
  const engine = new Engine(db, { now: () => clock });
  const admin = new Admin(engine);
  const res = importCards(db, {
    json: { batches: [{ name: 'Test', cards: [{ code: 'T0001', matrix: CARD_T1 }, { code: 'T0002', matrix: CARD_T2 }, { code: 'T0003', matrix: CARD_T3 }] }] },
  });
  if (res.errors.length) throw new Error(res.errors.join(', '));
  const eventId = admin.createEvent({ name: 'Serata test' });
  const gameId = admin.createGame({ eventId, name: 'Partita test', rules: opts.rules });
  const prizes = opts.prizes ?? [
    ['Ambo A', 'ambo', 2],
    ['Terno A', 'terno', 1],
    ['Quaterna A', 'quaterna', 1],
    ['Cinquina A', 'cinquina', 2],
    ['Tombola A', 'tombola', 2],
  ];
  for (const [title, category, quantity, reserve] of prizes) admin.savePrize({ gameId, title, category, quantity, reserve });
  admin.activateCards(gameId, 'T0001, T0002');
  let seq = 0;
  const cmd = () => `test-cmd-${++seq}-${Math.random().toString(36).slice(2)}`;
  const advance = (ms = 5000) => (clock += ms);
  /** Estrae un numero preciso pilotando il generatore (solo nei test). */
  const drawNumber = (n: number) => {
    const drawn = new Set(engine.draws(gameId));
    if (drawn.has(n)) throw new Error(`${n} già estratto`);
    const remaining = [...Array(90).keys()].map((i) => i + 1).filter((x) => !drawn.has(x));
    engine.rand = () => remaining.indexOf(n);
    advance();
    const r = engine.run(cmd(), 'estrazione', 'test', () => engine.draw(gameId, drawn.size));
    engine.rand = secureRand;
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  const start = () => {
    const r = engine.run(cmd(), 'avvio', 'test', () => engine.startGame(gameId));
    if (!r.ok) throw new Error(r.error);
  };
  const call = <T>(fn: () => T) => engine.run(cmd(), 'test', 'test', fn);
  return { db, engine, admin, gameId, eventId, cmd, advance, drawNumber, start, call };
}
