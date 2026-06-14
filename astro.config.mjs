// Astro configuration.
// Site URL and base path are sourced from site.config.json so the deployment
// target (custom domain vs. GitHub Pages project path) is configured in one
// place only - no hardcoded URLs in the codebase.
//
// SITE_URL environment variable overrides site.config.json at build time,
// so switching domains requires no code change:
//   SITE_URL=https://example.com npm run build
// In CI (GitHub Actions) this can be set as a repository variable
// (Settings -> Variables) and passed in as an env var in the workflow,
// making the domain fully configurable without touching any source file.
import { defineConfig } from 'astro/config';
import siteConfig from './site.config.json' with { type: 'json' };

const siteUrl = process.env.SITE_URL || siteConfig.site.url;

export default defineConfig({
  site: siteUrl,
  base: siteConfig.site.base,
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
});
