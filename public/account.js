/* Sign up (/signup), sign in (/login) and your account (/account).
   People sign in with email + password, an email link, or Google / GitHub (when switched on in config.js).
   Forgotten passwords are reset by email (/login?reset=1). After the first sign-in people fill in a short profile;
   their projects are saved online only once it is complete (the database enforces this too). */
(function () {
  'use strict';
  const CFG = window.TRACE_CONFIG || {};
  const mode = document.body.dataset.mode;               // 'signup' | 'login' | 'account'
  const main = document.getElementById('main');
  const params = new URLSearchParams(location.search);
  function supportMail() { return ((window.TRACE_CONFIG || {}).supportEmail || '').replace(/[^\w.@+-]/g, ''); }
  function helpLine() { const a = supportMail(); return a ? ` If it keeps happening, write to <a href="mailto:${a}">${a}</a>.` : ''; }
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

  /* ---------- signed out: email + password, an email link, or Google / GitHub ---------- */
  const SPLIT = document.body.classList.contains('auth2');
  const panel = wide => { if (SPLIT) main.classList.toggle('wide', !!wide); };
  const kicker = t => { const k = document.getElementById('brandKicker'); if (k) k.textContent = t; };
  const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  const GITHUB = '<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
  const LOCK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>';
  // which buttons to show: config.js → signInWith: { google: true, github: true } (googleSignIn: true still works)
  const SOCIAL = [['google', 'Google', GOOGLE_G], ['github', 'GitHub', GITHUB]]
    .filter(([k]) => (CFG.signInWith || {})[k] || (k === 'google' && CFG.googleSignIn));
  const nq = next !== '/app' ? '?next=' + encodeURIComponent(next) : '';
  const backTo = signup => `${location.origin}/${signup ? 'signup' : 'login'}${nq}`;
  const $ = id => document.getElementById(id);
  const MIN_PW = 8;
  // the method people used last time on this device: 'password' or 'link'
  let method = (() => { try { return localStorage.getItem('trace-auth-method') === 'link' ? 'link' : 'password'; } catch (_) { return 'password'; } })();
  const remember = m => { method = m; try { localStorage.setItem('trace-auth-method', m); } catch (_) {} };

  // A link that failed (expired, already used) comes back with ?error=… or #error=…
  const linkError = (() => {
    const h = new URLSearchParams(location.hash.slice(1));
    const code = params.get('error_code') || h.get('error_code') || params.get('error') || h.get('error');
    if (!code) return '';
    history.replaceState(null, '', location.pathname + nq);
    return /expired|otp/i.test(code + (params.get('error_description') || h.get('error_description') || ''))
      ? 'That link has expired or was already used. Ask for a new one below.'
      : 'That sign-in did not work. Please try again.';
  })();

  function authError(error, signup) {
    const m = String(error && error.message || ''), code = String(error && (error.code || error.error_code) || '');
    if (error && error.status === 429 || /rate limit|too many/i.test(m)) return 'Too many attempts just now. Please wait a minute and try again.';
    if (/already registered|already exists|user_already_exists/i.test(m + code)) return `An account with this email already exists. <a href="/login${nq}">Sign in</a> instead, or use “Forgot password?” there.`;
    if (/invalid login credentials|invalid_credentials/i.test(m + code)) return 'Wrong email or password. If you usually sign in with an email link, Google or GitHub, use that, or reset your password.';
    if (/not confirmed|email_not_confirmed/i.test(m + code)) return 'Please confirm your email first: open the link we sent when you created the account.';
    if (/pwned|leaked|known to be weak/i.test(m + code)) return 'This password has appeared in a data leak elsewhere. Please choose a different one.';
    if (/same_password|different from the old/i.test(m + code)) return 'Your new password must be different from the old one.';
    if (/weak_password|password should|at least \d+ char/i.test(m + code)) return `This password is too weak. Use at least ${MIN_PW} characters, mixing words, numbers or symbols.`;
    if (/signups not allowed|not found|user not found|otp_disabled/i.test(m + code)) return signup ? 'New accounts are not open right now.' + helpLine() : `There is no account with this email yet. <a href="/signup${nq}">Create one</a>.`;
    if (/sending|smtp|email/i.test(m)) return `The email could not be sent. Please try again in a few minutes.${helpLine()}<small class="muted" style="display:block;margin-top:4px">Details for the site owner: ${esc(m)}${error.status ? ' (' + error.status + ')' : ''}</small>`;
    return 'Something went wrong: ' + esc(m) + helpLine();
  }

  // password field with a show/hide button and, for new passwords, a strength meter
  function pwField(id, label, kind, extra) {
    const isNew = kind === 'new';
    return `<div class="field"><div class="lab-row"><label class="lab" for="${id}">${label}</label>${extra || ''}</div>
      <div class="pw"><input type="password" id="${id}" autocomplete="${isNew ? 'new-password' : 'current-password'}" ${isNew ? `minlength="${MIN_PW}" aria-describedby="${id}Help"` : ''} required spellcheck="false">
      <button type="button" class="pw-eye" data-eye="${id}" aria-label="Show password" aria-pressed="false">Show</button></div>
      ${isNew ? `<div class="pw-meter" id="${id}Meter" data-s="0" aria-hidden="true"><i></i><i></i><i></i><i></i></div><p class="hint" id="${id}Help">At least ${MIN_PW} characters. A short sentence is easy to remember and hard to guess.</p>` : ''}</div>`;
  }
  function pwScore(p) {
    if (!p) return 0;
    let s = p.length >= MIN_PW ? 1 : 0;
    if (p.length >= 12) s++;
    if (/[a-z]/.test(p) + /[A-Z]/.test(p) + /\d/.test(p) + /[^A-Za-z0-9]/.test(p) >= 3) s++;
    if (p.length >= 16 || (s >= 2 && /\s/.test(p))) s++;
    if (/^(.)\1+$|password|123456|qwerty|azerty|letmein/i.test(p)) s = Math.min(s, 1);
    return Math.min(s, 4);
  }
  function wirePw(root) {
    root.querySelectorAll('[data-eye]').forEach(b => b.onclick = () => {
      const i = $(b.dataset.eye), show = i.type === 'password';
      i.type = show ? 'text' : 'password';
      b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-pressed', String(show)); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      i.focus();
    });
    root.querySelectorAll('.pw-meter').forEach(m => {
      const i = $(m.id.replace(/Meter$/, '')), help = $(i.id + 'Help');
      const words = ['', 'Weak', 'Fair', 'Good', 'Strong'];
      i.addEventListener('input', () => {
        const s = pwScore(i.value);
        m.dataset.s = i.value ? String(Math.max(1, s)) : '0';
        help.textContent = !i.value ? `At least ${MIN_PW} characters. A short sentence is easy to remember and hard to guess.`
          : i.value.length < MIN_PW ? `${MIN_PW - i.value.length} more character${MIN_PW - i.value.length > 1 ? 's' : ''} to go.`
          : `Strength: ${words[Math.max(1, s)]}.${s < 3 ? ' Longer is stronger.' : ''}`;
      });
    });
  }
  const busy = (btn, on, text) => { btn.disabled = on; if (text) btn.textContent = text; btn.setAttribute('aria-busy', String(on)); };
  const showErr = (el, html) => { el.innerHTML = html; el.hidden = !html; };

  function emailStep(prefill, note) {
    const signup = mode === 'signup', link = method === 'link';
    panel(false); kicker(signup ? 'Create your free account' : 'Welcome back');
    const label = signup ? (link ? 'Email me a sign-up link' : 'Create account') : (link ? 'Email me a sign-in link' : 'Sign in');
    main.innerHTML = `
      <nav class="auth-tabs" aria-label="Account">
        <a href="/signup${nq}"${signup ? ' aria-current="page"' : ''}>Create account</a>
        <a href="/login${nq}"${signup ? '' : ' aria-current="page"'}>Sign in</a>
      </nav>
      <h1>${signup ? 'Start making slides that move' : 'Sign in to Tracé'}</h1>
      <p class="auth-sub">${signup ? 'Free account: save your decks online, open them on any device and share them with a link.' : 'Welcome back. Your decks are waiting.'}</p>
      <div id="flash" class="flash${note ? ' warn' : ''}"${note ? '' : ' hidden'}>${note ? esc(note) : ''}</div>
      ${SOCIAL.length ? `<div class="social">${SOCIAL.map(([k, n, ic]) => `<button class="btn social-btn" type="button" data-provider="${k}">${ic}<span>Continue with ${n}</span></button>`).join('')}</div>
        <div class="or"><span>or with your email</span></div>` : ''}
      <form id="emailForm" class="t-form" novalidate>
        <div class="field"><label class="lab" for="email">Email</label>
          <input type="email" inputmode="email" id="email" autocomplete="${link ? 'email' : 'username'}" placeholder="you@school.edu" required value="${esc(prefill || '')}" spellcheck="false"></div>
        ${link ? '' : pwField('password', 'Password', signup ? 'new' : 'current', signup ? '' : '<button type="button" class="linkbtn" id="forgot">Forgot password?</button>')}
        <p class="t-err" id="emailErr" role="alert" hidden></p>
        <button class="btn primary big" type="submit" id="sendBtn">${label}</button>
      </form>
      <button type="button" class="linkbtn alt-method" id="altMethod">${link ? 'Use a password instead' : `Email me a ${signup ? 'sign-up' : 'sign-in'} link instead`}</button>
      ${link ? `<p class="auth-note">${LOCK}<span>No password needed: we email you a secure link that signs you in.</span></p>` : ''}
      <p class="switch">${signup ? `Already have an account? <a href="/login${nq}">Sign in</a>` : `New to Tracé? <a href="/signup${nq}">Create a free account</a>`}</p>
      ${signup ? `<p class="fine">By creating an account you accept the <a href="/terms">terms</a> and the <a href="/privacy">privacy policy</a>.</p>
      <details class="plans-peek"><summary>What is free, what is Pro</summary>${TraceUI.planTable()}<p class="fine">Pro is ${esc((CFG.priceLabels && CFG.priceLabels.monthly) || '$8 a month')}. You can upgrade any time from the editor.</p></details>` : ''}`;
    wirePw(main);
    const form = $('emailForm'), err = $('emailErr');
    const emailVal = () => $('email').value.trim();
    $('altMethod').onclick = () => { remember(link ? 'password' : 'link'); emailStep(emailVal()); };
    const f = $('forgot'); if (f) f.onclick = () => forgotStep(emailVal());
    main.querySelectorAll('[data-provider]').forEach(b => b.onclick = async () => {
      busy(b, true);
      const { error } = await sb.auth.signInWithOAuth({ provider: b.dataset.provider, options: { redirectTo: backTo(signup) } });
      if (error) { busy(b, false); showErr(err, authError(error, signup)); }
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const email = emailVal(), pwEl = $('password'), pw = pwEl ? pwEl.value : '';
      showErr(err, '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr(err, 'Please enter a valid email address.'); $('email').focus(); return; }
      if (!link && !pw) { showErr(err, 'Please enter your password.'); pwEl.focus(); return; }
      if (!link && signup && pw.length < MIN_PW) { showErr(err, `Please use at least ${MIN_PW} characters for your password.`); pwEl.focus(); return; }
      const btn = $('sendBtn');
      busy(btn, true, link ? 'Sending…' : signup ? 'Creating your account…' : 'Signing in…');
      let error, data;
      if (link) ({ error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: backTo(signup), shouldCreateUser: signup } }));
      else if (signup) ({ data, error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: backTo(true) } }));
      else ({ data, error } = await sb.auth.signInWithPassword({ email, password: pw }));
      if (error) {
        busy(btn, false, label);
        showErr(err, authError(error, signup));
        if (/not confirmed|email_not_confirmed/i.test(String(error.message) + String(error.code))) {
          err.insertAdjacentHTML('beforeend', ' <button type="button" class="linkbtn" id="resendConfirm">Send the confirmation email again</button>');
          $('resendConfirm').onclick = async () => { await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: backTo(true) } }); sentStep(email, 'confirm'); };
        }
        return;
      }
      remember(link ? 'link' : 'password');
      if (link) return sentStep(email, 'link');
      if (signup && data && data.user && Array.isArray(data.user.identities) && !data.user.identities.length) {
        busy(btn, false, label); return showErr(err, authError({ message: 'already registered' }, true));   // Supabase hides existing accounts this way
      }
      if (signup && !(data && data.session)) return sentStep(email, 'confirm');   // "Confirm email" is on in Supabase
      btn.textContent = 'Opening Tracé…';   // signed in: onAuthStateChange takes over
    });
    setTimeout(() => { const el = prefill && $('password') ? $('password') : $('email'); el && el.focus(); }, 30);
  }

  function forgotStep(prefill) {
    panel(false); kicker('Reset your password');
    main.innerHTML = `
      <button type="button" class="linkbtn back-link" id="backBtn">← Back to sign in</button>
      <h1>Reset your password</h1>
      <p class="auth-sub">Enter the email of your account. We’ll send you a link to choose a new password.</p>
      <form id="forgotForm" class="t-form" novalidate>
        <div class="field"><label class="lab" for="email">Email</label>
          <input type="email" inputmode="email" id="email" autocomplete="email" placeholder="you@school.edu" required value="${esc(prefill || '')}" spellcheck="false"></div>
        <p class="t-err" id="emailErr" role="alert" hidden></p>
        <button class="btn primary big" type="submit" id="resetBtn">Send the reset link</button>
      </form>`;
    $('backBtn').onclick = () => emailStep($('email').value.trim());
    $('forgotForm').addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('email').value.trim(), err = $('emailErr'), btn = $('resetBtn');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr(err, 'Please enter a valid email address.'); return; }
      busy(btn, true, 'Sending…');
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/login?reset=1${next !== '/app' ? '&next=' + encodeURIComponent(next) : ''}` });
      if (error) { busy(btn, false, 'Send the reset link'); return showErr(err, authError(error, false)); }
      sentStep(email, 'reset');
    });
    setTimeout(() => $('email').focus(), 30);
  }

  // after following a reset link: signed in for a moment, choose the new password
  function newPasswordStep() {
    panel(false); kicker('Reset your password');
    main.innerHTML = `
      <h1>Choose a new password</h1>
      <p class="auth-sub">For <span class="email-pill">${esc(user.email)}</span></p>
      <form id="newPwForm" class="t-form" novalidate>
        <input type="email" autocomplete="username" value="${esc(user.email)}" hidden readonly>
        ${pwField('newPassword', 'New password', 'new')}
        <p class="t-err" id="emailErr" role="alert" hidden></p>
        <button class="btn primary big" type="submit" id="savePw">Save the new password</button>
      </form>`;
    wirePw(main);
    $('newPwForm').addEventListener('submit', async e => {
      e.preventDefault();
      const pw = $('newPassword').value, err = $('emailErr'), btn = $('savePw');
      if (pw.length < MIN_PW) { showErr(err, `Please use at least ${MIN_PW} characters.`); return; }
      busy(btn, true, 'Saving…');
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) { busy(btn, false, 'Save the new password'); return showErr(err, authError(error, false)); }
      remember('password');
      main.innerHTML = `<div class="sent-mail ok" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
        <h1>Password saved</h1><p class="auth-sub">You can now sign in with your email and this password.</p>
        <a class="btn primary big" href="${esc(next)}" id="continueBtn">Continue</a>`;
      history.replaceState(null, '', location.pathname + nq);
      resetDone = true; shown = 'reset-done';
      if (!TraceUI.isComplete(profile)) setTimeout(profileStep, 1400);
    });
    setTimeout(() => $('newPassword').focus(), 30);
  }

  const MAIL_APPS = [
    [/@(gmail|googlemail)\./i, 'Open Gmail', 'https://mail.google.com/mail/u/0/#inbox'],
    [/@(outlook|hotmail|live|msn)\./i, 'Open Outlook', 'https://outlook.live.com/mail/'],
    [/@yahoo\./i, 'Open Yahoo Mail', 'https://mail.yahoo.com/'],
    [/@(icloud|me|mac)\./i, 'Open iCloud Mail', 'https://www.icloud.com/mail'],
    [/@(proton\.me|protonmail\.)/i, 'Open Proton Mail', 'https://mail.proton.me/'],
  ];
  // kind: 'link' (sign-in link), 'confirm' (confirm a new account), 'reset' (password reset)
  function sentStep(email, kind) {
    kind = kind || 'link';
    panel(false); kicker('Almost there');
    const app = MAIL_APPS.find(a => a[0].test(email));
    const what = kind === 'confirm' ? 'confirm your email and finish creating your account'
      : kind === 'reset' ? 'choose a new password'
      : mode === 'signup' ? 'finish creating your account' : 'sign in';
    main.innerHTML = `
      <div class="sent-mail" aria-hidden="true"><svg viewBox="0 0 48 48" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><rect x="6" y="11" width="36" height="26" rx="4"/><path d="M8 14l16 12 16-12"/></svg></div>
      <h1>Check your inbox</h1>
      <p class="auth-sub">We sent ${kind === 'reset' ? 'a password reset link' : kind === 'confirm' ? 'a confirmation link' : 'a link'} to <span class="email-pill">${esc(email)}</span><br>Open it <b>in this browser</b> to ${what}.</p>
      ${app ? `<div class="mail-apps"><a class="btn primary big" href="${app[2]}" target="_blank" rel="noopener">${app[1]}</a></div>` : ''}
      <div class="row-btns"><button class="btn" id="resend" disabled>Send it again (30)</button><button class="btn" id="other">${kind === 'reset' ? 'Back to sign in' : 'Use another email'}</button></div>
      <p class="t-err" id="resendMsg" hidden></p>
      <div class="tips"><b>No email after a minute?</b><ul><li>Look in your spam or promotions folder.</li><li>Check the address above for a typo.</li><li>School email can be slow: a personal address often arrives faster.</li>${kind === 'reset' ? '<li>If you created your account with Google or GitHub, sign in with that button instead.</li>' : ''}${supportMail() ? `<li>Still nothing? Write to <a href="mailto:${supportMail()}">${supportMail()}</a>.</li>` : ''}</ul></div>`;
    let left = 30;
    const r = $('resend');
    const tick = setInterval(() => { left--; r.textContent = left > 0 ? `Send it again (${left})` : 'Send it again'; if (left <= 0) { r.disabled = false; clearInterval(tick); } }, 1000);
    r.onclick = async () => {
      r.disabled = true;
      const { error } = kind === 'confirm' ? await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: backTo(true) } })
        : kind === 'reset' ? await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/login?reset=1` })
        : await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: backTo(mode === 'signup'), shouldCreateUser: mode === 'signup' } });
      const m = $('resendMsg'); m.hidden = false; m.style.color = error ? '' : 'var(--ink)';
      m.textContent = error ? 'Could not send it again just now. Wait a minute and retry.' : 'Sent again. Use the newest email.';
      setTimeout(() => { r.disabled = false; }, 30000);
    };
    $('other').onclick = () => { clearInterval(tick); emailStep(email); };
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
    const meta = user.user_metadata || {};
    const start = Object.assign({}, profile, { display_name: profile.display_name || String(meta.full_name || meta.name || meta.user_name || '').slice(0, 60) });
    TraceUI.profileForm(document.getElementById('pf'), start, user.email, {
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
  const PROVIDER_NAMES = { email: 'Email and password', google: 'Google', github: 'GitHub' };
  async function accountView() {
    const [{ count }] = await Promise.all([sb.from('decks').select('id', { count: 'exact', head: true })]);
    const pro = profile.plan === 'pro', FREE = CFG.freeDecks || 3, n = count ?? 0;
    const role = (TraceUI.ROLES.find(r => r[0] === profile.role) || [, ''])[1];
    const pastDue = profile.subscription_status === 'past_due';
    const gift = TraceUI.isGift(profile);
    const promoParam = (params.get('promo') || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
    const renew = profile.plan_renews_at ? new Date(profile.plan_renews_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const ids = (user.identities || []).map(i => i.provider).filter((p, i, a) => a.indexOf(p) === i);
    const ways = [...(ids.includes('email') ? ['Email and password'] : []), 'Email link', ...ids.filter(p => p !== 'email').map(p => PROVIDER_NAMES[p] || p)];
    main.innerHTML = `
      <div class="acct-head">${TraceUI.avatar(profile, user.email, 56)}<div><h1>${esc(profile.display_name)}</h1>
        <p class="muted">${esc([role, profile.subject, profile.organization].filter(Boolean).join(' · '))}</p></div>
        <span class="plan-badge${pro ? ' pro' : ''}">${pro ? 'Pro' : 'Free plan'}</span></div>
      <div id="flash" class="flash" hidden></div>
      <nav class="acct-nav" aria-label="Account sections"><a href="#plan">Plan and billing</a><a href="#profile">Profile</a><a href="#security">Sign-in and security</a><a href="#danger">Account</a></nav>

      <section class="acct-sec" id="plan"><h2>Plan and billing</h2>
        ${pastDue ? `<div class="flash warn" style="margin-bottom:14px"><b>Your last payment did not go through.</b> Update your card in Manage billing so Pro keeps working.</div>` : ''}
        <div class="bill-card${pro ? ' is-pro' : ''}">
          <div class="bill-main">
            <p class="bill-plan">${pro ? '<span class="pro-tag">PRO</span> Tracé Pro' : 'Free plan'}</p>
            ${gift ? `<p class="muted">Free with code <b>${esc(profile.comp_code || '')}</b> until ${esc(TraceUI.longDate(profile.comp_until))} · ${n} project${n === 1 ? '' : 's'} saved online</p>`
              : pro ? `<p class="muted">${pastDue ? 'Payment needs attention' : renew ? (profile.subscription_status === 'canceled' ? 'Ends on ' : 'Renews on ') + esc(renew) : 'Active'} · ${n} project${n === 1 ? '' : 's'} saved online</p>`
              : `<p class="muted">${n > FREE ? `${n} projects saved online. The free plan keeps ${FREE}: you can keep and edit them all, but not add new ones online.` : `${n} of ${FREE} projects saved online. The free plan keeps ${FREE} projects online.`}</p>
                 <div class="meter" role="progressbar" aria-label="Projects saved online" aria-valuemin="0" aria-valuemax="${FREE}" aria-valuenow="${Math.min(n, FREE)}"><i style="width:${Math.min(100, Math.round(n / FREE * 100))}%"></i></div>`}
          </div>
          <div class="bill-actions">${gift ? '<a class="btn primary" href="/app?upgrade=1" id="upgradeLink">Keep Pro after that</a>' : pro && profile.paddle_customer_id ? '<button class="btn primary" id="billing">Manage billing</button>' : pro ? '' : '<a class="btn primary" href="/app?upgrade=1" id="upgradeLink">Upgrade to Pro</a>'}</div>
        </div>
        ${gift ? `<p class="fine bill-help">When the free period ends, your account goes back to the Free plan by itself: nothing is charged and no deck is deleted.</p>`
          : pro ? `<p class="fine bill-help">In <b>Manage billing</b> you can update your card, download invoices, switch between monthly and yearly, or cancel. Payments are handled securely by Paddle.</p>`
          : `<div class="pro-peek"><p class="pro-peek-h">With Pro you also get</p><ul class="ticks">${window.TRACE_PLANS.proOnly.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
             <p class="fine">${esc((CFG.priceLabels && CFG.priceLabels.monthly) || '')}${CFG.priceLabels && CFG.priceLabels.yearly ? ' · or ' + esc(CFG.priceLabels.yearly) : ''}. Cancel any time.</p></div>`}
        ${pro ? '' : `<details class="plans-peek" id="promo"${promoParam ? ' open' : ''}><summary>Have a promo code?</summary><div id="promoBox" style="margin-top:12px"></div></details>`}
        <details class="plans-peek"><summary>Compare Free and Pro</summary>${TraceUI.planTable(profile.plan)}</details>
      </section>

      <section class="acct-sec" id="profile"><h2>Profile</h2><p class="muted sec-sub">Shown on decks you share.</p><div id="pf"></div></section>

      <section class="acct-sec" id="security"><h2>Sign-in and security</h2>
        <div class="kv"><span>Email</span><b>${esc(user.email)}</b></div>
        <div class="kv"><span>Ways to sign in</span><span class="chips">${ways.map(w => `<span class="chip">${esc(w)}</span>`).join('')}</span></div>
        <form id="pwForm" class="t-form pw-form" novalidate>
          <input type="email" autocomplete="username" value="${esc(user.email)}" hidden readonly>
          <p class="pw-form-h"><b>${ids.includes('email') ? 'Change your password' : 'Set a password'}</b><span class="muted">${ids.includes('email') ? 'Choose a new password for signing in with your email.' : 'Add a password to sign in with your email and password, as well as the ways above.'}</span></p>
          ${pwField('acctPw', 'New password', 'new')}
          <p class="t-err" id="pwErr" role="alert" hidden></p>
          <div><button class="btn" type="submit" id="pwSave">Save password</button></div>
        </form>
      </section>

      <section class="acct-sec" id="danger"><h2>Account</h2>
        <div class="row-btns"><a class="btn" href="/app">Open the editor</a><button class="btn" id="signout">Sign out</button></div>
        <details class="danger-zone"><summary>Delete my account</summary>
          <p>This deletes your account and every project saved in it, including share links. Projects kept only in your browser stay there. This cannot be undone.${pro ? ' Cancel Pro in <b>Manage billing</b> first.' : ''}</p>
          <label class="check"><input type="checkbox" id="delOk"> I understand that my online projects will be deleted</label>
          <button class="btn danger" id="delBtn" disabled>Delete my account</button><p class="t-err" id="delErr" hidden></p></details>
      </section>`;
    TraceUI.profileForm(document.getElementById('pf'), profile, user.email, {
      submitLabel: 'Save changes',
      onSubmit: async v => { await saveProfile(v); say('Profile saved.', 'ok'); renderHeaderUser(); refreshHead(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    });
    wirePw(main);
    if ($('promoBox')) TraceUI.promoForm($('promoBox'), sb, async until => {
      const fresh = await TraceUI.fetchProfile(sb, user.id, 'display_name,role,subject,organization,avatar_color,plan,subscription_status,plan_renews_at,paddle_customer_id');
      if (fresh) profile = fresh;
      if (promoParam) history.replaceState(null, '', location.pathname);
      setTimeout(async () => { await accountView(); renderHeaderUser(); say(`Code accepted: Pro is on until ${esc(TraceUI.longDate(until))}. Enjoy!`, 'ok'); }, 1200);
    }, promoParam);
    $('pwForm').addEventListener('submit', async e => {
      e.preventDefault();
      const pw = $('acctPw').value, err = $('pwErr'), btn = $('pwSave');
      showErr(err, '');
      if (pw.length < MIN_PW) { showErr(err, `Please use at least ${MIN_PW} characters.`); $('acctPw').focus(); return; }
      busy(btn, true, 'Saving…');
      const { error } = await sb.auth.updateUser({ password: pw });
      busy(btn, false, 'Save password');
      if (error) return showErr(err, /reauthentication/i.test(error.message + (error.code || '')) ? 'For your security, sign out and use “Forgot password?” on the sign-in page to set it.' : authError(error, false));
      remember('password');
      const { data: fresh } = await sb.auth.getUser();
      if (fresh && fresh.user) user = fresh.user;
      await accountView();
      say('Password saved. You can now sign in with your email and password.', 'ok'); window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    const b = document.getElementById('billing');
    if (b) b.onclick = async () => {
      busy(b, true, 'Opening…');
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch('/api/billing-portal', { method: 'POST', headers: { authorization: 'Bearer ' + session.access_token } }).catch(() => null);
      const out = res ? await res.json().catch(() => ({})) : {};
      busy(b, false, 'Manage billing');
      if (out.url) location.href = out.url; else say(esc(out.error || 'The billing page is not available right now.') + helpLine(), 'warn');
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
  function refreshHead() {
    const h = main.querySelector('.acct-head'); if (!h) return;
    const role = (TraceUI.ROLES.find(r => r[0] === profile.role) || [, ''])[1];
    h.querySelector('.t-avatar').outerHTML = TraceUI.avatar(profile, user.email, 56);
    h.querySelector('h1').textContent = profile.display_name;
    h.querySelector('p.muted').textContent = [role, profile.subject, profile.organization].filter(Boolean).join(' · ');
  }

  let leaving = false;
  async function signOut() {
    leaving = true;
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
  let shown = '', resetDone = false;
  const wantsReset = mode === 'login' && params.get('reset') === '1';
  async function route(session) {
    user = session ? session.user : null;
    let p = null;   // keep the current profile until the new one has loaded (USER_UPDATED fires mid-page)
    if (user) {
      p = await TraceUI.fetchProfile(sb, user.id, 'display_name,role,subject,organization,avatar_color,plan,subscription_status,plan_renews_at,paddle_customer_id') || { plan: 'free' };
    }
    profile = p;
    renderHeaderUser();
    if (shown === 'reset-done') return;
    const state = !user ? 'out' : wantsReset && !resetDone ? 'reset' : !TraceUI.isComplete(profile) ? 'profile' : 'in';
    if (state === shown) return;
    shown = state;
    if (state === 'out') { if (leaving) return; if (mode === 'account') { location.replace('/login?next=' + encodeURIComponent('/account' + location.search)); return; } emailStep('', linkError || (wantsReset ? 'That reset link has expired or was already used. Ask for a new one with “Forgot password?”.' : '')); }
    else if (state === 'reset') newPasswordStep();
    else if (state === 'profile') profileStep();
    else if (mode === 'account') accountView();
    else location.replace(next);
  }
  // clean the one-time code out of the address once Supabase has used it
  sb.auth.onAuthStateChange((ev, s) => {
    if (params.get('code')) history.replaceState(null, '', location.pathname + '?' + [wantsReset && !resetDone ? 'reset=1' : '', params.get('next') ? 'next=' + encodeURIComponent(params.get('next')) : ''].filter(Boolean).join('&'));
    setTimeout(() => route(s), 0);
  });
  sb.auth.getSession().then(({ data }) => route(data.session));
  window.__traceAccount = { sb };
})();
