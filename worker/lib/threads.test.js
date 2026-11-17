import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  threadCandidates,
  candidateReason,
  buildPrompt,
  assembleDraft,
  lintDraft,
  createThreadsDraft,
  getDrafts,
  AD_TAG,
  DISCLOSURE,
} from './threads.js';
import { priceStats, discountPct, isAtLow, weekChange } from '../../src/lib/priceStats.js';

const TODAY = '2026-11-17';
const day = (n) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
// Daily history ending today: `prices[0]` is `prices.length - 1` days ago.
const daily = (prices) => prices.map((p, i) => [day(prices.length - 1 - i), p]);
const flat = (price, days) => Array(days).fill(price);

const product = (rank, key, name, price) => ({
  productId: key.split('-')[0],
  priceKey: key,
  name,
  price,
  slug: `p-${key}`,
  rank,
  isRocket: false,
  isFreeShipping: true,
});

function fixture() {
  const prices = {
    updatedAt: TODAY,
    products: {
      // dropped 10% this week and now the 30-day low
      '1-1': { name: '물방울 생수, 2L, 12개', history: daily([...flat(10000, 20), 9000]) },
      // went up: never a candidate
      '2-1': { name: '산골 생수, 500ml, 40개', history: daily([...flat(10000, 20), 11000]) },
      // 2x swing (option change): unstable, skipped
      '3-1': { name: '바다 생수, 2L, 6개', history: daily([...flat(4000, 10), 9000, 4500]) },
      // flat: no reason to post
      '4-1': { name: '하늘 생수, 2L, 24개', history: daily(flat(14000, 20)) },
      // stale topic: dropped, but the snapshot wasn't refreshed today
      '5-1': { name: '오래된 세제, 3L, 2개', history: daily([...flat(20000, 10), 15000]) },
    },
  };
  const snapshots = {
    생수: {
      updatedAt: TODAY,
      hasGuide: true,
      products: [
        product(1, '1-1', '물방울 생수, 2L, 12개', 9000),
        product(2, '2-1', '산골 생수, 500ml, 40개', 11000),
        product(3, '3-1', '바다 생수, 2L, 6개', 4500),
        product(4, '4-1', '하늘 생수, 2L, 24개', 14000),
      ],
    },
    세탁세제: { updatedAt: day(1), hasGuide: false, products: [product(1, '5-1', '오래된 세제, 3L, 2개', 15000)] },
  };
  return { prices, snapshots };
}

test('shared price stats: week change, discount, 30-day low', () => {
  const { prices } = fixture();
  const s = priceStats(prices, '1-1');
  assert.equal(s.current, 9000);
  assert.equal(isAtLow(s), true);
  assert.equal(discountPct(s), 10);
  assert.deepEqual(weekChange(prices, '1-1'), { fromDate: day(7), fromPrice: 10000, toPrice: 9000, diff: -1000, pct: -10 });
  assert.equal(weekChange(prices, '3-1'), null, 'unstable');
  assert.equal(discountPct(priceStats(prices, '4-1')), null, 'flat');
});

test('candidates: drops and lows only, from today\'s data', () => {
  const { prices, snapshots } = fixture();
  const { deals, units, tips } = threadCandidates(prices, snapshots);

  assert.deepEqual(deals.map((d) => d.id), ['deal:1-1']);
  assert.equal(deals[0].rank, 1);
  assert.equal(deals[0].unit.label, '100ml당');
  assert.match(candidateReason(deals[0]), /10,000원 → 9,000원 \(-10%\) · 30일 평균보다 10% 낮음 · 30일 최저가/);

  // Per 100ml: 하늘 14,000원/48L = 29.2원 (cheapest), 산골 11,000원/20L = 55원 (dearest).
  assert.equal(units.length, 1);
  assert.equal(units[0].id, 'unit:생수:volume');
  assert.equal(units[0].rank, 4);
  assert.equal(Math.round(units[0].dear.unit.value), 55);
  assert.equal(units[0].ratio, 1.9);
  assert.match(candidateReason(units[0]), /100ml당 29\.2원으로 단위 가격이 나온 4개 중 가장 쌈 · 가장 비싼 것은 55원 \(1\.9배 차이\)/);

  assert.deepEqual(tips.map((t) => t.id), ['tip:생수']);
});

