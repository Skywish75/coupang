import priceHistory from '../../data/priceHistory.json';

type Point = [date: string, price: number];
type Entry = { name: string; productId?: string; history: Point[] };
type History = { updatedAt: string | null; products: Record<string, Entry> };

const data = priceHistory as unknown as History;

const WINDOW_DAYS = 30;
// Below this many recorded days, min/avg aren't meaningful yet.
const MIN_POINTS_FOR_VERDICT = 3;

export type PriceStats = {
  current: number;
  currentDate: string;
  min: number;
  max: number;
  avg: number;
  count: number;
  series: Point[];
  // Price swung 2x or more within 30 days: usually Coupang switched the
  // option or seller behind the listing, so min/avg aren't comparable.
  unstable: boolean;
  verdict: { label: string; tone: 'good' | 'neutral' | 'bad' } | null;
};

export function productIdFromSlug(slug: string): string | undefined {
  return slug.match(/-(\d+)$/)?.[1];
}

function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// `key` is a priceKey ("{productId}-{itemId}") or, for posts written before
// option keys existed, a bare productId. A bare productId is only resolved
// when exactly one option of it is tracked — never guess between options.
function findEntry(key: string | undefined): Entry | undefined {
  if (!key) return undefined;
  if (data.products[key]) return data.products[key];
  const options = Object.entries(data.products).filter(([k]) => k.startsWith(`${key}-`));
  return options.length === 1 ? options[0][1] : undefined;
}

// Stats over the last 30 days ending at the product's latest recorded price.
export function getPriceStats(key: string | undefined): PriceStats | null {
  const entry = findEntry(key);
  if (!entry?.history.length) return null;

  const history = [...entry.history].sort(([a], [b]) => a.localeCompare(b));
  const [currentDate, current] = history[history.length - 1];
  const from = daysBefore(currentDate, WINDOW_DAYS - 1);
  const series = history.filter(([d]) => d >= from);
  const prices = series.map(([, p]) => p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);

  const unstable = max >= min * 2;
  let verdict: PriceStats['verdict'] = null;
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

export function formatWon(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`;
}

export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00+09:00`).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
}

// True when the product was still in a recent daily search (it drops out of
// tracking once it leaves the topic's top results).
export function isTracked(stats: PriceStats | null, maxAgeDays = 3): boolean {
  return Boolean(stats && data.updatedAt && stats.currentDate >= daysBefore(data.updatedAt, maxAgeDays));
}

// How far below its own 30-day average a product is now, in whole percent,
// or null when that isn't a meaningful "cheaper than usual": too few days,
// a 2x+ swing (option/seller change), or under 3% below average.
// Used by the home page, the compare pages and the price-change page alike.
export function discountPct(stats: PriceStats | null): number | null {
  if (!stats || stats.count < 7 || stats.unstable || stats.current >= stats.avg) return null;
  const pct = Math.round((1 - stats.current / stats.avg) * 100);
  return pct >= 3 ? pct : null;
}

// At its lowest recorded price of the last 30 days (and the price did move).
export function isAtLow(stats: PriceStats | null): boolean {
  return Boolean(stats && stats.count >= 7 && !stats.unstable && stats.max > stats.min && stats.current <= stats.min);
}

// Date of the latest daily price run.
export const pricesUpdatedAt: string | null = data.updatedAt;

export type WeekChange = { fromDate: string; fromPrice: number; toPrice: number; diff: number; pct: number };

// Change over the last 7 days, from the earliest price recorded in that
// window to today's. null when the product wasn't recorded today, has a
// single point in the window, or swung 2x+ within 30 days (see `unstable`).
export function weekChange(key: string | undefined): WeekChange | null {
  const stats = getPriceStats(key);
  if (!stats || !data.updatedAt || stats.currentDate !== data.updatedAt || stats.unstable) return null;
  const from = daysBefore(data.updatedAt, 7);
  const week = stats.series.filter(([d]) => d >= from);
  if (week.length < 2) return null;
  const [fromDate, fromPrice] = week[0];
  const diff = stats.current - fromPrice;
  return { fromDate, fromPrice, toPrice: stats.current, diff, pct: Math.round((diff / fromPrice) * 1000) / 10 };
}

// Polyline points for a small price chart: x follows the real date gaps,
// y spans the series' own min..max. null with fewer than 2 points.
export function sparkline(series: Point[], w: number, h: number, pad: number) {
  if (series.length < 2) return null;
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const t0 = t(series[0][0]);
  const span = Math.max(t(series[series.length - 1][0]) - t0, 1);
  const prices = series.map(([, p]) => p);
  const min = Math.min(...prices);
  const range = Math.max(...prices) - min;
  const xy = series.map(([d, p]) => ({
    x: pad + ((t(d) - t0) / span) * (w - pad * 2),
    y: range === 0 ? h / 2 : pad + (1 - (p - min) / range) * (h - pad * 2),
  }));
  return {
    points: xy.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '),
    last: xy[xy.length - 1],
  };
}

// "11월 7일" (for titles and descriptions; formatDate gives "2026. 11. 7.").
export function formatMonthDay(date: string): string {
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
}
