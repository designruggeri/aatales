// Percorsi del progetto, validi sia eseguendo i sorgenti (tsx) sia la build (dist/).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg, 'utf8')).name === 'tombola-busa') return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Cartella del progetto non trovata');
}

export const ROOT = findRoot();
export const ASSETS = path.join(ROOT, 'assets');
export const CLIENT_DIST = path.join(ROOT, 'dist', 'client');
export const FONT = {
  normal: path.join(ASSETS, 'fonts', 'Lato-normal.ttf'),
  bold: path.join(ASSETS, 'fonts', 'Lato-bold.ttf'),
  black: path.join(ASSETS, 'fonts', 'Lato-black.ttf'),
};
export const TRUCK_PNG = path.join(ASSETS, 'img', 'camioncino.png');