test('the prompt carries only recorded facts and the memo rule', () => {
  const { prices, snapshots } = fixture();
  const [deal] = threadCandidates(prices, snapshots).deals;

  const bare = buildPrompt(deal);
  assert.match(bare, /오늘\(11월 17일\) 쿠팡 판매가: 9,000원/);
  assert.match(bare, /11월 10일 기록 가격 10,000원 → 오늘 9,000원 \(10% 내림\)/);
  assert.match(bare, /사용 경험·후기 문장은 절대 쓰지 마/);
  assert.match(bare, /\[링크\]를 정확히 한 번/);

  const withMemo = buildPrompt(deal, { memo: '두 달째 씀. 뚜껑이 잘 안 열림' });
  assert.match(withMemo, /두 달째 씀/);
  assert.match(withMemo, /아쉬운 점이 있으면 숨기지 말고/);

  const tip = buildPrompt({ kind: 'tip', topic: '생수', slug: '생수' }, { guide: '### 용량\n마시는 속도에 맞춰' });
  assert.match(tip, /마시는 속도에 맞춰/);
  assert.match(tip, /링크는 쓰지 마/);
  assert.doesNotMatch(tip, /\[링크\]를/);
});

const ORIGIN = 'https://coupang.tclee.workers.dev';
const LINK = `${ORIGIN}/compare/%EC%83%9D%EC%88%98/#rank-1`;

function dealCandidate() {
  const { prices, snapshots } = fixture();
  return threadCandidates(prices, snapshots).deals[0];
}

test('ad tag first, link only in the last comment, disclosure beside it', () => {
  const draft = assembleDraft(dealCandidate(), {
    hooks: [{ text: '물 떨어진 거 밤 11시에 알았어', type: '고백형', why: '누구나 겪음' }],
    post: '물 떨어진 거 밤 11시에 알았어\n편의점까지 또 나가야 해 [링크]',
    comments: ['댓글 하나 [링크]', '지금 30일 중 제일 낮아\n[링크]'],
    checks: ['가격 다시 확인'],
  }, { origin: ORIGIN, now: 0 });

  assert.ok(draft.post.startsWith(`${AD_TAG} 물 떨어진 거`));
  assert.ok(!draft.post.includes('[링크]'));
  assert.equal(draft.comments[0], '댓글 하나');
  const last = draft.comments[1];
  assert.equal(last.split(LINK).length, 2, 'link exactly once');
  assert.ok(last.endsWith(`가격은 11월 17일 기록 기준이라 바뀔 수 있어.\n${DISCLOSURE}`));
  assert.equal(draft.link, LINK);
});

test('the ad tag is added even when the first line mentions 광고', () => {
  const draft = assembleDraft(dealCandidate(), { hooks: [], post: '광고 아닌데 이건 진짜 짜증나서', comments: ['[링크]'], checks: [] }, { origin: ORIGIN });
  assert.equal(draft.post, `${AD_TAG} 광고 아닌데 이건 진짜 짜증나서`);
});

test('a missing link slot is added, and said so', () => {
  const draft = assembleDraft(dealCandidate(), { hooks: [], post: '본글', comments: ['끝'], checks: [] }, { origin: ORIGIN });
  assert.ok(draft.comments[0].startsWith(`끝\n${LINK}`));
  assert.ok(draft.warnings.includes('링크 자리가 없어서 마지막 댓글 끝에 붙였어요.'));
});

test('tip posts get no tag, link or disclosure', () => {
  const tip = { kind: 'tip', topic: '생수', slug: '생수' };
  const draft = assembleDraft(tip, { hooks: [], post: '생수 고를 때', comments: ['기준 [링크]', '다음 편: 세제'], checks: [] }, { origin: ORIGIN });
  assert.equal(draft.post, '생수 고를 때');
  assert.equal(draft.comments[0], '기준');
  assert.equal(draft.link, null);
  assert.ok(!draft.comments.join('\n').includes(DISCLOSURE));
});

