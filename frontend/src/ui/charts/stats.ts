import type { Article, ArticleAnalysis, Lang, Sentiment, Topic } from '../../../../shared/types.ts';
import { SENTIMENTS } from '../../../../shared/types.ts';
import type { Bucket } from './Timeline.tsx';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** Articles per hour when they span two days or less, otherwise per day. */
export function timeline(articles: Article[], lang: Lang, maxDays: number, now = Date.now()): Bucket[] {
  if (!articles.length) return [];
  const times = articles.map((a) => Date.parse(a.publishedAt)).filter(Number.isFinite);
  const oldest = Math.min(...times);
  const hourly = now - oldest <= 48 * HOUR;
  const start = new Date(hourly ? oldest : Math.max(oldest, now - maxDays * DAY));
  if (hourly) start.setMinutes(0, 0, 0);
  else start.setHours(0, 0, 0, 0);
  const step = hourly ? HOUR : DAY;
  const n = Math.max(1, Math.ceil((now - start.getTime()) / step));
  const buckets: Bucket[] = Array.from({ length: n }, (_, i) => {
    const d = new Date(start.getTime() + i * step);
    const md = `${d.getMonth() + 1}/${d.getDate()}`;
    const h = d.getHours();
    return hourly
      ? { label: lang === 'ko' ? `${h}시` : `${h}:00`, title: `${md} ${h}:00–${h + 1}:00`, count: 0 }
      : { label: md, title: d.toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US', { month: 'long', day: 'numeric', weekday: 'short' }), count: 0 };
  });
  for (const t of times) {
    const i = Math.floor((t - start.getTime()) / step);
    if (i >= 0 && i < n) buckets[i].count++;
  }
  return buckets;
}

export function sentimentCounts(relevant: ArticleAnalysis[]): Record<Sentiment, number> {
  const out = Object.fromEntries(SENTIMENTS.map((s) => [s, 0])) as Record<Sentiment, number>;
  for (const a of relevant) out[a.sentiment]++;
  return out;
}

export function rank<T extends string>(values: T[], limit: number): Array<{ key: T; count: number }> {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function topics(relevant: ArticleAnalysis[]) {
  return rank<Topic>(relevant.map((a) => a.topic), 9);
}

/** Most frequent keywords, merged case- and space-insensitively, excluding the place's own names. */
export function keywords(relevant: ArticleAnalysis[], exclude: string[], limit = 10) {
  const banned = new Set(exclude.map((s) => s.toLowerCase().replace(/\s+/g, '')));
  const display = new Map<string, string>();
  const keys: string[] = [];
  for (const a of relevant) {
    for (const k of new Set(a.keywords.map((k) => k.trim()).filter(Boolean))) {
      const norm = k.toLowerCase().replace(/\s+/g, '');
      if (banned.has(norm)) continue;
      if (!display.has(norm)) display.set(norm, k);
      keys.push(norm);
    }
  }
  return rank(keys, limit).map((r) => ({ key: display.get(r.key)!, count: r.count }));
}
