// Dynamic robots.txt — Sitemap URL is derived from SITE_URL env var
// injected at build time from public/CNAME, so this file works on any
// domain without code changes.
import type { APIRoute } from 'astro';
import siteConfig from '../../site.config.json';

export const GET: APIRoute = ({ site }) => {
  const siteOrigin = import.meta.env.SITE_URL
    || site?.toString().replace(/\/$/, '')
    || siteConfig.site.url;

  const body = `# robots.txt — 中文新闻汇
# Sitemap URL is auto-derived from the deployment domain.

# ── Standard search engines ──────────────────────────────────────────
User-agent: *
Allow: /
Disallow: /admin/
Sitemap: ${siteOrigin}/sitemap-index.xml

# ── Google ───────────────────────────────────────────────────────────
User-agent: Googlebot
Allow: /
Disallow: /admin/

User-agent: Googlebot-Image
Allow: /

# ── Bing / Microsoft ─────────────────────────────────────────────────
User-agent: bingbot
Allow: /
Disallow: /admin/

# ── AI crawlers: allow indexing for content discovery ────────────────
User-agent: GPTBot
Allow: /
Disallow: /admin/

User-agent: ChatGPT-User
Allow: /
Disallow: /admin/

User-agent: OAI-SearchBot
Allow: /
Disallow: /admin/

User-agent: Claude-Web
Allow: /
Disallow: /admin/

User-agent: anthropic-ai
Allow: /
Disallow: /admin/

User-agent: PerplexityBot
Allow: /
Disallow: /admin/

User-agent: cohere-ai
Allow: /
Disallow: /admin/

User-agent: YouBot
Allow: /
Disallow: /admin/

User-agent: Applebot
Allow: /
Disallow: /admin/

User-agent: Applebot-Extended
Allow: /
Disallow: /admin/

User-agent: Bytespider
Disallow: /

User-agent: PetalBot
Allow: /
Disallow: /admin/

# ── Aggressive scrapers and SEO spam bots: block ─────────────────────
User-agent: AhrefsBot
Disallow: /

User-agent: SemrushBot
Disallow: /

User-agent: DotBot
Disallow: /

User-agent: MJ12bot
Disallow: /

User-agent: BLEXBot
Disallow: /
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
