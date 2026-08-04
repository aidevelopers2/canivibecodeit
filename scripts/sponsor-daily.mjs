/* Daily sponsor housekeeping: reminders, nudges, and bookkeeping.

   Nothing here is load-bearing for correctness — the site decides at render time
   whether a hold has lapsed or a placement has ended, so a missed run costs
   emails and tidy statuses, never a wrongly occupied slot.

   Modes:
     --dry      report what would happen, change nothing, send nothing
     --sqlite   read the local dev database instead of the production Postgres

   Config comes from the environment (real env wins over the local .env file):
   DATABASE_PUBLIC_URL, RESEND_API_KEY, DIGEST_ALERT_EMAIL. Nothing secret
   belongs in this file. */

import {
  readFileSync, mkdirSync, openSync, closeSync, unlinkSync, statSync, truncateSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Overridable so a supervised test run can keep its lock and log out of the
// real state directory.
const STATE_DIR = process.env.SPONSOR_STATE_DIR || '/srv/http/canivibecodeit-data/sponsor';
const LOCK_FILE = path.join(STATE_DIR, 'sponsor.lock');
const LOG_FILE = path.join(STATE_DIR, 'sponsor.log');
const LOCK_STALE_MS = 30 * 60 * 1000;
const LOG_MAX_BYTES = 1024 * 1024;

const SITE = 'https://canivibecodeit.com';
const FROM = 'Rob at canivibecodeit <digest@send.canivibecodeit.com>';
const REPLY_TO = 'digest@canivibecodeit.com';

const DRY = process.argv.includes('--dry');
const USE_SQLITE = process.argv.includes('--sqlite');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Renewal reminder goes out with four days left, so day 26 of a 30-day run.
const RENEW_WINDOW_MS = 4 * DAY;

/* ---------- env ---------- */

function loadEnvFile(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    const quoted = (value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1);
    if (quoted) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    // An empty env var is not a value: the .env entry still wins.
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name} in the environment`);
  return v;
}

/* ---------- lock + log ---------- */

function acquireLock() {
  mkdirSync(STATE_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      closeSync(openSync(LOCK_FILE, 'wx'));
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age = 0;
      try {
        age = Date.now() - statSync(LOCK_FILE).mtimeMs;
      } catch {
        continue;
      }
      if (age < LOCK_STALE_MS) return false;
      console.error(`stale lock (${Math.round(age / 60000)} min old), taking it over`);
      try {
        unlinkSync(LOCK_FILE);
      } catch {}
    }
  }
  return false;
}

function releaseLock() {
  try {
    unlinkSync(LOCK_FILE);
  } catch {}
}

function rollLog() {
  try {
    if (statSync(LOG_FILE).size > LOG_MAX_BYTES) {
      truncateSync(LOG_FILE, 0);
      console.log('sponsor.log passed 1 MB, truncated');
    }
  } catch {}
}

/* ---------- database ---------- */

// One statement style, two drivers: SQL is written with ? and renumbered for pg.
function openDb() {
  if (USE_SQLITE || !process.env.DATABASE_PUBLIC_URL) {
    return import('better-sqlite3').then(({ default: Database }) => {
      // resolve, not join: DATA_DIR is usually absolute and must win over root.
      const dir = path.resolve(root, process.env.DATA_DIR || 'data/private');
      const db = new Database(path.join(dir, 'site.db'), { readonly: false });
      return {
        kind: 'sqlite',
        all: async (sql, params = []) => db.prepare(sql).all(...params),
        run: async (sql, params = []) => db.prepare(sql).run(...params).changes,
        close: async () => db.close(),
      };
    });
  }
  return import('pg').then(({ default: pg }) => {
    const pool = new pg.Pool({ connectionString: need('DATABASE_PUBLIC_URL'), max: 2 });
    const renumber = (sql) => {
      let i = 0;
      return sql.replace(/\?/g, () => `$${++i}`);
    };
    return {
      kind: 'postgres',
      all: async (sql, params = []) => (await pool.query(renumber(sql), params)).rows,
      run: async (sql, params = []) => (await pool.query(renumber(sql), params)).rowCount,
      close: async () => pool.end().catch(() => {}),
    };
  });
}

const num = (v) => (v == null ? null : Number(v));

/* ---------- mail ---------- */

async function resend(body) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${need('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, reply_to: REPLY_TO, ...body }),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`resend: HTTP ${res.status} ${json?.message || ''}`.trim());
  return json;
}

/* Never throws: one sponsor with a dud address must not stop the reminders,
   nudges and bookkeeping for everyone else. A send that fails leaves its
   reminder flag unset, so the next run simply tries again. */
async function send(to, subject, text) {
  if (!to) return false;
  if (DRY) {
    console.log(`  would email ${to}: ${subject}`);
    return false;
  }
  if (!process.env.RESEND_API_KEY) {
    console.log(`  mail skipped (no RESEND_API_KEY): ${subject}`);
    return false;
  }
  try {
    await resend({ to, subject, text });
  } catch (err) {
    console.error(`  mail to ${to} failed: ${err?.message || err}`);
    return false;
  }
  console.log(`  emailed ${to}: ${subject}`);
  return true;
}

async function alert(subject, text) {
  return send(process.env.DIGEST_ALERT_EMAIL, subject, text);
}

/* ---------- tasks ---------- */

async function detailsReminders(db, now) {
  const rows = await db.all(
    `SELECT id, slot_id, email, paid_at, details_token FROM sponsor_purchases
     WHERE status = 'paid' AND reminder_details_at IS NULL AND paid_at < ?`,
    [now - 24 * HOUR]
  );
  for (const r of rows) {
    const hours = Math.round((now - num(r.paid_at)) / HOUR);
    console.log(`details reminder: ${r.id} (${r.slot_id}, paid ${hours}h ago)`);
    const sent = await send(
      r.email,
      'your sponsor slot is paid for but empty',
      `Your slot is paid for and held, but we still need the details before it can run:\n\n`
      + `name, one line, and the link you want it to point at.\n\n`
      + `Fill them in here:\n${SITE}/sponsor/details?t=${encodeURIComponent(r.details_token)}\n\n`
      + `Reply to this email if anything looks wrong.`
    );
    if (sent) {
      await db.run('UPDATE sponsor_purchases SET reminder_details_at = ? WHERE id = ?', [now, r.id]);
    }
  }
  return rows.length;
}

// Runs that started before this date have their renewals handled personally;
// the automated end-of-term reminder only applies to runs from this date on.
const AUTO_RENEW_REMINDERS_FROM = Date.UTC(2026, 8, 1);

async function renewReminders(db, now) {
  // A sponsor who already received the next-run offer email needs no generic
  // end-of-term reminder on top of it.
  const rows = await db.all(
    `SELECT id, slot_id, email, name, ends_at FROM sponsor_purchases
     WHERE status = 'live' AND reminder_renew_at IS NULL AND reminder_offer_at IS NULL
       AND ends_at < ? AND ends_at > ? AND starts_at >= ?`,
    [now + RENEW_WINDOW_MS, now, AUTO_RENEW_REMINDERS_FROM]
  );
  // A slot whose next run is already paid for needs no reminder at all.
  const booked = new Set(
    (await db.all(
      `SELECT DISTINCT slot_id FROM sponsor_purchases
       WHERE status IN ('live', 'paid', 'submitted', 'reject_failed') AND starts_at > ?`,
      [now]
    )).map((r) => r.slot_id)
  );
  for (const r of rows.filter((r) => !booked.has(r.slot_id))) {
    const days = Math.max(1, Math.round((num(r.ends_at) - now) / DAY));
    console.log(`renew reminder: ${r.id} (${r.slot_id}, ${days}d left)`);
    const sent = await send(
      r.email,
      `${r.name || 'your placement'} comes down in ${days} days`,
      `Your slot ends in ${days} days.\n\n`
      + `There's no auto-renew — when it ends, it ends. If you want another 30 days,`
      + ` take the slot again at whatever it's priced at now: ${SITE}/sponsor\n\n`
      + `Reply here if you'd rather sort it by email.`
    );
    if (sent) {
      await db.run('UPDATE sponsor_purchases SET reminder_renew_at = ? WHERE id = ?', [now, r.id]);
    }
  }
  return rows.length;
}

