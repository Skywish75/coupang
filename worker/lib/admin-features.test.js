import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kstDate, shiftDate } from './dates.js';
import { parsePostFile, summarizePosts } from './stats.js';
import { isCountableClick, sourcePage, recordClick } from './clicks.js';
import { getAds, saveAds } from './ads.js';
import { slotHtml } from '../../src/lib/adSlot.js';

const CHROME_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const request = (url, headers = {}, method = 'GET') => new Request(url, { method, headers });

test('kstDate rolls over at midnight Korea time, not UTC', () => {
  assert.equal(kstDate(Date.parse('2026-10-04T14:59:00Z')), '2026-10-04');
  assert.equal(kstDate(Date.parse('2026-10-04T15:00:00Z')), '2026-10-05');
  assert.equal(shiftDate('2026-10-01', -1), '2026-09-30');
});

test('parsePostFile reads date and topic slug from post file names', () => {
  assert.deepEqual(parsePostFile('2026-10-03-캠핑-의자-8410785098.md'), { date: '2026-10-03', topicSlug: '캠핑-의자' });
  assert.equal(parsePostFile('example-post.md'), null);
});

test('summarizePosts counts per topic and day, keeping admin topic order', () => {
  const files = [
    '2026-10-04-가습기-1.md',
    '2026-10-01-가습기-2.md',
    '2026-09-01-캠핑-의자-3.md',
    '2026-10-02-옛날-키워드-4.md',
  ];
  const s = summarizePosts(files, ['캠핑 의자', '가습기', '무선 이어폰'], '2026-10-04');
  assert.equal(s.total, 4);
  assert.equal(s.last7, 3);
  assert.equal(s.last30, 3);
  assert.deepEqual(
    s.byTopic.map((t) => [t.topic, t.count, t.lastDate]),
    [
      ['캠핑 의자', 1, '2026-09-01'],
      ['가습기', 2, '2026-10-04'],
      ['무선 이어폰', 0, ''],
      ['옛날-키워드', 1, '2026-10-02'],
    ]
  );
  assert.equal(s.perDay['2026-10-04'], 1);
});

test('isCountableClick ignores bots, previews and non-GET requests', () => {
  assert.equal(isCountableClick(request('https://x/go/a', { 'User-Agent': CHROME_UA })), true);
  assert.equal(isCountableClick(request('https://x/go/a', { 'User-Agent': 'Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)' })), false);
  assert.equal(isCountableClick(request('https://x/go/a', { 'User-Agent': 'facebookexternalhit/1.1' })), false);
  assert.equal(isCountableClick(request('https://x/go/a', {})), false);
  assert.equal(isCountableClick(request('https://x/go/a', { 'User-Agent': CHROME_UA }, 'HEAD')), false);
});

test('sourcePage keeps only same-site referers, decoded', () => {
  const r = (referer) => request('https://site.dev/go/a', referer ? { Referer: referer } : {});
  assert.equal(sourcePage(r('https://site.dev/blog/2026-10-03-%EA%B0%80%EC%8A%B5%EA%B8%B0-1/')), '/blog/2026-10-03-가습기-1/');
  assert.equal(sourcePage(r('https://search.naver.com/search?q=x')), '');
  assert.equal(sourcePage(r(null)), '');
  assert.equal(sourcePage(r('not a url')), '');
});

test('recordClick upserts one counter row for today, page and slug', async () => {
  const calls = [];
  const env = {
    DB: {
      prepare: (sql) => ({ bind: (...args) => ({ run: async () => calls.push({ sql, args }) }) }),
    },
  };
  await recordClick(env, request('https://site.dev/go/a', { 'User-Agent': CHROME_UA, Referer: 'https://site.dev/compare/x/' }), 'a');
  await recordClick(env, request('https://site.dev/go/a', { 'User-Agent': 'Googlebot' }), 'a');
  await recordClick({}, request('https://site.dev/go/a', { 'User-Agent': CHROME_UA }), 'a'); // no DB binding

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ON CONFLICT \(day, slug, page\) DO UPDATE SET count = count \+ 1/);
  assert.deepEqual(calls[0].args, [kstDate(), 'a', '/compare/x/']);
});

test('getAds defaults when data/ads.json is missing; saveAds commits trimmed fields', async () => {
  const blobs = [];
  globalThis.fetch = async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    const json = (body) => new Response(JSON.stringify(body));
    if (path.includes('/contents/')) return new Response('Not Found', { status: 404 });
    if (path.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'base' } });
    if (path.endsWith('/git/commits/base')) return json({ tree: { sha: 't0' } });
    if (path.endsWith('/git/blobs')) {
      blobs.push(JSON.parse(init.body).content);
      return json({ sha: 'b' });
    }
    return json({ sha: 'x' });
  };
  const env = { GITHUB_REPO: 'o/r', GITHUB_TOKEN: 't' };

  assert.deepEqual(await getAds(env), { head: '', top: '', bottom: '', adsTxt: '', updatedAt: null });

  await saveAds(env, { head: '  <script>x</script>\r\n', top: '', bottom: 'B', adsTxt: 'google.com, pub-1, DIRECT', junk: 'ignored' });
  const saved = JSON.parse(blobs[0]);
  assert.equal(saved.head, '<script>x</script>');
  assert.equal(saved.bottom, 'B');
  assert.equal(saved.junk, undefined);
  assert.ok(saved.updatedAt);
});

test('slotHtml labels ads and adds the Partners disclosure only for Coupang code', () => {
  assert.equal(slotHtml(''), '');
  assert.match(slotHtml('<ins class="adsbygoogle"></ins>'), /^<span class="ad-label">광고<\/span>/);
  assert.doesNotMatch(slotHtml('<ins class="adsbygoogle"></ins>'), /쿠팡 파트너스/);
  assert.match(slotHtml('<script src="https://ads-partners.coupang.com/g.js"></script>'), /쿠팡 파트너스 활동의 일환/);
  assert.match(slotHtml('<a href="https://coupa.ng/abc">배너</a>'), /쿠팡 파트너스 활동의 일환/);
});
