import { useCallback, useMemo } from 'react';
import { useContentT } from '../../i18n/index.ts';
import { SENTIMENT_SWATCH } from '../../map/colors.ts';
import type { PlaceInfo } from '../../places.ts';
import { useApp } from '../../store/app.ts';
import { SENTIMENTS, type Report } from '../../types.ts';
import { keywords, rank, sentimentCounts, timeline, topics } from './stats.ts';
import { Timeline } from './Timeline.tsx';
import styles from './Charts.module.css';

const compact = (n: number, lang: string) => new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={styles.tile}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={`${styles.tileValue} ${tone ? styles[tone] : ''}`}>{value}</div>
    </div>
  );
}

function BarList({ items }: { items: Array<{ label: string; count: number }> }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className={styles.bars}>
      {items.map((it) => (
        <li key={it.label} className={styles.barRow}>
          <span className={styles.barLabel} title={it.label}>
            {it.label}
          </span>
          <span className={styles.barTrack}>
            <span className={styles.bar} style={{ width: `${(it.count / max) * 100}%` }} />
            <span className={styles.barValue}>{it.count}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function SentimentBar({ counts }: { counts: Record<(typeof SENTIMENTS)[number], number> }) {
  const t = useContentT();
  const total = SENTIMENTS.reduce((s, k) => s + counts[k], 0) || 1;
  return (
    <>
      <div className={styles.stack}>
        {SENTIMENTS.filter((k) => counts[k] > 0).map((k) => {
          const pct = Math.round((counts[k] / total) * 100);
          return (
            <span key={k} className={styles.segment} style={{ flexGrow: counts[k], background: SENTIMENT_SWATCH[k] }} title={`${t(`sentiment.${k}`)} ${pct}%`}>
              {pct >= 14 && <span className={styles.segmentLabel}>{pct}%</span>}
            </span>
          );
        })}
      </div>
      <ul className={styles.legend}>
        {SENTIMENTS.map((k) => (
          <li key={k}>
            <span className={styles.swatch} style={{ background: SENTIMENT_SWATCH[k] }} />
            {t(`sentiment.${k}`)} <b>{counts[k]}</b>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Charts({ report, info }: { report: Partial<Report>; info: PlaceInfo }) {
  const t = useContentT();
  const scale = useApp((s) => s.settings.scale);
  const days = useApp((s) => s.settings.newsDays);
  const lang = report.lang ?? 'ko';
  const articles = useMemo(() => report.articles ?? [], [report.articles]);
  const analysis = useMemo(() => report.analysis ?? {}, [report.analysis]);
  const analyzed = articles.length > 0 && articles.every((a) => analysis[a.n]);
  const relevantArticles = useMemo(() => articles.filter((a) => analysis[a.n]?.relevant), [articles, analysis]);
  const relevant = relevantArticles.map((a) => analysis[a.n]);
  const buckets = useMemo(
    () => timeline(analyzed && relevantArticles.length ? relevantArticles : articles, lang, days),
    [articles, relevantArticles, analyzed, lang, days],
  );
  const unit = useCallback((n: number) => `${t('charts.articles')} ${n}`, [t]);

  if (!articles.length) return null;
  const counts = sentimentCounts(relevant);
  const score = relevant.length ? Math.round(((counts.positive - counts.negative) / relevant.length) * 100) : 0;
  const outlets = rank(relevantArticles.map((a) => a.source).filter(Boolean), 8);

  return (
    <div className={styles.charts}>
      <div className={styles.tiles}>
        <Tile label={t('charts.kpiArticles')} value={String(articles.length)} />
        <Tile label={t('charts.kpiRelevant')} value={analyzed ? String(relevant.length) : '…'} />
        <Tile label={t('charts.kpiMood')} value={analyzed ? `${score > 0 ? '+' : ''}${score}` : '…'} tone={score > 10 ? 'good' : score < -10 ? 'bad' : undefined} />
        {report.totalHits ? (
          <Tile label={t('charts.kpiTotal')} value={compact(report.totalHits, lang)} />
        ) : (
          <Tile label={t('charts.kpiSources')} value={String(new Set(articles.map((a) => a.source)).size)} />
        )}
      </div>

      <figure className={`${styles.card} ${styles.full}`}>
        <figcaption>{t('charts.timeline')}</figcaption>
        <Timeline buckets={buckets} unit={unit} scale={scale} />
      </figure>

      {analyzed ? (
        relevant.length > 0 && (
          <>
            <figure className={`${styles.card} ${styles.full}`}>
              <figcaption>{t('charts.sentiment')}</figcaption>
              <SentimentBar counts={counts} />
            </figure>
            <figure className={styles.card}>
              <figcaption>{t('charts.keywords')}</figcaption>
              <BarList items={keywords(relevant, [info.name.ko, info.name.en, info.query.ko, info.query.en]).map((k) => ({ label: k.key, count: k.count }))} />
            </figure>
            <figure className={styles.card}>
              <figcaption>{t('charts.topics')}</figcaption>
              <BarList items={topics(relevant).map((x) => ({ label: t(`topic.${x.key}`), count: x.count }))} />
            </figure>
            <figure className={`${styles.card} ${styles.full}`}>
              <figcaption>{t('charts.sources')}</figcaption>
              <BarList items={outlets.map((o) => ({ label: o.key, count: o.count }))} />
            </figure>
          </>
        )
      ) : (
        <div className={styles.waiting}>{t('charts.waiting')}</div>
      )}
    </div>
  );
}
