/* Shared pieces for the account pages and the editor:
   - TRACE_PLANS: what each plan includes (one list, used everywhere in the app)
   - TraceUI.planTable(): the Free / Pro comparison
   - TraceUI.profileForm(): the profile form (name, role, subject, school, colour)
   - TraceUI.avatar(): the round initials badge */
(function () {
  'use strict';
  const CFG = window.TRACE_CONFIG || {};
  const FREE_DECKS = CFG.freeDecks || 3;

  // Keep this list in step with plan_limits() in the database and the pricing section of index.html.
  window.TRACE_PLANS = {
    rows: [
      ['The editor: every animation, and all text, maths, graphs, shapes and science objects', true, true],
      ['Present full screen with live sliders', true, true],
      ['Unlimited projects in your browser', true, true],
      ['Basic 3D shapes: sphere, cube, cylinder, cone, prism, pyramid', true, true],
      ['Advanced 3D: surfaces z = f(x, y), 3D scenes, polyhedra, torus, 3D arrows, turning views', false, true],
      ['Record your voice on slides and clicks', false, true],
      ['Python video script (Manim)', CFG.pythonForFree ? 'With a “Made with Tracé” mark' : false, true],
      ['Projects saved to your account', String(FREE_DECKS), 'Unlimited'],
      ['Size of one project (images and voice included)', '2 MB', '20 MB'],
      ['“Made with Tracé” badge', 'On share links and while presenting', 'None'],
      ['See how often each shared deck is watched', false, true],
    ],
    proOnly: ['Advanced 3D: surfaces, 3D scenes, polyhedra, turning views', 'Record your voice on slides', 'The Python video script for Manim', 'Unlimited projects in your account, up to 20 MB each', 'No “Made with Tracé” badge', 'View counts on shared decks'],
  };

  const ROLES = [
    ['teacher', 'Teacher', 'Secondary or high school'],
    ['lecturer', 'Lecturer', 'University or college'],
    ['student', 'Student', 'Projects and presentations'],
    ['creator', 'Science creator', 'Videos and online courses'],
    ['other', 'Something else', 'Engineer, researcher…'],
  ];
  const ICON = {
    teacher: '<path d="M3 5h14v9H3z"/><path d="M7 17l3-3 3 3M6 8.5h5M6 11h8"/>',
    lecturer: '<path d="M2 8l8-4 8 4-8 4z"/><path d="M5.5 9.8V13c0 1.4 2 2.5 4.5 2.5s4.5-1.1 4.5-2.5V9.8M18 8v5"/>',
    student: '<path d="M4 4.5h5a2 2 0 012 2V16a1.6 1.6 0 00-1.6-1.6H4z"/><path d="M16 4.5h-5a2 2 0 00-2 2"/><path d="M11 16a1.6 1.6 0 011.6-1.6H16v-9.9"/>',
    creator: '<rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="M8.5 7.8v4.4l3.8-2.2z"/>',
    other: '<circle cx="5" cy="10" r="1.2"/><circle cx="10" cy="10" r="1.2"/><circle cx="15" cy="10" r="1.2"/>',
  };
  const icon = k => `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ''}</svg>`;
  const SUBJECTS = ['Maths', 'Physics', 'Maths and physics', 'Engineering', 'Chemistry', 'Computer science'];
  const COLORS = ['#22488a', '#1f7a6d', '#7a3b8f', '#b4552d', '#2e6fb7', '#8a6d1f', '#a3324b', '#3d4a43'];

  const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const initials = (name, email) => {
    const n = String(name || '').trim();
    if (n) { const p = n.split(/\s+/); return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
    return String(email || '?')[0].toUpperCase();
  };

  const css = document.createElement('style');
  css.textContent = `
  .t-avatar{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font-weight:700;flex:none;letter-spacing:.02em}
  .t-plans{width:100%;border-collapse:collapse;font-size:14px}
  .t-plans th,.t-plans td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
  .t-plans th{font-size:12.5px;color:var(--mute);font-weight:600}
  .t-plans td:nth-child(n+2),.t-plans th:nth-child(n+2){text-align:center;width:28%}
  .t-plans .yes{color:var(--pen);font-weight:700}.t-plans .no{color:var(--mute)}
  .t-plans .pro-col{background:color-mix(in srgb,var(--pen) 7%,transparent)}
  .pro-tag{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.06em;color:var(--pen-ink);background:var(--pen);border-radius:3px;padding:1px 5px;vertical-align:1px;margin-left:4px}
  .t-form{display:grid;gap:16px}
  .t-form label.lab,.t-form .lab{display:block;font-weight:600;font-size:14px;margin-bottom:6px}
  .t-form .opt{font-weight:400;color:var(--mute)}
  .t-form input[type=text]{width:100%;font:inherit;font-size:16px;padding:11px 13px;border:1.5px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink)}
  .t-form input[type=text]:focus{outline:none;border-color:#3B5BFD;box-shadow:0 0 0 4px rgba(59,91,253,.16)}
  .t-pf{container-type:inline-size}
  .t-pf-grid{display:grid;gap:22px}
  @container (min-width:600px){.t-pf-grid{grid-template-columns:minmax(0,1fr) 220px;align-items:start}.t-pf-side{position:sticky;top:16px;order:2}}
  .t-pf-side{display:grid;gap:8px}
  .t-pf-side .cap{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}
  .t-card{border:1px solid var(--line);border-radius:12px;background:var(--paper);padding:18px;display:grid;justify-items:center;text-align:center;gap:10px;box-shadow:0 10px 30px -18px rgba(0,0,0,.35)}
  .t-card b{display:block;font-size:16px;line-height:1.3;word-break:break-word}
  .t-card .sub{color:var(--mute);font-size:13px;line-height:1.4}
  .t-card .deck{width:100%;aspect-ratio:16/9;border-radius:6px;background:#0E1116;position:relative;overflow:hidden}
  .t-card .deck svg{position:absolute;inset:0;width:100%;height:100%}
  .t-card .by{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--mute);align-self:stretch;justify-content:center}
  .t-roles{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
  .t-roles label{position:relative;display:grid;grid-template-columns:auto 1fr;gap:2px 10px;align-items:center;border:1.5px solid var(--line);border-radius:10px;padding:11px 12px;cursor:pointer;background:var(--paper);transition:border-color .15s,box-shadow .15s}
  .t-roles label:hover{border-color:var(--mute)}
  .t-roles input{position:absolute;opacity:0;pointer-events:none}
  .t-roles svg{grid-row:span 2;color:var(--mute)}
  .t-roles label:has(input:checked){border-color:#3B5BFD;box-shadow:0 0 0 3px rgba(59,91,253,.14)}
  .t-roles label:has(input:checked) svg{color:#3B5BFD}
  .t-roles label:has(input:focus-visible){outline:2px solid #3B5BFD;outline-offset:2px}
  .t-roles b{display:block;font-size:14.5px;line-height:1.25}.t-roles small{color:var(--mute);font-size:12.5px;line-height:1.3}
  .t-chips{display:flex;flex-wrap:wrap;gap:6px}
  .t-chips button{border:1.5px solid var(--line);background:var(--paper);color:var(--ink);border-radius:999px;padding:5px 13px;font:inherit;font-size:13.5px;cursor:pointer}
  .t-chips button:hover{border-color:var(--mute)}
  .t-chips button[aria-pressed="true"]{border-color:#3B5BFD;background:#3B5BFD;color:#fff}
  .t-colors{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .t-colors button{width:30px;height:30px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}
  .t-colors button[aria-pressed="true"]{box-shadow:0 0 0 2px var(--paper),0 0 0 4px var(--ink)}
  .t-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding-top:4px}
  .t-actions .btn.primary{background:#3B5BFD;border-color:#3B5BFD;color:#fff;padding:11px 22px;border-radius:8px}
  .t-preview{display:none}
  .promo-form{display:grid;gap:6px;max-width:440px}
  .promo-form .lab{font-weight:600;font-size:14px}
  .promo-row{display:flex;gap:8px}
  .promo-row input{flex:1;min-width:0;font:inherit;font-size:15px;letter-spacing:.04em;text-transform:uppercase;padding:9px 12px;border:1.5px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink)}
  .promo-row input::placeholder{text-transform:none;letter-spacing:0}
  .promo-row input:focus{outline:none;border-color:#3B5BFD;box-shadow:0 0 0 4px rgba(59,91,253,.16)}
  .promo-row .btn{border-radius:8px;white-space:nowrap}
  .promo-ok{color:#1d7a43;font-weight:600;font-size:14px;margin:0}
  @container (max-width:599px){
    .t-card{grid-template-columns:auto minmax(0,1fr);justify-items:start;text-align:left;align-items:center;padding:12px 14px;gap:0 12px;box-shadow:none}
    .t-card>.t-avatar{width:44px!important;height:44px!important;font-size:18px!important}
    .t-card .deck,.t-card .by{display:none}
  }
  .t-err{color:var(--danger,#a8352b);font-size:14px;margin:0}`;
  document.head.appendChild(css);

  function avatar(profile, email, size) {
    const s = size || 32;
    return `<span class="t-avatar" style="width:${s}px;height:${s}px;font-size:${Math.round(s * 0.4)}px;background:${esc(profile && profile.avatar_color || COLORS[0])}" aria-hidden="true">${esc(initials(profile && profile.display_name, email))}</span>`;
  }

  function planTable(current) {
    const cell = v => v === true ? '<span class="yes" aria-label="Included">✓</span>' : v === false ? '<span class="no" aria-label="Not included">–</span>' : esc(v);
    return `<div style="overflow-x:auto"><table class="t-plans"><thead><tr><th></th><th>Free${current === 'free' ? ' · yours' : ''}</th><th class="pro-col">Pro${current === 'pro' ? ' · yours' : ''}</th></tr></thead><tbody>${
      window.TRACE_PLANS.rows.map(r => `<tr><td>${esc(r[0])}</td><td>${cell(r[1])}</td><td class="pro-col">${cell(r[2])}</td></tr>`).join('')}</tbody></table></div>`;
  }

  /* The profile form. onSubmit(values) must return a promise; its rejection message is shown. */
  function profileForm(root, profile, email, opts) {
    const p = Object.assign({ display_name: '', role: null, subject: '', organization: '', avatar_color: COLORS[0] }, profile || {});
    const roleLabel = r => (ROLES.find(x => x[0] === r) || [, ''])[1];
    root.innerHTML = `<div class="t-pf"><div class="t-pf-grid">
      <aside class="t-pf-side" aria-label="Preview"><span class="cap">How you appear</span>
        <div class="t-card" id="pf_preview" aria-live="polite"></div></aside>
      <form class="t-form" novalidate>
      <div><label class="lab" for="pf_name">Your name</label>
        <input type="text" id="pf_name" maxlength="60" autocomplete="name" required value="${esc(p.display_name)}" placeholder="e.g. Ana Diaz"></div>
      <div><span class="lab" id="pf_role_l">I am a…</span>
        <div class="t-roles" role="radiogroup" aria-labelledby="pf_role_l">${ROLES.map(([v, t, s]) => `<label><input type="radio" name="pf_role" value="${v}"${p.role === v ? ' checked' : ''}>${icon(v)}<b>${t}</b>${s ? `<small>${s}</small>` : ''}</label>`).join('')}</div></div>
      <div><span class="lab">What do you teach or study? <span class="opt">(optional)</span></span>
        <div class="t-chips" id="pf_subjects">${SUBJECTS.map(s => `<button type="button" aria-pressed="${p.subject === s}">${s}</button>`).join('')}</div>
        <input type="text" id="pf_subject" maxlength="60" style="margin-top:8px" value="${esc(p.subject)}" placeholder="Or type your subject" aria-label="Subject"></div>
      <div><label class="lab" for="pf_org">School, university or channel <span class="opt">(optional)</span></label>
        <input type="text" id="pf_org" maxlength="120" autocomplete="organization" value="${esc(p.organization)}" placeholder="e.g. Lycée Victor Hugo"></div>
      <div><span class="lab">Colour of your badge</span>
        <div class="t-colors" id="pf_colors">${COLORS.map(c => `<button type="button" style="background:${c}" data-c="${c}" aria-label="Colour ${c}" aria-pressed="${p.avatar_color === c}"></button>`).join('')}</div></div>
      <p class="t-err" id="pf_err" role="alert" hidden></p>
      <div class="t-actions"><button class="btn primary" type="submit" id="pf_save">${esc(opts && opts.submitLabel || 'Save')}</button>${opts && opts.secondary || ''}</div>
    </form></div></div>`;
    const $ = s => root.querySelector(s);
    let color = p.avatar_color || COLORS[0];
    const vals = () => ({
      display_name: $('#pf_name').value.trim(),
      role: (root.querySelector('input[name=pf_role]:checked') || {}).value || null,
      subject: $('#pf_subject').value.trim() || null,
      organization: $('#pf_org').value.trim() || null,
      avatar_color: color,
    });
    const preview = () => {
      const v = vals();
      $('#pf_preview').innerHTML = `${avatar(v, email, 64)}<div><b>${esc(v.display_name || 'Your name')}</b><span class="sub">${esc([roleLabel(v.role), v.subject, v.organization].filter(Boolean).join(' · ') || 'Your role and school')}</span></div>
        <div class="deck" aria-hidden="true"><svg viewBox="0 0 160 90"><path d="M12 45H150M20 12V80" stroke="#4a5160" stroke-width="1"/><path d="M20 45C30 15 40 15 50 45S70 75 80 45 100 15 110 45 130 75 140 45" fill="none" stroke="#58C4DD" stroke-width="2.2" stroke-linecap="round"/></svg></div>
        <div class="by">${avatar(v, email, 20)}<span>by ${esc(v.display_name || 'you')}</span></div>`;
    };
    $('#pf_subjects').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $('#pf_subject').value = b.getAttribute('aria-pressed') === 'true' ? '' : b.textContent;
      root.querySelectorAll('#pf_subjects button').forEach(x => x.setAttribute('aria-pressed', String(x.textContent === $('#pf_subject').value)));
      preview();
    });
    $('#pf_colors').addEventListener('click', e => {
      const b = e.target.closest('button[data-c]'); if (!b) return;
      color = b.dataset.c;
      root.querySelectorAll('#pf_colors button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      preview();
    });
    root.addEventListener('input', e => {
      if (e.target.id === 'pf_subject') root.querySelectorAll('#pf_subjects button').forEach(x => x.setAttribute('aria-pressed', String(x.textContent === e.target.value.trim())));
      preview();
    });
    root.addEventListener('change', preview);
    root.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const v = vals(), err = $('#pf_err');
      err.hidden = true;
      if (!v.display_name) { err.textContent = 'Please enter your name.'; err.hidden = false; $('#pf_name').focus(); return; }
      if (!v.role) { err.textContent = 'Please choose what you do.'; err.hidden = false; return; }
      const btn = $('#pf_save'), label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Saving…';
      try { await opts.onSubmit(v); }
      catch (x) { err.textContent = (x && x.message) || 'Could not save. Check your connection and try again.'; err.hidden = false; }
      finally { btn.disabled = false; btn.textContent = label; }
    });
    preview();
    if (!p.display_name) setTimeout(() => $('#pf_name').focus(), 50);
  }

  /* ---------- the plan that counts now, and promo codes (004_promo_codes.sql) ---------- */
  const PAYING = ['active', 'trialing', 'past_due'];
  // A gift from a promo code ends at comp_until, unless a subscription is running.
  function effectivePlan(p) {
    if (!p) return 'free';
    if (p.plan === 'pro' && p.comp_until && new Date(p.comp_until) < new Date() && !PAYING.includes(p.subscription_status)) return 'free';
    return p.plan || 'free';
  }
  const isGift = p => !!(p && p.plan === 'pro' && p.comp_until && new Date(p.comp_until) > new Date() && !PAYING.includes(p.subscription_status));
  const longDate = d => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  // Loads the profile; works before 004_promo_codes.sql has been run too.
  async function fetchProfile(sb, uid, cols) {
    try { await sb.rpc('refresh_my_plan'); } catch (_) {}
    let r = await sb.from('profiles').select(cols + ',comp_until,comp_code').eq('id', uid).maybeSingle();
    if (r.error) r = await sb.from('profiles').select(cols).eq('id', uid).maybeSingle();
    const p = r.data || null;
    if (p) p.plan = effectivePlan(p);
    return p;
  }
  const PROMO_ERRORS = {
    invalid_code: 'This code does not exist or has expired. Check the spelling and try again.',
    code_used_up: 'This code has already been used by everyone it was for.',
    already_redeemed: 'Your account has already used a promo code.',
    already_subscribed: 'You already have Pro.',
    too_many_attempts: 'Too many tries today. Please try again tomorrow.',
    not_signed_in: 'Please sign in first.',
  };
  /* The "Promo code" box. onDone(untilDate) runs after a code worked. */
  function promoForm(root, sb, onDone, prefill) {
    root.innerHTML = `<form class="promo-form" novalidate><label class="lab" for="promoCode">Promo code</label>
      <div class="promo-row"><input type="text" id="promoCode" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="e.g. FOUNDERS-2026" value="${esc(prefill || '')}">
      <button class="btn" type="submit" id="promoGo">Redeem</button></div>
      <p class="t-err" id="promoErr" role="alert" hidden></p></form>`;
    const f = root.querySelector('form'), inp = root.querySelector('#promoCode'), err = root.querySelector('#promoErr'), btn = root.querySelector('#promoGo');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const code = inp.value.trim();
      err.hidden = true;
      if (!code) { err.textContent = 'Type the code you were given.'; err.hidden = false; inp.focus(); return; }
      btn.disabled = true; btn.textContent = 'Checking…';
      let res;
      try { res = await sb.rpc('redeem_promo', { p_code: code }); } catch (x) { res = { error: x }; }
      btn.disabled = false; btn.textContent = 'Redeem';
      const out = res && res.data;
      if (res.error || !out) { err.textContent = 'Promo codes are not available right now. Please try again later.'; err.hidden = false; return; }
      if (!out.ok) { err.textContent = PROMO_ERRORS[out.error] || 'This code did not work.'; err.hidden = false; inp.select(); return; }
      root.innerHTML = `<p class="promo-ok" role="status">✓ Code accepted: Pro is on until ${esc(longDate(out.until))}.</p>`;
      onDone && onDone(out.until);
    });
  }

  window.TraceUI = { avatar, planTable, profileForm, initials, ROLES, isComplete: p => !!(p && p.display_name && p.role),
                     effectivePlan, isGift, fetchProfile, promoForm, longDate };
})();
