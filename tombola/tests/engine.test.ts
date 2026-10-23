import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup } from './helpers.js';
import { openDb } from '../server/src/db.js';
import { Engine } from '../server/src/engine.js';
import { columnRange, generateBatch, listCards, validateMatrix, normalizeCode, setKey } from '../server/src/cards.js';

describe('generatore di cartelle', () => {
  it('1.000 cartelle rispettano tutte le regole italiane, con codici e combinazioni univoci', () => {
    const db = openDb(':memory:');
    const b = generateBatch(db, { count: 1000, name: 'Lotto prova' });
    expect(b.count).toBe(1000);
    const cards = listCards(db, { batchId: b.id, limit: 2000 });
    expect(cards).toHaveLength(1000);
    const codes = new Set<string>();
    const keys = new Set<string>();
    for (const c of cards) {
      expect(validateMatrix(c.matrix)).toEqual([]);
      expect(c.code).toMatch(/^[A-Z]\d{4}$/);
      codes.add(c.code);
      keys.add(setKey(c.matrix));
      for (let col = 0; col < 9; col++) {
        const [lo, hi] = columnRange(col);
        const nums = c.matrix.map((r) => r[col]).filter((n) => n);
        expect(nums.length).toBeGreaterThanOrEqual(1);
        expect(nums.length).toBeLessThanOrEqual(3);
        nums.forEach((n) => expect(n >= lo && n <= hi).toBe(true));
        expect([...nums].sort((a, b) => a - b)).toEqual(nums);
      }
      c.matrix.forEach((row) => {
        expect(row).toHaveLength(9);
        expect(row.filter((n) => n).length).toBe(5);
        expect(row.filter((n) => !n).length).toBe(4);
      });
    }
    expect(codes.size).toBe(1000);
    expect(keys.size).toBe(1000);
    // Un secondo lotto usa un altro prefisso: nessun codice riusato.
    const b2 = generateBatch(db, { count: 10, name: 'Lotto 2' });
    expect(b2.prefix).not.toBe(b.prefix);
  });

  it('normalizza i codici digitati', () => {
    expect(normalizeCode('b42')).toBe('B0042');
    expect(normalizeCode(' B-0042 ')).toBe('B0042');
    expect(normalizeCode('42')).toBeNull();
    expect(normalizeCode('B0')).toBeNull();
  });

  it('la validazione rifiuta righe con numeri sbagliati', () => {
    expect(validateMatrix([[1, 2, 3], [], []]).length).toBeGreaterThan(0);
    const bad = [
      [10, 12, 23, 34, 45, 0, 0, 0, 0],
      [0, 0, 0, 0, 46, 56, 66, 76, 86],
      [5, 15, 25, 35, 0, 0, 0, 0, 90],
    ];
    expect(validateMatrix(bad).join()).toMatch(/colonna 1/);
  });
});

describe('estrazioni', () => {
  it('90 numeri distinti, poi nessuna estrazione', () => {
    const t = setup();
    t.start();
    const seen = new Set<number>();
    for (let i = 0; i < 90; i++) {
      t.advance();
      const r = t.engine.run(t.cmd(), 'estrazione', 'test', () => t.engine.draw(t.gameId, i));
      expect(r.ok).toBe(true);
      const n = (r.result as { number: number }).number;
      expect(n >= 1 && n <= 90).toBe(true);
      seen.add(n);
    }
    expect(seen.size).toBe(90);
    t.advance();
    const r91 = t.engine.run(t.cmd(), 'estrazione', 'test', () => t.engine.draw(t.gameId, 90));
    expect(r91.ok).toBe(false);
    expect(t.engine.draws(t.gameId)).toHaveLength(90);
  });

  it('doppio tocco e retry con lo stesso comando non estraggono due volte', () => {
    const t = setup();
    t.start();
    t.advance();
    const id = t.cmd();
    const a = t.engine.run(id, 'estrazione', 'test', () => t.engine.draw(t.gameId, 0));
    const b = t.engine.run(id, 'estrazione', 'test', () => t.engine.draw(t.gameId, 0));
    expect(a.ok && b.ok).toBe(true);
    expect(b.replayed).toBe(true);
    expect(b.result).toEqual(a.result);
    expect(t.engine.draws(t.gameId)).toHaveLength(1);
  });

  it('due controllori in concorrenza: il secondo comando viene rifiutato', () => {
    const t = setup();
    t.start();
    t.advance();
    const a = t.engine.run(t.cmd(), 'estrazione', 'telefono', () => t.engine.draw(t.gameId, 0));
    t.advance();
    const b = t.engine.run(t.cmd(), 'estrazione', 'portatile', () => t.engine.draw(t.gameId, 0));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(b.error).toMatch(/stato è cambiato/);
    expect(t.engine.draws(t.gameId)).toHaveLength(1);
  });

  it("non si estrae durante l'animazione né durante la verifica", () => {
    const t = setup();
    t.start();
    t.drawNumber(40);
    const r = t.engine.run(t.cmd(), 'estrazione', 'test', () => t.engine.draw(t.gameId, 1));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/animazione/);
    t.call(() => t.engine.openClaimCheck(t.gameId));
    t.advance();
    const r2 = t.engine.run(t.cmd(), 'estrazione', 'test', () => t.engine.draw(t.gameId, 1));
    expect(r2.error).toMatch(/Verifica/);
  });
});

