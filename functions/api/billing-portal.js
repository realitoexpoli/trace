// POST /api/billing-portal  (with the user's sign-in token)
// Returns a link to Paddle's customer portal, where Pro users update their card,
// download invoices or cancel.
import { json, paddleBase, supabaseAdmin, userFromRequest } from '../../lib/server.js';

export async function onRequestPost({ request, env }) {
  const user = await userFromRequest(env, request);
  if (!user) return json({ error: 'Please sign in again.' }, 401);

  const rows = await supabaseAdmin(env,
    `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=paddle_customer_id,paddle_subscription_id`);
  const p = rows && rows[0];
  if (!p || !p.paddle_customer_id) return json({ error: 'There is no subscription on this account yet.' }, 404);

  const res = await fetch(`${paddleBase(env)}/customers/${encodeURIComponent(p.paddle_customer_id)}/portal-sessions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.PADDLE_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(p.paddle_subscription_id ? { subscription_ids: [p.paddle_subscription_id] } : {}),
  });
  if (!res.ok) return json({ error: 'The billing page is not available right now. Please try again.' }, 502);
  const body = await res.json();
  const url = body && body.data && body.data.urls && body.data.urls.general && body.data.urls.general.overview;
  return url ? json({ url }) : json({ error: 'The billing page is not available right now.' }, 502);
}
