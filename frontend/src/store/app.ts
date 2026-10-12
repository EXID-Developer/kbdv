import { create } from 'zustand';
import { canonicalTarget } from '../../../shared/places.ts';
import type { Article, Places, PrewarmState, ReportSummary, ServerSettings, Target } from '../../../shared/types.ts';
import { ENV_SETTINGS, loadOverrides, saveOverrides, type Settings } from '../config.ts';

/** How the map should move when the selection changes. */
export type Camera = 'pan' | 'frame' | 'none';

interface AppState {
  settings: Settings;
  overrides: Partial<Settings>;
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void;
  resetSettings(): void;

  /** Shared settings from the server; null until loaded. */
  server: ServerSettings | null;
  adminProtected: boolean;
  setServer(server: ServerSettings, adminProtected?: boolean): void;

  places: Places | null;
  setPlaces(places: Places): void;

  selection: Target | null;
  camera: { mode: Camera; seq: number };
  select(target: Target | null, camera?: Camera): void;

  /** A free-text news request shown in the panel instead of a place. */
  topic: string | null;
  openTopic(prompt: string): void;
  closePanel(): void;

  citation: Article | null;
  openCitation(article: Article | null): void;

  adminOpen: boolean;
  setAdminOpen(open: boolean): void;

  touring: boolean;
  setTouring(on: boolean): void;

  /** True while the open panel is still generating its report. */
  reportBusy: boolean;
  setReportBusy(busy: boolean): void;

  summaries: Record<string, ReportSummary>;
  setSummaries(all: Record<string, ReportSummary>): void;
  putSummary(key: string, summary: ReportSummary): void;

  prewarm: PrewarmState;
  setPrewarm(state: PrewarmState): void;
}

const initialOverrides = loadOverrides();

export const useApp = create<AppState>()((set, get) => ({
  settings: { ...ENV_SETTINGS, ...initialOverrides },
  overrides: initialOverrides,
  setSetting(key, value) {
    const overrides = { ...get().overrides, [key]: value };
    if (JSON.stringify(ENV_SETTINGS[key]) === JSON.stringify(value)) delete overrides[key];
    saveOverrides(overrides);
    set({ overrides, settings: { ...ENV_SETTINGS, ...overrides } });
  },
  resetSettings() {
    saveOverrides({});
    set({ overrides: {}, settings: { ...ENV_SETTINGS } });
  },

  server: null,
  adminProtected: false,
  setServer: (server, adminProtected) => set(adminProtected === undefined ? { server } : { server, adminProtected }),

  places: null,
  setPlaces: (places) => set({ places }),

  selection: null,
  camera: { mode: 'none', seq: 0 },
  select(target, camera = 'pan') {
    const places = get().places;
    if (target && places) target = canonicalTarget(places, target);
    const cur = get().selection;
    if (cur && target && cur.scope === target.scope && cur.id === target.id && camera !== 'frame' && !get().topic) return;
    set({ selection: target, topic: null, camera: { mode: camera, seq: get().camera.seq + 1 } });
  },

  topic: null,
  openTopic: (topic) => set({ topic, selection: null, camera: { mode: 'none', seq: get().camera.seq + 1 } }),
  closePanel: () => set({ topic: null, selection: null, camera: { mode: 'none', seq: get().camera.seq + 1 } }),

  citation: null,
  openCitation: (citation) => set({ citation }),

  adminOpen: false,
  setAdminOpen: (adminOpen) => set({ adminOpen }),

  touring: false,
  setTouring: (touring) => set({ touring }),

  reportBusy: false,
  setReportBusy: (reportBusy) => set({ reportBusy }),

  summaries: {},
  setSummaries: (summaries) => set({ summaries }),
  putSummary: (key, summary) => set({ summaries: { ...get().summaries, [key]: summary } }),

  prewarm: { running: false, done: 0, total: 0, current: '', failed: [] },
  setPrewarm: (prewarm) => set({ prewarm }),
}));