describe('verifica e vincite', () => {
  it('le righe non si sommano e la vincita vale solo con l’ultimo numero', () => {
    const t = setup();
    t.start();
    t.drawNumber(1); // riga 1 di T0001
    t.drawNumber(5); // riga 3 di T0001: 1 + 1 su righe diverse
    t.call(() => t.engine.openClaimCheck(t.gameId));
    const rep = t.engine.evaluate(t.gameId, 'T0001');
    expect(rep.rows.map((r) => r.qualifies)).toEqual([null, null, null]);
    const c = t.call(() => t.engine.addClaim(t.gameId, { code: 'T1', category: 'ambo', row: 1 }));
    expect((c.result as { status: string }).status).toBe('rejected');
    t.call(() => t.engine.resume(t.gameId));
    t.drawNumber(23); // riga 1 di T0001 arriva a 2 → ambo
    t.call(() => t.engine.openClaimCheck(t.gameId));
    expect(t.engine.evaluate(t.gameId, 'T0001').rows[0].qualifies).toBe('ambo');
    t.call(() => t.engine.resume(t.gameId));
    t.drawNumber(80); // nessuno: l'ambo non è più dichiarabile
    t.call(() => t.engine.openClaimCheck(t.gameId));
    const late = t.call(() => t.engine.addClaim(t.gameId, { code: 'T0001', category: 'ambo', row: 1 }));
    expect((late.result as { status: string; reason: string }).status).toBe('rejected');
    expect((late.result as { reason: string }).reason).toMatch(/ultimo numero/);
  });

  it('la cinquina non è un nuovo ambo e la categoria deve corrispondere al conteggio', () => {
    const t = setup();
    t.start();
    for (const n of [1, 12, 23]) t.drawNumber(n);
    t.call(() => t.engine.openClaimCheck(t.gameId));
    const wrong = t.call(() => t.engine.addClaim(t.gameId, { code: 'T0001', category: 'ambo', row: 1 }));
    expect((wrong.result as { status: string }).status).toBe('rejected');
    const ok = t.call(() => t.engine.addClaim(t.gameId, { code: 'T0001', category: 'terno', row: 1 }));
    expect((ok.result as { status: string }).status).toBe('valid');
  });

  it('una vincita per riga: la riga premiata è bloccata per le altre categorie ma non per la tombola', () => {
    const t = setup();
    t.start();
    t.drawNumber(1);
    t.drawNumber(12); // ambo riga 1 per T0001 e T0002 → 2 ambi disponibili
    t.call(() => t.engine.openClaimCheck(t.gameId));
    t.call(() => t.engine.addClaim(t.gameId, { code: 'T0001', category: 'ambo', row: 1 }));
    const conf = t.call(() => t.engine.confirmClaims(t.gameId));
    expect(conf.ok).toBe(true);
    t.call(() => t.engine.resume(t.gameId));
    t.drawNumber(23); // terno sulla riga 1 di T0001: bloccata
    t.call(() => t.engine.openClaimCheck(t.gameId));
    const rep = t.engine.evaluate(t.gameId, 'T0001');
    expect(rep.rows[0].lockedBy).toBe('ambo');
    expect(rep.rows[0].qualifies).toBeNull();
    const r = t.call(() => t.engine.addClaim(t.gameId, { code: 'T0001', category: 'terno', row: 1 }));
    expect((r.result as { reason: string }).reason).toMatch(/già premiata con ambo/);
    t.call(() => t.engine.resume(t.gameId));
    // Le altre righe restano libere.
    t.drawNumber(5);
    t.drawNumber(15);
    t.call(() => t.engine.openClaimCheck(t.gameId));
    expect(t.engine.evaluate(t.gameId, 'T0001').rows[2].qualifies).toBe('ambo');
    t.call(() => t.engine.resume(t.gameId));
    // La tombola resta sempre possibile.
    for (const n of [34, 45, 46, 56, 66, 76, 86, 25, 35, 90]) {
      t.drawNumber(n);
    }
    t.call(() => t.engine.openClaimCheck(t.gameId));
    const rep2 = t.engine.evaluate(t.gameId, 'T0001');
    expect(rep2.tombola.qualifies).toBe(true);
    const tc = t.call(() => t.engine.addClaim(t.gameId, { code: 'T0001', category: 'tombola' }));
    expect((tc.result as { status: string }).status).toBe('valid');
    expect(t.call(() => t.engine.confirmClaims(t.gameId)).ok).toBe(true);
    // Avviso: tombola assegnata con premi minori ancora disponibili, nessuna chiusura automatica.
    const cs = t.engine.controlState();
    expect(cs.warnings.join()).toMatch(/Tombola assegnata/);
    expect(cs.game!.status).toBe('active');
  });

  it('una regola disattivata permette più vincite sulla stessa riga', () => {
    const t = setup({ rules: { oneWinPerRow: false } });
    t.start();
    t.drawNumber(1);
    t.drawNumber(12);
    t.call(() => t.engine.openClaimCheck(t.gameId));
    t.call(() => t.engine.addClaim(t.gameId, { code: 'T0001', category: 'ambo', row: 1 }));
    t.call(() => t.engine.confirmClaims(t.gameId));
    t.call(() => t.engine.resume(t.gameId));
    t.drawNumber(23);
    t.call(() => t.engine.openClaimCheck(t.gameId));
    expect(t.engine.evaluate(t.gameId, 'T0001').rows[0].qualifies).toBe('terno');
  });

  it('una verifica senza conferma non blocca nulla; l’annullamento ripristina riga e premio', () => {
    const t = setup();
    t.start();
    t.drawNumber(1);
    t.drawNumber(12);
    t.call(() => t.engine.openClaimCheck(t.gameId));
    t.call(() => t.engine.addClaim(t.gameId, { code: 'T0001', category: 'ambo', row: 1 }));
    t.call(() => t.engine.resume(t.gameId)); // nessuna conferma
    expect(t.engine.categoryCounts(t.gameId).find((c) => c.category === 'ambo')!.remaining).toBe(2);
    t.drawNumber(23);
    t.call(() => t.engine.openClaimCheck(t.gameId));
    expect(t.engine.evaluate(t.gameId, 'T0001').rows[0].qualifies).toBe('terno');
    t.call(() => t.engine.addClaim(t.gameId, { code: 'T0001', category: 'terno', row: 1 }));
    const conf = t.call(() => t.engine.confirmClaims(t.gameId));
    const awardId = (conf.result as { awards: number[] }).awards[0];
    expect(t.engine.categoryCounts(t.gameId).find((c) => c.category === 'terno')!.remaining).toBe(0);
    const impact = t.engine.annulImpact(awardId);
    expect(impact.join()).toMatch(/riga 1 di T0001 torna libera/);
    const an = t.call(() => t.engine.annulAward(awardId, 'Cartella letta male'));
    expect(an.ok).toBe(true);
    expect(t.engine.categoryCounts(t.gameId).find((c) => c.category === 'terno')!.remaining).toBe(1);
    expect(t.engine.evaluate(t.gameId, 'T0001').rows[0].lockedBy).toBeNull();
    // La storia resta: la vincita annullata è ancora nel registro.
    expect(t.engine.awards(t.gameId).find((a) => a.id === awardId)!.status).toBe('annulled');
  });

  it('cartelle non attive escluse', () => {
    const t = setup();
    t.start();
    t.drawNumber(2);
    t.drawNumber(13); // ambo sulla riga 1 di T0003, non attiva
    t.call(() => t.engine.openClaimCheck(t.gameId));
    const rep = t.engine.evaluate(t.gameId, 'T0003');
    expect(rep.active).toBe(false);
    const r = t.call(() => t.engine.addClaim(t.gameId, { code: 'T0003', category: 'ambo', row: 1 }));
    expect((r.result as { reason: string }).reason).toMatch(/non attiva/);
  });

  it('pari merito: nessuna priorità al primo inserito, premi insufficienti gestiti esplicitamente', () => {
    const t = setup({
      prizes: [
        ['Ambo unico', 'ambo', 1],
        ['Riserva ambo', 'ambo', 1, true],
        ['Tombola', 'tombola', 1],
      ],
    });
    t.start();
    t.drawNumber(1);
    t.drawNumber(12); // ambo riga 1 per T0001 e T0002
    t.call(() => t.engine.openClaimCheck(t.gameId));
    const c1 = t.call(() => t.engine.addClaim(t.gameId, { code: 'T0001', category: 'ambo', row: 1 })).result as { id: number };
    const c2 = t.call(() => t.engine.addClaim(t.gameId, { code: 'T0002', category: 'ambo', row: 1 })).result as { id: number };
    const conf = t.call(() => t.engine.confirmClaims(t.gameId)).result as { awards: number[]; ties: number[] };
    expect(conf.awards).toHaveLength(0); // nessuno vince "per primo"
    expect(conf.ties).toHaveLength(1);
    expect(t.engine.categoryCounts(t.gameId).find((c) => c.category === 'ambo')!.remaining).toBe(1); // premio non consumato
    // Non si riprende finché il pari merito è aperto.
    expect(t.call(() => t.engine.resume(t.gameId)).ok).toBe(false);
    // Scelta manuale: motivo obbligatorio.
    const noReason = t.call(() => t.engine.resolveTie(conf.ties[0], { method: 'manuale', winners: [c2.id] }));
    expect(noReason.error).toMatch(/motivo/);
    const wrongMethod = t.call(() => t.engine.resolveTie(conf.ties[0], { method: 'sorteggio' }));
    expect(wrongMethod.error).toMatch(/procedura annunciata/);
    const res = t.call(() => t.engine.resolveTie(conf.ties[0], { method: 'manuale', winners: [c2.id], reason: 'Spareggio a carta più alta' }));
    expect(res.ok).toBe(true);
    // Lo sconfitto non ha la riga bloccata e può ricevere un premio di riserva.
    expect(t.engine.evaluate(t.gameId, 'T0001').rows[0].lockedBy).toBeNull();
    const reserve = t.engine.controlState().reserves[0];
    const rr = t.call(() => t.engine.assignReserve(c1.id, reserve.prizeId));
    expect(rr.ok).toBe(true);
    expect(t.engine.awards(t.gameId).filter((a) => a.status !== 'annulled')).toHaveLength(2);
    expect(t.call(() => t.engine.resume(t.gameId)).ok).toBe(true);
  });

  it('pari merito con sorteggio digitale separato dalle estrazioni', () => {
    const t = setup({ rules: { tieBreak: 'sorteggio' }, prizes: [['Ambo', 'ambo', 1], ['Tombola', 'tombola', 1]] });
    t.start();
    t.drawNumber(1);
    t.drawNumber(12);
    t.call(() => t.engine.openClaimCheck(t.gameId));
    t.call(() => t.engine.addClaim(t.gameId, { code: 'T0001', category: 'ambo', row: 1 }));
    t.call(() => t.engine.addClaim(t.gameId, { code: 'T0002', category: 'ambo', row: 1 }));
    const conf = t.call(() => t.engine.confirmClaims(t.gameId)).result as { ties: number[] };
    const before = t.engine.draws(t.gameId).length;
    const r = t.call(() => t.engine.resolveTie(conf.ties[0], { method: 'sorteggio' }));
    expect(r.ok).toBe(true);
    expect(t.engine.draws(t.gameId)).toHaveLength(before);
    const log = t.db.prepare('SELECT * FROM tiebreak_draws').all();
    expect(log).toHaveLength(1);
  });

  it('tombole su cartelle diverse; la stessa cartella non vince due tombole', () => {
    const t = setup();
    t.start();
    const all1 = [1, 12, 23, 34, 45, 46, 56, 66, 76, 86, 5, 15, 25, 35];
    for (const n of all1) t.drawNumber(n);
    t.drawNumber(90);
    t.call(() => t.engine.openClaimCheck(t.gameId));
    t.call(() => t.engine.addClaim(t.gameId, { code: 'T0001', category: 'tombola' }));
    t.call(() => t.engine.confirmClaims(t.gameId));
    t.call(() => t.engine.resume(t.gameId));
    t.call(() => t.engine.openClaimCheck(t.gameId));
    const again = t.engine.evaluate(t.gameId, 'T0001', t.engine.draws(t.gameId).length);
    expect(again.tombola.qualifies).toBe(false);
    t.call(() => t.engine.resume(t.gameId));
    const rest2 = [24, 36, 47, 48, 57, 67, 77, 87, 6, 16, 26, 37, 88];
    for (const n of rest2) t.drawNumber(n);
    t.call(() => t.engine.openClaimCheck(t.gameId));
    const c = t.call(() => t.engine.addClaim(t.gameId, { code: 'T0002', category: 'tombola' }));
    expect((c.result as { status: string }).status).toBe('valid');
    expect(t.call(() => t.engine.confirmClaims(t.gameId)).ok).toBe(true);
    expect(t.engine.awards(t.gameId).filter((a) => a.category === 'tombola')).toHaveLength(2);
  });
});

