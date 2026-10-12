export type Lang = 'ko' | 'en';
export type Scope = 'country' | 'region';

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

export interface Report {
  /** Cache key, see `reportKey`. */
  key: string;
  scope: Scope;
  /** Stable place code: country `cc` or region `key`. */
  code: string;
  lang: Lang;
  query: string;
  createdAt: number;
  model: string;
  /** Total hits reported by the news provider, when known. */
  totalHits: number | null;
  articles: Article[];
  analysis: Record<number, ArticleAnalysis>;
  markdown: string;
  qa: Record<string, string>;
}

export const reportKey = (scope: Scope, code: string, lang: Lang) => `report:${scope}:${code}:${lang}`;
