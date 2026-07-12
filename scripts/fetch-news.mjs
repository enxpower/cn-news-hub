#!/usr/bin/env node
// ============================================================================
// fetch-news.mjs — fetches RSS sources from Notion, extracts full article
// content, and writes Markdown files for Astro to build into static pages.
// ============================================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import Parser from 'rss-parser';
import matter from 'gray-matter';

import siteConfig from '../site.config.json' with { type: 'json' };
import { fetchSources, updateSourceStatus } from './notion.mjs';
import {
  buildSlug,
  shortHash,
  stripHtml,
  sanitizeHtml,
  trimTrailingReadMore,
  truncate,
  extractImage,
  yamlEscape,
  withTimeout,
  fetchArticleHtml,
  extractMainContent,
  extractPageImage,
} from './utils.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const ARTICLES_DIR = path.join(ROOT, 'src/content/articles');
const SEEN_FILE = path.join(ROOT, 'data/seen-urls.json');
const STATUS_FILE = path.join(ROOT, 'data/sources-status.json');
const RESET_FLAG_FILE = path.join(ROOT, 'data/RESET_ARTICLES');

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

const FETCH_TIMEOUT_MS = siteConfig.content.fetchTimeoutMs ?? 8000;
const SUMMARY_LENGTH = siteConfig.content.summaryLength ?? 160;
const RETENTION_DAYS = siteConfig.content.retentionDays ?? 30;

const PAGE_FETCH_TIMEOUT_MS = 7000;
const MAX_FULL_FETCH_PER_SOURCE = 25;

const parser = new Parser({
  customFields: {
    item: [['content:encoded', 'contentEncoded']],
  },
});

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  await fs.rename(tmp, file);
}

async function maybeResetArticles() {
  try {
    await fs.access(RESET_FLAG_FILE);
  } catch {
    return;
  }
  console.log('RESET_ARTICLES flag found - wiping src/content/articles/ ...');
  const files = await fs.readdir(ARTICLES_DIR);
  let removed = 0;
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    await fs.unlink(path.join(ARTICLES_DIR, file));
    removed += 1;
  }
  await fs.unlink(RESET_FLAG_FILE);
  console.log(`  -> removed ${removed} article(s), reset flag cleared.`);
}

function mapCategory(label) {
  const match = siteConfig.categories.find((c) => c.label === label);
  return match ? match.id : siteConfig.categories[0].id;
}

function pickFeedContentHtml(item) {
  return (
    item.contentEncoded ||
    item['content:encoded'] ||
    item.content ||
    item.summary ||
    item.description ||
    ''
  );
}

