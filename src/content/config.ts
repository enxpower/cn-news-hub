// Content collection schema for aggregated news articles.
// Articles are generated automatically by scripts/fetch-news.mjs and
// committed as Markdown files with frontmatter matching this schema.
import { defineCollection, z } from 'astro:content';

const articles = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    // Display name of the original source, e.g. "美国之音中文网"
    sourceName: z.string(),
    // Canonical URL of the original article (for attribution + dedupe)
    sourceUrl: z.string().url(),
    // Category id, must match an entry in site.config.json -> categories
    category: z.string(),
    // Absolute image URL extracted from the RSS item, if any
    image: z.string().optional(),
    // Short plain-text summary used on list cards and as og:description
    description: z.string(),
  }),
});

export const collections = { articles };
