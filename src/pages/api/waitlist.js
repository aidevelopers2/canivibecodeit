import { addToWaitlist, rateLimit } from '../../lib/db.js';
import { clientIp, json, readBody, validEmail } from '../../lib/request.js';

const SOURCES = ['home', 'app', 'app_copy', 'category', '404', 'bar'];

// Inert until the Resend vars are set: the site is the source of truth, the
// audience is a mirror. Never blocks or fails the signup.
function mirrorToResend(email) {
  const key = process.env.RESEND_API_KEY;
  const audience = process.env.RESEND_AUDIENCE_ID;
  if (!key || !audience) return;
  fetch(`https://api.resend.com/audiences/${audience}/contacts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

export async function POST({ request, clientAddress }) {
  const ip = clientIp(request, clientAddress);
  if (!(await rateLimit(`waitlist:${ip}`, 5, 60 * 60 * 1000))) {
    return json({ error: 'slow down' }, 429);
  }

  let body;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  // Honeypot: bots fill every field. Pretend success, store nothing.
  if (body.website) return json({ ok: true });

  const email = body.email?.trim().toLowerCase();
  if (!validEmail(email)) return json({ error: 'invalid email' }, 400);

  const source = SOURCES.includes(body.source) ? body.source : 'unknown';

  // Only new rows are mirrored: re-posting an address must never resubscribe
  // someone who unsubscribed on Resend's side.
  if (await addToWaitlist(email, source)) mirrorToResend(email);
  // Dedupe silently — "you're on the list" either way, no email enumeration.
  return json({ ok: true });
}
