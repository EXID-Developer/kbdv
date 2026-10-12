import type { Settings } from '../config.ts';
import type { MessageKey } from '../i18n/index.ts';
import { translate } from '../i18n/index.ts';
import type { PlaceInfo } from '../places.ts';
import type { Report } from '../types.ts';
import { chatStream } from './llm.ts';
import { placeLabel } from './pipeline.ts';
import { QA_MAX_TOKENS, qaMessages } from './prompts.ts';

export const QA_PRESETS = ['issues', 'economy', 'people', 'risk', 'positive', 'outlook'] as const;
export type QaPreset = (typeof QA_PRESETS)[number];

export const presetLabel = (id: QaPreset): MessageKey => `qa.${id}`;

export async function answerPreset(
  report: Report,
  info: PlaceInfo,
  preset: QaPreset,
  s: Settings,
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const question = translate(report.lang, presetLabel(preset));
  const articles = report.articles.filter((a) => report.analysis[a.n]?.relevant);
  const answer = await chatStream(s, qaMessages(placeLabel(info), question, articles, report.lang, s.llmContextTokens), onText, {
    signal,
    maxTokens: QA_MAX_TOKENS,
  });
  return answer.trim();
}
