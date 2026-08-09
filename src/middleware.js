// Security headers on every rendered response. No CSP yet: the site runs
// inline scripts in several islands and a blanket policy would need its own
// audit pass first.
export function onRequest(_context, next) {
  return Promise.resolve(next()).then((res) => {
    try {
      res.headers.set('Strict-Transport-Security', 'max-age=15552000');
      res.headers.set('X-Content-Type-Options', 'nosniff');
      res.headers.set('X-Frame-Options', 'SAMEORIGIN');
      res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    } catch {
      // a route returned a raw fetched Response (immutable headers); serve it
      // as-is rather than 500 the page
    }
    return res;
  });
}
