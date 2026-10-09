// Tests for the server functions. Run: node --test tests/
// Supabase and Paddle are replaced by a fake fetch, so nothing leaves the machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { onRequestPost as webhook } from '../functions/api/paddle-webhook.js';
import { onRequestPost as portal } from '../functions/api/billing-portal.js';
import { verifyPaddleSignature } from '../lib/server.js';

const env = {
  SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_secret', PADDLE_API_KEY: 'pdl_apikey', PADDLE_ENV: 'sandbox',
};
const USER = '11111111-1111-1111-1111-111111111111';

let calls = [];
function fakeFetch(routes) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [prefix, fn] of routes) if (String(url).startsWith(prefix)) return fn(url, init);
    throw new Error('unexpected fetch ' + url);
  };
}
const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function signed(body, { secret = env.PADDLE_WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(body);
  const h1 = createHmac('sha256', secret).update(`${ts}:${raw}`).digest('hex');
  return new Request('https://trace.example/api/paddle-webhook', {
    method: 'POST', body: raw, headers: { 'paddle-signature': `ts=${ts};h1=${h1}` },
  });
}
const subEvent = (type, status, extra = {}) => ({
  event_id: 'evt_1', event_type: type, occurred_at: '2026-10-09T12:00:00Z',
  data: { id: 'sub_1', status, customer_id: 'ctm_1', custom_data: { user_id: USER },
          current_billing_period: { ends_at: '2026-11-09T12:00:00Z' }, ...extra },
});

test('a correctly signed subscription event upgrades the account', async () => {
  fakeFetch([['https://db.example/rest/v1/rpc/apply_subscription', () => ok('updated')]]);
  const res = await webhook({ request: signed(subEvent('subscription.created', 'active')), env });
  assert.equal(res.status, 200);
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(sent, {
    p_user: USER, p_customer: 'ctm_1', p_subscription: 'sub_1', p_status: 'active',
    p_renews_at: '2026-11-09T12:00:00Z', p_event_at: '2026-10-09T12:00:00Z',
  });
  assert.equal(calls[0].init.headers.authorization, 'Bearer service-key');
});

test('a forged or tampered webhook is refused and the database is not touched', async () => {
  fakeFetch([]);
  let res = await webhook({ request: signed(subEvent('subscription.created', 'active'), { secret: 'wrong' }), env });
  assert.equal(res.status, 401);
  const good = signed(subEvent('subscription.created', 'active'));
  const tampered = new Request(good.url, { method: 'POST', headers: good.headers,
    body: JSON.stringify(subEvent('subscription.created', 'active', { customer_id: 'ctm_attacker' })) });
  res = await webhook({ request: tampered, env });
  assert.equal(res.status, 401);
  res = await webhook({ request: new Request(good.url, { method: 'POST', body: '{}' }), env });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('an old replayed webhook is refused', async () => {
  fakeFetch([]);
  const res = await webhook({ request: signed(subEvent('subscription.created', 'active'), { ts: Math.floor(Date.now() / 1000) - 3600 }), env });
  assert.equal(res.status, 401);
});

test('signature check accepts any of several h1 values (secret rotation)', async () => {
  const raw = '{"a":1}', ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac('sha256', 's2').update(`${ts}:${raw}`).digest('hex');
  assert.equal(await verifyPaddleSignature(`ts=${ts};h1=deadbeef;h1=${h1}`, raw, 's2'), true);
  assert.equal(await verifyPaddleSignature(`ts=${ts};h1=deadbeef`, raw, 's2'), false);
  assert.equal(await verifyPaddleSignature('garbage', raw, 's2'), false);
});

test('cancellation is passed through, and a non-uuid user id is ignored', async () => {
  fakeFetch([['https://db.example/rest/v1/rpc/apply_subscription', () => ok('updated')]]);
  await webhook({ request: signed(subEvent('subscription.canceled', 'canceled', { custom_data: { user_id: "x' or 1=1" } })), env });
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.p_status, 'canceled');
  assert.equal(sent.p_user, null);
  assert.equal(sent.p_customer, 'ctm_1');
});

test('events that are not about subscriptions are acknowledged and ignored', async () => {
  fakeFetch([]);
  const res = await webhook({ request: signed({ event_type: 'transaction.completed', data: {} }), env });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

test('a payment that matches no account asks Paddle to retry', async () => {
  fakeFetch([['https://db.example/rest/v1/rpc/apply_subscription', () => ok('no_user')]]);
  const res = await webhook({ request: signed(subEvent('subscription.created', 'active')), env });
  assert.equal(res.status, 500);
});

test('billing portal: signed-in Pro user gets a Paddle portal link', async () => {
  fakeFetch([
    ['https://db.example/auth/v1/user', (u, i) => i.headers.authorization === 'Bearer user-token' ? ok({ id: USER }) : new Response('no', { status: 401 })],
    ['https://db.example/rest/v1/profiles', () => ok([{ paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1' }])],
    ['https://sandbox-api.paddle.com/customers/ctm_1/portal-sessions', (u, i) => {
      assert.equal(i.headers.authorization, 'Bearer pdl_apikey');
      assert.deepEqual(JSON.parse(i.body), { subscription_ids: ['sub_1'] });
      return new Response(JSON.stringify({ data: { urls: { general: { overview: 'https://portal.example/ok' } } } }), { status: 201 });
    }],
  ]);
  const res = await portal({ request: new Request('https://t/api/billing-portal', { method: 'POST', headers: { authorization: 'Bearer user-token' } }), env });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).url, 'https://portal.example/ok');
  assert.ok(calls[1].url.includes(`id=eq.${USER}`), 'looks up only the caller\'s own profile');
});

test('billing portal: refuses callers who are not signed in', async () => {
  fakeFetch([['https://db.example/auth/v1/user', () => new Response('no', { status: 401 })]]);
  let res = await portal({ request: new Request('https://t/api/billing-portal', { method: 'POST' }), env });
  assert.equal(res.status, 401);
  res = await portal({ request: new Request('https://t/api/billing-portal', { method: 'POST', headers: { authorization: 'Bearer forged' } }), env });
  assert.equal(res.status, 401);
});

test('billing portal: free user without a subscription gets a clear message', async () => {
  fakeFetch([
    ['https://db.example/auth/v1/user', () => ok({ id: USER })],
    ['https://db.example/rest/v1/profiles', () => ok([{ paddle_customer_id: null }])],
  ]);
  const res = await portal({ request: new Request('https://t/api/billing-portal', { method: 'POST', headers: { authorization: 'Bearer t' } }), env });
  assert.equal(res.status, 404);
});

test('production uses the live Paddle API', async () => {
  fakeFetch([
    ['https://db.example/auth/v1/user', () => ok({ id: USER })],
    ['https://db.example/rest/v1/profiles', () => ok([{ paddle_customer_id: 'ctm_1' }])],
    ['https://api.paddle.com/customers/ctm_1/portal-sessions', () => new Response(JSON.stringify({ data: { urls: { general: { overview: 'https://live' } } } }), { status: 201 })],
  ]);
  const res = await portal({ request: new Request('https://t/api/billing-portal', { method: 'POST', headers: { authorization: 'Bearer t' } }), env: { ...env, PADDLE_ENV: 'production' } });
  assert.equal((await res.json()).url, 'https://live');
});
