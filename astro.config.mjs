import { defineConfig } from 'astro/config';
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
  // Sitemap is generated via src/pages/sitemap-index.xml.ts (static endpoint)
  // rather than the @astrojs/sitemap integration, which crashes with large
  // page counts on this version of Astro. The static approach is simpler,
  // has no third-party dependency, and gives full control over output format.
});
