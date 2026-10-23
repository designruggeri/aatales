// Piccoli componenti condivisi: finestra di conferma, avvisi, cartella 3×9.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CardMatrix } from '../../../shared/types';
import './ui.css';

interface ConfirmOpts {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Se presente, chiede un testo obbligatorio (es. motivo) di almeno minLength caratteri. */
  input?: { label: string; minLength: number; placeholder?: string };
}
type Pending = ConfirmOpts & { resolve: (v: string | null) => void };

/** Conferma esplicita per azioni importanti. Restituisce il testo inserito ('' se non richiesto) oppure null. */
export function useConfirm(): [(o: ConfirmOpts) => Promise<string | null>, ReactNode] {
  const [p, setP] = useState<Pending | null>(null);
  const [text, setText] = useState('');
  const ask = useCallback((o: ConfirmOpts) => new Promise<string | null>((resolve) => {
    setText('');
    setP({ ...o, resolve });
  }), []);
  const close = (v: string | null) => {
    p?.resolve(v);
    setP(null);
  };
  const ok = !p?.input || text.trim().length >= p.input.minLength;
  const node = p ? (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label={p.title} onKeyDown={(e) => e.key === 'Escape' && close(null)}>
      <div className="modal">
        <h3>{p.title}</h3>
        {p.body && <div className="modal-body">{p.body}</div>}
        {p.input && (
          <label className="modal-input">
            {p.input.label}
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={p.input.placeholder} rows={3} autoFocus />
          </label>
        )}
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => close(null)} autoFocus={!p.input}>
            Annulla
          </button>
          <button className={`btn ${p.danger ? 'danger' : ''}`} disabled={!ok} onClick={() => close(p.input ? text.trim() : '')}>
            {p.confirmLabel ?? 'Conferma'}
          </button>
        </div>
      </div>
    </div>
  ) : null;
  return [ask, node];
}

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'err';
}
export function useToasts(): [(text: string, kind?: 'ok' | 'err') => void, ReactNode] {
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = ++seq.current;
    setList((l) => [...l.slice(-2), { id, text, kind }]);
    window.setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'err' ? 7000 : 3000);
  }, []);
  const node = (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}>
          {t.text}
        </div>
      ))}
    </div>
  );
  return [push, node];
}

/** Cartella con evidenza dei numeri estratti (anello + riempimento) e dell'ultimo numero. */
export function CardGrid({ matrix, drawn, last, compact }: { matrix: CardMatrix; drawn?: Set<number>; last?: number | null; compact?: boolean }) {
  return (
    <div className={`cardgrid ${compact ? 'compact' : ''}`}>
      {matrix.map((row, r) => (
        <div className="cg-row" key={r}>
          <span className="cg-label">{r + 1}</span>
          {row.map((n, c) => (
            <span key={c} className={`cg-cell ${n ? '' : 'empty'} ${n && drawn?.has(n) ? 'hit' : ''} ${n && n === last ? 'last' : ''}`}>
              {n || ''}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function useEsc(fn: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && fn();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fn]);
}
