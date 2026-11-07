import topicSnapshots from '../../data/topicSnapshots.json';
import { slugify } from '../../worker/lib/slug.js';
import { getPriceStats, discountPct, isAtLow, type PriceStats } from './prices';
import { unitKindsForTopic, unitPrice, UNIT_KINDS } from './units.js';

export type SnapshotProduct = {
  productId: string;
  // Key in priceHistory.json (productId + option); missing in older snapshots.
  priceKey?: string;
  name: string;
  price: number;
  image?: string;
  slug: string;
  rank: number;
  isRocket: boolean;
  isFreeShipping: boolean;
};

export type Comparison = {
  topic: string;
  slug: string;
  updatedAt: string;
  products: SnapshotProduct[];
};

type Snapshot = { updatedAt: string; hasGuide?: boolean; products: SnapshotProduct[] };

// Written daily by the worker (see worker/lib/publish.js).
const snapshots = topicSnapshots as unknown as Record<string, Snapshot>;

export function getComparisons(): Comparison[] {
  return Object.entries(snapshots)
    .filter(([, s]) => s.products?.length)
    .map(([topic, s]) => ({ topic, slug: slugify(topic), updatedAt: s.updatedAt, products: s.products }));
}

export function getComparisonForTopic(topic: string): Comparison | undefined {
  return getComparisons().find((c) => c.topic === topic);
}

// "1매당 가격" for wipes, "100ml당 가격" for water, "단위 가격" for topics
// compared by more than one unit (detergent: ml, g or capsules), or null.
export function unitHeading(topic: string): string | null {
  const kinds = unitKindsForTopic(topic) as (keyof typeof UNIT_KINDS)[];
  if (kinds.length === 0) return null;
  return kinds.length === 1 ? `${UNIT_KINDS[kinds[0]].label} 가격` : '단위 가격';
}

// Page title of /compare/{topic}/, also used as the link text to it.
export function compareTitle(c: Comparison): string {
  const unit = unitHeading(c.topic);
  return unit ? `${c.topic} 가격 비교: ${unit}·30일 최저가` : `${c.topic} 가격 비교: 인기 ${c.products.length}개 30일 최저가`;
}

export type Unit = { kind: keyof typeof UNIT_KINDS; label: string; quantity: number; value: number };

export type CompareRow = SnapshotProduct & {
  stats: PriceStats | null;
  // Price per sheet/100ml/… from the product name; null if it doesn't say.
  unit: Unit | null;
  // Lowest unit price among the products compared by the same unit.
  cheapestUnit: boolean;
  // % below its own 30-day average (see discountPct), or null.
  discount: number | null;
  atLow: boolean;
};

export function compareRows(c: Comparison): CompareRow[] {
  const kinds = unitKindsForTopic(c.topic);
  const rows: CompareRow[] = c.products.map((p) => {
    const stats = getPriceStats(p.priceKey ?? p.productId);
    return {
      ...p,
      stats,
      unit: unitPrice(p.name, p.price, kinds) as Unit | null,
      cheapestUnit: false,
      discount: discountPct(stats),
      atLow: isAtLow(stats),
    };
  });
  // "Cheapest" only means something with at least two products to compare.
  for (const kind of kinds) {
    const same = rows.filter((r) => r.unit?.kind === kind);
    if (same.length < 2) continue;
    const best = Math.min(...same.map((r) => r.unit!.value));
    for (const r of same) r.cheapestUnit = r.unit!.value === best;
  }
  return rows;
}
