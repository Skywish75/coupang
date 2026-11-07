// End-to-end test of one daily run against fake Coupang / Gemini / GitHub
// endpoints and an in-memory KV, so nothing real is called or committed.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runAutoPublish, escapeTildes } from './publish.js';

function memoryKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v) => void store.set(k, v),
    store,
  };
}

const products = (topic) =>
  [1, 2, 3, 4, 5, 6].map((rank) => ({
    productId: `${topic.length}${rank}`,
    productName: `${topic} 상품 ${rank}`,
    productPrice: rank * 10000,
    productImage: `https://img/${rank}.jpg`,
    productUrl: `https://link.coupang.com/${topic}/${rank}`,
    rank,
    isRocket: rank === 1,
    isFreeShipping: true,
  }));

let github;
let gemini;
let coupang;

function installFetch() {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (url.host === 'api-gateway.coupang.com') {
      const keyword = url.searchParams.get('keyword');
      coupang.calls.push(keyword);
      if (coupang.fail.has(keyword)) return new Response('rate limited', { status: 403 });
      return json({ data: { productData: products(keyword) } });
    }

    if (url.host === 'generativelanguage.googleapis.com') {
      const prompt = JSON.parse(init.body).contents[0].parts[0].text;
      gemini.calls.push(prompt);
      const next = gemini.responses.shift() ?? 200;
      if (next !== 200) return new Response('busy', { status: next });
      const text = prompt.includes('구매 가이드') ? '### 가이드 본문' : '### 핵심 특징\n본문';
      return json({ candidates: [{ content: { parts: [{ text }] } }] });
    }

    if (url.host === 'api.github.com') {
      const path = url.pathname;
      const contents = path.match(/\/contents\/(.+)$/);
      if (contents) {
        const file = decodeURIComponent(contents[1]);
        return file in github.files ? new Response(github.files[file]) : new Response('Not Found', { status: 404 });
      }
      if (path.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'base' } });
      if (path.endsWith('/git/commits/base')) return json({ tree: { sha: 'tree0' } });
      if (path.endsWith('/git/blobs')) {
        const { content } = JSON.parse(init.body);
        github.blobs.push(content);
        return json({ sha: `blob${github.blobs.length - 1}` });
      }
      if (path.endsWith('/git/trees')) {
        github.tree = JSON.parse(init.body).tree;
        return json({ sha: 'tree1' });
      }
      if (path.endsWith('/git/commits')) {
        github.message = JSON.parse(init.body).message;
        return json({ sha: 'commit1' });
      }
      if (path.endsWith('/git/refs/heads/main')) return json({});
    }

    throw new Error(`unexpected fetch ${url}`);
  };
}

// path -> committed content
function committed() {
  return Object.fromEntries(github.tree.map((t) => [t.path, github.blobs[Number(t.sha.slice(4))]]));
}

function makeEnv(kv) {
  return {
    STATE: kv,
    GITHUB_REPO: 'owner/repo',
    GITHUB_TOKEN: 't',
    COUPANG_ACCESS_KEY: 'a',
    COUPANG_SECRET_KEY: 's',
    GEMINI_API_KEY: 'g',
  };
}

// A few earlier days of prices for every test product.
function seededPrices(ids, days = 14) {
  const history = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (days - i));
    return [d.toISOString().slice(0, 10), 10000];
  });
  return JSON.stringify({ updatedAt: null, products: Object.fromEntries(ids.map((id) => [id, { name: 'x', history }])) });
}
const ALL_IDS = ['31', '32', '33', '34', '35', '36', '51', '52', '53', '54', '55', '56'];

beforeEach(() => {
  github = {
    files: {
      'data/affiliateLinks.json': '{"existing":{"url":"u","name":"n"}}',
      'data/priceHistory.json': seededPrices(ALL_IDS),
    },
    blobs: [],
    tree: null,
  };
  gemini = { calls: [], responses: [] };
  coupang = { calls: [], fail: new Set() };
  installFetch();
});

