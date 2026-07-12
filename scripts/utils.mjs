// Small shared utilities for the fetch-news script.
import crypto from 'node:crypto';
import { load } from 'cheerio';

export function shortHash(input, length = 12) {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, length);
}

export function buildSlug(url, pubDate) {
  const d = new Date(pubDate);
  const datePart = isNaN(d.valueOf())
    ? 'unknown-date'
    : `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${datePart}-${shortHash(url)}`;
}

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

export function sanitizeHtml(html = '') {
  return html
    .replace(/<(script|style|iframe|object|embed|form|noscript|video|audio|source|button|svg|picture)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|noscript|video|audio|source|button|svg|picture|track)[^>]*\/?>/gi, '')
    .replace(/<img\b([\s\S]*?)>/gi, (match, attrs) => {
      const srcMatch = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
      const dataSrcMatch = attrs.match(/\bdata-(?:src|lazy-src|original)\s*=\s*["']([^"']+)["']/i);
      const finalSrc = (srcMatch && srcMatch[1]) || (dataSrcMatch && dataSrcMatch[1]) || '';
      if (!finalSrc) return '';
      return `<img src="${finalSrc}" alt="" loading="lazy">`;
    })
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/<\/?(dl|dt|dd|table|thead|tbody|tfoot|tr|th|td|colgroup|col|caption|fieldset|legend|details|summary|menu|menuitem)\b[^>]*>/gi, '')
    .trim();
}

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

export function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
}

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

export function resolveUrl(url, base) {
  if (!url) return null;
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

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

  const firstImgEl = $('article img, [itemprop="articleBody"] img, .article-body img, main img').first();
  const firstImg = firstImgEl.attr('src') || firstImgEl.attr('data-src') || firstImgEl.attr('data-lazy-src') || firstImgEl.attr('data-original');
  return resolveUrl(firstImg, pageUrl);
}

export function yamlEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

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

const ARTICLE_FETCH_USER_AGENT =
  'Mozilla/5.0 (compatible; cn-news-hub/1.0; +https://news.dysonx.com)';

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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('html')) throw new Error(`unexpected content-type: ${contentType}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

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
  'aside', 'svg', 'picture', 'video', 'audio', 'button',
  'figure figcaption', '.advertisement', '.ad', '.share', '.social',
  '.related', '.tags', '[class*="newsletter"]', '[class*="promo"]',
  '[class*="player"]', '[class*="media-player"]', '[data-component="media-block"]',
  '[class*="most-read"]', '[class*="most-popular"]', '[class*="recommend"]',
];

const BOILERPLATE_TEXT_PATTERNS = [
  /^©/,
  /版权所有/,
  /版权声明/,
  /All rights reserved/i,
  /to view this video/i,
  /请允许\s*javascript/i,
  /启用\s*javascript/i,
  /enable javascript/i,
  /^DW中文Instagram/,
  /转发自.*Instagram/,
  /我们的Instagram/,
  // Timestamp/dateline lines from CMS templates
  /^发表时间[：:]/,
  /^更新时间[：:]/,
  /^发布时间[：:]/,
  /^编辑时间[：:]/,
  /^Published[:\s]/i,
  /^Updated[:\s]/i,
  /^Last modified/i,
  /^\d{1,2}\/\d{1,2}\/\d{4}\s*[-–]\s*\d{2}:\d{2}/,
  /^\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{2}:\d{2}\s*$/,
  // Author signature lines e.g. "文｜财新周刊 路尘" (may be preceded by full-width spaces)
  /^[\s\u3000]*文[｜|\u2f5c\/]\s*.{1,20}$/,
  // Image caption attribution lines e.g. "图：视觉中国" "图片来源：Getty"
  /^图[：:：].{0,30}$/,
  /^图片[来源制作提供][：:：]/,
  /^摄影[：:：]/,
  /^视觉中国$/,
  /^Getty Images?$/i,
  /^AFP$/i,
  // Short metadata lines
  /^责任编辑[：:]/,
  /^本文来源[：:]/,
  /^来源[：:].{0,30}$/,
  // Report/article label prefixes that appear as standalone paragraphs
  /^报告摘要[\s：:]/,
  /^编者按[\s：:]/,
  /^记者\s.{1,15}$/,
  /^特约撰稿人?\s.{1,20}$/,
];

function isBoilerplateText(text) {
  // Strip ASCII whitespace, full-width spaces (U+3000 　),
  // and non-breaking spaces (U+00A0) before matching.
  const trimmed = text.replace(/^[\s\u3000\u00a0]+|[\s\u3000\u00a0]+$/g, '');
  if (!trimmed) return true;
  return BOILERPLATE_TEXT_PATTERNS.some((re) => re.test(trimmed));
}

function isLinkOnlyList($, el) {
  const items = $(el).children('li').toArray();
  if (items.length === 0) return false;
  return items.every((li) => {
    const $li = $(li);
    const links = $li.find('a');
    if (links.length === 0) return false;
    const liText = $li.text().replace(/\s+/g, '');
    const linkText = links.text().replace(/\s+/g, '');
    return linkText.length > 0 && linkText.length >= liText.length * 0.8;
  });
}

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
    if (best && bestLength > 200) break;
  }

  if (!best || bestLength < 80) return null;

  best.find('img').each((_, img) => {
    const $img = $(img);
    const dataSrc = $img.attr('data-src') || $img.attr('data-lazy-src') || $img.attr('data-original');
    if (dataSrc && (!$img.attr('src') || $img.attr('src') === '')) {
      $img.attr('src', dataSrc);
    }
  });

  const parts = [];
  best.find('p:not(blockquote p):not(blockquote *), h2, h3, ul, ol, blockquote, img').each((_, el) => {
    const $el = $(el);
    const tag = el.tagName?.toLowerCase();

    if (tag === 'ul' || tag === 'ol') {
      if (isLinkOnlyList($, el)) return;
    }

    if (tag !== 'img' && isBoilerplateText($el.text())) return;

    const fragment = $el.clone();
    fragment.find('a').each((_, a) => {
      $(a).replaceWith($(a).text());
    });
    const outer = $.html(fragment).trim();
    const textLen = $el.text().replace(/\s+/g, '').length;
    if (tag === 'img' || textLen > 0) parts.push(outer);
  });

  if (parts.length === 0) return best.html();
  return parts.join('\n');
}