test('pre-post check flags what the rules forbid', () => {
  const c = dealCandidate();
  const draft = assembleDraft(c, {
    hooks: [{ text: '이거 나만 몰랐던 거야?', type: '고백형', why: '' }],
    post: '물방울 생수 9,000원이면 강추\n이건 진짜 길게 늘어지는 문장이라서 스레드에서 한 줄로 읽기가 너무 힘들어',
    comments: ['내가 직접 써 보니 좋더라', '지금 둘러보세요 [링크]'],
    checks: [],
  }, { origin: ORIGIN });

  const text = draft.warnings.join('\n');
  assert.match(text, /본글이나 첫 줄 후보에 가격·할인율/);
  assert.match(text, /본글이나 첫 줄 후보에 상품명\("물방울"\)/);
  assert.match(text, /과한 표현이 있어요: 강추, 나만 몰랐던/);
  assert.match(text, /권유 말투/);
  assert.match(text, /사용 메모 없이 써 본 것처럼/);
  assert.match(text, /고백형 첫 줄은/);
  assert.match(text, /40자가 넘는 줄이 1개/, 'the disclosure line itself is not counted');
});

test('with a memo, first-hand lines are allowed', () => {
  const draft = assembleDraft(dealCandidate(), {
    hooks: [{ text: '두 달 써 보니 알겠더라', type: '고백형', why: '' }],
    post: '두 달 써 보니 알겠더라',
    comments: ['뚜껑은 좀 뻑뻑해 [링크]'],
    checks: [],
  }, { origin: ORIGIN, memo: '두 달째 씀' });
  assert.deepEqual(lintDraft(draft, dealCandidate()), []);
});

// --- end to end, with fake GitHub / Gemini and an in-memory KV ---

let geminiBodies;
let geminiReply;

function memoryKV() {
  const store = new Map();
  return { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v) };
}

beforeEach(() => {
  geminiBodies = [];
  geminiReply = {
    hooks: [{ text: '물 떨어진 거 밤에 알았어', type: '반전형', why: '공감' }],
    post: '물 떨어진 거 밤에 알았어\n또 편의점 가야 해',
    comments: ['요즘 값이 내려갔더라', '지금이 30일 중 제일 낮아\n[링크]'],
    checks: ['가격 다시 확인'],
  };
  const { prices, snapshots } = fixture();
  const files = {
    'data/priceHistory.json': JSON.stringify(prices),
    'data/topicSnapshots.json': JSON.stringify(snapshots),
    'src/content/guides/생수.md': '---\ntopic: "생수"\n---\n\n### 용량\n마시는 속도에 맞춰 고르기',
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.host === 'api.github.com') {
      const path = decodeURIComponent(url.pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''));
      return path in files ? new Response(files[path]) : new Response('not found', { status: 404 });
    }
    if (url.host === 'generativelanguage.googleapis.com') {
      geminiBodies.push(JSON.parse(init.body));
      const text = '```json\n' + JSON.stringify(geminiReply) + '\n```';
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
    }
    throw new Error(`unexpected fetch ${url}`);
  };
});

const env = () => ({ GEMINI_API_KEY: 'k', GITHUB_REPO: 'o/r', GITHUB_TOKEN: 't', STATE: memoryKV() });

test('a draft is written from live data and kept for the admin page', async () => {
  const e = env();
  const draft = await createThreadsDraft(e, { id: 'deal:1-1', memo: '', origin: ORIGIN });

  assert.equal(geminiBodies.length, 1);
  assert.equal(geminiBodies[0].generationConfig.responseMimeType, 'application/json');
  assert.ok(geminiBodies[0].contents[0].parts[0].text.includes('9,000원'));
  assert.ok(draft.post.startsWith(AD_TAG));
  assert.ok(draft.comments[1].includes(LINK));
  assert.deepEqual(draft.warnings, []);
  assert.equal((await getDrafts(e))[0].id, draft.id);
});

test('tip drafts read the guide; unknown ids are refused', async () => {
  const e = env();
  geminiReply = { hooks: [], post: '생수 살 때', comments: ['용량부터', '다음 편: 세제'], checks: [] };
  await createThreadsDraft(e, { id: 'tip:생수', origin: ORIGIN });
  const prompt = geminiBodies[0].contents[0].parts[0].text;
  assert.ok(prompt.includes('마시는 속도에 맞춰 고르기'));
  assert.ok(!prompt.includes('topic: "생수"'), 'frontmatter stripped');

  await assert.rejects(createThreadsDraft(e, { id: 'deal:9-9', origin: ORIGIN }), /후보를 찾지 못했습니다/);
  await assert.rejects(createThreadsDraft(e, { id: 'deal:5-1', origin: ORIGIN }), /후보를 찾지 못했습니다/, 'stale topic');
  assert.equal((await getDrafts(e)).length, 1);
});
