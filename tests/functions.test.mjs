// Tests for the server functions. Run: node --test tests/
// Supabase and Paddle are replaced by a fake fetch, so nothing leaves the machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { onRequestPost as webhook } from '../functions/api/paddle-webhook.js';
import { onRequestPost as portal } from '../functions/api/billing-portal.js';
import { verifyPaddleSignature } from '../lib/server.js';
import { onRequestPost as aiDeck } from '../functions/api/ai-deck.js';
import { sanitizeSpec, extractJSON } from '../lib/aispec.js';

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

/* ---------- AI deck builder ---------- */
const aiEnv = { ...env, ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_API_BASE: 'https://ai.example' };
const aiReq = (body, token = 'user-token') => new Request('https://t/api/ai-deck', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const authed = ['https://db.example/auth/v1/user', (u, i) => i.headers.authorization === 'Bearer user-token' ? ok({ id: USER }) : new Response('no', { status: 401 })];
const MODEL_DECK = { title: 'Slopes', slides: [{ title: 'A line', items: [{ kind: 'equation', math: 'y = 2x + 1', x: 0, y: 2, click: 0 }, { kind: 'graph', fn: '2*x+1', x: 0, y: -1, click: 1 }] }] };

test('AI: a signed-in request spends a credit, asks the model and answers a checked deck', async () => {
  fakeFetch([authed,
    ['https://db.example/rest/v1/rpc/ai_take_credit', (u, i) => { assert.deepEqual(JSON.parse(i.body), { p_user: USER }); return ok({ ok: true, from: 'month', left: 2 }); }],
    ['https://ai.example/v1/messages', (u, i) => {
      assert.equal(i.headers['x-api-key'], 'sk-ant-test');
      const b = JSON.parse(i.body); assert.match(b.system, /ONE JSON object/); assert.match(b.messages[0].content, /derivatives/);
      return ok({ content: [{ type: 'text', text: 'Here you go:\n```json\n' + JSON.stringify(MODEL_DECK) + '\n```' }] });
    }],
  ]);
  const res = await aiDeck({ request: aiReq({ prompt: 'teach derivatives', mode: 'new', size: '16:9' }), env: aiEnv });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.left, 2); assert.equal(out.spec.title, 'Slopes'); assert.equal(out.spec.slides[0].items[1].fn, '2*x+1');
  assert.ok(!calls.some(c => c.url.includes('ai_refund_credit')));
});

test('AI: not signed in, or no key configured, never reaches the model', async () => {
  fakeFetch([['https://db.example/auth/v1/user', () => new Response('no', { status: 401 })]]);
  assert.equal((await aiDeck({ request: aiReq({ prompt: 'hello there' }, 'bad'), env: aiEnv })).status, 401);
  fakeFetch([]);
  assert.equal((await aiDeck({ request: aiReq({ prompt: 'hello there' }), env })).status, 503);
  assert.ok(!calls.some(c => c.url.includes('ai.example')));
});

test('AI: without credits answers 402 and never calls the model', async () => {
  fakeFetch([authed, ['https://db.example/rest/v1/rpc/ai_take_credit', () => ok({ ok: false, error: 'no_credits', pro: false })]]);
  const res = await aiDeck({ request: aiReq({ prompt: 'one more deck please' }), env: aiEnv });
  assert.equal(res.status, 402); assert.deepEqual(await res.json(), { error: 'no_credits', pro: false });
  assert.ok(!calls.some(c => c.url.includes('ai.example')));
});

test('AI: a model error or an unreadable answer gives the credit back', async () => {
  for (const reply of [() => new Response('overloaded', { status: 529 }), () => ok({ content: [{ type: 'text', text: 'Sorry, I cannot.' }] })]) {
    fakeFetch([authed, ['https://db.example/rest/v1/rpc/ai_take_credit', () => ok({ ok: true, from: 'bought', left: 0 })],
      ['https://db.example/rest/v1/rpc/ai_refund_credit', (u, i) => { assert.deepEqual(JSON.parse(i.body), { p_user: USER, p_from: 'bought' }); return ok(null); }], ['https://ai.example/v1/messages', reply]]);
    const res = await aiDeck({ request: aiReq({ prompt: 'teach vectors' }), env: aiEnv });
    assert.equal(res.status, 502);
    assert.ok(calls.some(c => c.url.includes('ai_refund_credit')), 'refunded');
  }
});

