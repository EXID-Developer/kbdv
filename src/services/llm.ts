import type { Settings } from '../config.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type LlmSettings = Pick<Settings, 'llmBaseUrl' | 'llmModel' | 'llmApiKey' | 'llmReasoningEffort' | 'llmTemperature'>;

interface ChatOptions {
  maxTokens?: number;
  signal?: AbortSignal;
}

export class LlmError extends Error {}

/** Some reasoning models leak their thinking into `content` even with reasoning disabled; keep only the answer. */
export function stripThinking(text: string): string {
  const end = text.lastIndexOf('</think>');
  if (end >= 0) return text.slice(end + '</think>'.length).trimStart();
  const start = text.indexOf('<think>');
  return start >= 0 ? text.slice(0, start) : text;
}

function request(s: LlmSettings, messages: ChatMessage[], extra: Record<string, unknown>, signal?: AbortSignal) {
  const body: Record<string, unknown> = { model: s.llmModel, messages, temperature: s.llmTemperature, ...extra };
  if (s.llmReasoningEffort.trim()) body.reasoning_effort = s.llmReasoningEffort.trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (s.llmApiKey) headers.Authorization = `Bearer ${s.llmApiKey}`;
  return fetch(`${s.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
}

async function ensureOk(res: Response) {
  if (res.ok) return;
  const text = await res.text().catch(() => '');
  throw new LlmError(`LLM HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
}

export async function chat(s: LlmSettings, messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const res = await request(s, messages, { stream: false, max_tokens: opts.maxTokens }, opts.signal);
  await ensureOk(res);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return stripThinking(data.choices?.[0]?.message?.content ?? '');
}

/** Streams the reply, calling `onText` with the full text so far. Resolves with the final text. */
export async function chatStream(
  s: LlmSettings,
  messages: ChatMessage[],
  onText: (text: string) => void,
  opts: ChatOptions = {},
): Promise<string> {
  const res = await request(s, messages, { stream: true, max_tokens: opts.maxTokens }, opts.signal);
  await ensureOk(res);
  if (!res.body) throw new LlmError('LLM returned no body');

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return stripThinking(text);
      try {
        const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }>; error?: { message?: string } };
        if (chunk.error) throw new LlmError(chunk.error.message ?? 'LLM stream error');
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          onText(stripThinking(text));
        }
      } catch (e) {
        if (e instanceof LlmError) throw e;
      }
    }
  }
  return stripThinking(text);
}

/** Requests output conforming to a JSON schema and parses it. */
export async function chatJson<T>(
  s: LlmSettings,
  messages: ChatMessage[],
  schema: Record<string, unknown>,
  opts: ChatOptions = {},
): Promise<T> {
  const res = await request(
    s,
    messages,
    {
      stream: false,
      max_tokens: opts.maxTokens,
      response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } },
    },
    opts.signal,
  );
  await ensureOk(res);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = stripThinking(data.choices?.[0]?.message?.content ?? '');
  const json = content.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new LlmError(`LLM returned invalid JSON: ${content.slice(0, 200)}`);
  }
}
