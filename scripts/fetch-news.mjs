#!/usr/bin/env node
// ============================================================================
// fetch-news.mjs
//
// Reads the list of RSS sources from a Notion database, fetches each feed,
// deduplicates against previously-seen articles, writes new articles as
// Markdown content files for Astro (storing the FULL article body when the
// feed provides one via <content:encoded> or <content>), prunes content
// older than the configured retention window, and writes back per-source
// status to both Notion and a local JSON file (rendered by /admin/status).
//
// Design principles (per project requirements):
//   - Per-source failures are caught and skipped; they never abort the run
//     or affect other sources / the rest of the site.
//   - Failed sources are flagged in Notion (Status + Last Error) so a human
//     can review and remove/replace them - this script never deletes a
//     source itself.
//   - All tunables (retention, summary length, timeouts, categories) come
//     from site.config.json - nothing is hardcoded here.
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
  truncate,
  extractImage,
  yamlEscape,
  withTimeout,
} from './utils.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const ARTICLES_DIR = path.join(ROOT, 'src/content/articles');
const SEEN_FILE = path.join(ROOT, 'data/seen-urls.json');
const STATUS_FILE = path.join(ROOT, 'data/sources-status.json');

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

const FETCH_TIMEOUT_MS = siteConfig.content.fetchTimeoutMs ?? 8000;
const SUMMARY_LENGTH = siteConfig.content.summaryLength ?? 160;
const RETENTION_DAYS = siteConfig.content.retentionDays ?? 30;

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

// Map a Notion "Category" select label (e.g. "国际观察") to the matching
// category id from site.config.json (e.g. "international"). Falls back to
// the first configured category if no label matches, so the build never
// breaks on an unmapped category.
function mapCategory(label) {
  const match = siteConfig.categories.find((c) => c.label === label);
  return match ? match.id : siteConfig.categories[0].id;
}

// Pick the best available full-content HTML from an RSS/Atom item.
// Falls back through progressively shorter fields until something usable
// is found; the card/meta summary is always derived separately from
// item.contentSnippet so it stays short even when the body is long.
function pickFullContentHtml(item) {
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

  // Body: prefer the sanitized full-content HTML from the feed. Raw HTML in
  // a .md file is passed through by Astro's markdown renderer, so this
  // renders as the full article. If a feed has no body beyond its summary,
  // bodyHtml falls back to the (short) description - never empty.
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
        const image = extractImage(item);
        const slug = buildSlug(link, pubDate);

        const fullHtml = pickFullContentHtml(item);
        const bodyHtml = sanitizeHtml(fullHtml);

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

      console.log(`  -> ${newItems} new article(s)`);
      statusResults.push({ name: label, category: source.category, status: '✅ OK', newItems });
      await updateSourceStatus(NOTION_API_KEY, source.pageId, {
        status: '✅ OK',
        lastFetchedIso: new Date().toISOString(),
        lastError: null,
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

main().catch((err) => {
  // Top-level safety net: never let an unexpected error crash CI with a
  // non-zero exit that blocks the build. Log and exit cleanly.
  console.error('Unexpected error in fetch-news.mjs:', err);
  process.exitCode = 0;
});
