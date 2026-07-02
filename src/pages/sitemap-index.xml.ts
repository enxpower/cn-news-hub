// Sitemap index endpoint - /sitemap-index.xml
// Generated as a static endpoint rather than via @astrojs/sitemap to avoid
// crashes with large page counts. Covers all article pages, category pages,
// and static pages. Excludes /admin/ routes.
import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import siteConfig from '../../site.config.json';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(_ctx: APIContext) {
  const siteOrigin = import.meta.env.SITE_URL || siteConfig.site.url;
  const now = new Date().toISOString().split('T')[0];

  const entries = await getCollection('articles');
  const sorted = entries.sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
  );

  const urls: string[] = [];

  // Homepage
  urls.push(`
  <url>
    <loc>${escapeXml(siteOrigin)}/</loc>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
    <lastmod>${now}</lastmod>
  </url>`);

  // Static pages
  for (const href of ['/about']) {
    urls.push(`
  <url>
    <loc>${escapeXml(siteOrigin)}${href}/</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>`);
  }

  // Category pages
  for (const cat of siteConfig.categories) {
    urls.push(`
  <url>
    <loc>${escapeXml(siteOrigin)}/category/${cat.id}/</loc>
    <changefreq>hourly</changefreq>
    <priority>0.8</priority>
    <lastmod>${now}</lastmod>
  </url>`);
  }

  // Article pages
  for (const entry of sorted) {
    const pubDate = entry.data.pubDate.toISOString().split('T')[0];
    urls.push(`
  <url>
    <loc>${escapeXml(siteOrigin)}/article/${entry.slug}/</loc>
    <changefreq>never</changefreq>
    <priority>0.7</priority>
    <lastmod>${pubDate}</lastmod>
  </url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
