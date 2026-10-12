import type { Lang } from '../../shared/types.ts';

/** Per-screen display settings, kept in this browser. LLM and news settings live on the server. */
export interface Settings {
  heatmap: boolean;
  heatmapMetric: 'sentiment' | 'volume';
  autoTour: boolean;
  idleTourSeconds: number;
  tourDwellSeconds: number;
  uiLang: Lang;
  contentLang: Lang;
  /** Root font scale. */
  scale: number;
}

const env = import.meta.env;
const num = (v: unknown, fallback: number) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: unknown, fallback: boolean) => (v === 'true' ? true : v === 'false' ? false : fallback);

export const ENV_SETTINGS: Settings = {
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
    if (!raw) return {};
    // Older versions also stored LLM and news settings here; keep only what this screen still owns.
    const stored = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(stored).filter(([k]) => k in ENV_SETTINGS)) as Partial<Settings>;
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
