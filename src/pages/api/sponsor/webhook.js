import {
  activePurchases, purchaseById, purchaseBySession, updatePurchase,
} from '../../../lib/db.js';
import { alertRob, button, esc, sendMail, shell } from '../../../lib/mail.js';
import { json } from '../../../lib/request.js';
import { blocksSlot, clearCache, siteUrl } from '../../../lib/sponsors.js';
import { createRefund, verifyStripeSignature } from '../../../lib/stripe.js';

const detailsLink = (purchase) =>
  `${siteUrl('/sponsor/details')}?t=${encodeURIComponent(purchase.details_token)}`;

/* hold → paid. Called by the webhook and, when the webhook hasn't landed yet,
   by the details page off its own session lookup. The conditional update is
   what makes that safe: whichever arrives second changes nothing.

   `notify` sends the "finish your card" email. The webhook sets it; the details
   page doesn't, because that visitor is already looking at the form. */
export async function promoteFromSession(session, { notify = false } = {}) {
  if (!session) return null;
  const id = session.metadata?.purchase_id || session.client_reference_id;
  // The session id is written just after the session is created, so a very fast
  // webhook can beat it into the row — the metadata is authoritative.
  const purchase = id ? await purchaseById(id) : await purchaseBySession(session.id);
  if (!purchase) return null;
  if (session.payment_status !== 'paid') {
    console.warn(
      `sponsor session ${session.id} arrived with payment_status=${session.payment_status}, not promoting`
    );
    return purchase;
  }

  const now = Date.now();
  const changed = await updatePurchase(
    purchase.id,
    {
      status: 'paid',
      paid_at: now,
      stripe_session_id: session.id,
      stripe_payment_intent: session.payment_intent ?? null,
      email: session.customer_details?.email ?? null,
    },
    ['hold', 'expired_hold']
  );
  if (!changed) return purchaseById(purchase.id);
  clearCache();

  const email = session.customer_details?.email ?? purchase.email;

  /* Several people can be in checkout for one slot at once, so payments race.
     The winner is whoever paid first, under a strict order on (paid_at, id).
     That order is what keeps this safe: if A beats B then B cannot also beat A,
     so two payers can never both refund themselves. The only way they could
     both survive is if neither ever saw the other, so the check runs twice —
     by the second pass both rows are certainly committed and visible.

     Whoever queued first is irrelevant: a lapsed hold can be paid late, and a
     success tab can be reopened long after the slot moved on. An unpaid hold is
     never a rival — it holds nothing until it pays, and then it lands here. */
  const beatenBy = async () => {
    const at = Date.now();
    return (await activePurchases()).filter((o) => {
      if (o.slot_id !== purchase.slot_id || o.id === purchase.id) return false;
      if (!blocksSlot(o, at)) return false;
      const theirs = o.paid_at ?? 0;
      return theirs < now || (theirs === now && o.id < purchase.id);
    });
  };
  let rivals = await beatenBy();
  if (rivals.length === 0) rivals = await beatenBy();

  if (rivals.length === 0) {
    if (notify) {
      // Fire-and-forget: the details link only otherwise exists in the tab they
      // were redirected to, and tabs get closed.
      await sendMail({
        to: email,
        subject: `you're in — slot ${purchase.slot_id} just needs your card details`,
        html: shell(
          `<p>Payment received for slot ${esc(purchase.slot_id)}. One step left: tell us what`
          + ` the card should say.</p>`
          + `<p>${button(detailsLink(purchase), 'finish your card')}</p>`
          + `<p style="color:#6e6e67; font-size:12px;">Name, one line, and your link. We review`
          + ` every placement by hand after that — usually within a few hours. Keep this email;`
          + ` it's the only copy of your link.</p>`
        ),
      });
    }
    return purchaseById(purchase.id);
  }

  const rivalList = rivals.map((r) => `${r.id} (${r.status})`).join(', ');
  let refundError = null;
  try {
    // Keyed on the purchase: a retry after a lost response can't refund twice.
    await createRefund(session.payment_intent, `refund-${purchase.id}`);
    await updatePurchase(purchase.id, { status: 'refunded_conflict' }, ['paid']);
    await sendMail({
      to: email,
      subject: 'your sponsor slot was taken first — refunded',
      html: shell(
        `<p>Slot ${esc(purchase.slot_id)} was bought by someone else before this payment`
        + ` landed, so your payment has been refunded in full. It's back on your card in`
        + ` 5–10 days.</p>`
        + `<p>Sorry about that. Other slots may still be open:`
        + ` <a href="${esc(siteUrl('/sponsor'))}">${esc(siteUrl('/sponsor'))}</a></p>`
      ),
    });
  } catch (err) {
    refundError = err;
    await updatePurchase(purchase.id, { status: 'reject_failed' }, ['paid']);
  }

  // Rob hears about every double-booking, not just the ones that fail to refund:
  // two people paid for one slot and he needs to know it happened.
  await alertRob(
    `sponsor slot ${purchase.slot_id} double-booked${refundError ? ' — REFUND FAILED' : ' (auto-refunded)'}`,
    shell(
      `<p>Purchase <code>${esc(purchase.id)}</code> (${esc(email || 'no email')}) paid for slot`
      + ` ${esc(purchase.slot_id)}, which was already held by: ${esc(rivalList)}.</p>`
      + (refundError
        ? `<p><b>The automatic refund failed:</b> ${esc(refundError?.message || refundError)}</p>`
          + `<p>The slot stays blocked until this is settled. Retry from`
          + ` <a href="${esc(siteUrl('/admin/sponsors'))}">the admin page</a>.</p>`
        : `<p>It was refunded in full automatically and the buyer has been told. Nothing to do.</p>`)
    )
  );
  clearCache();
  return purchaseById(purchase.id);
}

export async function POST({ request }) {
  // Raw bytes, never readBody: parsing first would change what we hash.
  const raw = await request.text();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!verifyStripeSignature(raw, request.headers.get('stripe-signature'), secret)) {
    // Parsed only to name the event in the log — the payload stays untrusted.
    let id = 'none';
    try {
      id = JSON.parse(raw)?.id || 'none';
    } catch {}
    console.error(
      `sponsor webhook rejected: bad signature (event ${id}, secret ${secret ? 'set' : 'MISSING'})`
    );
    return json({ error: 'bad signature' }, 400);
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const object = event?.data?.object;
  try {
    if (event.type === 'checkout.session.completed') {
      await promoteFromSession(object, { notify: true });
    } else if (event.type === 'checkout.session.expired') {
      const purchase = object?.metadata?.purchase_id
        ? await purchaseById(object.metadata.purchase_id)
        : await purchaseBySession(object?.id);
      if (purchase) {
        await updatePurchase(purchase.id, { status: 'expired_hold' }, ['hold']);
        clearCache();
      }
    }
  } catch (err) {
    // A verified event that we mishandled is our bug, not Stripe's: log it and
    // acknowledge, or Stripe retries the same failure for days.
    console.error(`sponsor webhook ${event.type} failed: ${err?.message || err}`);
  }

  return json({ ok: true });
}
