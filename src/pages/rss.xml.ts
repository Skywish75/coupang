import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { isIndexablePost, postTitle, postUrl } from '../lib/posts';
import { SITE_NAME } from '../lib/seo';

// Submitted to Naver Search Advisor; only posts that are open to search.
export async function GET(context: APIContext) {
  const posts = (await getCollection('blog'))
    .filter(isIndexablePost)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
    .slice(0, 30);
  return rss({
    title: SITE_NAME,
    description: '쿠팡 인기 상품 가격 추이와 카테고리별 가격 비교',
    site: context.site!,
    items: posts.map((post) => ({
      title: postTitle(post),
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: postUrl(post),
    })),
    customData: '<language>ko-kr</language>',
  });
}
