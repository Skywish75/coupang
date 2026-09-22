import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.date(),
    updatedDate: z.date().optional(),
    tags: z.array(z.string()).default([]),
    hasAffiliateLinks: z.boolean().default(true),
    // Products referenced in the post, rendered as affiliate CTA cards.
    // `slug` maps to a key in /data/affiliateLinks.json (via /go/{slug}).
    products: z
      .array(
        z.object({
          slug: z.string(),
          title: z.string(),
          price: z.string().optional(),
          description: z.string().optional(),
        })
      )
      .default([]),
  }),
});

export const collections = { blog };
