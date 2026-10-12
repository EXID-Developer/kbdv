import { Map as MLMap, setWorkerUrl, AttributionControl, type MapMouseEvent, type PaddingOptions, type StyleSpecification } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { zoomForArea } from '../../../shared/places.ts';
import type { Camera } from '../store/app.ts';
import type { Lang, Places, Scope, Target } from '../../../shared/types.ts';
import { LAND, LAND_HOVER, OCEAN, SELECTED } from './colors.ts';
import { drawLabels, type Label } from './labels.ts';

setWorkerUrl(maplibreWorkerUrl);

/** Below this zoom taps pick countries; at or above it they pick regions. */
export const COUNTRY_ZOOM = 4;
const FADE = 0.5;
const TAP_RADIUS_PX = 16;

const STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'ocean', type: 'background', paint: { 'background-color': OCEAN } }],
};

export interface MapCallbacks {
  onPick(target: Target | null): void;
  onScopeChange(scope: Scope): void;
}

export interface HeatColors {
  countries: Map<number, string>;
  regions: Map<number, string>;
}

const sourceOf = (scope: Scope) => (scope === 'country' ? 'countries' : 'regions');
const fillColor = ['case', ['boolean', ['feature-state', 'hover'], false], LAND_HOVER, ['coalesce', ['feature-state', 'heat'], LAND]];

export class MapController {
  readonly map: MLMap;
  private loaded = false;
  private places: Places | null = null;
  private lang: Lang = 'ko';
  private scale = 1;
  private countryLabels: Label[] = [];
  private regionLabels: Label[] = [];
  private selected: Target | null = null;
  private hovered: Target | null = null;
  private heat: HeatColors = { countries: new Map(), regions: new Map() };
  private scope: Scope;
  private labelFrame = 0;
  private pendingSelection: { target: Target | null; camera: Camera } | null = null;
  private padding: PaddingOptions = { top: 0, right: 0, bottom: 0, left: 0 };

