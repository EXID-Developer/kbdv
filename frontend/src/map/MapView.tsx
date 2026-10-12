import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/index.ts';
import { soleRegionOf } from '../../../shared/places.ts';
import { useApp } from '../store/app.ts';
import type { Places, Scope } from '../../../shared/types.ts';
import { sentimentColor, volumeColor, SENTIMENT_SWATCH } from './colors.ts';
import { MapController, type HeatColors } from './controller.ts';
import styles from './MapView.module.css';

/** Narrow or portrait layouts show the panel as a bottom sheet; keep in sync with the CSS media queries. */
export const isNarrow = () => window.innerWidth <= 900 || window.innerHeight > window.innerWidth;

function heatColors(places: Places): HeatColors {
  const { summaries, settings } = useApp.getState();
  const heat: HeatColors = { countries: new Map(), regions: new Map() };
  if (!settings.heatmap) return heat;
  const countryIds = new Map(places.countries.map((c, i) => [c.cc, i]));
  const regionIds = new Map(places.regions.map((r, i) => [r.key, i]));
  const list = Object.values(summaries).filter((s) => s.lang === settings.contentLang && s.relevant > 0);
  const max = Math.max(1, ...list.map((s) => s.relevant));
  for (const s of list) {
    const color = settings.heatmapMetric === 'volume' ? volumeColor(s.relevant / max) : sentimentColor(s.score);
    if (s.scope === 'country') {
      const id = countryIds.get(s.code);
      if (id === undefined) continue;
      heat.countries.set(id, color);
      // Single-region countries keep their color when zoomed in to region level.
      const sole = soleRegionOf(places, id);
      if (sole !== undefined) heat.regions.set(sole, color);
    } else {
      const id = regionIds.get(s.code);
      // Region reports for single-region countries predate their merge into the country report.
      if (id === undefined || soleRegionOf(places, places.regions[id].country) === id) continue;
      heat.regions.set(id, color);
    }
  }
  return heat;
}

function Legend() {
  const t = useT();
  const on = useApp((s) => s.settings.heatmap);
  const metric = useApp((s) => s.settings.heatmapMetric);
  const lang = useApp((s) => s.settings.contentLang);
  const any = useApp((s) => Object.values(s.summaries).some((x) => x.lang === lang && x.relevant > 0));
  if (!on) return null;
  const sentiment = metric === 'sentiment';
  return (
    <div className={styles.legend}>
      <div className={styles.legendTitle}>{t(sentiment ? 'heat.sentiment' : 'heat.volume')}</div>
      {any ? (
        <>
          <div
            className={styles.ramp}
            style={{
              background: sentiment
                ? `linear-gradient(90deg, ${SENTIMENT_SWATCH.negative}, ${sentimentColor(0)}, ${SENTIMENT_SWATCH.positive})`
                : `linear-gradient(90deg, ${volumeColor(0)}, ${volumeColor(1)})`,
            }}
          />
          <div className={styles.rampLabels}>
            <span>{t(sentiment ? 'heat.negative' : 'heat.few')}</span>
            <span>{t(sentiment ? 'heat.positive' : 'heat.many')}</span>
          </div>
        </>
      ) : (
        <div className={styles.legendEmpty}>{t('heat.none')}</div>
      )}
    </div>
  );
}

export function MapView() {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLCanvasElement>(null);
  const [scope, setScope] = useState<Scope>('region');

  useEffect(() => {
    const controller = new MapController(containerRef.current!, labelsRef.current!, {
      onPick(target) {
        const app = useApp.getState();
        if (app.touring) return;
        app.select(target, 'pan');
      },
      onScopeChange: setScope,
    });
    setScope(controller.currentScope);

    const sync = () => {
      const s = useApp.getState();
      const narrow = isNarrow();
      const open = !!s.selection || !!s.topic;
      const panelPx = open && !narrow ? Math.min(window.innerWidth * 0.46, 880) + 24 : 0;
      controller.setPadding({ top: 0, left: 0, right: panelPx, bottom: open && narrow ? window.innerHeight * 0.6 : 0 });
    };
    const apply = (s = useApp.getState(), prev?: ReturnType<typeof useApp.getState>) => {
      if (s.places && s.places !== prev?.places) controller.setPlaces(s.places);
      if (!prev || s.settings.uiLang !== prev.settings.uiLang || s.settings.scale !== prev.settings.scale) {
        controller.setLang(s.settings.uiLang, s.settings.scale);
      }
      if (s.selection !== prev?.selection || s.topic !== prev?.topic) sync();
      if (s.camera !== prev?.camera || s.places !== prev?.places) controller.setSelection(s.selection, s.camera.mode);
      if (
        s.places &&
        (!prev ||
          s.places !== prev.places ||
          s.summaries !== prev.summaries ||
          s.settings.heatmap !== prev.settings.heatmap ||
          s.settings.heatmapMetric !== prev.settings.heatmapMetric ||
          s.settings.contentLang !== prev.settings.contentLang)
      ) {
        controller.setHeat(heatColors(s.places));
      }
    };
    apply();
    const unsubscribe = useApp.subscribe((s, prev) => apply(s, prev));
    window.addEventListener('resize', sync);
    (window as unknown as { __map?: MapController }).__map = controller;
    return () => {
      unsubscribe();
      window.removeEventListener('resize', sync);
      controller.destroy();
    };
  }, []);

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.map} data-testid="map" />
      <canvas ref={labelsRef} className={styles.labels} />
      <div className={styles.bottomLeft}>
        <Legend />
        <div className={styles.scope}>
          <span className={styles.scopeBadge}>{t(scope === 'country' ? 'map.modeCountry' : 'map.modeRegion')}</span>
          <span>{t('map.zoomHint')}</span>
        </div>
      </div>
    </div>
  );
}
