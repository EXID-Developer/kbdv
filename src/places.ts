import type { Lang, Places, Scope, Target } from './types.ts';

export interface PlaceInfo {
  scope: Scope;
  /** Stable code used for cache keys: country `cc` or region `key`. */
  code: string;
  name: Record<Lang, string>;
  /** Parent country for regions. */
  country: { id: number; name: Record<Lang, string> } | null;
  /** News search query per content language. */
  query: Record<Lang, string>;
  lon: number;
  lat: number;
  area: number;
}

let loading: Promise<Places> | null = null;

export function loadPlaces(): Promise<Places> {
  loading ??= fetch('/map/places.json').then((r) => {
    if (!r.ok) throw new Error(`places.json: HTTP ${r.status}`);
    return r.json() as Promise<Places>;
  });
  return loading;
}

const KOREAS = new Set(['KOR', 'PRK']);

export function placeInfo(places: Places, target: Target): PlaceInfo {
  if (target.scope === 'country') {
    const c = places.countries[target.id];
    const ko = c.ko || c.en;
    return {
      scope: 'country',
      code: c.cc,
      name: { ko, en: c.en },
      country: null,
      query: { ko, en: c.en },
      lon: c.lon,
      lat: c.lat,
      area: c.area,
    };
  }
  const r = places.regions[target.id];
  const c = places.countries[r.country];
  const cName = { ko: c.ko || c.en, en: c.en };
  const whole = r.key.endsWith('~all');
  const ko = r.ko || r.en || cName.ko;
  const en = r.en || cName.en;
  const term = r.q ?? ko;
  return {
    scope: 'region',
    code: r.key,
    name: { ko, en },
    country: { id: r.country, name: cName },
    query: {
      ko: whole || KOREAS.has(c.cc) ? term : `${cName.ko} ${term}`,
      en: whole ? cName.en : `${en} ${cName.en}`,
    },
    lon: r.lon,
    lat: r.lat,
    area: r.area,
  };
}

/** A zoom level that frames a place of the given area. */
export function zoomForArea(areaKm2: number) {
  const z = 11.5 - 0.735 * Math.log2(Math.sqrt(Math.max(areaKm2, 50)));
  return Math.max(2, Math.min(8.5, z));
}

const soleRegions = new WeakMap<Places, Map<number, number>>();

/** Country id -> region id, for countries made of a single region (Luxembourg, Hong Kong, ...). */
function soleRegionMap(places: Places): Map<number, number> {
  let map = soleRegions.get(places);
  if (!map) {
    const counts = new Map<number, number[]>();
    places.regions.forEach((r, id) => counts.set(r.country, [...(counts.get(r.country) ?? []), id]));
    map = new Map([...counts].filter(([, ids]) => ids.length === 1).map(([country, ids]) => [country, ids[0]]));
    soleRegions.set(places, map);
  }
  return map;
}

export function soleRegionOf(places: Places, countryId: number): number | undefined {
  return soleRegionMap(places).get(countryId);
}

/** A region that is its country's only region is the same place as the country, so it maps to the country. */
export function canonicalTarget(places: Places, target: Target): Target {
  if (target.scope !== 'region') return target;
  const country = places.regions[target.id].country;
  return soleRegionOf(places, country) === target.id ? { scope: 'country', id: country } : target;
}

export function findTarget(places: Places, scope: Scope, code: string): Target | null {
  const id = scope === 'country' ? places.countries.findIndex((c) => c.cc === code) : places.regions.findIndex((r) => r.key === code);
  return id >= 0 ? { scope, id } : null;
}
