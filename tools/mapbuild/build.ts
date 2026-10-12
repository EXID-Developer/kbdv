import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mapshaper from 'mapshaper';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection, GeometryObject, Polygon as TopoPolygon, MultiPolygon as TopoMultiPolygon } from 'topojson-specification';
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry, LineString, MultiPolygon, Polygon } from 'geojson';
import { GROUP_BY_REGION_FIELD, MERGE_WHOLE, MERGE_WHOLE_BELOW_KM2, SIMPLIFY_PERCENT } from './config.ts';
import { COUNTRY_OVERRIDES, KO_OVERRIDES, QUERY_OVERRIDES } from './names.ts';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const cache = resolve(here, '.cache');
const NE = 'https://naciscdn.org/naturalearth/10m/cultural';
const SOURCES = ['ne_10m_admin_1_states_provinces', 'ne_10m_admin_0_countries'];

const shp = (name: string) => join(cache, name, `${name}.shp`);

async function exists(path: string) {
  return access(path).then(() => true, () => false);
}

async function download() {
  await mkdir(cache, { recursive: true });
  for (const name of SOURCES) {
    if (await exists(shp(name))) continue;
    const zip = join(cache, `${name}.zip`);
    console.log(`downloading ${name}`);
    await exec('curl', ['-sSLfo', zip, `${NE}/${name}.zip`]);
    await exec('unzip', ['-oq', zip, '-d', join(cache, name)]);
  }
}

async function run(commands: string, input: Record<string, unknown> = {}) {
  return mapshaper.applyCommands(commands, input);
}

interface Admin0Row {
  ADM0_A3: string;
  ADMIN: string;
  NAME_EN: string;
  NAME_KO: string;
}

interface Admin1Props {
  adm1_code: string;
  adm0_a3: string;
  name: string;
  name_en: string;
  name_ko: string;
  region: string;
  iso_3166_2: string;
}

type RegionProps = {
  gk: string;
  lu: string;
  en: string;
  ko: string;
  iso: string;
  area_km2: number;
  lx: number;
  ly: number;
};

type CountryProps = {
  lu: string;
  area_km2: number;
  lx: number;
  ly: number;
};

type Layers = { regions: GeometryCollection<RegionProps>; countries: GeometryCollection<CountryProps> };

const round = (n: number) => Math.round(n * 1000) / 1000;

function roundCoords(g: Polygon | MultiPolygon): Polygon | MultiPolygon {
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: g.coordinates.map((r) => r.map(([x, y]) => [round(x), round(y)])) };
  return {
    type: 'MultiPolygon',
    coordinates: g.coordinates.map((p) => p.map((r) => r.map(([x, y]) => [round(x), round(y)]))),
  };
}

function isArea<P extends GeoJsonProperties>(g: GeometryObject<P>): g is TopoPolygon<P> | TopoMultiPolygon<P> {
  return g.type === 'Polygon' || g.type === 'MultiPolygon';
}

async function main() {
  await download();

  const a0out = await run(`-i ${shp(SOURCES[1])} -filter-fields ADM0_A3,ADMIN,NAME_EN,NAME_KO -o a0.json format=json`);
  const admin0 = JSON.parse(a0out['a0.json'].toString()) as Admin0Row[];
  const a0 = new Map(admin0.map((r) => [r.ADM0_A3, r]));

  const a1out = await run(
    `-i ${shp(SOURCES[0])} -filter-fields adm1_code,adm0_a3,name,name_en,name_ko,region,iso_3166_2 -each 'area=this.area' -o a1.json format=geojson`,
  );
  const a1 = JSON.parse(a1out['a1.json'].toString()) as FeatureCollection<Geometry, Admin1Props & { area: number }>;

  const luArea = new Map<string, number>();
  for (const f of a1.features) {
    const lu = f.properties.adm0_a3;
    luArea.set(lu, (luArea.get(lu) ?? 0) + f.properties.area / 1e6);
  }

  for (const f of a1.features) {
    const p = f.properties;
    const lu = p.adm0_a3;
    let gk = p.adm1_code;
    let en = p.name_en || p.name;
    let ko = p.name_ko || '';
    let iso = p.iso_3166_2 || '';
    if (MERGE_WHOLE.has(lu) || (luArea.get(lu) ?? 0) < MERGE_WHOLE_BELOW_KM2) {
      gk = `${lu}~all`;
      en = a0.get(lu)?.NAME_EN ?? lu;
      ko = a0.get(lu)?.NAME_KO ?? '';
      iso = '';
    } else if (GROUP_BY_REGION_FIELD.has(lu) && p.region) {
      gk = `${lu}~${p.region}`;
      en = p.region;
      ko = '';
      iso = '';
    }
    ko = KO_OVERRIDES[gk] ?? ko;
    f.properties = { gk, lu, en, ko, iso } as never;
  }

  const out = await run(
    [
      '-i a1.json name=regions',
      '-dissolve2 gk copy-fields=lu,en,ko,iso',
      `-simplify ${SIMPLIFY_PERCENT} keep-shapes`,
      '-each "area_km2=Math.round(this.area/1e6), lx=this.innerX, ly=this.innerY"',
      '-dissolve2 lu + name=countries',
      '-each "area_km2=Math.round(this.area/1e6), lx=this.innerX, ly=this.innerY" target=countries',
      '-o world.json target=regions,countries format=topojson quantization=200000',
    ].join(' '),
    { 'a1.json': a1 },
  );
  const topo = JSON.parse(out['world.json'].toString()) as Topology<Layers>;
  await emit(topo, a0);
}

