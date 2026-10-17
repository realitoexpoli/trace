// A local stand-in for Supabase, used by the end-to-end tests.
//   /rest/v1/*  → the real PostgREST (the same data server Supabase runs), on a local Postgres
//                 with supabase/migrations/001_init.sql applied, so the real security rules are tested
//   /auth/v1/*  → a small fake of Supabase Auth: email links (PKCE), passwords (sign-up with email
//                 confirmation, sign-in, reset, change), tokens, current user
//   /paddle/*   → a fake Paddle API for the billing portal
//   /__test/*   → helpers for the test script
// Usage: node local-supabase.mjs <port> <postgrest-port> <jwt-secret> <database-name>
import http from 'node:http';
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [port, pgrstPort, secret, db] = process.argv.slice(2);
const b64u = b => Buffer.from(b).toString('base64url');
const sign = claims => {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64u(JSON.stringify(claims));
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
};
const verify = t => {
  const [h, p, s] = String(t).split('.');
  if (!s || createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url') !== s) return null;
  const c = JSON.parse(Buffer.from(p, 'base64url'));
  return c.exp && c.exp < Date.now() / 1000 ? null : c;
};
export const keysFor = () => ({
  anon: sign({ role: 'anon', iss: 'local', exp: 4102444800 }),
  service: sign({ role: 'service_role', iss: 'local', exp: 4102444800 }),
});
const keys = keysFor();
const psql = sql => execFileSync('psql', ['-qAt', '-d', db, '-c', sql]).toString().trim();

const users = new Map();      // email -> id
const codes = new Map();      // code -> {email, challenge}
const refresh = new Map();    // refresh token -> email
let lastCode = {};
const passwords = new Map();  // email -> sha256 of the password
const unconfirmed = new Set(); // emails that signed up with a password and have not opened the link yet
const hashPw = p => createHash('sha256').update('salt:' + p).digest('hex');
const exists = email => !!psql(`select id from auth.users where email = '${String(email).replace(/'/g, "''")}'`);
function userFor(email) {
  if (!users.has(email)) {
    const existing = psql(`select id from auth.users where email = '${email.replace(/'/g, "''")}'`);
    const id = existing || randomUUID();
    if (!existing) psql(`insert into auth.users (id, email) values ('${id}', '${email.replace(/'/g, "''")}')`);
    users.set(email, id);
  }
  return { id: users.get(email), email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {},
           identities: passwords.has(email) ? [{ provider: 'email', identity_id: users.get(email) }] : [], created_at: new Date().toISOString() };
}
function session(email) {
  const user = userFor(email), rt = randomUUID();
  refresh.set(rt, email);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: sign({ sub: user.id, email, role: 'authenticated', aud: 'authenticated', exp }), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: rt, user };
}
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'access-control-expose-headers': '*' };
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', ...cors }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const readBody = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const raw = await readBody(req);
  const bodyJson = () => { try { return JSON.parse(raw || '{}'); } catch { return {}; } };

  if (url.pathname.startsWith('/rest/v1/')) {
    const headers = { ...req.headers };
    delete headers.host; delete headers['content-length'];
    const r = await fetch(`http://127.0.0.1:${pgrstPort}${url.pathname.slice(8)}${url.search}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : raw });
    const out = Buffer.from(await r.arrayBuffer());
    const h = { ...cors };
    r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k)) h[k] = v; });
    res.writeHead(r.status, h); return res.end(out);
  }

  if (url.pathname === '/auth/v1/otp' && req.method === 'POST') {
    const b = bodyJson(), code = randomUUID();
    // like Supabase: signing in (not signing up) with an unknown email is refused
    if (b.create_user === false && !psql(`select id from auth.users where email = '${String(b.email).replace(/'/g, "''")}'`))
      return send(res, 422, { code: 'otp_disabled', error_code: 'otp_disabled', msg: 'Signups not allowed for otp' });
    codes.set(code, { email: b.email, challenge: b.code_challenge });
    lastCode[b.email] = code;
    return send(res, 200, {});
  }
  const newCode = (email, b, kind) => { const code = randomUUID(); codes.set(code, { email, challenge: b.code_challenge, kind }); lastCode[email] = code; return code; };
  if (url.pathname === '/auth/v1/signup' && req.method === 'POST') {
    const b = bodyJson();
    if (!b.password || b.password.length < 8) return send(res, 422, { code: 'weak_password', error_code: 'weak_password', msg: 'Password should be at least 8 characters.' });
    // like Supabase with "Confirm email" on: an existing address gets a user with no identities, and no email
    if (exists(b.email) && (passwords.has(b.email) || !unconfirmed.has(b.email))) return send(res, 200, { ...userFor(b.email), identities: [] });
    passwords.set(b.email, hashPw(b.password)); unconfirmed.add(b.email);
    const u = userFor(b.email);
    newCode(b.email, b, 'confirm');
    return send(res, 200, { ...u, confirmation_sent_at: new Date().toISOString() });
  }
  if (url.pathname === '/auth/v1/recover' && req.method === 'POST') {
    const b = bodyJson();
    if (exists(b.email)) newCode(b.email, b, 'recovery');
    return send(res, 200, {});
  }
  if (url.pathname === '/auth/v1/resend' && req.method === 'POST') {
    const b = bodyJson();
    if (unconfirmed.has(b.email)) newCode(b.email, b, 'confirm');
    return send(res, 200, {});
  }
  if (url.pathname === '/auth/v1/user' && req.method === 'PUT') {
    const c = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!c || !c.sub) return send(res, 401, { msg: 'invalid token' });
    const b = bodyJson();
    if (b.password) {
      if (b.password.length < 8) return send(res, 422, { code: 'weak_password', error_code: 'weak_password', msg: 'Password should be at least 8 characters.' });
      if (passwords.get(c.email) === hashPw(b.password)) return send(res, 422, { code: 'same_password', error_code: 'same_password', msg: 'New password should be different from the old password.' });
      passwords.set(c.email, hashPw(b.password));
    }
    return send(res, 200, userFor(c.email));
  }
  if (url.pathname === '/auth/v1/token') {
    const b = bodyJson(), g = url.searchParams.get('grant_type');
    if (g === 'password') {
      if (!passwords.has(b.email) || passwords.get(b.email) !== hashPw(b.password || ''))
        return send(res, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      if (unconfirmed.has(b.email)) return send(res, 400, { code: 'email_not_confirmed', error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
      return send(res, 200, session(b.email));
    }
    if (g === 'pkce') {
      const c = codes.get(b.auth_code);
      if (!c) return send(res, 400, { error: 'invalid_grant', error_description: 'bad code' });
      const challenge = createHash('sha256').update(b.code_verifier || '').digest('base64url');
      if (c.challenge && challenge !== c.challenge) return send(res, 400, { error: 'invalid_grant', error_description: 'code verifier does not match' });
      codes.delete(b.auth_code);
      unconfirmed.delete(c.email);   // opening any emailed link confirms the address
      return send(res, 200, session(c.email));
    }
    if (g === 'refresh_token' && refresh.has(b.refresh_token)) return send(res, 200, session(refresh.get(b.refresh_token)));
    return send(res, 400, { error: 'invalid_grant' });
  }
  if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
    const c = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!c || !c.sub) return send(res, 401, { msg: 'invalid token' });
    return send(res, 200, userFor(c.email));
  }
  if (url.pathname === '/auth/v1/logout') return send(res, 204);

  if (url.pathname.startsWith('/paddle/customers/') && url.pathname.endsWith('/portal-sessions')) {
    if (req.headers.authorization !== 'Bearer test_paddle_api_key') return send(res, 403, {});
    const ctm = url.pathname.split('/')[3];
    return send(res, 201, { data: { urls: { general: { overview: `https://customer-portal.paddle.example/${ctm}` } } } });
  }

  if (url.pathname === '/__test/keys') return send(res, 200, keys);
  if (url.pathname === '/__test/code') return send(res, 200, { code: lastCode[url.searchParams.get('email')] || null });
  send(res, 404, { error: 'not found ' + url.pathname });
}).listen(Number(port), '127.0.0.1', () => console.log('local supabase on', port));
