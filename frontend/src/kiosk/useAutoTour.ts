import { useEffect } from 'react';
import { canonicalTarget, findTarget } from '../../../shared/places.ts';
import { useApp } from '../store/app.ts';
import type { Target } from '../../../shared/types.ts';
import { curatedTargets } from '../../../shared/curated.ts';

const FLY_MS = 2500;
const SCROLL_DELAY_MS = 4000;
/** Give up waiting on a report that is still generating after this long. */
const MAX_WAIT_MS = 150_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tourOrder(): Target[] {
  const { places, summaries, settings } = useApp.getState();
  if (!places) return [];
  const unique = new Map<string, Target>();
  for (const s of Object.values(summaries)) {
    if (s.lang !== settings.contentLang || s.relevant <= 0) continue;
    const found = findTarget(places, s.scope, s.code);
    if (!found) continue;
    const t = canonicalTarget(places, found);
    unique.set(`${t.scope}:${t.id}`, t);
  }
  const cached = [...unique.values()];
  const list = cached.length >= 3 ? cached : curatedTargets(places);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Starts a tour of analyzed places after the screen has been idle; any touch ends it. */
export function useAutoTour() {
  const touring = useApp((s) => s.touring);

  useEffect(() => {
    let last = Date.now();
    const onInput = () => {
      last = Date.now();
      if (useApp.getState().touring) useApp.getState().setTouring(false);
    };
    const events = ['pointerdown', 'wheel', 'keydown'] as const;
    for (const e of events) window.addEventListener(e, onInput, { capture: true, passive: true });
    const timer = setInterval(() => {
      const s = useApp.getState();
      if (!s.settings.autoTour || s.touring || s.adminOpen || !s.places) return;
      if (Date.now() - last >= s.settings.idleTourSeconds * 1000) s.setTouring(true);
    }, 1000);
    const unsubscribe = useApp.subscribe((s, prev) => {
      if (!s.settings.autoTour && prev.settings.autoTour && s.touring) s.setTouring(false);
    });
    return () => {
      for (const e of events) window.removeEventListener(e, onInput, { capture: true });
      clearInterval(timer);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!touring) return;
    let cancelled = false;

    (async () => {
      const order = tourOrder();
      for (let i = 0; !cancelled && order.length; i++) {
        useApp.getState().select(order[i % order.length], 'frame');
        await sleep(FLY_MS);
        const start = Date.now();
        let doneAt = 0;
        while (!cancelled) {
          const now = Date.now();
          const s = useApp.getState();
          if (!s.reportBusy && !doneAt) doneAt = now;
          if (doneAt && now - doneAt >= s.settings.tourDwellSeconds * 1000) break;
          if (now - start > MAX_WAIT_MS) break;
          const body = document.querySelector<HTMLElement>('[data-panel-body]');
          if (body && doneAt) {
            const span = s.settings.tourDwellSeconds * 1000 - SCROLL_DELAY_MS - 2000;
            const f = Math.max(0, Math.min(1, (now - doneAt - SCROLL_DELAY_MS) / Math.max(span, 1000)));
            body.scrollTop = f * (body.scrollHeight - body.clientHeight);
          }
          await sleep(50);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [touring]);
}
