import type { Places, Target } from './types.ts';

const COUNTRIES = [
  'USA', 'CHN', 'JPN', 'RUS', 'PRK', 'TWN', 'GBR', 'FRA', 'DEU', 'IND',
  'UKR', 'ISR', 'VNM', 'IDN', 'AUS', 'CAN', 'BRA', 'SAU', 'TUR', 'ITA',
];

/** Places pre-generated for the demo: every South Korean province followed by major countries. */
export function curatedTargets(places: Places): Target[] {
  const kor = places.countries.findIndex((c) => c.cc === 'KOR');
  const regions = places.regions.flatMap((r, id) => (r.country === kor ? [{ scope: 'region' as const, id }] : []));
  const countries = COUNTRIES.flatMap((cc) => {
    const id = places.countries.findIndex((c) => c.cc === cc);
    return id >= 0 ? [{ scope: 'country' as const, id }] : [];
  });
  return [...regions, ...countries];
}
