import { clear, createStore, del, entries, get, set, setMany } from 'idb-keyval';
import type { ReportSummary } from '../store/app.ts';
import type { Report } from '../types.ts';

const store = createStore('kbdv', 'reports');

export const getReport = (key: string) => get<Report>(key, store);
export const putReport = (report: Report) => set(report.key, report, store);
export const deleteReport = (key: string) => del(key, store);
export const clearReports = () => clear(store);

export async function allReports(): Promise<Report[]> {
  return (await entries<string, Report>(store)).map(([, r]) => r);
}

export function summarize(r: Report): ReportSummary {
  const verdicts = Object.values(r.analysis).filter((a) => a.relevant);
  const pos = verdicts.filter((a) => a.sentiment === 'positive').length;
  const neg = verdicts.filter((a) => a.sentiment === 'negative').length;
  return {
    scope: r.scope,
    code: r.code,
    lang: r.lang,
    createdAt: r.createdAt,
    score: verdicts.length ? (pos - neg) / verdicts.length : 0,
    relevant: verdicts.length,
  };
}

export async function exportReports(): Promise<Blob> {
  const reports = await allReports();
  return new Blob([JSON.stringify({ kind: 'kbdv-reports', version: 1, reports })], { type: 'application/json' });
}

export async function importReports(file: File): Promise<number> {
  const data = JSON.parse(await file.text()) as { kind?: string; reports?: Report[] };
  if (data.kind !== 'kbdv-reports' || !Array.isArray(data.reports)) throw new Error('Not a KBDV report export');
  await setMany(data.reports.map((r) => [r.key, r]), store);
  return data.reports.length;
}
