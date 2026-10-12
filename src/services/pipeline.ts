import type { Settings } from '../config.ts';
import type { PlaceInfo } from '../places.ts';
import { reportKey, SENTIMENTS, TOPICS, type Article, type ArticleAnalysis, type Lang, type Report } from '../types.ts';
import { chatJson, chatStream } from './llm.ts';
import { searchNews } from './news/index.ts';
import { ANALYSIS_MAX_TOKENS, ANALYSIS_SCHEMA, analyzeMessages, REPORT_MAX_TOKENS, reportMessages, type AnalysisReply } from './prompts.ts';

export type StageId = 'search' | 'report' | 'analyze';
export const STAGES: StageId[] = ['search', 'report', 'analyze'];
export type StageStatus = 'pending' | 'running' | 'done' | 'error';

export interface Progress {
  stages: Record<StageId, StageStatus>;
  found?: number;
  analyzed?: number;
  relevant?: number;
  error?: string;
}

export interface PipelineEvents {
  onProgress(p: Progress): void;
  onPartial(r: Partial<Report>): void;
}

const BATCH = 10;
const SENT = { pos: 'positive', neu: 'neutral', neg: 'negative' } as const;

export const initialProgress = (): Progress => ({ stages: { search: 'pending', report: 'pending', analyze: 'pending' } });

/** Place description given to the model, with both names so it can match articles in either language. */
export function placeLabel(info: PlaceInfo): string {
  const names = info.name.ko && info.name.ko !== info.name.en ? `${info.name.en} (${info.name.ko})` : info.name.en;
  return info.country ? `${names}, ${info.country.name.en}` : names;
}

type ReplyItem = NonNullable<AnalysisReply['a']>[number];

function normalize(raw: ReplyItem | undefined): ArticleAnalysis {
  const sentiment = SENT[raw?.sent as keyof typeof SENT];
  return {
    relevant: raw?.rel ?? true,
    sentiment: SENTIMENTS.includes(sentiment) ? sentiment : 'neutral',
    topic: TOPICS.includes(raw?.topic as never) ? (raw!.topic as ArticleAnalysis['topic']) : 'other',
    keywords: Array.isArray(raw?.kw) ? raw!.kw!.filter((k) => typeof k === 'string' && k.trim()).slice(0, 3) : [],
  };
}

async function analyze(
  place: string,
  articles: Article[],
  s: Settings,
  lang: Lang,
  onBatch: (analysis: Record<number, ArticleAnalysis>, done: number) => void,
  signal: AbortSignal,
): Promise<Record<number, ArticleAnalysis>> {
  const result: Record<number, ArticleAnalysis> = {};
  for (let i = 0; i < articles.length; i += BATCH) {
    const batch = articles.slice(i, i + BATCH);
    // Number articles 1..n within the batch; small models tend to restart numbering anyway.
    const local = batch.map((a, j) => ({ ...a, n: j + 1 }));
    const out = await chatJson<AnalysisReply>(s, analyzeMessages(place, local, lang, s.llmContextTokens), ANALYSIS_SCHEMA, {
      signal,
      maxTokens: ANALYSIS_MAX_TOKENS,
    });
    const items = out.a ?? [];
    const byId = new Map(items.map((a) => [a.id, a]));
    batch.forEach((a, j) => {
      result[a.n] = normalize(byId.get(j + 1) ?? (items.length === batch.length ? items[j] : undefined));
    });
    onBatch({ ...result }, Math.min(i + BATCH, articles.length));
  }
  return result;
}

const META_NOTE = /^\s*\*?\(.*(글자|자 수|요구|characters|words|instruction).*\)\*?\s*$/i;
const CITES_ONLY = /^\s*(\[\d+\]\s*)+$/;

/** Drops notes some models append about their own output, and trailing lines that only repeat citations. */
export function cleanReport(markdown: string): string {
  const lines = markdown.split('\n').filter((l) => !META_NOTE.test(l));
  while (lines.length && (!lines[lines.length - 1].trim() || CITES_ONLY.test(lines[lines.length - 1]))) lines.pop();
  return lines.join('\n').trim();
}

export async function generateReport(
  info: PlaceInfo,
  s: Settings,
  lang: Lang,
  events: PipelineEvents,
  signal: AbortSignal,
): Promise<Report> {
  const progress = initialProgress();
  const emit = (patch: Partial<Progress>) => {
    Object.assign(progress, patch);
    events.onProgress({ ...progress, stages: { ...progress.stages } });
  };
  let stage: StageId = 'search';
  const place = placeLabel(info);

  try {
    emit({ stages: { ...progress.stages, search: 'running' } });
    const news = await searchNews(info, s, lang, signal);
    events.onPartial({ articles: news.articles, query: news.query, totalHits: news.totalHits });
    emit({ stages: { ...progress.stages, search: 'done' }, found: news.articles.length });

    // The report streams first so viewers see text quickly; per-article analysis then feeds the charts.
    stage = 'report';
    emit({ stages: { ...progress.stages, report: 'running' } });
    let markdown = '';
    if (news.articles.length) {
      markdown = await chatStream(
        s,
        reportMessages(place, news.articles, lang, s.llmContextTokens),
        (text) => events.onPartial({ markdown: cleanReport(text) }),
        { signal, maxTokens: REPORT_MAX_TOKENS },
      );
    }
    emit({ stages: { ...progress.stages, report: 'done' } });

    stage = 'analyze';
    emit({ stages: { ...progress.stages, analyze: 'running' }, analyzed: 0 });
    const analysis = await analyze(
      place,
      news.articles,
      s,
      lang,
      (partial, done) => {
        events.onPartial({ analysis: partial });
        emit({ analyzed: done });
      },
      signal,
    );
    const relevant = news.articles.filter((a) => analysis[a.n]?.relevant);
    emit({ stages: { ...progress.stages, analyze: 'done' }, relevant: relevant.length });

    return {
      key: reportKey(info.scope, info.code, lang),
      scope: info.scope,
      code: info.code,
      lang,
      query: news.query,
      createdAt: Date.now(),
      model: s.llmModel,
      totalHits: news.totalHits,
      articles: news.articles,
      analysis,
      markdown: cleanReport(markdown),
      qa: {},
    };
  } catch (e) {
    if (!signal.aborted) emit({ stages: { ...progress.stages, [stage]: 'error' }, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
