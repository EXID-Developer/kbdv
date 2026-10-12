import { useEffect, useState } from 'react';
import { api, loadPlaces, subscribeEvents } from './api.ts';
import { useT } from './i18n/index.ts';
import { useAutoTour } from './kiosk/useAutoTour.ts';
import { MapView } from './map/MapView.tsx';
import { useApp } from './store/app.ts';
import { AdminDrawer } from './ui/AdminDrawer.tsx';
import { CitationCard } from './ui/CitationCard.tsx';
import { Panel } from './ui/Panel.tsx';
import { TopBar } from './ui/TopBar.tsx';
import ui from './ui/ui.module.css';
import styles from './App.module.css';

function TourBanner() {
  const t = useT();
  const touring = useApp((s) => s.touring);
  if (!touring) return null;
  return (
    <div className={styles.tour} role="status">
      <span className={styles.tourDot} />
      {t('tour.banner')}
    </div>
  );
}

/** Esc closes the panel when nothing more specific (a dialog, a text field) wants it. */
function useEscapeToClose() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const s = useApp.getState();
      if (s.citation || s.adminOpen) return; // The dialog closes itself.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        el.blur();
        return;
      }
      if (s.selection || s.topic) s.closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const [error, setError] = useState<string | null>(null);
  const scale = useApp((s) => s.settings.scale);
  const uiLang = useApp((s) => s.settings.uiLang);
  useAutoTour();
  useEscapeToClose();

  useEffect(() => {
    const app = useApp.getState();
    loadPlaces()
      .then(app.setPlaces)
      .catch((e: Error) => setError(e.message));
    api
      .settings()
      .then((r) => app.setServer(r.settings, !!r.adminProtected))
      .catch((e: Error) => setError(e.message));
    return subscribeEvents({
      summaries: app.setSummaries,
      summary: ({ key, summary }) => useApp.getState().putSummary(key, summary),
      prewarm: app.setPrewarm,
      settings: (settings) => useApp.getState().setServer(settings),
    });
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--scale', String(scale > 0 ? scale : 1));
    document.documentElement.lang = uiLang;
  }, [scale, uiLang]);

  return (
    <div className={styles.app}>
      <MapView />
      <TopBar />
      <Panel />
      <TourBanner />
      <CitationCard />
      <AdminDrawer />
      {error && <div className={`${ui.error} ${styles.fatal}`}>{error}</div>}
    </div>
  );
}