/* ---------- next-run offers (the 18th) ---------- */

/* On the 18th of each month (with two days of retry slack), every current
   sponsor whose run began on or after AUTO_RENEW_REMINDERS_FROM gets one offer
   email: their slot's next run at the admin-set offer price, via a single-use
   payment link, first refusal until the 24th, public at board price from the
   25th. Runs that predate the cutoff were handled personally and are skipped. */

const OFFER_WINDOW_DAYS = [18, 19, 20];
// An outgoing run may spill this far into the next term without conflicting —
// mirrors the site's SPILL_MS.
const OFFER_SPILL_MS = 3 * DAY;
const monthTag = (y, m) => `${y}_${String(m + 1).padStart(2, '0')}`;

async function stripeForm(pathname, params, idempotencyKey) {
  const key = need('STRIPE_SECRET_KEY');
  const out = new URLSearchParams();
  const encode = (value, prefix) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) encode(v, `${prefix}[${k}]`);
    } else {
      out.append(prefix, String(value));
    }
  };
  for (const [k, v] of Object.entries(params)) encode(v, k);
  const res = await fetch(`https://api.stripe.com${pathname}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: out.toString(),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`stripe ${pathname}: HTTP ${res.status} ${json?.error?.message || ''}`.trim());
  return json;
}

async function mintOfferLink(purchase, offerCents, year, month, tag) {
  const price = await stripeForm(
    '/v1/prices',
    {
      currency: 'usd',
      unit_amount: offerCents,
      product_data: { name: `canivibecodeit.com — sponsor slot ${purchase.slot_id} (30 days)` },
    },
    `offer-${purchase.id}-${tag}-price`
  );
  const link = await stripeForm(
    '/v1/payment_links',
    {
      'line_items[0][price]': price.id,
      'line_items[0][quantity]': 1,
      metadata: {
        purpose: `sponsor_renewal_${monthTag(year, month)}`,
        slot_id: purchase.slot_id,
        sponsor: purchase.name || '',
        months: 1,
      },
      restrictions: { completed_sessions: { limit: 1 } },
      tax_id_collection: { enabled: true },
      billing_address_collection: 'required',
      customer_creation: 'always',
      invoice_creation: { enabled: true },
    },
    `offer-${purchase.id}-${tag}-link`
  );
  return link.url;
}

function offerEmailText(p, offerCents, boardCents, endDate, startDate, linkUrl, statsUrl) {
  const usd = (c) => `$${(Number(c) / 100).toLocaleString('en-US')}`;
  return (
    `Your slot ${p.slot_id} run ends ${endDate}. Next month is yours first:\n\n`
    + `  ${usd(offerCents)} for 30 days from ${startDate} — same slot, same card,\n`
    + `  nothing else to do. One click:\n\n`
    + `${linkUrl}\n\n`
    + `That price is yours until the 24th. From the 25th the slot goes on the\n`
    + `public board at ${usd(boardCents)}, first paid, first placed.\n\n`
    + `Your numbers so far: ${statsUrl}\n\n`
    + `Want it locked for 3 months at this price in one payment? Reply and\n`
    + `we'll set it up. Reply to this email for anything else too — a human\n`
    + `reads it.`
  );
}

