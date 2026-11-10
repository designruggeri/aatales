// Riconosce i file audio dei numeri dal nome: 001.mp3 … 090.mp3 (gli zeri iniziali sono facoltativi).

export const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a'];

export interface AudioMatch<F> {
  /** Numero → file da caricare. */
  matched: { n: number; file: F }[];
  /** File scartati, con il motivo. */
  skipped: { name: string; reason: string }[];
}

export function matchAudioFiles<F extends { name: string }>(files: F[]): AudioMatch<F> {
  const byNumber = new Map<number, F[]>();
  const skipped: AudioMatch<F>['skipped'] = [];
  for (const file of files) {
    const m = /^(\d{1,3})\.([a-z0-9]+)$/i.exec(file.name.trim());
    if (!m) {
      skipped.push({ name: file.name, reason: 'nome non riconosciuto (serve 001.mp3 … 090.mp3)' });
      continue;
    }
    if (!AUDIO_EXT.includes(m[2].toLowerCase())) {
      skipped.push({ name: file.name, reason: 'formato non ammesso (MP3, WAV, OGG o M4A)' });
      continue;
    }
    const n = Number(m[1]);
    if (n < 1 || n > 90) {
      skipped.push({ name: file.name, reason: 'numero fuori da 1–90' });
      continue;
    }
    byNumber.set(n, [...(byNumber.get(n) ?? []), file]);
  }
  const matched: AudioMatch<F>['matched'] = [];
  for (const [n, list] of [...byNumber].sort((a, b) => a[0] - b[0])) {
    // Due file per lo stesso numero: nessuna scelta silenziosa, si scartano entrambi.
    if (list.length > 1) list.forEach((f) => skipped.push({ name: f.name, reason: `più file per il numero ${n}` }));
    else matched.push({ n, file: list[0] });
  }
  return { matched, skipped };
}
