import { useEffect, useMemo, useState } from 'react';
import { api, newCommandId } from '../lib/live';
import { CardGrid } from '../lib/ui';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  CATEGORY_PLURAL,
  rulesSummary,
  type CardMatrix,
  type Category,
  type GameRules,
  type PrizeView,
} from '../../../shared/types';
import { GamePicker, statusText, type AdminCtx, type BatchInfo, type GameView } from './Admin';

async function upload(url: string, file: File) {
  return api(url, { method: 'PUT', body: file, headers: { 'content-type': 'application/octet-stream' } });
}
function fmtDate(ts: number | null) {
  return ts ? new Date(ts).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}
function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="sec">
      <div className="sec-head">
        <h1>{title}</h1>
        {actions}
      </div>
      {children}
    </section>
  );
}
async function command(type: string, payload: unknown) {
  const r = await api<{ ok: boolean; error?: string }>('/api/control/command', {
    method: 'POST',
    json: { commandId: newCommandId(), type, payload },
  }).catch((e) => ({ ok: false, error: (e as Error).message }));
  if (!r.ok) throw new Error(r.error ?? 'Comando rifiutato');
  return r;
}

// ================================================================ Panoramica
export function Overview({ ctx }: { ctx: AdminCtx }) {
  const { data } = ctx;
  const current = ctx.games.find((g) => g.id === data.currentGameId);
  const origin = location.origin;
  const bases = [...new Set([...data.addresses, origin])];
  const [base, setBase] = useState(bases.find((b) => !b.includes('localhost') && !b.includes('127.0.0.1')) ?? bases[0]);
  const [label, setLabel] = useState('Telefono di Andrea');
  const [hours, setHours] = useState(12);
  const [pair, setPair] = useState<{ url: string; svg: string; expiresAt: number } | null>(null);
  const prizes = useGamePrizes(current?.id ?? null, ctx.version);
  const hasPrizes = prizes.some((p) => !p.reserve && p.quantity > 0);

  return (
    <Section title="Panoramica">
      <div className="cards2">
        <div className="box">
          <h2>Partita sul tabellone</h2>
          {current ? (
            <>
              <p className="big">{current.name}</p>
              <p>
                <span className={`pill ${current.status === 'active' ? '' : current.status === 'closed' ? 'grey' : 'orange'}`}>{statusText(current.status)}</span>{' '}
                {current.isTest && <span className="pill orange">PROVA</span>} · {current.draws} estratti · {current.awards} vincite · {current.activeCards} cartelle attive
              </p>
            </>
          ) : (
            <p>Nessuna partita selezionata. Creane una in “Serate e partite” oppure carica i dati dimostrativi.</p>
          )}
          <div className="row-actions">
            <a className="btn" href="/display" target="tombola-display" rel="noopener">
              Apri il tabellone
            </a>
            <a className="btn secondary" href="/control" target="tombola-control" rel="noopener">
              Telecomando di riserva (portatile)
            </a>
          </div>
          <p className="muted small">
            Proiettore come schermo esteso: apri il tabellone, trascina la finestra sul proiettore e premi “Avvia con audio e schermo intero”. Il CMS resta sullo schermo del portatile.
          </p>
        </div>

        <div className="box">
          <h2>Abbina il telefono del conduttore</h2>
          <div className="form-grid">
            <label>
              Indirizzo del portatile in rete
              <select value={base} onChange={(e) => setBase(e.target.value)}>
                {bases.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
            <label>
              Nome
              <input value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
            <label>
              Valido per (ore)
              <input type="number" min={1} max={72} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
            </label>
          </div>
          <button
            className="btn"
            onClick={() =>
              ctx.act(async () => {
                const p = await api<{ url: string; svg: string; expiresAt: number }>('/api/admin/pairings', { method: 'POST', json: { baseUrl: base, label, hours } });
                setPair(p);
              }, 'QR creato: inquadralo con il telefono')
            }
          >
            Crea QR di abbinamento
          </button>
          {pair && (
            <div className="pair">
              <div className="qr" dangerouslySetInnerHTML={{ __html: pair.svg }} />
              <div>
                <p>Inquadra con la fotocamera del telefono (stessa rete Wi-Fi). Il QR contiene una credenziale: non mostrarlo sul proiettore.</p>
                <p className="muted small">Scade: {fmtDate(pair.expiresAt)}</p>
                <button className="btn small ghost" onClick={() => setPair(null)}>
                  Nascondi QR
                </button>
              </div>
            </div>
          )}
          <table className="tbl compact">
            <tbody>
              {data.pairings.slice(0, 6).map((p) => (
                <tr key={p.id}>
                  <td>{p.label}</td>
                  <td className="muted small">{p.revoked ? 'revocato' : p.expiresAt < Date.now() ? 'scaduto' : `fino a ${fmtDate(p.expiresAt)}`}</td>
                  <td className="muted small">visto {fmtDate(p.lastSeenAt)}</td>
                  <td>
                    {!p.revoked && p.expiresAt > Date.now() && (
                      <button className="btn small ghost" onClick={() => ctx.act(() => api(`/api/admin/pairings/${p.id}`, { method: 'DELETE' }), 'Abbinamento revocato')}>
                        Revoca
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="box">
          <h2>Checklist prima della serata</h2>
          <ul className="checklist">
            <Check ok={!!current}>Partita selezionata per il tabellone</Check>
            <Check ok={!!current && current.activeCards > 0}>Cartelle distribuite attivate ({current?.activeCards ?? 0})</Check>
            <Check ok={hasPrizes}>Premi caricati con quantità</Check>
            <Check ok={data.pairings.some((p) => !p.revoked && p.expiresAt > Date.now())}>Telefono abbinato</Check>
            <Check ok={!!current && !current.isTest}>Partita reale (non di prova)</Check>
          </ul>
          <p className="muted small">Prova prima dell'evento: rete del ristorante o hotspot, audio del proiettore, lettura dal fondo della sala.</p>
        </div>

        <div className="box">
          <h2>Anteprima del tabellone</h2>
          <div className="preview">
            <iframe title="Anteprima del tabellone" src="/display?anteprima=1" />
          </div>
        </div>

        <div className="box">
          <h2>Dati dimostrativi</h2>
          <p>Crea una serata di prova separata, 1.000 cartelle demo (70 attive), premi di esempio e una partita di prova che si può azzerare all'infinito.</p>
          <button
            className="btn secondary"
            onClick={async () => {
              const ok = await ctx.confirm({ title: 'Creare i dati dimostrativi?', body: 'Sono marcati come PROVA e non finiscono nell’archivio dei vincitori reali.', confirmLabel: 'Crea' });
              if (ok !== null) await ctx.act(() => api('/api/admin/demo', { method: 'POST' }), 'Dati dimostrativi creati');
            }}
          >
            Crea dati dimostrativi
          </button>
        </div>
      </div>
    </Section>
  );
}
function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <li className={ok ? 'ok' : 'no'}>{ok ? '✔' : '•'} {children}</li>;
}

function useGamePrizes(gameId: number | null, version: number) {
  const [list, setList] = useState<PrizeView[]>([]);
  useEffect(() => {
    if (!gameId) return setList([]);
    api<PrizeView[]>(`/api/admin/games/${gameId}/prizes`).then(setList).catch(() => setList([]));
  }, [gameId, version]);
  return list;
}

// ========================================================= Serate e partite
export function EventsSection({ ctx, go }: { ctx: AdminCtx; go: (s: string) => void }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const events = ctx.data.events.filter((e) => showArchived || !e.archived);
  return (
    <Section
      title="Serate e partite"
      actions={
        <label className="chk">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Mostra archiviate
        </label>
      }
    >
      <form
        className="box inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          ctx.act(() => api('/api/admin/events', { method: 'POST', json: { name, date } }), 'Serata creata').then(() => {
            setName('');
            setDate('');
          });
        }}
      >
        <label>
          Nuova serata
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Cena di Natale 2026" required />
        </label>
        <label>
          Data
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button className="btn">Crea serata</button>
      </form>
      {events.map((ev) => (
        <div className="box" key={ev.id}>
          <div className="ev-head">
            <h2>
              {ev.name} {ev.isTest && <span className="pill orange">PROVA</span>} {ev.archived && <span className="pill grey">archiviata</span>}
            </h2>
            <span className="muted">{ev.date}</span>
            <div className="row-actions">
              <button
                className="btn small ghost"
                onClick={async () => {
                  const n = await ctx.confirm({ title: 'Rinomina serata', input: { label: 'Nuovo nome', minLength: 2 }, confirmLabel: 'Salva' });
                  if (n) ctx.act(() => api(`/api/admin/events/${ev.id}`, { method: 'PUT', json: { name: n } }), 'Serata rinominata');
                }}
              >
                Rinomina
              </button>
              <button className="btn small ghost" onClick={() => ctx.act(() => api(`/api/admin/events/${ev.id}/duplicate`, { method: 'POST' }), 'Serata duplicata (partite in preparazione, premi e cartelle copiati)')}>
                Duplica
              </button>
              <button className="btn small ghost" onClick={() => ctx.act(() => api(`/api/admin/events/${ev.id}`, { method: 'PUT', json: { archived: !ev.archived } }))}>
                {ev.archived ? 'Ripristina' : 'Archivia'}
              </button>
              <button className="btn small" onClick={() => ctx.act(() => api('/api/admin/games', { method: 'POST', json: { eventId: ev.id } }), 'Partita creata')}>
                + Partita
              </button>
            </div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Partita</th>
                <th>Stato</th>
                <th>Cartelle attive</th>
                <th>Estratti</th>
                <th>Vincite</th>
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {ev.games.map((g) => (
                <GameRow key={g.id} g={g} ctx={ctx} go={go} />
              ))}
              {!ev.games.length && (
                <tr>
                  <td colSpan={6} className="muted">
                    Nessuna partita.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
    </Section>
  );
}

function GameRow({ g, ctx, go }: { g: GameView; ctx: AdminCtx; go: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={g.current ? 'current' : ''}>
        <td>
          <b>{g.name}</b> {g.current && <span className="pill">sul tabellone</span>} {g.isTest && <span className="pill orange">prova</span>}
        </td>
        <td>{statusText(g.status)}</td>
        <td>{g.activeCards}</td>
        <td>{g.draws}</td>
        <td>{g.awards}</td>
        <td className="actions">
          {!g.current && g.status !== 'closed' && (
            <button className="btn small" onClick={() => ctx.act(() => api(`/api/admin/games/${g.id}/select`, { method: 'POST' }), 'Partita mostrata sul tabellone')}>
              Mostra sul tabellone
            </button>
          )}
          {g.status === 'setup' && (
            <button
              className="btn small"
              onClick={async () => {
                const ok = await ctx.confirm({
                  title: `Avviare “${g.name}”?`,
                  body: (
                    <>
                      <p>Le regole vengono congelate:</p>
                      <ul>{rulesSummary(g.rules).map((r) => <li key={r}>{r}</li>)}</ul>
                    </>
                  ),
                  confirmLabel: 'Avvia',
                });
                if (ok !== null) ctx.act(() => command('startGame', { gameId: g.id }), 'Partita avviata');
              }}
            >
              Avvia
            </button>
          )}
          <button className="btn small ghost" onClick={() => setOpen((o) => !o)}>
            Cartelle
          </button>
          <button
            className="btn small ghost"
            onClick={() => {
              ctx.setGameId(g.id);
              go('premi');
            }}
          >
            Premi
          </button>
          <button
            className="btn small ghost"
            onClick={() => {
              ctx.setGameId(g.id);
              go('regole');
            }}
          >
            Regole
          </button>
          <button
            className="btn small ghost"
            onClick={async () => {
              const n = await ctx.confirm({ title: 'Rinomina partita', input: { label: 'Nuovo nome', minLength: 2 }, confirmLabel: 'Salva' });
              if (n) ctx.act(() => api(`/api/admin/games/${g.id}`, { method: 'PUT', json: { name: n } }));
            }}
          >
            Rinomina
          </button>
          <button className="btn small ghost" onClick={() => ctx.act(() => api(`/api/admin/games/${g.id}/duplicate`, { method: 'POST', json: {} }), 'Partita duplicata')}>
            Duplica
          </button>
          {g.isTest && g.status !== 'setup' && (
            <button
              className="btn small ghost"
              onClick={async () => {
                const ok = await ctx.confirm({ title: 'Azzerare la partita di prova?', body: 'Estrazioni e vincite di prova vengono cancellate. Cartelle e premi restano.', danger: true, confirmLabel: 'Azzera' });
                if (ok !== null) ctx.act(() => api(`/api/admin/games/${g.id}/reset-test`, { method: 'POST' }), 'Prova azzerata');
              }}
            >
              Azzera prova
            </button>
          )}
          {(g.status === 'setup' || g.isTest) && (
            <button
              className="btn small ghost danger-text"
              onClick={async () => {
                const ok = await ctx.confirm({ title: `Eliminare “${g.name}”?`, body: 'Premi e attivazioni della partita vengono eliminati.', danger: true, confirmLabel: 'Elimina' });
                if (ok !== null) ctx.act(() => api(`/api/admin/games/${g.id}`, { method: 'DELETE' }), 'Partita eliminata');
              }}
            >
              Elimina
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6}>
            <Activation g={g} ctx={ctx} />
          </td>
        </tr>
      )}
    </>
  );
}

function Activation({ g, ctx }: { g: GameView; ctx: AdminCtx }) {
  const [spec, setSpec] = useState('');
  const [batch, setBatch] = useState<number | ''>('');
  const [summary, setSummary] = useState<{ batch: string; count: number; total: number }[]>([]);
  useEffect(() => {
    api<{ active: typeof summary }>(`/api/admin/games/${g.id}`).then((r) => setSummary(r.active)).catch(() => {});
  }, [g.id, ctx.version]);
  return (
    <div className="activation">
      <p>
        <b>Attiva solo le cartelle distribuite</b>: le altre non generano vincitori. Esempi: <code>B0001-B0070</code>, <code>B0001-B0035, C0010</code>.
      </p>
      <div className="inline-form">
        <input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="Codici o intervalli" />
        <button
          className="btn small"
          disabled={!spec.trim() || g.status === 'closed'}
          onClick={() =>
            ctx.act(async () => {
              const r = await api<{ added: number; errors: string[] }>(`/api/admin/games/${g.id}/activate`, { method: 'POST', json: { spec } });
              if (r.errors.length) ctx.toast(r.errors.join('; '), 'err');
              ctx.toast(`${r.added} cartelle attivate`);
              setSpec('');
            })
          }
        >
          Attiva
        </button>
        <select value={batch} onChange={(e) => setBatch(Number(e.target.value) || '')}>
          <option value="">…oppure un intero lotto</option>
          {ctx.data.batches.map((b) => (
            <option key={b.id} value={b.id}>
              Lotto {b.prefix} · {b.name} ({b.count})
            </option>
          ))}
        </select>
        <button className="btn small secondary" disabled={!batch || g.status === 'closed'} onClick={() => ctx.act(() => api(`/api/admin/games/${g.id}/activate`, { method: 'POST', json: { batchId: batch } }), 'Lotto attivato')}>
          Attiva lotto
        </button>
        {g.status === 'setup' && (
          <button
            className="btn small ghost"
            disabled={!spec.trim()}
            onClick={() => ctx.act(() => api(`/api/admin/games/${g.id}/deactivate`, { method: 'POST', json: { spec } }), 'Cartelle disattivate')}
          >
            Disattiva questi codici
          </button>
        )}
      </div>
      <p className="muted small">
        Attive: {summary.length ? summary.map((s) => `lotto ${s.batch}: ${s.count}/${s.total}`).join(' · ') : 'nessuna'}.
        {g.status !== 'setup' && ' A partita avviata si possono solo aggiungere cartelle (resta traccia nel registro).'}
      </p>
    </div>
  );
}

// ================================================================== Premi
const emptyPrize = { title: '', description: '', category: 'ambo' as Category, quantity: 1, reserve: false, visible: true, sortOrder: 0 };

export function PrizesSection({ ctx }: { ctx: AdminCtx }) {
  const game = ctx.games.find((g) => g.id === ctx.gameId);
  const prizes = useGamePrizes(ctx.gameId, ctx.version);
  const [edit, setEdit] = useState<(typeof emptyPrize & { id?: number }) | null>(null);
  const [bust, setBust] = useState(0);
  const totals = CATEGORIES.map((c) => ({
    c,
    total: prizes.filter((p) => p.category === c && !p.reserve).reduce((s, p) => s + p.quantity, 0),
    assigned: prizes.filter((p) => p.category === c && !p.reserve).reduce((s, p) => s + p.assigned, 0),
  }));
  const closed = game?.status === 'closed';
  return (
    <Section
      title="Gestione premi"
      actions={
        <>
          <GamePicker ctx={ctx} />
          <button className="btn" disabled={!game || closed} onClick={() => setEdit({ ...emptyPrize })}>
            + Aggiungi premio
          </button>
        </>
      }
    >
      <div className="box">
        <table className="tbl prizes-tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Immagine</th>
              <th>Descrizione</th>
              <th>Categoria</th>
              <th>Quantità</th>
              <th>Assegnati</th>
              <th>Azioni</th>
            </tr>
          </thead>
          <tbody>
            {prizes.map((p, i) => (
              <tr key={p.id} className={p.reserve ? 'reserve' : ''}>
                <td>{i + 1}</td>
                <td>
                  <label className="thumb" title="Carica immagine">
                    {p.hasImage ? <img src={`/api/admin/prizes/${p.id}/image?v=${bust}`} alt="" /> : <span>+ foto</span>}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) ctx.act(() => upload(`/api/admin/prizes/${p.id}/image`, f), 'Immagine caricata').then(() => setBust((b) => b + 1));
                      }}
                    />
                  </label>
                </td>
                <td>
                  <b>{p.title}</b>
                  {p.description && <div className="muted small">{p.description}</div>}
                  {!p.visible && <span className="pill grey">nascosto al pubblico</span>} {p.reserve && <span className="pill orange">riserva per pari merito</span>}
                </td>
                <td>{CATEGORY_LABEL[p.category]}</td>
                <td>{p.quantity}</td>
                <td>
                  {p.assigned} <span className="muted small">({p.revealed} rivelati)</span>
                </td>
                <td className="actions">
                  <button className="btn small ghost" disabled={closed} onClick={() => setEdit({ ...p })} aria-label="Modifica">
                    ✎
                  </button>
                  {p.hasImage && (
                    <button className="btn small ghost" disabled={closed} onClick={() => ctx.act(() => api(`/api/admin/prizes/${p.id}/image`, { method: 'DELETE' }))} aria-label="Togli immagine">
                      ⌫
                    </button>
                  )}
                  <button
                    className="btn small ghost danger-text"
                    disabled={closed || p.assigned > 0}
                    onClick={async () => {
                      const ok = await ctx.confirm({ title: `Eliminare “${p.title}”?`, danger: true, confirmLabel: 'Elimina' });
                      if (ok !== null) ctx.act(() => api(`/api/admin/prizes/${p.id}`, { method: 'DELETE' }), 'Premio eliminato');
                    }}
                    aria-label="Elimina"
                  >
                    🗑
                  </button>
                </td>
              </tr>
            ))}
            {!prizes.length && (
              <tr>
                <td colSpan={7} className="muted">
                  Nessun premio per questa partita.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="box">
        <h2>Numero di premi in palio (calcolato dalle quantità)</h2>
        <div className="totals">
          {totals.map((t) => (
            <div key={t.c} className={t.total ? '' : 'off'}>
              <span>{CATEGORY_PLURAL[t.c]}</span>
              <b>{t.total}</b>
              <small>{t.total ? `${t.assigned} assegnati` : 'non in palio'}</small>
            </div>
          ))}
        </div>
        <p className="muted small">
          Una categoria è in palio solo se ha premi. I premi di riserva non contano: servono solo per chi perde uno spareggio. Durante la partita le quantità non possono scendere sotto quelle già assegnate e ogni modifica resta nel registro.
        </p>
      </div>
      {edit && game && (
        <PrizeForm
          value={edit}
          onClose={() => setEdit(null)}
          onSave={(v) =>
            ctx
              .act(() => (v.id ? api(`/api/admin/prizes/${v.id}`, { method: 'PUT', json: { ...v, gameId: game.id } }) : api('/api/admin/prizes', { method: 'POST', json: { ...v, gameId: game.id } })), 'Premio salvato')
              .then((r) => r !== undefined && setEdit(null))
          }
        />
      )}
    </Section>
  );
}

function PrizeForm({ value, onClose, onSave }: { value: typeof emptyPrize & { id?: number }; onClose: () => void; onSave: (v: typeof emptyPrize & { id?: number }) => void }) {
  const [v, setV] = useState(value);
  return (
    <div className="modal-back">
      <form
        className="modal wide"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(v);
        }}
      >
        <h3>{v.id ? 'Modifica premio' : 'Nuovo premio'}</h3>
        <div className="form-grid">
          <label className="span2">
            Titolo
            <input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} required maxLength={80} />
          </label>
          <label className="span2">
            Descrizione (facoltativa)
            <input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} maxLength={400} />
          </label>
          <label>
            Categoria
            <select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as Category })}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantità
            <input type="number" min={0} max={500} value={v.quantity} onChange={(e) => setV({ ...v, quantity: Number(e.target.value) })} />
          </label>
          <label>
            Ordine
            <input type="number" value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: Number(e.target.value) })} />
          </label>
          <label className="chk">
            <input type="checkbox" checked={v.visible} onChange={(e) => setV({ ...v, visible: e.target.checked })} /> Mostra nome e foto sul tabellone alla rivelazione
          </label>
          <label className="chk span2">
            <input type="checkbox" checked={v.reserve} onChange={(e) => setV({ ...v, reserve: e.target.checked })} /> Premio di riserva (solo per i pari merito)
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Annulla
          </button>
          <button className="btn">Salva</button>
        </div>
      </form>
    </div>
  );
}

