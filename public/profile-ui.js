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
    ['other', 'Something else', ''],
  ];
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
  .t-form label.lab{display:block;font-weight:600;font-size:14px;margin-bottom:6px}
  .t-form .opt{font-weight:400;color:var(--mute)}
  .t-form input[type=text]{width:100%;font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:4px;background:var(--desk);color:var(--ink)}
  .t-form input[type=text]:focus{outline:2px solid var(--pen);outline-offset:1px;border-color:var(--pen)}
  .t-roles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
  .t-roles label{display:block;border:1px solid var(--line);border-radius:4px;padding:10px 12px;cursor:pointer;background:var(--paper)}
  .t-roles label:hover{border-color:var(--mute)}
  .t-roles input{position:absolute;opacity:0;pointer-events:none}
  .t-roles label:has(input:checked){border-color:var(--pen);box-shadow:inset 0 0 0 1px var(--pen)}
  .t-roles label:has(input:focus-visible){outline:2px solid var(--pen);outline-offset:2px}
  .t-roles b{display:block;font-size:14.5px}.t-roles small{color:var(--mute);font-size:12.5px}
  .t-chips{display:flex;flex-wrap:wrap;gap:6px}
  .t-chips button{border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:999px;padding:5px 12px;font:inherit;font-size:13.5px;cursor:pointer}
  .t-chips button[aria-pressed="true"]{border-color:var(--pen);background:var(--pen);color:var(--pen-ink)}
  .t-colors{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .t-colors button{width:28px;height:28px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}
  .t-colors button[aria-pressed="true"]{box-shadow:0 0 0 2px var(--paper),0 0 0 4px var(--ink)}
  .t-preview{display:flex;align-items:center;gap:12px;padding:12px;border:1px dashed var(--line);border-radius:4px}
  .t-preview b{display:block}.t-preview span:not(.t-avatar){color:var(--mute);font-size:13.5px}
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
    root.innerHTML = `<form class="t-form" novalidate>
      <div><label class="lab" for="pf_name">Your name</label>
        <input type="text" id="pf_name" maxlength="60" autocomplete="name" required value="${esc(p.display_name)}" placeholder="e.g. Ana Diaz"></div>
      <div><span class="lab" id="pf_role_l" style="display:block;font-weight:600;font-size:14px;margin-bottom:6px">I am a…</span>
        <div class="t-roles" role="radiogroup" aria-labelledby="pf_role_l">${ROLES.map(([v, t, s]) => `<label><input type="radio" name="pf_role" value="${v}"${p.role === v ? ' checked' : ''}><b>${t}</b>${s ? `<small>${s}</small>` : ''}</label>`).join('')}</div></div>
      <div><span class="lab" style="display:block;font-weight:600;font-size:14px;margin-bottom:6px">What do you teach or study? <span class="opt">(optional)</span></span>
        <div class="t-chips" id="pf_subjects">${SUBJECTS.map(s => `<button type="button" aria-pressed="${p.subject === s}">${s}</button>`).join('')}</div>
        <input type="text" id="pf_subject" maxlength="60" style="margin-top:8px" value="${esc(p.subject)}" placeholder="Or type your subject" aria-label="Subject"></div>
      <div><label class="lab" for="pf_org">School, university or channel <span class="opt">(optional)</span></label>
        <input type="text" id="pf_org" maxlength="120" autocomplete="organization" value="${esc(p.organization)}"></div>
      <div><span class="lab" style="display:block;font-weight:600;font-size:14px;margin-bottom:6px">Colour of your badge</span>
        <div class="t-colors" id="pf_colors">${COLORS.map(c => `<button type="button" style="background:${c}" data-c="${c}" aria-label="Colour ${c}" aria-pressed="${p.avatar_color === c}"></button>`).join('')}</div></div>
      <div class="t-preview" aria-live="polite" id="pf_preview"></div>
      <p class="t-err" id="pf_err" hidden></p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><button class="btn primary" type="submit" id="pf_save">${esc(opts && opts.submitLabel || 'Save')}</button>${opts && opts.secondary || ''}</div>
    </form>`;
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
      $('#pf_preview').innerHTML = `${avatar(v, email, 44)}<div><b>${esc(v.display_name || 'Your name')}</b><span>${esc([roleLabel(v.role), v.subject, v.organization].filter(Boolean).join(' · ') || 'This is how you appear on shared decks')}</span></div>`;
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

  window.TraceUI = { avatar, planTable, profileForm, initials, ROLES, isComplete: p => !!(p && p.display_name && p.role) };
})();
