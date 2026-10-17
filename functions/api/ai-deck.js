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

  // How many slides: "auto" (the model picks 3 to 6) or a number up to 15.
  // Up to 6 slides is one request and one credit; longer decks are planned first, then written in parts,
  // in parallel, one credit per part (about 4 slides each).
  const count = body.solve ? 0 : Math.max(0, Math.min(15, Math.round(Number(body.count) || 0)));
  const parts = count > 6 ? Math.ceil(count / 4) : 1;

  const taken = [];
  const refundOne = from => supabaseAdmin(env, '/rest/v1/rpc/ai_refund_credit', { method: 'POST', body: JSON.stringify({ p_user: user.id, p_from: from }) }).catch(() => {});
  const refundAll = () => Promise.all(taken.splice(0).map(refundOne));
  let left = 0;
  for (let k = 0; k < parts; k++) {
    const credit = await supabaseAdmin(env, '/rest/v1/rpc/ai_take_credit', { method: 'POST', body: JSON.stringify({ p_user: user.id }) });
    if (!credit || !credit.ok) { await refundAll(); return json({ error: 'no_credits', pro: !!(credit && credit.pro), ...(parts > 1 ? { need: parts } : {}) }, 402); }
    taken.push(credit.from); left = credit.left;
  }

  const ask = mode === 'add'
    ? `The presentation "${String(ctx.title || '').slice(0, 80)}" already has these slides: ${titles.map((t, i) => `${i + 1}. ${t}`).join('; ') || 'none'}.\nWrite only the NEW slides to add at the end, for this request:\n${prompt}`
    : `Make a presentation for this request:\n${prompt}`;
  const LANG = { fr: 'French', es: 'Spanish', pt: 'Brazilian Portuguese', ar: 'Modern Standard Arabic' }[body.lang];
  const langLine = LANG ? `\n\nWrite all slide text (titles, bullet points, labels, notes) in ${LANG}. Keep maths, LaTeX, variable names and units as they are.` : '';
  const solveLine = body.solve ? `\n\nThis is a request to SOLVE: show the full worked solution step by step (one operation per click) and include "check" on the answer slide.` : '';
  const maxTok = Math.min(8000, Math.max(1500, Number(env.AI_MAX_TOKENS) || 4500));

  // one call to the model: { text, stop } or { error, status, detail }
  async function callModel(system, user, max) {
    try {
      const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 150000);
      const res = await fetch(`${env.ANTHROPIC_API_BASE || 'https://api.anthropic.com'}/v1/messages`, {
        method: 'POST', signal: ac.signal,
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: env.AI_MODEL || 'claude-sonnet-5-5', max_tokens: max, system, messages: [{ role: 'user', content: user }] }),
      });
      clearTimeout(timer);
      if (!res.ok) {
        // say why (bad key, no API credit, unknown model, busy…) so the site owner can fix it; the message holds no secret
        let why = '';
        try { const e = await res.json(); why = String(e && e.error && (e.error.message || e.error.type) || ''); } catch {}
        console.log('ai-deck: Anthropic answered', res.status, why);
        return { error: 'ai_unavailable', status: res.status, detail: why.slice(0, 200) };
      }
      const out = await res.json();
      // what this request cost in tokens (Cloudflare → Worker → Logs), to compare with the credit price
      if (out.usage) console.log('ai-deck: tokens in', out.usage.input_tokens, 'out', out.usage.output_tokens, 'stop', out.stop_reason);
      return { text: (out.content || []).filter(c => c.type === 'text').map(c => c.text).join(''), stop: out.stop_reason || '' };
    } catch (e) {
      console.log('ai-deck: request failed', e && e.name, e && e.message);
      return { error: 'ai_unavailable', detail: e && e.name === 'AbortError' ? 'The AI took too long to answer.' : 'Could not reach the AI service.' };
    }
  }
  const sys = systemPrompt(size);
  const fail = async r => { await refundAll(); return json({ error: r.error, status: r.status, detail: r.detail }, 502); };

  let spec, cut = false;
  if (parts === 1) {
    const exact = count ? `\n\nMake exactly ${count} slides.` : '';
    const r = await callModel(sys, ask + exact + solveLine + langLine, maxTok);
    if (r.error) return fail(r);
    spec = sanitizeSpec(extractJSON(r.text), size);
    if (!spec.slides.length) {
      console.log('ai-deck: unreadable answer, stop_reason', r.stop, 'length', r.text.length);
      await refundAll();
      return json({ error: 'ai_unreadable', detail: r.stop === 'max_tokens' ? 'The answer was too long. Ask for fewer slides.' : 'The answer was not in the expected format.' }, 502);
    }
    cut = r.stop === 'max_tokens';
  } else {
    // 1. the plan: one line per slide, so the parts written in parallel tell one story
    const planSys = `You plan animated teaching decks for Tracé. Answer with ONE JSON object and nothing else: {"title":"deck title","slides":[{"title":"…","idea":"one sentence: what the slide shows, which object, drawing, graph or animation carries it, and what happens on each click"}]}. Plan exactly ${count} slides. Make it a story: open with a hook (a question, a surprising fact or a real scene), build the idea step by step, include worked examples, at least one quiz question and one slide with a real-world picture or simulation, and end with a recap or a challenge. Vary the slides: never the same kind of slide twice in a row.`;
    const pr = await callModel(planSys, ask + solveLine + langLine, 2000);
    if (pr.error) return fail(pr);
    const plan = extractJSON(pr.text);
    const outline = (plan && Array.isArray(plan.slides) ? plan.slides : []).slice(0, count).map((p, i) => `${i + 1}. ${String(p && p.title || '').slice(0, 90)}: ${String(p && p.idea || '').slice(0, 300)}`);
    if (outline.length < 2) { await refundAll(); return json({ error: 'ai_unreadable', detail: 'The AI could not plan the deck.' }, 502); }
    // 2. the slides, written in parts at the same time
    const per = Math.ceil(outline.length / parts), jobs = [];
    for (let a = 0; a < outline.length; a += per) {
      const b = Math.min(outline.length, a + per);
      const u = `${ask}${solveLine}\n\nThe whole deck is planned like this:\n${outline.join('\n')}\n\nWrite ONLY slides ${a + 1} to ${b} of this plan, in order, following their ideas (as {"title":…,"slides":[…]} with just those ${b - a} slides). When an object continues from the slide before, give it the same "id" as there would be on that slide.${langLine}`;
      jobs.push(callModel(sys, u, maxTok));
    }
    const res = await Promise.all(jobs);
    spec = { title: String(plan.title || '').slice(0, 80) || 'New presentation', slides: [] };
    res.forEach((r, k) => {
      const part = r.error ? null : sanitizeSpec(extractJSON(r.text), size);
      if (part && part.slides.length) { spec.slides.push(...part.slides); if (r.stop === 'max_tokens') cut = true; }
      else { cut = true; const from = taken.pop(); if (from) refundOne(from); }   // a part that failed is not counted
    });
    if (!spec.slides.length) { const r0 = res.find(r => r.error) || {}; await refundAll(); return json({ error: r0.error || 'ai_unreadable', status: r0.status, detail: r0.detail || 'The answer was not in the expected format.' }, 502); }
    spec = sanitizeSpec(spec, size);
  }
  if (cut) spec.cut = true; // the editor says some slides were left out
  return json({ spec, left: Math.max(0, left) });
}
