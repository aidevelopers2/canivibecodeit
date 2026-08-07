/* Reads site stats back from PostHog via HogQL, server-side, cached for 60s
   so the strip never hammers their API (or leaks how it's queried). Absent
   credentials degrade to nulls — the UI renders placeholders. */

const HOST = process.env.POSTHOG_UI_HOST || 'https://eu.posthog.com';
const PROJECT = process.env.POSTHOG_PROJECT_ID;
const KEY = process.env.POSTHOG_PERSONAL_KEY;

const QUERY = `
  SELECT
    countIf(event = '$pageview' AND timestamp >= toStartOfDay(now())) AS views_today,
    countIf(event = '$pageview') AS views_7d,
    countDistinctIf(person_id, event = '$pageview') AS visitors_7d,
    countIf(event = 'copy_prompt') AS copies_7d,
    (SELECT max(pv) FROM (
      SELECT toDate(timestamp) AS d, countIf(event = '$pageview') AS pv
      FROM events
      WHERE properties.$host = 'canivibecodeit.com'
      GROUP BY d
    )) AS best_day
  FROM events
  WHERE properties.$host = 'canivibecodeit.com'
    AND timestamp > now() - INTERVAL 7 DAY
`;

async function hogql(query) {
  const res = await fetch(`${HOST}/api/projects/${PROJECT}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`posthog ${res.status}`);
  return (await res.json()).results;
}

const SITE = `properties.$host = 'canivibecodeit.com'`;

let dashCache = { at: 0, data: null };

// Fuller dataset for the /stats page. One shared 2-minute cache.
export async function dashboardStats() {
  if (!PROJECT || !KEY) return null;
  const now = Date.now();
  if (now - dashCache.at < 120_000) return dashCache.data;

  try {
    const [tiles, allTime, byDay, pages, agents, topPrompts] = await Promise.all([
      hogql(QUERY),
      hogql(`
        SELECT countIf(event = '$pageview') AS views,
               countDistinctIf(person_id, event = '$pageview') AS visitors,
               countIf(event = 'copy_prompt') AS copies,
               toDate(min(timestamp)) AS since
        FROM events
        WHERE ${SITE}
      `),
      hogql(`
        SELECT toDate(timestamp) AS d,
               countIf(event = '$pageview') AS views,
               countDistinctIf(person_id, event = '$pageview') AS visitors
        FROM events
        WHERE ${SITE} AND timestamp > now() - INTERVAL 14 DAY
        GROUP BY d ORDER BY d
      `),
      hogql(`
        SELECT properties.$pathname AS p, count() AS n
        FROM events
        WHERE ${SITE} AND event = '$pageview' AND timestamp > now() - INTERVAL 7 DAY
        GROUP BY p ORDER BY n DESC LIMIT 8
      `),
      hogql(`
        SELECT coalesce(properties.agent, 'unknown') AS a, count() AS n
        FROM events
        WHERE ${SITE} AND event = 'copy_prompt' AND timestamp > now() - INTERVAL 7 DAY
        GROUP BY a ORDER BY n DESC
      `),
      hogql(`
        SELECT coalesce(properties.app, 'unknown') AS app, count() AS n
        FROM events
        WHERE ${SITE} AND event = 'copy_prompt' AND timestamp > now() - INTERVAL 7 DAY
        GROUP BY app ORDER BY n DESC LIMIT 8
      `),
    ]);
    const [viewsToday, views7d, visitors7d, copies7d, bestDay] = tiles[0];
    const [totalViews, totalVisitors, totalCopies, since] = allTime[0];
    dashCache = {
      at: now,
      data: {
        tiles: { viewsToday, views7d, visitors7d, copies7d, bestDay },
        allTime: { views: totalViews, visitors: totalVisitors, copies: totalCopies, since },
        byDay: byDay.map(([d, views, visitors]) => ({ d, views, visitors })),
        pages: pages.map(([p, n]) => ({ p, n })),
        agents: agents.map(([a, n]) => ({ a, n })),
        topPrompts: topPrompts.map(([app, n]) => ({ app, n })),
      },
    };
  } catch {
    dashCache.at = now; // serve stale, retry after TTL
  }
  return dashCache.data;
}

let cache = { at: 0, data: null };

export async function siteStats() {
  if (!PROJECT || !KEY) return null;
  const now = Date.now();
  if (now - cache.at < 60_000) return cache.data;

  try {
    const res = await fetch(`${HOST}/api/projects/${PROJECT}/query/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: QUERY } }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`posthog ${res.status}`);
    const body = await res.json();
    const [viewsToday, views7d, visitors7d, copies7d, bestDay] = body.results[0];
    cache = {
      at: now,
      data: { viewsToday, views7d, visitors7d, copies7d, bestDay },
    };
  } catch {
    // keep serving the stale value; retry after the TTL
    cache.at = now;
  }
  return cache.data;
}