describe('premi, display e persistenza', () => {
  it('il display non riceve il premio prima della rivelazione; ripetere non riassegna', () => {
    const t = setup();
    t.start();
    t.drawNumber(1);
    t.drawNumber(12);
    t.call(() => t.engine.openClaimCheck(t.gameId));
    t.call(() => t.engine.addClaim(t.gameId, { code: 'T0001', category: 'ambo', row: 1, winnerName: 'Marco' }));
    const awardId = (t.call(() => t.engine.confirmClaims(t.gameId)).result as { awards: number[] }).awards[0];
    t.call(() => t.engine.announce(awardId));
    const pub = t.engine.publicState();
    expect(pub.stage.type).toBe('winner');
    expect(pub.stage.prize).toBeNull();
    expect(JSON.stringify(pub)).not.toContain('Ambo A');
    t.call(() => t.engine.reveal(awardId));
    const pub2 = t.engine.publicState();
    expect(pub2.stage.prize?.title).toBe('Ambo A');
    const prizeBefore = t.engine.awards(t.gameId)[0].prizeId;
    t.call(() => t.engine.reveal(awardId));
    t.call(() => t.engine.repeat(t.gameId));
    expect(t.engine.awards(t.gameId)).toHaveLength(1);
    expect(t.engine.awards(t.gameId)[0].prizeId).toBe(prizeBefore);
    expect(t.engine.publicState().stage.effectId).toBeGreaterThan(pub2.stage.effectId);
  });

  it('assegnazione per sorteggio: ogni conferma riserva un premio disponibile della categoria', () => {
    const t = setup({ rules: { prizeAssign: 'sorteggio' }, prizes: [['A', 'ambo', 1], ['B', 'ambo', 1], ['T', 'tombola', 1]] });
    t.start();
    t.drawNumber(1);
    t.drawNumber(12);
    t.call(() => t.engine.openClaimCheck(t.gameId));
    t.call(() => t.engine.addClaim(t.gameId, { code: 'T0001', category: 'ambo', row: 1 }));
    t.call(() => t.engine.addClaim(t.gameId, { code: 'T0002', category: 'ambo', row: 1 }));
    t.call(() => t.engine.confirmClaims(t.gameId));
    const titles = t.engine.awards(t.gameId).map((a) => a.prizeTitle).sort();
    expect(titles).toEqual(['A', 'B']);
  });

  it('il riavvio del server conserva estrazioni, premi e stato senza ripetere le rivelazioni', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tombola-'));
    const file = path.join(dir, 'db.sqlite');
    const t = setup({ file });
    t.start();
    t.drawNumber(1);
    t.drawNumber(12);
    t.call(() => t.engine.openClaimCheck(t.gameId));
    t.call(() => t.engine.addClaim(t.gameId, { code: 'T0001', category: 'ambo', row: 1 }));
    const awardId = (t.call(() => t.engine.confirmClaims(t.gameId)).result as { awards: number[] }).awards[0];
    t.call(() => t.engine.reveal(awardId));
    const before = t.engine.publicState();
    t.db.close();
    const db2 = openDb(file);
    const e2 = new Engine(db2);
    const after = e2.publicState();
    expect(after.game?.draws).toEqual([1, 12]);
    expect(after.stage.effectId).toBe(before.stage.effectId); // stesso effetto: il display non lo rianima
    expect(after.stage.prize?.title).toBe(before.stage.prize?.title);
    expect(e2.awards(t.gameId)).toHaveLength(1);
    db2.close();
  });

  it('le regole sono congelate all’avvio', () => {
    const t = setup();
    t.start();
    expect(() => t.admin.updateGame(t.gameId, { rules: { oneWinPerRow: false } })).toThrow(/congelate/);
  });

  it('prova: la partita di test si azzera, quella reale no', () => {
    const t = setup();
    t.start();
    expect(() => t.admin.resetTestGame(t.gameId)).toThrow(/Solo le partite di prova/);
  });
});