// ======================================================= Cartelle e stampa
interface CardRowView {
  id: number;
  code: string;
  matrix: CardMatrix;
  printCount: number;
}
interface Profile {
  bleedMm: number;
  safetyMm: number;
  cropMarks: boolean;
  back: boolean;
  qr: boolean;
  qrPrefix: string;
}

export function CardsSection({ ctx }: { ctx: AdminCtx }) {
  const [count, setCount] = useState(100);
  const [bname, setBname] = useState('');
  const [q, setQ] = useState('');
  const [cards, setCards] = useState<CardRowView[]>([]);
  const [filterBatch, setFilterBatch] = useState<number | ''>('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [format, setFormat] = useState<'a6' | 'a4'>('a6');
  const [printSpec, setPrintSpec] = useState('');
  const [printBatch, setPrintBatch] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Profile>('/api/admin/print-profile').then(setProfile).catch(() => {});
  }, []);
  useEffect(() => {
    const p = new URLSearchParams({ limit: '12' });
    if (q) p.set('q', q);
    if (filterBatch) p.set('batch', String(filterBatch));
    api<CardRowView[]>(`/api/admin/cards?${p}`).then(setCards).catch(() => setCards([]));
  }, [q, filterBatch, ctx.version]);

  const print = async (mark: boolean) => {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/print', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format, spec: printSpec, batchId: printBatch || undefined, mark, profile }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cartelle-${format}${mark ? '' : '-anteprima'}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      const re = Number(r.headers.get('x-reprints') ?? 0);
      ctx.toast(mark ? `PDF pronto e stampa registrata${re ? ` (${re} ristampe segnalate)` : ''}` : 'Anteprima PDF scaricata');
      if (mark) await ctx.reload();
    } catch (e) {
      ctx.toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Cartelle e stampa">
      <div className="cards2">
        <form
          className="box"
          onSubmit={(e) => {
            e.preventDefault();
            ctx.act(() => api<BatchInfo>('/api/admin/batches', { method: 'POST', json: { count, name: bname } }), 'Lotto generato');
          }}
        >
          <h2>Genera un lotto</h2>
          <div className="form-grid">
            <label>
              Quantità (max 9.999)
              <input type="number" min={1} max={9999} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </label>
            <label>
              Nome del lotto
              <input value={bname} onChange={(e) => setBname(e.target.value)} placeholder="Es. Natale 2026" />
            </label>
          </div>
          <button className="btn">Genera</button>
          <p className="muted small">Ogni lotto ha un prefisso nuovo (A, B, C…): codici mai riusati. Nessuna cartella ha gli stessi 15 numeri di un'altra; le righe identiche nel lotto vengono evitate quando possibile (i pari merito restano comunque possibili).</p>
        </form>

        <div className="box">
          <h2>Lotti</h2>
          <table className="tbl compact">
            <thead>
              <tr>
                <th>Lotto</th>
                <th>Cartelle</th>
                <th>Stampate</th>
                <th>Partite</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ctx.data.batches.map((b) => (
                <tr key={b.id}>
                  <td>
                    <b>{b.prefix}</b> {b.name} {b.isDemo && <span className="pill orange">demo</span>}
                  </td>
                  <td>{b.count}</td>
                  <td>{b.printed}</td>
                  <td>{b.activeInGames}</td>
                  <td className="actions">
                    <a className="btn small ghost" href={`/api/admin/cards/export?batch=${b.id}&format=csv`}>
                      CSV
                    </a>
                    <a className="btn small ghost" href={`/api/admin/cards/export?batch=${b.id}`}>
                      JSON
                    </a>
                    {b.printed === 0 && b.activeInGames === 0 && (
                      <button
                        className="btn small ghost danger-text"
                        onClick={async () => {
                          const ok = await ctx.confirm({ title: `Eliminare il lotto ${b.prefix}?`, body: 'Possibile solo perché nessuna cartella è stata stampata o attivata. Il prefisso non verrà riusato.', danger: true, confirmLabel: 'Elimina' });
                          if (ok !== null) ctx.act(() => api(`/api/admin/batches/${b.id}`, { method: 'DELETE' }), 'Lotto eliminato');
                        }}
                      >
                        Elimina
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row-actions">
            <a className="btn small secondary" href="/api/admin/cards/export?format=csv">
              Esporta tutto (CSV)
            </a>
            <a className="btn small secondary" href="/api/admin/cards/export">
              Esporta tutto (JSON)
            </a>
            <label className="btn small secondary">
              Importa JSON/CSV
              <input
                type="file"
                accept=".json,.csv,text/csv,application/json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const r = await ctx.act(() => api<{ imported: number; errors: string[] }>('/api/admin/cards/import', { method: 'POST', body: f, headers: { 'content-type': 'text/plain' } }));
                  if (r) ctx.toast(`${r.imported} cartelle importate${r.errors.length ? `, ${r.errors.length} scartate: ${r.errors.slice(0, 3).join('; ')}` : ''}`, r.errors.length ? 'err' : 'ok');
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          <p className="muted small">CSV con separatore “;”: codice;lotto;r1c1…r3c9 (27 caselle, riga per riga, 0 = vuota). Colonne: 1–9, 10–19, …, 80–90.</p>
        </div>
      </div>

      <div className="box">
        <h2>Stampa PDF</h2>
        <div className="form-grid four">
          <label>
            Formato
            <select value={format} onChange={(e) => setFormat(e.target.value as 'a6' | 'a4')}>
              <option value="a6">A6 orizzontale 148×105 mm, una per pagina</option>
              <option value="a4">A4 con 4 cartelle diverse</option>
            </select>
          </label>
          <label>
            Lotto intero
            <select value={printBatch} onChange={(e) => setPrintBatch(Number(e.target.value) || '')}>
              <option value="">— usa i codici —</option>
              {ctx.data.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.prefix} · {b.name} ({b.count})
                </option>
              ))}
            </select>
          </label>
          <label className="span2">
            …oppure codici / intervalli
            <input value={printSpec} onChange={(e) => setPrintSpec(e.target.value)} placeholder="Es. B0001-B0070" disabled={!!printBatch} />
          </label>
        </div>
        {profile && (
          <fieldset className="profile">
            <legend>Profilo di stampa (salvato)</legend>
            <div className="form-grid four">
              <label>
                Abbondanza (mm, solo A6)
                <input type="number" min={0} max={5} step={0.5} value={profile.bleedMm} onChange={(e) => setProfile({ ...profile, bleedMm: Number(e.target.value) })} />
              </label>
              <label>
                Margine di sicurezza (mm)
                <input type="number" min={3} max={10} step={0.5} value={profile.safetyMm} onChange={(e) => setProfile({ ...profile, safetyMm: Number(e.target.value) })} />
              </label>
              <label className="chk">
                <input type="checkbox" checked={profile.cropMarks} onChange={(e) => setProfile({ ...profile, cropMarks: e.target.checked })} /> Segni di taglio
              </label>
              <label className="chk">
                <input type="checkbox" checked={profile.back} onChange={(e) => setProfile({ ...profile, back: e.target.checked })} /> Retro (fronte/retro)
              </label>
              <label className="chk">
                <input type="checkbox" checked={profile.qr} onChange={(e) => setProfile({ ...profile, qr: e.target.checked })} /> QR del codice
              </label>
              <label className="span3">
                Prefisso del QR (facoltativo; vuoto = solo codice)
                <input value={profile.qrPrefix} onChange={(e) => setProfile({ ...profile, qrPrefix: e.target.value })} placeholder="Es. http://192.168.1.10:8080/control#verifica=" />
              </label>
            </div>
            <button type="button" className="btn small secondary" onClick={() => ctx.act(() => api('/api/admin/print-profile', { method: 'PUT', json: profile }), 'Profilo salvato')}>
              Salva profilo
            </button>
          </fieldset>
        )}
        <div className="row-actions">
          <button className="btn secondary" disabled={busy || (!printSpec.trim() && !printBatch)} onClick={() => print(false)}>
            Anteprima PDF
          </button>
          <button className="btn" disabled={busy || (!printSpec.trim() && !printBatch)} onClick={() => print(true)}>
            PDF per la tipografia (registra la stampa)
          </button>
        </div>
        <p className="muted small">
          {format === 'a6'
            ? 'A6: pagina 148 × 105 mm; con abbondanza o segni di taglio la pagina si allarga e la cartella resta centrata.'
            : 'A4 orizzontale: quarti da 148,5 × 105 mm con la cartella 148 × 105 mm centrata (0,25 mm bianchi ai lati), taglio a 148,5 e 105 mm, nessuna abbondanza fra cartelle vicine. Il retro è uguale per tutte, quindi non serve allineamento.'}{' '}
          Dopo la stampa i numeri sono immutabili; ristampare la stessa cartella la segnala come “RISTAMPA” (stesso codice e stessi numeri).
        </p>
      </div>

      <div className="box">
        <div className="sec-head">
          <h2>Archivio cartelle</h2>
          <div className="inline-form">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca codice, es. B42" />
            <select value={filterBatch} onChange={(e) => setFilterBatch(Number(e.target.value) || '')}>
              <option value="">Tutti i lotti</option>
              {ctx.data.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.prefix}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="card-list">
          {cards.map((c) => (
            <div key={c.id} className="card-prev">
              <div className="card-code">
                {c.code} {c.printCount > 0 && <span className="pill grey">stampata {c.printCount}×</span>}
              </div>
              <CardGrid matrix={c.matrix} compact />
            </div>
          ))}
          {!cards.length && <p className="muted">Nessuna cartella trovata.</p>}
        </div>
      </div>
    </Section>
  );
}

