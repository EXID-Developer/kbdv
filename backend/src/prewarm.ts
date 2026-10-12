import { curatedTargets } from '../../shared/curated.ts';
import { placeInfo } from '../../shared/places.ts';
import { reportKey, type Lang, type PrewarmState } from '../../shared/types.ts';
import { broadcast } from './hub.ts';
import { generateDetached, isFresh } from './jobs.ts';
import { getReport } from './store.ts';
import { getPlaces, placeSubject } from './subjects.ts';

let state: PrewarmState = { running: false, done: 0, total: 0, current: '', failed: [] };
let controller: AbortController | null = null;

export const prewarmState = () => state;

function update(patch: Partial<PrewarmState>) {
  state = { ...state, ...patch };
  broadcast('prewarm', state);
}

/** Generates reports for the curated places one by one, so screens show them instantly later. */
export async function startPrewarm(skipExisting: boolean, lang: Lang) {
  if (state.running) return;
  const places = getPlaces();
  const targets = curatedTargets(places);
  const ctrl = new AbortController();
  controller = ctrl;
  update({ running: true, done: 0, total: targets.length, current: '', failed: [] });

  for (const target of targets) {
    if (ctrl.signal.aborted) break;
    const info = placeInfo(places, target);
    update({ current: info.name[lang] });
    try {
      const existing = getReport(reportKey(info.scope, info.code, lang));
      if (!(skipExisting && existing && isFresh(existing))) await generateDetached(placeSubject(info), lang, ctrl.signal);
    } catch (e) {
      if (ctrl.signal.aborted) break;
      update({ failed: [...state.failed, `${info.name.en}: ${e instanceof Error ? e.message : e}`] });
    }
    update({ done: state.done + 1 });
  }
  controller = null;
  update({ running: false, current: '' });
}

export function stopPrewarm() {
  controller?.abort();
}
