import priceHistory from '../../data/priceHistory.json';

type Point = [date: string, price: number];
type History = { updatedAt: string | null; products: Record<string, { name: string; history: Point[] }> };

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

// Stats over the last 30 days ending at the product's latest recorded price.
export function getPriceStats(productId: string | undefined): PriceStats | null {
  const entry = productId ? data.products[productId] : undefined;
  if (!entry?.history.length) return null;

  const history = [...entry.history].sort(([a], [b]) => a.localeCompare(b));
  const [currentDate, current] = history[history.length - 1];
  const from = daysBefore(currentDate, WINDOW_DAYS - 1);
  const series = history.filter(([d]) => d >= from);
  const prices = series.map(([, p]) => p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);

  let verdict: PriceStats['verdict'] = null;
  if (series.length >= MIN_POINTS_FOR_VERDICT) {
    if (min === max) verdict = { label: '최근 30일 동안 가격 변동이 없었어요', tone: 'neutral' };
    else if (current <= min) verdict = { label: '지금이 최근 30일 최저가예요', tone: 'good' };
    else if (current < avg) verdict = { label: '최근 30일 평균보다 저렴해요', tone: 'good' };
    else if (current > avg * 1.05) verdict = { label: '최근 30일 평균보다 비싼 편이에요', tone: 'bad' };
    else verdict = { label: '최근 30일 평균 수준이에요', tone: 'neutral' };
  }

  return { current, currentDate, min, max, avg, count: series.length, series, verdict };
}

export function formatWon(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`;
}

export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00+09:00`).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
}