// Convert <img src="..."> tags in HTML body to Markdown image syntax.
// Only absolute http/https URLs are converted — relative paths like
// "assets/images/foo.jpg" would cause Astro's Rollup build to fail
// by trying to resolve them as local assets.
function htmlImagesToMarkdown(html) {
  return html.replace(/<img[^>]*?src=["']([^"']+)["'][^>]*?>/gi, (match, src) => {
    // Must be an absolute URL — skip relative paths
    if (!/^https?:\/\//i.test(src)) return '';
    // Skip tiny icons and tracking pixels
    if (/icon|logo|pixel|track|beacon|spacer/i.test(src)) return '';
    return `\n\n![](${src})\n\n`;
  });
}

// Post-process the body HTML before writing to Markdown:
// 1. Convert <img> to Markdown image syntax (absolute URLs only)
// 2. Strip <br> tags
// 3. Collapse excessive blank lines
function postProcessBody(html) {
  let body = html || '';
  body = htmlImagesToMarkdown(body);
  body = body.replace(/<br\s*\/?>/gi, '\n');
  body = body.replace(/\n{3,}/g, '\n\n');
  return body.trim();
}

function buildMarkdown({ title, pubDateIso, sourceName, sourceUrl, categoryId, image, description, bodyHtml }) {
  const lines = [
    '---',
    `title: "${yamlEscape(title)}"`,
    `pubDate: ${pubDateIso}`,
    `sourceName: "${yamlEscape(sourceName)}"`,
    `sourceUrl: "${yamlEscape(sourceUrl)}"`,
    `category: "${yamlEscape(categoryId)}"`,
  ];
  if (image) {
    lines.push(`image: "${yamlEscape(image)}"`);
  }
  lines.push(`description: "${yamlEscape(description)}"`);
  lines.push('---', '');
  lines.push(postProcessBody(bodyHtml) || description, '');
  return lines.join('\n');
}

// ----------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------

async function main() {
  if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
    console.error(
      '! NOTION_API_KEY / NOTION_DATABASE_ID not set - skipping fetch (no-op).\n' +
      '  This is expected for local builds without configured secrets.'
    );
    return;
  }

  await fs.mkdir(ARTICLES_DIR, { recursive: true });
  await fs.mkdir(path.dirname(SEEN_FILE), { recursive: true });

  await maybeResetArticles();

  const seen = await readJson(SEEN_FILE, {});
  const statusResults = [];

  console.log('Fetching source list from Notion...');
  let sources;
  try {
    sources = await fetchSources(NOTION_API_KEY, NOTION_DATABASE_ID);
  } catch (err) {
    console.error(`! Could not read Notion source list: ${err.message}`);
    console.error('  Aborting fetch run (existing content is left untouched).');
    return;
  }
  console.log(`Found ${sources.length} source(s) in Notion.`);

  for (const source of sources) {
    const label = source.name;

    if (!source.enabled) {
      statusResults.push({ name: label, category: source.category, status: '⏸ Paused', newItems: 0 });
      continue;
    }

    if (!source.rssUrl) {
      const msg = 'missing RSS URL';
      console.warn(`- ${label}: ${msg}, skipping`);
      statusResults.push({ name: label, category: source.category, status: '⚠️ Failed', newItems: 0, error: msg });
      await updateSourceStatus(NOTION_API_KEY, source.pageId, {
        status: '⚠️ Failed',
        lastFetchedIso: new Date().toISOString(),
        lastError: msg,
      });
      continue;
    }

    console.log(`- Fetching: ${label} (${source.rssUrl})`);
    let newItems = 0;
    let skippedItems = 0;
    let fullFetchAttempts = 0;
    let fullFetchFailures = 0;

    try {
      const feed = await withTimeout(
        () => parser.parseURL(source.rssUrl),
        FETCH_TIMEOUT_MS,
        label
      );

      const categoryId = mapCategory(source.category);

      for (const item of feed.items ?? []) {
        const link = item.link?.trim();
        if (!link) continue;

        const urlHash = shortHash(link);
        if (seen[urlHash]) continue;

        const title = stripHtml(item.title || '(无标题)');
        const pubDate = item.isoDate || item.pubDate || new Date().toISOString();
        const rawDescription = item.contentSnippet || item.summary || item.description || '';
        const description = truncate(stripHtml(rawDescription), SUMMARY_LENGTH);
        const slug = buildSlug(link, pubDate);

        let image = extractImage(item);

        let bodyHtml = null;
        if (fullFetchAttempts < MAX_FULL_FETCH_PER_SOURCE) {
          fullFetchAttempts += 1;
          try {
            const pageHtml = await fetchArticleHtml(link, PAGE_FETCH_TIMEOUT_MS);

            const extracted = extractMainContent(pageHtml);
            if (extracted) {
              bodyHtml = trimTrailingReadMore(sanitizeHtml(extracted));
            } else {
              fullFetchFailures += 1;
            }

            if (!image) {
              image = extractPageImage(pageHtml, link) || undefined;
            }
          } catch (err) {
            fullFetchFailures += 1;
            console.warn(`    ! full-page fetch failed for ${link}: ${err.message}`);
          }
        }

        if (!bodyHtml) {
          const feedHtml = pickFeedContentHtml(item);
          bodyHtml = trimTrailingReadMore(sanitizeHtml(feedHtml));
        }

        // Each article write is isolated — a single bad article never
        // aborts the source loop or the build pipeline.
        try {
          const markdown = buildMarkdown({
            title,
            pubDateIso: new Date(pubDate).toISOString(),
            sourceName: label,
            sourceUrl: link,
            categoryId,
            image,
            description: description || title,
            bodyHtml,
          });

          await fs.writeFile(path.join(ARTICLES_DIR, `${slug}.md`), markdown, 'utf-8');

          seen[urlHash] = { slug, pubDate: new Date(pubDate).toISOString() };
          newItems += 1;
        } catch (writeErr) {
          skippedItems += 1;
          console.warn(`    ! skipped article (write error) ${link}: ${writeErr.message}`);
        }
      }

      const skipNote = skippedItems > 0 ? `, skipped:${skippedItems}` : '';
      console.log(`  -> ${newItems} new article(s)${skipNote}` + (fullFetchAttempts > 0 ? ` (full-text: ${fullFetchAttempts - fullFetchFailures}/${fullFetchAttempts})` : ''));

      let lastError = null;
      if (fullFetchAttempts > 0 && fullFetchFailures === fullFetchAttempts) {
        lastError = `正文抓取失败 ${fullFetchFailures}/${fullFetchAttempts}（页面结构可能已变化，已回退为摘要）`;
        console.warn(`  ! ${label}: ${lastError}`);
      }

      statusResults.push({ name: label, category: source.category, status: '✅ OK', newItems, ...(lastError ? { error: lastError } : {}) });
      await updateSourceStatus(NOTION_API_KEY, source.pageId, {
        status: '✅ OK',
        lastFetchedIso: new Date().toISOString(),
        lastError,
      });
    } catch (err) {
      console.warn(`  ! ${label} failed: ${err.message}`);
      statusResults.push({ name: label, category: source.category, status: '⚠️ Failed', newItems: 0, error: err.message });
      await updateSourceStatus(NOTION_API_KEY, source.pageId, {
        status: '⚠️ Failed',
        lastFetchedIso: new Date().toISOString(),
        lastError: err.message,
      });
    }
  }

  // Retention pruning
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = await fs.readdir(ARTICLES_DIR);
  let pruned = 0;

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const fullPath = path.join(ARTICLES_DIR, file);
    try {
      const raw = await fs.readFile(fullPath, 'utf-8');
      const { data } = matter(raw);
      const pubDate = new Date(data.pubDate).valueOf();
      if (!isNaN(pubDate) && pubDate < cutoff) {
        await fs.unlink(fullPath);
        pruned += 1;
      }
    } catch (pruneErr) {
      // If a file is unreadable/malformed, delete it to prevent build failures
      console.warn(`  ! pruning malformed file ${file}: ${pruneErr.message}`);
      await fs.unlink(fullPath).catch(() => {});
      pruned += 1;
    }
  }

  if (pruned > 0) console.log(`Pruned ${pruned} article(s).`);

  for (const [hash, entry] of Object.entries(seen)) {
    const pubDate = new Date(entry.pubDate).valueOf();
    if (!isNaN(pubDate) && pubDate < cutoff) delete seen[hash];
  }

  await writeJson(SEEN_FILE, seen);
  await writeJson(STATUS_FILE, { lastRun: new Date().toISOString(), sources: statusResults });

  console.log('Done.');
}

main()
  .catch((err) => {
    console.error('Unexpected error in fetch-news.mjs:', err);
  })
  .finally(() => {
    process.exit(0);
  });
