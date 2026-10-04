import { productSlug } from './slug.js';

// Daily price points older than this are dropped, and products with no
// points left are removed, so data/priceHistory.json stays small.
const HISTORY_DAYS = 90;

// Products shown per topic on the /compare/{topic} pages.
export const TOP_N = 5;

// Upper bound on Coupang search calls per run (one per topic). The search
// API is rate limited, so extra topics are simply not tracked that day.
export const MAX_TRACKED_TOPICS = 8;

function shiftDate(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// history shape: { updatedAt, products: { [productId]: { name, history: [[date, price], ...] } } }
// Points are kept sorted by date; recording the same product twice on one
// date keeps only the latest price.
export function recordPrices(history, products, date) {
  const next = { updatedAt: date, products: { ...(history?.products ?? {}) } };

  for (const product of products) {
    const id = String(product.productId ?? '');
    const price = Number(product.productPrice);
    if (!id || !Number.isFinite(price) || price <= 0) continue;

    const prev = next.products[id];
    const points = (prev ? prev.history : []).filter(([d]) => d !== date);
    points.push([date, price]);
    points.sort(([a], [b]) => a.localeCompare(b));
    next.products[id] = { name: product.productName, history: points };
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
