import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import siteConfig from './site.config.json' with { type: 'json' };

// SITE_URL is injected at build time by the GitHub Actions workflow,
// derived from public/CNAME. It is the single source of truth for the
// domain - no hardcoded values in any source file.
const siteUrl = process.env.SITE_URL || siteConfig.site.url;

// Guard: sitemap plugin crashes if site URL is the placeholder value.
// Only enable it when a real domain is available (i.e. in CI with SITE_URL set).
const isRealDomain = siteUrl && !siteUrl.includes('placeholder');

export default defineConfig({
  site: siteUrl,
  base: siteConfig.site.base,
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
  integrations: [
    ...(isRealDomain ? [
      sitemap({
        filter: (page) => !page.includes('/admin/'),
        changefreq: 'hourly',
        priority: 0.7,
        lastmod: new Date(),
      }),
    ] : []),
  ],
});
