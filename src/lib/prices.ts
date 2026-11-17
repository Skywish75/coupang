import priceHistory from '../../data/priceHistory.json';
import * as shared from './priceStats.js';

type Point = [date: string, price: number];
type Entry = { name: string; productId?: string; history: Point[] };
type History = { updatedAt: string | null; products: Record<string, Entry> };

const data = priceHistory as unknown as History;

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

// Stats over the last 30 days ending at the product's latest recorded price
// (logic in priceStats.js, shared with the admin page).
export function getPriceStats(key: string | undefined): PriceStats | null {
  return shared.priceStats(data, key) as PriceStats | null;
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
  return Boolean(stats && data.updatedAt && stats.currentDate >= shared.daysBefore(data.updatedAt, maxAgeDays));
}

// How far below its own 30-day average a product is now, in whole percent,
// or null when that isn't a meaningful "cheaper than usual": too few days,
// a 2x+ swing (option/seller change), or under 3% below average.
// Used by the home page, the compare pages and the price-change page alike.
export const discountPct: (stats: PriceStats | null) => number | null = shared.discountPct;

// At its lowest recorded price of the last 30 days (and the price did move).
export const isAtLow: (stats: PriceStats | null) => boolean = shared.isAtLow;

// Date of the latest daily price run.
export const pricesUpdatedAt: string | null = data.updatedAt;

export type WeekChange = { fromDate: string; fromPrice: number; toPrice: number; diff: number; pct: number };

// Change over the last 7 days, from the earliest price recorded in that
// window to today's. null when the product wasn't recorded today, has a
// single point in the window, or swung 2x+ within 30 days (see `unstable`).
export function weekChange(key: string | undefined): WeekChange | null {
  return shared.weekChange(data, key);
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