// ======================================================== Numeri e audio
interface NumberRow {
  n: number;
  traditional: string;
  busaText: string;
  hostJoke: string;
  image: string | null;
  audio: string | null;
  special: 'none' | 'clacson' | 'camioncino';
}
export function NumbersSection({ ctx }: { ctx: AdminCtx }) {
  const [rows, setRows] = useState<NumberRow[]>([]);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    api<NumberRow[]>('/api/admin/numbers').then(setRows).catch(() => {});
  }, [ctx.version]);
  const shown = useMemo(() => rows.filter((r) => !filter || String(r.n) === filter || `${r.traditional} ${r.busaText} ${r.hostJoke}`.toLowerCase().includes(filter.toLowerCase())), [rows, filter]);
  const save = (r: NumberRow) => ctx.act(() => api(`/api/admin/numbers/${r.n}`, { method: 'PUT', json: r }));
  return (
    <Section
      title="Numeri e audio"
      actions={
        <div className="row-actions">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Cerca numero o testo" />
          <a className="btn small secondary" href="/api/admin/numbers-export">
            Esporta JSON
          </a>
          <label className="btn small secondary">
            Importa JSON
            <input
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const json = JSON.parse(await f.text());
                const r = await ctx.act(() => api<{ imported: number }>('/api/admin/numbers-import', { method: 'POST', json }));
                if (r) ctx.toast(`${r.imported} numeri aggiornati`);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      }
    >
      <div className="box">
        <p className="muted small">
          <b>Tradizione</b>: significato tradizionale (es. della smorfia), da inserire solo con una fonte verificata — il progetto non ne include uno. <b>Testo Busa</b>: battuta inventata, mostrata sul tabellone. <b>Solo conduttore</b>: appare solo sul telecomando. Clacson e camioncino partono dopo l'estrazione del numero: usali con parsimonia per non rallentare il ritmo. Le probabilità di estrazione non cambiano mai.
        </p>
        <table className="tbl numbers">
          <thead>
            <tr>
              <th>N.</th>
              <th>Tradizione (con fonte)</th>
              <th>Testo Busa (pubblico)</th>
              <th>Battuta solo conduttore</th>
              <th>Evento</th>
              <th>Immagine</th>
              <th>Audio</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.n}>
                <td className="num">{r.n}</td>
                <td>
                  <input defaultValue={r.traditional} maxLength={120} onBlur={(e) => e.target.value !== r.traditional && save({ ...r, traditional: e.target.value })} />
                </td>
                <td>
                  <input defaultValue={r.busaText} maxLength={160} onBlur={(e) => e.target.value !== r.busaText && save({ ...r, busaText: e.target.value })} />
                </td>
                <td>
                  <input defaultValue={r.hostJoke} maxLength={300} onBlur={(e) => e.target.value !== r.hostJoke && save({ ...r, hostJoke: e.target.value })} />
                </td>
                <td>
                  <select value={r.special} onChange={(e) => save({ ...r, special: e.target.value as NumberRow['special'] })}>
                    <option value="none">—</option>
                    <option value="clacson">Clacson</option>
                    <option value="camioncino">Camioncino + clacson</option>
                  </select>
                </td>
                <td>
                  <MediaCell n={r.n} kind="image" path={r.image} ctx={ctx} accept="image/png,image/jpeg,image/webp,image/gif" />
                </td>
                <td>
                  <MediaCell n={r.n} kind="audio" path={r.audio} ctx={ctx} accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,.m4a" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
