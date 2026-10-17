// POST /api/paddle-webhook
// Paddle calls this whenever a subscription starts, renews, changes or ends.
// It switches the account between Free and Pro in the database, and adds AI credits when a credit pack is paid.
import { json, supabaseAdmin, verifyPaddleSignature } from '../../lib/server.js';

const HANDLED = new Set([
  'subscription.created', 'subscription.activated', 'subscription.updated', 'subscription.trialing',
  'subscription.past_due', 'subscription.paused', 'subscription.resumed', 'subscription.canceled',
]);

// The credit packs, set as the Cloudflare variable CREDIT_PACKS: "pri_aaa:50,pri_bbb:150,pri_ccc:400" (Paddle price id : credits).
// Only this list decides how many credits a payment gives, never the browser.
export function creditPacks(env) {
  const m = new Map();
  for (const part of String(env.CREDIT_PACKS || '').split(',')) {
    const [id, n] = part.split(':').map(s => s && s.trim());
    if (id && /^pri_\w+$/.test(id) && Number(n) > 0) m.set(id, Math.floor(Number(n)));
  }
  return m;
}

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  const ok = await verifyPaddleSignature(request.headers.get('paddle-signature'), raw, env.PADDLE_WEBHOOK_SECRET);
  if (!ok) return json({ error: 'bad signature' }, 401);

  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }
  const s = event.data || {};
  const userId = s.custom_data && typeof s.custom_data.user_id === 'string' ? s.custom_data.user_id : null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (event.event_type === 'transaction.completed') {
    const packs = creditPacks(env);
    let credits = 0;
    for (const it of Array.isArray(s.items) ? s.items : []) {
      const n = packs.get(it && it.price && it.price.id);
      if (n) credits += n * Math.max(1, Math.floor(Number(it.quantity) || 1));
    }
    if (!credits) return json({ ignored: 'no credit pack' });   // e.g. a Pro subscription payment
    const added = await supabaseAdmin(env, '/rest/v1/rpc/ai_add_credits', {
      method: 'POST', body: JSON.stringify({ p_user: userId && uuid.test(userId) ? userId : null, p_credits: credits, p_txn: String(s.id || '') || null }),
    });
    if (added === 'no_user') return json({ error: 'no matching account', customer: s.customer_id }, 500);
    return json({ result: added, credits });
  }
  if (!HANDLED.has(event.event_type)) return json({ ignored: event.event_type });

  const result = await supabaseAdmin(env, '/rest/v1/rpc/apply_subscription', {
    method: 'POST',
    body: JSON.stringify({
      p_user: userId && uuid.test(userId) ? userId : null,
      p_customer: s.customer_id || null,
      p_subscription: s.id || null,
      p_status: s.status || 'canceled',
      p_renews_at: (s.current_billing_period && s.current_billing_period.ends_at) || s.next_billed_at || null,
      p_event_at: event.occurred_at || new Date().toISOString(),
    }),
  });

  // "no_user" means the payment could not be matched to an account: answer 500 so Paddle retries
  // (useful if the webhook beats the sign-up by a few seconds), and it shows up in Paddle's logs.
  if (result === 'no_user') return json({ error: 'no matching account', customer: s.customer_id }, 500);
  return json({ result });
}
