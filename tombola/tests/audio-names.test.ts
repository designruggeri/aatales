import { describe, expect, it } from 'vitest';
import { matchAudioFiles } from '../client/src/lib/audioNames.js';

const f = (name: string) => ({ name });

describe('caricamento audio in blocco', () => {
  it('riconosce 001.mp3 … 090.mp3, anche senza zeri e con estensione maiuscola', () => {
    const files = Array.from({ length: 90 }, (_, i) => f(`${String(i + 1).padStart(3, '0')}.mp3`));
    const r = matchAudioFiles([...files, f('7.WAV')].filter((x) => x.name !== '007.mp3'));
    expect(r.matched).toHaveLength(90);
    expect(r.matched[0]).toMatchObject({ n: 1, file: { name: '001.mp3' } });
    expect(r.matched.find((m) => m.n === 7)!.file.name).toBe('7.WAV');
    expect(r.skipped).toEqual([]);
  });

  it('scarta nomi sbagliati, numeri fuori intervallo, formati non audio e doppioni', () => {
    const r = matchAudioFiles([f('091.mp3'), f('000.mp3'), f('numero-5.mp3'), f('012.txt'), f('020.mp3'), f('20.ogg'), f('030.mp3')]);
    expect(r.matched.map((m) => m.n)).toEqual([30]);
    expect(r.skipped.map((s) => s.name).sort()).toEqual(['000.mp3', '012.txt', '020.mp3', '091.mp3', '20.ogg', 'numero-5.mp3']);
    expect(r.skipped.find((s) => s.name === '20.ogg')!.reason).toMatch(/più file/);
  });
});
