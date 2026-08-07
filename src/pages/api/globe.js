import { globeStats } from '../../lib/analytics.js';
import { json } from '../../lib/request.js';

// Polled by the homepage globe. globeStats() holds a 60s cache, so gentle
// polling never hammers PostHog.
export async function GET() {
  const data = await globeStats();
  if (!data) return json({ unavailable: true });
  return json(data);
}
