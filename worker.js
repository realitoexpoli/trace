// Tracé on Cloudflare Workers.
// Static files come from ./public (see wrangler.jsonc). This script only handles what files cannot:
//   /api/paddle-webhook, /api/billing-portal  → the same functions Cloudflare Pages runs from functions/api
//   /v/<link>                                  → the editor page, which plays the shared deck
import * as paddleWebhook from './functions/api/paddle-webhook.js';
import * as billingPortal from './functions/api/billing-portal.js';

const API = {
  '/api/paddle-webhook': paddleWebhook,
  '/api/billing-portal': billingPortal,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const mod = API[url.pathname];
    if (mod) {
      const m = request.method.charAt(0) + request.method.slice(1).toLowerCase();
      const handler = mod['onRequest' + m] || mod.onRequest;
      if (!handler) return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
      return handler({ request, env, waitUntil: p => ctx.waitUntil(p), params: {} });
    }
    if (url.pathname.startsWith('/v/')) {
      const res = await env.ASSETS.fetch(new Request(new URL('/app', url), request));
      const out = new Response(res.body, res);
      out.headers.set('X-Robots-Tag', 'noindex');
      return out;
    }
    return env.ASSETS.fetch(request);
  },
};
