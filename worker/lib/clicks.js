import { kstDate, shiftDate } from './dates.js';

// Affiliate link clicks (/go/{slug}), counted per KST day, slug and the page
// on this site the click came from. Stored in D1 (binding DB, see
// migrations/0001_clicks.sql).

// Crawlers and link-preview fetchers that follow links without a person
// clicking. Yeti = Naver, Daumoa = Daum, kakaotalk-scrap = KakaoTalk preview.
const NON_HUMAN_UA =
  /bot|crawl|spider|slurp|yeti|daumoa|kakaotalk-scrap|facebookexternalhit|preview|headless|curl|wget|python|go-http|java\//i;

export function isCountableClick(request) {
  if (request.method !== 'GET') return false;
  const ua = request.headers.get('User-Agent') || '';
  return ua !== '' && !NON_HUMAN_UA.test(ua);
}

// Path of the page on this site that linked to /go/, e.g. "/blog/2026-10-03-가습기-1/".
export function sourcePage(request) {
  const referer = request.headers.get('Referer');
  if (!referer) return '';
  try {
    const ref = new URL(referer);
    if (ref.host !== new URL(request.url).host) return '';
    return decodeURIComponent(ref.pathname).slice(0, 200);
  } catch {
    return '';
  }
}

export async function recordClick(env, request, slug) {
  if (!env.DB || !isCountableClick(request)) return;
  await env.DB.prepare(
    `INSERT INTO clicks (day, slug, page, count) VALUES (?1, ?2, ?3, 1)
     ON CONFLICT (day, slug, page) DO UPDATE SET count = count + 1`
  )
    .bind(kstDate(), slug, sourcePage(request))
    .run();
}

// Totals for the admin dashboard over the last `days` days (KST).
export async function getClickStats(env, days = 30) {
  if (!env.DB) return null;
  const today = kstDate();
  const from = shiftDate(today, -(days - 1));
  const week = shiftDate(today, -6);

  const [byDay, topSlugs, topPages] = await env.DB.batch([
    env.DB.prepare('SELECT day, SUM(count) AS n FROM clicks WHERE day >= ?1 GROUP BY day').bind(from),
    env.DB.prepare(
      'SELECT slug, SUM(count) AS n FROM clicks WHERE day >= ?1 GROUP BY slug ORDER BY n DESC LIMIT 10'
    ).bind(from),
    env.DB.prepare(
      'SELECT page, SUM(count) AS n FROM clicks WHERE day >= ?1 GROUP BY page ORDER BY n DESC LIMIT 10'
    ).bind(from),
  ]);

  const perDay = Object.fromEntries(byDay.results.map((r) => [r.day, r.n]));
  const sum = (since) =>
    Object.entries(perDay).reduce((total, [day, n]) => (day >= since ? total + n : total), 0);

  return {
    perDay,
    today: perDay[today] ?? 0,
    last7: sum(week),
    last30: sum(from),
    topSlugs: topSlugs.results,
    topPages: topPages.results,
  };
}
