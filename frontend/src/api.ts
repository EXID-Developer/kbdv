import { parseSse } from '../../shared/sse.ts';
import type {
  AnswerEvents,
  Lang,
  Market,
  Places,
  PrewarmState,
  ReportEvents,
  ReportSummary,
  ServerSettings,
} from '../../shared/types.ts';

/** Event name -> handler for a typed stream. */
export type Handlers<E> = { [K in keyof E]?: (data: E[K]) => void };

let placesLoading: Promise<Places> | null = null;

export function loadPlaces(): Promise<Places> {
  placesLoading ??= fetch('/map/places.json').then((r) => {
    if (!r.ok) throw new Error(`places.json: HTTP ${r.status}`);
    return r.json() as Promise<Places>;
  });
  return placesLoading;
}

const TOKEN_KEY = 'kbdv:adminToken';

export function getAdminToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setAdminToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable: the token has to be typed again after a reload.
  }
}

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? `HTTP ${res.status}`);
}

function headers(json: boolean, admin: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  const token = admin ? getAdminToken() : '';
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function request<T>(method: string, path: string, body?: unknown, admin = false): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: headers(body !== undefined, admin),
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

/** Reads a Server-Sent Events response until it ends. Unlike EventSource it never reconnects on its own. */
async function stream<E>(path: string, init: RequestInit, handlers: Handlers<E>, signal: AbortSignal) {
  const res = await fetch(path, { ...init, signal });
  if (!res.ok) throw await failure(res);
  if (!res.body) throw new Error('Empty response');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const { messages, rest } = parseSse(buffer + value);
    buffer = rest;
    for (const m of messages) (handlers as Record<string, ((d: unknown) => void) | undefined>)[m.event]?.(m.data);
  }
}

export type ReportParams = { scope: 'country' | 'region'; code: string } | { scope: 'topic'; prompt: string };

/** Streams a report: the cached copy, or a generation shared with every other screen asking for it. */
export function streamReport(params: ReportParams, lang: Lang, force: boolean, handlers: Handlers<ReportEvents>, signal: AbortSignal) {
  const q = new URLSearchParams({ ...params, lang, force: force ? '1' : '0' });
  return stream(`/api/report?${q}`, {}, handlers, signal);
}

export type AnswerBody = { key: string } & ({ issue: string } | { question: string });

export async function streamAnswer(body: AnswerBody, onText: (text: string) => void, signal: AbortSignal): Promise<string> {
  const out: { answer?: string; error?: string } = {};
  await stream<AnswerEvents>(
    '/api/qa',
    { method: 'POST', headers: headers(true, false), body: JSON.stringify(body) },
    { text: onText, done: (t) => (out.answer = t), error: (e) => (out.error = e.message) },
    signal,
  );
  if (out.error !== undefined) throw new Error(out.error);
  if (out.answer === undefined) throw new Error('The answer was cut off');
  return out.answer;
}

export interface ServerEvents {
  summaries: Record<string, ReportSummary>;
  summary: { key: string; summary: ReportSummary };
  prewarm: PrewarmState;
  settings: ServerSettings;
}

/** Live server-wide updates; EventSource reconnects by itself and the server resends a full snapshot. */
export function subscribeEvents(handlers: Handlers<ServerEvents>): () => void {
  const source = new EventSource('/api/events');
  for (const [event, handler] of Object.entries(handlers) as Array<[string, (d: unknown) => void]>) {
    source.addEventListener(event, (e) => handler(JSON.parse((e as MessageEvent<string>).data)));
  }
  return () => source.close();
}

export interface SettingsResponse {
  settings: ServerSettings;
  adminProtected?: boolean;
}

export const api = {
  settings: () => request<SettingsResponse>('GET', '/api/settings'),
  saveSettings: (patch: Partial<ServerSettings>) => request<SettingsResponse>('PUT', '/api/settings', patch, true),
  resetSettings: () => request<SettingsResponse>('DELETE', '/api/settings', undefined, true),
  testLlm: () => request<{ ok: true; seconds: number; reply: string } | { ok: false; error: string }>('POST', '/api/admin/llm-test', {}, true),
  async exportReports(): Promise<Blob> {
    const res = await fetch('/api/admin/export', { headers: headers(false, true) });
    if (!res.ok) throw await failure(res);
    return res.blob();
  },
  importReports: async (file: File) => (await request<{ count: number }>('POST', '/api/admin/import', await file.text(), true)).count,
  clearReports: () => request<{ ok: true }>('DELETE', '/api/admin/reports', undefined, true),
  startPrewarm: (skipExisting: boolean, lang: Lang) => request<PrewarmState>('POST', '/api/admin/prewarm', { skipExisting, lang }, true),
  stopPrewarm: () => request<{ ok: true }>('DELETE', '/api/admin/prewarm', undefined, true),
  market: (cc: string, signal?: AbortSignal) =>
    fetch(`/api/market/${encodeURIComponent(cc)}`, { signal }).then(async (r) => {
      if (!r.ok) throw await failure(r);
      return (await r.json()) as Market;
    }),
};
