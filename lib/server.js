// Helpers shared by the server functions in functions/api (kept outside that folder so they are not routes).

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const paddleBase = env =>
  env.PADDLE_API_BASE || (env.PADDLE_ENV === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com');

// Calls Supabase with the service role key (full access). Only ever used on the server.
export async function supabaseAdmin(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${path} failed: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// Who is calling? Checks the user's sign-in token with Supabase.
export async function userFromRequest(env, request) {
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: auth },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user : null;
}

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

// Constant-time comparison of two strings.
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Paddle signs each webhook: header "ts=<unix>;h1=<hex hmac-sha256 of `${ts}:${body}`>".
// During secret rotation there can be more than one h1.
export async function verifyPaddleSignature(header, rawBody, secret, { now = Date.now(), toleranceSec = 300 } = {}) {
  if (!header || !secret) return false;
  let ts = null;
  const sigs = [];
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 'ts') ts = v;
    else if (k === 'h1') sigs.push(v);
  }
  if (!ts || !/^\d+$/.test(ts) || !sigs.length) return false;
  if (Math.abs(now / 1000 - Number(ts)) > toleranceSec) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}:${rawBody}`)));
  return sigs.some(s => same(s, mac));
}
