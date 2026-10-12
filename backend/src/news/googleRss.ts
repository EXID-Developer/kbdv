import type { Article, Lang } from '../../../shared/types.ts';
import { decodeEntities } from './text.ts';

const EDITION: Record<Lang, string> = {
  ko: 'hl=ko&gl=KR&ceid=KR:ko',
  en: 'hl=en-US&gl=US&ceid=US:en',
};

/** Text of the first `<tag>` in `xml`, with CDATA unwrapped and entities decoded. */
function tagText(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  if (!m) return '';
  const raw = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(raw).trim();
}

// ponytail: regex RSS parsing is enough for Google News' flat, machine-generated feed; use an XML parser for other feeds.
export function parseRss(xml: string, now = new Date()): Omit<Article, 'n'>[] {
  if (!/<rss[\s>]/.test(xml)) throw new Error('Google News returned invalid RSS');
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const source = tagText(item, 'source');
    let title = tagText(item, 'title');
    const suffix = ` - ${source}`;
    if (source && title.toLowerCase().endsWith(suffix.toLowerCase())) title = title.slice(0, -suffix.length);
    const date = new Date(tagText(item, 'pubDate'));
    return {
      title,
      snippet: '',
      url: tagText(item, 'link'),
      source,
      publishedAt: (Number.isNaN(date.getTime()) ? now : date).toISOString(),
      provider: 'google' as const,
    };
  });
}

export async function searchGoogle(query: string, lang: Lang, days: number, signal?: AbortSignal): Promise<Omit<Article, 'n'>[]> {
  const q = encodeURIComponent(`${query} when:${days}d`);
  const res = await fetch(`https://news.google.com/rss/search?q=${q}&${EDITION[lang]}`, { signal });
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
  return parseRss(await res.text());
}
