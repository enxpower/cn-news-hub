// Astro configuration.
// Site URL and base path are sourced from site.config.json so the deployment
// target (custom domain vs. GitHub Pages project path) is configured in one
// place only - no hardcoded URLs in the codebase.
import { defineConfig } from 'astro/config';
import siteConfig from './site.config.json' with { type: 'json' };

export default defineConfig({
  site: siteConfig.site.url,
  base: siteConfig.site.base,
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
});
