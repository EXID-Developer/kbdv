import { useCallback, useEffect, useState } from 'react';
import { doneProgress, initialProgress, type Lang, type Progress, type Report } from '../../../shared/types.ts';
import { streamReport, type ReportParams } from '../api.ts';
import { useApp } from '../store/app.ts';

export type ReportStatus = 'loading' | 'running' | 'done' | 'error';

export interface ReportState {
  status: ReportStatus;
  progress: Progress;
  report: Partial<Report> | null;
  /** Shown from the cache rather than generated just now. */
  cached: boolean;
  error: string | null;
}

const initial = (): ReportState => ({ status: 'loading', progress: initialProgress(), report: null, cached: false, error: null });

export function useReport(params: ReportParams | null, lang: Lang) {
  const [state, setState] = useState<ReportState>(initial);
  const [run, setRun] = useState({ n: 0, force: false });
  // A string key keeps the effect from re-running when the caller passes an equal object.
  const id = params ? JSON.stringify(params) : null;

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    const live = () => !ctrl.signal.aborted;
    const setBusy = useApp.getState().setReportBusy;
    setBusy(true);
    setState(initial());

    streamReport(
      JSON.parse(id) as ReportParams,
      lang,
      run.force,
      {
        state: ({ progress, report }) => live() && setState({ status: 'running', progress, report, cached: false, error: null }),
        progress: (progress) => live() && setState((s) => ({ ...s, status: 'running', progress })),
        partial: (patch) => live() && setState((s) => ({ ...s, report: { ...s.report, ...patch } })),
        done: ({ report, cached }) => live() && setState({ status: 'done', progress: doneProgress(), report, cached, error: null }),
        // Fall back to the last good report so the screen never ends up empty.
        error: ({ message, previous }) =>
          live() &&
          setState((s) =>
            previous
              ? { ...s, status: 'error', report: previous, cached: true, progress: doneProgress(), error: message }
              : { ...s, status: 'error', error: message },
          ),
      },
      ctrl.signal,
    )
      .then(() => live() && setState((s) => (s.status === 'done' || s.status === 'error' ? s : { ...s, status: 'error', error: 'Connection to the server was lost' })))
      .catch((e: unknown) => live() && setState((s) => ({ ...s, status: 'error', error: e instanceof Error ? e.message : String(e) })))
      .finally(() => live() && setBusy(false));

    return () => {
      ctrl.abort();
      setBusy(false);
    };
  }, [id, lang, run]);

  const refresh = useCallback(() => setRun((r) => ({ n: r.n + 1, force: true })), []);
  /** Local update after an issue summary was cached on the server. */
  const updateReport = useCallback((report: Report) => setState((s) => ({ ...s, report })), []);

  return { ...state, refresh, updateReport };
}
