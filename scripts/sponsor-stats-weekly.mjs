/* Weekly sponsor stats email: every live sponsor gets their numbers and a link
   to their private stats page, once a week.

   Modes:
     (no flag)  dry run: print what would be sent, send nothing
     --test     send every email to DIGEST_TEST_EMAIL instead of the sponsors
     --send     the real thing
     --sqlite   read the local dev database instead of the production Postgres

   Config comes from the environment (real env wins over the local .env file):
   DATABASE_PUBLIC_URL, RESEND_API_KEY, DIGEST_ALERT_EMAIL, DIGEST_TEST_EMAIL.
   Nothing secret belongs in this file. */

import {
  readFileSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync, statSync, truncateSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = process.env.SPONSOR_STATE_DIR || '/srv/http/canivibecodeit-data/sponsor';
const LOCK_FILE = path.join(STATE_DIR, 'stats-weekly.lock');
const LOG_FILE = path.join(STATE_DIR, 'stats-weekly.log');
const STATE_FILE = path.join(STATE_DIR, 'stats-weekly.json');
const LOCK_STALE_MS = 30 * 60 * 1000;
const LOG_MAX_BYTES = 1024 * 1024;

const SITE = 'https://canivibecodeit.com';
const FROM = 'Rob at canivibecodeit <digest@send.canivibecodeit.com>';
const REPLY_TO = 'digest@canivibecodeit.com';

// Click logging went live the evening of Aug 2, 2026. Earlier clicks were
// never recorded — totals are stated as undercounts, never extrapolated.
const CLICKS_SINCE = Date.UTC(2026, 7, 2, 18);

const MODE = process.argv.includes('--send') ? 'send'
  : process.argv.includes('--test') ? 'test'
    : 'dry';
const FORCE = process.argv.includes('--force');
const USE_SQLITE = process.argv.includes('--sqlite');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);

