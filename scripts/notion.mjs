// Minimal Notion API client for the "News Sources" database.
// Uses only the global fetch API (Node 20+) - no SDK dependency.
const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function headers(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

// Fetch all rows from the News Sources database, handling pagination.
// Returns a simplified array of { pageId, name, rssUrl, category, enabled }.
export async function fetchSources(apiKey, databaseId) {
  const rows = [];
  let cursor;

  do {
    const res = await fetch(`${NOTION_API_BASE}/databases/${databaseId}/query`, {
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
export async function updateSourceStatus(apiKey, pageId, { status, lastFetchedIso, lastError }) {
  const res = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
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
    // Non-fatal: log and continue. Status write-back is a convenience,
    // not critical to the content pipeline.
    const body = await res.text().catch(() => '');
    console.error(`  ! Notion status update failed for ${pageId}: ${res.status} ${body}`);
  }
}
