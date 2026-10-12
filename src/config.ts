import type { Lang, Provider } from './types.ts';

export interface Settings {
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
  /** Sent as `reasoning_effort` unless empty. */
  llmReasoningEffort: string;
  llmTemperature: number;
  /** Server context window; prompts are trimmed to fit it. */
  llmContextTokens: number;
  naverClientId: string;
  naverClientSecret: string;
  newsProviders: Provider[];
  newsMax: number;
  newsDays: number;
  heatmap: boolean;
  heatmapMetric: 'sentiment' | 'volume';
  autoTour: boolean;
  idleTourSeconds: number;
  tourDwellSeconds: number;
  uiLang: Lang;
  contentLang: Lang;
  /** Root font scale for the touch display. */
  scale: number;
}

const env = import.meta.env;
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: unknown, fallback: boolean) => (v === 'true' ? true : v === 'false' ? false : fallback);
const providers = (v: unknown): Provider[] => {
  const list = str(v, 'naver,google')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Provider => s === 'naver' || s === 'google');
  return list.length ? list : ['naver', 'google'];
};

export const ENV_SETTINGS: Settings = {
  llmBaseUrl: str(env.VITE_LLM_BASE_URL, 'http://172.27.50.106:11434/v1'),
  llmModel: str(env.VITE_LLM_MODEL, 'granite4.2:8b'),
  llmApiKey: str(env.VITE_LLM_API_KEY, ''),
  llmReasoningEffort: str(env.VITE_LLM_REASONING_EFFORT, 'none'),
  llmTemperature: num(env.VITE_LLM_TEMPERATURE, 0.25),
  llmContextTokens: num(env.VITE_LLM_CONTEXT_TOKENS, 4096),
  naverClientId: str(env.VITE_NAVER_CLIENT_ID, ''),
  naverClientSecret: str(env.VITE_NAVER_CLIENT_SECRET, ''),
  newsProviders: providers(env.VITE_NEWS_PROVIDERS),
  newsMax: num(env.VITE_NEWS_MAX, 30),
  newsDays: num(env.VITE_NEWS_DAYS, 14),
  heatmap: bool(env.VITE_HEATMAP, true),
  heatmapMetric: 'sentiment',
  autoTour: bool(env.VITE_AUTO_TOUR, false),
  idleTourSeconds: num(env.VITE_IDLE_TOUR_SECONDS, 90),
  tourDwellSeconds: num(env.VITE_TOUR_DWELL_SECONDS, 25),
  uiLang: 'ko',
  contentLang: 'ko',
  scale: num(env.VITE_UI_SCALE, 1),
};

const STORAGE_KEY = 'kbdv:settings';

export function loadOverrides(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Settings>) : {};
  } catch {
    return {};
  }
}

export function saveOverrides(overrides: Partial<Settings>) {
  try {
    if (Object.keys(overrides).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be unavailable (private window); settings then last for the session only.
  }
}
