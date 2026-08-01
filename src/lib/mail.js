/* Transactional mail over Resend's REST API.

   The sender constants are duplicated from the digest script on purpose: that
   script is a standalone cron job with its own env loading and must keep
   running untouched by anything the site does. */

const FROM = 'Rob at canivibecodeit <digest@send.canivibecodeit.com>';
const REPLY_TO = 'digest@canivibecodeit.com';

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* Never throws and never blocks a state change: the money has already moved by
   the time most of these send, so a mail outage must not fail the request. */
export async function sendMail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`mail skipped (no RESEND_API_KEY): ${subject}`);
    return false;
  }
  if (!to) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, reply_to: REPLY_TO, subject, html, text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`mail failed (${res.status}): ${subject}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`mail failed: ${err?.message || err}`);
    return false;
  }
}

export async function alertRob(subject, html) {
  return sendMail({ to: process.env.DIGEST_ALERT_EMAIL, subject, html });
}

const MONO = "font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;";

export function shell(body) {
  return `<div style="${MONO} font-size:14px; line-height:1.6; color:#171a17; max-width:520px;">${body}</div>`;
}

export function button(href, label) {
  return `<a href="${esc(href)}" style="${MONO} display:inline-block; background:#0e9c47;`
    + ` color:#ffffff; font-size:14px; font-weight:700; text-decoration:none;`
    + ` padding:12px 20px; border-radius:8px;">${esc(label)}</a>`;
}
