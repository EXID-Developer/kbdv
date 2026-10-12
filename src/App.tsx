import { useEffect, useState } from 'react';
import { useT } from './i18n/index.ts';
import { useAutoTour } from './kiosk/useAutoTour.ts';
import { MapView } from './map/MapView.tsx';
import { loadPlaces } from './places.ts';
import { useApp } from './store/app.ts';
import { AdminDrawer } from './ui/AdminDrawer.tsx';
import { CitationCard } from './ui/CitationCard.tsx';
import { Panel } from './ui/Panel.tsx';
import { TopBar } from './ui/TopBar.tsx';
import { reloadSummaries } from './ui/useReport.ts';
import ui from './ui/ui.module.css';
import styles from './App.module.css';

function TourBanner() {
  const t = useT();
  const touring = useApp((s) => s.touring);
  if (!touring) return null;
  return (
    <div className={styles.tour}>
      <span className={styles.tourDot} />
      {t('tour.banner')}
    </div>
  );
}

export function App() {
  const [error, setError] = useState<string | null>(null);
  const scale = useApp((s) => s.settings.scale);
  const uiLang = useApp((s) => s.settings.uiLang);
  useAutoTour();

  useEffect(() => {
    loadPlaces()
      .then((p) => useApp.getState().setPlaces(p))
      .catch((e: Error) => setError(e.message));
    reloadSummaries().catch(() => undefined);
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
