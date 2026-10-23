// Prova end-to-end: tabellone e telecomando in contesti browser separati, dal numero estratto al regalo rivelato.
import { test, expect, type Page } from '@playwright/test';

const z = 0;
const CARDS = [
  { code: 'T0001', matrix: [[1, 12, 23, 34, 45, z, z, z, z], [z, z, z, z, 46, 56, 66, 76, 86], [5, 15, 25, 35, z, z, z, z, 90]] },
  { code: 'T0002', matrix: [[2, 13, 24, 36, 47, z, z, z, z], [z, z, z, z, 48, 57, 67, 77, 87], [6, 16, 26, 37, z, z, z, z, 88]] },
];

const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: name.startsWith('tel') });
};

async function drawForced(phone: Page, n: number) {
  const r = await phone.request.post(`/__test/force/${n}`);
  expect((await r.json()).ok).toBe(true);
  const btn = phone.locator('button.draw');
  await expect(btn).toBeEnabled({ timeout: 10_000 });
  await btn.click();
}

test('serata completa: estrazione, verifica, vincita e regalo', async ({ browser, baseURL }) => {
  // --- CMS sul portatile
  const admin = await browser.newContext();
  const ap = await admin.newPage();
  await ap.goto('/admin');
  await ap.fill('input[type=password]', 'e2e-password-123');
  await ap.click('button[type=submit]');
  await expect(ap.getByRole('heading', { name: 'Panoramica' })).toBeVisible();
  const setup = await ap.evaluate(async (cards) => {
    const j = (url: string, body: unknown, method = 'POST') =>
      fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    await fetch('/api/admin/cards/import', { method: 'POST', body: JSON.stringify({ batches: [{ name: 'E2E', cards }] }) });
    const ev = await j('/api/admin/events', { name: 'Cena di Natale E2E' });
    const g = await j('/api/admin/games', { eventId: ev.id, name: 'Partita 1', rules: { minDrawIntervalMs: 1500 } });
    await j('/api/admin/prizes', { gameId: g.id, title: 'Buono cena per due', category: 'ambo', quantity: 1 });
    await j('/api/admin/prizes', { gameId: g.id, title: 'Weekend', category: 'tombola', quantity: 1 });
    await j(`/api/admin/games/${g.id}/activate`, { spec: 'T0001-T0002' });
    await fetch(`/api/admin/games/${g.id}/select`, { method: 'POST' });
    const pair = await j('/api/admin/pairings', { baseUrl: location.origin, label: 'Telefono E2E' });
    return { url: pair.url as string };
  }, CARDS);

  // --- Tabellone (proiettore)
  const display = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const dp = await display.newPage();
  await dp.goto('/display');
  await dp.getByRole('button', { name: 'Avvia senza audio' }).click();
  await expect(dp.getByText('Preparate le cartelle!')).toBeVisible();

  // --- Telecomando (smartphone Android, 360 px)
  const phoneCtx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, baseURL });
  const pp = await phoneCtx.newPage();
  await pp.goto(setup.url);
  await expect(pp.getByText('Collegato')).toBeVisible();
  expect(pp.url()).not.toContain('#t='); // la credenziale non resta nell'indirizzo
  await pp.getByRole('button', { name: 'Avvia partita' }).click();
  await pp.locator('.modal').getByRole('button', { name: 'Avvia partita' }).click();

  // "Estrai" visibile senza scorrere
  const box = await pp.locator('button.draw').boundingBox();
  expect(box!.y + box!.height).toBeLessThan(640);

  await drawForced(pp, 1);
  await expect(dp.locator('.cell.drawn', { hasText: /^1$/ })).toBeVisible({ timeout: 5000 });
  await drawForced(pp, 12);
  await expect(dp.locator('.cell.drawn.last', { hasText: '12' })).toBeVisible({ timeout: 5000 });
  await expect(dp.locator('.ball.big')).toContainText('12');

  // --- Vincita dichiarata e verifica
  await pp.getByRole('button', { name: 'Vincita dichiarata / Pausa' }).click();
  await expect(dp.getByText('Verifica in corso')).toBeVisible();
  await expect(pp.locator('button.draw')).toHaveCount(0); // durante la verifica non si estrae
  await pp.getByLabel('Codice cartella').fill('t1');
  await pp.getByRole('button', { name: 'Verifica cartella' }).click();
  await expect(pp.getByText('Ambo valido sulla riga 1')).toBeVisible();
  await pp.getByPlaceholder('Nome del vincitore (facoltativo)').fill('Marco Rossi');
  await shot(pp, 'tel-verifica');
  await shot(dp, 'disp-verifica');
  await pp.getByRole('button', { name: 'Dichiara Ambo · riga 1' }).click();
  await expect(pp.locator('.claims li.valid')).toContainText('T0001');
  await pp.getByRole('button', { name: /Conferma vincita/ }).click();
  await pp.locator('.modal').getByRole('button', { name: 'Conferma vincita' }).click();

  // --- Annuncio: il nome del premio non è ancora sul display
  await pp.getByRole('button', { name: 'Annuncia' }).click();
  await expect(dp.locator('.win-title')).toHaveText(/Ambo!/i);
  await expect(dp.locator('.ribbon')).toHaveText('Marco Rossi');
  expect(await dp.content()).not.toContain('Buono cena');
  await shot(dp, 'disp-vincitore');
  await shot(pp, 'tel-annuncio');

  // --- Rivelazione del regalo già assegnato
  await pp.getByRole('button', { name: 'Rivela premio', exact: true }).click();
  await dp.waitForTimeout(700);
  await shot(dp, 'disp-pacco');
  await expect(dp.locator('.prize-title')).toHaveText('Buono cena per due', { timeout: 6000 });
  await dp.waitForTimeout(800);
  await shot(dp, 'disp-premio');

  // Riconnessione del display: stato attuale, nessuna nuova animazione del pacco
  await dp.reload();
  await dp.getByRole('button', { name: 'Avvia senza audio' }).click();
  await expect(dp.locator('.prize-title')).toHaveText('Buono cena per due');
  await expect(dp.locator('.is-closed')).toHaveCount(0);

  await pp.getByRole('button', { name: 'Riprendi' }).click();
  await expect(pp.locator('button.draw')).toBeVisible();
  await expect(dp.getByText('Ultimo numero estratto')).toBeVisible();
  await expect(dp.locator('.prize-row', { hasText: 'Ambi' })).toContainText('finiti');

  // Il display non può comandare: nessun pulsante di gioco e API protette
  const res = await dp.request.post('/api/control/command', { data: { commandId: 'display-tenta-12345', type: 'draw', payload: { expectedCount: 2 } } });
  expect(res.status()).toBe(401);
});
