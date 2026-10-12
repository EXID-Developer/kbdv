import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaceInfo } from '../places.ts';
import { allReports, getReport, putReport, summarize } from '../services/cache.ts';
import { generateReport, initialProgress, type Progress } from '../services/pipeline.ts';
import { useApp, type ReportSummary } from '../store/app.ts';
import { reportKey, type Lang, type Report } from '../types.ts';

export type ReportStatus = 'loading' | 'running' | 'done' | 'error';

export interface ReportState {
  status: ReportStatus;
  progress: Progress;
  report: Partial<Report> | null;
  /** Shown from the cache rather than generated just now. */
  cached: boolean;
  error: string | null;
}

const done = (): Progress => ({ stages: { search: 'done', report: 'done', analyze: 'done' } });

export async function saveReport(report: Report) {
  await putReport(report);
  useApp.getState().putSummary(report.key, summarize(report));
}

export async function reloadSummaries() {
  const all: Record<string, ReportSummary> = {};
  for (const r of await allReports()) all[r.key] = summarize(r);
  useApp.getState().setSummaries(all);
}

export function useReport(info: PlaceInfo | null, lang: Lang) {
  const [state, setState] = useState<ReportState>({ status: 'loading', progress: initialProgress(), report: null, cached: false, error: null });
  const [run, setRun] = useState({ n: 0, force: false });
  const key = info ? reportKey(info.scope, info.code, lang) : null;
  const infoRef = useRef(info);
  infoRef.current = info;

  useEffect(() => {
    const info = infoRef.current;
    if (!key || !info) return;
    const ctrl = new AbortController();
    const setBusy = useApp.getState().setReportBusy;

    (async () => {
      const previous = (await getReport(key).catch(() => undefined)) ?? null;
      if (ctrl.signal.aborted) return;
      if (previous && !run.force) {
        setState({ status: 'done', progress: done(), report: previous, cached: true, error: null });
        return;
      }
      setBusy(true);
      setState({ status: 'running', progress: initialProgress(), report: null, cached: false, error: null });
      try {
        const report = await generateReport(
          info,
          useApp.getState().settings,
          lang,
          {
            onProgress: (progress) => !ctrl.signal.aborted && setState((s) => ({ ...s, progress })),
            onPartial: (patch) => !ctrl.signal.aborted && setState((s) => ({ ...s, report: { ...s.report, ...patch } })),
          },
          ctrl.signal,
        );
        if (ctrl.signal.aborted) return;
        await saveReport(report);
        setState((s) => ({ ...s, status: 'done', report, error: null }));
      } catch (e) {
        if (ctrl.signal.aborted) return;
        const error = e instanceof Error ? e.message : String(e);
        // Fall back to the last good report so the screen never ends up empty.
        setState((s) =>
          previous ? { ...s, status: 'error', report: previous, cached: true, progress: done(), error } : { ...s, status: 'error', error },
        );
      } finally {
        if (!ctrl.signal.aborted) setBusy(false);
      }
    })();

    return () => {
      ctrl.abort();
      setBusy(false);
    };
  }, [key, lang, run]);

  const refresh = useCallback(() => setRun((r) => ({ n: r.n + 1, force: true })), []);
  const updateReport = useCallback((report: Report) => {
    setState((s) => ({ ...s, report }));
    void saveReport(report);
  }, []);

  return { ...state, refresh, updateReport };
}
