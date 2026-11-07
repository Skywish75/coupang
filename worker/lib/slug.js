// Shared by the worker (when writing posts/data) and the Astro site (when
// building /compare/{topic} URLs), so both sides always agree on slugs.
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Key in data/affiliateLinks.json, used as /go/{slug}.
export function productSlug(product) {
  return `${slugify(product.productName)}-${product.productId}`;
}

// Key in data/priceHistory.json. Coupang reuses one productId for every
// option of a listing (e.g. 물티슈 10개 / 20개), so the option's itemId from
// productUrl is added; without it the options' prices end up in one history.
export function priceKey(product) {
  const itemId = String(product.productUrl ?? '').match(/[?&]itemId=(\d+)/)?.[1];
  return itemId ? `${product.productId}-${itemId}` : String(product.productId ?? '');
}