test('a normal run records every topic and writes one guide in a single commit, with no post', async () => {
  const kv = memoryKV({ topics: JSON.stringify(['가습기', '캠핑 의자']) });
  const result = await runAutoPublish(makeEnv(kv));

  assert.equal(result.status, 'updated');
  assert.equal(result.tracked, 2);
  assert.equal(result.guideTopic, '가습기');
  assert.equal(result.reason, undefined);
  assert.deepEqual(coupang.calls, ['가습기', '캠핑 의자']);
  assert.equal(gemini.calls.length, 1, 'only the guide uses Gemini');
  assert.match(gemini.calls[0], /구매 가이드/);

  const files = committed();
  const today = new Date().toISOString().slice(0, 10);
  assert.deepEqual(Object.keys(files).sort(), [
    'data/affiliateLinks.json',
    'data/priceHistory.json',
    'data/topicSnapshots.json',
    'src/content/guides/가습기.md',
  ]);

  const prices = JSON.parse(files['data/priceHistory.json']);
  assert.equal(Object.keys(prices.products).length, 12); // 6 per topic
  assert.equal(prices.products['31'].history.length, 15);
  assert.deepEqual(prices.products['31'].history.at(-1), [today, 10000]);

  const snapshots = JSON.parse(files['data/topicSnapshots.json']);
  assert.equal(snapshots['가습기'].products.length, 6); // all of the (fake) 6 results, up to TOP_N
  assert.equal(snapshots['가습기'].hasGuide, true);
  assert.equal(snapshots['캠핑 의자'].hasGuide, false); // one guide per run

  const links = JSON.parse(files['data/affiliateLinks.json']);
  assert.ok(links.existing, 'keeps existing links');
  assert.equal(links['가습기-상품-1-31'].url, 'https://link.coupang.com/가습기/1');
  assert.ok(links['캠핑-의자-상품-6-56'], 'adds links for every compared product');

  assert.equal(kv.store.get('posted-product-ids'), undefined);
  const log = JSON.parse(kv.store.get('logs'))[0];
  assert.equal(log.status, 'updated');
  assert.equal(log.topic, '키워드 2개');
  assert.equal(log.reason, '가이드 작성: 가습기');
  assert.equal(github.message, `chore: update price data (${today})`);
});

test('with every guide written, a run makes no Gemini call at all', async () => {
  const kv = memoryKV({ topics: JSON.stringify(['가습기']) });
  github.files['data/topicSnapshots.json'] = JSON.stringify({ 가습기: { hasGuide: true, products: [] } });

  const result = await runAutoPublish(makeEnv(kv));

  assert.equal(result.status, 'updated');
  assert.equal(result.guideTopic, undefined);
  assert.equal(gemini.calls.length, 0);
  assert.ok(!Object.keys(committed()).some((p) => p.startsWith('src/content/')));
});

test('a Gemini outage drops the guide but still commits price data', async () => {
  const kv = memoryKV({ topics: JSON.stringify(['가습기']) });
  gemini.responses = [400];

  const result = await runAutoPublish(makeEnv(kv));

  assert.equal(result.status, 'updated');
  assert.equal(result.guideTopic, undefined);
  assert.match(result.reason, /가이드 생성 실패\(가습기\)/);
  const files = committed();
  assert.ok(files['data/priceHistory.json']);
  assert.ok(!Object.keys(files).some((p) => p.startsWith('src/content/')));
  assert.equal(JSON.parse(files['data/topicSnapshots.json'])['가습기'].hasGuide, false, 'retried on the next run');
  assert.match(github.message, /update price data/);
});

test('a transient Gemini 503 is retried instead of dropping the guide', async () => {
  const kv = memoryKV({ topics: JSON.stringify(['가습기']) });
  gemini.responses = [503];

  const result = await runAutoPublish(makeEnv(kv));

  assert.equal(result.guideTopic, '가습기');
  assert.equal(gemini.calls.length, 2);
});

test('a failed search for one topic does not stop the others', async () => {
  const kv = memoryKV({ topics: JSON.stringify(['가습기', '캠핑 의자']) });
  coupang.fail.add('가습기');

  const result = await runAutoPublish(makeEnv(kv));

  assert.equal(result.status, 'updated');
  assert.equal(result.tracked, 1);
  assert.match(result.reason, /검색 실패\(가습기\)/);
  const snapshots = JSON.parse(committed()['data/topicSnapshots.json']);
  assert.deepEqual(Object.keys(snapshots), ['캠핑 의자']);
});

test('a run where every search fails throws and commits nothing', async () => {
  const kv = memoryKV({ topics: JSON.stringify(['가습기']) });
  coupang.fail.add('가습기');

  await assert.rejects(runAutoPublish(makeEnv(kv)), /검색 실패\(가습기\)/);
  assert.equal(github.tree, null);
});

test('comparison data for topics removed from the list is dropped', async () => {
  const kv = memoryKV({ topics: JSON.stringify(['가습기']) });
  github.files['data/topicSnapshots.json'] = JSON.stringify({
    가습기: { hasGuide: true, products: [] },
    '없어진 키워드': { hasGuide: true, products: [{ productId: '1' }] },
  });

  await runAutoPublish(makeEnv(kv));

  const snapshots = JSON.parse(committed()['data/topicSnapshots.json']);
  assert.deepEqual(Object.keys(snapshots), ['가습기']);
  assert.equal(snapshots['가습기'].hasGuide, true, 'keeps the guide flag');
});

test('ranges like 65~80g stay literal instead of becoming strikethrough', () => {
  assert.equal(escapeTildes('65~80g, 50~60g'), '65\\~80g, 50\\~60g');
  assert.equal(escapeTildes('~1L and 2\\~3L'), '\\~1L and 2\\~3L');
});
