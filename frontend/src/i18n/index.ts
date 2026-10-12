import { useCallback } from 'react';
import { useApp } from '../store/app.ts';
import type { Lang } from '../../../shared/types.ts';
import { ko } from './ko.ts';
import { en } from './en.ts';

export type MessageKey = keyof typeof ko;
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const DICTS: Record<Lang, Record<MessageKey, string>> = { ko, en };

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const text = DICTS[lang][key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Translator for UI chrome, following the UI language. */
export function useT(): Translate {
  const lang = useApp((s) => s.settings.uiLang);
  return useCallback((key, vars) => translate(lang, key, vars), [lang]);
}

/** Translator for generated content (chart labels etc.), following the content language. */
export function useContentT(): Translate {
  const lang = useApp((s) => s.settings.contentLang);
  return useCallback((key, vars) => translate(lang, key, vars), [lang]);
}

export function timeAgo(t: Translate, ts: number, now = Date.now()) {
  const min = Math.floor((now - ts) / 60000);
  if (min < 1) return t('ago.now');
  if (min < 60) return t('ago.min', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('ago.hour', { n: h });
  return t('ago.day', { n: Math.floor(h / 24) });
}
