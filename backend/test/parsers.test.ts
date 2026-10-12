import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSse } from '../../shared/sse.ts';
import { decodeHtml } from '../src/news/text.ts';
import { parseRss } from '../src/news/googleRss.ts';
import { parseChart } from '../src/market.ts';

test('parseSse splits complete events and keeps the rest', () => {
  const { messages, rest } = parseSse('event: a\ndata: {"x":1}\n\n:\n\nevent: b\r\ndata: "y"\r\n\r\nevent: c\ndata: 1');
  assert.deepEqual(messages, [
    { event: 'a', data: { x: 1 } },
    { event: 'b', data: 'y' },
  ]);
  assert.equal(rest, 'event: c\ndata: 1');
});

test('decodeHtml strips tags and decodes entities', () => {
  assert.equal(decodeHtml('<b>삼성</b> &quot;반도체&quot; &amp; AI&#33; &#x41; &unknown;  x'), '삼성 "반도체" & AI! A &unknown; x');
});

test('parseRss reads Google News items', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>Big &amp; news - Daily Times</title><link>https://news.google.com/a</link>
    <pubDate>Mon, 12 Oct 2026 01:00:00 GMT</pubDate><source url="https://t.example">Daily Times</source></item>
    <item><title><![CDATA[Second]]></title><link>https://news.google.com/b</link><pubDate>garbage</pubDate></item>
  </channel></rss>`;
  const now = new Date('2026-10-12T05:00:00Z');
  const items = parseRss(xml, now);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    title: 'Big & news',
    snippet: '',
    url: 'https://news.google.com/a',
    source: 'Daily Times',
    publishedAt: '2026-10-12T01:00:00.000Z',
    provider: 'google',
  });
  assert.equal(items[1].title, 'Second');
  assert.equal(items[1].publishedAt, now.toISOString());
  assert.throws(() => parseRss('<html></html>'));
});

test('parseChart takes the previous close from the series when Yahoo omits the change', () => {
  const q = parseChart('^X', '', {
    chart: { result: [{ meta: { regularMarketPrice: 110, currency: 'KRW', shortName: 'X Index', regularMarketTime: 100 }, indicators: { quote: [{ close: [90, null, 100, 110] }] } }] },
  });
  assert.equal(q.name, 'X Index');
  assert.deepEqual(q.series, [90, 100, 110]);
  assert.ok(Math.abs(q.changePct! - 10) < 1e-9);
  assert.equal(q.time, 100_000);
  assert.throws(() => parseChart('^X', 'X', { chart: { result: null } }));
});
