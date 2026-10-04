import { getJsonFile, listDirectory } from './github.js';
import { getTopics, getLogs } from './state.js';
import { PRICES_PATH, SNAPSHOTS_PATH } from './publish.js';
import { slugify } from './slug.js';
import { kstDate, shiftDate } from './dates.js';

// "2026-10-03-캠핑-의자-8410785098.md" -> { date: '2026-10-03', topicSlug: '캠핑-의자' }
export function parsePostFile(name) {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})-(.+)-\d+\.md$/);
  return m ? { date: m[1], topicSlug: m[2] } : null;
}

export function summarizePosts(fileNames, topics, today) {
  const posts = fileNames.map(parsePostFile).filter(Boolean);
  const topicBySlug = Object.fromEntries(topics.map((t) => [slugify(t), t]));
  const since = (days) => posts.filter((p) => p.date >= shiftDate(today, -(days - 1))).length;

  const byTopic = {};
  const perDay = {};
  for (const { date, topicSlug } of posts) {
    const topic = topicBySlug[topicSlug] ?? topicSlug;
    byTopic[topic] ??= { topic, count: 0, lastDate: '' };
    byTopic[topic].count += 1;
    if (date > byTopic[topic].lastDate) byTopic[topic].lastDate = date;
    perDay[date] = (perDay[date] ?? 0) + 1;
  }

  // Current topics first (in admin order, even with 0 posts), then any
  // topics that were removed but still have posts.
  const ordered = [
    ...topics.map((t) => byTopic[t] ?? { topic: t, count: 0, lastDate: '' }),
    ...Object.values(byTopic).filter((t) => !topics.includes(t.topic)),
  ];

  return { total: posts.length, last7: since(7), last30: since(30), byTopic: ordered, perDay };
}

// Everything the admin dashboard shows, read live from the GitHub repo (so
// it includes commits that haven't finished deploying yet) and KV.
export async function getSiteStats(env) {
  const today = kstDate();
  const [files, prices, snapshots, topics, logs] = await Promise.all([
    listDirectory(env, 'src/content/blog'),
    getJsonFile(env, PRICES_PATH, { products: {} }),
    getJsonFile(env, SNAPSHOTS_PATH, {}),
    getTopics(env),
    getLogs(env),
  ]);

  const snapshotList = Object.entries(snapshots).filter(([, s]) => s.products?.length);
  return {
    today,
    posts: summarizePosts(files, topics, today),
    trackedProducts: Object.keys(prices.products ?? {}).length,
    pricesUpdatedAt: prices.updatedAt ?? null,
    comparisons: Object.fromEntries(snapshotList),
    comparisonCount: snapshotList.length,
    guideCount: snapshotList.filter(([, s]) => s.hasGuide).length,
    lastRun: logs[0] ?? null,
  };
}
