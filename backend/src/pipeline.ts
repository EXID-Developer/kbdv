import {
  initialProgress,
  reportKey,
  SENTIMENTS,
  TOPICS,
  type Article,
  type ArticleAnalysis,
  type Issue,
  type Lang,
  type Progress,
  type Report,
  type ReportScope,
  type ServerSettings,
  type StageId,
} from '../../shared/types.ts';
import { chatJson, chatStream } from './llm.ts';
import { searchNews } from './news/index.ts';
import {
  ANALYSIS_MAX_TOKENS,
  ANALYSIS_SCHEMA,
  analyzeMessages,
  ISSUES_MAX_TOKENS,
  ISSUES_SCHEMA,
  issuesMessages,
  QUERY_MAX_TOKENS,
  QUERY_SCHEMA,
  queryMessages,
  REPORT_MAX_TOKENS,
  reportMessages,
  type AnalysisReply,
  type Focus,
  type IssuesReply,
  type QueryReply,
} from './prompts.ts';

/** What a report is generated for. */
export interface Subject {
  scope: ReportScope;
  code: string;
  focus: Focus;
  /** Search terms per language; topics derive them from the request. */
  query?: Record<Lang, string>;
  /** The user's prompt, for topics. */
  title?: string;
}

export interface PipelineEvents {
  onProgress(p: Progress): void;
  onPartial(r: Partial<Report>): void;
}

const BATCH = 10;
const MAX_ISSUES = 6;
const MAX_ISSUE_LABEL = 40;
const SENT = { pos: 'positive', neu: 'neutral', neg: 'negative' } as const;

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

/** Keeps well-formed issues that cite existing articles, without duplicates. */
export function normalizeIssues(reply: IssuesReply, articleCount: number): Issue[] {
  const issues: Issue[] = [];
  const labels = new Set<string>();
  for (const raw of Array.isArray(reply.i) ? reply.i : []) {
    if (typeof raw?.t !== 'string' || !Array.isArray(raw.ids)) continue;
    const label = raw.t.replace(/\s+/g, ' ').trim().slice(0, MAX_ISSUE_LABEL);
    const ids = [...new Set(raw.ids.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= articleCount))].sort((a, b) => a - b);
    if (!label || !ids.length || labels.has(label.toLowerCase())) continue;
    labels.add(label.toLowerCase());
    issues.push({ label, ids });
    if (issues.length >= MAX_ISSUES) break;
  }
  return issues;
}

/** Search terms for a free-text request; falls back to the request itself if the model fails. */
export async function topicQuery(request: string, s: ServerSettings, signal: AbortSignal): Promise<Record<Lang, string>> {
  const fallback = request.slice(0, 100);
  try {
    const out = await chatJson<QueryReply>(s, queryMessages(request), QUERY_SCHEMA, { signal, maxTokens: QUERY_MAX_TOKENS });
    const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, 100) : fallback);
    return { ko: clean(out.ko), en: clean(out.en) };
  } catch (e) {
    if (signal.aborted) throw e;
    return { ko: fallback, en: fallback };
  }
}

async function analyze(
  focus: Focus,
  articles: Article[],
  s: ServerSettings,
  lang: Lang,
  onBatch: (analysis: Record<number, ArticleAnalysis>, done: number) => void,
  signal: AbortSignal,
): Promise<Record<number, ArticleAnalysis>> {
  const result: Record<number, ArticleAnalysis> = {};
  for (let i = 0; i < articles.length; i += BATCH) {
    const batch = articles.slice(i, i + BATCH);
    // Number articles 1..n within the batch; small models tend to restart numbering anyway.
    const local = batch.map((a, j) => ({ ...a, n: j + 1 }));
    const out = await chatJson<AnalysisReply>(s, analyzeMessages(focus, local, lang, s.llmContextTokens), ANALYSIS_SCHEMA, {
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

export async function generateReport(subject: Subject, s: ServerSettings, lang: Lang, events: PipelineEvents, signal: AbortSignal): Promise<Report> {
  const progress = initialProgress();
  const emit = (patch: Partial<Progress>) => {
    Object.assign(progress, patch);
    events.onProgress({ ...progress, stages: { ...progress.stages } });
  };
  let current: StageId = 'search';
  const stage = (id: StageId, status: Progress['stages'][StageId], extra: Partial<Progress> = {}) => {
    current = id;
    emit({ ...extra, stages: { ...progress.stages, [id]: status } });
  };
  const { focus } = subject;

  try {
    stage('search', 'running');
    const queries = subject.query ?? (await topicQuery(focus.request ?? focus.label, s, signal));
    const news = await searchNews(queries, s, lang, signal);
    events.onPartial({ articles: news.articles, query: news.query, totalHits: news.totalHits });
    stage('search', 'done', { found: news.articles.length });

    // The report streams first so viewers see text quickly; issues and per-article analysis follow.
    stage('report', 'running');
    let markdown = '';
    if (news.articles.length) {
      markdown = await chatStream(
        s,
        reportMessages(focus, news.articles, lang, s.llmContextTokens),
        (text) => events.onPartial({ markdown: cleanReport(text) }),
        { signal, maxTokens: REPORT_MAX_TOKENS },
      );
    }
    stage('report', 'done');

    stage('issues', 'running');
    let issues: Issue[] = [];
    if (news.articles.length) {
      try {
        const reply = await chatJson<IssuesReply>(s, issuesMessages(focus, news.articles, lang, s.llmContextTokens), ISSUES_SCHEMA, {
          signal,
          maxTokens: ISSUES_MAX_TOKENS,
        });
        issues = normalizeIssues(reply, news.articles.length);
      } catch (e) {
        // Issue filters are extras; the report stays useful without them.
        if (signal.aborted) throw e;
        console.warn(`Issue extraction failed for ${subject.code}:`, e instanceof Error ? e.message : e);
      }
      events.onPartial({ issues });
    }
    stage('issues', 'done');

    stage('analyze', 'running', { analyzed: 0 });
    const analysis = await analyze(
      focus,
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
    stage('analyze', 'done', { relevant: relevant.length });

    return {
      key: reportKey(subject.scope, subject.code, lang),
      scope: subject.scope,
      code: subject.code,
      lang,
      ...(subject.title ? { title: subject.title } : {}),
      query: news.query,
      createdAt: Date.now(),
      model: s.llmModel,
      totalHits: news.totalHits,
      articles: news.articles,
      analysis,
      issues,
      markdown: cleanReport(markdown),
      qa: {},
    };
  } catch (e) {
    if (!signal.aborted) stage(current, 'error', { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
