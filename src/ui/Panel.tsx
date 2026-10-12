import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { timeAgo, useContentT, useT } from '../i18n/index.ts';
import { placeInfo, type PlaceInfo } from '../places.ts';
import { STAGES, type Progress, type StageId } from '../services/pipeline.ts';
import { answerPreset, presetLabel, QA_PRESETS, type QaPreset } from '../services/qa.ts';
import { useApp } from '../store/app.ts';
import type { Report } from '../types.ts';
import { Charts } from './charts/Charts.tsx';
import { Markdown } from './Markdown.tsx';
import { useReport } from './useReport.ts';
import ui from './ui.module.css';
import styles from './Panel.module.css';

function Steps({ progress }: { progress: Progress }) {
  const t = useT();
  const detail = (id: StageId) => {
    const st = progress.stages[id];
    if (st === 'error') return t('stage.error');
    if (st === 'pending') return t('stage.waiting');
    if (id === 'search') return st === 'done' ? t('stage.searchDone', { n: progress.found ?? 0 }) : '…';
    if (id === 'analyze') {
      if (st === 'done') return t('stage.analyzeDone', { n: progress.relevant ?? 0 });
      return t('stage.analyzeProgress', { done: progress.analyzed ?? 0, total: progress.found ?? 0 });
    }
    return st === 'done' ? t('stage.done') : t('stage.writing');
  };
  return (
    <ol className={styles.steps}>
      {STAGES.map((id, i) => {
        const st = progress.stages[id];
        return (
          <li key={id} className={styles[`step_${st}`]}>
            <span className={styles.stepIcon}>{st === 'running' ? <span className={ui.spinner} /> : st === 'done' ? '✓' : st === 'error' ? '!' : i + 1}</span>
            <span className={styles.stepText}>
              <b>{t(`stage.${id}`)}</b>
              <span>{detail(id)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={styles.section} data-section={id}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

function QA({ report, info, onUpdate }: { report: Report; info: PlaceInfo; onUpdate(r: Report): void }) {
  const t = useContentT();
  const [active, setActive] = useState<QaPreset | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const ask = async (preset: QaPreset) => {
    ctrl.current?.abort();
    setActive(preset);
    setError(null);
    const cached = report.qa[preset];
    if (cached) {
      setText(cached);
      setBusy(false);
      return;
    }
    const c = new AbortController();
    ctrl.current = c;
    setText('');
    setBusy(true);
    try {
      const answer = await answerPreset(report, info, preset, useApp.getState().settings, setText, c.signal);
      if (c.signal.aborted) return;
      onUpdate({ ...report, qa: { ...report.qa, [preset]: answer } });
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.chips}>
        {QA_PRESETS.map((p) => (
          <button key={p} className={`${styles.chip} ${active === p ? styles.chipActive : ''}`} onClick={() => void ask(p)}>
            {t(presetLabel(p))}
            {report.qa[p] && <span className={styles.chipDot} />}
          </button>
        ))}
      </div>
      {active && (
        <div className={styles.answer}>
          <div className={styles.question}>Q. {t(presetLabel(active))}</div>
          {error ? (
            <div className={ui.error}>{error}</div>
          ) : text ? (
            <Markdown text={text} articles={report.articles} streaming={busy} />
          ) : (
            <span className={ui.spinner} />
          )}
        </div>
      )}
    </>
  );
}

function Sources({ report }: { report: Partial<Report> }) {
  const t = useT();
  const open = useApp((s) => s.openCitation);
  const [showAll, setShowAll] = useState(false);
  const articles = report.articles ?? [];
  const analysis = report.analysis ?? {};
  const irrelevant = articles.filter((a) => analysis[a.n] && !analysis[a.n].relevant);
  const shown = showAll ? articles : articles.filter((a) => !analysis[a.n] || analysis[a.n].relevant);
  return (
    <>
      <ol className={styles.sources}>
        {shown.map((a) => (
          <li key={a.n} className={analysis[a.n] && !analysis[a.n].relevant ? styles.irrelevant : undefined}>
            <button onClick={() => open(a)}>
              <span className={styles.sourceNum}>{a.n}</span>
              <span className={styles.sourceBody}>
                <span className={styles.sourceTitle}>{a.title}</span>
                <span className={styles.sourceMeta}>
                  {a.source} · {timeAgo(t, Date.parse(a.publishedAt))}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {irrelevant.length > 0 && (
        <button className={`${ui.button} ${ui.small}`} onClick={() => setShowAll((v) => !v)} aria-pressed={showAll}>
          {t('sources.irrelevant', { n: irrelevant.length })}
        </button>
      )}
    </>
  );
}

function Nav() {
  const t = useT();
  const go = (id: string) => document.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <nav className={styles.nav}>
      {(['report', 'data', 'qa', 'sources'] as const).map((id) => (
        <button key={id} onClick={() => go(id)}>
          {t(`nav.${id}`)}
        </button>
      ))}
    </nav>
  );
}

function PanelContent({ info }: { info: PlaceInfo }) {
  const t = useT();
  const lang = useApp((s) => s.settings.contentLang);
  const uiLang = useApp((s) => s.settings.uiLang);
  const select = useApp((s) => s.select);
  const places = useApp((s) => s.places);
  const { status, progress, report, cached, error, refresh, updateReport } = useReport(info, lang);
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const articles = report?.articles ?? [];
  const relevantCount = articles.filter((a) => report?.analysis?.[a.n]?.relevant).length;
  const finished = status === 'done' || (status === 'error' && cached);
  const full = finished && report?.createdAt ? (report as Report) : null;

  return (
    <>
      <header className={styles.header}>
        <div className={styles.titleWrap}>
          <div className={ui.kicker}>
            {info.scope === 'country' ? t('panel.country') : `${t('panel.region')} · ${info.country!.name[uiLang]}`}
          </div>
          <h1 className={styles.title}>{info.name[uiLang]}</h1>
          <div className={styles.meta}>
            {full ? (
              <>
                {t('panel.articles', { n: articles.length })} · {t('panel.generatedAgo', { ago: timeAgo(t, full.createdAt) })} · {full.model}
              </>
            ) : (
              <>&nbsp;</>
            )}
          </div>
        </div>
        <button className={ui.close} onClick={() => select(null, 'none')} aria-label={t('panel.close')}>
          ×
        </button>
      </header>

      <div className={styles.actions}>
        <button className={`${ui.button} ${ui.small}`} onClick={refresh} disabled={status === 'running' || status === 'loading'}>
          ↻ {t('panel.refresh')}
        </button>
        {info.country && places && (
          <button className={`${ui.button} ${ui.small}`} onClick={() => select({ scope: 'country', id: info.country!.id }, 'frame')}>
            {t('panel.countryReport', { country: info.country.name[uiLang] })}
          </button>
        )}
      </div>

      {status !== 'loading' && !(finished && cached && !error) && <Steps progress={progress} />}
      <Nav />

      <div className={styles.body} data-panel-body>
        {error && (
          <div className={ui.error}>
            {error}{' '}
            <button className={`${ui.button} ${ui.small}`} onClick={refresh}>
              {t('panel.retry')}
            </button>
          </div>
        )}

        <Section id="report" title={t('nav.report')}>
          {report?.markdown ? (
            <Markdown text={report.markdown} articles={articles} streaming={status === 'running'} />
          ) : finished && !articles.length ? (
            <p className={ui.dim}>{t('panel.noArticles')}</p>
          ) : finished && !relevantCount ? (
            <p className={ui.dim}>{t('panel.noRelevant')}</p>
          ) : (
            <div className={styles.skeleton}>
              <span />
              <span />
              <span />
            </div>
          )}
        </Section>

        {articles.length > 0 && (
          <Section id="data" title={t('nav.data')}>
            <Charts report={report!} info={info} />
          </Section>
        )}

        <Section id="qa" title={t('qa.title')}>
          {full && relevantCount > 0 ? <QA key={full.key + full.createdAt} report={full} info={info} onUpdate={updateReport} /> : <p className={ui.hint}>{t('qa.locked')}</p>}
        </Section>

        {articles.length > 0 && (
          <Section id="sources" title={t('sources.title')}>
            <Sources report={report!} />
          </Section>
        )}
      </div>
    </>
  );
}

export function Panel() {
  const selection = useApp((s) => s.selection);
  const places = useApp((s) => s.places);
  const info = useMemo(() => (selection && places ? placeInfo(places, selection) : null), [selection, places]);
  if (!info) return null;
  return (
    <aside className={styles.panel} data-testid="panel">
      <PanelContent key={`${info.scope}:${info.code}`} info={info} />
    </aside>
  );
}
