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
  vite: {
    build: {
      rollupOptions: {
        // Demote unresolved import warnings to non-fatal so that a single
        // article .md file containing a bad image path (e.g. a relative URL
        // like "assets/images/foo.jpg" from a source CMS) cannot abort the
        // entire build. The article will render without that image.
        onwarn(warning, warn) {
          if (warning.code === 'UNRESOLVED_IMPORT') return;
          warn(warning);
        },
      },
    },
  },
});
