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
