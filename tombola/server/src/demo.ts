// Dati dimostrativi: chiaramente marcati come PROVA, isolati dalle serate reali.
import type { Admin } from './admin.js';
import { generateBatch } from './cards.js';
import { getSetting, setSetting } from './db.js';

const DEMO_PRIZES: [string, string, string, number, boolean?][] = [
  ['Esempio – Buono cena per due', 'Premio dimostrativo', 'cinquina', 1],
  ['Esempio – Felpa Busa', 'Premio dimostrativo', 'cinquina', 1],
  ['Esempio – Speaker Bluetooth', 'Premio dimostrativo', 'ambo', 1],
  ['Esempio – Panettone artigianale', 'Premio dimostrativo', 'ambo', 1],
  ['Esempio – Borraccia termica', 'Premio dimostrativo', 'terno', 1],
  ['Esempio – Cesto natalizio', 'Premio dimostrativo', 'quaterna', 1],
  ['Esempio – Weekend per due', 'Premio dimostrativo', 'tombola', 1],
  ['Esempio – Premio di riserva', 'Si usa solo per i pari merito', 'ambo', 1, true],
];

/** Crea serata di prova, lotto demo da 1.000 cartelle, premi di esempio e partita di prova (70 cartelle attive). */
export function createDemo(admin: Admin): { eventId: number; gameId: number; batchPrefix: string } {
  const eventId = admin.createEvent({ name: 'Serata dimostrativa (PROVA)', isTest: true });
  const gameId = admin.createGame({ eventId, name: 'Partita di prova', isTest: true });
  for (const [title, description, category, quantity, reserve] of DEMO_PRIZES) {
    admin.savePrize({ gameId, title, description, category, quantity, reserve });
  }
  const batch = generateBatch(admin.db, { count: 1000, name: 'DEMO – solo per prove, non stampare per la serata', isDemo: true });
  admin.activateCards(gameId, `${batch.prefix}0001-${batch.prefix}0070`);
  const cur = getSetting<number | null>(admin.db, 'currentGameId', null);
  const curGame = cur != null ? (admin.db.prepare('SELECT status FROM games WHERE id=?').get(cur) as { status: string } | undefined) : undefined;
  if (!curGame || curGame.status !== 'active') setSetting(admin.db, 'currentGameId', gameId);
  admin.engine.onChange();
  return { eventId, gameId, batchPrefix: batch.prefix };
}
