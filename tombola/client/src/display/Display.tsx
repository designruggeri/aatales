// Tabellone pubblico per il proiettore (sola lettura). Disegnato a 1920×1080 e scalato a qualsiasi schermo 16:9.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLive } from '../lib/live';
import { GiftBox, Holly, Truck } from '../lib/decor';
import { CATEGORY_LABEL, CATEGORY_PLURAL, type PublicState } from '../../../shared/types';
import { audioReady, numberToItalian, playFile, setVolume, sfx, speak, unlockAudio } from './sounds';
import './display.css';

interface LocalPrefs {
  volume: number;
  muted: boolean;
  reduced: boolean;
}
function loadPrefs(): LocalPrefs {
  try {
    return { volume: 0.7, muted: false, reduced: false, ...JSON.parse(localStorage.getItem('tb_display_prefs') ?? '{}') };
  } catch {
    return { volume: 0.7, muted: false, reduced: false };
  }
}

type Anim =
  | { kind: 'draw'; id: number; number: number; phase: 'roll' | 'pop' }
  | { kind: 'winner'; id: number }
  | { kind: 'gift'; id: number; phase: 'closed' | 'open' }
  | { kind: 'truck'; id: number };

function useStageScale() {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return scale;
}

export default function Display({ preview = false }: { preview?: boolean }) {
  const { pub, status, offset } = useLive();
  const scale = useStageScale();
  const [prefs, setPrefs] = useState<LocalPrefs>(loadPrefs);
  const [started, setStarted] = useState(preview);
  const [menu, setMenu] = useState(false);
  const [anims, setAnims] = useState<Anim[]>([]);
  const seen = useRef<number | null>(null);
  const timers = useRef<number[]>([]);

  const muted = preview || prefs.muted || !!pub?.display.muted;
  const reduced = prefs.reduced || !!pub?.display.reducedMotion;
  useEffect(() => {
    setVolume(prefs.volume);
    try {
      localStorage.setItem('tb_display_prefs', JSON.stringify(prefs));
    } catch {
      /* preferenze solo locali */
    }
  }, [prefs]);

  const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Effetti: si riproducono una volta sola, e solo se recenti (una riconnessione non ripete vecchi annunci).
  useEffect(() => {
    if (!pub) return;
    const s = pub.stage;
    const age = Date.now() + offset - s.effectAt;
    const first = seen.current === null;
    if (!first && s.effectId <= seen.current!) return;
    seen.current = s.effectId;
    if (s.effectKind === 'none' || age > (first ? 2500 : 8000)) return;
    const sound = (fn: () => void) => !muted && fn();
    const id = s.effectId;
    const fast = reduced ? 0.25 : 1;
    if (s.effectKind === 'draw' && s.lastNumber) {
      const n = s.lastNumber;
      setAnims((a) => [...a.filter((x) => x.kind !== 'draw' && x.kind !== 'gift' && x.kind !== 'winner'), { kind: 'draw', id, number: n.number, phase: 'roll' }]);
      sound(() => (reduced ? sfx.winner : sfx.draw)());
      later(1350 * fast, () => setAnims((a) => a.map((x) => (x.id === id && x.kind === 'draw' ? { ...x, phase: 'pop' } : x))));
      later(1350 * fast + 900, () => {
        setAnims((a) => a.filter((x) => x.id !== id));
        if (n.special === 'clacson' || n.special === 'camioncino') sound(sfx.horn);
        if (n.special === 'camioncino' && !reduced) {
          setAnims((a) => [...a, { kind: 'truck', id: -id }]);
          later(3200, () => setAnims((a) => a.filter((x) => x.id !== -id)));
        }
        if (n.audioUrl) sound(() => playFile(n.audioUrl!, prefs.volume));
        else if (pub.display.voice) sound(() => speak(numberToItalian(n.number), prefs.volume));
      });
    } else if (s.effectKind === 'winner') {
      setAnims((a) => [...a.filter((x) => x.kind === 'truck'), { kind: 'winner', id }]);
      sound(sfx.winner);
      later(reduced ? 600 : 3500, () => setAnims((a) => a.filter((x) => x.id !== id)));
    } else if (s.effectKind === 'gift') {
      setAnims((a) => [...a.filter((x) => x.kind === 'truck'), { kind: 'gift', id, phase: 'closed' }]);
      sound(() => sfx.drumroll(reduced ? 0.3 : 1.5));
      later(reduced ? 300 : 1600, () => {
        setAnims((a) => a.map((x) => (x.id === id && x.kind === 'gift' ? { ...x, phase: 'open' } : x)));
        sound(sfx.tada);
      });
      later(reduced ? 600 : 4500, () => setAnims((a) => a.filter((x) => x.id !== id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub?.stage.effectId]);

  const style = useMemo(() => {
    const c = pub?.branding.colors;
    return c ? ({ '--busa': c.primary, '--busa-dark': c.dark, '--busa-light': c.light, '--accent': c.accent } as React.CSSProperties) : {};
  }, [pub?.branding.colors]);

  if (!pub) {
    return (
      <div className="display-root loading">
        <p>{status === 'offline' ? 'Server non raggiungibile: riprovo…' : 'Collegamento al tabellone…'}</p>
      </div>
    );
  }

  const drawAnim = anims.find((a) => a.kind === 'draw') as Extract<Anim, { kind: 'draw' }> | undefined;
  const hiddenNumber = drawAnim && drawAnim.phase === 'roll' ? drawAnim.number : null;
  const draws = pub.game?.draws ?? [];
  const drawnSet = new Set(draws.filter((n) => n !== hiddenNumber));
  const last = draws.length ? draws[draws.length - 1] : null;
  const christmas = pub.branding.christmas;

  const start = (withAudio: boolean) => {
    if (withAudio) {
      unlockAudio();
      setPrefs((p) => ({ ...p, muted: false }));
    } else setPrefs((p) => ({ ...p, muted: true }));
    document.documentElement.requestFullscreen?.().catch(() => {});
    setStarted(true);
  };

  return (
    <div className={`display-root ${reduced ? 'reduced' : ''}`} style={style} onMouseMove={() => !preview && setMenu(true)}>
      <div className="stage" style={{ transform: `scale(${scale})` }}>
        <div className="rays" />
        <aside className="band">
          {christmas && !pub.branding.logoUrl && <Holly size={80} style={{ position: 'absolute', top: 8, left: 52 }} />}
          {pub.branding.logoUrl && <img className="band-logo" src={pub.branding.logoUrl} alt="Logo" />}
          {/* SVG con textLength: il titolo riempie sempre la fascia, qualunque sia la lunghezza. */}
          <svg className="band-title" width="150" height="790" viewBox="0 0 150 790" role="heading" aria-level={1} aria-label={pub.branding.title}>
            <text
              transform="translate(118 785) rotate(-90)"
              textLength={Math.min(780, pub.branding.title.length * 74)}
              lengthAdjust="spacingAndGlyphs"
              fontSize="112"
            >
              {pub.branding.title.toUpperCase()}
            </text>
          </svg>
          <div className="band-truck">
            <Truck width={150} christmas={christmas} bounce={!reduced} />
          </div>
        </aside>

        <section className="board" aria-label="Tabellone dei numeri da 1 a 90">
          {Array.from({ length: 90 }, (_, i) => i + 1).map((n) => {
            const drawn = drawnSet.has(n);
            const isLast = drawn && n === last;
            return (
              <div key={n} className={`cell ${drawn ? 'drawn' : ''} ${isLast ? 'last' : ''}`} aria-label={`${n}${drawn ? ' estratto' : ''}`}>
                <span>{n}</span>
              </div>
            );
          })}
          {christmas && <Holly size={70} style={{ position: 'absolute', right: -18, top: -22 }} />}
        </section>

        <SidePanel pub={pub} anims={anims} drawAnim={drawAnim} christmas={christmas} />

        {pub.stage.type === 'final' && <FinalSummary pub={pub} />}
        {anims.some((a) => a.kind === 'winner') && !reduced && <Confetti />}
        {anims.some((a) => a.kind === 'truck') && (
          <div className="truck-run">
            <Truck width={420} christmas={christmas} bounce={false} />
          </div>
        )}
        {pub.game?.isTest && <div className="test-badge">PROVA</div>}
      </div>

      {status !== 'online' && <div className="offline">Connessione persa: mostro l'ultimo stato confermato. Riconnessione…</div>}

      {!started && (
        <div className="start-overlay">
          <div className="start-card">
            <Truck width={260} christmas={christmas} />
            <h2>Tabellone pronto</h2>
            <p>Un clic abilita l'audio e lo schermo intero. Questa pagina mostra soltanto: i comandi sono sul telefono.</p>
            <button className="btn big" onClick={() => start(true)} autoFocus>
              Avvia con audio e schermo intero
            </button>
            <button className="btn secondary" onClick={() => start(false)}>
              Avvia senza audio
            </button>
          </div>
        </div>
      )}

      {started && !preview && (
        <DisplayMenu
          visible={menu}
          onHide={() => setMenu(false)}
          prefs={prefs}
          setPrefs={setPrefs}
          serverMuted={pub.display.muted}
          serverReduced={pub.display.reducedMotion}
        />
      )}
    </div>
  );
}

function Ball({ n, size, className = '' }: { n: number; size: number; className?: string }) {
  return (
    <div className={`ball ${className}`} style={{ width: size, height: size, fontSize: size * (n > 9 ? 0.46 : 0.52) }}>
      <span>{n}</span>
    </div>
  );
}

function PrizeTable({ pub }: { pub: PublicState }) {
  const cats = pub.game?.categories ?? [];
  if (!cats.length) return null;
  return (
    <div className="prizes">
      <h3>Premi ancora da vincere</h3>
      {cats.map((c) => (
        <div key={c.category} className={`prize-row ${c.remaining ? '' : 'done'}`}>
          <span>{CATEGORY_PLURAL[c.category]}</span>
          <b>{c.remaining ? c.remaining : 'finiti'}</b>
        </div>
      ))}
    </div>
  );
}

function SidePanel({ pub, anims, drawAnim, christmas }: { pub: PublicState; anims: Anim[]; drawAnim?: Extract<Anim, { kind: 'draw' }>; christmas: boolean }) {
  const s = pub.stage;
  const draws = pub.game?.draws ?? [];
  const gift = anims.find((a) => a.kind === 'gift') as Extract<Anim, { kind: 'gift' }> | undefined;
  const corner = christmas && <Holly size={64} style={{ position: 'absolute', right: -14, top: -16 }} />;

  if (!pub.game || s.type === 'waiting' || pub.game.status === 'setup') {
    return (
      <aside className="panel waiting">
        {corner}
        <h2 className="panel-title">Preparate le cartelle!</h2>
        <p className="game-name">{pub.event?.name ?? ''}{pub.game ? ` · ${pub.game.name}` : ''}</p>
        <ul className="rules">
          {(pub.game?.rules ?? []).slice(0, (pub.game?.categories.length ?? 0) > 3 ? 4 : 5).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <PrizeTable pub={pub} />
      </aside>
    );
  }

  if (s.type === 'winner' && s.award) {
    const a = s.award;
    return (
      <aside className="panel winner">
        {corner}
        <h2 className="win-title">{CATEGORY_LABEL[a.category]}!</h2>
        {a.winnerName && <div className="ribbon">{a.winnerName}</div>}
        <div className="win-card">
          Cartella <b>{a.cardCode}</b>
          {a.row ? (
            <>
              {' '}
              · Riga <b>{a.row}</b>
            </>
          ) : null}
        </div>
        <div className="win-truck">
          <Truck width={300} christmas={christmas} />
        </div>
      </aside>
    );
  }

  if (s.type === 'gift' && s.award) {
    const open = !gift || gift.phase === 'open';
    return (
      <aside className={`panel gift-panel ${s.zoom ? 'zoom' : ''}`}>
        {corner}
        <h2 className="panel-title">Il tuo premio!</h2>
        <p className="gift-who">
          {CATEGORY_LABEL[s.award.category]} · {s.award.winnerName ? `${s.award.winnerName} · ` : ''}
          {s.award.cardCode}
        </p>
        <div className={`gift-stage ${open ? 'is-open' : 'is-closed'}`}>
          {open && s.prize?.imageUrl ? (
            <img className="prize-img" src={s.prize.imageUrl} alt={s.prize.title} />
          ) : (
            <GiftBox open={open} size={s.zoom ? 420 : 320} />
          )}
        </div>
        {open && s.prize && (
          <>
            <div className="prize-title">{s.prize.title}</div>
            {s.prize.description && <p className="prize-desc">{s.prize.description}</p>}
          </>
        )}
      </aside>
    );
  }

  if (s.type === 'check') {
    return (
      <aside className="panel check">
        {corner}
        <h2 className="panel-title">Verifica in corso</h2>
        <div className="magnifier" aria-hidden="true">
          <svg viewBox="0 0 120 120" width="200" height="200">
            <circle cx="50" cy="50" r="34" fill="#fff" stroke="currentColor" strokeWidth="12" />
            <path d="M75 75 L108 108" stroke="currentColor" strokeWidth="16" strokeLinecap="round" />
          </svg>
        </div>
        <p className="check-text">Il conduttore controlla la cartella. Estrazioni in pausa.</p>
        {draws.length > 0 && (
          <div className="check-last">
            Ultimo numero <Ball n={draws[draws.length - 1]} size={110} />
          </div>
        )}
      </aside>
    );
  }

  if (s.type === 'pause') {
    return (
      <aside className="panel pause">
        {corner}
        <h2 className="panel-title big">Pausa</h2>
        {s.message && <p className="pause-msg">{s.message}</p>}
        <Truck width={340} christmas={christmas} />
        <PrizeTable pub={pub} />
      </aside>
    );
  }

  // Partita attiva: ultimo numero, ultimi 5, premi.
  const info = s.lastNumber;
  const rolling = drawAnim?.phase === 'roll';
  // Durante il rotolamento il numero nuovo non si vede ancora da nessuna parte.
  const lastFive = (rolling ? draws.slice(-6, -1) : draws.slice(-5)).reverse();
  return (
    <aside className="panel active">
      {corner}
      <h2 className="panel-title">Ultimo numero estratto</h2>
      <div className="big-ball-wrap">
        {rolling ? (
          <div className="ball big rolling">
            <span>?</span>
          </div>
        ) : info ? (
          <Ball key={info.number} n={info.number} size={300} className={`big ${drawAnim ? 'pop' : ''}`} />
        ) : (
          <div className="ball big empty">
            <span>–</span>
          </div>
        )}
      </div>
      <div className="meaning">
        {!rolling && info?.traditional && <p className="trad">{info.traditional}</p>}
        {!rolling && info?.busaText && <p className="busa">{info.busaText}</p>}
        {!rolling && info?.imageUrl && <img className="number-img" src={info.imageUrl} alt="" />}
      </div>
      <div className="last-five">
        <h3>Ultimi 5 numeri</h3>
        <div className="row">
          {lastFive.length ? (
            lastFive.map((n, i) => <Ball key={`${n}-${i}`} n={n} size={82} className={`mini c${i}`} />)
          ) : (
            <span className="none">—</span>
          )}
        </div>
      </div>
      <PrizeTable pub={pub} />
      <div className="count">{rolling ? draws.length - 1 : draws.length} / 90 estratti</div>
    </aside>
  );
}

function FinalSummary({ pub }: { pub: PublicState }) {
  const w = pub.stage.winners;
  return (
    <div className="final">
      <h2>Riepilogo · {pub.game?.name}</h2>
      {w.length === 0 ? (
        <p>Nessuna vincita registrata.</p>
      ) : (
        <ol>
          {w.map((x) => (
            <li key={x.awardId}>
              <b>{CATEGORY_LABEL[x.category]}</b>
              <span>
                {x.winnerName ? `${x.winnerName} · ` : ''}
                {x.cardCode}
                {x.row ? ` · riga ${x.row}` : ''}
              </span>
              <em>{x.prizeTitle ?? 'premio da rivelare'}</em>
            </li>
          ))}
        </ol>
      )}
      <p className="thanks">Grazie a tutti e buone feste dal team Busa!</p>
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        dur: 2 + Math.random() * 1.5,
        color: ['#e8432c', '#ffcc33', '#52ae32', '#ffffff', '#f7941d'][i % 5],
        rot: Math.random() * 360,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i key={i} style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, transform: `rotate(${p.rot}deg)` }} />
      ))}
    </div>
  );
}

function DisplayMenu(props: {
  visible: boolean;
  onHide: () => void;
  prefs: LocalPrefs;
  setPrefs: React.Dispatch<React.SetStateAction<LocalPrefs>>;
  serverMuted: boolean;
  serverReduced: boolean;
}) {
  const { visible, onHide, prefs, setPrefs } = props;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!visible || open) return;
    const t = window.setTimeout(onHide, 3000);
    return () => window.clearTimeout(t);
  }, [visible, open, onHide]);
  return (
    <div className={`dmenu ${visible || open ? 'show' : ''}`}>
      {open && (
        <div className="dmenu-panel">
          <label>
            Volume
            <input type="range" min={0} max={1} step={0.05} value={prefs.volume} onChange={(e) => setPrefs((p) => ({ ...p, volume: Number(e.target.value) }))} />
          </label>
          <label className="chk">
            <input type="checkbox" checked={prefs.muted} onChange={(e) => setPrefs((p) => ({ ...p, muted: e.target.checked }))} /> Silenzia questo schermo
          </label>
          {props.serverMuted && <p className="note">Audio silenziato dal telecomando.</p>}
          <label className="chk">
            <input type="checkbox" checked={prefs.reduced} onChange={(e) => setPrefs((p) => ({ ...p, reduced: e.target.checked }))} /> Riduci le animazioni
          </label>
          {props.serverReduced && <p className="note">Animazioni ridotte dal telecomando.</p>}
          <div className="dmenu-actions">
            <button className="btn small" onClick={() => { unlockAudio(); sfx.winner(); }}>
              Prova audio {audioReady() ? '' : '(attiva)'}
            </button>
            <button className="btn small secondary" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>
              Schermo intero
            </button>
          </div>
        </div>
      )}
      <button className="dmenu-btn" onClick={() => setOpen((o) => !o)} aria-label="Impostazioni del tabellone">
        ⚙
      </button>
    </div>
  );
}
