import { useEffect, useState } from 'react';
import type { Market, Quote } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { useT } from '../i18n/index.ts';
import { useApp } from '../store/app.ts';
import ui from './ui.module.css';
import styles from './Market.module.css';

/** The server caches quotes for two minutes, so polling faster would not show anything newer. */
const POLL_MS = 120_000;

function Spark({ series, tone }: { series: number[]; tone: string }) {
  if (series.length < 2) return null;
  const min = Math.min(...series);
  const span = Math.max(...series) - min || 1;
  const points = series.map((v, i) => `${((i / (series.length - 1)) * 100).toFixed(2)},${(28 - ((v - min) / span) * 26).toFixed(2)}`).join(' ');
  return (
    <svg className={styles.spark} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke={tone} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function useFormat() {
  const lang = useApp((s) => s.settings.uiLang);
  const locale = lang === 'ko' ? 'ko-KR' : 'en-US';
  return {
    num: (v: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: Math.abs(v) >= 100 ? 2 : 4 }).format(v),
    pct: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`,
    time: (ms: number) => new Date(ms).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }),
    currencyName: (code: string) => {
      try {
        return new Intl.DisplayNames(locale, { type: 'currency' }).of(code) ?? code;
      } catch {
        return code;
      }
    },
  };
}

const trend = (q: Quote) => (q.changePct ?? 0) > 0 ? styles.up : (q.changePct ?? 0) < 0 ? styles.down : '';
const toneOf = (series: number[]) => (series.at(-1)! >= series[0] ? 'var(--up)' : 'var(--down)');

function IndexCard({ quote }: { quote: Quote }) {
  const f = useFormat();
  return (
    <figure className={styles.card}>
      <figcaption title={quote.symbol}>{quote.name}</figcaption>
      <div className={styles.value}>
        {f.num(quote.price)}
        {quote.changePct !== null && <span className={`${styles.change} ${trend(quote)}`}>{f.pct(quote.changePct)}</span>}
      </div>
      <Spark series={quote.series} tone={toneOf(quote.series)} />
      <div className={styles.meta}>
        {quote.currency} · {f.time(quote.time)}
      </div>
    </figure>
  );
}

function CurrencyCard({ m }: { m: Market }) {
  const t = useT();
  const f = useFormat();
  const code = m.currency!;
  return (
    <figure className={styles.card}>
      <figcaption>{t('market.currency')}</figcaption>
      <div className={styles.value}>
        {f.currencyName(code)} <span className={styles.code}>{code}</span>
      </div>
      <dl className={styles.rates}>
        {code !== 'KRW' && m.krwPer !== null && (
          <div>
            <dt>1 {code}</dt>
            <dd>{f.num(m.krwPer)} KRW</dd>
          </div>
        )}
        {code !== 'USD' && m.perUsd !== null && (
          <div>
            <dt>1 USD</dt>
            <dd>
              {f.num(m.perUsd)} {code}
            </dd>
          </div>
        )}
        {m.perUsd === null && <div className={ui.faint}>{t('market.noRate')}</div>}
      </dl>
      {m.fx && <Spark series={m.fx.series} tone="var(--blue)" />}
      <div className={styles.meta}>
        {m.fx ? `${m.fx.name} · ${t('market.month')}` : ''}
        {m.ratesTime !== null && ` · ${f.time(m.ratesTime)}`}
      </div>
    </figure>
  );
}

/** Currency, exchange rates and benchmark stock indices for a country, refreshed while the panel is open. */
export function MarketView({ cc }: { cc: string }) {
  const t = useT();
  const [market, setMarket] = useState<Market | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      api
        .market(cc, ctrl.signal)
        .then((m) => {
          setMarket(m);
          setError(null);
        })
        .catch((e: unknown) => !ctrl.signal.aborted && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [cc]);

  if (!market) return error ? <div className={ui.error}>{error}</div> : <span className={ui.spinner} />;
  return (
    <>
      <div className={styles.grid}>
        {market.currency ? <CurrencyCard m={market} /> : null}
        {market.indices.map((q) => (
          <IndexCard key={q.symbol} quote={q} />
        ))}
      </div>
      {!market.currency && <p className={ui.hint}>{t('market.noCurrency')}</p>}
      {!market.indices.length && <p className={ui.hint}>{t('market.noIndex')}</p>}
      <p className={ui.hint}>{t('market.source')}</p>
    </>
  );
}
