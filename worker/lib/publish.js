import { searchProducts } from './coupang.js';
import { generateArticle, generateGuide } from './gemini.js';
import { getJsonFile, commitFiles } from './github.js';
import { getTopics, getNextTopic, isAlreadyPosted, markPosted, addLog } from './state.js';
import { slugify, productSlug } from './slug.js';
import {
  recordPrices,
  serializePriceHistory,
  buildTopicSnapshot,
  topProducts,
  MAX_TRACKED_TOPICS,
} from './prices.js';

const LINKS_PATH = 'data/affiliateLinks.json';
const PRICES_PATH = 'data/priceHistory.json';
const SNAPSHOTS_PATH = 'data/topicSnapshots.json';

function toFrontmatterString(value) {
  return String(value).replace(/"/g, "'");
}

async function pickUnpostedProduct(env, products) {
  for (const product of products) {
    if (!(await isAlreadyPosted(env, String(product.productId)))) {
      return product;
    }
  }
  return null;
}

function buildPost(product, topic, body, today) {
  const name = toFrontmatterString(product.productName);
  const frontmatter = [
    '---',
    `title: "${name} 특징·가격 정리"`,
    `description: "${toFrontmatterString(topic)} 상품 ${name}의 특징과 가격 정보를 정리했습니다."`,
    `pubDate: ${today}`,
    `tags: ["${toFrontmatterString(topic)}"]`,
    'hasAffiliateLinks: true',
    'aiAssisted: true',
    'products:',
    `  - slug: ${productSlug(product)}`,
    `    productId: "${product.productId}"`,
    `    title: "${name}"`,
    `    price: "${Number(product.productPrice).toLocaleString('ko-KR')}원"`,
    `    description: "${toFrontmatterString(topic)} 카테고리 상품"`,
    `    image: "${toFrontmatterString(product.productImage)}"`,
    '---',
    '',
  ].join('\n');
  return frontmatter + body + '\n';
}

function buildGuide(topic, body, today) {
  return ['---', `topic: "${toFrontmatterString(topic)}"`, `updatedDate: ${today}`, '---', '', body, ''].join('\n');
}

// One full daily cycle, committed to GitHub as a single commit (which
// triggers the connected Cloudflare Workers Build):
//  1. search every topic once and record today's prices
//  2. refresh the top-N comparison snapshot per topic
//  3. publish one product post for today's topic (round-robin)
//  4. write a buying guide for at most one topic that doesn't have one yet
// Gemini failures only drop the post/guide; the price data is still saved.
export async function runAutoPublish(env) {
  const today = new Date().toISOString().slice(0, 10);
  const topic = await getNextTopic(env);
  const topics = await getTopics(env);
  const tracked = [topic, ...topics.filter((t) => t !== topic)].slice(0, MAX_TRACKED_TOPICS);

  const [links, priceHistory, snapshots] = await Promise.all([
    getJsonFile(env, LINKS_PATH, {}),
    getJsonFile(env, PRICES_PATH, { updatedAt: null, products: {} }),
    getJsonFile(env, SNAPSHOTS_PATH, {}),
  ]);

  const results = {};
  const problems = [];
  for (const t of tracked) {
    try {
      results[t] = await searchProducts(env, t, 10);
    } catch (err) {
      problems.push(`검색 실패(${t}): ${err.message}`);
    }
  }
  if (Object.keys(results).length === 0) {
    throw new Error(problems.join(' / '));
  }

  // Topics removed in the admin page shouldn't keep a stale /compare page.
  for (const t of Object.keys(snapshots)) {
    if (!topics.includes(t)) delete snapshots[t];
  }

  let prices = priceHistory;
  for (const [t, products] of Object.entries(results)) {
    prices = recordPrices(prices, products, today);
    snapshots[t] = buildTopicSnapshot(products, { date: today, hasGuide: snapshots[t]?.hasGuide });
    // Products returned by the authenticated search API already carry our
    // own affiliate tag (lptag=...) in productUrl, so they work as-is —
    // running them back through the deeplink-conversion endpoint rejects
    // them with "url convert failed".
    for (const p of topProducts(products)) {
      links[productSlug(p)] = { url: p.productUrl, name: p.productName };
    }
  }

  const files = [];

  // A search failure for today's topic is already recorded in `problems`.
  let post = null;
  const selected = results[topic] ? await pickUnpostedProduct(env, results[topic]) : null;
  if (results[topic] && !selected) {
    problems.push('새로 소개할 상품 없음');
  }
  if (selected) {
    try {
      const body = await generateArticle(env, selected, topic);
      const postSlug = `${today}-${slugify(topic)}-${selected.productId}`;
      files.push({ path: `src/content/blog/${postSlug}.md`, content: buildPost(selected, topic, body, today) });
      links[productSlug(selected)] = { url: selected.productUrl, name: selected.productName };
      post = { product: selected, postSlug };
    } catch (err) {
      problems.push(`글 생성 실패: ${err.message}`);
    }
  }

  // After the post, so the day's post gets first use of Gemini's quota.
  const guideTopic = tracked.find((t) => snapshots[t]?.products.length && !snapshots[t].hasGuide);
  if (guideTopic) {
    try {
      const guide = await generateGuide(env, guideTopic);
      files.push({ path: `src/content/guides/${slugify(guideTopic)}.md`, content: buildGuide(guideTopic, guide, today) });
      snapshots[guideTopic].hasGuide = true;
    } catch (err) {
      problems.push(`가이드 생성 실패(${guideTopic}): ${err.message}`);
    }
  }

  files.push(
    { path: LINKS_PATH, content: JSON.stringify(links, null, 2) + '\n' },
    { path: PRICES_PATH, content: serializePriceHistory(prices) },
    { path: SNAPSHOTS_PATH, content: JSON.stringify(snapshots, null, 2) + '\n' }
  );

  await commitFiles(env, {
    message: post
      ? `chore: auto-publish post for "${topic}" (${post.product.productName})`
      : `chore: update price data (${today})`,
    files,
  });

  if (post) {
    await markPosted(env, String(post.product.productId));
  }
  const reason = problems.join(' / ') || undefined;
  await addLog(env, {
    topic,
    status: post ? 'published' : 'skipped',
    productName: post?.product.productName,
    postSlug: post?.postSlug,
    tracked: Object.keys(results).length,
    reason,
  });

  return {
    status: post ? 'published' : 'skipped',
    topic,
    productName: post?.product.productName,
    postSlug: post?.postSlug,
    reason,
  };
}
