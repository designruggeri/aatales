// Suoni sintetizzati con Web Audio: nessun file esterno, funzionano offline. Suonano solo sul display.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.7;

export function unlockAudio(): boolean {
  try {
    ctx ??= new AudioContext();
    if (!master) {
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    void ctx.resume();
    return ctx.state !== 'closed';
  } catch {
    return false;
  }
}
export function audioReady(): boolean {
  return !!ctx && ctx.state === 'running';
}
export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = volume;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.3, slideTo?: number) {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(start: number, dur: number, gain = 0.15) {
  if (!ctx || !master) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (0.5 + 0.5 * Math.sin(i / 300));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 900;
  const g = ctx.createGain();
  const t0 = ctx.currentTime + start;
  g.gain.setValueAtTime(gain, t0);
  g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  /** Rotolamento della pallina e "pop" finale (circa 1,5 s). */
  draw() {
    noise(0, 1.2, 0.08);
    [0, 0.18, 0.36, 0.54, 0.72, 0.9].forEach((t, i) => tone(300 + i * 40, t, 0.08, 'triangle', 0.12));
    tone(660, 1.35, 0.25, 'sine', 0.35, 990);
    tone(1320, 1.45, 0.35, 'sine', 0.15);
  },
  winner() {
    const notes = [523, 659, 784, 1046, 784, 1046];
    notes.forEach((f, i) => tone(f, i * 0.12, 0.22, 'square', 0.12));
    tone(1046, 0.75, 0.8, 'triangle', 0.25);
  },
  drumroll(dur = 1.4) {
    for (let t = 0; t < dur; t += 0.05) tone(110 + Math.random() * 20, t, 0.05, 'triangle', 0.08 + (t / dur) * 0.12);
  },
  tada() {
    [784, 988, 1175].forEach((f) => tone(f, 0, 0.9, 'sawtooth', 0.07));
    [1568].forEach((f) => tone(f, 0.15, 0.7, 'sine', 0.15));
  },
  horn() {
    tone(330, 0, 0.35, 'square', 0.18);
    tone(415, 0, 0.35, 'square', 0.14);
    tone(330, 0.45, 0.55, 'square', 0.18);
    tone(415, 0.45, 0.55, 'square', 0.14);
  },
};

export function playFile(url: string, vol: number): void {
  const a = new Audio(url);
  a.volume = Math.max(0, Math.min(1, vol));
  void a.play().catch(() => {});
}

const NUM_WORDS = ['', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove'];
const TENS = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];
export function numberToItalian(n: number): string {
  if (n < 20) return NUM_WORDS[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  let base = TENS[t];
  if (u === 1 || u === 8) base = base.slice(0, -1);
  return base + (u === 3 ? 'tré' : NUM_WORDS[u]);
}

/** Voce sintetica facoltativa: usa le voci installate nel sistema (alcune richiedono internet). */
export function speak(text: string, vol: number) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'it-IT';
  u.volume = vol;
  const it = speechSynthesis.getVoices().find((v) => v.lang.startsWith('it') && v.localService);
  if (it) u.voice = it;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
