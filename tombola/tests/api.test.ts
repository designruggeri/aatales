import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { createTombolaServer } from '../server/src/app.js';
import { secureRand } from '../server/src/cards.js';
import { CARD_T1, CARD_T2, CARD_T3 } from './helpers.js';
import type { ControlState, PublicState } from '../shared/types.js';

const PASSWORD = 'password-di-test-123';
let srv: ReturnType<typeof createTombolaServer>;
let base = '';
let cookie = '';
let token = '';
let gameId = 0;
let dataDir = '';
let n = 0;
const cid = () => `api-test-${Date.now()}-${++n}`;

async function adminFetch(p: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { cookie, ...(init.headers as Record<string, string>) };
  if (init.body && typeof init.body === 'string' && !headers['content-type']) headers['content-type'] = 'application/json';
  return fetch(base + p, { ...init, headers });
}
async function control(type: string, payload: unknown = {}, commandId = cid(), auth = `Bearer ${token}`) {
  const r = await fetch(base + '/api/control/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify({ commandId, type, payload }),
  });
  return { status: r.status, body: (await r.json()) as { ok: boolean; error?: string; result?: any; replayed?: boolean } };
}
function forceNext(num: number) {
  const drawn = new Set(srv.ctx.engine.draws(gameId));
  const remaining = [...Array(90).keys()].map((i) => i + 1).filter((x) => !drawn.has(x));
  srv.ctx.engine.rand = (max) => {
    srv.ctx.engine.rand = secureRand;
    return remaining.indexOf(num) % max;
  };
}
async function drawForced(num: number) {
  forceNext(num);
  const st = srv.ctx.engine.controlState();
  await new Promise((r) => setTimeout(r, Math.max(0, st.drawReadyAt - Date.now()) + 20));
  const r = await control('draw', { expectedCount: st.game!.draws.length });
  expect(r.body.ok, r.body.error).toBe(true);
}
function openWs(onMsg: (m: any) => void, authToken?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
    ws.on('message', (d) => onMsg(JSON.parse(String(d))));
    ws.on('open', () => {
      if (authToken) ws.send(JSON.stringify({ type: 'auth', token: authToken }));
      resolve(ws);
    });
    ws.on('error', reject);
  });
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tombola-api-'));
  srv = createTombolaServer({ dataDir, adminPassword: PASSWORD, log: () => {} });
  await new Promise<void>((r) => srv.server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(srv.server.address() as { port: number }).port}`;
  // Le regole di test accorciano l'animazione.
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  expect(login.status).toBe(200);
  cookie = login.headers.get('set-cookie')!.split(';')[0];
  const imp = await adminFetch('/api/admin/cards/import', {
    method: 'POST',
    body: JSON.stringify({ batches: [{ name: 'Test', cards: [{ code: 'T0001', matrix: CARD_T1 }, { code: 'T0002', matrix: CARD_T2 }, { code: 'T0003', matrix: CARD_T3 }] }] }),
  });
  expect((await imp.json()).imported).toBe(3);
  const ev = await (await adminFetch('/api/admin/events', { method: 'POST', body: JSON.stringify({ name: 'Cena di Natale' }) })).json();
  gameId = (await (await adminFetch('/api/admin/games', { method: 'POST', body: JSON.stringify({ eventId: ev.id, name: 'Partita 1', rules: { minDrawIntervalMs: 800 } }) })).json()).id;
  for (const [title, category, quantity] of [['Buono cena per due', 'ambo', 1], ['Panettone', 'terno', 1], ['Weekend', 'tombola', 1]] as const) {
    const r = await adminFetch('/api/admin/prizes', { method: 'POST', body: JSON.stringify({ gameId, title, category, quantity }) });
    expect(r.status).toBe(200);
  }
  await adminFetch(`/api/admin/games/${gameId}/activate`, { method: 'POST', body: JSON.stringify({ spec: 'T0001-T0002' }) });
  const pair = await (await adminFetch('/api/admin/pairings', { method: 'POST', body: JSON.stringify({ baseUrl: base, label: 'Telefono Andrea' }) })).json();
  token = pair.token;
  expect(pair.url).toContain('/control#t=');
  expect(pair.svg).toContain('<svg');
});

afterAll(async () => {
  await srv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('API e sicurezza', () => {
  it('il display non è autorizzato a estrarre; il CMS senza password è chiuso', async () => {
    const r = await control('draw', { expectedCount: 0 }, cid(), '');
    expect(r.status).toBe(401);
    expect((await fetch(base + '/api/admin/overview')).status).toBe(401);
    const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'no' }) });
    expect(bad.status).toBe(401);
  });

  it('flusso completo telefono → display: estrazione, verifica, vincita, regalo', async () => {
    const pubMsgs: PublicState[] = [];
    const ctlMsgs: ControlState[] = [];
    const display = await openWs((m) => m.type === 'public' && pubMsgs.push(m.state));
    const phone = await openWs((m) => m.type === 'control' && ctlMsgs.push(m.state), token);
    expect((await control('startGame', { gameId })).body.ok).toBe(true);
    await drawForced(1);
    await drawForced(12);
    expect((await control('openCheck')).body.ok).toBe(true);
    // Un secondo tocco su Estrai durante la verifica viene rifiutato.
    const blocked = await control('draw', { expectedCount: 2 });
    expect(blocked.body.ok).toBe(false);
    const ver = await (await fetch(`${base}/api/control/verify?code=t1`, { headers: { authorization: `Bearer ${token}` } })).json();
    expect(ver.rows[0].qualifies).toBe('ambo');
    const claim = await control('addClaim', { code: 'T0001', category: 'ambo', row: 1, winnerName: 'Marco Rossi' });
    expect(claim.body.result.status).toBe('valid');
    const conf = await control('confirm');
    const awardId = conf.body.result.awards[0];
    await control('announce', { awardId });
    await new Promise((r) => setTimeout(r, 100));
    const winnerState = pubMsgs.at(-1)!;
    expect(winnerState.stage.type).toBe('winner');
    expect(winnerState.stage.award?.winnerName).toBe('Marco Rossi');
    // Nessun messaggio pubblico ha mai contenuto il titolo del regalo prima della rivelazione.
    expect(JSON.stringify(pubMsgs)).not.toContain('Buono cena');
    await control('reveal', { awardId });
    await new Promise((r) => setTimeout(r, 100));
    expect(pubMsgs.at(-1)!.stage.prize?.title).toBe('Buono cena per due');
    expect(ctlMsgs.at(-1)!.awards[0].status).toBe('revealed');
    // Riconnessione del display: stato attuale, stesso effetto (nessuna nuova animazione), nessun nuovo regalo.
    const effect = pubMsgs.at(-1)!.stage.effectId;
    display.close();
    const again: PublicState[] = [];
    const d2 = await openWs((m) => m.type === 'public' && again.push(m.state));
    await new Promise((r) => setTimeout(r, 100));
    expect(again[0].stage.effectId).toBe(effect);
    expect(again[0].stage.type).toBe('gift');
    expect(srv.ctx.engine.awards(gameId)).toHaveLength(1);
    d2.close();
    phone.close();
    expect((await control('resume')).body.ok).toBe(true);
  });

  it('retry con lo stesso commandId non duplica; due controllori non estraggono due volte', async () => {
    await new Promise((r) => setTimeout(r, 900));
    const count = srv.ctx.engine.draws(gameId).length;
    const id = cid();
    const [a, b] = await Promise.all([control('draw', { expectedCount: count }, id), control('draw', { expectedCount: count }, id)]);
    expect(a.body.ok && b.body.ok).toBe(true);
    expect(srv.ctx.engine.draws(gameId)).toHaveLength(count + 1);
    await new Promise((r) => setTimeout(r, 900));
    const [c, d] = await Promise.all([
      control('draw', { expectedCount: count + 1 }),
      fetch(base + '/api/control/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ commandId: cid(), type: 'draw', payload: { expectedCount: count + 1 } }),
      }).then(async (r) => ({ body: await r.json() })),
    ]);
    expect([c.body.ok, d.body.ok].filter(Boolean)).toHaveLength(1);
    expect(srv.ctx.engine.draws(gameId)).toHaveLength(count + 2);
  });

  it('immagine del premio: non accessibile pubblicamente prima della rivelazione', async () => {
    const prizes = await (await adminFetch(`/api/admin/games/${gameId}/prizes`)).json();
    const terno = prizes.find((p: { category: string }) => p.category === 'terno');
    const png = fs.readFileSync(path.join(process.cwd(), 'assets/img/camioncino.png'));
    const up = await adminFetch(`/api/admin/prizes/${terno.id}/image`, { method: 'PUT', body: png, headers: { 'content-type': 'application/octet-stream' } });
    expect(up.status).toBe(200);
    const fake = await adminFetch(`/api/admin/prizes/${terno.id}/image`, { method: 'PUT', body: 'non è un\'immagine', headers: { 'content-type': 'application/octet-stream' } });
    expect(fake.status).toBe(400);
    const files = fs.readdirSync(path.join(dataDir, 'uploads', 'prizes'));
    expect((await fetch(`${base}/media/prizes/${files[0]}`)).status).toBe(404);
    expect((await fetch(`${base}/api/public/award/999/image`)).status).toBe(404);
  });

  it('revoca: il telefono perde subito l’accesso', async () => {
    const pair = await (await adminFetch('/api/admin/pairings', { method: 'POST', body: JSON.stringify({ baseUrl: base, label: 'Da revocare' }) })).json();
    expect((await fetch(base + '/api/control/state', { headers: { authorization: `Bearer ${pair.token}` } })).status).toBe(200);
    await adminFetch(`/api/admin/pairings/${pair.id}`, { method: 'DELETE' });
    expect((await fetch(base + '/api/control/state', { headers: { authorization: `Bearer ${pair.token}` } })).status).toBe(401);
  });
});

describe('PDF delle cartelle', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tombola-pdf-'));
  it('A6: una cartella per pagina 148 × 105 mm, testo e numeri uguali al database', async () => {
    const r = await adminFetch('/api/admin/print', { method: 'POST', body: JSON.stringify({ format: 'a6', spec: 'T0001-T0003', profile: { qr: true } }) });
    expect(r.status).toBe(200);
    const dir = tmp();
    const file = path.join(dir, 'a6.pdf');
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    const info = execFileSync('pdfinfo', [file]).toString();
    expect(info).toMatch(/Pages:\s+3/);
    const size = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info)!;
    expect(Number(size[1]) / (72 / 25.4)).toBeCloseTo(148, 1);
    expect(Number(size[2]) / (72 / 25.4)).toBeCloseTo(105, 1);
    expect(execFileSync('pdffonts', [file]).toString()).toMatch(/Lato-Black\s+CID TrueType\s+Identity-H\s+yes/);
    for (const [page, code, matrix] of [[1, 'T0001', CARD_T1], [2, 'T0002', CARD_T2], [3, 'T0003', CARD_T3]] as const) {
      const text = execFileSync('pdftotext', ['-f', String(page), '-l', String(page), '-raw', file, '-']).toString();
      expect(text).toContain(code);
      const nums = text.match(/\b\d{1,2}\b/g)!.map(Number);
      const expected = matrix.flat().filter((x) => x);
      // I numeri compaiono riga per riga, da sinistra a destra, nello stesso ordine della matrice salvata.
      const idx = nums.findIndex((_, i) => expected.every((e, k) => nums[i + k] === e));
      expect(idx, `numeri di ${code}: ${nums.join(' ')}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('A4: quattro cartelle diverse per foglio, A4 orizzontale', async () => {
    const r = await adminFetch('/api/admin/print', { method: 'POST', body: JSON.stringify({ format: 'a4', spec: 'T0001-T0003', profile: { back: true, cropMarks: true } }) });
    expect(r.status).toBe(200);
    expect(decodeURIComponent(r.headers.get('x-layout')!)).toMatch(/148,5/);
    const file = path.join(tmp(), 'a4.pdf');
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    const info = execFileSync('pdfinfo', [file]).toString();
    expect(info).toMatch(/Pages:\s+2/); // fronte + retro
    const size = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info)!;
    expect(Number(size[1]) / (72 / 25.4)).toBeCloseTo(297, 1);
    expect(Number(size[2]) / (72 / 25.4)).toBeCloseTo(210, 1);
    const text = execFileSync('pdftotext', ['-f', '1', '-l', '1', file, '-']).toString();
    for (const code of ['T0001', 'T0002', 'T0003']) expect(text).toContain(code);
  });

  it('A6 con abbondanza e segni di taglio allarga la pagina senza cambiare la cartella', async () => {
    const r = await adminFetch('/api/admin/print', { method: 'POST', body: JSON.stringify({ format: 'a6', spec: 'T0001', profile: { bleedMm: 3, cropMarks: true } }) });
    const file = path.join(tmp(), 'bleed.pdf');
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    const size = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(execFileSync('pdfinfo', [file]).toString())!;
    expect(Number(size[1]) / (72 / 25.4)).toBeCloseTo(148 + 18, 1);
  });

  it('la ristampa mantiene codice e numeri ed è segnalata', async () => {
    await adminFetch('/api/admin/print', { method: 'POST', body: JSON.stringify({ format: 'a6', spec: 'T0003', mark: true }) });
    const r = await adminFetch('/api/admin/print', { method: 'POST', body: JSON.stringify({ format: 'a6', spec: 'T0003', mark: true }) });
    expect(r.headers.get('x-reprints')).toBe('1');
    const file = path.join(tmp(), 're.pdf');
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    expect(execFileSync('pdftotext', [file, '-']).toString()).toMatch(/RISTAMPA/);
  });
});

describe('backup e ripristino', () => {
  it('esporta, valida e ripristina con copia di sicurezza', async () => {
    const zip = Buffer.from(await (await adminFetch('/api/admin/backup')).arrayBuffer());
    const drawsBefore = srv.ctx.engine.draws(gameId);
    const dry = await (await adminFetch('/api/admin/restore', { method: 'POST', body: zip, headers: { 'content-type': 'application/zip' } })).json();
    expect(dry.dryRun).toBe(true);
    expect(dry.summary.cards).toBe(3);
    const bad = await adminFetch('/api/admin/restore?confirm=1', { method: 'POST', body: Buffer.from('xx'), headers: { 'content-type': 'application/zip' } });
    expect(bad.status).toBe(400);
    const ok = await (await adminFetch('/api/admin/restore?confirm=1', { method: 'POST', body: zip, headers: { 'content-type': 'application/zip' } })).json();
    expect(ok.restored).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'backups', ok.safetyBackup))).toBe(true);
    expect(srv.ctx.engine.draws(gameId)).toEqual(drawsBefore);
  });
});
