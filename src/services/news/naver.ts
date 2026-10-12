import type { Article } from '../../types.ts';
import { decodeHtml, outletName } from './text.ts';

interface NaverItem {
  title: string;
  originallink: string;
  link: string;
  description: string;
  pubDate: string;
}

interface NaverResponse {
  total: number;
  items: NaverItem[];
  errorMessage?: string;
}

export interface NaverCredentials {
  clientId: string;
  clientSecret: string;
}

export async function searchNaver(
  query: string,
  sort: 'date' | 'sim',
  display: number,
  creds: NaverCredentials,
  signal?: AbortSignal,
): Promise<{ total: number; articles: Omit<Article, 'n'>[] }> {
  const params = new URLSearchParams({ query, display: String(display), sort });
  const res = await fetch(`/proxy/naverapihub/search/v1/news?${params}`, {
    headers: { 'X-NCP-APIGW-API-KEY-ID': creds.clientId, 'X-NCP-APIGW-API-KEY': creds.clientSecret },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as Partial<NaverResponse>;
  if (!res.ok) throw new Error(`Naver HTTP ${res.status}${data.errorMessage ? `: ${data.errorMessage}` : ''}`);
  return {
    total: data.total ?? 0,
    articles: (data.items ?? []).map((it) => {
      const url = it.originallink || it.link;
      return {
        title: decodeHtml(it.title),
        snippet: decodeHtml(it.description),
        url,
        source: outletName(url),
        publishedAt: new Date(it.pubDate).toISOString(),
        provider: 'naver' as const,
      };
    }),
  };
}
