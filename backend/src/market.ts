import type { Market, Quote } from '../../shared/types.ts';

/** ISO 3166 alpha-3 (Natural Earth codes for disputed areas) -> ISO 4217, grouped by currency. */
const CURRENCY_GROUPS: Record<string, string> = {
  EUR: 'ALD AND AUT BEL BGR BLM CYP DEU ESB ESP EST FIN FRA GRC HRV IRL ITA KOS LTU LUX LVA MAF MCO MLT MNE NLD PRT SMR SPM SVK SVN VAT WSB ATF CLP',
  USD: 'USA ASM ECU FSM GUM IOT MHL MNP PLW PRI SLV TCA TLS UMI VGB VIR USG PGA',
  XOF: 'BEN BFA CIV GNB MLI NER SEN TGO',
  XAF: 'CAF CMR COG GAB GNQ TCD',
  XCD: 'AIA ATG DMA GRD KNA LCA MSR VCT',
  XPF: 'NCL PYF WLF',
  AUD: 'AUS ATC CSI HMD IOA KIR NFK NRU TUV',
  NZD: 'NZL COK NIU PCN',
  GBP: 'GBR GGY IMN JEY SGS',
  DKK: 'DNK FRO GRL',
  NOK: 'NOR',
  CHF: 'CHE LIE',
  ILS: 'ISR PSX',
  MAD: 'MAR SAH',
  TRY: 'TUR CYN',
  SOS: 'SOM SOL',
  KZT: 'KAZ KAB',
  INR: 'IND KAS',
  XCG: 'CUW SXM',
};

const SINGLE =
  'ABW:AWG AFG:AFN AGO:AOA ALB:ALL ARE:AED ARG:ARS ARM:AMD AZE:AZN BDI:BIF BGD:BDT BHR:BHD BHS:BSD BIH:BAM BLR:BYN BLZ:BZD ' +
  'BMU:BMD BOL:BOB BRA:BRL BRB:BBD BRN:BND BTN:BTN BWA:BWP CAN:CAD CHL:CLP CHN:CNY COD:CDF COL:COP COM:KMF CPV:CVE CRI:CRC ' +
  'CUB:CUP CYM:KYD CZE:CZK DJI:DJF DOM:DOP DZA:DZD EGY:EGP ERI:ERN ETH:ETB FJI:FJD FLK:FKP GEO:GEL GHA:GHS GIB:GIP GIN:GNF ' +
  'GMB:GMD GTM:GTQ GUY:GYD HKG:HKD HND:HNL HTI:HTG HUN:HUF IDN:IDR IRN:IRR IRQ:IQD ISL:ISK JAM:JMD JOR:JOD JPN:JPY KEN:KES ' +
  'KGZ:KGS KHM:KHR KOR:KRW KWT:KWD LAO:LAK LBN:LBP LBR:LRD LBY:LYD LKA:LKR LSO:LSL MAC:MOP MDA:MDL MDG:MGA MDV:MVR MEX:MXN ' +
  'MKD:MKD MMR:MMK MNG:MNT MOZ:MZN MRT:MRU MUS:MUR MWI:MWK MYS:MYR NAM:NAD NGA:NGN NIC:NIO NPL:NPR OMN:OMR PAK:PKR PAN:PAB ' +
  'PER:PEN PHL:PHP PNG:PGK POL:PLN PRK:KPW PRY:PYG QAT:QAR ROU:RON RUS:RUB RWA:RWF SAU:SAR SDN:SDG SDS:SSP SGP:SGD SHN:SHP ' +
  'SLB:SBD SLE:SLE SRB:RSD STP:STN SUR:SRD SWE:SEK SWZ:SZL SYC:SCR SYR:SYP THA:THB TJK:TJS TKM:TMT TON:TOP TTO:TTD TUN:TND ' +
  'TWN:TWD TZA:TZS UGA:UGX UKR:UAH URY:UYU UZB:UZS VEN:VES VNM:VND VUT:VUV WSM:WST YEM:YER ZAF:ZAR ZMB:ZMW ZWE:ZWG';

export const CURRENCY: Record<string, string> = Object.fromEntries([
  ...Object.entries(CURRENCY_GROUPS).flatMap(([cur, ccs]) => ccs.split(' ').map((cc) => [cc, cur])),
  ...SINGLE.split(' ').map((pair) => pair.split(':')),
]);

