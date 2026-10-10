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
  const SPLIT = document.body.classList.contains('auth2');
  const panel = wide => { if (SPLIT) main.classList.toggle('wide', !!wide); };
  const kicker = t => { const k = document.getElementById('brandKicker'); if (k) k.textContent = t; };
  const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  const LOCK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>';
  const backTo = signup => `${location.origin}/${signup ? 'signup' : 'login'}${next !== '/app' ? '?next=' + encodeURIComponent(next) : ''}`;
  function emailStep(prefill) {
    const signup = mode === 'signup';
    panel(false); kicker(signup ? 'Create your free account' : 'Welcome back');
    const q = location.search;
    main.innerHTML = `
      <nav class="auth-tabs" aria-label="Account">
        <a href="/signup${q}"${signup ? ' aria-current="page"' : ''}>Create account</a>
        <a href="/login${q}"${signup ? '' : ' aria-current="page"'}>Sign in</a>
      </nav>
      <h1>${signup ? 'Start making slides that move' : 'Sign in to Tracé'}</h1>
      <p class="auth-sub">${signup ? 'Free account: save your decks online, open them on any device and share them with a link.' : 'Enter the email you signed up with. Your decks are waiting.'}</p>
      ${CFG.googleSignIn ? `<button class="btn google" id="googleBtn" type="button">${GOOGLE_G}Continue with Google</button><div class="or"><span>or with your email</span></div>` : ''}
      <form id="emailForm" class="t-form" novalidate>
        <div><label class="lab" for="email">Email</label>
        <input type="email" inputmode="email" id="email" autocomplete="email" placeholder="you@school.edu" required value="${esc(prefill || '')}"></div>
        <p class="t-err" id="emailErr" hidden></p>
        <button class="btn primary big" type="submit" id="sendBtn">${signup ? 'Create my account' : 'Send me a sign-in link'}</button>
      </form>
      <p class="auth-note">${LOCK}<span>No password to remember: we email you a secure link that signs you in.</span></p>
      <p class="switch">${signup ? `Already have an account? <a href="/login${q}">Sign in</a>` : `New to Tracé? <a href="/signup${q}">Create a free account</a>`}</p>
      ${signup ? `<p class="fine">By creating an account you accept the <a href="/terms">terms</a> and the <a href="/privacy">privacy policy</a>.</p>
      <details class="plans-peek"><summary>What is free, what is Pro</summary>${TraceUI.planTable()}<p class="fine">Pro is ${esc((CFG.priceLabels && CFG.priceLabels.monthly) || '$8 a month')}. You can upgrade any time from the editor.</p></details>` : ''}`;
    const form = document.getElementById('emailForm'), err = document.getElementById('emailErr');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      err.hidden = true;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Please enter a valid email address.'; err.hidden = false; document.getElementById('email').focus(); return; }
      const btn = document.getElementById('sendBtn'); btn.disabled = true; btn.textContent = 'Sending…';
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: backTo(signup), shouldCreateUser: signup } });
      btn.disabled = false; btn.textContent = signup ? 'Create my account' : 'Send me a sign-in link';
      if (error) {
        const m = String(error.message || '');
        err.innerHTML = /signups not allowed|not found|user not found/i.test(m) ? `There is no account with this email yet. <a href="/signup${location.search}">Create one</a>.`
          : error.status === 429 ? 'Too many emails were sent just now. Please wait a minute and try again.'
          : /sending|smtp|email/i.test(m) ? `The email could not be sent. Please try again in a few minutes.<small class="muted" style="display:block;margin-top:4px">Details for the site owner: ${esc(m)}${error.status ? ' (' + error.status + ')' : ''}</small>`
          : 'Something went wrong: ' + esc(m);
        err.hidden = false; return;
      }
      sentStep(email);
    });
    const g = document.getElementById('googleBtn');
    if (g) g.onclick = () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: backTo(signup) } });
    setTimeout(() => document.getElementById('email').focus(), 30);
  }

  const MAIL_APPS = [
    [/@(gmail|googlemail)\./i, 'Open Gmail', 'https://mail.google.com/mail/u/0/#inbox'],
    [/@(outlook|hotmail|live|msn)\./i, 'Open Outlook', 'https://outlook.live.com/mail/'],
    [/@yahoo\./i, 'Open Yahoo Mail', 'https://mail.yahoo.com/'],
    [/@(icloud|me|mac)\./i, 'Open iCloud Mail', 'https://www.icloud.com/mail'],
    [/@(proton\.me|protonmail\.)/i, 'Open Proton Mail', 'https://mail.proton.me/'],
  ];
  function sentStep(email) {
    panel(false); kicker('Almost there');
    const app = MAIL_APPS.find(a => a[0].test(email));
    main.innerHTML = `
      <div class="sent-mail" aria-hidden="true"><svg viewBox="0 0 48 48" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><rect x="6" y="11" width="36" height="26" rx="4"/><path d="M8 14l16 12 16-12"/></svg></div>
      <h1>Check your inbox</h1>
      <p class="auth-sub">We sent a link to <span class="email-pill">${esc(email)}</span><br>Open it <b>in this browser</b> to ${mode === 'signup' ? 'finish creating your account' : 'sign in'}.</p>
      ${app ? `<div class="mail-apps"><a class="btn primary big" href="${app[2]}" target="_blank" rel="noopener">${app[1]}</a></div>` : ''}
      <div class="row-btns"><button class="btn" id="resend" disabled>Send it again (30)</button><button class="btn" id="other">Use another email</button></div>
      <p class="t-err" id="resendMsg" hidden></p>
      <div class="tips"><b>No email after a minute?</b><ul><li>Look in your spam or promotions folder.</li><li>Check the address above for a typo.</li><li>School email can be slow: a personal address often arrives faster.</li></ul></div>`;
    let left = 30;
    const r = document.getElementById('resend');
    const tick = setInterval(() => { left--; r.textContent = left > 0 ? `Send it again (${left})` : 'Send it again'; if (left <= 0) { r.disabled = false; clearInterval(tick); } }, 1000);
    r.onclick = async () => {
      r.disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: backTo(mode === 'signup'), shouldCreateUser: mode === 'signup' } });
      const m = document.getElementById('resendMsg'); m.hidden = false; m.style.color = error ? '' : 'var(--ink)';
      m.textContent = error ? 'Could not send it again just now. Wait a minute and retry.' : 'Sent again. Use the newest email.';
      setTimeout(() => { r.disabled = false; }, 30000);
    };
    document.getElementById('other').onclick = () => { clearInterval(tick); emailStep(email); };
  }

  /* ---------- signed in, profile not finished ---------- */
  function profileStep() {
    panel(true); kicker('One last step');
    main.innerHTML = `<div class="${SPLIT ? '' : 'auth-grid single'}"><div class="${SPLIT ? '' : 'auth-card wide-card'}">
      <div class="steps-dots" aria-hidden="true"><i class="on"></i><i class="on"></i></div>
      <p class="eyebrow">Step 2 of 2</p>
      <h1>Tell us a little about you</h1>
      <p class="${SPLIT ? 'auth-sub' : 'muted'}">Your projects are saved online once your profile is complete. Your name appears on decks you share.</p>
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
