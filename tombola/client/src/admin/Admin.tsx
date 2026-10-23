// CMS: preparazione di serate, partite, cartelle, premi e contenuti. Accesso con password.
import { useCallback, useEffect, useState } from 'react';
import { api, useLive } from '../lib/live';
import { Lights, TRUCK_SRC } from '../lib/decor';
import { useConfirm, useToasts } from '../lib/ui';
import type { GameRules, GameStatus } from '../../../shared/types';
import { Overview, EventsSection, PrizesSection, CardsSection, NumbersSection, RulesSection, BrandingSection, LogSection } from './sections';
import './admin.css';

export interface GameView {
  id: number;
  eventId: number;
  name: string;
  status: GameStatus;
  isTest: boolean;
  rules: GameRules;
  rulesFrozen: boolean;
  activeCards: number;
  draws: number;
  awards: number;
  current: boolean;
  closeNote: string;
}
export interface EventView {
  id: number;
  name: string;
  date: string;
  isTest: boolean;
  archived: boolean;
  games: GameView[];
}
export interface BatchInfo {
  id: number;
  prefix: string;
  name: string;
  isDemo: boolean;
  count: number;
  printed: number;
  activeInGames: number;
  createdAt: number;
}
export interface PairingView {
  id: number;
  label: string;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
  lastSeenAt: number | null;
}
export interface OverviewData {
  events: EventView[];
  currentGameId: number | null;
  addresses: string[];
  batches: BatchInfo[];
  pairings: PairingView[];
}

export interface AdminCtx {
  data: OverviewData;
  reload: () => Promise<void>;
  toast: (t: string, k?: 'ok' | 'err') => void;
  confirm: ReturnType<typeof useConfirm>[0];
  /** Esegue un'azione mostrando l'errore come avviso. */
  act: <T>(fn: () => Promise<T>, okText?: string) => Promise<T | undefined>;
  games: GameView[];
  gameId: number | null;
  setGameId: (id: number) => void;
  version: number;
}

const SECTIONS = [
  ['panoramica', 'Panoramica'],
  ['serate', 'Serate e partite'],
  ['premi', 'Premi'],
  ['cartelle', 'Cartelle e stampa'],
  ['numeri', 'Numeri e audio'],
  ['regole', 'Regole'],
  ['aspetto', 'Aspetto'],
  ['registro', 'Registro e backup'],
] as const;
type SectionId = (typeof SECTIONS)[number][0];

export default function Admin() {
  const [auth, setAuth] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ admin: boolean }>('/api/auth/me').then((r) => setAuth(r.admin)).catch(() => setAuth(false));
  }, []);
  if (auth === null) return <div className="adm-login">Caricamento…</div>;
  if (!auth) return <Login onOk={() => setAuth(true)} />;
  return <Cms onLogout={() => setAuth(false)} />;
}

