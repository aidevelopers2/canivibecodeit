import {
  activePurchases, purchaseById, setSlotPrice, updatePurchase,
} from '../../../lib/db.js';
import { alertRob, esc, sendMail, shell } from '../../../lib/mail.js';
import { json, readBody } from '../../../lib/request.js';
import {
  cleanText, cleanTint, cleanUrl, clearCache, isAdmin, isLive, LIMITS, RUN_DAYS, RUN_MS,
  shortDate, siteUrl, SLOT_IDS, usd, verifyAction,
} from '../../../lib/sponsors.js';
import { alreadyRefunded, createRefund } from '../../../lib/stripe.js';

const REFUNDABLE = ['submitted', 'paid', 'reject_failed'];

export async function POST({ request }) {
  const wantsJson = (request.headers.get('content-type') || '').includes('application/json');

  let body;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const action = String(body.action ?? '');
  const id = String(body.id ?? '');
  // Two ways in: the admin token, or a signature that authorises exactly this
  // action on exactly this purchase (that's what the emailed links carry).
  const allowed = isAdmin(body.token) || (id && verifyAction(id, action, body.sig));
  if (!allowed) return json({ error: 'not found' }, 404);

  // Same-origin paths only: "//evil.com" and "/\evil.com" are both absolute to
  // a browser, so a leading slash on its own proves nothing.
  const backTo = (message) => {
    const back = String(body.return_to || '');
    const target = /^\/(?![/\\])/.test(back) ? back : '/sponsor';
    const sep = target.includes('?') ? '&' : '?';
    return new Response(null, {
      status: 303,
      headers: { Location: `${target}${sep}msg=${encodeURIComponent(message)}` },
    });
  };

  const done = (message) => {
    clearCache();
    return wantsJson ? json({ ok: true, message }) : backTo(message);
  };

  /* Rob approves from his phone, where a bare JSON 409 is invisible. Form posts
     go back to the page with the reason; JSON callers keep the status code. */
  const fail = (error, status) => (wantsJson ? json({ error }, status) : backTo(error));

  if (action === 'price') {
    const slot = String(body.slot ?? '').trim().toUpperCase();
    const dollars = Number(body.price);
    if (!SLOT_IDS.includes(slot)) return fail('unknown slot', 400);
    if (!Number.isFinite(dollars) || dollars < 1 || dollars > 100000) {
      return fail('bad price', 400);
    }
    await setSlotPrice(slot, Math.round(dollars * 100));
    return done(`${slot} priced at ${usd(Math.round(dollars * 100))}`);
  }

  const purchase = id ? await purchaseById(id) : null;
  if (!purchase) return json({ error: 'not found' }, 404);

  if (action === 'approve') {
    const now = Date.now();
    const endsAt = now + RUN_MS;

    /* Last line of defence for the payment race. The rivals check refunds the
       loser automatically, but its paid_at is read before the UPDATE commits, so
       a close enough reorder can leave two rows paid — and both could reach
       submitted. This makes the human gate refuse to double-book the slot. */
    const clash = (await activePurchases()).find(
      (o) => o.slot_id === purchase.slot_id && o.id !== purchase.id && isLive(o, now)
    );
    if (clash) {
      return fail(`${purchase.slot_id} is already live — refund one of these first`, 409);
    }

    // The clock starts at approval, not at payment: nobody pays for the days we
    // spent reviewing them.
    const changed = await updatePurchase(
      purchase.id,
      { status: 'live', approved_at: now, starts_at: now, ends_at: endsAt },
      ['submitted']
    );
    if (!changed) return fail('not awaiting approval', 409);
    await sendMail({
      to: purchase.email,
      subject: `you're live on canivibecodeit until ${shortDate(endsAt)}`,
      html: shell(
        `<p><b>${esc(purchase.name)}</b> is live in slot ${esc(purchase.slot_id)} right now, and`
        + ` runs until ${esc(shortDate(endsAt))} (${RUN_DAYS} days).</p>`
        + `<p>Your link carries campaign tags, so the traffic shows up in your analytics as`
        + ` canivibecodeit / referral.</p>`
        + `<p>We'll email you a few days before it ends. Replying to this email reaches a human.</p>`
      ),
    });
    return done(`${purchase.slot_id} live until ${shortDate(endsAt)}`);
  }

  if (action === 'reject' || action === 'retry_refund') {
    if (!REFUNDABLE.includes(purchase.status)) return fail('nothing to refund', 409);
    const isRetry = action === 'retry_refund';
    try {
      if (!purchase.stripe_payment_intent) throw new Error('no payment intent on this purchase');
      /* Stripe stores and replays the response for an idempotency key, errors
         included — so a first attempt that failed on something temporary (an
         insufficient balance on a young account) would replay that same failure
         forever if the retry reused the key. A manual retry therefore looks up
         the payment first and, only if nothing is on its way back, tries again
         under a fresh key. The automatic path keeps the static key: it fires
         without a human and must never refund twice. */
      const settled = isRetry && (await alreadyRefunded(purchase.stripe_payment_intent));
      if (!settled) {
        await createRefund(
          purchase.stripe_payment_intent,
          isRetry ? `refund-${purchase.id}-retry-${Date.now()}` : `refund-${purchase.id}`
        );
      }
    } catch (err) {
      await updatePurchase(purchase.id, { status: 'reject_failed' }, REFUNDABLE);
      clearCache();
      await alertRob(
        `sponsor refund FAILED (${purchase.slot_id})`,
        shell(
          `<p>Refunding <code>${esc(purchase.id)}</code> failed: ${esc(err?.message || err)}</p>`
          + `<p>Retry from <a href="${esc(siteUrl('/admin/sponsors'))}">the admin page</a>.</p>`
        )
      );
      return fail('refund failed — retry from the admin page', 502);
    }
    await updatePurchase(purchase.id, { status: 'rejected' }, REFUNDABLE);
    await sendMail({
      to: purchase.email,
      subject: 'your canivibecodeit sponsor slot — refunded',
      html: shell(
        `<p>We didn't run this placement, and your payment has been refunded in full.`
        + ` It lands back on your card in 5–10 days.</p>`
        + `<p>Reply to this email if you want to know why, or want another go at it.</p>`
      ),
    });
    return done(`${purchase.slot_id} rejected and refunded`);
  }

  if (action === 'expire') {
    const changed = await updatePurchase(
      purchase.id,
      { status: 'expired', ends_at: Date.now() },
      ['live']
    );
    if (!changed) return fail('not live', 409);
    return done(`${purchase.slot_id} taken down`);
  }

  if (action === 'clear_hold') {
    const changed = await updatePurchase(purchase.id, { status: 'expired_hold' }, ['hold']);
    if (!changed) return fail('not on hold', 409);
    return done(`${purchase.slot_id} hold cleared`);
  }

  if (action === 'edit') {
    const fields = {};
    if (body.name) fields.name = cleanText(body.name, LIMITS.name);
    if (body.tagline) fields.tagline = cleanText(body.tagline, LIMITS.tagline);
    if (body.url) fields.url = cleanUrl(body.url);
    if (body.logo_url) fields.logo_url = cleanUrl(body.logo_url);
    if (body.tint) fields.tint = cleanTint(body.tint);
    if (Object.values(fields).some((v) => v === null)) return fail('invalid value', 400);
    if (Object.keys(fields).length === 0) return fail('nothing to change', 400);
    await updatePurchase(purchase.id, fields);
    return done(`${purchase.slot_id} updated`);
  }

  return fail('unknown action', 400);
}
