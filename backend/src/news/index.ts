import type { Article, Lang, ServerSettings } from '../../../shared/types.ts';
import { searchGoogle } from './googleRss.ts';
import { searchNaver } from './naver.ts';
import { titleKey } from './text.ts';

export interface NewsResult {
  query: string;
  articles: Article[];
  totalHits: number | null;
}

type Raw = Omit<Article, 'n'>;

export const naverReady = (s: ServerSettings) => s.newsProviders.includes('naver') && !!s.naverClientId && !!s.naverClientSecret;

/**
 * Collects recent articles from every enabled provider. Relevance-ranked results come first so that
 * major stories are not crowded out by the last hour of minor ones, then the list is sorted newest first.
 */
export async function searchNews(queries: Record<Lang, string>, s: ServerSettings, lang: Lang, signal?: AbortSignal): Promise<NewsResult> {
  const since = Date.now() - s.newsDays * 86400_000;
  const recent = (list: Raw[]) => list.filter((a) => new Date(a.publishedAt).getTime() >= since);
  const query = queries[lang];

  const jobs: Array<Promise<{ list: Raw[]; total?: number }>> = [];
  if (naverReady(s)) {
    const creds = { clientId: s.naverClientId, clientSecret: s.naverClientSecret };
    jobs.push(searchNaver(queries.ko, 'sim', 100, creds, signal).then((r) => ({ list: recent(r.articles), total: r.total })));
    jobs.push(searchNaver(queries.ko, 'date', 50, creds, signal).then((r) => ({ list: recent(r.articles) })));
  }
  if (s.newsProviders.includes('google')) {
    jobs.push(searchGoogle(query, lang, s.newsDays, signal).then((list) => ({ list: recent(list) })));
  }
  if (!jobs.length) throw new Error('No news provider is configured (set Naver keys or enable Google).');

  const results = await Promise.allSettled(jobs);
  signal?.throwIfAborted();
  const ok = results.filter((r): r is PromiseFulfilledResult<{ list: Raw[]; total?: number }> => r.status === 'fulfilled');
  const reasons = results.map((r) => (r.status === 'rejected' ? String((r.reason as Error)?.message ?? r.reason) : '')).filter(Boolean);
  if (!ok.length) throw new Error(reasons.join(' / '));
  if (reasons.length) console.warn('News provider failed:', reasons.join(' / '));

  const seenTitles = new Set<string>();
  const seenUrls = new Set<string>();
  const picked: Raw[] = [];
  const lists = ok.map((r) => r.value.list);
  for (let i = 0; picked.length < s.newsMax && lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      const a = list[i];
      if (!a || picked.length >= s.newsMax) continue;
      const tk = titleKey(a.title);
      if (!tk || seenTitles.has(tk) || seenUrls.has(a.url)) continue;
      seenTitles.add(tk);
      seenUrls.add(a.url);
      picked.push(a);
    }
  }
  picked.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const totals = ok.map((r) => r.value.total).filter((t): t is number => typeof t === 'number');
  return {
    query,
    articles: picked.map((a, i) => ({ ...a, n: i + 1 })),
    totalHits: totals.length ? Math.max(...totals) : null,
  };
}
