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
