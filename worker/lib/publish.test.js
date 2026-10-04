// End-to-end test of one daily run against fake Coupang / Gemini / GitHub
// endpoints and an in-memory KV, so nothing real is called or committed.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runAutoPublish } from './publish.js';

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

beforeEach(() => {
  github = { files: { 'data/affiliateLinks.json': '{"existing":{"url":"u","name":"n"}}' }, blobs: [], tree: null };
  gemini = { calls: [], responses: [] };
  coupang = { calls: [], fail: new Set() };
  installFetch();
});

test('a normal run tracks every topic, writes a guide and one post in a single commit', async () => {
  const kv = memoryKV({ topics: JSON.stringify(['가습기', '캠핑 의자']) });
  const result = await runAutoPublish(makeEnv(kv));

  assert.equal(result.status, 'published');
  assert.equal(result.topic, '가습기');
  assert.deepEqual(coupang.calls, ['가습기', '캠핑 의자']);

  const files = committed();
  const today = new Date().toISOString().slice(0, 10);
  assert.deepEqual(Object.keys(files).sort(), [
    'data/affiliateLinks.json',
    'data/priceHistory.json',
    'data/topicSnapshots.json',
    `src/content/blog/${today}-가습기-31.md`,
    'src/content/guides/가습기.md',
  ]);

  const post = files[`src/content/blog/${today}-가습기-31.md`];
  assert.match(post, /title: "가습기 상품 1 특징·가격 정리"/);
  assert.match(post, /aiAssisted: true/);
  assert.match(post, /productId: "31"/);
  assert.doesNotMatch(post, /후기/);

  const prices = JSON.parse(files['data/priceHistory.json']);
  assert.equal(Object.keys(prices.products).length, 12); // 6 per topic
  assert.deepEqual(prices.products['31'].history, [[today, 10000]]);

  const snapshots = JSON.parse(files['data/topicSnapshots.json']);
  assert.equal(snapshots['가습기'].products.length, 5);
  assert.equal(snapshots['가습기'].hasGuide, true);
  assert.equal(snapshots['캠핑 의자'].hasGuide, false); // one guide per run

  const links = JSON.parse(files['data/affiliateLinks.json']);
  assert.ok(links.existing, 'keeps existing links');
  assert.equal(links['가습기-상품-1-31'].url, 'https://link.coupang.com/가습기/1');
  assert.ok(links['캠핑-의자-상품-5-55'], 'adds links for compared products');

  assert.equal(JSON.parse(kv.store.get('posted-product-ids'))[0], '31');
  assert.equal(JSON.parse(kv.store.get('logs'))[0].status, 'published');
  assert.match(github.message, /auto-publish post for "가습기"/);
});

test('a Gemini outage drops the post but still commits price data', async () => {
  const kv = memoryKV({ topics: JSON.stringify(['가습기']) });
  github.files['data/topicSnapshots.json'] = JSON.stringify({ 가습기: { hasGuide: true, products: [] } });
  gemini.responses = [400];

  const result = await runAutoPublish(makeEnv(kv));

  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /글 생성 실패/);
  const files = committed();
  assert.ok(files['data/priceHistory.json']);
  assert.ok(!Object.keys(files).some((p) => p.startsWith('src/content/blog/')));
  assert.equal(kv.store.get('posted-product-ids'), undefined);
  assert.match(github.message, /update price data/);
});

test('a transient Gemini 503 is retried instead of dropping the post', async () => {
  const kv = memoryKV({ topics: JSON.stringify(['가습기']) });
  github.files['data/topicSnapshots.json'] = JSON.stringify({ 가습기: { hasGuide: true, products: [] } });
  gemini.responses = [503];

  const result = await runAutoPublish(makeEnv(kv));

  assert.equal(result.status, 'published');
  assert.equal(gemini.calls.length, 2);
});

test('a failed search for one topic does not stop the others', async () => {
  const kv = memoryKV({ topics: JSON.stringify(['가습기', '캠핑 의자']) });
  coupang.fail.add('가습기');

  const result = await runAutoPublish(makeEnv(kv));

  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /검색 실패\(가습기\)/);
  const snapshots = JSON.parse(committed()['data/topicSnapshots.json']);
  assert.deepEqual(Object.keys(snapshots), ['캠핑 의자']);
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

test('already-posted products are skipped and the next one is used', async () => {
  const kv = memoryKV({
    topics: JSON.stringify(['가습기']),
    'posted-product-ids': JSON.stringify(['31', '32']),
  });
  github.files['data/topicSnapshots.json'] = JSON.stringify({ 가습기: { hasGuide: true, products: [] } });

  const result = await runAutoPublish(makeEnv(kv));
  assert.equal(result.productName, '가습기 상품 3');
});
