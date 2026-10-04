import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordPrices, serializePriceHistory, buildTopicSnapshot } from './prices.js';

const product = (id, price, extra = {}) => ({
  productId: id,
  productName: `상품 ${id}`,
  productPrice: price,
  productImage: `https://img/${id}.jpg`,
  productUrl: `https://link.coupang.com/${id}`,
  ...extra,
});

test('recordPrices appends one point per day and replaces same-day duplicates', () => {
  let h = recordPrices(null, [product(1, 1000)], '2026-10-01');
  h = recordPrices(h, [product(1, 900)], '2026-10-02');
  h = recordPrices(h, [product(1, 950)], '2026-10-02');
  assert.deepEqual(h.products['1'].history, [
    ['2026-10-01', 1000],
    ['2026-10-02', 950],
  ]);
  assert.equal(h.updatedAt, '2026-10-02');
});

test('recordPrices keeps points sorted when an earlier date is recorded later', () => {
  let h = recordPrices(null, [product(1, 1000)], '2026-10-03');
  h = recordPrices(h, [product(1, 1200)], '2026-09-30');
  h = recordPrices(h, [product(1, 1100)], '2026-10-03');
  assert.deepEqual(h.products['1'].history, [
    ['2026-09-30', 1200],
    ['2026-10-03', 1100],
  ]);
});

test('recordPrices skips invalid prices and does not mutate its input', () => {
  const before = recordPrices(null, [product(1, 1000)], '2026-10-01');
  const snapshot = JSON.stringify(before);
  const after = recordPrices(before, [product(1, 800), product(2, 0), product(3, 'abc')], '2026-10-02');
  assert.equal(JSON.stringify(before), snapshot);
  assert.deepEqual(Object.keys(after.products), ['1']);
});

test('recordPrices drops points older than 90 days and empty products', () => {
  let h = recordPrices(null, [product(1, 1000), product(2, 500)], '2026-07-01');
  h = recordPrices(h, [product(1, 1100)], '2026-09-28'); // 89 days later
  assert.deepEqual(h.products['1'].history, [
    ['2026-07-01', 1000],
    ['2026-09-28', 1100],
  ]);
  assert.ok(h.products['2']);
  // 2026-07-01 + 90 days = 2026-09-29 -> on that date the July points are gone
  h = recordPrices(h, [product(1, 1200)], '2026-09-29');
  assert.equal(h.products['2'], undefined);
  assert.deepEqual(h.products['1'].history, [
    ['2026-09-28', 1100],
    ['2026-09-29', 1200],
  ]);
});

test('serializePriceHistory round-trips and keeps one product per line', () => {
  const h = recordPrices(null, [product(1, 1000), product(2, 2000)], '2026-10-01');
  const text = serializePriceHistory(h);
  assert.deepEqual(JSON.parse(text), h);
  assert.equal(text.split('\n').filter((l) => l.includes('"history"')).length, 2);

  const empty = serializePriceHistory({ updatedAt: null, products: {} });
  assert.deepEqual(JSON.parse(empty), { updatedAt: null, products: {} });
});

test('buildTopicSnapshot keeps the top 5 by rank with slugs and flags', () => {
  const products = [6, 2, 4, 1, 5, 3].map((rank) =>
    product(100 + rank, rank * 1000, { rank, isRocket: rank === 1, isFreeShipping: rank % 2 === 0 })
  );
  const s = buildTopicSnapshot(products, { date: '2026-10-05', hasGuide: true });
  assert.equal(s.updatedAt, '2026-10-05');
  assert.equal(s.hasGuide, true);
  assert.deepEqual(s.products.map((p) => p.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(s.products[0], {
    productId: '101',
    name: '상품 101',
    price: 1000,
    image: 'https://img/101.jpg',
    slug: '상품-101-101',
    rank: 1,
    isRocket: true,
    isFreeShipping: false,
  });
});
