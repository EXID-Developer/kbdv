import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDERS, SECRET_KEYS, SECRET_MASK, type Provider, type ServerSettings } from '../../shared/types.ts';
import { writeJson } from './files.ts';

const BACKEND_DIR = fileURLToPath(new URL('..', import.meta.url));

try {
  process.loadEnvFile(join(BACKEND_DIR, '.env'));
} catch {
  // No .env file: defaults and the process environment apply.
}

const env = process.env;
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const providers = (v: unknown): Provider[] => {
  const list = str(v, 'naver,google')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Provider => (PROVIDERS as readonly string[]).includes(s));
  return list.length ? [...new Set(list)] : ['naver', 'google'];
};

export const PORT = num(env.PORT, 8787);
export const HOST = str(env.HOST, '0.0.0.0');
/** When set, admin endpoints require `Authorization: Bearer <token>`. */
export const ADMIN_TOKEN = str(env.ADMIN_TOKEN, '').trim();
export const DATA_DIR = resolve(BACKEND_DIR, env.DATA_DIR || 'data');
export const DIST_DIR = resolve(BACKEND_DIR, '../frontend/dist');
export const PLACES_FILE = resolve(BACKEND_DIR, '../frontend/public/map/places.json');

export const ENV_SETTINGS: ServerSettings = {
  llmBaseUrl: str(env.LLM_BASE_URL, 'http://172.27.50.106:11434/v1'),
  llmModel: str(env.LLM_MODEL, 'granite4.2:8b'),
  llmApiKey: str(env.LLM_API_KEY, ''),
  llmReasoningEffort: str(env.LLM_REASONING_EFFORT, 'none'),
  llmTemperature: num(env.LLM_TEMPERATURE, 0.25),
  llmContextTokens: num(env.LLM_CONTEXT_TOKENS, 4096),
  naverClientId: str(env.NAVER_CLIENT_ID, ''),
  naverClientSecret: str(env.NAVER_CLIENT_SECRET, ''),
  newsProviders: providers(env.NEWS_PROVIDERS),
  newsMax: num(env.NEWS_MAX, 30),
  newsDays: num(env.NEWS_DAYS, 14),
  reportTtlMinutes: num(env.REPORT_TTL_MINUTES, 60),
};

/** Allowed range per numeric setting. */
const RANGES: Partial<Record<keyof ServerSettings, [number, number]>> = {
  llmTemperature: [0, 2],
  llmContextTokens: [1024, 2_000_000],
  newsMax: [1, 100],
  newsDays: [1, 365],
  reportTtlMinutes: [0, 60 * 24 * 30],
};
const MAX_STRING = 500;

/**
 * Checks an untrusted settings patch. Returns the accepted values, or an error naming the first bad key.
 * Masked secrets are dropped so that sending the masked form back keeps the stored secret.
 */
export function validatePatch(input: unknown): { ok: true; patch: Partial<ServerSettings> } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, error: 'Expected a JSON object' };
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(ENV_SETTINGS, key)) return { ok: false, error: `Unknown setting: ${key}` };
    const k = key as keyof ServerSettings;
    const def = ENV_SETTINGS[k];
    if (typeof def === 'string') {
      if (typeof value !== 'string' || value.length > MAX_STRING) return { ok: false, error: `${key} must be a string of at most ${MAX_STRING} characters` };
      if ((SECRET_KEYS as readonly string[]).includes(key) && value === SECRET_MASK) continue;
      if (k === 'llmBaseUrl' && !isHttpUrl(value)) return { ok: false, error: 'llmBaseUrl must be an http(s) URL' };
      patch[key] = k === 'llmBaseUrl' ? value.trim() : value;
    } else if (typeof def === 'number') {
      const [min, max] = RANGES[k] ?? [-Infinity, Infinity];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        return { ok: false, error: `${key} must be a number between ${min} and ${max}` };
      }
      patch[key] = value;
    } else {
      if (!Array.isArray(value) || !value.every((p) => (PROVIDERS as readonly unknown[]).includes(p))) {
        return { ok: false, error: `${key} must be a list of: ${PROVIDERS.join(', ')}` };
      }
      patch[key] = [...new Set(value as Provider[])];
    }
  }
  return { ok: true, patch: patch as Partial<ServerSettings> };
}

function isHttpUrl(value: string) {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const SETTINGS_FILE = join(DATA_DIR, 'settings.json');
mkdirSync(DATA_DIR, { recursive: true });

function loadOverrides(): Partial<ServerSettings> {
  try {
    const result = validatePatch(JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')));
    if (result.ok) return result.patch;
    console.warn(`Ignoring ${SETTINGS_FILE}: ${result.error}`);
  } catch {
    // Missing or unreadable: no overrides.
  }
  return {};
}

let overrides = loadOverrides();
let current: ServerSettings = { ...ENV_SETTINGS, ...overrides };

export const settings = () => current;

export async function updateSettings(patch: Partial<ServerSettings>) {
  overrides = { ...overrides, ...patch };
  for (const k of Object.keys(overrides) as Array<keyof ServerSettings>) {
    if (JSON.stringify(overrides[k]) === JSON.stringify(ENV_SETTINGS[k])) delete overrides[k];
  }
  current = { ...ENV_SETTINGS, ...overrides };
  await writeJson(SETTINGS_FILE, overrides);
}

export async function resetSettings() {
  overrides = {};
  current = { ...ENV_SETTINGS };
  await writeJson(SETTINGS_FILE, {});
}

/** Settings as sent to browsers: secrets are replaced by `SECRET_MASK` when set. */
export function publicSettings(): ServerSettings {
  const s = { ...current };
  for (const k of SECRET_KEYS) s[k] = s[k] ? SECRET_MASK : '';
  return s;
}