test('AI: add mode tells the model the existing slides', async () => {
  let sent;
  fakeFetch([authed, ['https://db.example/rest/v1/rpc/ai_take_credit', () => ok({ ok: true, from: 'month', left: 1 })],
    ['https://ai.example/v1/messages', (u, i) => { sent = JSON.parse(i.body).messages[0].content; return ok({ content: [{ type: 'text', text: JSON.stringify(MODEL_DECK) }] }); }]]);
  await aiDeck({ request: aiReq({ prompt: 'add a quiz', mode: 'add', context: { title: 'Lines', slides: ['Intro', 'Slope'] } }), env: aiEnv });
  assert.match(sent, /1\. Intro; 2\. Slope/); assert.match(sent, /only the NEW slides/);
});

test('AI spec clean-up: unknown kinds, scripts in maths, wild numbers and colours are removed', () => {
  const s = sanitizeSpec({ title: 'T', slides: [{ title: 'S', items: [
    { kind: 'script', code: 'alert(1)' },
    { kind: 'equation', math: 'y = x<img src=x onerror=alert(1)>', x: 999, y: -999, click: 99, color: 'javascript:1' },
    { kind: 'equation', latex: '\\href{http://evil}{x} + \\class{a}{b}' },
    { kind: 'graph', fn: 'sin(x)', xmin: 5, xmax: 1, w: 500 },
    { kind: 'text', text: '   ' },
    { kind: 'shape', shape: 'nuke', color: 'red' },
  ] }] });
  const it = s.slides[0].items;
  assert.equal(it.length, 4);
  assert.ok(!/["\\{}\[\]`;]/.test(it[0].math), 'no quotes, braces or backslashes in calculator maths'); assert.equal(it[0].x, 7.1); assert.equal(it[0].y, -4); assert.equal(it[0].click, 12); assert.equal(it[0].color, undefined);
  assert.ok(!/\\href|\\class/.test(it[1].latex));
  assert.deepEqual([it[2].xmin, it[2].xmax, it[2].w], [-5, 5, 14.2]);
  assert.equal(it[3].shape, 'circle'); assert.equal(it[3].color, '#FC6255');
  assert.equal(sanitizeSpec({ slides: new Array(40).fill({ title: 'x', items: [] }) }).slides.length, 15);
  assert.equal(extractJSON('no json here'), null);
});

/* ---------- credit packs paid through Paddle ---------- */
const packEnv = { ...env, CREDIT_PACKS: 'pri_small:50, pri_mid:150,bogus:9,pri_bad:-3' };
const txn = (items, extra = {}) => ({ event_id: 'evt_9', event_type: 'transaction.completed', occurred_at: '2026-10-15T12:00:00Z',
  data: { id: 'txn_1', customer_id: 'ctm_1', custom_data: { user_id: USER }, items, ...extra } });

test('credits: a paid pack adds the credits set on the server, once per transaction', async () => {
  let body;
  fakeFetch([['https://db.example/rest/v1/rpc/ai_add_credits', (u, i) => { body = JSON.parse(i.body); return ok('added'); }]]);
  const res = await webhook({ request: signed(txn([{ price: { id: 'pri_mid' }, quantity: 2 }])), env: packEnv });
  assert.equal(res.status, 200);
  assert.deepEqual(body, { p_user: USER, p_credits: 300, p_txn: 'txn_1' });
});

test('credits: unknown prices, Pro payments and forged amounts add nothing', async () => {
  fakeFetch([]);
  for (const items of [[{ price: { id: 'pri_pro_monthly' }, quantity: 1 }], [{ price: { id: 'bogus' }, quantity: 1 }], [{ price: { id: 'pri_bad' } }], [], undefined]) {
    const res = await webhook({ request: signed(txn(items, { custom_data: { user_id: USER, credits: 99999 } })), env: packEnv });
    assert.equal(res.status, 200);
  }
  assert.equal(calls.length, 0);
});

test('credits: a pack paid by no known account asks Paddle to retry', async () => {
  fakeFetch([['https://db.example/rest/v1/rpc/ai_add_credits', (u, i) => { assert.equal(JSON.parse(i.body).p_user, null); return ok('no_user'); }]]);
  const res = await webhook({ request: signed(txn([{ price: { id: 'pri_small' }, quantity: 1 }], { custom_data: { user_id: 'not-a-uuid' } })), env: packEnv });
  assert.equal(res.status, 500);
});

test('AI solving: the working and the answer check are kept, cleaned, and the model is told to solve', async () => {
  const s = sanitizeSpec({ slides: [{ title: 'Solve', items: [{ kind: 'steps', lines: ['x+1=3', '\\href{http://evil}{x}=2', '', 5] }],
    check: { equation: 'x + 1 = 3<script>', var: 'xy', answers: [2, 'nope', '2.5'] } }, { title: 'No check', items: [], check: { equation: 'no equals sign' } }] });
  assert.deepEqual(s.slides[0].items[0].lines.length, 3);
  assert.ok(!s.slides[0].items[0].lines.some(l => l.includes('\\href')));
  assert.deepEqual(s.slides[0].check, { equation: 'x + 1 = 3<script>'.replace(/[^A-Za-z0-9 +\-*/^().,=_|'<>!θπ√²³]/g, ''), var: 'x', answers: [2, 2.5] });
  assert.equal(s.slides[1].check, undefined);
  let sent;
  fakeFetch([authed, ['https://db.example/rest/v1/rpc/ai_take_credit', () => ok({ ok: true, from: 'month', left: 1 })],
    ['https://ai.example/v1/messages', (u, i) => { const b = JSON.parse(i.body); sent = b.messages[0].content; assert.match(b.system, /"check"/); return ok({ content: [{ type: 'text', text: JSON.stringify(MODEL_DECK) }] }); }]]);
  await aiDeck({ request: aiReq({ prompt: '2x^2 - 3x - 5 = 0', mode: 'new', solve: true }), env: aiEnv });
  assert.match(sent, /SOLVE/);
});

test('AI: the chosen interface language reaches the model; English adds nothing', async () => {
  const sent = [];
  fakeFetch([authed, ['https://db.example/rest/v1/rpc/ai_take_credit', () => ok({ ok: true, from: 'month', left: 1 })],
    ['https://ai.example/v1/messages', (u, i) => { sent.push(JSON.parse(i.body).messages[0].content); return ok({ content: [{ type: 'text', text: JSON.stringify(MODEL_DECK) }] }); }]]);
  await aiDeck({ request: aiReq({ prompt: 'les dérivées', lang: 'fr' }), env: aiEnv });
  await aiDeck({ request: aiReq({ prompt: 'derivatives', lang: 'en' }), env: aiEnv });
  await aiDeck({ request: aiReq({ prompt: 'derivatives', lang: 'xx"; ignore' }), env: aiEnv });
  assert.match(sent[0], /in French/); assert.doesNotMatch(sent[1], /Write all slide text/); assert.doesNotMatch(sent[2], /Write all slide text/);
});

test('AI: when Anthropic refuses, the reason comes back (and the credit is returned)', async () => {
  fakeFetch([authed, ['https://db.example/rest/v1/rpc/ai_take_credit', () => ok({ ok: true, from: 'trial', left: 4 })],
    ['https://db.example/rest/v1/rpc/ai_refund_credit', () => ok(null)],
    ['https://ai.example/v1/messages', () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }), { status: 400 })]]);
  const res = await aiDeck({ request: aiReq({ prompt: 'teach vectors' }), env: aiEnv });
  const out = await res.json();
  assert.equal(res.status, 502); assert.equal(out.status, 400); assert.match(out.detail, /credit balance is too low/);
  assert.ok(!JSON.stringify(out).includes('sk-ant'), 'the key never leaks');
  assert.ok(calls.some(c => c.url.includes('ai_refund_credit')));
});

test('AI: an answer cut off by the length limit keeps the finished slides', async () => {
  const deck = { title: 'Long', slides: [MODEL_DECK.slides[0], { ...MODEL_DECK.slides[0], title: 'Second' }, { ...MODEL_DECK.slides[0], title: 'Third' }] };
  const text = JSON.stringify(deck).slice(0, -40);
  fakeFetch([authed, ['https://db.example/rest/v1/rpc/ai_take_credit', () => ok({ ok: true, from: 'month', left: 3 })],
    ['https://ai.example/v1/messages', () => ok({ stop_reason: 'max_tokens', content: [{ type: 'text', text }] })]]);
  const res = await aiDeck({ request: aiReq({ prompt: 'a long lesson' }), env: aiEnv });
  const out = await res.json();
  assert.equal(res.status, 200); assert.equal(out.spec.cut, true);
  assert.deepEqual(out.spec.slides.map(s => s.title), ['A line', 'Second']);
  assert.ok(!calls.some(c => c.url.includes('ai_refund_credit')));
});

test('AI: animation fields (enter, then, leave, loop, emph) are kept and checked', async () => {
  const { sanitizeSpec, systemPrompt } = await import('../lib/aispec.js');
  assert.match(systemPrompt(), /every slide must move/);
  const s = sanitizeSpec({ slides: [{ title: 'S', items: [
    { kind: 'graph', fn: 'x^2', enter: 'draw', then: [{ click: 1, point: -2 }, { click: 2, riemann: 500, color: 'red' }, { click: 3 }, 'junk'] },
    { kind: 'shape', shape: 'circle', click: 1, leave: 3, exit: 'explode', loop: 'teleport', emph: 'wiggle', enter: '<script>', then: [{ click: 99, x: 1e9 }] },
  ] }] });
  const [g, c] = s.slides[0].items;
  assert.equal(g.enter, 'draw');
  assert.deepEqual(g.then, [{ click: 1, point: -2 }, { click: 2, color: '#FC6255', riemann: 100 }]);
  assert.equal(c.enter, undefined); assert.equal(c.exit, 'fade'); assert.equal(c.leave, 3); assert.equal(c.loop, undefined); assert.equal(c.emph, 'wiggle');
  assert.deepEqual(c.then, [{ click: 12, x: 7.1 }]);
});

test('AI: Tracé objects and library drawings are kept, with only plain settings', async () => {
  const { sanitizeSpec } = await import('../lib/aispec.js');
  const s = sanitizeSpec({ slides: [{ title: 'S', items: [
    { kind: 'object', type: 'pendulum', props: { L: 2.5, ang: 20, showAng: true, angLabel: '<img src=x onerror=alert(1)>\\theta', 'bad key': 1, nested: { a: 1 } }, loop: 'flow' },
    { kind: 'object', type: 'script', props: {} },
    { kind: 'drawing', lib: 'cannon', size: 0.8 },
    { kind: 'drawing', lib: '../../etc' },
    { kind: 'equation', math: '100 cos(theta)', label: true },
  ] }] });
  const it = s.slides[0].items;
  assert.equal(it.length, 3);
  assert.equal(it[0].type, 'pendulum'); assert.equal(it[0].loop, 'flow');
  assert.deepEqual(Object.keys(it[0].props).sort(), ['L', 'ang', 'angLabel', 'showAng']);
  assert.ok(!/[<>]/.test(it[0].props.angLabel));
  assert.equal(it[1].lib, 'cannon'); assert.equal(it[1].size, 0.8);
  assert.equal(it[2].label, true);
});

test('AI: a 10-slide deck is planned, written in 3 parts at once, and uses 3 credits', async () => {
  let takes = 0; const asks = [];
  const slide = t => ({ title: t, items: [{ kind: 'text', text: t }] });
  fakeFetch([authed, ['https://db.example/rest/v1/rpc/ai_take_credit', () => { takes++; return ok({ ok: true, from: 'bought', left: 10 - takes }); }],
    ['https://ai.example/v1/messages', (u, i) => {
      const b = JSON.parse(i.body); const m = b.messages[0].content; asks.push(m);
      if (/You plan animated teaching decks/.test(b.system)) return ok({ content: [{ type: 'text', text: JSON.stringify({ title: 'Waves', slides: Array.from({ length: 10 }, (_, k) => ({ title: 'S' + (k + 1), idea: 'idea' })) }) }] });
      const [, a, z] = m.match(/Write ONLY slides (\d+) to (\d+)/);
      return ok({ content: [{ type: 'text', text: JSON.stringify({ title: 'x', slides: Array.from({ length: z - a + 1 }, (_, k) => slide('S' + (+a + k))) }) }] });
    }]]);
  const res = await aiDeck({ request: aiReq({ prompt: 'waves for year 11', count: 10 }), env: aiEnv });
  const out = await res.json();
  assert.equal(res.status, 200); assert.equal(takes, 3); assert.equal(asks.length, 4);
  assert.deepEqual(out.spec.slides.map(s => s.title), Array.from({ length: 10 }, (_, k) => 'S' + (k + 1)));
  assert.equal(out.spec.title, 'Waves'); assert.equal(out.left, 7);
});

test('AI: not enough credits for a long deck gives back the ones taken', async () => {
  let takes = 0, refunds = 0;
  fakeFetch([authed, ['https://db.example/rest/v1/rpc/ai_take_credit', () => ++takes < 2 ? ok({ ok: true, from: 'trial', left: 0 }) : ok({ ok: false, error: 'no_credits', pro: false })],
    ['https://db.example/rest/v1/rpc/ai_refund_credit', () => { refunds++; return ok(null); }]]);
  const res = await aiDeck({ request: aiReq({ prompt: 'a long deck please', count: 12 }), env: aiEnv });
  assert.equal(res.status, 402); assert.equal((await res.json()).need, 3); assert.equal(refunds, 1);
  assert.ok(!calls.some(c => c.url.includes('ai.example')));
});
