// GDPR delete. Better Auth removes user/sessions/accounts; the beforeDelete
// hook in lib/auth.js cascades our stack rows, the waitlist row, and the
// Resend contact (alerting Rob if the contact removal fails).
import { getAuth } from '../../../lib/auth.js';
import { crossOrigin, json } from '../../../lib/request.js';

export async function POST({ request, locals }) {
  if (!locals.user) return json({ error: 'sign in first' }, 401);
  if (crossOrigin(request)) return json({ error: 'bad origin' }, 403);
  try {
    const auth = await getAuth();
    await auth.api.deleteUser({ headers: request.headers, body: {} });
    return json({ ok: true });
  } catch (err) {
    // Internal messages stay internal; the client gets one honest line.
    console.error(`account delete failed: ${err?.body?.message || err?.message || err}`);
    return json({ error: 'delete failed, sign out, sign back in, and try again' }, 400);
  }
}
