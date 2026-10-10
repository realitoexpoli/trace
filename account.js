/* Sign up (/signup), sign in (/login) and your account (/account).
   Sign-in is by email link: no password. After the first sign-in people fill in a short profile;
   their projects are saved online only once it is complete (the database enforces this too). */
(function () {
  'use strict';
  const CFG = window.TRACE_CONFIG || {};
  const mode = document.body.dataset.mode;               // 'signup' | 'login' | 'account'
  const main = document.getElementById('main');
  const params = new URLSearchParams(location.search);
  const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // only go back to a page of this site
  const next = (n => (n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\')) ? n : '/app')(params.get('next'));
  const ON = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase);

  if (!ON) {
    main.innerHTML = `<div class="auth-card"><h1>Accounts are not set up yet</h1><p class="muted">${window.supabase
      ? 'The site owner still needs to add the Supabase URL and public key to <code>config.js</code>.'
      : 'The sign-in service could not load. Check your internet connection and reload the page.'}</p>
      <p><a class="btn" href="/app">Open the editor without an account</a></p></div>`;
    return;
  }
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });

  let user = null, profile = null;
  const say = (html, kind) => { const m = document.getElementById('flash'); if (!m) return; m.className = 'flash ' + (kind || ''); m.innerHTML = html; m.hidden = !html; };

  /* ---------- signed out: the email form ---------- */
  function emailStep() {
    const signup = mode === 'signup';
    main.innerHTML = `<div class="auth-grid${signup ? '' : ' single'}">
      <div class="auth-card">
        <h1>${signup ? 'Create your Tracé account' : 'Sign in to Tracé'}</h1>
        <p class="muted">${signup ? 'Free, with no password to remember. We email you a link that signs you in.' : 'Enter the email you signed up with. We email you a link that signs you in.'}</p>
        <form id="emailForm" class="t-form" novalidate>
          <div><label class="lab" for="email">Email</label>
          <input type="text" inputmode="email" id="email" autocomplete="email" placeholder="you@school.edu" required></div>
          <p class="t-err" id="emailErr" hidden></p>
          <button class="btn primary wide" type="submit" id="sendBtn">${signup ? 'Email me a sign-up link' : 'Email me a sign-in link'}</button>
        </form>
        ${CFG.googleSignIn ? '<div class="or"><span>or</span></div><button class="btn wide" id="googleBtn" type="button">Continue with Google</button>' : ''}
        <p class="switch">${signup ? `Already have an account? <a href="/login${location.search}">Sign in</a>` : `New to Tracé? <a href="/signup${location.search}">Create an account</a>`}</p>
        ${signup ? '<p class="fine">By creating an account you accept the <a href="/terms">terms</a> and the <a href="/privacy">privacy policy</a>.</p>' : ''}
      </div>
      ${signup ? `<aside class="auth-side"><h2>What you get</h2><p class="muted">Every animation and every object is free. Pro is for people who keep many decks online and share them.</p>${TraceUI.planTable()}<p class="muted fine">Pro is $8 a month or $72 a year. You can upgrade later from the editor.</p></aside>` : ''}
    </div>`;
    const form = document.getElementById('emailForm'), err = document.getElementById('emailErr');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      err.hidden = true;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Please enter a valid email address.'; err.hidden = false; return; }
      const btn = document.getElementById('sendBtn'); btn.disabled = true; btn.textContent = 'Sending…';
      const back = `${location.origin}/${signup ? 'signup' : 'login'}${next !== '/app' ? '?next=' + encodeURIComponent(next) : ''}`;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: back, shouldCreateUser: signup } });
      btn.disabled = false; btn.textContent = signup ? 'Email me a sign-up link' : 'Email me a sign-in link';
      if (error) {
        const m = String(error.message || '');
        err.innerHTML = /signups not allowed|not found|user not found/i.test(m) ? `There is no account with this email yet. <a href="/signup${location.search}">Create one</a>.`
          : error.status === 429 ? 'Too many emails were sent just now. Please wait a minute and try again.'
          : /sending|smtp|email/i.test(m) ? 'The email could not be sent. Please try again in a few minutes.'
          : 'Something went wrong: ' + esc(m);
        err.hidden = false; return;
      }
      sentStep(email);
    });
    const g = document.getElementById('googleBtn');
    if (g) g.onclick = () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/${signup ? 'signup' : 'login'}${next !== '/app' ? '?next=' + encodeURIComponent(next) : ''}` } });
    setTimeout(() => document.getElementById('email').focus(), 30);
  }

  function sentStep(email) {
    main.innerHTML = `<div class="auth-grid single"><div class="auth-card">
      <div class="mailmark" aria-hidden="true"><svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="11" width="36" height="26" rx="3"/><path d="M7 13l17 13 17-13"/></svg></div>
      <h1>Check your inbox</h1>
      <p>We sent a link to <b>${esc(email)}</b>. Open it <b>in this browser</b> to continue.</p>
      <p class="muted">It can take a minute. Look in your spam folder if it does not arrive.</p>
      <div class="row-btns"><button class="btn" id="resend" disabled>Send it again (30)</button><button class="btn" id="other">Use another email</button></div>
      <p class="t-err" id="resendMsg" hidden></p></div></div>`;
    let left = 30;
    const r = document.getElementById('resend');
    const tick = setInterval(() => { left--; r.textContent = left > 0 ? `Send it again (${left})` : 'Send it again'; if (left <= 0) { r.disabled = false; clearInterval(tick); } }, 1000);
    r.onclick = async () => {
      r.disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/${mode === 'signup' ? 'signup' : 'login'}`, shouldCreateUser: mode === 'signup' } });
      const m = document.getElementById('resendMsg'); m.hidden = false; m.style.color = error ? '' : 'var(--ink)';
      m.textContent = error ? 'Could not send it again just now. Wait a minute and retry.' : 'Sent again.';
      setTimeout(() => { r.disabled = false; }, 30000);
    };
    document.getElementById('other').onclick = () => { clearInterval(tick); emailStep(); };
  }

  /* ---------- signed in, profile not finished ---------- */
  function profileStep() {
    main.innerHTML = `<div class="auth-grid single"><div class="auth-card wide-card">
      <p class="eyebrow">Step 2 of 2</p>
      <h1>Tell us a little about you</h1>
      <p class="muted">Your projects are saved online once your profile is complete. Your name appears on decks you share.</p>
      <div id="pf"></div></div></div>`;
    TraceUI.profileForm(document.getElementById('pf'), profile, user.email, {
      submitLabel: 'Save and open the editor',
      onSubmit: async v => { await saveProfile(v); location.href = next; },
    });
  }

  async function saveProfile(v) {
    const { data, error } = await sb.from('profiles').update(v).eq('id', user.id).select().maybeSingle();
    if (error) throw new Error(/check/i.test(error.message) ? 'One of the fields is not valid. Please check it.' : 'Could not save your profile. Check your connection and try again.');
    profile = data || Object.assign({}, profile, v);
    return profile;
  }

  /* ---------- your account ---------- */
  async function accountView() {
    const [{ count }] = await Promise.all([sb.from('decks').select('id', { count: 'exact', head: true })]);
    const pro = profile.plan === 'pro';
    const role = (TraceUI.ROLES.find(r => r[0] === profile.role) || [, ''])[1];
    main.innerHTML = `
      <div class="acct-head">${TraceUI.avatar(profile, user.email, 56)}<div><h1>${esc(profile.display_name)}</h1>
        <p class="muted">${esc([role, profile.subject, profile.organization].filter(Boolean).join(' · '))}</p></div>
        <span class="plan-badge${pro ? ' pro' : ''}">${pro ? 'Pro' : 'Free plan'}</span></div>
      <div id="flash" class="flash" hidden></div>
      <section class="acct-sec"><h2>Plan</h2>
        ${pro ? `<p>${profile.subscription_status === 'past_due' ? '<b>Your last payment did not go through.</b> Please update your card so Pro keeps working.' : profile.plan_renews_at ? 'Pro renews on ' + new Date(profile.plan_renews_at).toLocaleDateString() + '.' : 'You are on Pro.'} ${count ?? 0} projects saved online.</p>
          <div class="row-btns"><button class="btn primary" id="billing">Manage billing</button></div>`
        : `<p>${(count ?? 0) > (CFG.freeDecks || 3) ? `${count} projects saved online. The free plan keeps ${CFG.freeDecks || 3}: you can keep and edit them all, but not add new ones online.` : `${count ?? 0} of ${CFG.freeDecks || 3} projects saved online.`} Pro removes the limit and the badge on shared decks.</p>
          <div class="row-btns"><a class="btn primary" href="/app?upgrade=1">Upgrade to Pro</a></div>`}
        <div style="margin-top:16px">${TraceUI.planTable(profile.plan)}</div>
      </section>
      <section class="acct-sec"><h2>Profile</h2><div id="pf"></div></section>
      <section class="acct-sec"><h2>Account</h2>
        <p>Signed in as <b>${esc(user.email)}</b>.</p>
        <div class="row-btns"><a class="btn" href="/app">Open the editor</a><button class="btn" id="signout">Sign out</button></div>
        <details class="danger-zone"><summary>Delete my account</summary>
          <p>This deletes your account and every project saved in it, including share links. Projects kept only in your browser stay there. This cannot be undone.${pro ? ' Cancel Pro in <b>Manage billing</b> first.' : ''}</p>
          <label class="check"><input type="checkbox" id="delOk"> I understand that my online projects will be deleted</label>
          <button class="btn danger" id="delBtn" disabled>Delete my account</button><p class="t-err" id="delErr" hidden></p></details>
      </section>`;
    TraceUI.profileForm(document.getElementById('pf'), profile, user.email, {
      submitLabel: 'Save changes',
      onSubmit: async v => { await saveProfile(v); say('Profile saved.', 'ok'); renderHeaderUser(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    });
    const b = document.getElementById('billing');
    if (b) b.onclick = async () => {
      b.disabled = true;
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch('/api/billing-portal', { method: 'POST', headers: { authorization: 'Bearer ' + session.access_token } }).catch(() => null);
      const out = res ? await res.json().catch(() => ({})) : {};
      b.disabled = false;
      if (out.url) location.href = out.url; else say(esc(out.error || 'The billing page is not available right now.'), 'warn');
    };
    document.getElementById('signout').onclick = signOut;
    const ok = document.getElementById('delOk'), del = document.getElementById('delBtn');
    ok.onchange = () => { del.disabled = !ok.checked; };
    del.onclick = async () => {
      del.disabled = true;
      const { error } = await sb.rpc('delete_my_account');
      const e = document.getElementById('delErr');
      if (error) { e.textContent = /cancel_subscription_first/.test(error.message) ? 'Cancel Pro in Manage billing first, then delete the account.' : 'Could not delete the account: ' + error.message; e.hidden = false; del.disabled = false; return; }
      try { localStorage.setItem('trace-pending-signout', user.id); } catch (_) {}
      await sb.auth.signOut();
      location.href = '/?deleted=1';
    };
  }

  async function signOut() {
    // the editor removes this account's synced projects from the browser the next time it opens
    try { localStorage.setItem('trace-pending-signout', user.id); } catch (_) {}
    await sb.auth.signOut();
    location.href = '/login';
  }

  function renderHeaderUser() {
    const slot = document.getElementById('userSlot');
    if (!slot) return;
    slot.innerHTML = user && profile ? `<a href="/account" class="userlink" title="Your account">${TraceUI.avatar(profile, user.email, 30)}</a>` : '';
  }

  /* ---------- deciding what to show ---------- */
  let shown = '';
  async function route(session) {
    user = session ? session.user : null;
    profile = null;
    if (user) {
      const { data } = await sb.from('profiles').select('display_name,role,subject,organization,avatar_color,plan,subscription_status,plan_renews_at').eq('id', user.id).maybeSingle();
      profile = data || { plan: 'free' };
    }
    renderHeaderUser();
    const state = !user ? 'out' : !TraceUI.isComplete(profile) ? 'profile' : 'in';
    if (state === shown) return;
    shown = state;
    if (state === 'out') { if (mode === 'account') { location.replace('/login?next=/account'); return; } emailStep(); }
    else if (state === 'profile') profileStep();
    else if (mode === 'account') accountView();
    else location.replace(next);
  }
  // clean the one-time code out of the address once Supabase has used it
  sb.auth.onAuthStateChange((ev, s) => { if (params.get('code')) history.replaceState(null, '', location.pathname + (params.get('next') ? '?next=' + encodeURIComponent(params.get('next')) : '')); setTimeout(() => route(s), 0); });
  sb.auth.getSession().then(({ data }) => route(data.session));
  window.__traceAccount = { sb };
})();