async function nextRunOffers(db, now) {
  const d = new Date(now);
  if (!OFFER_WINDOW_DAYS.includes(d.getUTCDate())) return 0;

  const rows = await db.all(
    `SELECT id, slot_id, email, name, details_token, starts_at, ends_at FROM sponsor_purchases
     WHERE status = 'live' AND reminder_offer_at IS NULL AND email IS NOT NULL
       AND starts_at >= ? AND starts_at <= ? AND ends_at > ?`,
    [AUTO_RENEW_REMINDERS_FROM, now, now]
  );
  if (rows.length === 0) return 0;

  const slots = await db.all('SELECT id, price_cents, renewal_price_cents FROM sponsor_slots', []);
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const booked = new Set(
    (await db.all(
      `SELECT DISTINCT slot_id FROM sponsor_purchases
       WHERE status IN ('live', 'paid', 'submitted', 'reject_failed') AND starts_at > ?`,
      [now]
    )).map((r) => r.slot_id)
  );

  const year = d.getUTCFullYear() + (d.getUTCMonth() === 11 ? 1 : 0);
  const month = (d.getUTCMonth() + 1) % 12;
  const startMs = Date.UTC(year, month, 1);
  const startDate = new Date(startMs).toISOString().slice(0, 10);
  const tag = monthTag(year, month);

  let sent = 0;
  const problems = [];
  for (const r of rows) {
    if (booked.has(r.slot_id)) continue;
    // A run that extends into the offered term (mid-month or multi-month buys)
    // already owns some or all of it — offering it again would sell them a
    // month they have. They get the generic end-of-term reminder instead.
    if (num(r.ends_at) > startMs + OFFER_SPILL_MS) continue;
    const slot = slotById.get(r.slot_id);
    if (!slot?.renewal_price_cents) {
      problems.push(`${r.slot_id} (${r.name || 'unnamed'}): no offer price set — no email sent`);
      continue;
    }
    console.log(`next-run offer: ${r.id} (${r.slot_id}, ${r.name || 'unnamed'})`);
    if (DRY) {
      console.log(`  would mint link + email ${r.email}`);
      continue;
    }
    try {
      const url = await mintOfferLink(r, num(slot.renewal_price_cents), year, month, tag);
      /* Marked BEFORE the send: if the send fails the mark is lifted again and
         the failure alerted, but a mark that sticks after a successful send can
         never double-email (or double-mint) on the next day's retry. */
      await db.run('UPDATE sponsor_purchases SET reminder_offer_at = ? WHERE id = ?', [now, r.id]);
      const ok = await send(
        r.email,
        `${r.name || 'your slot'} next month — yours first until the 24th`,
        offerEmailText(
          r,
          num(slot.renewal_price_cents),
          num(slot.price_cents),
          new Date(num(r.ends_at)).toISOString().slice(0, 10),
          startDate,
          url,
          `${SITE}/sponsor/stats?t=${encodeURIComponent(r.details_token)}`
        )
      );
      if (ok) {
        // A sent offer consumes the price: next cycle needs a fresh decision.
        await db.run('UPDATE sponsor_slots SET renewal_price_cents = NULL WHERE id = ?', [r.slot_id]);
        sent += 1;
      } else {
        await db.run('UPDATE sponsor_purchases SET reminder_offer_at = NULL WHERE id = ?', [r.id]);
        problems.push(`${r.slot_id} (${r.name || 'unnamed'}): offer email failed to send`);
      }
    } catch (err) {
      problems.push(`${r.slot_id} (${r.name || 'unnamed'}): ${err?.message || err}`);
    }
  }

  if (problems.length > 0) {
    await alert(
      `next-run offers need you (${problems.length})`,
      `${problems.join('\n')}\n\nSet offer prices / retry from ${SITE}/admin/sponsors?token=...`
    );
  }
  if (sent > 0) {
    await alert(`next-run offers sent: ${sent}`, `Offers went to ${sent} sponsor(s) for ${startDate}.`);
  }
  return sent;
}

