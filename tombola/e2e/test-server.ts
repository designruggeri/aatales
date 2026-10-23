// Server per le prove end-to-end: dati in una cartella temporanea e un aggancio di test
// per scegliere il prossimo numero. Esiste solo qui: l'applicazione vera non lo contiene.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTombolaServer } from '../server/src/app.js';
import { secureRand } from '../server/src/cards.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tombola-e2e-'));
const { app, server, ctx } = createTombolaServer({ dataDir, adminPassword: 'e2e-password-123', log: () => {} });
app.post('/__test/force/:n', (req, res) => {
  const n = Number(req.params.n);
  const id = ctx.engine.currentGameId()!;
  const drawn = new Set(ctx.engine.draws(id));
  const remaining = [...Array(90).keys()].map((i) => i + 1).filter((x) => !drawn.has(x));
  ctx.engine.rand = () => {
    ctx.engine.rand = secureRand;
    return remaining.indexOf(n);
  };
  res.json({ ok: remaining.includes(n) });
});
server.listen(8099, '127.0.0.1', () => console.log('e2e server pronto'));
process.on('SIGTERM', () => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
});
