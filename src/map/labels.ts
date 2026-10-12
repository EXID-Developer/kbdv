import type { Map as MLMap } from 'maplibre-gl';

const EARTH_CIRCUMFERENCE_M = 40075016.686;

export interface Label {
  text: string;
  lon: number;
  lat: number;
  /** Rough extent of the place in km, used to size the label. */
  extentKm: number;
  /** Labels with higher priority are placed first. */
  priority: number;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const isWide = (text: string) => /[ㄱ-힝]/.test(text);

/** Draws place names on a canvas above the map, sized by extent, largest first, skipping collisions. */
export function drawLabels(map: MLMap, canvas: HTMLCanvasElement, labels: Label[], minFont: number, maxFont: number) {
  const container = map.getContainer();
  const dpr = window.devicePixelRatio || 1;
  const w = container.clientWidth, h = container.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  const zoom = map.getZoom();
  const center = map.getCenter().lng;
  const placed: Rect[] = [];

  for (const l of labels) {
    const metersPerPx = (EARTH_CIRCUMFERENCE_M * Math.cos((l.lat * Math.PI) / 180)) / (512 * 2 ** zoom);
    const extentPx = (l.extentKm * 1000) / metersPerPx;
    const font = Math.min(maxFont, extentPx / Math.max(3, l.text.length * (isWide(l.text) ? 1.1 : 0.65)));
    if (font < minFont) continue;
    ctx.font = `600 ${font.toFixed(1)}px 'Pretendard Variable', Pretendard, system-ui, sans-serif`;
    const tw = ctx.measureText(l.text).width;

    // Pick the world copy closest to the view center.
    const lon = l.lon + 360 * Math.round((center - l.lon) / 360);
    const p = map.project([lon, l.lat]);
    if (p.x < -tw || p.x > w + tw || p.y < -font || p.y > h + font) continue;
    const rect = { x0: p.x - tw / 2 - 4, y0: p.y - font * 0.65, x1: p.x + tw / 2 + 4, y1: p.y + font * 0.65 };
    if (placed.some((r) => overlaps(r, rect))) continue;
    placed.push(rect);

    ctx.lineWidth = Math.max(2.5, font / 4.5);
    ctx.strokeStyle = 'rgba(8, 12, 18, 0.8)';
    ctx.strokeText(l.text, p.x, p.y);
    ctx.fillStyle = 'rgba(240, 244, 250, 0.92)';
    ctx.fillText(l.text, p.x, p.y);
  }
}