function Login({ onOk }: { onOk: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="adm-login">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr('');
          try {
            await api('/api/auth/login', { method: 'POST', json: { password: pw } });
            onOk();
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <img src={TRUCK_SRC} alt="" width={180} />
        <h1>Tombola Busa · CMS</h1>
        <label>
          Password
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="current-password" />
        </label>
        {err && <p className="err">{err}</p>}
        <button className="btn" type="submit">
          Entra
        </button>
        <p className="muted">La password è mostrata nel Terminale al primo avvio del server.</p>
      </form>
    </div>
  );
}

function Cms({ onLogout }: { onLogout: () => void }) {
  const [section, setSection] = useState<SectionId>(() => {
    const h = location.hash.slice(1) as SectionId;
    return SECTIONS.some(([id]) => id === h) ? h : 'panoramica';
  });
  const [data, setData] = useState<OverviewData | null>(null);
  const [gameId, setGameId] = useState<number | null>(null);
  const [toast, toasts] = useToasts();
  const [confirm, modal] = useConfirm();
  const live = useLive({ control: true });
  const version = live.pub?.version ?? 0;

  const reload = useCallback(async () => {
    try {
      const d = await api<OverviewData>('/api/admin/overview');
      setData(d);
      setGameId((g) => g ?? d.currentGameId ?? d.events.flatMap((e) => e.games)[0]?.id ?? null);
    } catch (e) {
      if ((e as Error).message.includes('Accesso')) onLogout();
    }
  }, [onLogout]);
  useEffect(() => {
    void reload();
  }, [reload, version]);
  useEffect(() => {
    history.replaceState(null, '', `#${section}`);
  }, [section]);

  const act = useCallback(
    async <T,>(fn: () => Promise<T>, okText?: string) => {
      try {
        const r = await fn();
        if (okText) toast(okText);
        await reload();
        return r;
      } catch (e) {
        toast((e as Error).message, 'err');
        return undefined;
      }
    },
    [reload, toast],
  );

  if (!data) return <div className="adm-login">Caricamento…</div>;
  const games = data.events.flatMap((e) => e.games.map((g) => ({ ...g, name: `${e.name} · ${g.name}` })));
  const ctx: AdminCtx = { data, reload, toast, confirm, act, games, gameId, setGameId, version };
  const christmas = live.pub?.branding.christmas ?? true;
  const current = games.find((g) => g.id === data.currentGameId);

  return (
    <div className="adm">
      {toasts}
      {modal}
      <header className="adm-head">
        <div className="brand">
          {live.pub?.branding.logoUrl ? <img src={live.pub.branding.logoUrl} alt="Logo" className="logo" /> : <img src={TRUCK_SRC} alt="" className="truck" />}
          <span>{live.pub?.branding.title ?? 'Tombola Busa'} · CMS</span>
        </div>
        {christmas && <Lights />}
        <div className="head-right">
          <span className="cur">
            Sul tabellone: <b>{current ? current.name : 'nessuna partita'}</b>
          </span>
          <button
            className="btn small ghost light"
            onClick={async () => {
              await api('/api/auth/logout', { method: 'POST' });
              onLogout();
            }}
          >
            Esci
          </button>
        </div>
      </header>
      <div className="adm-body">
        <nav className="adm-nav">
          {SECTIONS.map(([id, label]) => (
            <button key={id} className={section === id ? 'on' : ''} onClick={() => setSection(id)}>
              {label}
            </button>
          ))}
          <div className="nav-truck">
            <img src={TRUCK_SRC} alt="" />
          </div>
        </nav>
        <main className="adm-main">
          {section === 'panoramica' && <Overview ctx={ctx} />}
          {section === 'serate' && <EventsSection ctx={ctx} go={(s) => setSection(s as SectionId)} />}
          {section === 'premi' && <PrizesSection ctx={ctx} />}
          {section === 'cartelle' && <CardsSection ctx={ctx} />}
          {section === 'numeri' && <NumbersSection ctx={ctx} />}
          {section === 'regole' && <RulesSection ctx={ctx} />}
          {section === 'aspetto' && <BrandingSection ctx={ctx} />}
          {section === 'registro' && <LogSection ctx={ctx} />}
        </main>
      </div>
    </div>
  );
}

export function GamePicker({ ctx, filter }: { ctx: AdminCtx; filter?: (g: GameView) => boolean }) {
  const list = filter ? ctx.games.filter(filter) : ctx.games;
  return (
    <label className="picker">
      Partita
      <select value={ctx.gameId ?? ''} onChange={(e) => ctx.setGameId(Number(e.target.value))}>
        {!list.length && <option value="">Nessuna partita: creala in “Serate e partite”</option>}
        {list.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name} — {statusText(g.status)}
            {g.isTest ? ' (prova)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

export function statusText(s: GameStatus) {
  return s === 'setup' ? 'in preparazione' : s === 'active' ? 'in corso' : 'chiusa';
}
