// Small shared utilities for the fetch-news script.
// Kept dependency-free (uses only Node built-ins) for reliability in CI.
import crypto from 'node:crypto';

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

// Sanitize and "de-link" full-article HTML pulled from <content:encoded>.
//
// Policy: the site never sends readers away from an article mid-content.
// Source feeds (BBC中文/RFA/DW etc.) commonly end their RSS body with a
// "继续阅读 / Read more / [...]" anchor pointing back at the original site -
// every <a> in the article body is therefore unwrapped to its plain text
// (link removed, text kept) so nothing inside the rendered body is
// clickable or navigates away. The single, intentional outbound link is the
// "来源: XXX / 查看原文" line on the article page, which is built separately
// in the page template - not from this body HTML.
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
    // Strip a trailing block element whose text content is just a "read more" phrase
    result = result.replace(/<(p|div|span)[^>]*>\s*(?:<[^>]+>)*\s*(继续阅读全文|继续阅读|阅读全文|查看原文|read more on this story|read more|\.{3}|…)\s*(?:<\/[^>]+>)*\s*<\/\1>\s*$/i, '');
    // Strip a trailing bare phrase
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

// Best-effort extraction of a representative image URL from an RSS item.
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

// Escape a string for safe inclusion as a YAML double-quoted scalar.
export function yamlEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

// Run an async function with a hard timeout, throwing on expiry.
//
// IMPORTANT: `fn` is called with NO arguments. Earlier versions passed an
// AbortSignal through to rss-parser's `parseURL(url, { signal })`, but
// rss-parser interprets a truthy second argument as a legacy Node-style
// callback and crashes with "callback is not a function". Timeout is
// therefore enforced purely via Promise.race here - the underlying request
// may continue briefly in the background after a timeout, which is an
// acceptable tradeoff for a script that runs in short-lived CI jobs.
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