function MediaCell({ n, kind, path, ctx, accept }: { n: number; kind: 'image' | 'audio'; path: string | null; ctx: AdminCtx; accept: string }) {
  return (
    <span className="media">
      {path && kind === 'image' && <img src={`/media/${path}`} alt="" />}
      {path && kind === 'audio' && (
        <button className="btn small ghost" onClick={() => void new Audio(`/media/${path}`).play()} aria-label="Ascolta">
          ▶
        </button>
      )}
      <label className="btn small ghost">
        {path ? 'Cambia' : 'Carica'}
        <input
          type="file"
          accept={accept}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) ctx.act(() => upload(`/api/admin/numbers/${n}/${kind}`, f), 'File caricato');
          }}
        />
      </label>
      {path && (
        <button className="btn small ghost" onClick={() => ctx.act(() => api(`/api/admin/numbers/${n}/${kind}`, { method: 'DELETE' }))} aria-label="Rimuovi">
          ✕
        </button>
      )}
    </span>
  );
}

// ================================================================= Regole
export function RulesSection({ ctx }: { ctx: AdminCtx }) {
  const game = ctx.games.find((g) => g.id === ctx.gameId);
  const [r, setR] = useState<GameRules | null>(null);
  useEffect(() => setR(game ? { ...game.rules } : null), [game?.id, ctx.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const locked = !game || game.status !== 'setup';
  return (
    <Section title="Regole" actions={<GamePicker ctx={ctx} />}>
      {!game || !r ? (
        <p>Seleziona una partita.</p>
      ) : (
        <>
          {locked && <div className="notice">Regole congelate all'avvio della partita: si leggono ma non si cambiano. Per giocare con regole diverse, duplica la partita.</div>}
          <div className="box rules-box">
            <div className="rule">
              <div>
                <h3>Una vincita per riga</h3>
                <p>Dopo un premio confermato (ambo, terno, quaterna o cinquina) quella riga non ne riceve altri in questa partita. Le altre righe restano libere. Verifiche, dichiarazioni errate e spareggi persi non bloccano nulla; un annullamento sblocca la riga.</p>
              </div>
              <label className="switch-ctl">
                <input type="checkbox" disabled={locked} checked={r.oneWinPerRow} onChange={(e) => setR({ ...r, oneWinPerRow: e.target.checked })} />
                <span>{r.oneWinPerRow ? 'Attiva' : 'Disattiva'}</span>
              </label>
            </div>
            <div className="rule">
              <div>
                <h3>Tombola sempre valida</h3>
                <p>La cartella concorre sempre alla tombola con tutti i 15 numeri, anche con righe già premiate. Una cartella vince al massimo una tombola per partita; più tombole vanno a cartelle diverse.</p>
              </div>
              <span className="fixed">Sempre</span>
            </div>
            <div className="rule">
              <div>
                <h3>Categorie aperte insieme</h3>
                <p>Tutte le categorie con premi sono aperte contemporaneamente finché hanno premi. Nessuna sequenza ambo → terno: una combinazione non diventa invalida perché un'altra categoria è ancora aperta.</p>
              </div>
              <span className="fixed">Modalità unica</span>
            </div>
            <div className="rule">
              <div>
                <h3>Dichiarazione sull'ultimo numero</h3>
                <p>La combinazione vale se si completa con l'ultimo numero annunciato e viene dichiarata prima della successiva estrazione: per una riga il conteggio passa a 2/3/4/5, per la tombola a 15. Una cinquina non è un nuovo ambo. Nessun arretrato. Ogni verifica registra l'estrazione a cui si riferisce.</p>
              </div>
              <span className="fixed">Sempre</span>
            </div>
            <div className="rule">
              <div>
                <h3>Pari merito con premi insufficienti</h3>
                <p>Le dichiarazioni sullo stesso numero si confermano insieme, senza precedenza per chi è stato inserito o ha urlato per primo. Se i premi non bastano, la procedura annunciata decide; i premi di riserva possono andare a chi perde.</p>
              </div>
              <select disabled={locked} value={r.tieBreak} onChange={(e) => setR({ ...r, tieBreak: e.target.value as GameRules['tieBreak'] })}>
                <option value="manuale">Scelta del conduttore con motivo obbligatorio</option>
                <option value="sorteggio">Sorteggio digitale di spareggio (registrato)</option>
              </select>
            </div>
            <div className="rule">
              <div>
                <h3>Assegnazione del regalo</h3>
                <p>Alla conferma il regalo viene riservato; la rivelazione mostra quel regalo, senza nuovi sorteggi.</p>
              </div>
              <select disabled={locked} value={r.prizeAssign} onChange={(e) => setR({ ...r, prizeAssign: e.target.value as GameRules['prizeAssign'] })}>
                <option value="prestabilita">Prestabilita (ordine dell'elenco premi)</option>
                <option value="sorteggio">Sorteggio fra i premi disponibili della categoria</option>
                <option value="manuale">Scelta manuale del conduttore</option>
              </select>
            </div>
            <div className="rule">
              <div>
                <h3>Pausa minima fra due estrazioni</h3>
                <p>Copre l'animazione: durante questo tempo il server rifiuta nuove estrazioni (non si blocca se il display si disconnette).</p>
              </div>
              <label>
                <input type="number" disabled={locked} min={800} max={10000} step={100} value={r.minDrawIntervalMs} onChange={(e) => setR({ ...r, minDrawIntervalMs: Number(e.target.value) })} /> ms
              </label>
            </div>
            {!locked && (
              <button className="btn" onClick={() => ctx.act(() => api(`/api/admin/games/${game.id}`, { method: 'PUT', json: { rules: r } }), 'Regole salvate')}>
                Salva regole
              </button>
            )}
          </div>
          <div className="box">
            <h2>Regolamento mostrato al pubblico</h2>
            <ul>{rulesSummary(r).map((x) => <li key={x}>{x}</li>)}</ul>
            <p className="muted small">Tombolino e decina non sono previsti in questa versione.</p>
          </div>
        </>
      )}
    </Section>
  );
}

// ================================================================= Aspetto
interface Branding {
  title: string;
  colors: { primary: string; dark: string; light: string; accent: string };
  christmas: boolean;
  logoPath: string | null;
}
export function BrandingSection({ ctx }: { ctx: AdminCtx }) {
  const [b, setB] = useState<Branding | null>(null);
  useEffect(() => {
    api<Branding>('/api/admin/branding').then(setB).catch(() => {});
  }, [ctx.version]);
  if (!b) return null;
  const color = (k: keyof Branding['colors'], label: string) => (
    <label>
      {label}
      <span className="color">
        <input type="color" value={b.colors[k]} onChange={(e) => setB({ ...b, colors: { ...b.colors, [k]: e.target.value } })} />
        <code>{b.colors[k]}</code>
      </span>
    </label>
  );
  return (
    <Section title="Aspetto del tabellone">
      <div className="cards2">
        <div className="box">
          <div className="form-grid">
            <label className="span2">
              Titolo (fascia verticale e cartelle)
              <input value={b.title} maxLength={40} onChange={(e) => setB({ ...b, title: e.target.value })} />
            </label>
            {color('primary', 'Verde Busa (C70 M0 Y100 K0)')}
            {color('dark', 'Verde scuro')}
            {color('light', 'Verde chiaro')}
            {color('accent', 'Palline estratte')}
            <label className="chk span2">
              <input type="checkbox" checked={b.christmas} onChange={(e) => setB({ ...b, christmas: e.target.checked })} /> Decorazioni natalizie (agrifoglio, cappello, lucine)
            </label>
          </div>
          <div className="row-actions">
            <button className="btn" onClick={() => ctx.act(() => api('/api/admin/branding', { method: 'PUT', json: b }), 'Aspetto salvato')}>
              Salva
            </button>
            <button
              className="btn ghost"
              onClick={() => setB({ ...b, colors: { primary: '#52AE32', dark: '#1F6B2A', light: '#CDEBB8', accent: '#E8432C' } })}
            >
              Colori Busa predefiniti
            </button>
          </div>
        </div>
        <div className="box">
          <h2>Logo Busa</h2>
          {b.logoPath ? <img className="logo-prev" src={`/media/${b.logoPath}`} alt="Logo" /> : <p className="placeholder">Logo non caricato: carica il file originale (PNG trasparente). Finché manca, il tabellone usa solo il camioncino Busa.</p>}
          <div className="row-actions">
            <label className="btn secondary">
              Carica logo
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && ctx.act(() => upload('/api/admin/branding/logo', e.target.files![0]), 'Logo caricato')} />
            </label>
            {b.logoPath && (
              <button className="btn ghost" onClick={() => ctx.act(() => api('/api/admin/branding/logo', { method: 'DELETE' }))}>
                Rimuovi
              </button>
            )}
          </div>
          <div className="preview">
            <iframe title="Anteprima" src={`/display?anteprima=1&v=${ctx.version}`} />
          </div>
        </div>
      </div>
    </Section>
  );
}

// ======================================================= Registro e backup
interface AuditRow {
  id: number;
  ts: number;
  actor: string;
  gameId: number | null;
  action: string;
  detail: unknown;
}
export function LogSection({ ctx }: { ctx: AdminCtx }) {
  const [log, setLog] = useState<AuditRow[]>([]);
  const [winners, setWinners] = useState<Record<string, string | number | null>[]>([]);
  const [incTest, setIncTest] = useState(false);
  const [restore, setRestore] = useState<{ file: File; summary: Record<string, number>; created: string } | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  useEffect(() => {
    api<AuditRow[]>('/api/admin/audit?limit=200').then(setLog).catch(() => {});
    api<typeof winners>(`/api/admin/winners${incTest ? '?test=1' : ''}`).then(setWinners).catch(() => {});
  }, [ctx.version, incTest]);
  return (
    <Section title="Registro e backup">
      <div className="cards2">
        <div className="box">
          <h2>Backup</h2>
          <p>Il backup contiene database, immagini e audio. Il server ne salva uno automatico a ogni avvio e a ogni partita chiusa in <code>data/backups</code>.</p>
          <div className="row-actions">
            <a className="btn" href="/api/admin/backup">
              Scarica backup completo
            </a>
            <label className="btn secondary">
              Ripristina da backup…
              <input
                type="file"
                accept=".zip,application/zip"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const r = await ctx.act(() => api<{ summary: Record<string, number>; manifest: { createdAt: string } }>('/api/admin/restore', { method: 'POST', body: f, headers: { 'content-type': 'application/zip' } }));
                  if (r) setRestore({ file: f, summary: r.summary, created: r.manifest.createdAt });
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {restore && (
            <div className="notice">
              <p>
                Backup valido del {new Date(restore.created).toLocaleString('it-IT')}: {restore.summary.events} serate, {restore.summary.games} partite, {restore.summary.cards} cartelle, {restore.summary.awards} vincite.
              </p>
              <p>Prima di sovrascrivere viene salvata una copia di sicurezza dei dati attuali.</p>
              <button
                className="btn danger"
                onClick={async () => {
                  const r = await ctx.act(() => api<{ safetyBackup: string }>('/api/admin/restore?confirm=1', { method: 'POST', body: restore.file, headers: { 'content-type': 'application/zip' } }));
                  if (r) {
                    setRestore(null);
                    ctx.toast(`Ripristino completato. Copia di sicurezza: ${r.safetyBackup}`);
                  }
                }}
              >
                Sostituisci i dati attuali
              </button>{' '}
              <button className="btn ghost" onClick={() => setRestore(null)}>
                Annulla
              </button>
            </div>
          )}
        </div>
        <form
          className="box"
          onSubmit={(e) => {
            e.preventDefault();
            ctx.act(() => api('/api/admin/password', { method: 'PUT', json: pw }), 'Password cambiata: accedi di nuovo').then(() => setPw({ current: '', next: '' }));
          }}
        >
          <h2>Password del CMS</h2>
          <div className="form-grid">
            <label>
              Attuale
              <input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
            </label>
            <label>
              Nuova (min. 8 caratteri)
              <input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} minLength={8} autoComplete="new-password" />
            </label>
          </div>
          <button className="btn secondary">Cambia password</button>
        </form>
      </div>
      <div className="box">
        <div className="sec-head">
          <h2>Archivio vincitori e regali</h2>
          <div className="row-actions">
            <label className="chk">
              <input type="checkbox" checked={incTest} onChange={(e) => setIncTest(e.target.checked)} /> Includi prove
            </label>
            <a className="btn small secondary" href={`/api/admin/winners.csv${incTest ? '?test=1' : ''}`}>
              Esporta CSV
            </a>
          </div>
        </div>
        <table className="tbl compact">
          <thead>
            <tr>
              <th>Serata / partita</th>
              <th>Categoria</th>
              <th>Cartella</th>
              <th>Vincitore</th>
              <th>Premio</th>
              <th>Stato</th>
            </tr>
          </thead>
          <tbody>
            {winners.map((w) => (
              <tr key={String(w.id)} className={w.status === 'annulled' ? 'annulled' : ''}>
                <td>
                  {w.event} · {w.game} {w.test ? <span className="pill orange">prova</span> : null}
                </td>
                <td>{CATEGORY_LABEL[w.category as Category]}</td>
                <td>
                  {w.code}
                  {w.row ? ` r${w.row}` : ''}
                </td>
                <td>{w.winner_name ?? ''}</td>
                <td>
                  {w.prize}
                  {w.reserve ? ' (riserva)' : ''}
                </td>
                <td>{w.status === 'annulled' ? `annullata: ${w.annul_reason}` : w.status === 'revealed' ? 'rivelato' : 'nascosto'}</td>
              </tr>
            ))}
            {!winners.length && (
              <tr>
                <td colSpan={6} className="muted">
                  Ancora nessuna vincita.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="box">
        <h2>Registro delle operazioni</h2>
        <table className="tbl compact log">
          <tbody>
            {log.map((l) => (
              <tr key={l.id}>
                <td className="muted small">{fmtDate(l.ts)}</td>
                <td>{l.actor}</td>
                <td>
                  <b>{l.action.replace(/_/g, ' ')}</b>
                </td>
                <td className="muted small detail">{JSON.stringify(l.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
