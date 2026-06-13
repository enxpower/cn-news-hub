// Minimal Notion API client for the "News Sources" database.
// Uses only the global fetch API (Node 20+) - no SDK dependency.
const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const REQUEST_TIMEOUT_MS = 10000;

function headers(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

// Wrap fetch with an AbortController-based timeout. Without this, a single
// hung Notion API call (e.g. transient network issue on the runner) would
// block the entire script indefinitely - this is the fetch-level equivalent
// of withTimeout() in utils.mjs.
async function fetchWithTimeout(url, options, ms = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Fetch all rows from the News Sources database, handling pagination.
// Returns a simplified array of { pageId, name, rssUrl, category, enabled }.
export async function fetchSources(apiKey, databaseId) {
  const rows = [];
  let cursor;

  do {
    const res = await fetchWithTimeout(`${NOTION_API_BASE}/databases/${databaseId}/query`, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify({
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });

    if (!res.ok) {
      throw new Error(`Notion query failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    for (const page of data.results) {
      const props = page.properties;
      rows.push({
        pageId: page.id,
        name: props.Name?.title?.[0]?.plain_text ?? '(未命名)',
        rssUrl: props['RSS URL']?.url ?? '',
        category: props.Category?.select?.name ?? '',
        enabled: props.Enabled?.checkbox === true,
      });
    }

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return rows;
}

// Write back the result of a fetch attempt for one source.
// This is best-effort: any failure (including a timeout) is caught and
// logged, never thrown, so a Notion API hiccup can never block the overall
// fetch-news run.
export async function updateSourceStatus(apiKey, pageId, { status, lastFetchedIso, lastError }) {
  try {
    const res = await fetchWithTimeout(`${NOTION_API_BASE}/pages/${pageId}`, {
      method: 'PATCH',
      headers: headers(apiKey),
      body: JSON.stringify({
        properties: {
          Status: { select: { name: status } },
          'Last Fetched': { date: { start: lastFetchedIso } },
          'Last Error': {
            rich_text: lastError
              ? [{ type: 'text', text: { content: lastError.slice(0, 200) } }]
              : [],
          },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`  ! Notion status update failed for ${pageId}: ${res.status} ${body}`);
    }
  } catch (err) {
    console.error(`  ! Notion status update errored for ${pageId}: ${err.message}`);
  }
}
