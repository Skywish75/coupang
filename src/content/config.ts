import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.date(),
    updatedDate: z.date().optional(),
    tags: z.array(z.string()).default([]),
    hasAffiliateLinks: z.boolean().default(true),
    // Auto-published posts are written by Gemini from product data only.
    // Set to false for posts based on actually using the product.
    aiAssisted: z.boolean().default(true),
    // Products referenced in the post, rendered as affiliate CTA cards.
    // `slug` maps to a key in /data/affiliateLinks.json (via /go/{slug}).
    products: z
      .array(
        z.object({
          slug: z.string(),
          // Coupang product id, used to look up /data/priceHistory.json.
          // Older posts omit it; it's then parsed from the slug suffix.
          productId: z.string().optional(),
          title: z.string(),
          price: z.string().optional(),
          description: z.string().optional(),
          image: z.string().optional(),
        })
      )
      .default([]),
  }),
});

// Buying guides shown on /compare/{topic}, one per topic, written by the
// worker the first time a topic is tracked.
const guides = defineCollection({
  schema: z.object({
    topic: z.string(),
    updatedDate: z.date(),
  }),
});

export const collections = { blog, guides };
