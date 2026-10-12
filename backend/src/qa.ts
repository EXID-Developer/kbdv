import { issueQaKey, type Report } from '../../shared/types.ts';
import { settings } from './config.ts';
import { chatStream } from './llm.ts';
import { issueQuestion, QA_MAX_TOKENS, qaMessages } from './prompts.ts';
import { getReport, putReport } from './store.ts';
import { subjectOfReport } from './subjects.ts';

export const MAX_QUESTION = 300;

export type AnswerRequest = { issue: string } | { question: string };

/** Article set and question for a request, or an error message for an unknown issue. */
export function resolveQuestion(report: Report, req: AnswerRequest) {
  if ('issue' in req) {
    const issue = report.issues.find((i) => i.label === req.issue);
    if (!issue) return null;
    const ids = new Set(issue.ids);
    return { question: issueQuestion(issue.label, report.lang), articles: report.articles.filter((a) => ids.has(a.n)), cacheKey: issueQaKey(issue.label) };
  }
  const relevant = report.articles.filter((a) => report.analysis[a.n]?.relevant);
  return { question: req.question, articles: relevant.length ? relevant : report.articles, cacheKey: null };
}

/**
 * Answers from the report's own articles only. Issue summaries are cached on the report so every screen
 * gets them instantly afterwards; free-form questions are not cached.
 */
export async function answer(report: Report, req: AnswerRequest, onText: (text: string) => void, signal: AbortSignal): Promise<string> {
  const resolved = resolveQuestion(report, req);
  const subject = subjectOfReport(report);
  if (!resolved || !subject) throw new Error('Unknown issue or place');
  if (resolved.cacheKey && report.qa[resolved.cacheKey]) return report.qa[resolved.cacheKey];

  const s = settings();
  const text = (
    await chatStream(s, qaMessages(subject.focus, resolved.question, resolved.articles, report.lang, s.llmContextTokens), onText, {
      signal,
      maxTokens: QA_MAX_TOKENS,
    })
  ).trim();

  // Store only onto the same generation of the report; a newer one has different articles and issues.
  const latest = getReport(report.key);
  if (resolved.cacheKey && text && latest && latest.createdAt === report.createdAt) {
    await putReport({ ...latest, qa: { ...latest.qa, [resolved.cacheKey]: text } });
  }
  return text;
}
