import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { placeInfo, type PlaceInfo } from '../../../shared/places.ts';
import { issueQaKey, STAGES, type Article, type ArticleAnalysis, type Issue, type Progress, type Report, type StageId } from '../../../shared/types.ts';
import { streamAnswer, type AnswerBody, type ReportParams } from '../api.ts';
import { timeAgo, useT } from '../i18n/index.ts';
import { useApp } from '../store/app.ts';
import { Charts } from './charts/Charts.tsx';
import { Markdown } from './Markdown.tsx';
import { MarketView } from './Market.tsx';
import { useReport } from './useReport.ts';
import ui from './ui.module.css';
import styles from './Panel.module.css';

const MAX_QUESTION = 300;
/** Issues whose newest article is younger than this get a "new" badge. */
const FRESH_MS = 6 * 3600_000;

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
    <section className={styles.section} data-section={id} aria-label={title}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

/** One streamed answer at a time; starting another cancels the previous one. */
function useAnswer() {
  const [state, setState] = useState<{ text: string; busy: boolean; error: string | null }>({ text: '', busy: false, error: null });
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(async (body: AnswerBody, cached?: string): Promise<string | null> => {
    ctrl.current?.abort();
    if (cached) {
      setState({ text: cached, busy: false, error: null });
      return null;
    }
    const c = new AbortController();
    ctrl.current = c;
    setState({ text: '', busy: true, error: null });
    try {
      const answer = await streamAnswer(body, (text) => !c.signal.aborted && setState((s) => ({ ...s, text })), c.signal);
      if (c.signal.aborted) return null;
      setState({ text: answer, busy: false, error: null });
      return answer;
    } catch (e) {
      if (!c.signal.aborted) setState({ text: '', busy: false, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }, []);

  return { ...state, run };
}

function Answer({ title, answer, articles }: { title: string; answer: ReturnType<typeof useAnswer>; articles: Article[] }) {
  return (
    <div className={styles.answer} aria-live="polite" aria-busy={answer.busy}>
      <div className={styles.question}>{title}</div>
      {answer.error ? (
        <div className={ui.error}>{answer.error}</div>
      ) : answer.text ? (
        <Markdown text={answer.text} articles={articles} streaming={answer.busy} />
      ) : (
        <span className={ui.spinner} />
      )}
    </div>
  );
}

function ArticleList({ articles, analysis }: { articles: Article[]; analysis: Record<number, ArticleAnalysis> }) {
  const t = useT();
  const open = useApp((s) => s.openCitation);
  return (
    <ol className={styles.sources}>
      {articles.map((a) => (
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
  );
}

/** Live issue filters: the stories trending in this report's articles, each with a summary and its articles. */
function Issues({ report, onUpdate }: { report: Report; onUpdate(r: Report): void }) {
  const t = useT();
  const [active, setActive] = useState<Issue | null>(null);
  const answer = useAnswer();
  const byNumber = useMemo(() => new Map(report.articles.map((a) => [a.n, a])), [report.articles]);
  const articlesOf = (issue: Issue) => issue.ids.map((n) => byNumber.get(n)).filter((a): a is Article => !!a);

  if (!report.issues.length) return <p className={ui.hint}>{t('issues.none')}</p>;

  const pick = async (issue: Issue) => {
    if (active?.label === issue.label) {
      setActive(null);
      return;
    }
    setActive(issue);
    const key = issueQaKey(issue.label);
    const text = await answer.run({ key: report.key, issue: issue.label }, report.qa[key]);
    if (text) onUpdate({ ...report, qa: { ...report.qa, [key]: text } });
  };

  const now = Date.now();
  return (
    <>
      <div className={styles.chips} role="group" aria-label={t('issues.title')}>
        {report.issues.map((issue) => {
          const newest = Math.max(...articlesOf(issue).map((a) => Date.parse(a.publishedAt) || 0));
          return (
            <button
              key={issue.label}
              className={`${styles.chip} ${active?.label === issue.label ? styles.chipActive : ''}`}
              aria-pressed={active?.label === issue.label}
              onClick={() => void pick(issue)}
            >
              {now - newest < FRESH_MS && <span className={styles.chipNew}>{t('issues.new')}</span>}
              {issue.label}
              <span className={styles.chipCount}>{issue.ids.length}</span>
            </button>
          );
        })}
      </div>
      {active && (
        <>
          <Answer title={active.label} answer={answer} articles={report.articles} />
          <ArticleList articles={articlesOf(active)} analysis={report.analysis} />
        </>
      )}
    </>
  );
}

function Ask({ report }: { report: Report }) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const answer = useAnswer();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const question = draft.trim();
    if (!question) return;
    setAsked(question);
    void answer.run({ key: report.key, question });
  };

  return (
    <>
      <form className={styles.ask} onSubmit={submit}>
        <input
          className={styles.askInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_QUESTION}
          placeholder={t('ask.placeholder')}
          aria-label={t('ask.title')}
          enterKeyHint="send"
        />
        <button className={`${ui.button} ${ui.small} ${ui.primary}`} type="submit" disabled={!draft.trim()}>
          {t('ask.submit')}
        </button>
      </form>
      {asked && <Answer title={`Q. ${asked}`} answer={answer} articles={report.articles} />}
    </>
  );
}

function Sources({ report }: { report: Partial<Report> }) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const articles = report.articles ?? [];
  const analysis = report.analysis ?? {};
  const irrelevant = articles.filter((a) => analysis[a.n] && !analysis[a.n].relevant);
  const shown = showAll ? articles : articles.filter((a) => !analysis[a.n] || analysis[a.n].relevant);
  return (
    <>
      <ArticleList articles={shown} analysis={analysis} />
      {irrelevant.length > 0 && (
        <button className={`${ui.button} ${ui.small}`} onClick={() => setShowAll((v) => !v)} aria-pressed={showAll}>
          {t('sources.irrelevant', { n: irrelevant.length })}
        </button>
      )}
    </>
  );
}

type SectionId = 'report' | 'issues' | 'market' | 'data' | 'ask' | 'sources';

function Nav({ sections }: { sections: SectionId[] }) {
  const t = useT();
  const go = (id: string) => document.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <nav className={styles.nav} aria-label={t('nav.label')}>
      {sections.map((id) => (
        <button key={id} onClick={() => go(id)}>
          {t(`nav.${id}`)}
        </button>
      ))}
    </nav>
  );
}

interface ContentProps {
  params: ReportParams;
  kicker: string;
  title: string;
  /** Map place, for place reports. */
  info: PlaceInfo | null;
  /** Country code for the market section. */
  cc: string | null;
}

function PanelContent({ params, kicker, title, info, cc }: ContentProps) {
  const t = useT();
  const lang = useApp((s) => s.settings.contentLang);
  const uiLang = useApp((s) => s.settings.uiLang);
  const select = useApp((s) => s.select);
  const closePanel = useApp((s) => s.closePanel);
  const { status, progress, report, cached, error, refresh, updateReport } = useReport(params, lang);
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const articles = report?.articles ?? [];
  const relevantCount = articles.filter((a) => report?.analysis?.[a.n]?.relevant).length;
  const finished = status === 'done' || (status === 'error' && cached);
  const full = finished && report?.createdAt ? (report as Report) : null;
  const query = report?.query ?? '';
  const exclude = info ? [info.name.ko, info.name.en, info.query.ko, info.query.en] : [query, ...query.split(/\s+/)];
  const sections: SectionId[] = ['report', 'issues', ...(cc ? (['market'] as const) : []), 'data', 'ask', 'sources'];

  return (
    <>
      <header className={styles.header}>
        <div className={styles.titleWrap}>
          <div className={ui.kicker}>{kicker}</div>
          <h1 className={styles.title}>{title}</h1>
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
        <button className={ui.close} onClick={closePanel} aria-label={t('panel.close')} title={`${t('panel.close')} (Esc)`}>
          ×
        </button>
      </header>

      <div className={styles.actions}>
        <button className={`${ui.button} ${ui.small}`} onClick={refresh} disabled={status === 'running' || status === 'loading'}>
          ↻ {t('panel.refresh')}
        </button>
        {info?.country && (
          <button className={`${ui.button} ${ui.small}`} onClick={() => select({ scope: 'country', id: info.country!.id }, 'frame')}>
            {t('panel.countryReport', { country: info.country.name[uiLang] })}
          </button>
        )}
      </div>

      {status !== 'loading' && !(finished && cached && !error) && <Steps progress={progress} />}
      <Nav sections={sections} />

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

        <Section id="issues" title={t('issues.title')}>
          {full ? (
            <Issues key={full.key + full.createdAt} report={{ ...full, issues: full.issues ?? [] }} onUpdate={updateReport} />
          ) : (
            <p className={ui.hint}>{t('issues.locked')}</p>
          )}
        </Section>

        {cc && (
          <Section id="market" title={t('nav.market')}>
            <MarketView cc={cc} />
          </Section>
        )}

        {articles.length > 0 && (
          <Section id="data" title={t('nav.data')}>
            <Charts report={report!} exclude={exclude} />
          </Section>
        )}

        <Section id="ask" title={t('ask.title')}>
          {full && articles.length > 0 ? <Ask key={full.key + full.createdAt} report={full} /> : <p className={ui.hint}>{t('ask.locked')}</p>}
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
  const t = useT();
  const selection = useApp((s) => s.selection);
  const topic = useApp((s) => s.topic);
  const places = useApp((s) => s.places);
  const uiLang = useApp((s) => s.settings.uiLang);
  const info = useMemo(() => (selection && places ? placeInfo(places, selection) : null), [selection, places]);

  let content: ContentProps | null = null;
  if (topic) {
    content = { params: { scope: 'topic', prompt: topic }, kicker: t('panel.topic'), title: topic, info: null, cc: null };
  } else if (info && places) {
    content = {
      params: { scope: info.scope, code: info.code },
      kicker: info.scope === 'country' ? t('panel.country') : `${t('panel.region')} · ${info.country!.name[uiLang]}`,
      title: info.name[uiLang],
      info,
      cc: info.scope === 'country' ? info.code : places.countries[info.country!.id].cc,
    };
  }
  if (!content) return null;
  return (
    <aside className={styles.panel} data-testid="panel" aria-label={content.title}>
      <PanelContent key={topic ? `topic:${topic}` : `${info!.scope}:${info!.code}`} {...content} />
    </aside>
  );
}
