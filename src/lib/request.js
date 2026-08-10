// Client IP: only Cloudflare can reach this box in production, so CF-Connecting-IP
// is trustworthy there. Fall back to the socket address for local dev.
export function clientIp(request, astroClientAddress) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    astroClientAddress ||
    'unknown'
  );
}

// Serialise a value for embedding inside a <script> tag via set:html. Only "<"
// can begin a "</script>" that would break out of the tag, so escaping it (and
// the two JS line terminators) makes the JSON inert as markup while staying
// valid JSON and valid JS. Use this for EVERY set:html JSON blob.
export function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

// Accepts JSON or classic form posts, so the forms work without JS too.
export async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) return await request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}