function isoWeekKey(date) {
  const t = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

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
      console.log('stats-weekly.log passed 1 MB, truncated');
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
      const db = new Database(path.join(dir, 'site.db'), { readonly: true });
      return {
        kind: 'sqlite',
        all: async (sql, params = []) => db.prepare(sql).all(...params),
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

/* Never throws: one dud address must not stop everyone else's email. */
async function send(to, subject, text) {
  if (!to) return false;
  if (MODE === 'dry') {
    console.log(`  would email ${to}: ${subject}`);
    return false;
  }
  const target = MODE === 'test' ? need('DIGEST_TEST_EMAIL') : to;
  try {
    await resend({ to: target, subject, text });
  } catch (err) {
    console.error(`  mail to ${target} failed: ${err?.message || err}`);
    return false;
  }
  console.log(`  emailed ${target}: ${subject}`);
  return true;
}

/* ---------- the numbers ---------- */

function sponsorStats(p, clicks, imps, now) {
  const from = Math.max(num(p.starts_at), CLICKS_SINCE);
  const mine = clicks.filter(
    (c) => c.slot_id === p.slot_id && num(c.created_at) >= from
  );
  const week = mine.filter((c) => num(c.created_at) >= now - 7 * DAY);

  const countries = new Map();
  for (const c of mine) {
    const co = c.country || '??';
    countries.set(co, (countries.get(co) ?? 0) + 1);
  }
  const flag = (cc) =>
    /^[A-Z]{2}$/.test(cc)
      ? `${String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))} `
      : '';
  const top = [...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([co, k]) => `${flag(co)}${co} ${k}`).join(' · ');

  const weekDays = new Set(
    Array.from({ length: 7 }, (_, i) => dayKey(now - i * DAY))
  );
  // Impression rows are per calendar day, so a term that started mid-day only
  // owns its first FULL day onward — the partial day belongs to whoever held
  // the slot before.
  const startDay = num(p.starts_at) % DAY === 0
    ? dayKey(num(p.starts_at))
    : dayKey(num(p.starts_at) + DAY);
  const myImps = imps.filter(
    (r) => r.slot_id === p.slot_id && weekDays.has(r.day) && r.day >= startDay
  );
  const imps7 = myImps.reduce((sum, r) => sum + num(r.count), 0);
  const impDays = new Set(myImps.map((r) => r.day));
  const clicksOnImpDays = week.filter((c) => impDays.has(dayKey(num(c.created_at)))).length;
  const ctr = imps7 > 0 ? ((clicksOnImpDays / imps7) * 100).toFixed(2) : null;

  return {
    total: mine.length,
    week: week.length,
    countries: countries.size,
    top,
    imps7,
    ctr,
    // The term started before click logging existed: totals are a partial
    // period and the email says so outright.
    partial: num(p.starts_at) < CLICKS_SINCE,
  };
}

function emailText(p, s) {
  const lines = [
    `${p.name || 'Your placement'} in slot ${p.slot_id}, the last 7 days:`,
    '',
    `  clicks         ${s.week}`,
    `  impressions    ${s.imps7 > 0 ? s.imps7.toLocaleString('en-US') : 'measurement just started — full week next time'}`,
  ];
  if (s.ctr != null) lines.push(`  ctr            ${s.ctr}%`);
  if (s.top) lines.push(`  top countries  ${s.top}`);
  lines.push(
    '',
    `Whole term so far: ${s.total.toLocaleString('en-US')} clicks from ${s.countries} countries`
      + `${s.partial ? ' (measured since Aug 2 — partial period)' : ''}.`,
    '',
    'Daily trend, full country list, and your card as it shows on the site:',
    `${SITE}/sponsor/stats?t=${encodeURIComponent(p.details_token)}`,
    '',
    'These are first-party counts with known bots filtered, and clicks before',
    'Aug 2 were never logged — so if anything, the real numbers are higher.',
    'Your link is tagged utm_source=canivibecodeit, so the same traffic shows',
    'up in your own analytics as canivibecodeit / referral.',
    '',
    'Reply to this email and a human answers.'
  );
  return lines.join('\n');
}

/* ---------- main ---------- */

// A real send is once per ISO week: a mis-set cron or an accidental re-run
// must not email every sponsor twice. --force overrides.
function alreadySentThisWeek(week) {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')).week === week;
  } catch {
    return false;
  }
}

async function main() {
  const now = Date.now();
  const week = isoWeekKey(new Date(now));
  if (MODE === 'send' && !FORCE && alreadySentThisWeek(week)) {
    console.log(`already sent for ${week}, use --force to resend`);
    return;
  }
  const db = await openDb();
  console.log(`sponsor-stats-weekly (${MODE}) on ${db.kind}`);
  try {
    const live = await db.all(
      `SELECT id, slot_id, email, name, details_token, starts_at, ends_at
       FROM sponsor_purchases
       WHERE status = 'live' AND ends_at > ? AND starts_at <= ? AND email IS NOT NULL
       ORDER BY slot_id`,
      [now, now]
    );
    if (live.length === 0) {
      console.log('no live sponsors, nothing to send');
      return;
    }
    const clicks = await db.all(
      'SELECT slot_id, country, created_at FROM sponsor_clicks WHERE created_at >= ?',
      [CLICKS_SINCE]
    );
    const imps = await db.all(
      'SELECT slot_id, day, count FROM sponsor_impressions WHERE day >= ?',
      [dayKey(now - 8 * DAY)]
    );

    let sent = 0;
    const summary = [];
    for (const p of live) {
      const s = sponsorStats(p, clicks, imps, now);
      console.log(
        `${p.slot_id} ${p.name || 'unnamed'}: ${s.week} clicks 7d, ${s.total} term, ${s.imps7} imps 7d`
      );
      const ok = await send(
        p.email,
        `your week on canivibecodeit — ${s.week} click${s.week === 1 ? '' : 's'}`,
        emailText(p, s)
      );
      if (ok) sent += 1;
      summary.push(`${p.slot_id} ${p.name || 'unnamed'}: ${s.week} clicks 7d / ${s.total} term → ${ok ? 'sent' : MODE === 'dry' ? 'dry' : 'FAILED'}`);
    }

    if (MODE === 'send') {
      writeFileSync(STATE_FILE, JSON.stringify({ week, sent, at: new Date(now).toISOString() }));
      await send(
        process.env.DIGEST_ALERT_EMAIL,
        `sponsor stats emails: ${sent}/${live.length} sent`,
        summary.join('\n')
      );
    }
  } finally {
    await db.close();
  }
}

loadEnvFile(path.join(root, '.env'));
rollLog();

let locked = false;
process.on('exit', () => {
  if (locked) releaseLock();
});

try {
  // A dry run changes nothing and sends nothing, so it needs no lock.
  if (MODE !== 'dry') {
    locked = acquireLock();
    if (!locked) {
      console.error('another stats-weekly run holds the lock, exiting');
      process.exit(1);
    }
  }
  await main();
} catch (err) {
  const message = err?.message || String(err);
  console.error(`sponsor-stats-weekly failed: ${message}`);
  process.exit(1);
}
