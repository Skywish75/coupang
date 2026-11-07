import { productSlug, priceKey } from './slug.js';
import { shiftDate } from './dates.js';

// Daily price points older than this are dropped, and products with no
// points left are removed, so data/priceHistory.json stays small.
const HISTORY_DAYS = 90;

// Products shown per topic on the /compare/{topic} pages.
export const TOP_N = 5;

// Upper bound on Coupang search calls per run (one per topic). The search
// API is rate limited, so extra topics are simply not tracked that day.
export const MAX_TRACKED_TOPICS = 8;

// history shape: { updatedAt, products: { [priceKey]: { name, productId, history: [[date, price], ...] } } }
// priceKey is "{productId}-{itemId}" (one entry per option, see slug.js).
// Points are kept sorted by date; recording the same product twice on one
// date keeps only the latest price.
export function recordPrices(history, products, date) {
  const next = { updatedAt: date, products: { ...(history?.products ?? {}) } };

  for (const product of products) {
    const pid = String(product.productId ?? '');
    const id = priceKey(product);
    const price = Number(product.productPrice);
    if (!pid || !Number.isFinite(price) || price <= 0) continue;

    // Older data was keyed by productId alone. Carry that history over only
    // when it was recorded under this exact option name.
    const legacy = next.products[pid];
    if (id !== pid && !next.products[id] && legacy?.name === product.productName) {
      next.products[id] = legacy;
      delete next.products[pid];
    }

    const prev = next.products[id];
    const points = (prev ? prev.history : []).filter(([d]) => d !== date);
    points.push([date, price]);
    points.sort(([a], [b]) => a.localeCompare(b));
    next.products[id] = { name: product.productName, productId: pid, history: points };
  }

  const cutoff = shiftDate(date, -HISTORY_DAYS);
  for (const [id, entry] of Object.entries(next.products)) {
    const kept = entry.history.filter(([d]) => d > cutoff);
    if (kept.length) {
      next.products[id] = { ...entry, history: kept };
    } else {
      delete next.products[id];
    }
  }

  return next;
}

// One product per line keeps the daily git diffs readable.
export function serializePriceHistory(history) {
  const lines = Object.entries(history.products).map(
    ([id, entry]) => `    ${JSON.stringify(id)}: ${JSON.stringify(entry)}`
  );
  return [
    '{',
    `  "updatedAt": ${JSON.stringify(history.updatedAt)},`,
    '  "products": {',
    lines.join(',\n'),
    '  }',
    '}',
    '',
  ].join('\n');
}

// Search results come back in Coupang's ranking order; `rank` is used when
// present in case the API ever returns them unordered.
export function topProducts(products, n = TOP_N) {
  return [...products]
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
    .slice(0, n);
}

export function buildTopicSnapshot(products, { date, hasGuide }) {
  return {
    updatedAt: date,
    hasGuide: Boolean(hasGuide),
    products: topProducts(products).map((p, i) => ({
      productId: String(p.productId),
      priceKey: priceKey(p),
      name: p.productName,
      price: Number(p.productPrice),
      image: p.productImage,
      slug: productSlug(p),
      rank: p.rank ?? i + 1,
      isRocket: Boolean(p.isRocket),
      isFreeShipping: Boolean(p.isFreeShipping),
    })),
  };
}
