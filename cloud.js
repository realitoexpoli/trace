/* Tracé cloud: accounts, decks saved online, share links and the Pro plan.
   Loaded after the editor (app.html). If config.js is empty, the editor works exactly as before,
   with projects kept in this browser only.

   How saving works
   - Every project still lives in this browser first, so editing never waits for the network.
   - When signed in, each change is copied to the account a couple of seconds later.
   - On sign-in, projects already on this device are added to the account (up to the plan limit),
     and decks saved from other devices appear in the project list; they download when opened.
   - If the same deck was changed on two devices, the most recent change wins.
   - Signing out removes the account's decks from this browser; they stay safe in the account. */
(function () {
  'use strict';
  const CFG = window.TRACE_CONFIG || {};
  const ON = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase);
  const sb = ON ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  }) : null;
  const $q = s => document.querySelector(s);
  const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const params = new URLSearchParams(location.search);
  const viewSlug = (location.pathname.match(/\/v\/([A-Za-z0-9_-]{6,40})\/?$/) || [])[1] || params.get('view');

  /* ---------- styles for the account menu, dialogs and viewer ---------- */
  const css = document.createElement('style');
  css.textContent = `
  .cloudstat{font-size:12px;color:var(--mute);margin:0 6px;white-space:nowrap;display:flex;align-items:center;gap:5px}
  .cloudstat[data-s="warn"]{color:var(--danger)}
  .cloudstat svg{width:14px;height:14px}
  #acctBtn .avatar{width:22px;height:22px;border-radius:50%;background:var(--pen);color:var(--pen-ink);display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}
  #acctBtn{display:flex;align-items:center;gap:6px}
  .acctmenu{min-width:260px}
  .acctmenu .who{padding:8px 10px 4px;font-size:12.5px;color:var(--mute);overflow:hidden;text-overflow:ellipsis}
  .acctmenu .plan{padding:0 10px 8px;font-weight:700}
  .acctmenu .plan small{font-weight:400;color:var(--mute);display:block}
  .acctmenu .up{color:var(--pen);font-weight:700}
  .pj .tag{font-size:11px;color:var(--mute);border:1px solid var(--line);border-radius:3px;padding:0 4px;margin-left:6px}
  #cloudModal{position:fixed;inset:0;background:rgba(12,14,13,.5);z-index:46;display:flex;align-items:center;justify-content:center;padding:16px}
  #cloudModal[hidden]{display:none}
  #cloudModal .dialog{width:min(460px,100%)}
  #cloudModal .body{gap:12px}
  #cloudModal h2{font-size:17px;margin:0}
  #cloudModal p{margin:0;color:var(--mute);font-size:13.5px}
  #cloudModal input[type=email],#cloudModal input[type=text]{width:100%;background:var(--desk);border:1px solid var(--line);border-radius:3px;padding:9px 10px;font-size:15px}
  #cloudModal .row{display:flex;gap:8px;align-items:center}
  #cloudModal .row input{flex:1;min-width:0}
  #cloudModal .btn{border-color:var(--line)}
  #cloudModal .wide{width:100%;padding:9px}
  #cloudModal .or{text-align:center;color:var(--mute);font-size:12px}
  #cloudModal .plans{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  #cloudModal .plans button{border:1px solid var(--line);background:var(--desk);border-radius:4px;padding:12px;text-align:left}
  #cloudModal .plans button:hover{border-color:var(--pen)}
  #cloudModal .plans b{display:block;font-size:15px}
  #cloudModal ul{margin:0;padding-left:18px;color:var(--ink);font-size:13.5px;line-height:1.6}
  #cloudModal label.sw2{display:flex;gap:10px;align-items:center;font-size:14px}
  #cloudModal .share-opts{border:1px solid var(--line);border-radius:4px;padding:8px 12px 10px;margin:0;display:grid;gap:6px}
  #cloudModal .share-opts legend{font-size:12.5px;color:var(--mute);padding:0 4px}
  #vhint{position:fixed;left:50%;transform:translateX(-50%);top:calc(14px + env(safe-area-inset-top,0px));background:#3B5BFD;color:#fff;font-size:14px;padding:8px 14px;border-radius:999px;z-index:60;box-shadow:0 8px 24px -8px rgba(0,0,0,.6);display:flex;gap:10px;align-items:center;max-width:92vw}
  #vhint[hidden]{display:none}
  #vhint button{background:none;border:0;color:#fff;font:inherit;font-size:16px;line-height:1;cursor:pointer;padding:0 2px;opacity:.85}
  #vcopy{position:fixed;right:96px;top:calc(12px + env(safe-area-inset-top,0px));background:rgba(255,255,255,.07);color:#cfd4d0;border:none;border-radius:3px;padding:6px 10px;z-index:56;font:inherit;font-size:13px;cursor:pointer}
  #vcopy:hover{background:rgba(255,255,255,.14)}
  .msg-ok{color:var(--ink)!important}
  .acct-choice{display:grid;gap:8px}
  #cloudModal .btn.wide{display:block;text-align:center;text-decoration:none}
  #cloudModal .fine{font-size:12.5px}
  #cloudModal .dialog{max-height:calc(100vh - 32px);overflow:auto}
  #cloudModal:has(#cloudPf) .dialog,#cloudModal:has(.t-plans) .dialog{width:min(620px,100%)}
  #cloudModal:has(.upg) .dialog{width:min(480px,100%)}
  .upg{display:grid;gap:14px}
  .upg-top{display:grid;gap:6px;justify-items:start}
  .upg-top h2{font-size:22px!important;letter-spacing:-.3px}
  #cloudModal .upg-why{font-size:14px}
  .upg-period{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;background:var(--desk);border:1px solid var(--line);border-radius:8px;padding:3px}
  .upg-period button{border:0;background:none;color:var(--mute);font:inherit;font-weight:600;font-size:14px;padding:8px 10px;border-radius:6px;cursor:pointer}
  .upg-period button[aria-checked="true"]{background:var(--paper);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.14)}
  .upg-period .save{font-size:11.5px;font-weight:700;color:#1d7a43;background:rgba(42,138,74,.13);border-radius:999px;padding:1px 7px;margin-left:4px}
  .upg-price{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 4px}
  .upg-price b{font-size:38px;letter-spacing:-1px;line-height:1.1}
  .upg-price span{color:var(--mute);font-size:15px}
  .upg-price small{flex-basis:100%;color:var(--mute);font-size:13px}
  #cloudModal ul.upg-list{list-style:none;padding:0;margin:0;display:grid;gap:7px;font-size:14px;line-height:1.45}
  .upg-list li{display:flex;gap:10px;align-items:flex-start}
  .upg-list li::before{content:'';flex:none;width:10px;height:5px;border-left:2px solid #3B5BFD;border-bottom:2px solid #3B5BFD;transform:rotate(-45deg);margin-top:6px}
  #cloudModal .upg-go{background:#3B5BFD;border-color:#3B5BFD;color:#fff;font-size:15px;font-weight:700;padding:12px;border-radius:8px}
  #cloudModal .upg-go:hover{filter:brightness(1.08)}
  #cloudModal .upg-trust{display:flex;gap:7px;align-items:center;justify-content:center;font-size:12.5px;text-align:center}
  .upg-compare{border-top:1px solid var(--line);padding-top:10px}
  .upg-compare summary{cursor:pointer;font-size:13.5px;font-weight:600;color:var(--mute)}
  .upg-compare .t-plans{margin-top:10px;font-size:13px}
  .upg-promo+.upg-compare{border-top:0;padding-top:0}
  .upg-promo .promo-form{margin-top:10px;max-width:none}
  .acctmenu .menulink{display:flex;padding:7px 10px;border-radius:3px;color:inherit;text-decoration:none}
  .acctmenu .menulink:hover{background:var(--hover)}
  body.viewer>header,body.viewer>main{display:none}
  #present .badge{display:inline-flex;align-items:center;gap:6px;position:fixed;left:50%;transform:translateX(-50%);bottom:calc(8px + env(safe-area-inset-bottom,0px));background:rgba(255,255,255,.08);color:#cfd4d0;font-size:12px;padding:5px 12px;border-radius:999px;text-decoration:none;z-index:57;white-space:nowrap}#present .badge .dom{opacity:.7}
  #present .badge b{color:#fff}
  #vend{position:fixed;inset:0;background:#000;color:#e2e5e0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;z-index:70;text-align:center;padding:20px}
  #vend[hidden]{display:none}
  #vend h1{font-size:24px;margin:0}#vend p{color:#949e96;margin:0}
  #vend .btn{border:1px solid #2a302b;color:#e2e5e0}#vend .btn.primary{background:#a3bcff;color:#111412;border:none}
  #acctBtn{padding:4px 6px}
  
  /* the account controls take room in the header: keep it on one row on laptop screens */
  header .brand span{display:none}
  @media (max-width:1500px){.cloudstat span{display:none}}
  @media (max-width:1400px) and (min-width:901px){header .btn{padding:6px 7px}header .tool{padding:6px 6px}#projName{width:8em}header .sep{margin:0 4px}}
  @media (max-width:900px){#shareBtn{order:6}header>.menuwrap.acctwrap{order:3}.cloudstat span{display:none}#present .badge{left:50%;transform:translateX(-50%);bottom:calc(46px + env(safe-area-inset-bottom,0px))}}`;
  document.head.appendChild(css);

  /* ---------- saving a project file as a real download (outside claude.ai) ---------- */
  const _download = window.downloadProject;
  window.downloadProject = async function () {
    if (window.claude && window.claude.use) return _download();
    const m = curMeta(), name = (m?.name || 'Tracé project').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Tracé project';
    const data = JSON.stringify({ format: 'trace', version: 1, name: m?.name || name, saved: new Date().toISOString(), deck: deckWithImages(deck) });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = name + '.trace.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Project file saved to your downloads.');
  };

  { const gl = document.getElementById('guideLink'); if (gl) gl.hidden = false; }   // the full guide exists on the real site

  /* ---------- shared link viewer: /v/<link id> ---------- */
  const demo = params.get('demo');   // /app?demo=showcase: a built-in deck, played without saving anything
  if (viewSlug || demo) { startViewer(viewSlug, demo); return; }
  if (!ON) {
    // Accounts are not connected yet (config.js is empty): say so instead of silently opening the editor.
    if (params.get('signin') || params.get('upgrade')) {
      history.replaceState(null, '', location.pathname);
      setTimeout(() => toast(window.supabase
        ? 'Sign-in is not set up on this site yet: add the Supabase URL and anon key to config.js.'
        : 'Sign-in could not load. Check your internet connection and reload the page.'), 600);
    }
    return;
  }

  /* ---------- account state ---------- */
  let session = null, user = null, profile = null;
  const isPro = () => profile && profile.plan === 'pro';
  // The editor's Pro features (advanced 3D, voice, Python script, no badge) follow the account's plan.
  PLAN.pro = false; PLAN.badge = true; PLAN.pythonFree = !!CFG.pythonForFree;
  PLAN.upgrade = what => {
    const t = (PRO_WHAT[what] || what) + ' is part of Tracé Pro.';
    if (!user) signInDialog(t + ' Create a free account or sign in first, then choose monthly or yearly.', '?upgrade=1');
    else upgradeDialog(t);
  };
  function syncPlan() { PLAN.pro = !!isPro(); PLAN.badge = !PLAN.pro; planChanged(); }
  planChanged();
  const hasVoice = d => (d.slides || []).some(s => s.voice && Object.keys(s.voice).length);
  const meta = id => projects.find(p => p.id === id);
  // Each edit bumps m.rev; m.savedRev is the last edit that reached the account.
  const dirty = m => (m.rev || 0) > (m.savedRev || 0);

  /* header: save status, Share, account */
  const proj = $q('.proj');
  const stat = document.createElement('div');
  stat.className = 'cloudstat'; stat.id = 'cloudStat'; stat.setAttribute('aria-live', 'polite');
  proj.after(stat);
  stat.style.cursor = 'pointer';
  stat.addEventListener('click', () => { if (!user) return; const m = curMeta(); if (!profileDone()) profileDialog(); else if (m && m.needsPro) upgradeDialog('This project has recorded voice, a Pro feature. It is saved on this device. Upgrade to save it online, or delete its voice clips.'); else if (m && (m.localOnly || m.tooBig)) upgradeDialog(m.tooBig ? 'This project is over 2 MB, the free limit for one project online. Pro allows 20 MB.' : `The free plan keeps ${CFG.freeDecks || 3} projects online. This one is saved on this device only.`); });
  const shareBtn = document.createElement('button');
  shareBtn.className = 'btn'; shareBtn.id = 'shareBtn'; shareBtn.textContent = 'Share';
  const acct = document.createElement('div');
  acct.className = 'menuwrap acctwrap';
  acct.innerHTML = '<button class="btn" id="acctBtn" data-menu="acct" aria-haspopup="true" aria-expanded="false">Sign in</button><div class="menu acctmenu" role="menu" hidden style="left:auto;right:0" id="acctMenu"></div>';
  const presentBtn = $q('#presentBtn');
  presentBtn.before(shareBtn);
  presentBtn.after(acct);
  if (document.body.classList.contains('home-view') && typeof moveAcct === 'function') moveAcct(true);   // the projects page is showing

  const ICON_CLOUD = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4.5 12.5h7.2a2.8 2.8 0 0 0 .3-5.6A4 4 0 0 0 4.3 7.6 2.5 2.5 0 0 0 4.5 12.5z"/></svg>';
  function setStatus(kind, text, short) {
    stat.dataset.s = kind;
    stat.title = text;
    stat.setAttribute('aria-label', text);
    stat.innerHTML = (kind === 'off' ? '' : ICON_CLOUD) + `<span>${esc(short || text)}</span>`;
  }
  function showStatus() {
    const m = curMeta();
    if (!user) return setStatus('off', '');
    if (!profileDone()) return setStatus('warn', 'Finish your profile to save projects online', 'Finish profile');
    if (!m) return;
    if (m.tooBig) return setStatus('warn', 'Too big for the cloud on your plan', 'Too big');
    if (m.practice) return setStatus('local', 'The tutorial’s practice project is kept on this device only', 'Practice');
    if (m.needsPro) return setStatus('warn', 'This project has recorded voice, a Pro feature: saved on this device only', 'Needs Pro');
    if (m.localOnly) return setStatus('warn', `On this device only: the free plan keeps ${CFG.freeDecks || 3} decks online`, 'Device only');
    if (pending.has(m.id) || busy) return setStatus('saving', 'Saving to your account…', 'Saving…');
    if (m.cloudId && !dirty(m)) return setStatus('ok', 'Saved to your account', 'Saved');
    if (m.cloudId) return setStatus('saving', 'Waiting to save', 'Saving…');
    return setStatus('saving', 'Not saved online yet', 'Not online yet');
  }

  /* ---------- dialogs ---------- */
  const modal = document.createElement('div');
  modal.id = 'cloudModal'; modal.hidden = true;
  modal.innerHTML = '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="cloudTitle"><header><div class="spacer"></div><button class="btn" id="cloudClose" aria-label="Close">Close</button></header><div class="body" id="cloudBody"></div></div>';
  document.body.appendChild(modal);
  const body = () => $q('#cloudBody');
  function openDialog(html) { body().innerHTML = html; modal.hidden = false; const f = body().querySelector('input,button'); f && f.focus(); }
  function closeDialog() { modal.hidden = true; }
  $q('#cloudClose').onclick = closeDialog;
  modal.addEventListener('click', e => { if (e.target === modal) closeDialog(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) { e.stopPropagation(); closeDialog(); } }, true);

  /* Sign in and sign up happen on their own pages (/login, /signup); work on this device is already saved. */
  const backHere = extra => encodeURIComponent(location.pathname + (extra || ''));
  function signInDialog(why, extra) {
    openDialog(`<h2 id="cloudTitle">Save your work online</h2>
      <p>${esc(why || 'With a free account, your projects open on any device and you can share them with a link.')}</p>
      <div class="acct-choice"><a class="btn primary wide" href="/signup?next=${backHere(extra)}">Create a free account</a>
      <a class="btn wide" href="/login?next=${backHere(extra)}">I already have an account</a></div>
      <p class="fine">Your projects stay in this browser while you sign in.</p>`);
  }

  /* People finish a short profile before their projects are saved online (the database insists too). */
  function profileDialog(why) {
    openDialog(`<h2 id="cloudTitle">Finish your profile</h2><p>${esc(why || 'One last step: your projects are saved online once your profile is complete.')}</p><div id="cloudPf"></div>`);
    TraceUI.profileForm($q('#cloudPf'), profile, user.email, {
      submitLabel: 'Save and start saving online',
      onSubmit: async v => {
        const { data, error } = await sb.from('profiles').update(v).eq('id', user.id).select().maybeSingle();
        if (error) throw new Error('Could not save your profile. Check your connection and try again.');
        Object.assign(profile, data || v);
        closeDialog(); renderAcct();
        await syncAll();
        toast('Profile saved. Your projects are now saved to your account.');
      },
    });
  }
  const profileDone = () => TraceUI.isComplete(profile);

  /* The Pro offer: a billing period switch, the price (local currency from Paddle when it loads), what Pro adds. */
  const PRICING = Object.assign({ currency: 'USD', monthly: 8, yearly: 72 }, CFG.pricing || {});
  const money = (n, cur) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || PRICING.currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); } catch (_) { return '$' + n; } };
  const LOCK_I = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>';
  let localPrices = null;   // { monthly: {total, perMonth}, yearly: {...} } from Paddle.PricePreview
  let promoWanted = '';     // /app?promo=CODE fills in the promo box
  let promoAsked = false;
  const giftReason = () => TraceUI.isGift(profile) ? `Your free Pro from a promo code runs until ${TraceUI.longDate(profile.comp_until)}. To keep Pro after that, subscribe here (billing starts today).` : undefined;
  function upgradeDialog(reason) {
    const ready = CFG.paddleClientToken && CFG.prices && (CFG.prices.monthly || CFG.prices.yearly);
    if (!ready) return openDialog(`<div class="upg"><div class="upg-top"><span class="pro-tag">PRO</span><h2 id="cloudTitle">Tracé Pro</h2>
      ${reason ? `<p class="upg-why">${esc(reason)}</p>` : ''}</div>
      <p><b>Pro is coming soon.</b> Everything in the Free plan is yours to use in the meantime.</p>
      <details class="upg-compare"><summary>What Pro will add</summary>${TraceUI.planTable(profile && profile.plan)}</details></div>`);
    const periods = ['yearly', 'monthly'].filter(p => CFG.prices[p]);
    const save = PRICING.monthly && PRICING.yearly ? Math.round((1 - PRICING.yearly / (PRICING.monthly * 12)) * 100) : 0;
    let period = periods[0];
    openDialog(`<div class="upg">
      <div class="upg-top"><span class="pro-tag">PRO</span><h2 id="cloudTitle">Upgrade to Tracé Pro</h2>
        <p class="upg-why">${esc(reason || 'Everything in Free, plus advanced 3D, your own voice, the video script, and all your decks online.')}</p></div>
      ${periods.length > 1 ? `<div class="upg-period" role="radiogroup" aria-label="Billing period">${periods.map(p => `<button type="button" role="radio" data-period="${p}" aria-checked="${p === period}">${p === 'yearly' ? 'Yearly' : 'Monthly'}${p === 'yearly' && save > 0 ? ` <span class="save">Save ${save}%</span>` : ''}</button>`).join('')}</div>` : ''}
      <div class="upg-price" aria-live="polite"><b id="upgAmount"></b><span id="upgPer"></span><small id="upgNote"></small></div>
      <ul class="upg-list">${window.TRACE_PLANS.proOnly.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      <button class="btn primary wide upg-go" id="upgGo" type="button">Continue to secure checkout</button>
      <p class="upg-trust">${LOCK_I}<span>Secure checkout by Paddle · Cancel any time · 14-day refund</span></p>
      ${TraceUI.isGift(profile) ? '' : `<details class="upg-compare upg-promo"${promoWanted ? ' open' : ''}><summary>Have a promo code?</summary><div id="upgPromo"></div></details>`}
      <details class="upg-compare"><summary>Compare Free and Pro</summary>${TraceUI.planTable(profile && profile.plan)}</details>
    </div>`);
    const hadPromo = !!promoWanted;
    if (user && $q('#upgPromo')) TraceUI.promoForm($q('#upgPromo'), sb, async until => {
      await loadProfile();
      setTimeout(() => { closeDialog(); proIsOn(`Code accepted: Pro is on until ${TraceUI.longDate(until)}. Enjoy!`); }, 1400);
    }, promoWanted || '');
    promoWanted = '';
    if (hadPromo && $q('#promoGo')) setTimeout(() => $q('#promoGo').focus(), 50);
    const paint = () => {
      const L = localPrices && localPrices[period];
      const yearly = period === 'yearly';
      const per = L ? L.perMonth : money(yearly ? Math.round(PRICING.yearly / 12 * 100) / 100 : PRICING.monthly);
      const total = L ? L.total : money(yearly ? PRICING.yearly : PRICING.monthly);
      $q('#upgAmount').textContent = per;
      $q('#upgPer').textContent = ' / month';
      $q('#upgNote').textContent = yearly ? `${total} billed once a year` : 'Billed monthly';
      const go = $q('#upgGo'); go.dataset.price = CFG.prices[period];
      body().querySelectorAll('[data-period]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.period === period)));
    };
    body().querySelectorAll('[data-period]').forEach(b => b.onclick = () => { period = b.dataset.period; paint(); });
    body().querySelector('.upg-period')?.addEventListener('keydown', e => {
      if (!/Arrow(Left|Right|Up|Down)/.test(e.key)) return;
      e.preventDefault(); period = periods[(periods.indexOf(period) + 1) % periods.length]; paint();
      body().querySelector(`[data-period="${period}"]`).focus();
    });
    $q('#upgGo').onclick = () => checkout($q('#upgGo').dataset.price);
    paint();
    // the real price in the visitor's currency, taxes as Paddle will charge them
    if (!localPrices) loadPaddle().then(P => P.PricePreview && P.PricePreview({ items: periods.map(p => ({ priceId: CFG.prices[p], quantity: 1 })) })).then(r => {
      const items = r && r.data && r.data.details && r.data.details.lineItems;
      if (!items || !items.length) return;
      localPrices = {};
      for (const it of items) {
        const p = periods.find(x => CFG.prices[x] === (it.price && it.price.id)); if (!p) continue;
        const cents = Number(it.totals && it.totals.total), cur = r.data.currencyCode;
        const perMonth = p === 'yearly' && cents ? money(Math.round(cents / 12) / 100, cur) : it.formattedTotals.total;
        localPrices[p] = { total: it.formattedTotals.total, perMonth };
      }
      if (!modal.hidden && $q('#upgGo')) paint();
    }).catch(() => {});
  }

  // what people with a share link may do: move sliders and turn 3D (on unless switched off), make a copy (off unless switched on)
  function viewerOpts(d) { return { interactive: !(d && d.viewer && d.viewer.interactive === false), copy: !!(d && d.viewer && d.viewer.copy) }; }   // a declaration: the viewer runs before this line
  async function shareDialog() {
    if (!user) return signInDialog('Create a free account or sign in to share a link to this deck.');
    if (!profileDone()) return profileDialog('Finish your profile to share decks: your name appears on decks you share.');
    let m = curMeta();
    openDialog('<h2 id="cloudTitle">Share</h2><p>Getting the link ready…</p>');
    await flush(true);
    m = curMeta();
    if (!m.cloudId) {
      if (m.localOnly) return upgradeDialog(`This deck is not in the cloud yet: the free plan keeps ${CFG.freeDecks || 3} decks. Upgrade, or delete a deck you no longer need.`);
      if (m.tooBig) return upgradeDialog('This deck is too big for the free plan (2 MB). Pro allows 20 MB.');
      return openDialog('<h2 id="cloudTitle">Share</h2><p>Could not reach the server. Check your connection and try again.</p>');
    }
    const link = slug => `${location.origin}/v/${slug}`;
    const render = () => {
      const on = !!m.share, vw = viewerOpts(deck);
      openDialog(`<h2 id="cloudTitle">Share “${esc(m.name)}”</h2>
        <label class="sw2"><input type="checkbox" id="shareOn" ${on ? 'checked' : ''}> Anyone with the link can watch this deck</label>
        ${on ? `<div class="row"><input type="text" id="shareLink" readonly value="${esc(link(m.share))}" aria-label="Share link"><button class="btn primary" id="copyLink">Copy</button></div>
        <fieldset class="share-opts"><legend>People with the link can</legend>
          <label class="sw2"><input type="checkbox" id="shareInter" ${vw.interactive ? 'checked' : ''}> Move the sliders and turn 3D views themselves</label>
          <label class="sw2"><input type="checkbox" id="shareCopy" ${vw.copy ? 'checked' : ''}> Make their own copy to change</label></fieldset>
        <p>They watch the presentation on any device and cannot change yours.${isPro() ? ` Watched ${m.views || 0} time${m.views === 1 ? '' : 's'}.` : ''}</p>` : '<p>Only you can see this deck.</p>'}
        ${on && !isPro() ? '<p>Shared decks show a small “Made with Tracé” badge. <span class="pro-tag">PRO</span> removes it and shows how often each deck is watched. <a href="#" id="shareUp">Compare plans</a></p>' : ''}`);
      $q('#shareOn').onchange = async e => {
        const want = e.target.checked;
        const { data, error } = await sb.rpc('set_deck_sharing', { p_deck: m.cloudId, p_on: want });
        if (error) { toast('Could not change sharing: ' + error.message); return render(); }
        m.share = want ? data : null; saveIndex(); render();
      };
      // what viewers may do travels with the deck, so it is saved like any other change
      const setOpt = (k, v) => { snap(); deck.viewer = Object.assign(viewerOpts(deck), { [k]: v }); persist(); refresh(); toast(k === 'copy' ? (v ? 'Viewers can now make their own copy.' : 'Viewers can no longer make a copy.') : (v ? 'Viewers can now move the sliders.' : 'The link is now watch-only.')); };
      const si = $q('#shareInter'), sc = $q('#shareCopy');
      if (si) si.onchange = e => setOpt('interactive', e.target.checked);
      if (sc) sc.onchange = e => setOpt('copy', e.target.checked);
      const c = $q('#copyLink');
      if (c) c.onclick = async () => { const i = $q('#shareLink'); try { await navigator.clipboard.writeText(i.value); c.textContent = 'Copied'; } catch (_) { i.select(); document.execCommand('copy'); c.textContent = 'Copied'; } };
      const u = $q('#shareUp');
      if (u) u.onclick = e => { e.preventDefault(); upgradeDialog(); };
    };
    render();
  }
  shareBtn.onclick = shareDialog;

  /* ---------- account menu ---------- */
  function renderAcct() {
    syncPlan();
    const btn = $q('#acctBtn'), menu = $q('#acctMenu');
    if (!user) {
      btn.textContent = 'Sign in';
      btn.removeAttribute('data-menu');
      btn.onclick = () => signInDialog();
      return;
    }
    btn.setAttribute('data-menu', 'acct');
    btn.onclick = null;
    btn.innerHTML = TraceUI.avatar(profile, user.email, 24);
    btn.setAttribute('aria-label', 'Account: ' + (profile && profile.display_name || user.email));
    btn.title = (profile && profile.display_name ? profile.display_name + ' · ' : '') + user.email;
    const used = projects.filter(p => p.cloudId).length;
    menu.innerHTML = `<div class="who">${profile && profile.display_name ? `<b style="color:var(--ink)">${esc(profile.display_name)}</b><br>` : ''}${esc(user.email)}</div>
      ${profileDone() ? '' : '<button role="menuitem" class="up" data-acct="profile">Finish your profile to save online</button>'}
      <div class="plan">${isPro() ? 'Pro plan' : 'Free plan'}<small>${isPro()
        ? (TraceUI.isGift(profile) ? 'Free with a code until ' + new Date(profile.comp_until).toLocaleDateString() : profile.subscription_status === 'past_due' ? 'Payment problem: please update your card' : profile.plan_renews_at ? 'Renews ' + new Date(profile.plan_renews_at).toLocaleDateString() : '')
        : `${used} of ${CFG.freeDecks || 3} projects online · <span class="pro-tag">PRO</span> unlimited`}</small></div>
      ${isPro() && profile.paddle_customer_id ? '<button role="menuitem" data-acct="billing">Manage billing</button>' : isPro() ? '' : '<button role="menuitem" class="up" data-acct="upgrade">Upgrade to Pro</button>'}
      <a role="menuitem" href="/account" class="menulink">Profile, plan and billing</a>
      <button role="menuitem" data-acct="sync">Sync now</button>
      <hr><button role="menuitem" data-acct="signout">Sign out</button>`;
  }
  document.addEventListener('click', async e => {
    const a = e.target.closest('[data-acct]');
    if (!a) return;
    closeMenus();
    const k = a.dataset.acct;
    if (k === 'upgrade') upgradeDialog(giftReason());
    else if (k === 'billing') openBilling();
    else if (k === 'profile') profileDialog();
    else if (k === 'sync') { if (!profileDone()) return profileDialog(); await syncAll(); toast('Your decks are up to date.'); }
    else if (k === 'signout') signOut();
  });

  /* ---------- tags in the project list ---------- */
  const _renderProjMenu = window.renderProjMenu;
  window.renderProjMenu = function () {
    _renderProjMenu();
    if (typeof homeSoon === 'function') homeSoon();
    if (!user) return;
    document.querySelectorAll('#projMenu [data-proj]').forEach(b => {
      const m = meta(b.dataset.proj);
      if (!m) return;
      const tag = !profileDone() ? '' : m.localOnly ? 'device only' : m.remote ? 'in the cloud' : m.share ? 'shared' : '';
      if (tag) b.querySelector('span').insertAdjacentHTML('beforeend', `<span class="tag">${tag}</span>`);
    });
  };

  /* ---------- saving to the cloud ---------- */
  const pending = new Set();
  let timer = null, busy = false;
  function queue(id, delay = 2000) {
    if (!user || !id) return;
    pending.add(id);
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
    showStatus();
  }
  async function flush(now) {
    clearTimeout(timer);
    if (busy) { if (now) { while (busy) await new Promise(r => setTimeout(r, 100)); } else { timer = setTimeout(flush, 500); return; } }
    busy = true;
    try {
      if (now) pending.add(curProj);
      for (const id of [...pending]) {
        pending.delete(id);
        const m = meta(id);
        if (m && !m.remote && !m.localOnly && !m.tooBig && !m.practice) await push(m);
      }
    } finally { busy = false; showStatus(); }
  }

  async function push(m) {
    if (!user || m.owner && m.owner !== user.id || !profileDone()) return;
    const d = m.id === curProj ? deck : readDeck(m.id);
    if (!d) return;
    if (!isPro() && hasVoice(d)) { if (!m.needsPro) { m.needsPro = true; nudge('Saved on this device only: recorded voice is part of Tracé Pro.'); } saveIndex(); return; }
    m.needsPro = false;
    const data = deckWithImages(d), stamp = m.updated, rev = m.rev || 0;   // an edit made while this request runs is saved by the next one
    let res;
    if (m.cloudId) {
      res = await sb.from('decks').update({ name: m.name, data }).eq('id', m.cloudId).select('updated_at').maybeSingle();
      if (!res.error && !res.data) { delete m.cloudId; return push(m); }   // deleted on another device: save it again
    } else {
      res = await sb.from('decks').insert({ name: m.name, data, client_id: m.id }).select('id,updated_at').single();
    }
    if (res.error) {
      const msg = res.error.message || '';
      if (msg.includes('profile_required')) { await loadProfile(); renderAcct(); showStatus(); profileDialog(); saveIndex(); return; }
      if (msg.includes('voice_needs_pro')) { m.needsPro = true; nudge('Saved on this device only: recorded voice is part of Tracé Pro.'); }
      else if (msg.includes('free_limit')) { m.localOnly = true; nudge(`Saved on this device only: the free plan keeps ${CFG.freeDecks || 3} decks in the cloud.`); }
      else if (msg.includes('deck_too_large')) { m.tooBig = true; nudge('This deck is too big to save online on your plan. It is still saved on this device.'); }
      else { pending.add(m.id); clearTimeout(timer); timer = setTimeout(flush, 15000); }   // offline or server busy: try again soon
      saveIndex(); return;
    }
    if (res.data.id) m.cloudId = res.data.id;
    m.cloudAt = res.data.updated_at;
    m.owner = user.id;
    m.syncedAt = stamp;
    m.savedRev = Math.max(m.savedRev || 0, rev);
    m.localOnly = false; m.tooBig = false;
    saveIndex();
  }
  let nudged = 0;
  function nudge(text) {
    toast(text);
    if (Date.now() - nudged > 10 * 60 * 1000 && !isPro()) { nudged = Date.now(); setTimeout(() => upgradeDialog(text), 600); }
  }

  /* every edit already calls persist(): copy it to the cloud a moment later */
  const _persist = window.persist;
  window.persist = function () { _persist(); { const m0 = curMeta(); if (m0) { m0.rev = (m0.rev || 0) + 1; saveIndex(); } } if (user && curProj) { const m = curMeta(); if (m && !m.localOnly && !m.tooBig && !m.practice) queue(curProj); else showStatus(); } };
  $q('#projName').addEventListener('change', () => { const m = curMeta(); if (m) { m.rev = (m.rev || 0) + 1; saveIndex(); } queue(curProj, 300); });

  /* opening a deck that was saved from another device downloads it first */
  const _openProject = window.openProject;
  window.openProject = function (id) {
    const m = meta(id);
    if (user && m && (m.remote || m.stale)) {
      setStatus('saving', 'Opening…');
      fetchDeck(m).then(() => { if (id === curProj) { deck = readDeck(id) || blankDeck(); cur = 0; sel = null; hist = []; future = []; refresh(); updateProjectUI(); } else _openProject(id); showStatus(); })
        .catch(() => { toast('Could not download this deck. Check your connection.'); if (!m.remote) _openProject(id); showStatus(); });
      return;
    }
    _openProject(id);
    showStatus();
  };
  async function fetchDeck(m) {
    const { data, error } = await sb.from('decks').select('name,data,updated_at,share_mode,share_slug,view_count').eq('id', m.cloudId).single();
    if (error) throw error;
    let d = data.data;
    if (d.images) { for (const [k, v] of Object.entries(d.images)) { IMG.set(k, v); idb.put(k, v); } d = { ...d }; delete d.images; renderEpoch++; }
    saveDeckRaw(m.id, d);
    Object.assign(m, { name: data.name, remote: false, stale: false, cloudAt: data.updated_at, updated: Date.parse(data.updated_at), owner: user.id,
                       share: data.share_mode === 'link' ? data.share_slug : null, views: data.view_count });
    m.syncedAt = m.updated;
    m.savedRev = m.rev || 0;
    saveIndex();
  }

  /* deleting a project also deletes its cloud copy */
  const _projAction = window.projAction;
  window.projAction = async function (a, btn) {
    const before = curMeta();
    const r = await _projAction(a, btn);
    if (a === 'delete' && before && !projects.includes(before) && before.cloudId && user) {
      const { error } = await sb.from('decks').delete().eq('id', before.cloudId);
      if (error) toast('Deleted here, but the cloud copy could not be deleted: ' + error.message);
    }
    if (a === 'new' || a === 'dup' || a === 'import') queue(curProj, 500);
    showStatus();
    return r;
  };
  const _createProject = window.createProject;
  window.createProject = function (name, d) { _createProject(name, d); queue(curProj, 500); };

  /* ---------- bringing the project list up to date ---------- */
  let syncing = null;
  function syncAll() { return syncing || (syncing = doSync().finally(() => { syncing = null; })); }
  async function doSync() {
    if (!user) return;
    setStatus('saving', 'Syncing…');
    const { data: rows, error } = await sb.from('decks').select('id,name,updated_at,client_id,share_mode,share_slug,view_count').order('updated_at', { ascending: false });
    if (error) { setStatus('warn', 'Offline: changes are kept on this device', 'Offline'); return; }
    const seen = new Set();
    for (const r of rows) {
      seen.add(r.id);
      let m = projects.find(p => p.cloudId === r.id) || projects.find(p => !p.cloudId && p.id === r.client_id && (!p.owner || p.owner === user.id));
      const share = r.share_mode === 'link' ? r.share_slug : null;
      if (!m) {
        const t = Date.parse(r.updated_at);
        projects.push({ id: newPid(), name: r.name, updated: t, cloudId: r.id, cloudAt: r.updated_at, owner: user.id, remote: true, syncedAt: t, share, views: r.view_count });
        continue;
      }
      Object.assign(m, { cloudId: r.id, owner: user.id, share, views: r.view_count });
      if (m.cloudAt !== r.updated_at) {
        const changedHere = !m.syncedAt || dirty(m);
        if (changedHere && m.updated > Date.parse(r.updated_at)) pending.add(m.id);   // this device has the newer version
        else if (readDeck(m.id)) { m.stale = true; m.name = r.name; }                // the cloud has the newer version
        else m.remote = true;
      }
    }
    for (const p of projects) {
      if (p.cloudId && !seen.has(p.cloudId) && p.owner === user.id) { delete p.cloudId; delete p.cloudAt; p.localOnly = true; }   // deleted on another device
    }
    // decks on this device that are not online yet: most recently edited first, so they win the free slots
    projects.filter(p => !p.cloudId && !p.localOnly && !p.tooBig && !p.practice && (!p.owner || p.owner === user.id))
      .sort((a, b) => b.updated - a.updated).forEach(p => pending.add(p.id));
    saveIndex();
    const m = curMeta();
    if (m && (m.remote || m.stale)) { try { await fetchDeck(m); deck = readDeck(curProj) || deck; cur = Math.min(cur, deck.slides.length - 1); sel = null; refresh(); } catch (_) {} }
    updateProjectUI();
    await flush();
    renderAcct();
    showStatus();
  }

  /* ---------- sign in / out ---------- */
  async function loadProfile() {
    profile = await TraceUI.fetchProfile(sb, user.id, 'plan,subscription_status,plan_renews_at,paddle_customer_id,display_name,role,subject,organization,avatar_color') || { plan: 'free' };
  }
  async function onSession(s) {
    const was = user && user.id;
    session = s; user = s ? s.user : null;
    signedOutElsewhere();
    if (!user) {
      profile = null; renderAcct(); showStatus();
      let pc = ''; try { pc = localStorage.getItem('trace-promo') || ''; } catch (_) {}
      if (pc && !promoAsked) { promoAsked = true; signInDialog(`Create a free account or sign in, and your promo code ${pc} turns on Pro. No card needed.`); }
      return;
    }
    if (was === user.id) return;
    await loadProfile();
    renderAcct();
    if (!profileDone()) { showStatus(); profileDialog('Welcome! One last step: your projects are saved online once your profile is complete.'); return; }
    const before = projects.filter(p => !p.cloudId && !p.owner).length;
    await syncAll();
    // after a fresh upgrade, decks that were "device only" can now go to the cloud
    if (isPro()) { let any = false; for (const p of projects) if (p.localOnly || p.tooBig || p.needsPro) { p.localOnly = p.tooBig = p.needsPro = false; pending.add(p.id); any = true; } if (any) await flush(); }
    if (!was && before && projects.some(p => p.cloudId)) toast('Signed in. Your decks are saved to your account.');
    try { if (localStorage.getItem('trace-want-upgrade') === '1') { localStorage.removeItem('trace-want-upgrade'); promoWanted = localStorage.getItem('trace-promo') || ''; localStorage.removeItem('trace-promo'); if (!isPro() || TraceUI.isGift(profile)) upgradeDialog(promoWanted && !TraceUI.isGift(profile) ? 'You have a promo code: press Redeem to turn on Pro, no card needed.' : giftReason()); } } catch (_) {}
  }
  /* Signed out from the account page: remove that account's saved projects from this browser too. */
  function signedOutElsewhere() {
    let gone = null;
    try { gone = localStorage.getItem('trace-pending-signout'); } catch (_) {}
    if (!gone || (user && user.id === gone)) return;
    const mine = projects.filter(p => p.owner === gone);
    const safe = mine.filter(p => p.cloudId && !dirty(p));
    for (const p of safe) { try { localStorage.removeItem('trace-proj:' + p.id); } catch (_) {} }
    projects = projects.filter(p => !safe.includes(p));
    for (const p of projects) if (p.owner === gone) delete p.owner;
    if (!projects.length) { projects = [{ id: newPid(), name: 'Untitled project', updated: Date.now() }]; saveDeckRaw(projects[0].id, blankDeck()); }
    saveIndex();
    if (!projects.find(p => p.id === curProj)) { curProj = ''; _openProject(projects[0].id); }
    updateProjectUI();
    try { localStorage.removeItem('trace-pending-signout'); } catch (_) {}
  }
  async function signOut() {
    await flush(true);
    const mine = projects.filter(p => p.owner === user.id);
    const unsaved = mine.filter(p => !p.cloudId || dirty(p));
    if (unsaved.length && !confirm(`${unsaved.length} deck(s) have changes that are not saved online yet. Sign out anyway? They stay on this device.`)) return;
    for (const p of mine) if (!unsaved.includes(p)) { try { localStorage.removeItem('trace-proj:' + p.id); } catch (_) {} }
    projects = projects.filter(p => p.owner !== user.id || unsaved.includes(p));
    for (const p of projects) delete p.owner;
    if (!projects.length) projects = [{ id: newPid(), name: 'Untitled project', updated: Date.now() }], saveDeckRaw(projects[0].id, blankDeck());
    saveIndex();
    await sb.auth.signOut();
    if (!projects.find(p => p.id === curProj)) { curProj = ''; _openProject(projects[0].id); }
    updateProjectUI();
    toast('Signed out. Your decks are safe in your account.');
  }

  /* ---------- payments ---------- */
  let paddleReady = null;
  function loadPaddle() {
    return paddleReady || (paddleReady = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
      s.onload = () => {
        if (CFG.paddleEnv !== 'production') window.Paddle.Environment.set('sandbox');
        window.Paddle.Initialize({ token: CFG.paddleClientToken, eventCallback: ev => { if (ev && ev.name === 'checkout.completed') waitForPro(); } });
        res(window.Paddle);
      };
      s.onerror = () => { paddleReady = null; rej(new Error('Paddle did not load')); };
      document.head.appendChild(s);
    }));
  }
  async function checkout(priceId) {
    if (!user) return signInDialog('Create a free account or sign in first, so Pro is added to your account.', '?upgrade=1');
    closeDialog();
    try {
      const P = await loadPaddle();
      P.Checkout.open({ items: [{ priceId, quantity: 1 }], customer: { email: user.email }, customData: { user_id: user.id },
                        settings: { displayMode: 'overlay', variant: 'one-page', theme: 'light', allowLogout: false, showAddDiscounts: true,
                                    successUrl: location.origin + location.pathname + '?upgraded=1' } });
    } catch (_) { toast('The payment window could not open. Check your connection or ad blocker.'); }
  }
  async function proIsOn(msg) {
    syncPlan();
    for (const p of projects) if (p.localOnly || p.tooBig || p.needsPro) { p.localOnly = p.tooBig = p.needsPro = false; pending.add(p.id); }
    await flush(); renderAcct(); showStatus();
    toast(msg);
  }
  async function waitForPro() {
    toast('Payment received. Turning on Pro…');
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      await loadProfile();
      if (isPro()) return proIsOn('Welcome to Tracé Pro. All your decks are now saved online.');
    }
    toast('Pro will switch on in a moment. Reload the page if it does not.');
  }
  async function openBilling() {
    const w = window.open('', '_blank');
    const res = await fetch('/api/billing-portal', { method: 'POST', headers: { authorization: 'Bearer ' + session.access_token } }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    if (out.url) { if (w) w.location = out.url; else location.href = out.url; }
    else { if (w) w.close(); toast(out.error || 'The billing page is not available right now.'); }
  }

  /* ---------- start ---------- */
  setStatus('off', '');
  renderAcct();
  sb.auth.onAuthStateChange((ev, s) => { setTimeout(() => onSession(s), 0); });   // outside the auth lock, as Supabase recommends
  sb.auth.getSession().then(async ({ data }) => {
    await onSession(data.session);
    if (!user && wantsUpgrade() && !promoAsked) signInDialog('Create a free account or sign in first, then choose monthly or yearly.', '?upgrade=1');
    else if (!user && params.get('signin')) location.replace('/login');   // old "Sign in" links
    if (params.get('signin')) history.replaceState(null, '', location.pathname);
  });
  if (params.get('upgraded')) { history.replaceState(null, '', location.pathname); waitForPro(); }
  // "Get Pro" on the home page: /app?upgrade=1 (remembered across the email sign-in)
  if (params.get('upgrade')) { history.replaceState(null, '', location.pathname); try { localStorage.setItem('trace-want-upgrade', '1'); } catch (_) {} }
  if (params.get('promo')) {   // a link like /app?promo=FOUNDERS-2026 opens the Pro window with the code filled in
    const c = params.get('promo').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
    history.replaceState(null, '', location.pathname + location.hash);
    try { localStorage.setItem('trace-want-upgrade', '1'); localStorage.setItem('trace-promo', c); } catch (_) {}
  }
  function wantsUpgrade() { try { return localStorage.getItem('trace-want-upgrade') === '1'; } catch (_) { return false; } }

  let lastFocus = Date.now();
  window.addEventListener('focus', () => { if (user && Date.now() - lastFocus > 60000) syncAll(); lastFocus = Date.now(); });
  window.addEventListener('online', () => { if (user) flush(); });
  window.addEventListener('beforeunload', e => { if (pending.size || busy) { flush(true); e.preventDefault(); e.returnValue = ''; } });
  // test hook
  window.__traceCloud = { syncAll, flush, state: () => ({ user, profile, pending: [...pending], busy }) };

  /* ---------- viewer ---------- */
  async function startViewer(slug, demo) {
    document.body.classList.add('viewer');
    window.persist = () => {};            // never write the shared deck into this visitor's own projects
    const fail = (title, text) => {
      const v = document.createElement('div');
      v.id = 'vend';
      v.innerHTML = `<h1>${esc(title)}</h1><p>${esc(text)}</p><a class="btn primary" href="/">Make your own with Tracé</a>`;
      document.body.appendChild(v);
    };
    const DEMOS = { showcase: ['Tracé in motion', 'buildShowcaseDeck'], signal: ['How a signal travels', 'buildSignalDeck'], jamming: ['Le brouillage des communications', 'buildJammingDeck'] };
    let row;
    if (demo) {
      const dm = DEMOS[demo];
      if (!dm || typeof window[dm[1]] !== 'function') return fail('This demo does not exist', 'Have a look at the home page instead.');
      row = { name: dm[0], data: window[dm[1]](), owner_plan: 'pro' };
    } else {
      if (!ON) return fail('This link cannot be opened here', 'The site is not connected to its database yet.');
      let rows;
      try { const r = await sb.rpc('get_shared_deck', { p_slug: slug }); if (r.error) throw r.error; rows = r.data; }
      catch (_) { return fail('Could not load this deck', 'Check your connection and reload the page.'); }
      row = rows && rows[0];
    }
    if (!row) return fail('This deck is not shared any more', 'Ask the person who sent the link to share it again.');
    let d = row.data;
    if (d.images) { for (const [k, v] of Object.entries(d.images)) IMG.set(k, v); d = { ...d }; delete d.images; renderEpoch++; }
    deck = d; cur = 0; sel = null;
    document.title = row.name + ' · Tracé';
    const present = $q('#present');
    if (row.owner_name) document.title = row.name + ' by ' + row.owner_name + ' · Tracé';
    if (row.owner_plan !== 'pro') present.insertAdjacentHTML('beforeend', '<a class="badge" href="/" target="_blank" rel="noopener"><svg viewBox="0 0 64 64" width="14" height="14" aria-hidden="true"><g fill="currentColor"><circle cx="13" cy="23" r="4.5"/><circle cx="22" cy="16" r="4.5"/><circle cx="32" cy="16" r="4.5"/><circle cx="42" cy="16" r="4.5"/><circle cx="52" cy="16" r="4.5"/><circle cx="32" cy="27" r="4.5"/><circle cx="32" cy="38" r="4.5"/></g><g fill="#3B5BFD"><circle cx="42" cy="49" r="6.5"/></g></svg>Made with <b>Tracé</b><span class="dom">· traceanim.com</span></a>');
    const end = document.createElement('div');
    end.id = 'vend'; end.hidden = true;
    end.innerHTML = `<h1>${esc(row.name)}</h1>${row.owner_name ? `<p>by ${esc(row.owner_name)}</p>` : ''}<p>You have reached the end.</p><div class="row" style="display:flex;gap:10px"><button class="btn" id="vAgain">Watch again</button><a class="btn primary" href="/">Make your own with Tracé</a></div>`;
    document.body.appendChild(end);
    $q('#vAgain').onclick = () => { end.hidden = true; openPresent(); };
    window.closePresent = function () { voiceStop(); finishAnim(); stopLoop(); end.hidden = false; };
    $q('#exitPres').textContent = 'Close';
    $q('#exitPres').onclick = e => { e.stopPropagation(); window.closePresent(); };
    const vw = viewerOpts(d);
    if (!vw.interactive) document.body.classList.add('watch-only');
    // a one-time nudge the first time a slide has something to play with
    if (vw.interactive) {
      const hint = document.createElement('div');
      hint.id = 'vhint'; hint.hidden = true; hint.setAttribute('role', 'status');
      hint.innerHTML = '<span id="vhintText"></span><button type="button" aria-label="Close" id="vhintX">×</button>';
      present.appendChild(hint);
      let shown = false;
      const show = text => { if (shown) return; shown = true; $q('#vhintText').textContent = text; hint.hidden = false; setTimeout(() => { hint.hidden = true; }, 7000); };
      $q('#vhintX').onclick = e => { e.stopPropagation(); hint.hidden = true; };
      hint.addEventListener('click', e => e.stopPropagation());
      new MutationObserver(() => {
        const live = !$q('#plive').hidden, has3d = !!$q('#pcanvas g[data-type="axes3d"]');
        if (live) show(has3d ? 'Try it: drag the sliders, or drag the 3D view to turn it' : 'Try it: drag the sliders to change the numbers');
        else if (has3d) show('Try it: drag the 3D view to turn it');
      }).observe(present, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
    }
    // "Make my own copy": the deck (and its images and voice) goes into this visitor's own projects
    const copyDeck = async () => {
      const full = deckWithImages(deck), imgs = full.images || {};
      try { for (const [k, v] of Object.entries(imgs)) await idb.put(k, v); } catch (_) {}
      const plain = { ...full }; delete plain.images; delete plain.viewer;
      try { localStorage.setItem('trace-import', JSON.stringify({ name: row.name + (row.owner_name ? ' (from ' + row.owner_name + ')' : ''), deck: plain })); }
      catch (_) { alert('This deck is too large to copy in this browser.'); return; }
      location.href = '/app#edit';
    };
    if (vw.copy) {
      const cb = document.createElement('button');
      cb.id = 'vcopy'; cb.type = 'button'; cb.textContent = 'Make my own copy';
      cb.onclick = e => { e.stopPropagation(); copyDeck(); };
      present.appendChild(cb);
      end.querySelector('.row').insertAdjacentHTML('afterbegin', '<button class="btn" id="vCopyEnd">Make my own copy</button>');
      $q('#vCopyEnd').onclick = copyDeck;
    }
    const go = () => { cur = 0; openPresent(); };
    if (window.mjReady) go(); else { const prev = window.onMJ; window.onMJ = () => { prev && prev(); go(); }; setTimeout(() => { if ($q('#present').hidden && end.hidden) go(); }, 4000); }
  }
})();
