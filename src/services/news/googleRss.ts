import type { Article, Lang } from '../../types.ts';

const EDITION: Record<Lang, string> = {
  ko: 'hl=ko&gl=KR&ceid=KR:ko',
  en: 'hl=en-US&gl=US&ceid=US:en',
};

export async function searchGoogle(query: string, lang: Lang, days: number, signal?: AbortSignal): Promise<Omit<Article, 'n'>[]> {
  const q = encodeURIComponent(`${query} when:${days}d`);
  const res = await fetch(`/proxy/gnews/rss/search?q=${q}&${EDITION[lang]}`, { signal });
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Google News returned invalid RSS');

  return [...doc.querySelectorAll('item')].map((item) => {
    const text = (sel: string) => item.querySelector(sel)?.textContent?.trim() ?? '';
    const source = text('source');
    let title = text('title');
    const suffix = ` - ${source}`;
    if (source && title.toLowerCase().endsWith(suffix.toLowerCase())) title = title.slice(0, -suffix.length);
    const date = new Date(text('pubDate'));
    return {
      title,
      snippet: '',
      url: text('link'),
      source,
      publishedAt: (Number.isNaN(date.getTime()) ? new Date() : date).toISOString(),
      provider: 'google' as const,
    };
  });
}
