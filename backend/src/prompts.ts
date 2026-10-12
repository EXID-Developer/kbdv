import type { Article, Lang } from '../../shared/types.ts';
import { TOPICS } from '../../shared/types.ts';
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

/** What a report is about: a place, or the request a user typed. */
export interface Focus {
  label: string;
  request?: string;
}

export function analyzeMessages(focus: Focus, articles: Article[], lang: Lang, contextTokens: number): ChatMessage[] {
  const place = focus.label;
  const system = [
    focus.request
      ? `You classify news articles for a news briefing on this request: "${focus.request}".`
      : `You classify news articles for a regional news briefing about "${place}".`,
    'For each article (id = the number in square brackets):',
    focus.request
      ? '- rel: true if it is substantially about the subject of the request; false if it only touches it in passing or is about something else.'
      : `- rel: true if it is substantially about ${place} or events located there; false if the name only appears in passing, means something else, or refers to a different place.`,
    '- sent: pos for good news for the place or subject (growth, investment, openings, successful events, awards, recovery); neg for bad news (accidents, crime, disasters, deaths, conflict, protests, decline, falling prices, layoffs, scandals); neu only when there is no clear good or bad side.',
    '- topic: politics (government, elections, policy, diplomacy), economy (business, jobs, real estate, prices, trade), society (education, welfare, transport, population, health), culture (arts, festivals, tourism, entertainment, food), tech (science, IT), environment (weather, climate, nature, animals), safety (accidents, crime, disasters, fires), sports, or other only if nothing else fits.',
    `- kw: 1 to 3 short key terms (people, organizations, projects or issues) in ${LANGUAGE[lang]}, never ${focus.request ? 'the search terms themselves' : 'the place name itself'}.`,
    'Return minified JSON on a single line without spaces or line breaks, like {"a":[{"id":1,"rel":true,"sent":"neu","topic":"society","kw":["..."]}]}.',
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: articleContext(articles, promptBudget(contextTokens, system, ANALYSIS_MAX_TOKENS)) },
  ];
}

export const REPORT_MAX_TOKENS = 1000;

export function reportMessages(focus: Focus, articles: Article[], lang: Lang, contextTokens: number): ChatMessage[] {
  const h = HEADINGS[lang];
  const place = focus.label;
  const system = [
    focus.request
      ? `You are a news analyst. A reader asked: "${focus.request}". Write a briefing that answers this request.`
      : `You are a regional news analyst writing a briefing about ${place} for a public display.`,
    'Use ONLY facts stated in the provided articles. Do not invent numbers, names, dates or events.',
    focus.request
      ? 'Ignore articles that do not relate to the request.'
      : `Ignore articles that are not actually about ${place} (e.g. the name appears in passing or means something else).`,
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
  const header = `${focus.request ? `Request: ${focus.request}` : `Place: ${place}`}\nToday: ${stamp(new Date().toISOString())}\n\nArticles:\n`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: header + articleContext(articles, promptBudget(contextTokens, system + header, REPORT_MAX_TOKENS)) },
  ];
}

export const QA_MAX_TOKENS = 700;

export function qaMessages(focus: Focus, question: string, articles: Article[], lang: Lang, contextTokens: number): ChatMessage[] {
  const system = [
    focus.request
      ? `You answer questions about recent news on this subject: "${focus.request}".`
      : `You answer questions about recent news in ${focus.label}, for a public display.`,
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

export const ISSUES_MAX_TOKENS = 500;

export const ISSUES_SCHEMA = {
  type: 'object',
  properties: {
    i: {
      type: 'array',
      items: {
        type: 'object',
        properties: { t: { type: 'string' }, ids: { type: 'array', items: { type: 'integer' } } },
        required: ['t', 'ids'],
        additionalProperties: false,
      },
    },
  },
  required: ['i'],
  additionalProperties: false,
};

export interface IssuesReply {
  i?: Array<{ t?: unknown; ids?: unknown }>;
}

export function issuesMessages(focus: Focus, articles: Article[], lang: Lang, contextTokens: number): ChatMessage[] {
  const system = [
    focus.request
      ? `You find the issues currently trending in news on this request: "${focus.request}".`
      : `You find the issues currently trending in news about ${focus.label}.`,
    'Group the articles into the 3 to 6 most newsworthy current issues: specific stories, events or debates covered by several articles or by very recent ones.',
    `- t: a short, specific issue name of 2 to 6 words in ${LANGUAGE[lang]}. Name the people, organizations or events involved. Never a generic category such as "economy" or "politics", and never only the place name.`,
    '- ids: the numbers in square brackets of the articles about that issue.',
    'Order the issues from most to least newsworthy. Leave out articles that fit no issue.',
    'Return minified JSON on a single line, like {"i":[{"t":"...","ids":[1,4]}]}.',
  ].join('\n');
  const header = `Today: ${stamp(new Date().toISOString())}\n\nArticles:\n`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: header + articleContext(articles, promptBudget(contextTokens, system + header, ISSUES_MAX_TOKENS)) },
  ];
}

export const QUERY_MAX_TOKENS = 120;

export const QUERY_SCHEMA = {
  type: 'object',
  properties: { ko: { type: 'string' }, en: { type: 'string' } },
  required: ['ko', 'en'],
  additionalProperties: false,
};

export interface QueryReply {
  ko?: unknown;
  en?: unknown;
}

/** Turns a free-text request into news search keywords. */
export function queryMessages(request: string): ChatMessage[] {
  const system = [
    'You turn a reader\'s request into keywords for a news search engine.',
    '- ko: 1 to 4 Korean keywords separated by spaces.',
    '- en: the same 1 to 4 keywords in English.',
    'Keep names of people, organizations, places and products. Drop filler words such as "news", "latest", "tell me" or "뉴스", "최신", "알려줘".',
    'Return minified JSON on a single line, like {"ko":"...","en":"..."}.',
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: request },
  ];
}

export function issueQuestion(label: string, lang: Lang): string {
  return lang === 'ko'
    ? `"${label}" 이슈를 정리해 주세요. 무슨 일이 있었고, 누가 관련되어 있으며, 왜 중요한가요?`
    : `Summarize the issue "${label}": what happened, who is involved, and why it matters.`;
}
