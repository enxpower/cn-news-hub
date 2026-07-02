// Sitemap index - /sitemap-index.xml
// A true sitemapindex document that references the main sitemap.xml.
// Google distinguishes between a sitemap index (<sitemapindex>) and a
// regular sitemap (<urlset>); submitting a <urlset> under a filename
// that implies an index causes a "Couldn't fetch / Unknown type" error
// in Search Console. This file resolves that by being a proper index.
import type { APIContext } from 'astro';
import siteConfig from '../../site.config.json';

export async function GET(_ctx: APIContext) {
  const siteOrigin = import.meta.env.SITE_URL || siteConfig.site.url;
  const now = new Date().toISOString().split('T')[0];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${siteOrigin}/sitemap.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>
</sitemapindex>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
