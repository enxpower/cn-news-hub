import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import siteConfig from './site.config.json' with { type: 'json' };

// SITE_URL is injected at build time by the GitHub Actions workflow,
// derived from public/CNAME. It is the single source of truth for the
// domain - no hardcoded values in any source file.
const siteUrl = process.env.SITE_URL || siteConfig.site.url;

export default defineConfig({
  site: siteUrl,
  base: siteConfig.site.base,
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
  integrations: [
    sitemap({
      // Exclude admin/backend pages from the sitemap so search engines
      // and AI crawlers don't waste crawl budget on non-public pages.
      filter: (page) => !page.includes('/admin/'),
      changefreq: 'hourly',
      priority: 0.7,
      lastmod: new Date(),
    }),
  ],
});
