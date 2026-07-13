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

const REMOVE_WITH_CONTENT = [
  'script','style','iframe','object','embed','form','noscript',
  'video','audio','source','button','svg','picture','track',
  'canvas','map','select','textarea','input','label','nav',
  'header','footer','aside',
];

export function sanitizeHtml(html = '') {
  if (!html) return '';
  let result = html;

  const removeWithContent = REMOVE_WITH_CONTENT.join('|');
  result = result.replace(new RegExp(`<(${removeWithContent})[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi'), '');
  result = result.replace(new RegExp(`<(${removeWithContent})[^>]*\\/?>`, 'gi'), '');

  result = result.replace(/<img\b([\s\S]*?)>/gi, (match, attrs) => {
    const srcMatch = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    const dataSrcMatch = attrs.match(/\bdata-(?:src|lazy-src|original)\s*=\s*["']([^"']+)["']/i);
    const finalSrc = (srcMatch && srcMatch[1]) || (dataSrcMatch && dataSrcMatch[1]) || '';
    if (!finalSrc) return '';
    return `<img src="${finalSrc}" alt="" loading="lazy">`;
  });

  result = result.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');

  const inlineTags = [
    'b','strong','em','i','u','s','del','ins','mark','small','sub','sup',
    'span','font','cite','abbr','acronym','time','bdi','bdo','q','kbd',
    'samp','var','data','ruby','rt','rp',
  ];
  for (const tag of inlineTags) {
    result = result.replace(new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi'), '$2');
    result = result.replace(new RegExp(`<${tag}(\\s[^>]*)?\\s*/?>`, 'gi'), '');
  }

  result = result.replace(
    /<\/?(div|section|article|main|table|thead|tbody|tfoot|tr|th|td|col|colgroup|caption|dl|dt|dd|fieldset|legend|details|summary|menu|menuitem|address)\b[^>]*>/gi, ''
  );

  result = result.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');
  result = result.replace(/\s(style|class|id|data-[a-z-]+)\s*=\s*("[^"]*"|'[^']*')/gi, '');
  result = result.replace(/\s(width|height|align|valign|border|cellpadding|cellspacing)\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');

  result = result
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

  return result.trim();
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

const ARTICLE_FETCH_USER_AGENT = 'Mozilla/5.0 (compatible; cn-news-hub/1.0)';

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
  /^发表时间[：:]/,
  /^更新时间[：:]/,
  /^发布时间[：:]/,
  /^编辑时间[：:]/,
  /^Published[:\s]/i,
  /^Updated[:\s]/i,
  /^Last modified/i,
  /^\d{1,2}\/\d{1,2}\/\d{4}\s*[-–]\s*\d{2}:\d{2}/,
  /^\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{2}:\d{2}\s*$/,
  /^[\s\u3000]*文[｜|\u2f5c\/]\s*.{1,20}$/,
  /^[\s\u3000]*图片制作[｜|\u2f5c\/]\s*.{1,20}$/,
  /^图[：:：\s].{0,30}$/,
  /^图片[来源制作提供][：:：]/,
  /^摄影[：:：]/,
  /^视觉中国$/,
  /^Getty Images?$/i,
  /^AFP$/i,
  /^Reuters$/i,
  /^新华社$/,
  /^责任编辑[：:]/,
  /^本文来源[：:]/,
  /^来源[：:].{0,30}$/,
  /^报告摘要[\s：:]/,
  /^编者按[\s：:]/,
  /^记者\s.{1,15}$/,
  /^特约撰稿人?\s.{1,20}$/,
];

function isBoilerplateText(text) {
  // Strip ASCII/full-width/NBSP whitespace from both ends
  let trimmed = text.replace(/^[\s\u3000\u00a0]+|[\s\u3000\u00a0]+$/g, '');
  if (!trimmed) return true;
  // Strip leading 【MediaName】 prefix before testing — this prevents filtering
  // out real content like "【财新网】丘成桐透露..." while still filtering
  // standalone badge paragraphs like "【财新网】" that contain nothing else.
  trimmed = trimmed.replace(/^【[^】]{1,20}】\s*/, '');
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
    let outer = $.html(fragment).trim();

    // Strip leading 【MediaName】 prefix from paragraph HTML.
    // e.g. "<p>　　【财新网】正文..." → "<p>正文..."
    if (tag === 'p') {
      outer = outer.replace(/<p([^>]*)>(\s|&nbsp;|\u3000|\u00a0)*【[^】]{1,20}】\s*/u, '<p$1>');
    }

    const textLen = $el.text().replace(/\s+/g, '').length;
    if (tag === 'img' || textLen > 0) parts.push(outer);
  });

  if (parts.length === 0) return best.html();
  return parts.join('\n');
}
