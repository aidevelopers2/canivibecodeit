/* Stripe over plain fetch — the REST API is form-encoded and the webhook
   signature is an HMAC, so the SDK would earn its dependency on neither. */

import crypto from 'node:crypto';

const API = 'https://api.stripe.com';
const SIGNATURE_TOLERANCE_S = 300;

// Stripe's bracket syntax: nested objects and arrays flatten to a[b][0][c]=v.
function encode(value, prefix, out) {
  if (value === undefined || value === null) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => encode(v, `${prefix}[${i}]`, out));
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) encode(v, `${prefix}[${k}]`, out);
  } else {
    out.append(prefix, String(value));
  }
  return out;
}

function form(params) {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) encode(v, k, out);
  return out;
}

/* `idempotencyKey` makes a retry after a lost response safe: Stripe replays the
   original result instead of performing the action twice. */
export async function stripeFetch(pathname, params, method = 'POST', idempotencyKey) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('missing STRIPE_SECRET_KEY');
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: method === 'POST' ? form(params || {}).toString() : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`stripe ${pathname}: HTTP ${res.status} ${json?.error?.message || ''}`.trim());
  }
  return json;
}

export async function createCheckoutSession({
  purchaseId, slotId, priceCents, successUrl, cancelUrl, expiresAt,
}) {
  return stripeFetch('/v1/checkout/sessions', {
    mode: 'payment',
    'payment_method_types[]': 'card',
    success_url: successUrl,
    cancel_url: cancelUrl,
    expires_at: Math.floor(expiresAt / 1000),
    client_reference_id: purchaseId,
    metadata: { purchase_id: purchaseId, slot_id: slotId },
    payment_intent_data: { metadata: { purchase_id: purchaseId, slot_id: slotId } },
    // Sponsors buy as businesses: let them enter a VAT/tax ID and company name,
    // and have Stripe email a proper invoice PDF after payment (0.4% capped at
    // $2 per invoice). The tax ID needs a Customer to live on.
    tax_id_collection: { enabled: true },
    billing_address_collection: 'required',
    customer_creation: 'always',
    invoice_creation: { enabled: true },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: priceCents,
          product_data: {
            name: 'canivibecodeit.com — sponsor slot (30 days)',
            description:
              'Your product on every page of canivibecodeit.com for 30 days: icon, name,'
              + ' tagline and link, plus the sponsor board.',
          },
        },
      },
    ],
  });
}

export async function getSession(id) {
  return stripeFetch(`/v1/checkout/sessions/${encodeURIComponent(id)}`, null, 'GET');
}

export async function expireSession(id) {
  return stripeFetch(`/v1/checkout/sessions/${encodeURIComponent(id)}/expire`, {});
}

export async function createRefund(paymentIntent, idempotencyKey) {
  return stripeFetch('/v1/refunds', { payment_intent: paymentIntent }, 'POST', idempotencyKey);
}

export async function listRefunds(paymentIntent, limit = 10) {
  const q = `payment_intent=${encodeURIComponent(paymentIntent)}&limit=${limit}`;
  return stripeFetch(`/v1/refunds?${q}`, null, 'GET');
}

/* A refund that already exists — settled or still moving — means the money is on
   its way back and a second one must not be created. Failed and cancelled
   refunds don't count: those are exactly the ones worth retrying. */
export async function alreadyRefunded(paymentIntent) {
  const list = await listRefunds(paymentIntent);
  return (list?.data ?? []).some((r) => r.status === 'succeeded' || r.status === 'pending');
}

/* Verifies the Stripe-Signature header against the raw request body. The body
   must be the exact bytes Stripe sent — parsing it first breaks the HMAC. */
export function verifyStripeSignature(rawBody, header, secret) {
  if (!rawBody || !header || !secret) return false;
  let timestamp = null;
  const candidates = [];
  for (const part of String(header).split(',')) {
    const [k, v] = part.split('=', 2);
    if (k?.trim() === 't') timestamp = v?.trim();
    else if (k?.trim() === 'v1' && v) candidates.push(v.trim());
  }
  if (!timestamp || candidates.length === 0) return false;
  // A replayed old delivery is rejected outright rather than re-processed.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_S) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return candidates.some(
    (sig) =>
      sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  );
}
