import { searchProducts } from './coupang.js';
import { generateGuide } from './gemini.js';
import { getJsonFile, commitFiles } from './github.js';
import { getTopics, getNextTopic, addLog } from './state.js';
import { slugify, productSlug } from './slug.js';
import {
  recordPrices,
  serializePriceHistory,
  buildTopicSnapshot,
  topProducts,
  MAX_TRACKED_TOPICS,
} from './prices.js';

const LINKS_PATH = 'data/affiliateLinks.json';
export const PRICES_PATH = 'data/priceHistory.json';
export const SNAPSHOTS_PATH = 'data/topicSnapshots.json';

function toFrontmatterString(value) {
  return String(value).replace(/"/g, "'");
}

// Markdown turns "65~80g … 50~60g" into strikethrough (single-tilde GFM),
// hiding the text between; ranges written by Gemini need a literal "~".
export function escapeTildes(markdown) {
  return String(markdown).replace(/(^|[^\\])~/g, '$1\\~');
}

function buildGuide(topic, body, today) {
  return ['---', `topic: "${toFrontmatterString(topic)}"`, `updatedDate: ${today}`, '---', '', escapeTildes(body), ''].join('\n');
}

// One full daily cycle, committed to GitHub as a single commit (which
// triggers the connected Cloudflare Workers Build):
//  1. search every topic once and record today's prices
//  2. refresh the comparison snapshot per topic (/compare/{topic} pages)
//  3. write a buying guide for at most one topic that doesn't have one yet
// Daily single-product posts were stopped on 2026-11-07: the compare and
// price-change pages built from this data are what the site is for now.
// A Gemini failure only drops the guide; the price data is still saved.
export async function runAutoPublish(env) {
  const today = new Date().toISOString().slice(0, 10);
  // Rotates which topic goes first, so with more topics than
  // MAX_TRACKED_TOPICS each one still gets tracked in turn.
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

  let guideTopic;
  const needsGuide = tracked.find((t) => snapshots[t]?.products.length && !snapshots[t].hasGuide);
  if (needsGuide) {
    try {
      const guide = await generateGuide(env, needsGuide);
      files.push({ path: `src/content/guides/${slugify(needsGuide)}.md`, content: buildGuide(needsGuide, guide, today) });
      snapshots[needsGuide].hasGuide = true;
      guideTopic = needsGuide;
    } catch (err) {
      problems.push(`가이드 생성 실패(${needsGuide}): ${err.message}`);
    }
  }

  files.push(
    { path: LINKS_PATH, content: JSON.stringify(links, null, 2) + '\n' },
    { path: PRICES_PATH, content: serializePriceHistory(prices) },
    { path: SNAPSHOTS_PATH, content: JSON.stringify(snapshots, null, 2) + '\n' }
  );

  await commitFiles(env, { message: `chore: update price data (${today})`, files });

  const trackedCount = Object.keys(results).length;
  const reason = problems.join(' / ') || undefined;
  await addLog(env, {
    topic: `키워드 ${trackedCount}개`,
    status: 'updated',
    reason: [guideTopic && `가이드 작성: ${guideTopic}`, reason].filter(Boolean).join(' / ') || undefined,
  });

  return { status: 'updated', tracked: trackedCount, guideTopic, reason };
}
