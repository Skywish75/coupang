import type { CollectionEntry } from 'astro:content';
import { getPriceStats, isTracked, productIdFromSlug, type PriceStats } from './prices';
import { shortProductName } from './names.js';

type Post = CollectionEntry<'blog'>;

// Auto posts are short summaries of Coupang product data; what makes them
// worth a search visit is the price history box. Below this many recorded
// days the box has little to show, so the post is kept out of search.
export const MIN_INDEX_DAYS = 14;

export function priceKeyOf(product: Post['data']['products'][number]): string | undefined {
  return product.priceKey ?? product.productId ?? productIdFromSlug(product.slug);
}

export function mainStats(post: Post): PriceStats | null {
  const p = post.data.products[0];
  return p ? getPriceStats(priceKeyOf(p)) : null;
}

// Posts written from real use (aiAssisted: false) are always indexed.
// Auto posts need a current, consistent price history behind them.
export function isIndexablePost(post: Post): boolean {
  if (!post.data.aiAssisted) return true;
  const s = mainStats(post);
  return Boolean(s && s.count >= MIN_INDEX_DAYS && !s.unstable && isTracked(s));
}

export function postTitle(post: Post): string {
  const p = post.data.products[0];
  if (!p || !post.data.aiAssisted) return post.data.title;
  return `${shortProductName(p.title)} ${mainStats(post) ? '가격 추이·특징 정리' : '특징·가격 정리'}`;
}

export const postUrl = (post: Post) => `/blog/${post.slug}/`;
