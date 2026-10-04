import topicSnapshots from '../../data/topicSnapshots.json';
import { slugify } from '../../worker/lib/slug.js';

export type SnapshotProduct = {
  productId: string;
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
