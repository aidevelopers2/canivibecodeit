import { getApp, allApps } from '../../../lib/apps.js';
import { addVote, removeVote, rateLimit, rateLimitActive, clearRateLimit, mrrDestroyed } from '../../../lib/db.js';
import { clientIp, json } from '../../../lib/request.js';

export async function POST({ params, request, clientAddress }) {
  const app = getApp(params.slug);
  if (!app) return json({ error: 'unknown app' }, 404);

  const ip = clientIp(request, clientAddress);
  // One vote per app per IP per day, and a burst cap across all apps.
  if (
    !(await rateLimit(`vote:${ip}:${params.slug}`, 1, 24 * 60 * 60 * 1000)) ||
    !(await rateLimit(`vote-burst:${ip}`, 10, 60 * 60 * 1000))
  ) {
    return json({ error: 'already counted' }, 429);
  }

  const count = await addVote(params.slug);
  return json({ count, mrr: mrrDestroyed(allApps()) });
}

// Un-vote: only ever undoes a vote THIS client actually cast. The POST above
// leaves a `vote:<ip>:<slug>` key (24h window); its presence is our proof a
// vote exists to remove. Without it there is nothing to take back, so we
// refuse, this is what stops anyone from draining other people's votes.
const VOTE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function DELETE({ params, request, clientAddress }) {
  const app = getApp(params.slug);
  if (!app) return json({ error: 'unknown app' }, 404);

  const ip = clientIp(request, clientAddress);
  if (!(await rateLimit(`unvote-burst:${ip}`, 20, 60 * 60 * 1000))) {
    return json({ error: 'slow down' }, 429);
  }
  if (!(await rateLimitActive(`vote:${ip}:${params.slug}`, VOTE_WINDOW_MS))) {
    return json({ error: 'no vote to remove' }, 403);
  }

  const count = await removeVote(params.slug);
  await clearRateLimit(`vote:${ip}:${params.slug}`);
  return json({ count, mrr: mrrDestroyed(allApps()) });
}