async function robNudges(db, now) {
  const stale = await db.all(
    `SELECT id, slot_id, email, paid_at FROM sponsor_purchases
     WHERE status = 'paid' AND paid_at < ?`,
    [now - 72 * HOUR]
  );
  const waiting = await db.all(
    `SELECT id, slot_id, name, submitted_at FROM sponsor_purchases
     WHERE status = 'submitted' AND submitted_at < ?`,
    [now - 48 * HOUR]
  );
  const failed = await db.all(
    "SELECT id, slot_id, email FROM sponsor_purchases WHERE status = 'reject_failed'",
    []
  );
  if (stale.length === 0 && waiting.length === 0 && failed.length === 0) return 0;

  const lines = [];
  for (const r of stale) {
    lines.push(`PAID, NO DETAILS 72h+: ${r.slot_id} ${r.email || 'no email'} (${r.id})`);
  }
  for (const r of waiting) {
    lines.push(`AWAITING APPROVAL 48h+: ${r.slot_id} ${r.name || 'unnamed'} (${r.id})`);
  }
  for (const r of failed) {
    lines.push(`REFUND FAILED, slot still blocked: ${r.slot_id} ${r.email || 'no email'} (${r.id})`);
  }
  console.log(lines.map((l) => `nudge: ${l}`).join('\n'));
  await alert(
    `canivibecodeit sponsors need you (${lines.length})`,
    `${lines.join('\n')}\n\nAdmin: ${SITE}/admin/sponsors?token=...`
  );
  return lines.length;
}

