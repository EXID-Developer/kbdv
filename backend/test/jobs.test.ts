import './setup.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReportEvents } from '../../shared/types.ts';
import { updateSettings } from '../src/config.ts';
import { joinGeneration } from '../src/jobs.ts';
import type { Subject } from '../src/pipeline.ts';
import { getReport, loadReports } from '../src/store.ts';

const RSS = `<rss><channel><item><title>Chip export curbs - Paper</title><link>https://news.example/1</link>
<pubDate>${new Date().toUTCString()}</pubDate><source url="https://news.example">Paper</source></item></channel></rss>`;

/** Fake Google News and LLM; counts report generations. */
function mockUpstreams() {
  const calls = { news: 0, report: 0 };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://news.google.com/')) {
      calls.news++;
      return new Response(RSS);
    }
    const body = JSON.parse(String(init?.body)) as { stream: boolean; response_format?: { json_schema: { schema: { required: string[] } } } };
    if (body.stream) {
      calls.report++;
      const sse = ['## 한눈에 보기', '반도체 수출 규제가 강화됐다 [1].'].map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: `${t}\n` } }] })}\n\n`).join('');
      return new Response(`${sse}data: [DONE]\n\n`);
    }
    const kind = body.response_format?.json_schema.schema.required[0];
    const content =
      kind === 'i'
        ? { i: [{ t: '반도체 수출 규제', ids: [1] }] }
        : kind === 'a'
          ? { a: [{ id: 1, rel: true, sent: 'neg', topic: 'economy', kw: ['반도체'] }] }
          : { ko: '반도체', en: 'chips' };
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
  }) as typeof fetch;
  return calls;
}

test('screens asking for the same report share one generation', async () => {
  await loadReports();
  await updateSettings({ newsProviders: ['google'], naverClientId: '', naverClientSecret: '' });
  const calls = mockUpstreams();
  const subject: Subject = { scope: 'country', code: 'KOR', focus: { label: 'South Korea (대한민국)' }, query: { ko: '한국', en: 'Korea' } };

  const watch = () =>
    new Promise<{ events: string[]; done: ReportEvents['done'] }>((resolve, reject) => {
      const events: string[] = [];
      const leave = joinGeneration(subject, 'ko', (event, data) => {
        events.push(event);
        if (event === 'done') {
          leave();
          resolve({ events, done: data as ReportEvents['done'] });
        } else if (event === 'error') reject(new Error((data as ReportEvents['error']).message));
      });
    });

  const [a, b] = await Promise.all([watch(), watch()]);
  assert.equal(calls.news, 1);
  assert.equal(calls.report, 1);
  assert.equal(a.events[0], 'state');
  assert.equal(b.events[0], 'state');
  assert.equal(a.done.report.createdAt, b.done.report.createdAt);
  assert.deepEqual(a.done.report.issues, [{ label: '반도체 수출 규제', ids: [1] }]);
  assert.match(a.done.report.markdown, /\[1\]/);
  assert.equal(getReport(a.done.report.key)?.createdAt, a.done.report.createdAt);
});
