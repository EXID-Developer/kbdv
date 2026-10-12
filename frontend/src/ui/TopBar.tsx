import { useEffect, useState } from 'react';
import type { Lang } from '../../../shared/types.ts';
import { useT } from '../i18n/index.ts';
import { useApp } from '../store/app.ts';
import { SearchBar } from './SearchBar.tsx';
import styles from './TopBar.module.css';

function Segmented({ label, value, onChange }: { label: string; value: Lang; onChange(v: Lang): void }) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      <span className={styles.segLabel}>{label}</span>
      {(['ko', 'en'] as const).map((l) => (
        <button key={l} aria-pressed={value === l} onClick={() => onChange(l)}>
          {l === 'ko' ? '한' : 'EN'}
        </button>
      ))}
    </div>
  );
}

function useFullscreen() {
  const [on, setOn] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const update = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  return { on, toggle, supported: !!document.fullscreenEnabled };
}

export function TopBar() {
  const t = useT();
  const settings = useApp((s) => s.settings);
  const setSetting = useApp((s) => s.setSetting);
  const setAdminOpen = useApp((s) => s.setAdminOpen);
  const fullscreen = useFullscreen();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setAdminOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setAdminOpen]);

  return (
    <div className={styles.bar}>
      <div className={styles.brand}>
        <h1>{t('app.title')}</h1>
        <p>{t('app.subtitle')}</p>
      </div>
      <SearchBar />
      <div className={styles.controls}>
        <button className={styles.toggle} aria-pressed={settings.heatmap} onClick={() => setSetting('heatmap', !settings.heatmap)}>
          <span className={styles.led} />
          {t('top.heatmap')}
        </button>
        <button className={styles.toggle} aria-pressed={settings.autoTour} onClick={() => setSetting('autoTour', !settings.autoTour)}>
          <span className={styles.led} />
          {t('top.tour')}
        </button>
        <Segmented label={t('top.uiLang')} value={settings.uiLang} onChange={(v) => setSetting('uiLang', v)} />
        <Segmented label={t('top.contentLang')} value={settings.contentLang} onChange={(v) => setSetting('contentLang', v)} />
        {fullscreen.supported && (
          <button className={styles.icon} onClick={fullscreen.toggle} aria-label={t(fullscreen.on ? 'top.exitFullscreen' : 'top.fullscreen')} title={t(fullscreen.on ? 'top.exitFullscreen' : 'top.fullscreen')}>
            {fullscreen.on ? '⤡' : '⤢'}
          </button>
        )}
        <button className={styles.icon} onClick={() => setAdminOpen(true)} aria-label={t('admin.title')} title={`${t('admin.title')} (Ctrl/⌘ + ,)`}>
          ⚙
        </button>
      </div>
    </div>
  );
}
