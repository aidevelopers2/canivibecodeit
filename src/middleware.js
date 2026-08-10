// Security headers on every rendered response, plus the session lookup that
// puts the signed-in user (or null) on Astro.locals. No CSP yet: the site runs
// inline scripts in several islands and a blanket policy would need its own
// audit pass first.
import { getAuth } from './lib/auth.js';

// Session-varying surfaces: never cacheable, anywhere. Everything else on the
// site stays cache-friendly for the ~99% anonymous traffic.
const PRIVATE_PATH = /^\/(api\/auth\/|api\/stack|api\/account|account\/?$|signin\/?$)/;

export async function onRequest(context, next) {
  context.locals.user = null;
  context.locals.session = null;

  const path = context.url.pathname;
  // Skip the lookup where it can't matter: the PostHog proxy and Better
  // Auth's own routes (its handler reads the cookie itself). Anonymous
  // visitors carry no session cookie and skip the DB entirely. Any failure
  // in here (auth misconfig, DB blip) renders the page logged-out; the site
  // itself must never go down for auth's sake.
  if (!path.startsWith('/ph/') && !path.startsWith('/api/auth/')) {
    try {
      const cookie = context.request.headers.get('cookie') || '';
      if (cookie.includes('session_token')) {
        const auth = await getAuth();
        const session = await auth.api.getSession({ headers: context.request.headers });
        context.locals.user = session?.user ?? null;
        context.locals.session = session?.session ?? null;
      }
    } catch {
      // logged-out render; the visitor can sign in again
    }
  }

  return Promise.resolve(next()).then((res) => {
    try {
      res.headers.set('Strict-Transport-Security', 'max-age=15552000');
      res.headers.set('X-Content-Type-Options', 'nosniff');
      res.headers.set('X-Frame-Options', 'SAMEORIGIN');
      res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      if (PRIVATE_PATH.test(path)) {
        res.headers.set('Cache-Control', 'private, no-store');
      } else if ((res.headers.get('Content-Type') || '').includes('text/html')) {
        // Every HTML page now varies by session (header avatar, body
        // data-user), so no shared cache may ever store one. Cloudflare
        // treats HTML as DYNAMIC today; this pins the contract against
        // heuristic caches and future cache rules.
        res.headers.set('Cache-Control', 'private, no-cache');
        res.headers.set('Vary', 'Cookie');
      }
    } catch {
      // a route returned a raw fetched Response (immutable headers); serve it
      // as-is rather than 500 the page
    }
    return res;
  });
}
