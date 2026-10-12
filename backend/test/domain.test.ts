import './setup.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { reportKey, SECRET_MASK, type Places, type Report } from '../../shared/types.ts';
import { PLACES_FILE, validatePatch } from '../src/config.ts';
import { CURRENCY } from '../src/market.ts';
import { normalizeIssues } from '../src/pipeline.ts';
import { parseReport } from '../src/store.ts';

test('validatePatch accepts known, well-typed settings only', () => {
  assert.deepEqual(validatePatch({ newsMax: 20, llmBaseUrl: ' http://h:1/v1 ', newsProviders: ['google', 'google'] }), {
    ok: true,
    patch: { newsMax: 20, llmBaseUrl: 'http://h:1/v1', newsProviders: ['google'] },
  });
  assert.deepEqual(validatePatch({ llmApiKey: SECRET_MASK }), { ok: true, patch: {} });
  for (const bad of [null, [], { nope: 1 }, { newsMax: 0 }, { newsMax: '5' }, { newsDays: Infinity }, { llmBaseUrl: 'file:///etc' }, { newsProviders: ['bing'] }, { llmModel: 'x'.repeat(501) }]) {
    assert.equal(validatePatch(bad).ok, false, JSON.stringify(bad));
  }
});

test('normalizeIssues drops bad ids, empty and duplicate issues, and caps the count', () => {
  const issues = normalizeIssues(
    {
      i: [
        { t: '  반도체   수출 ', ids: [3, 1, 3, 99, 0, 1.5] },
        { t: '반도체 수출', ids: [2] },
        { t: '', ids: [1] },
        { t: 'No ids', ids: [42] },
        { t: 5, ids: [1] },
        ...Array.from({ length: 8 }, (_, i) => ({ t: `issue ${i}`, ids: [1] })),
      ],
    },
    10,
  );
  assert.deepEqual(issues[0], { label: '반도체 수출', ids: [1, 3] });
  assert.equal(issues.length, 6);
  assert.deepEqual(normalizeIssues({}, 10), []);
});

const report = (): Report => ({
  key: reportKey('country', 'KOR', 'ko'),
  scope: 'country',
  code: 'KOR',
  lang: 'ko',
  query: '한국',
  createdAt: 1,
  model: 'm',
  totalHits: null,
  articles: [{ n: 1, title: 't', snippet: '', url: 'https://a.example', source: 's', publishedAt: '2026-10-12T00:00:00Z', provider: 'google' }],
  analysis: {},
  issues: [],
  markdown: '',
  qa: {},
});

test('parseReport validates imports and fills fields older exports lack', () => {
  const old: Partial<Report> = report();
  delete old.issues;
  assert.deepEqual(parseReport(old)?.issues, []);
  assert.ok(parseReport(report()));
  assert.equal(parseReport({ ...report(), key: 'report:country:USA:ko' }), null);
  assert.equal(parseReport({ ...report(), lang: 'fr', key: 'report:country:KOR:fr' }), null);
  assert.equal(parseReport({ ...report(), articles: [{ ...report().articles[0], url: 'javascript:alert(1)' }] }), null);
  assert.equal(parseReport({ ...report(), scope: 'topic', key: reportKey('topic', 'KOR', 'ko') }), null);
});

test('every inhabited country on the map has a currency', () => {
  const places = JSON.parse(readFileSync(PLACES_FILE, 'utf8')) as Places;
  const missing = places.countries.map((c) => c.cc).filter((cc) => !CURRENCY[cc] && cc !== 'ATA');
  assert.deepEqual(missing, []);
});
