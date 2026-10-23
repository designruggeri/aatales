// Avvio: npm start (oppure npm run dev durante lo sviluppo).
import path from 'node:path';
import { createTombolaServer, lanAddresses } from './app.js';
import { ROOT } from './paths.js';

const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '0.0.0.0';
const dataDir = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));

const { server, ctx } = createTombolaServer({
  dataDir,
  port,
  adminPassword: process.env.ADMIN_PASSWORD || undefined,
  cookieSecure: process.env.COOKIE_SECURE === '1',
});

server.listen(port, host, () => {
  const addrs = lanAddresses(port);
  const line = '='.repeat(60);
  console.log(`\n${line}\n  TOMBOLA BUSA — server avviato\n${line}`);
  console.log(`  Su questo portatile:   http://localhost:${port}/`);
  console.log(`    Tabellone (proiettore): http://localhost:${port}/display`);
  console.log(`    CMS:                    http://localhost:${port}/admin`);
  if (addrs.length) {
    console.log('  Dal telefono (stessa rete Wi-Fi):');
    for (const a of addrs) console.log(`    ${a}/`);
  } else {
    console.log('  Nessuna rete trovata: collega il portatile al Wi-Fi o all\'hotspot.');
  }
  console.log(`  Dati salvati in: ${ctx.dataDir}`);
  if (ctx.firstPassword) {
    console.log(`\n  PRIMO AVVIO — password del CMS: ${ctx.firstPassword}`);
    console.log('  Annotala: non verrà più mostrata (si cambia dal CMS, sezione Registro e backup).');
  }
  console.log(`${line}\n  Per fermare: Ctrl + C (i dati restano salvati)\n`);
});

const stop = () => {
  console.log('\nArresto del server…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
