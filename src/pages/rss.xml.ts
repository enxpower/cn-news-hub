// RSS 2.0 feed endpoint - /rss.xml
// Serves the 50 most recent articles across all categories.
// This feed is the primary content-discovery signal for:
//   - RSS readers and aggregators
//   - AI indexers (Perplexity, ChatGPT browsing, etc.)
//   - Other news aggregators that respect standard feed formats
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import siteConfig from '../../site.config.json';

export async function GET(context: APIContext) {
  const entries = await getCollection('articles');
  const sorted = entries.sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
  ).slice(0, 50);

  const siteOrigin = import.meta.env.SITE_URL || siteConfig.site.url;

  return rss({
    title: siteConfig.site.name,
    description: siteConfig.site.description,
    site: context.site?.toString() ?? siteOrigin,
    customData: `<language>${siteConfig.site.lang}</language>`,
    items: sorted.map((entry) => ({
      title: entry.data.title,
      pubDate: entry.data.pubDate,
      description: entry.data.description,
      link: `${siteOrigin}/article/${entry.slug}/`,
      categories: [
        siteConfig.categories.find((c) => c.id === entry.data.category)?.label ?? entry.data.category,
      ],
      author: entry.data.sourceName,
    })),
  });
}
