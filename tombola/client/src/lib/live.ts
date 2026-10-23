// Connessione in tempo reale al server: snapshot completi e versionati, riconnessione con backoff.
import { useEffect, useRef, useState } from 'react';
import type { ControlState, PublicState } from '../../../shared/types';

export type ConnStatus = 'connecting' | 'online' | 'offline' | 'unauthorized';

export interface Live {
  pub: PublicState | null;
  ctl: ControlState | null;
  status: ConnStatus;
  /** serverTime - Date.now(), per confrontare i tempi degli effetti. */
  offset: number;
}

export function useLive(opts: { control?: boolean; token?: string | null } = {}): Live {
  const [state, setState] = useState<Live>({ pub: null, ctl: null, status: 'connecting', offset: 0 });
  const versions = useRef({ pub: -1, ctl: -1 });
  const { control, token } = opts;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    let timer: number | undefined;
    let watchdog: number | undefined;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws${control && !token ? '?role=control' : ''}`);
      setState((s) => ({ ...s, status: s.pub ? 'offline' : 'connecting' }));
      ws.onopen = () => {
        retry = 0;
        if (token) ws!.send(JSON.stringify({ type: 'auth', token }));
        // Senza notizie per 40 s (heartbeat del server ogni 15 s) si riconnette.
        const ping = () => {
          window.clearTimeout(watchdog);
          watchdog = window.setTimeout(() => ws?.close(), 40000);
        };
        ping();
        ws!.addEventListener('message', ping);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === 'public') {
          const st = msg.state as PublicState;
          if (st.version < versions.current.pub) return; // eventi ordinati: niente stati vecchi
          versions.current.pub = st.version;
          setState((s) => ({
            ...s,
            pub: st,
            offset: st.serverTime - Date.now(),
            // Il telecomando è "collegato" solo quando riceve il proprio stato riservato.
            status: control ? s.status : 'online',
          }));
        } else if (msg.type === 'control') {
          const st = msg.state as ControlState;
          if (st.version < versions.current.ctl) return;
          versions.current.ctl = st.version;
          setState((s) => ({ ...s, ctl: st, status: 'online' }));
        } else if (msg.type === 'auth' && !msg.ok) {
          setState((s) => ({ ...s, status: 'unauthorized' }));
        }
      };
      ws.onclose = (ev) => {
        window.clearTimeout(watchdog);
        if (stopped) return;
        if (ev.code === 4001) {
          setState((s) => ({ ...s, status: 'unauthorized' }));
          return;
        }
        setState((s) => ({ ...s, status: s.status === 'unauthorized' ? s.status : 'offline' }));
        retry++;
        const delay = Math.min(8000, 400 * 2 ** Math.min(retry, 5)) + Math.random() * 300;
        timer = window.setTimeout(connect, delay);
      };
    };
    connect();
    const onOnline = () => {
      if (ws && ws.readyState !== WebSocket.OPEN) {
        window.clearTimeout(timer);
        ws.close();
        connect();
      }
    };
    window.addEventListener('online', onOnline);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearTimeout(watchdog);
      window.removeEventListener('online', onOnline);
      ws?.close();
    };
  }, [control, token]);

  return state;
}

export function newCommandId(): string {
  // randomUUID esiste solo in contesti sicuri (HTTPS/localhost); in rete locale su HTTP si usa getRandomValues.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface CommandResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
  replayed?: boolean;
  drawWaitMs?: number;
}

/**
 * Invia un comando al server. In caso di rete persa ritenta con lo STESSO id (il server non lo ripete);
 * non accoda nulla da eseguire più tardi.
 */
export async function sendCommand<T = unknown>(type: string, payload: unknown, token: string | null): Promise<CommandResponse<T>> {
  const commandId = newCommandId();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = window.setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch('/api/control/command', { method: 'POST', headers, body: JSON.stringify({ commandId, type, payload }), signal: ctrl.signal, credentials: 'same-origin' });
      window.clearTimeout(t);
      if (r.status === 401) return { ok: false, error: 'Telefono non abbinato, scaduto o revocato' };
      return (await r.json()) as CommandResponse<T>;
    } catch (e) {
      lastErr = (e as Error).message;
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    }
  }
  return { ok: false, error: `Nessuna risposta dal server (${lastErr || 'rete'}): controlla il tabellone prima di riprovare` };
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown; token?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  let body = init.body;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const r = await fetch(path, { ...init, headers, body, credentials: 'same-origin' });
  const ct = r.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data as { error?: string })?.error ?? `Errore ${r.status}`);
  return data as T;
}

export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}