async function bookkeeping(db, now) {
  if (DRY) {
    const [ended] = await db.all(
      "SELECT COUNT(*) AS n FROM sponsor_purchases WHERE status = 'live' AND ends_at <= ?",
      [now]
    );
    const [lapsed] = await db.all(
      "SELECT COUNT(*) AS n FROM sponsor_purchases WHERE status = 'hold' AND hold_expires_at <= ?",
      [now]
    );
    console.log(`would expire ${Number(ended.n)} live and ${Number(lapsed.n)} lapsed holds`);
    return 0;
  }
  const ended = await db.run(
    "UPDATE sponsor_purchases SET status = 'expired' WHERE status = 'live' AND ends_at <= ?",
    [now]
  );
  const lapsed = await db.run(
    "UPDATE sponsor_purchases SET status = 'expired_hold' WHERE status = 'hold' AND hold_expires_at <= ?",
    [now]
  );
  console.log(`expired ${ended} finished placements and ${lapsed} lapsed holds`);
  return ended + lapsed;
}

/* ---------- main ---------- */

async function main() {
  const now = Date.now();
  const db = await openDb();
  console.log(`sponsor-daily (${DRY ? 'dry' : 'live'}) on ${db.kind}`);
  try {
    await detailsReminders(db, now);
    await nextRunOffers(db, now);
    await renewReminders(db, now);
    await robNudges(db, now);
    await bookkeeping(db, now);
  } finally {
    await db.close();
  }
}

loadEnvFile(path.join(root, '.env'));
rollLog();

// --sample-offer: email a rendered example of the next-run offer template to
// DIGEST_TEST_EMAIL (no database, no Stripe, no sponsors) and exit. This is
// how the template gets approved before it can ever reach a real recipient.
if (process.argv.includes('--sample-offer')) {
  // Entirely made-up sponsor and numbers: this is a layout proof, not data.
  const ok = await send(
    need('DIGEST_TEST_EMAIL'),
    '[TEST] Acme Notes next month — yours first until the 24th',
    offerEmailText(
      { slot_id: 'L9', name: 'Acme Notes' },
      100000,
      200000,
      '2026-10-01',
      '2026-10-01',
      'https://buy.stripe.com/EXAMPLE-LINK',
      `${SITE}/sponsor/stats?t=EXAMPLE-TOKEN`
    )
  );
  process.exit(ok ? 0 : 1);
}

let locked = false;
process.on('exit', () => {
  if (locked) releaseLock();
});

try {
  // A dry run changes nothing and sends nothing, so it needs no lock.
  if (!DRY) {
    locked = acquireLock();
    if (!locked) {
      console.error('another sponsor-daily run holds the lock, exiting');
      process.exit(1);
    }
  }
  await main();
} catch (err) {
  const message = err?.message || String(err);
  console.error(`sponsor-daily failed: ${message}`);
  if (!DRY) {
    try {
      await alert('canivibecodeit sponsor-daily FAILED', `Daily sponsor run failed: ${message}`);
    } catch (alertErr) {
      console.error(`alert failed: ${alertErr?.message || alertErr}`);
    }
  }
  process.exit(1);
}
