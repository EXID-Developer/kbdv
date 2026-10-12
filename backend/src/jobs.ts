import { initialProgress, reportKey, type Lang, type Progress, type Report, type ReportEvents } from '../../shared/types.ts';
import { settings } from './config.ts';
import { generateReport, type Subject } from './pipeline.ts';
import { getReport, putReport } from './store.ts';

export type Listener = <E extends keyof ReportEvents>(event: E, data: ReportEvents[E]) => void;

interface Job {
  progress: Progress;
  report: Partial<Report>;
  listeners: Set<Listener>;
  ctrl: AbortController;
  idle?: ReturnType<typeof setTimeout>;
}

/** Streamed text arrives token by token; batching it keeps many screens from flooding the network. */
const PARTIAL_FLUSH_MS = 150;
/** A generation nobody watches any more is cancelled after this grace period (covers reloads and reconnects). */
const ABANDON_MS = 10_000;

const jobs = new Map<string, Job>();

export const isFresh = (r: Report, now = Date.now()) => {
  const ttl = settings().reportTtlMinutes;
  return ttl <= 0 || now - r.createdAt < ttl * 60_000;
};

/**
 * Joins the running generation for this report, starting one if needed. Every screen that asks for the same
 * report while it is being written shares one generation. Returns a function that leaves the job.
 */
export function joinGeneration(subject: Subject, lang: Lang, listener: Listener): () => void {
  const key = reportKey(subject.scope, subject.code, lang);
  const job = jobs.get(key) ?? start(key, subject, lang);
  listener('state', { progress: job.progress, report: job.report });

  clearTimeout(job.idle);
  job.listeners.add(listener);
  return () => {
    if (!job.listeners.delete(listener) || job.listeners.size) return;
    job.idle = setTimeout(() => job.listeners.size === 0 && job.ctrl.abort(), ABANDON_MS);
  };
}

/** Generates a report without a viewer (pre-generation); the caller's signal cancels it. */
export function generateDetached(subject: Subject, lang: Lang, signal: AbortSignal): Promise<Report> {
  return new Promise((resolve, reject) => {
    const leave = joinGeneration(subject, lang, (event, data) => {
      if (event === 'done') resolve((data as ReportEvents['done']).report);
      else if (event === 'error') reject(new Error((data as ReportEvents['error']).message));
      else return;
      signal.removeEventListener('abort', onAbort);
      leave();
    });
    const onAbort = () => {
      leave();
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function start(key: string, subject: Subject, lang: Lang): Job {
  const ctrl = new AbortController();
  const listeners = new Set<Listener>();
  const send: Listener = (event, data) => {
    for (const l of [...listeners]) l(event, data);
  };
  let pending: Partial<Report> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (pending) send('partial', pending);
    pending = null;
  };

  const job: Job = { progress: initialProgress(), report: {}, listeners, ctrl };
  const previous = getReport(key) ?? null;

  generateReport(
    subject,
    settings(),
    lang,
    {
      onProgress(p) {
        flush();
        job.progress = p;
        send('progress', p);
      },
      onPartial(patch) {
        Object.assign(job.report, patch);
        pending = { ...pending, ...patch };
        timer ??= setTimeout(flush, PARTIAL_FLUSH_MS);
      },
    },
    ctrl.signal,
  )
    .then((report) => {
      flush();
      jobs.delete(key);
      send('done', { report, cached: false });
      putReport(report).catch((e: unknown) => console.error(`Could not save ${key}:`, e));
    })
    .catch((e: unknown) => {
      flush();
      jobs.delete(key);
      if (ctrl.signal.aborted) return;
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`Report ${key} failed: ${message}`);
      send('error', { message, previous });
    })
    .finally(() => clearTimeout(job.idle));

  jobs.set(key, job);
  return job;
}
