// POST /api/ai-deck  (with the user's sign-in token)
// Body: { prompt, mode: "new" | "add", size: "16:9" | "9:16" | …, context: { title, slides: ["slide title", …] } }
// Answers { spec, left } (credits left) where spec is a checked description of slides that the editor builds.
// Needs the Cloudflare secret ANTHROPIC_API_KEY. Optional variables: AI_MODEL, ANTHROPIC_API_BASE.
import { json, supabaseAdmin, userFromRequest } from '../../lib/server.js';
import { systemPrompt, sanitizeSpec, extractJSON } from '../../lib/aispec.js';

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'not_configured' }, 503);
  const user = await userFromRequest(env, request);
  if (!user) return json({ error: 'signin' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const prompt = String(body && body.prompt || '').trim().slice(0, 2000);
  if (prompt.length < 3) return json({ error: 'empty_prompt' }, 400);
  const mode = body.mode === 'add' ? 'add' : 'new';
  const size = ['16:9', '4:3', '1:1', '9:16'].includes(body.size) ? body.size : '16:9';
  const ctx = body.context || {};
  const titles = (Array.isArray(ctx.slides) ? ctx.slides : []).slice(0, 40).map(t => String(t || '').slice(0, 80));

  // one credit per request (Pro monthly credits first, then trial/bought ones; see 007_ai.sql)
  const credit = await supabaseAdmin(env, '/rest/v1/rpc/ai_take_credit', { method: 'POST', body: JSON.stringify({ p_user: user.id }) });
  if (!credit || !credit.ok) return json({ error: 'no_credits', pro: !!(credit && credit.pro) }, 402);
  const refund = () => supabaseAdmin(env, '/rest/v1/rpc/ai_refund_credit', { method: 'POST', body: JSON.stringify({ p_user: user.id, p_from: credit.from }) }).catch(() => {});

  const ask = mode === 'add'
    ? `The presentation "${String(ctx.title || '').slice(0, 80)}" already has these slides: ${titles.map((t, i) => `${i + 1}. ${t}`).join('; ') || 'none'}.\nWrite only the NEW slides to add at the end, for this request:\n${prompt}`
    : `Make a presentation for this request:\n${prompt}`;
  const LANG = { fr: 'French', es: 'Spanish', pt: 'Brazilian Portuguese', ar: 'Modern Standard Arabic' }[body.lang];
  const langLine = LANG ? `\n\nWrite all slide text (titles, bullet points, labels, notes) in ${LANG}. Keep maths, LaTeX, variable names and units as they are.` : '';
  const task0 = body.solve ? `${ask}\n\nThis is a request to SOLVE: show the full worked solution step by step (one operation per click) and include "check" on the answer slide.` : ask;
  const task = task0 + langLine;

  let text = '', stop = '';
  try {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 150000);
    const res = await fetch(`${env.ANTHROPIC_API_BASE || 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST', signal: ac.signal,
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.AI_MODEL || 'claude-sonnet-5-5', max_tokens: Math.min(8000, Math.max(1500, Number(env.AI_MAX_TOKENS) || 4500)), system: systemPrompt(size), messages: [{ role: 'user', content: task }] }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      // say why (bad key, no API credit, unknown model, busy…) so the site owner can fix it; the message holds no secret
      let why = '';
      try { const e = await res.json(); why = String(e && e.error && (e.error.message || e.error.type) || ''); } catch {}
      console.log('ai-deck: Anthropic answered', res.status, why);
      await refund();
      return json({ error: 'ai_unavailable', status: res.status, detail: why.slice(0, 200) }, 502);
    }
    const out = await res.json();
    stop = out.stop_reason || '';
    // what this request cost in tokens (Cloudflare → Worker → Logs), to compare with the credit price
    if (out.usage) console.log('ai-deck: tokens in', out.usage.input_tokens, 'out', out.usage.output_tokens, 'stop', out.stop_reason);
    text = (out.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  } catch (e) {
    console.log('ai-deck: request failed', e && e.name, e && e.message);
    await refund();
    return json({ error: 'ai_unavailable', detail: e && e.name === 'AbortError' ? 'The AI took too long to answer.' : 'Could not reach the AI service.' }, 502);
  }

  const spec = sanitizeSpec(extractJSON(text), size);
  if (!spec.slides.length) {
    console.log('ai-deck: unreadable answer, stop_reason', stop, 'length', text.length);
    await refund();
    return json({ error: 'ai_unreadable', detail: stop === 'max_tokens' ? 'The answer was too long. Ask for fewer slides.' : 'The answer was not in the expected format.' }, 502);
  }
  if (stop === 'max_tokens') spec.cut = true; // the editor says the last slide was left out
  return json({ spec, left: credit.left });
}
