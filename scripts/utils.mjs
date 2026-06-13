// Small shared utilities for the fetch-news script.
import crypto from 'node:crypto';
import { load } from 'cheerio';

export function shortHash(input, length = 12) {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, length);
}

// Build a readable, unique slug for an article based on its publish date
// and a content hash of its canonical URL.
export function buildSlug(url, pubDate) {
  const d = new Date(pubDate);
  const datePart = isNaN(d.valueOf())
    ? 'unknown-date'
    : `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${datePart}-${shortHash(url)}`;
}

// Strip HTML tags and collapse whitespace, producing plain text suitable
// for card excerpts, meta descriptions, and og:description.
export function stripHtml(html = '') {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Sanitize and "de-link" full-article HTML.
//
// Policy: the site never sends readers away from an article mid-content.
// Every <a> in the article body is unwrapped to its plain text (link
// removed, text kept) so nothing inside the rendered body is clickable or
// navigates away. The single, intentional outbound link is the
// "来源: XXX / 查看原文" line on the article page, built separately from
// this body HTML.
//
// This also strips tag categories that are never appropriate to render
// inline (scripts, styles, frames, forms, embeds) and neutralizes inline
// event-handler attributes as defense in depth.
export function sanitizeHtml(html = '') {
  return html
    .replace(/<(script|style|iframe|object|embed|form|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|noscript)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    // Unwrap anchors: <a href="...">text</a> -> text (no outbound links in body)
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .trim();
}

// Remove a trailing "continue reading / read more" fragment that some feeds
// append as the last paragraph/line of the body (often just a now-unlinked
// phrase like "继续阅读" or "Read more on..." after sanitizeHtml has
// stripped the anchor). Only trims short trailing fragments so real content
// is never cut.
const READ_MORE_PATTERN = /(继续阅读全文|继续阅读|阅读全文|查看原文|read more on this story|read more|\.{3}|…)\s*$/i;

export function trimTrailingReadMore(html = '') {
  let result = html.trim();
  for (let i = 0; i < 3; i++) {
    const before = result;
    result = result.replace(/<(p|div|span)[^>]*>\s*(?:<[^>]+>)*\s*(继续阅读全文|继续阅读|阅读全文|查看原文|read more on this story|read more|\.{3}|…)\s*(?:<\/[^>]+>)*\s*<\/\1>\s*$/i, '');
    result = result.replace(READ_MORE_PATTERN, '').trim();
    if (result === before) break;
  }
  return result;
}

// Truncate plain text to a maximum character length, breaking on a
// word/character boundary and appending an ellipsis if shortened.
export function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
}

// Best-effort extraction of a representative image URL from an RSS item
// (i.e. from the feed's own data, before any page fetch).
export function extractImage(item) {
  if (item.enclosure?.url && /image|jpe?g|png|webp|gif/i.test(item.enclosure.url + (item.enclosure.type || ''))) {
    return item.enclosure.url;
  }
  const mediaContent = item['media:content'];
  if (mediaContent) {
    const node = Array.isArray(mediaContent) ? mediaContent[0] : mediaContent;
    const url = node?.$?.url || node?.url;
    if (url) return url;
  }
  const html = item.contentEncoded || item['content:encoded'] || item.content || item.summary || item.description || '';
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match) return match[1];
  return undefined;
}

