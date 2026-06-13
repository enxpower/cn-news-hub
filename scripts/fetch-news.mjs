#!/usr/bin/env node
// ============================================================================
// fetch-news.mjs
//
// Reads the list of RSS sources from a Notion database, fetches each feed,
// deduplicates against previously-seen articles, and for each new item
// fetches the article's own page to extract its full body AND a lead image
// (RSS feeds usually only carry a short summary and often no image at all).
// Writes Markdown content files for Astro, prunes content older than the
// configured retention window, and writes back per-source status to both
// Notion and a local JSON file (rendered by /admin/status).
//
// Design principles (per project requirements):
//   - Per-source AND per-article failures are caught and skipped; they
//     never abort the run or affect other sources/articles.
//   - If full-page extraction fails for an article (network error, or the
//     page no longer matches any known article-body pattern - i.e. the
//     source redesigned its site), the article still gets published using
//     the RSS summary as its body. If EVERY new article from a source fails
//     full-page extraction in a run, that's flagged in Notion's Last Error
//     as a likely site redesign, for human review.
//   - Failed FEEDS are flagged in Notion (Status + Last Error) so a human
//     can review and remove/replace them - this script never deletes a
//     source itself.
//   - Articles never send readers off-site mid-content: all in-body links
//     are unwrapped and trailing "read more" phrases are trimmed. The only
//     outbound link is the explicit "来源 / 查看原文" line on the article
//     page template.
//   - All tunables (retention, summary length, timeouts, categories) come
//     from site.config.json - nothing is hardcoded here.
//
// One-time reset hook:
//   If data/RESET_ARTICLES exists, all files in src/content/articles/ are
//   deleted before fetching (and the flag file removed). Used for
//   deliberate clean-slate resets, not part of normal operation.
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

// Per-article full-page fetch timeout. Kept short so a handful of slow
// sites can't blow the overall job's time budget.
const PAGE_FETCH_TIMEOUT_MS = 7000;

// Cap on how many new articles per source get a full-page fetch attempt in
// a single run. Bounds total run time when a feed has a large backlog (e.g.
// the first run after a reset); the rest are published with the RSS
// summary and will simply not have full text/image for this run.
const MAX_FULL_FETCH_PER_SOURCE = 25;

// NOTE: do NOT pass { timeout } or a signal into individual parseURL calls -
// rss-parser's parseURL(url, opts) treats a truthy second argument as a
// legacy callback and crashes. Per-feed timeouts are instead enforced by
// wrapping each parseURL call in withTimeout() (see utils.mjs).
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
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

// One-time reset: if data/RESET_ARTICLES exists, wipe all article Markdown
// files and remove the flag. Keeps .gitkeep so the directory stays tracked.
async function maybeResetArticles() {
  try {
    await fs.access(RESET_FLAG_FILE);
  } catch {
    return; // flag not present - normal run
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

// Map a Notion "Category" select label (e.g. "国际观察") to the matching
// category id from site.config.json (e.g. "international"). Falls back to
// the first configured category if no label matches, so the build never
// breaks on an unmapped category.
function mapCategory(label) {
  const match = siteConfig.categories.find((c) => c.label === label);
  return match ? match.id : siteConfig.categories[0].id;
}

// Pick the best available content HTML from an RSS/Atom item itself
// (without fetching the article page) - used as a fallback when full-page
// extraction is skipped or fails.
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
  lines.push(bodyHtml || description, '');
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
        if (seen[urlHash]) continue; // already processed in a previous run

        const title = stripHtml(item.title || '(无标题)');
        const pubDate = item.isoDate || item.pubDate || new Date().toISOString();
        const rawDescription = item.contentSnippet || item.summary || item.description || '';
        const description = truncate(stripHtml(rawDescription), SUMMARY_LENGTH);
        const slug = buildSlug(link, pubDate);

        // Start with whatever the feed itself gives us for an image.
        let image = extractImage(item);

        // --------------------------------------------------------------
        // Full-article extraction: fetch the article's own page and try
        // to pull its real body + a lead image (og:image etc). Falls back
        // to the RSS feed's own content (summary) on ANY failure - network
        // error, timeout, or the page not matching a known article-body
        // pattern (site redesign). Image extraction is independent: even
        // if the body pattern isn't recognized, og:image is still tried.
        // --------------------------------------------------------------
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
      }

      console.log(`  -> ${newItems} new article(s)` + (fullFetchAttempts > 0 ? ` (full-text: ${fullFetchAttempts - fullFetchFailures}/${fullFetchAttempts})` : ''));

      // If every full-page fetch attempt for this source failed, the site
      // likely changed its markup (or is blocking the fetcher). Surface
      // this in Notion even though the feed itself is healthy.
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
      // Per-source failure: log, flag the source in Notion for human review,
      // and move on. This script never deletes or disables a source itself -
      // a person reviews "⚠️ Failed" rows in Notion and decides whether to
      // fix the URL or remove the source.
      console.warn(`  ! ${label} failed: ${err.message}`);
      statusResults.push({ name: label, category: source.category, status: '⚠️ Failed', newItems: 0, error: err.message });
      await updateSourceStatus(NOTION_API_KEY, source.pageId, {
        status: '⚠️ Failed',
        lastFetchedIso: new Date().toISOString(),
        lastError: err.message,
      });
    }
  }

  // ------------------------------------------------------------------
  // Retention: remove articles (and their seen-urls entries) older than
  // RETENTION_DAYS so the build doesn't grow unbounded.
  // ------------------------------------------------------------------
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = await fs.readdir(ARTICLES_DIR);
  let pruned = 0;

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const fullPath = path.join(ARTICLES_DIR, file);
    const raw = await fs.readFile(fullPath, 'utf-8');
    const { data } = matter(raw);
    const pubDate = new Date(data.pubDate).valueOf();
    if (!isNaN(pubDate) && pubDate < cutoff) {
      await fs.unlink(fullPath);
      pruned += 1;
    }
  }

  if (pruned > 0) {
    console.log(`Pruned ${pruned} article(s) older than ${RETENTION_DAYS} days.`);
  }

  // Drop pruned entries from the seen-urls map too, so a re-publish after
  // the retention window is treated as new.
  for (const [hash, entry] of Object.entries(seen)) {
    const pubDate = new Date(entry.pubDate).valueOf();
    if (!isNaN(pubDate) && pubDate < cutoff) {
      delete seen[hash];
    }
  }

  await writeJson(SEEN_FILE, seen);
  await writeJson(STATUS_FILE, { lastRun: new Date().toISOString(), sources: statusResults });

  console.log('Done.');
}

main()
  .catch((err) => {
    // Top-level safety net: never let an unexpected error crash CI with a
    // non-zero exit that blocks the build. Log and continue to the explicit
    // exit below.
    console.error('Unexpected error in fetch-news.mjs:', err);
  })
  .finally(() => {
    // Node's global fetch (undici) keeps keep-alive sockets open, which can
    // prevent the process from exiting on its own and hang the CI step
    // until its timeout. Force a clean exit once all work is done.
    process.exit(0);
  });