/** Benchmark stock indices on Yahoo Finance, per country. */
export const INDICES: Record<string, Array<[symbol: string, name: string]>> = {
  USA: [['^GSPC', 'S&P 500'], ['^IXIC', 'Nasdaq'], ['^DJI', 'Dow Jones']],
  KOR: [['^KS11', 'KOSPI'], ['^KQ11', 'KOSDAQ']],
  JPN: [['^N225', 'Nikkei 225']],
  CHN: [['000001.SS', 'SSE Composite']],
  HKG: [['^HSI', 'Hang Seng']],
  TWN: [['^TWII', 'TAIEX']],
  IND: [['^BSESN', 'Sensex'], ['^NSEI', 'Nifty 50']],
  IDN: [['^JKSE', 'IDX Composite']],
  MYS: [['^KLSE', 'FTSE Bursa Malaysia KLCI']],
  SGP: [['^STI', 'Straits Times']],
  THA: [['^SET.BK', 'SET']],
  PHL: [['PSEI.PS', 'PSEi']],
  VNM: [['^VNINDEX.VN', 'VN-Index']],
  AUS: [['^AXJO', 'S&P/ASX 200']],
  NZL: [['^NZ50', 'S&P/NZX 50']],
  GBR: [['^FTSE', 'FTSE 100']],
  DEU: [['^GDAXI', 'DAX']],
  FRA: [['^FCHI', 'CAC 40']],
  ITA: [['FTSEMIB.MI', 'FTSE MIB']],
  ESP: [['^IBEX', 'IBEX 35']],
  NLD: [['^AEX', 'AEX']],
  CHE: [['^SSMI', 'SMI']],
  BEL: [['^BFX', 'BEL 20']],
  SWE: [['^OMX', 'OMX Stockholm 30']],
  DNK: [['^OMXC25', 'OMX Copenhagen 25']],
  NOR: [['OBX.OL', 'OBX']],
  FIN: [['^OMXH25', 'OMX Helsinki 25']],
  AUT: [['^ATX', 'ATX']],
  IRL: [['^ISEQ', 'ISEQ All Share']],
  PRT: [['PSI20.LS', 'PSI']],
  POL: [['WIG20.WA', 'WIG20']],
  CAN: [['^GSPTSE', 'S&P/TSX Composite']],
  MEX: [['^MXX', 'S&P/BMV IPC']],
  BRA: [['^BVSP', 'Ibovespa']],
  ARG: [['^MERV', 'MERVAL']],
  ISR: [['TA35.TA', 'TA-35']],
  TUR: [['XU100.IS', 'BIST 100']],
  SAU: [['^TASI.SR', 'Tadawul All Share']],
  EGY: [['^CASE30', 'EGX 30']],
  ZAF: [['^J203.JO', 'JSE All Share']],
};

const RATES_TTL_MS = 60 * 60_000;
const QUOTE_TTL_MS = 2 * 60_000;
const TIMEOUT_MS = 10_000;

interface Cached<T> {
  at: number;
  value: Promise<T>;
}

const cache = new Map<string, Cached<unknown>>();

/** Shares one upstream request per key among concurrent callers and keeps the result for `ttl`; failures are not kept. */
function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Cached<T> | undefined;
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.get(key)?.value === value && cache.delete(key));
  return value;
}

interface Rates {
  rates: Record<string, number>;
  time: number;
}

function usdRates(): Promise<Rates> {
  return cached('rates', RATES_TTL_MS, async () => {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Exchange rates HTTP ${res.status}`);
    const data = (await res.json()) as { result?: string; rates?: Record<string, number>; time_last_update_unix?: number };
    if (data.result !== 'success' || !data.rates) throw new Error('Exchange rates unavailable');
    return { rates: data.rates, time: (data.time_last_update_unix ?? Date.now() / 1000) * 1000 };
  });
}

interface YahooChart {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number; regularMarketChangePercent?: number; regularMarketTime?: number; currency?: string; shortName?: string };
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> | null;
  };
}

/** Pure part of the quote: price, change and the month of closes from a Yahoo chart response. */
export function parseChart(symbol: string, name: string, data: YahooChart): Quote {
  const result = data.chart?.result?.[0];
  const meta = result?.meta;
  const series = (result?.indicators?.quote?.[0]?.close ?? []).filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  const price = meta?.regularMarketPrice ?? series.at(-1);
  if (typeof price !== 'number') throw new Error(`No price for ${symbol}`);
  // The last daily bar is the latest session, so the one before it is the previous close.
  const prev = series.length >= 2 ? series[series.length - 2] : null;
  const changePct = typeof meta?.regularMarketChangePercent === 'number' ? meta.regularMarketChangePercent : prev ? (price / prev - 1) * 100 : null;
  return {
    symbol,
    name: name || meta?.shortName || symbol,
    price,
    changePct,
    currency: meta?.currency ?? '',
    time: (meta?.regularMarketTime ?? Date.now() / 1000) * 1000,
    series,
  };
}

function quote(symbol: string, name: string): Promise<Quote> {
  return cached(`q:${symbol}`, QUOTE_TTL_MS, async () => {
    // ponytail: Yahoo's chart endpoint is unofficial and keyless; swap in a paid feed if it starts rejecting requests.
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
    return parseChart(symbol, name, (await res.json()) as YahooChart);
  });
}

const settle = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch (e) {
    console.warn('Market data:', e instanceof Error ? e.message : e);
    return null;
  }
};

/** Currency, exchange rates and benchmark indices for a country; parts that fail upstream are null or omitted. */
export async function market(cc: string): Promise<Market> {
  const currency = CURRENCY[cc] ?? null;
  const fxSymbol = currency === 'USD' ? 'KRW=X' : currency ? `${currency}=X` : null;
  const [rates, fx, ...indices] = await Promise.all([
    settle(usdRates()),
    fxSymbol ? settle(quote(fxSymbol, currency === 'USD' ? 'USD/KRW' : `USD/${currency}`)) : null,
    ...(INDICES[cc] ?? []).map(([symbol, name]) => settle(quote(symbol, name))),
  ]);
  const perUsd = currency ? (rates?.rates[currency] ?? null) : null;
  const krw = rates?.rates.KRW;
  return {
    cc,
    currency,
    perUsd,
    krwPer: perUsd && krw ? krw / perUsd : null,
    ratesTime: rates?.time ?? null,
    fx,
    indices: indices.filter((q): q is Quote => q !== null),
  };
}
