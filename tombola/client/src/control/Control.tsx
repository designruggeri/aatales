// Telecomando del conduttore (smartphone, una mano). Ogni azione è validata dal server.
import { useEffect, useMemo, useState } from 'react';
import { api, sendCommand, useLive, useNow, type CommandResponse } from '../lib/live';
import { CardGrid, useConfirm, useToasts } from '../lib/ui';
import { CATEGORY_LABEL, CATEGORY_PLURAL, rulesSummary, type AwardView, type Category, type ClaimView, type ControlState, type TieGroupView, type VerifyReport } from '../../../shared/types';
import './control.css';

const TOKEN_KEY = 'tb_control_token';

function readToken(): { token: string | null; verify: string | null } {
  const hash = new URLSearchParams(location.hash.slice(1));
  const t = hash.get('t');
  const verify = hash.get('verifica');
  if (t) {
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* senza localStorage resta valido solo per questa scheda */
    }
  }
  if (t || verify) history.replaceState(null, '', location.pathname); // il token non resta nella barra degli indirizzi
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(TOKEN_KEY);
  } catch {
    stored = null;
  }
  return { token: t ?? stored, verify };
}

export default function Control() {
  const [{ token }] = useState(readToken);
  const [verify, setVerify] = useState<{ code: string; at: number } | null>(() => {
    const v = new URLSearchParams(location.hash.slice(1)).get('verifica');
    return v ? { code: v, at: Date.now() } : null;
  });
  // Il QR di una cartella può riaprire questa pagina già aperta: cambia solo l'hash.
  useEffect(() => {
    const onHash = () => {
      const { verify: v } = readToken();
      if (v) setVerify({ code: v, at: Date.now() });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ admin: boolean }>('/api/auth/me').then((r) => setIsAdmin(r.admin)).catch(() => setIsAdmin(false));
  }, []);
  if (isAdmin === null) return <div className="ctl-center">Caricamento…</div>;
  if (!token && !isAdmin) {
    return (
      <div className="ctl-center">
        <h2>Telefono non abbinato</h2>
        <p>Sul portatile apri il CMS → Panoramica → <b>Abbina il telefono</b> e inquadra il QR con la fotocamera.</p>
      </div>
    );
  }
  return <Remote token={isAdmin && !token ? null : token} initialVerify={verify} />;
}

