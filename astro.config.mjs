import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from './worker/lib/slug.js';

// 사이트 주소. canonical·og·sitemap·robots.txt·RSS가 모두 이 값을 따른다.
const SITE = 'https://coupang.tclee.workers.dev';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const latest = (dates) => dates.filter(Boolean).sort().at(-1);

// <lastmod> per page, from the data that page is built from.
const snapshots = read('./data/topicSnapshots.json');
const compareDates = Object.fromEntries(Object.entries(snapshots).map(([t, s]) => [slugify(t), s.updatedAt]));
const latestCompare = latest(Object.values(snapshots).map((s) => s.updatedAt));
const latestDraw = latest(Object.values(read('./data/lottoResults.json')).map((r) => r.date));
const latestPrices = read('./data/priceHistory.json').updatedAt;
const latestPost = latest(
  fs.readdirSync(new URL('./src/content/blog/', import.meta.url)).map((f) => f.slice(0, 10))
);

function lastmodFor(pathname) {
  const post = pathname.match(/^\/blog\/(\d{4}-\d{2}-\d{2})-/);
  if (post) return post[1];
  const compare = pathname.match(/^\/compare\/([^/]+)\/$/);
  if (compare) return compareDates[compare[1]];
  if (pathname === '/lotto/') return latestDraw;
  if (pathname === '/price-changes/') return latestPrices;
  if (pathname === '/blog/') return latestPost;
  if (pathname === '/' || pathname === '/compare/') return latest([latestPost, latestCompare]);
  return undefined;
}

// Pages decide noindex themselves (src/lib/posts.ts); the sitemap just leaves
// out whatever was built with a robots noindex tag.
const DIST = fileURLToPath(new URL('./dist/', import.meta.url));
function isNoindex(pathname) {
  try {
    return fs
      .readFileSync(path.join(DIST, pathname, 'index.html'), 'utf8')
      .includes('<meta name="robots" content="noindex');
  } catch {
    console.warn('[sitemap] built page not found:', pathname);
    return false;
  }
}

export default defineConfig({
  site: SITE,
  output: 'static',
  integrations: [
    sitemap({
      serialize(item) {
        const pathname = decodeURIComponent(new URL(item.url).pathname);
        if (isNoindex(pathname)) return undefined;
        const lastmod = lastmodFor(pathname);
        return lastmod ? { ...item, lastmod } : item;
      },
    }),
  ],
});
