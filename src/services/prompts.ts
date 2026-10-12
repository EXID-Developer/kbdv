import type { Article, Lang } from '../types.ts';
import { TOPICS } from '../types.ts';
import type { ChatMessage } from './llm.ts';

const LANGUAGE: Record<Lang, string> = { ko: 'Korean (한국어)', en: 'English' };

const HEADINGS: Record<Lang, { glance: string; issues: string; watch: string }> = {
  ko: { glance: '한눈에 보기', issues: '주요 이슈', watch: '전망과 관전 포인트' },
  en: { glance: 'At a glance', issues: 'Key issues', watch: 'What to watch' },
};

/** Conservative token estimate: Hangul costs about one token per character, Latin text about a quarter. */
export function estimateTokens(text: string): number {
  let hangul = 0;
  for (const ch of text) if (ch >= '가' && ch <= '힣') hangul++;
  return Math.ceil(hangul + (text.length - hangul) * 0.35);
}

function stamp(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function line(a: Article, snippetChars: number) {
  const snippet = snippetChars > 0 && a.snippet ? (a.snippet.length > snippetChars ? `${a.snippet.slice(0, snippetChars)}…` : a.snippet) : '';
  return `[${a.n}] ${stamp(a.publishedAt).slice(5)} | ${a.source} | ${a.title}${snippet ? ` — ${snippet}` : ''}`;
}

/**
 * Article list that fits the token budget: snippets are shortened first, then the oldest articles dropped.
 * Articles are expected newest first.
 */
export function articleContext(articles: Article[], budget: number): string {
  for (const chars of [160, 100, 60, 0]) {
    const lines = articles.map((a) => line(a, chars));
    if (estimateTokens(lines.join('\n')) + lines.length <= budget) return lines.join('\n');
  }
  const lines: string[] = [];
  let used = 0;
  for (const a of articles) {
    const l = line(a, 0);
    const cost = estimateTokens(l) + 1;
    if (used + cost > budget) break;
    lines.push(l);
    used += cost;
  }
  return lines.join('\n');
}

/** Prompt budget left after the system prompt and the reply. */
export const promptBudget = (contextTokens: number, system: string, maxTokens: number) =>
  Math.max(400, contextTokens - estimateTokens(system) - maxTokens - 150);

// Short keys keep the reply small; small local models spend most of their time emitting JSON syntax.
export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    a: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          rel: { type: 'boolean' },
          sent: { type: 'string', enum: ['pos', 'neu', 'neg'] },
          topic: { type: 'string', enum: [...TOPICS] },
          kw: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'rel', 'sent', 'topic', 'kw'],
        additionalProperties: false,
      },
    },
  },
  required: ['a'],
  additionalProperties: false,
};

export interface AnalysisReply {
  a?: Array<{ id?: number; rel?: boolean; sent?: string; topic?: string; kw?: string[] }>;
}

export const ANALYSIS_MAX_TOKENS = 900;

export function analyzeMessages(place: string, articles: Article[], lang: Lang, contextTokens: number): ChatMessage[] {
  const system = [
    `You classify news articles for a regional news briefing about "${place}".`,
    'For each article (id = the number in square brackets):',
    `- rel: true if it is substantially about ${place} or events located there; false if the name only appears in passing, means something else, or refers to a different place.`,
    '- sent: pos for good news for the place (growth, investment, openings, successful events, awards, recovery); neg for bad news (accidents, crime, disasters, deaths, conflict, protests, decline, falling prices, layoffs, scandals); neu only when there is no clear good or bad side.',
    '- topic: politics (government, elections, policy, diplomacy), economy (business, jobs, real estate, prices, trade), society (education, welfare, transport, population, health), culture (arts, festivals, tourism, entertainment, food), tech (science, IT), environment (weather, climate, nature, animals), safety (accidents, crime, disasters, fires), sports, or other only if nothing else fits.',
    `- kw: 1 to 3 short key terms (people, organizations, projects or issues) in ${LANGUAGE[lang]}, never the place name itself.`,
    'Return minified JSON on a single line without spaces or line breaks, like {"a":[{"id":1,"rel":true,"sent":"neu","topic":"society","kw":["..."]}]}.',
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: articleContext(articles, promptBudget(contextTokens, system, ANALYSIS_MAX_TOKENS)) },
  ];
}

export const REPORT_MAX_TOKENS = 1000;

export function reportMessages(place: string, articles: Article[], lang: Lang, contextTokens: number): ChatMessage[] {
  const h = HEADINGS[lang];
  const system = [
    `You are a regional news analyst writing a briefing about ${place} for a public display.`,
    'Use ONLY facts stated in the provided articles. Do not invent numbers, names, dates or events.',
    `Ignore articles that are not actually about ${place} (e.g. the name appears in passing or means something else).`,
    'After every factual sentence cite the supporting articles by number in square brackets, e.g. [3] or [2][5].',
    `Write in ${LANGUAGE[lang]}. Output Markdown with exactly these three sections and nothing else:`,
    `## ${h.glance}`,
    'One or two sentences on the overall situation.',
    `## ${h.issues}`,
    '3 to 5 bullet points. Each starts with a short **bold label**, then one or two sentences with citations.',
    `## ${h.watch}`,
    'Two or three sentences on what to watch next, grounded in the articles.',
    'Be concise: the report must be readable in about one minute.',
    'Output only the report. Never add notes about its length, format or these instructions.',
  ].join('\n');
  const header = `Place: ${place}\nToday: ${stamp(new Date().toISOString())}\n\nArticles:\n`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: header + articleContext(articles, promptBudget(contextTokens, system + header, REPORT_MAX_TOKENS)) },
  ];
}

export const QA_MAX_TOKENS = 700;

export function qaMessages(place: string, question: string, articles: Article[], lang: Lang, contextTokens: number): ChatMessage[] {
  const system = [
    `You answer questions about recent news in ${place}, for a public display.`,
    'Use ONLY the provided articles and cite them by number in square brackets, e.g. [4].',
    'If the articles do not answer the question, say so in one sentence.',
    `Answer in ${LANGUAGE[lang]} in 3 to 5 sentences of plain prose or a short bullet list. No headings.`,
  ].join('\n');
  const tail = `\n\nQuestion: ${question}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Articles:\n${articleContext(articles, promptBudget(contextTokens, system + tail, QA_MAX_TOKENS))}${tail}` },
  ];
}