function Remote({ token, initialVerify }: { token: string | null; initialVerify: { code: string; at: number } | null }) {
  const live = useLive({ control: true, token });
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, toasts] = useToasts();
  const [confirm, modal] = useConfirm();
  const now = useNow(200);
  const s = live.ctl;
  const online = live.status === 'online';

  const run = async <T,>(type: string, payload: unknown = {}, okText?: string): Promise<CommandResponse<T> | null> => {
    if (busy) return null; // niente doppi tocchi mentre un comando è in viaggio
    setBusy(type);
    try {
      const r = await sendCommand<T>(type, payload, token);
      if (!r.ok) toast(r.error ?? 'Comando rifiutato', 'err');
      else if (okText) toast(okText);
      return r;
    } finally {
      setBusy(null);
    }
  };

  if (live.status === 'unauthorized') {
    return (
      <div className="ctl-center">
        <h2>Abbinamento non valido</h2>
        <p>Il collegamento è scaduto o è stato revocato. Abbina di nuovo il telefono dal CMS sul portatile.</p>
        <button className="btn" onClick={() => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* */ } location.reload(); }}>
          Rimuovi abbinamento
        </button>
      </div>
    );
  }

  const game = s?.game;
  const draws = game?.draws ?? [];
  const waitMs = s ? Math.max(0, s.drawReadyAt - (now + live.offset)) : 0;
  const canDraw = !!s?.canDraw && waitMs <= 0 && online && !busy;

  return (
    <div className="ctl">
      {toasts}
      {modal}
      <header className="ctl-head">
        <span className={`conn ${online ? 'on' : 'off'}`}>{online ? 'Collegato' : live.status === 'connecting' ? 'Connessione…' : 'Non collegato'}</span>
        <span className="ctl-game">
          {game ? game.name : 'Nessuna partita'}
          {game?.isTest && <span className="pill orange">PROVA</span>}
        </span>
        <span className="ctl-count">{draws.length}/90</span>
      </header>
      {!online && <div className="ctl-offline">Comandi disattivati finché il collegamento non torna. Il tabellone mostra l'ultimo stato confermato.</div>}

      {!s ? (
        <div className="ctl-center">In attesa dello stato dal server…</div>
      ) : !game ? (
        <div className="ctl-card">Nessuna partita selezionata: preparala dal CMS sul portatile.</div>
      ) : (
        <>
          <LastNumber s={s} />

          {game.status === 'setup' && (
            <div className="ctl-card">
              <p>La partita non è ancora iniziata.</p>
              <button
                className="btn huge"
                disabled={!online || !!busy}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Avviare “${game.name}”?`,
                    body: (
                      <>
                        <p>All'avvio le regole vengono congelate:</p>
                        <ul>{rulesSummary(game.rules).map((r) => <li key={r}>{r}</li>)}</ul>
                      </>
                    ),
                    confirmLabel: 'Avvia partita',
                  });
                  if (ok !== null) run('startGame', { gameId: game.id }, 'Partita avviata');
                }}
              >
                Avvia partita
              </button>
            </div>
          )}

          {game.status === 'active' && (s.stageType === 'active' || s.stageType === 'waiting') && (
            <div className="ctl-main">
              <button className="btn huge draw" disabled={!canDraw} onClick={() => run('draw', { expectedCount: draws.length })}>
                {busy === 'draw' ? 'Estrazione…' : 'Estrai numero'}
              </button>
              <p className="hint">{!s.canDraw ? s.drawBlockReason : waitMs > 0 ? 'Animazione in corso…' : ' '}</p>
              <button className="btn huge warn" disabled={!online || !!busy || draws.length === 0} onClick={() => run('openCheck', {}, 'Estrazioni in pausa: verifica')}>
                Vincita dichiarata / Pausa
              </button>
            </div>
          )}

          {game.status === 'active' && s.stageType === 'check' && s.check && (
            <CheckPanel s={s} run={run} busy={busy} online={online} token={token} confirm={confirm} initialCode={initialVerify} />
          )}

          {(s.stageType === 'winner' || s.stageType === 'gift') && <AnnouncePanel s={s} run={run} busy={busy} online={online} />}

          {s.stageType === 'pause' && game.status === 'active' && (
            <div className="ctl-main">
              <p className="hint big">Gioco in pausa</p>
              <button className="btn huge" disabled={!online || !!busy} onClick={() => run('resume')}>
                Riprendi
              </button>
            </div>
          )}
          {s.stageType === 'final' && (
            <div className="ctl-main">
              <p className="hint big">Il tabellone mostra il riepilogo finale.</p>
              {game.status === 'active' && (
                <button className="btn huge" disabled={!online || !!busy} onClick={() => run('resume')}>
                  Torna al gioco
                </button>
              )}
            </div>
          )}

          {s.warnings.map((w) => (
            <div key={w} className="ctl-warn">{w}</div>
          ))}

          <AwardsList s={s} run={run} busy={busy} online={online} token={token} confirm={confirm} />

          <div className="ctl-card">
            <h3>Premi rimasti</h3>
            <div className="ctl-prizes">
              {s.categories.map((c) => (
                <span key={c.category} className={c.remaining ? '' : 'done'}>
                  {CATEGORY_PLURAL[c.category]} <b>{c.remaining}</b>/{c.total}
                </span>
              ))}
            </div>
            <h3>Ultime estrazioni</h3>
            <div className="ctl-draws">
              {draws.slice(-12).reverse().map((n, i) => (
                <span key={n} className={i === 0 ? 'first' : ''}>{n}</span>
              ))}
              {!draws.length && <span className="none">nessuna</span>}
            </div>
          </div>

          <MoreActions s={s} run={run} busy={busy} online={online} confirm={confirm} />
        </>
      )}
    </div>
  );
}

type Run = <T>(type: string, payload?: unknown, okText?: string) => Promise<CommandResponse<T> | null>;
type Confirm = ReturnType<typeof useConfirm>[0];

function LastNumber({ s }: { s: ControlState }) {
  const n = s.lastNumber;
  return (
    <div className="ctl-last">
      <div className="ctl-ball">{n ? n.number : '–'}</div>
      <div className="ctl-last-text">
        <span className="lbl">Ultimo numero</span>
        {n?.traditional && <span className="trad">{n.traditional}</span>}
        {n?.busaText && <span className="busa">{n.busaText}</span>}
        {n?.hostJoke && <span className="joke">🎤 {n.hostJoke}</span>}
      </div>
    </div>
  );
}

function CheckPanel(props: { s: ControlState; run: Run; busy: string | null; online: boolean; token: string | null; confirm: Confirm; initialCode: { code: string; at: number } | null }) {
  const { s, run, busy, online, token, confirm } = props;
  const check = s.check!;
  const [code, setCode] = useState(props.initialCode?.code ?? '');
  const [name, setName] = useState('');
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [err, setErr] = useState('');
  const [choices, setChoices] = useState<Record<number, number>>({});
  const disabled = !online || !!busy;
  const drawsAtCheck = useMemo(() => new Set(s.game!.draws.slice(0, check.drawIdx)), [s.game, check.drawIdx]);
  const last = check.drawIdx ? s.game!.draws[check.drawIdx - 1] : null;

  const verifyCode = async (c = code) => {
    setErr('');
    setReport(null);
    if (!c.trim()) return;
    try {
      setReport(await api<VerifyReport>(`/api/control/verify?code=${encodeURIComponent(c)}`, { token }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    if (!props.initialCode) return;
    setCode(props.initialCode.code.toUpperCase());
    void verifyCode(props.initialCode.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialCode?.at]);

  const declare = async (category: Category, row: number | null) => {
    if (!report) return;
    const r = await run<ClaimView>('addClaim', { code: report.code, category, row, winnerName: name });
    if (r?.ok) {
      const c = r.result!;
      if (c.status === 'valid') {
        setCode('');
        setName('');
        setReport(null);
      }
    }
  };

  const valid = check.claims.filter((c) => c.status === 'valid');
  const openTies = check.ties.filter((t) => t.status === 'open');
  const manual = s.game!.rules.prizeAssign === 'manuale';

  return (
    <div className="ctl-card check">
      <h3>Verifica · estrazione n. {check.drawIdx} (ultimo numero {last ?? '–'})</h3>
      <form
        className="verify-form"
        onSubmit={(e) => {
          e.preventDefault();
          void verifyCode();
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Codice cartella, es. B0042"
          autoCapitalize="characters"
          autoComplete="off"
          aria-label="Codice cartella"
        />
        <button className="btn" type="submit" disabled={!code.trim()}>
          Verifica cartella
        </button>
      </form>
      {err && <p className="err">{err}</p>}
      {report && (
        <div className="report">
          <p className={`msg ${report.active ? '' : 'bad'}`}>
            <b>{report.code}</b> · {report.message}
          </p>
          {report.matrix && <CardGrid matrix={report.matrix} drawn={drawsAtCheck} last={report.lastNumber} />}
          {report.found && report.active && (
            <>
              {(report.rows.some((r) => r.qualifies) || report.tombola.qualifies) && (
                <input className="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome del vincitore (facoltativo)" maxLength={60} />
              )}
              <ul className="rows">
                {report.rows.map((r) => (
                  <li key={r.row} className={r.qualifies ? 'ok' : ''}>
                    <span>
                      Riga {r.row}: {r.count}/5 · {r.reason}
                    </span>
                    {r.qualifies && (
                      <button className="btn small" disabled={disabled} onClick={() => declare(r.qualifies!, r.row)}>
                        Dichiara {CATEGORY_LABEL[r.qualifies]} · riga {r.row}
                      </button>
                    )}
                  </li>
                ))}
                <li className={report.tombola.qualifies ? 'ok' : ''}>
                  <span>
                    Tombola: {report.tombola.count}/15 · {report.tombola.reason}
                  </span>
                  {report.tombola.qualifies && (
                    <button className="btn small" disabled={disabled} onClick={() => declare('tombola', null)}>
                      Dichiara Tombola
                    </button>
                  )}
                </li>
              </ul>
            </>
          )}
        </div>
      )}

      {check.claims.length > 0 && (
        <>
          <h3>Dichiarazioni su questo numero</h3>
          <ul className="claims">
            {check.claims.map((c) => (
              <li key={c.id} className={c.status}>
                <span>
                  <b>{c.cardCode}</b> · {CATEGORY_LABEL[c.category]}
                  {c.row ? ` riga ${c.row}` : ''}
                  {c.winnerName ? ` · ${c.winnerName}` : ''}
                  <br />
                  <small>{statusLabel(c.status)} — {c.reason}</small>
                </span>
                {manual && c.status === 'valid' && (
                  <select value={choices[c.id] ?? ''} onChange={(e) => setChoices((x) => ({ ...x, [c.id]: Number(e.target.value) }))} aria-label="Premio da assegnare">
                    <option value="">Scegli premio…</option>
                    {s.prizeOptions.filter((p) => p.category === c.category).map((p) => (
                      <option key={p.prizeId} value={p.prizeId}>{p.title} ({p.remaining})</option>
                    ))}
                  </select>
                )}
                {(c.status === 'valid' || c.status === 'rejected') && (
                  <button className="btn small ghost" disabled={disabled} onClick={() => run('removeClaim', { claimId: c.id })} aria-label="Rimuovi dichiarazione">
                    ✕
                  </button>
                )}
                {c.status === 'tie_lost' && s.reserves.some((r) => r.category === c.category) && (
                  <ReservePicker claim={c} s={s} run={run} disabled={disabled} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {openTies.map((t) => (
        <TieResolver key={t.id} tie={t} s={s} run={run} disabled={disabled} confirm={confirm} />
      ))}

      <div className="check-actions">
        <button
          className="btn huge"
          disabled={disabled || !valid.length || openTies.length > 0}
          onClick={async () => {
            const ok = await confirm({
              title: `Confermare ${valid.length} vincit${valid.length === 1 ? 'a' : 'e'}?`,
              body: (
                <>
                  <ul>{valid.map((c) => <li key={c.id}>{c.cardCode} · {CATEGORY_LABEL[c.category]}{c.row ? ` riga ${c.row}` : ''}</li>)}</ul>
                  <p>Se i premi non bastano si apre il pari merito: nessuna precedenza a chi è stato inserito per primo.</p>
                </>
              ),
              confirmLabel: 'Conferma vincita',
            });
            if (ok !== null) await run('confirm', { prizeChoices: choices }, 'Vincita confermata: premio riservato');
          }}
        >
          Conferma vincita {valid.length ? `(${valid.length})` : ''}
        </button>
        <button
          className="btn secondary"
          disabled={disabled || openTies.length > 0}
          onClick={async () => {
            if (valid.length) {
              const ok = await confirm({ title: 'Riprendere senza confermare?', body: 'Le dichiarazioni valide non confermate verranno scartate (non bloccano nulla).', confirmLabel: 'Riprendi' });
              if (ok === null) return;
            }
            run('resume');
          }}
        >
          Riprendi
        </button>
      </div>
    </div>
  );
}

function statusLabel(s: ClaimView['status']): string {
  return { valid: 'Valida, da confermare', rejected: 'Respinta', tie: 'Pari merito', awarded: 'Premiata', tie_lost: 'Spareggio perso', dismissed: 'Scartata' }[s];
}

function ReservePicker({ claim, s, run, disabled }: { claim: ClaimView; s: ControlState; run: Run; disabled: boolean }) {
  const [pid, setPid] = useState<number | ''>('');
  return (
    <span className="reserve">
      <select value={pid} onChange={(e) => setPid(Number(e.target.value) || '')} aria-label="Premio di riserva">
        <option value="">Premio di riserva…</option>
        {s.reserves.filter((r) => r.category === claim.category).map((r) => (
          <option key={r.prizeId} value={r.prizeId}>{r.title} ({r.remaining})</option>
        ))}
      </select>
      <button className="btn small" disabled={disabled || !pid} onClick={() => run('assignReserve', { claimId: claim.id, prizeId: pid }, 'Premio di riserva assegnato')}>
        Assegna
      </button>
    </span>
  );
}

function TieResolver({ tie, s, run, disabled, confirm }: { tie: TieGroupView; s: ControlState; run: Run; disabled: boolean; confirm: Confirm }) {
  const claims = s.check!.claims.filter((c) => tie.claimIds.includes(c.id));
  const [sel, setSel] = useState<number[]>([]);
  const method = s.game!.rules.tieBreak;
  return (
    <div className="tie">
      <h3>
        Pari merito da risolvere: {claims.length} × {CATEGORY_LABEL[tie.category]}, {tie.available} premi{tie.available === 1 ? 'o' : ''}
      </h3>
      <p>Procedura annunciata: <b>{method === 'manuale' ? 'scelta del conduttore con motivo' : 'sorteggio digitale di spareggio'}</b>. I premi non sono ancora consumati.</p>
      {method === 'manuale' ? (
        <>
          {claims.map((c) => (
            <label key={c.id} className="tie-opt">
              <input
                type="checkbox"
                checked={sel.includes(c.id)}
                onChange={(e) => setSel((x) => (e.target.checked ? [...x, c.id] : x.filter((i) => i !== c.id)))}
              />
              {c.cardCode} {c.row ? `riga ${c.row}` : ''} {c.winnerName ?? ''}
            </label>
          ))}
          <button
            className="btn"
            disabled={disabled || sel.length !== tie.available}
            onClick={async () => {
              const reason = await confirm({
                title: 'Esito dello spareggio',
                body: `Vince: ${claims.filter((c) => sel.includes(c.id)).map((c) => c.cardCode).join(', ')}`,
                input: { label: 'Motivo / procedura usata (obbligatorio)', minLength: 5, placeholder: 'Es. spareggio con estrazione di un numero a voce' },
                confirmLabel: 'Registra esito',
              });
              if (reason) run('resolveTie', { tieId: tie.id, method: 'manuale', winners: sel, reason }, 'Spareggio registrato');
            }}
          >
            Registra vincitori ({sel.length}/{tie.available})
          </button>
        </>
      ) : (
        <button
          className="btn"
          disabled={disabled}
          onClick={async () => {
            const ok = await confirm({ title: 'Sorteggio di spareggio', body: `Il server sceglie ${tie.available} fra ${claims.length} cartelle. Il sorteggio è separato dalle 90 estrazioni e viene registrato.`, confirmLabel: 'Sorteggia' });
            if (ok !== null) run('resolveTie', { tieId: tie.id, method: 'sorteggio' }, 'Sorteggio eseguito');
          }}
        >
          Esegui sorteggio di spareggio
        </button>
      )}
    </div>
  );
}

function AnnouncePanel({ s, run, busy, online }: { s: ControlState; run: Run; busy: string | null; online: boolean }) {
  const a = s.awards.find((x) => x.id === s.stageAwardId);
  const disabled = !online || !!busy;
  return (
    <div className="ctl-card announce">
      <h3>{s.stageType === 'winner' ? 'Annuncio del vincitore' : 'Premio rivelato'}</h3>
      {a && (
        <p>
          <b>{CATEGORY_LABEL[a.category]}</b> · {a.cardCode}
          {a.row ? ` riga ${a.row}` : ''} {a.winnerName ? `· ${a.winnerName}` : ''}
          <br />
          Premio: <b>{a.prizeTitle}</b>
        </p>
      )}
      <div className="grid2">
        {s.stageType === 'winner' && a && (
          <>
            <button className="btn huge" disabled={disabled} onClick={() => run('reveal', { awardId: a.id })}>
              Rivela premio
            </button>
            <button className="btn secondary" disabled={disabled} onClick={() => run('reveal', { awardId: a.id, instant: true })}>
              Rivela senza animazione
            </button>
          </>
        )}
        {s.stageType === 'gift' && (
          <button className="btn secondary" disabled={disabled} onClick={() => run('zoom', { zoom: !s.zoom })}>
            {s.zoom ? 'Rimpicciolisci premio' : 'Ingrandisci premio'}
          </button>
        )}
        <button className="btn secondary" disabled={disabled} onClick={() => run('repeat')}>
          Ripeti annuncio
        </button>
        <button className="btn huge" disabled={disabled} onClick={() => run('resume')}>
          Riprendi
        </button>
      </div>
    </div>
  );
}

function AwardsList({ s, run, busy, online, token, confirm }: { s: ControlState; run: Run; busy: string | null; online: boolean; token: string | null; confirm: Confirm }) {
  const [showAll, setShowAll] = useState(false);
  const pending = s.awards.filter((a) => a.status === 'assigned');
  const list = showAll ? s.awards : pending;
  const disabled = !online || !!busy;
  if (!s.awards.length) return null;

  const annul = async (a: AwardView) => {
    let impact: string[] = [];
    try {
      impact = (await api<{ impact: string[] }>(`/api/control/annul-impact?awardId=${a.id}`, { token })).impact;
    } catch (e) {
      return;
    }
    const reason = await confirm({
      title: `Annullare la vincita di ${a.cardCode}?`,
      body: <ul>{impact.map((i) => <li key={i}>{i}</li>)}</ul>,
      input: { label: 'Motivo (resta nel registro)', minLength: 5 },
      danger: true,
      confirmLabel: 'Annulla vincita',
    });
    if (reason) run('annul', { awardId: a.id, reason }, 'Vincita annullata');
  };

  return (
    <div className="ctl-card">
      <h3>
        {showAll ? 'Registro vincite' : `Vincite da annunciare (${pending.length})`}
        <button className="link" onClick={() => setShowAll((x) => !x)}>
          {showAll ? 'solo da annunciare' : 'mostra tutte'}
        </button>
      </h3>
      <ul className="awards">
        {list.map((a) => (
          <li key={a.id} className={a.status}>
            <span>
              <b>{CATEGORY_LABEL[a.category]}</b> {a.cardCode}
              {a.row ? ` r${a.row}` : ''} {a.winnerName ? `· ${a.winnerName}` : ''}
              <br />
              <small>
                {a.prizeTitle}
                {a.reserve ? ' (riserva)' : ''} · {a.status === 'assigned' ? 'nascosto' : a.status === 'revealed' ? 'rivelato' : `annullato: ${a.annulReason}`}
              </small>
            </span>
            {a.status !== 'annulled' && (
              <span className="btns">
                {a.status === 'assigned' && (
                  <button className="btn small" disabled={disabled} onClick={() => run('announce', { awardId: a.id })}>
                    Annuncia
                  </button>
                )}
                {showAll && s.game?.status === 'active' && (
                  <button className="btn small ghost" disabled={disabled} onClick={() => annul(a)}>
                    Annulla
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
        {!list.length && <li className="none">Nessuna vincita da annunciare.</li>}
      </ul>
    </div>
  );
}

function MoreActions({ s, run, busy, online, confirm }: { s: ControlState; run: Run; busy: string | null; online: boolean; confirm: Confirm }) {
  const disabled = !online || !!busy;
  const game = s.game!;
  const [target, setTarget] = useState<number | ''>('');
  return (
    <details className="ctl-more">
      <summary>Altre azioni</summary>
      <div className="more-grid">
        <button className="btn secondary" disabled={disabled} onClick={() => run('display', { muted: !s.display.muted })}>
          {s.display.muted ? 'Riattiva audio display' : 'Silenzia display'}
        </button>
        <button className="btn secondary" disabled={disabled} onClick={() => run('display', { reducedMotion: !s.display.reducedMotion })}>
          {s.display.reducedMotion ? 'Animazioni normali' : 'Riduci animazioni'}
        </button>
        <button className="btn secondary" disabled={disabled} onClick={() => run('display', { voice: !s.display.voice })}>
          {s.display.voice ? 'Voce: attiva' : 'Voce: spenta'}
        </button>
        <button className="btn secondary" disabled={disabled} onClick={() => run('repeat')}>
          Ripeti annuncio
        </button>
        {game.status === 'active' && s.stageType === 'active' && (
          <button className="btn secondary" disabled={disabled} onClick={() => run('pause', { message: '' })}>
            Pausa generica
          </button>
        )}
        {game.status !== 'setup' && (
          <button className="btn secondary" disabled={disabled} onClick={() => run('final')}>
            Riepilogo finale
          </button>
        )}
      </div>
      <div className="danger-zone">
        {game.status === 'active' && (
          <button
            className="btn danger"
            disabled={disabled}
            onClick={async () => {
              const left = s.categories.filter((c) => c.remaining > 0);
              const note = await confirm({
                title: 'Chiudere la partita?',
                body: (
                  <>
                    <p>Le estrazioni finiscono e il tabellone mostra il riepilogo. Non si può riaprire.</p>
                    {left.length > 0 && <p><b>Premi non assegnati:</b> {left.map((c) => `${c.remaining} ${CATEGORY_PLURAL[c.category].toLowerCase()}`).join(', ')}.</p>}
                  </>
                ),
                input: { label: 'Nota di chiusura', minLength: 0, placeholder: 'Facoltativa' },
                danger: true,
                confirmLabel: 'Chiudi partita',
              });
              if (note !== null) run('close', { note }, 'Partita chiusa');
            }}
          >
            Chiudi partita
          </button>
        )}
        {s.otherGames.length > 0 && game.status !== 'active' && (
          <div className="switch">
            <select value={target} onChange={(e) => setTarget(Number(e.target.value) || '')} aria-label="Altra partita">
              <option value="">Passa a un'altra partita…</option>
              {s.otherGames.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.status === 'setup' ? 'da giocare' : g.status === 'active' ? 'in corso' : 'chiusa'})
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={disabled || !target}
              onClick={async () => {
                const g = s.otherGames.find((x) => x.id === target);
                const ok = await confirm({ title: `Passare a “${g?.name}”?`, body: 'Il tabellone mostrerà la nuova partita. Quella attuale resta in archivio.', confirmLabel: 'Cambia partita' });
                if (ok !== null) run('selectGame', { gameId: target }, 'Partita selezionata');
              }}
            >
              Vai
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
