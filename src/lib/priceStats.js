// Shared by the site and the worker (plain JS so both can import it).
// The site passes the bundled data/priceHistory.json; the admin page passes
// the copy it reads live from GitHub. Typed wrappers live in prices.ts.

const WINDOW_DAYS = 30;
// Below this many recorded days, min/avg aren't meaningful yet.
const MIN_POINTS_FOR_VERDICT = 3;

export function daysBefore(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// `key` is a priceKey ("{productId}-{itemId}") or, for posts written before
// option keys existed, a bare productId. A bare productId is only resolved
// when exactly one option of it is tracked — never guess between options.
function findEntry(data, key) {
  if (!key) return undefined;
  const products = data?.products ?? {};
  if (products[key]) return products[key];
  const options = Object.entries(products).filter(([k]) => k.startsWith(`${key}-`));
  return options.length === 1 ? options[0][1] : undefined;
}

// Stats over the last 30 days ending at the product's latest recorded price.
export function priceStats(data, key) {
  const entry = findEntry(data, key);
  if (!entry?.history?.length) return null;

  const history = [...entry.history].sort(([a], [b]) => a.localeCompare(b));
  const [currentDate, current] = history[history.length - 1];
  const from = daysBefore(currentDate, WINDOW_DAYS - 1);
  const series = history.filter(([d]) => d >= from);
  const prices = series.map(([, p]) => p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);

  // Price swung 2x or more within 30 days: usually Coupang switched the
  // option or seller behind the listing, so min/avg aren't comparable.
  const unstable = max >= min * 2;
  let verdict = null;
  if (unstable) {
    verdict = { label: '가격 변동 폭이 커서(옵션·판매자 변경 가능성) 최저가 비교는 생략했어요', tone: 'neutral' };
  } else if (series.length >= MIN_POINTS_FOR_VERDICT) {
    if (min === max) verdict = { label: '최근 30일 동안 가격 변동이 없었어요', tone: 'neutral' };
    else if (current <= min) verdict = { label: '지금이 최근 30일 최저가예요', tone: 'good' };
    else if (current < avg) verdict = { label: '최근 30일 평균보다 저렴해요', tone: 'good' };
    else if (current > avg * 1.05) verdict = { label: '최근 30일 평균보다 비싼 편이에요', tone: 'bad' };
    else verdict = { label: '최근 30일 평균 수준이에요', tone: 'neutral' };
  }

  return { current, currentDate, min, max, avg, count: series.length, series, unstable, verdict };
}

// How far below its own 30-day average a product is now, in whole percent,
// or null when that isn't a meaningful "cheaper than usual": too few days,
// a 2x+ swing (option/seller change), or under 3% below average.
export function discountPct(stats) {
  if (!stats || stats.count < 7 || stats.unstable || stats.current >= stats.avg) return null;
  const pct = Math.round((1 - stats.current / stats.avg) * 100);
  return pct >= 3 ? pct : null;
}

// At its lowest recorded price of the last 30 days (and the price did move).
export function isAtLow(stats) {
  return Boolean(stats && stats.count >= 7 && !stats.unstable && stats.max > stats.min && stats.current <= stats.min);
}

// Change over the last 7 days, from the earliest price recorded in that
// window to today's. null when the product wasn't recorded on the latest run,
// has a single point in the window, or swung 2x+ within 30 days.
export function weekChange(data, key) {
  const stats = priceStats(data, key);
  const updatedAt = data?.updatedAt;
  if (!stats || !updatedAt || stats.currentDate !== updatedAt || stats.unstable) return null;
  const from = daysBefore(updatedAt, 7);
  const week = stats.series.filter(([d]) => d >= from);
  if (week.length < 2) return null;
  const [fromDate, fromPrice] = week[0];
  const diff = stats.current - fromPrice;
  return { fromDate, fromPrice, toPrice: stats.current, diff, pct: Math.round((diff / fromPrice) * 1000) / 10 };
}