  constructor(
    container: HTMLElement,
    private readonly labelCanvas: HTMLCanvasElement,
    private readonly callbacks: MapCallbacks,
  ) {
    const narrow = container.clientWidth < 900;
    this.map = new MLMap({
      container,
      style: STYLE,
      center: [127.6, 36.1],
      zoom: narrow ? 3.6 : 4.8,
      minZoom: 1,
      maxZoom: 9.5,
      renderWorldCopies: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disableRotation();
    this.map.addControl(new AttributionControl({ compact: true, customAttribution: 'Borders: Natural Earth' }), 'bottom-right');
    this.scope = this.scopeAt(this.map.getZoom());

    this.map.on('load', () => void this.setup());
    this.map.on('render', () => this.scheduleLabels());
    this.map.on('click', (e) => this.handleClick(e));
    this.map.on('mousemove', (e) => this.setHover(this.targetAt(e.point.x, e.point.y)));
    this.map.on('mouseout', () => this.setHover(null));
    this.map.on('zoom', () => {
      const scope = this.scopeAt(this.map.getZoom());
      if (scope === this.scope) return;
      this.scope = scope;
      this.setHover(null);
      this.callbacks.onScopeChange(scope);
    });
    container.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  destroy() {
    cancelAnimationFrame(this.labelFrame);
    this.map.remove();
  }

  get currentScope() {
    return this.scope;
  }

  private scopeAt(zoom: number): Scope {
    return zoom < COUNTRY_ZOOM ? 'country' : 'region';
  }

  private setup() {
    this.map.addSource('regions', { type: 'geojson', data: '/map/regions.geojson' });
    this.map.addSource('countries', { type: 'geojson', data: '/map/countries.geojson' });
    this.map.addSource('borders', { type: 'geojson', data: '/map/borders.geojson' });

    this.map.addLayer({
      id: 'region-fill',
      type: 'fill',
      source: 'regions',
      paint: { 'fill-color': fillColor as never },
    });
    // Countries sit on top of regions and fade out as the map zooms in to region level.
    this.map.addLayer({
      id: 'country-fill',
      type: 'fill',
      source: 'countries',
      paint: {
        'fill-color': fillColor as never,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], COUNTRY_ZOOM - FADE, 1, COUNTRY_ZOOM, 0],
      },
    });
    for (const [id, source] of [
      ['region-picked', 'regions'],
      ['country-picked', 'countries'],
    ] as const) {
      this.map.addLayer({
        id,
        type: 'fill',
        source,
        paint: { 'fill-color': SELECTED, 'fill-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.22, 0] },
      });
    }
    this.map.addLayer({
      id: 'region-lines',
      type: 'line',
      source: 'borders',
      filter: ['==', ['get', 'k'], 0],
      paint: {
        'line-color': 'rgba(120, 136, 160, 0.45)',
        'line-width': ['interpolate', ['linear'], ['zoom'], COUNTRY_ZOOM, 0.4, 8, 1.2],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], COUNTRY_ZOOM - FADE, 0, COUNTRY_ZOOM, 1],
      },
    });
    this.map.addLayer({
      id: 'country-lines',
      type: 'line',
      source: 'borders',
      filter: ['!=', ['get', 'k'], 0],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': ['case', ['==', ['get', 'k'], 2], 'rgba(150, 170, 200, 0.35)', 'rgba(170, 186, 210, 0.7)'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 5, 1.2, 8, 2],
      },
    });
    for (const [id, source] of [
      ['region-selected', 'regions'],
      ['country-selected', 'countries'],
    ] as const) {
      this.map.addLayer({
        id,
        type: 'line',
        source,
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': SELECTED,
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.5, 6, 3],
          'line-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 1, 0],
        },
      });
    }

    this.loaded = true;
    this.applyHeat(this.heat, { countries: new Map(), regions: new Map() });
    if (this.pendingSelection) this.setSelection(this.pendingSelection.target, this.pendingSelection.camera);
  }

  setPlaces(places: Places) {
    this.places = places;
    this.rebuildLabels();
  }

  setLang(lang: Lang, scale: number) {
    this.lang = lang;
    this.scale = scale;
    this.rebuildLabels();
  }

  private rebuildLabels() {
    const p = this.places;
    if (!p) return;
    const name = (ko: string, en: string) => (this.lang === 'ko' ? ko || en : en);
    this.countryLabels = p.countries
      .map((c) => ({ text: name(c.ko, c.en), lon: c.lon, lat: c.lat, extentKm: Math.sqrt(c.area), priority: c.area }))
      .sort((a, b) => b.priority - a.priority);
    this.regionLabels = p.regions
      .map((r) => {
        const c = p.countries[r.country];
        const ko = r.key.endsWith('~all') ? c.ko : r.ko;
        return { text: name(ko, r.en || c.en), lon: r.lon, lat: r.lat, extentKm: Math.sqrt(r.area) * 1.3, priority: r.area };
      })
      .sort((a, b) => b.priority - a.priority);
    this.scheduleLabels();
  }

  /**
   * The feature under a tap. Fingers are imprecise, so a much smaller place within reach of the tap
   * (a metropolitan city inside its province, an island) wins over the large one under the exact point.
   */
  private targetAt(x: number, y: number): Target | null {
    if (!this.loaded || !this.places) return null;
    const scope = this.scope;
    const layers = [scope === 'country' ? 'country-fill' : 'region-fill'];
    const areaOf = (id: number) => (scope === 'country' ? this.places!.countries[id]?.area : this.places!.regions[id]?.area) ?? Infinity;
    const idOf = (f: { id?: string | number }) => (typeof f.id === 'number' ? f.id : -1);
    const exact = idOf(this.map.queryRenderedFeatures([x, y], { layers })[0] ?? {});
    const r = TAP_RADIUS_PX;
    const near = this.map
      .queryRenderedFeatures([[x - r, y - r], [x + r, y + r]], { layers })
      .map(idOf)
      .filter((id) => id >= 0)
      .sort((a, b) => areaOf(a) - areaOf(b));
    const smallest = near[0];
    if (exact < 0) return smallest !== undefined ? { scope, id: smallest } : null;
    if (smallest !== undefined && areaOf(smallest) * 8 < areaOf(exact)) return { scope, id: smallest };
    return { scope, id: exact };
  }

  private handleClick(e: MapMouseEvent) {
    this.callbacks.onPick(this.targetAt(e.point.x, e.point.y));
  }

  private setHover(t: Target | null) {
    const same = (a: Target | null, b: Target | null) => a?.scope === b?.scope && a?.id === b?.id;
    if (same(t, this.hovered) || !this.loaded) return;
    if (this.hovered) this.map.setFeatureState({ source: sourceOf(this.hovered.scope), id: this.hovered.id }, { hover: false });
    this.hovered = t;
    if (t) this.map.setFeatureState({ source: sourceOf(t.scope), id: t.id }, { hover: true });
    this.map.getCanvas().style.cursor = t ? 'pointer' : '';
  }

  setSelection(target: Target | null, camera: Camera) {
    if (!this.loaded || !this.places) {
      this.pendingSelection = { target, camera };
      return;
    }
    this.pendingSelection = null;
    if (this.selected) this.map.setFeatureState({ source: sourceOf(this.selected.scope), id: this.selected.id }, { sel: false });
    this.selected = target;
    if (!target) {
      this.map.easeTo({ padding: this.padding, duration: 400 });
      return;
    }
    this.map.setFeatureState({ source: sourceOf(target.scope), id: target.id }, { sel: true });

    const place = target.scope === 'country' ? this.places.countries[target.id] : this.places.regions[target.id];
    const lon = place.lon + 360 * Math.round((this.map.getCenter().lng - place.lon) / 360);
    // Padding rides along with the move: a separate padding animation would be cancelled by it.
    const padding = this.padding;
    if (camera === 'pan') {
      this.map.easeTo({ center: [lon, place.lat], padding, duration: 700 });
    } else if (camera === 'frame') {
      const zoom = zoomForArea(place.area);
      this.map.flyTo({
        center: [lon, place.lat],
        zoom: target.scope === 'country' ? Math.min(zoom, COUNTRY_ZOOM - 0.15) : Math.max(zoom, COUNTRY_ZOOM + 0.3),
        padding,
        speed: 0.8,
      });
    }
  }

  /** Keeps the map's visual center clear of the panel. Applied on the next camera move, or now if nothing is selected. */
  setPadding(padding: PaddingOptions) {
    const cur = this.padding;
    if (cur.right === padding.right && cur.bottom === padding.bottom) return;
    this.padding = padding;
    if (!this.selected) this.map.easeTo({ padding, duration: 400 });
  }

  setHeat(heat: HeatColors) {
    const prev = this.heat;
    this.heat = heat;
    if (this.loaded) this.applyHeat(heat, prev);
  }

  private applyHeat(next: HeatColors, prev: HeatColors) {
    for (const [scope, key] of [
      ['country', 'countries'],
      ['region', 'regions'],
    ] as const) {
      const source = sourceOf(scope);
      for (const id of prev[key].keys()) if (!next[key].has(id)) this.map.setFeatureState({ source, id }, { heat: null });
      for (const [id, color] of next[key]) if (prev[key].get(id) !== color) this.map.setFeatureState({ source, id }, { heat: color });
    }
  }

  private scheduleLabels() {
    if (this.labelFrame) return;
    this.labelFrame = requestAnimationFrame(() => {
      this.labelFrame = 0;
      const labels = this.scope === 'country' ? this.countryLabels : this.regionLabels;
      drawLabels(this.map, this.labelCanvas, labels, 12 * this.scale, 26 * this.scale);
    });
  }
}