// Resolve a possibly-relative URL against a base page URL. Returns null if
// either input is missing/invalid, so callers can fall back cleanly.
export function resolveUrl(url, base) {
  if (!url) return null;
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

// Best-effort extraction of a representative image from a fetched article
// page: prefers <meta property="og:image">, then <meta name="twitter:image">,
// then the first <img> inside the extracted article body. Returns null if
// none found (most often because the article genuinely has no lead image).
export function extractPageImage(html, pageUrl) {
  let $;
  try {
    $ = load(html);
  } catch {
    return null;
  }

  const og = $('meta[property="og:image"]').attr('content')
    || $('meta[property="og:image:url"]').attr('content')
    || $('meta[name="twitter:image"]').attr('content');
  const resolved = resolveUrl(og, pageUrl);
  if (resolved) return resolved;

  const firstImg = $('article img, [itemprop="articleBody"] img, .article-body img, main img')
    .first()
    .attr('src');
  return resolveUrl(firstImg, pageUrl);
}

// Escape a string for safe inclusion as a YAML double-quoted scalar.
export function yamlEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

// Run an async function with a hard timeout, throwing on expiry.
//
// IMPORTANT: `fn` is called with NO arguments. rss-parser's parseURL(url,
// opts) treats a truthy second argument as a legacy Node-style callback and
// crashes with "callback is not a function" if given an AbortSignal.
// Timeout is therefore enforced purely via Promise.race here.
export async function withTimeout(fn, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timeout after ${ms}ms${label ? ` (${label})` : ''}`));
    }, ms);
  });

  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// Full-article page fetching & extraction
//
// Used to retrieve the actual article body (and, via extractPageImage, a
// lead image) from its canonical page - RSS feeds typically only carry a
// short summary and often no image at all. Both fetch and extraction are
// designed to fail SAFELY and LOCALLY:
//   - fetchArticleHtml(): network/timeout errors throw, caught by the caller
//     per-article; never aborts the overall run.
//   - extractMainContent(): if no recognizable article container is found
//     (e.g. the source redesigned its page), returns null rather than
//     throwing or returning garbage. The caller falls back to the RSS
//     summary and tallies a "structure changed" count per source, which is
//     written back to Notion for human review - the script itself never
//     disables a source or crashes because one site changed its markup.
// ============================================================================

const ARTICLE_FETCH_USER_AGENT =
  'Mozilla/5.0 (compatible; cn-news-hub/1.0; +https://news.dysonx.com)';

// Fetch the raw HTML of an article page with a hard timeout.
export async function fetchArticleHtml(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': ARTICLE_FETCH_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('html')) {
      throw new Error(`unexpected content-type: ${contentType}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Candidate selectors for the main article body, in priority order. Covers
// common patterns used by major news CMSes (BBC, DW, RFA/WordPress, etc).
const ARTICLE_BODY_SELECTORS = [
  '[itemprop="articleBody"]',
  'article [data-component="text-block"]',
  'article .article-body',
  'article .story-body',
  '.article-body',
  '.article__body',
  '.story-body__inner',
  '.entry-content',
  '.post-content',
  '.content__article-body',
  'article',
  'main',
];

const STRIP_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'form', 'nav', 'header', 'footer',
  'aside', 'figure figcaption', '.advertisement', '.ad', '.share', '.social',
  '.related', '.tags', '[class*="newsletter"]', '[class*="promo"]',
];

// Try to extract the main article body from a full HTML page. Returns the
// inner HTML of the best-matching container, or null if nothing usable was
// found (caller should fall back to the RSS summary).
export function extractMainContent(html) {
  let $;
  try {
    $ = load(html);
  } catch {
    return null;
  }

  for (const sel of STRIP_SELECTORS) {
    $(sel).remove();
  }

  let best = null;
  let bestLength = 0;

  for (const selector of ARTICLE_BODY_SELECTORS) {
    $(selector).each((_, el) => {
      const node = $(el);
      const text = node.text().replace(/\s+/g, '');
      if (text.length > bestLength) {
        bestLength = text.length;
        best = node;
      }
    });
    // If the highest-priority selector already gave us a substantial body,
    // stop early rather than letting a generic <main>/<article> elsewhere
    // on the page (e.g. a "related articles" widget) win by size.
    if (best && bestLength > 200) break;
  }

  if (!best || bestLength < 80) {
    return null; // nothing recognizable - likely a structure change
  }

  // Keep only paragraph-level content; drop empty paragraphs.
  const parts = [];
  best.find('p, h2, h3, ul, ol, blockquote').each((_, el) => {
    const fragment = $(el).clone();
    fragment.find('a').each((_, a) => {
      $(a).replaceWith($(a).text());
    });
    const outer = $.html(fragment).trim();
    const textLen = $(el).text().replace(/\s+/g, '').length;
    if (textLen > 0) parts.push(outer);
  });

  if (parts.length === 0) {
    // No paragraph-level structure found; fall back to the container's raw
    // inner HTML so we don't lose content entirely.
    return best.html();
  }

  return parts.join('\n');
}