async function emit(topo: Topology<Layers>, a0: Map<string, Admin0Row>) {
  const countryGeoms = topo.objects.countries.geometries.filter(isArea);
  countryGeoms.sort((a, b) => a.properties!.lu.localeCompare(b.properties!.lu));
  const countryIndex = new Map(countryGeoms.map((g, i) => [g.properties!.lu, i]));

  const regionGeoms = topo.objects.regions.geometries.filter(isArea).filter((g) => countryIndex.has(g.properties!.lu));
  regionGeoms.sort((a, b) => {
    const pa = a.properties!, pb = b.properties!;
    return pa.lu.localeCompare(pb.lu) || pa.en.localeCompare(pb.en) || pa.gk.localeCompare(pb.gk);
  });

  const countries = countryGeoms.map((g) => {
    const p = g.properties!;
    const row = a0.get(p.lu);
    const o = COUNTRY_OVERRIDES[p.lu] ?? {};
    return {
      cc: p.lu,
      en: o.en ?? (row?.NAME_EN || row?.ADMIN || p.lu),
      ko: o.ko ?? (row?.NAME_KO || ''),
      lon: round(p.lx),
      lat: round(p.ly),
      area: p.area_km2,
    };
  });
  const regions = regionGeoms.map((g) => {
    const p = g.properties!;
    return {
      key: p.gk,
      country: countryIndex.get(p.lu)!,
      en: p.en,
      ko: p.ko,
      iso: p.iso,
      ...(QUERY_OVERRIDES[p.gk] ? { q: QUERY_OVERRIDES[p.gk] } : {}),
      lon: round(p.lx),
      lat: round(p.ly),
      area: p.area_km2,
    };
  });

  const toFeatures = (geoms: Array<TopoPolygon<GeoJsonProperties> | TopoMultiPolygon<GeoJsonProperties>>) =>
    geoms.map((g, i) => {
      const f = feature(topo, g) as Feature<Polygon | MultiPolygon>;
      return { type: 'Feature', id: i, properties: {}, geometry: roundCoords(f.geometry) };
    });

  // Border arcs classified by what they separate: 0 = regions of one country, 1 = two countries, 2 = coastline.
  const arcOwners = new Map<number, number[]>();
  const visit = (arcs: number[], i: number) => {
    for (const a of arcs) {
      const idx = a < 0 ? ~a : a;
      const list = arcOwners.get(idx) ?? [];
      if (!list.includes(i)) list.push(i);
      arcOwners.set(idx, list);
    }
  };
  regionGeoms.forEach((g, i) => {
    if (g.type === 'Polygon') g.arcs.forEach((ring) => visit(ring, i));
    else g.arcs.forEach((poly) => poly.forEach((ring) => visit(ring, i)));
  });
  const borderFeatures = [...arcOwners.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([arc, owners], j) => {
      const f = feature(topo, { type: 'LineString', arcs: [arc] } as never) as unknown as Feature<LineString>;
      const [a, b] = owners;
      const k = b === undefined ? 2 : regions[a].country === regions[b].country ? 0 : 1;
      return {
        type: 'Feature',
        id: j,
        properties: { k },
        geometry: { type: 'LineString', coordinates: f.geometry.coordinates.map(([x, y]) => [round(x), round(y)]) },
      };
    });

  const webMap = join(root, 'public/map');
  await mkdir(webMap, { recursive: true });
  const fc = (features: unknown[]) => JSON.stringify({ type: 'FeatureCollection', features });
  await writeFile(join(webMap, 'regions.geojson'), fc(toFeatures(regionGeoms)));
  await writeFile(join(webMap, 'countries.geojson'), fc(toFeatures(countryGeoms)));
  await writeFile(join(webMap, 'borders.geojson'), fc(borderFeatures));
  await writeFile(join(webMap, 'places.json'), JSON.stringify({ countries, regions }));

  const missingKo = regions.filter((r) => !r.ko).map((r) => `${countries[r.country].cc}:${r.key}:${r.en}`);
  console.log(`countries: ${countries.length}, regions: ${regions.length}, border arcs: ${borderFeatures.length}`);
  console.log(`regions without a Korean name: ${missingKo.length}`);
  if (process.argv.includes('--missing')) console.log(missingKo.join('\n'));
}

await main();
