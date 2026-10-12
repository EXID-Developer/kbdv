import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LANGS, PROVIDERS, reportKey, type Report, type ReportSummary } from '../../shared/types.ts';
import { DATA_DIR } from './config.ts';
import { removeFile, writeJson } from './files.ts';
import { broadcast } from './hub.ts';

/**
 * Reports shared by every screen. All reports stay in memory (each is tens of kilobytes) so reads are
 * synchronous; every change is written through to one JSON file per report.
 */
const DIR = join(DATA_DIR, 'reports');
const reports = new Map<string, Report>();

// Hashing keeps file names valid on every OS whatever characters place codes contain.
const fileOf = (key: string) => join(DIR, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);

export async function loadReports() {
  await mkdir(DIR, { recursive: true });
  for (const name of await readdir(DIR)) {
    if (!name.endsWith('.json')) continue;
    try {
      const report = parseReport(JSON.parse(await readFile(join(DIR, name), 'utf8')));
      if (report) reports.set(report.key, report);
      else console.warn(`Skipping malformed report file ${name}`);
    } catch (e) {
      console.warn(`Skipping unreadable report file ${name}:`, e instanceof Error ? e.message : e);
    }
  }
  return reports.size;
}

export const getReport = (key: string) => reports.get(key);
export const allReports = () => [...reports.values()];

export async function putReport(report: Report) {
  reports.set(report.key, report);
  const summary = summarize(report);
  if (summary) broadcast('summary', { key: report.key, summary });
  await writeJson(fileOf(report.key), report);
}

export async function clearReports() {
  const keys = [...reports.keys()];
  reports.clear();
  broadcast('summaries', {});
  await Promise.all(keys.map((k) => removeFile(fileOf(k))));
}

/** Heat-map entry for place reports; topics are not on the map. */
export function summarize(r: Report): ReportSummary | null {
  if (r.scope === 'topic') return null;
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

export function summaries(): Record<string, ReportSummary> {
  const all: Record<string, ReportSummary> = {};
  for (const r of reports.values()) {
    const s = summarize(r);
    if (s) all[r.key] = s;
  }
  return all;
}

export const exportReports = () => JSON.stringify({ kind: 'kbdv-reports', version: 2, reports: allReports() });

export async function importReports(data: unknown): Promise<number> {
  const list = (data as { kind?: unknown; reports?: unknown } | null)?.reports;
  if ((data as { kind?: unknown } | null)?.kind !== 'kbdv-reports' || !Array.isArray(list)) throw new Error('Not a KBDV report export');
  const parsed = list.map(parseReport);
  const bad = parsed.findIndex((r) => !r);
  if (bad >= 0) throw new Error(`Report #${bad + 1} in the export is malformed`);
  for (const r of parsed as Report[]) await putReport(r);
  return parsed.length;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isHttp = (url: unknown) => typeof url === 'string' && /^https?:\/\//i.test(url);

/**
 * Validates a report read from disk or an import, filling fields that older versions lacked.
 * Article URLs end up in QR codes on every screen, so only http(s) links are accepted.
 */
export function parseReport(v: unknown): Report | null {
  if (!isObject(v)) return null;
  const { key, scope, code, lang, articles, analysis, markdown, createdAt } = v;
  if (scope !== 'country' && scope !== 'region' && scope !== 'topic') return null;
  if (typeof code !== 'string' || !code || !LANGS.includes(lang as never) || key !== reportKey(scope, code, lang as Report['lang'])) return null;
  if (scope === 'topic' && (typeof v.title !== 'string' || !v.title)) return null;
  if (typeof markdown !== 'string' || typeof createdAt !== 'number' || !isObject(analysis) || !Array.isArray(articles)) return null;
  const articlesOk = articles.every(
    (a) =>
      isObject(a) &&
      Number.isInteger(a.n) &&
      typeof a.title === 'string' &&
      typeof a.snippet === 'string' &&
      isHttp(a.url) &&
      typeof a.source === 'string' &&
      typeof a.publishedAt === 'string' &&
      PROVIDERS.includes(a.provider as never),
  );
  if (!articlesOk) return null;
  const issues = Array.isArray(v.issues)
    ? v.issues.filter((i): i is Report['issues'][number] => isObject(i) && typeof i.label === 'string' && Array.isArray(i.ids) && i.ids.every(Number.isInteger))
    : [];
  const qa = isObject(v.qa) ? Object.fromEntries(Object.entries(v.qa).filter(([, a]) => typeof a === 'string')) : {};
  return {
    ...(v as unknown as Report),
    query: typeof v.query === 'string' ? v.query : '',
    model: typeof v.model === 'string' ? v.model : '',
    totalHits: typeof v.totalHits === 'number' ? v.totalHits : null,
    issues,
    qa: qa as Record<string, string>,
  };
}
