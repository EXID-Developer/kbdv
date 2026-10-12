import { create } from 'zustand';
import { placeInfo } from '../places.ts';
import { getReport } from '../services/cache.ts';
import { generateReport } from '../services/pipeline.ts';
import { useApp } from '../store/app.ts';
import { reportKey } from '../types.ts';
import { saveReport } from '../ui/useReport.ts';
import { curatedTargets } from './curated.ts';

interface PrewarmState {
  running: boolean;
  done: number;
  total: number;
  current: string;
  failed: string[];
  controller: AbortController | null;
}

export const usePrewarm = create<PrewarmState>()(() => ({ running: false, done: 0, total: 0, current: '', failed: [], controller: null }));

export async function startPrewarm(skipExisting: boolean) {
  const { places, settings } = useApp.getState();
  if (!places || usePrewarm.getState().running) return;
  const targets = curatedTargets(places);
  const controller = new AbortController();
  const lang = settings.contentLang;
  usePrewarm.setState({ running: true, done: 0, total: targets.length, current: '', failed: [], controller });

  for (const target of targets) {
    if (controller.signal.aborted) break;
    const info = placeInfo(places, target);
    usePrewarm.setState({ current: info.name[settings.uiLang] });
    try {
      if (!(skipExisting && (await getReport(reportKey(info.scope, info.code, lang))))) {
        const report = await generateReport(info, useApp.getState().settings, lang, { onProgress() {}, onPartial() {} }, controller.signal);
        await saveReport(report);
      }
    } catch (e) {
      if (controller.signal.aborted) break;
      usePrewarm.setState((s) => ({ failed: [...s.failed, `${info.name.en}: ${e instanceof Error ? e.message : e}`] }));
    }
    usePrewarm.setState((s) => ({ done: s.done + 1 }));
  }
  usePrewarm.setState({ running: false, current: '', controller: null });
}

export function stopPrewarm() {
  usePrewarm.getState().controller?.abort();
}
