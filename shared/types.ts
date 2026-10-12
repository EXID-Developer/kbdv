// Types shared by the backend and the frontend. Keep this file free of runtime dependencies.

export type Lang = 'ko' | 'en';
export const LANGS: readonly Lang[] = ['ko', 'en'];
export type Scope = 'country' | 'region';
/** Place reports plus reports on a free-text topic the user typed. */
export type ReportScope = Scope | 'topic';

export interface CountryPlace {
  cc: string;
  en: string;
  ko: string;
  lon: number;
  lat: number;
  area: number;
}

export interface RegionPlace {
  key: string;
  country: number;
  en: string;
  ko: string;
  iso: string;
  /** Search term override for regions whose official name is rarely used in headlines. */
  q?: string;
  lon: number;
  lat: number;
  area: number;
}

export interface Places {
  countries: CountryPlace[];
  regions: RegionPlace[];
}

/** A selectable map feature; `id` indexes `Places.countries` or `Places.regions`. */
export interface Target {
  scope: Scope;
  id: number;
}

export type Provider = 'naver' | 'google';
export const PROVIDERS: readonly Provider[] = ['naver', 'google'];

export interface Article {
  /** 1-based citation number. */
  n: number;
  title: string;
  snippet: string;
  url: string;
  source: string;
  /** ISO timestamp. */
  publishedAt: string;
  provider: Provider;
}

export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const TOPICS = ['politics', 'economy', 'society', 'culture', 'tech', 'environment', 'safety', 'sports', 'other'] as const;
export type Topic = (typeof TOPICS)[number];

export interface ArticleAnalysis {
  relevant: boolean;
  sentiment: Sentiment;
  topic: Topic;
  keywords: string[];
}

/** A story currently trending in the collected articles; used as a filter in the panel. */
export interface Issue {
  label: string;
  /** Citation numbers of the articles about this issue. */
  ids: number[];
}

export interface Report {
  /** Cache key, see `reportKey`. */
  key: string;
  scope: ReportScope;
  /** Stable code: country `cc`, region `key`, or a hash of the topic prompt. */
  code: string;
  lang: Lang;
  /** The user's prompt, for topic reports. */
  title?: string;
  query: string;
  createdAt: number;
  model: string;
  /** Total hits reported by the news provider, when known. */
  totalHits: number | null;
  articles: Article[];
  analysis: Record<number, ArticleAnalysis>;
  issues: Issue[];
  markdown: string;
  /** Cached answers, keyed by `issueQaKey`. */
  qa: Record<string, string>;
}

export const reportKey = (scope: ReportScope, code: string, lang: Lang) => `report:${scope}:${code}:${lang}`;
export const issueQaKey = (label: string) => `issue:${label}`;

export interface ReportSummary {
  scope: Scope;
  code: string;
  lang: Lang;
  createdAt: number;
  /** (positive - negative) / relevant, in [-1, 1]. */
  score: number;
  relevant: number;
}

export type StageId = 'search' | 'report' | 'issues' | 'analyze';
export const STAGES: StageId[] = ['search', 'report', 'issues', 'analyze'];
export type StageStatus = 'pending' | 'running' | 'done' | 'error';

export interface Progress {
  stages: Record<StageId, StageStatus>;
  found?: number;
  analyzed?: number;
  relevant?: number;
  error?: string;
}

export const initialProgress = (): Progress => ({ stages: { search: 'pending', report: 'pending', issues: 'pending', analyze: 'pending' } });
export const doneProgress = (): Progress => ({ stages: { search: 'done', report: 'done', issues: 'done', analyze: 'done' } });

/** Events on the report stream (`GET /api/report`). */
export interface ReportEvents {
  /** Snapshot sent when joining a generation that is already running. */
  state: { progress: Progress; report: Partial<Report> };
  progress: Progress;
  partial: Partial<Report>;
  done: { report: Report; cached: boolean };
  /** `previous` is the last good report, shown instead of an empty panel. */
  error: { message: string; previous: Report | null };
}

/** Events on the answer stream (`POST /api/qa`). */
export interface AnswerEvents {
  text: string;
  done: string;
  error: { message: string };
}

/** Settings that live on the server and are shared by every connected screen. */
export interface ServerSettings {
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
  /** Sent as `reasoning_effort` unless empty. */
  llmReasoningEffort: string;
  llmTemperature: number;
  /** Server context window; prompts are trimmed to fit it. */
  llmContextTokens: number;
  naverClientId: string;
  naverClientSecret: string;
  newsProviders: Provider[];
  newsMax: number;
  newsDays: number;
  /** Cached reports older than this are regenerated when opened; 0 keeps them forever. */
  reportTtlMinutes: number;
}

export const SECRET_KEYS = ['llmApiKey', 'naverClientSecret'] as const satisfies ReadonlyArray<keyof ServerSettings>;
/** Stands in for a secret that is set on the server; sending it back leaves the secret unchanged. */
export const SECRET_MASK = '********';

export interface PrewarmState {
  running: boolean;
  done: number;
  total: number;
  current: string;
  failed: string[];
}

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  /** Change since the previous session, in percent. */
  changePct: number | null;
  currency: string;
  /** Time of the price, epoch ms. */
  time: number;
  /** Daily closes for about a month, oldest first. */
  series: number[];
}

export interface Market {
  cc: string;
  /** ISO 4217 code, or null when unknown. */
  currency: string | null;
  /** Units of `currency` per US dollar. */
  perUsd: number | null;
  /** Korean won per unit of `currency`. */
  krwPer: number | null;
  /** When the exchange rates were published, epoch ms. */
  ratesTime: number | null;
  /** About a month of USD/`currency` (USD/KRW for the US dollar). */
  fx: Quote | null;
  indices: Quote[];
}
