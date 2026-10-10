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
  .msg-ok{color:var(--ink)!important}
  .acct-choice{display:grid;gap:8px}
  #cloudModal .btn.wide{display:block;text-align:center;text-decoration:none}
  #cloudModal .fine{font-size:12.5px}
  #cloudModal .dialog{max-height:calc(100vh - 32px);overflow:auto}
  #cloudModal:has(#cloudPf) .dialog,#cloudModal:has(.t-plans) .dialog{width:min(620px,100%)}
  .acctmenu .menulink{display:flex;padding:7px 10px;border-radius:3px;color:inherit;text-decoration:none}
  .acctmenu .menulink:hover{background:var(--hover)}
  body.viewer>header,body.viewer>main{display:none}
  #present .badge{display:inline-flex;align-items:center;gap:6px;position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));background:rgba(255,255,255,.08);color:#cfd4d0;font-size:12px;padding:5px 9px;border-radius:3px;text-decoration:none;z-index:57}
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

  function upgradeDialog(reason) {
    const ready = CFG.paddleClientToken && (CFG.prices.monthly || CFG.prices.yearly);
    openDialog(`<h2 id="cloudTitle">Tracé Pro</h2>
      ${reason ? `<p>${esc(reason)}</p>` : '<p>Everything in Free, plus more room online and cleaner share links.</p>'}
      ${TraceUI.planTable(profile && profile.plan)}
      ${ready ? `<div class="plans">${CFG.prices.monthly ? `<button data-price="${esc(CFG.prices.monthly)}"><b>Monthly</b>${esc(CFG.priceLabels.monthly)}</button>` : ''}${CFG.prices.yearly ? `<button data-price="${esc(CFG.prices.yearly)}"><b>Yearly</b>${esc(CFG.priceLabels.yearly)}</button>` : ''}</div>
      <p>Secure payment by Paddle. Cancel any time from “Manage billing”.</p>` : '<p><b>Pro is coming soon.</b> Everything in the Free plan is yours to use in the meantime.</p>'}`);
    body().querySelectorAll('[data-price]').forEach(b => b.onclick = () => checkout(b.dataset.price));
  }

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
      const on = !!m.share;
      openDialog(`<h2 id="cloudTitle">Share “${esc(m.name)}”</h2>
        <label class="sw2"><input type="checkbox" id="shareOn" ${on ? 'checked' : ''}> Anyone with the link can watch this deck</label>
        ${on ? `<div class="row"><input type="text" id="shareLink" readonly value="${esc(link(m.share))}" aria-label="Share link"><button class="btn primary" id="copyLink">Copy</button></div>
        <p>Viewers see the presentation with its live sliders, on any device. They cannot edit it.${isPro() ? ` Watched ${m.views || 0} time${m.views === 1 ? '' : 's'}.` : ''}</p>` : '<p>Only you can see this deck.</p>'}
        ${on && !isPro() ? '<p>Shared decks show a small “Made with Tracé” badge. <span class="pro-tag">PRO</span> removes it and shows how often each deck is watched. <a href="#" id="shareUp">Compare plans</a></p>' : ''}`);
      $q('#shareOn').onchange = async e => {
        const want = e.target.checked;
        const { data, error } = await sb.rpc('set_deck_sharing', { p_deck: m.cloudId, p_on: want });
        if (error) { toast('Could not change sharing: ' + error.message); return render(); }
        m.share = want ? data : null; saveIndex(); render();
      };
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
        ? (profile.subscription_status === 'past_due' ? 'Payment problem: please update your card' : profile.plan_renews_at ? 'Renews ' + new Date(profile.plan_renews_at).toLocaleDateString() : '')
        : `${used} of ${CFG.freeDecks || 3} projects online · <span class="pro-tag">PRO</span> unlimited`}</small></div>
      ${isPro() ? '<button role="menuitem" data-acct="billing">Manage billing</button>' : '<button role="menuitem" class="up" data-acct="upgrade">Upgrade to Pro</button>'}
      <a role="menuitem" href="/account" class="menulink">Profile, plan and billing</a>
      <button role="menuitem" data-acct="sync">Sync now</button>
      <hr><button role="menuitem" data-acct="signout">Sign out</button>`;
  }
  document.addEventListener('click', async e => {
    const a = e.target.closest('[data-acct]');
    if (!a) return;
    closeMenus();
    const k = a.dataset.acct;
    if (k === 'upgrade') upgradeDialog();
    else if (k === 'billing') openBilling();
    else if (k === 'profile') profileDialog();
    else if (k === 'sync') { if (!profileDone()) return profileDialog(); await syncAll(); toast('Your decks are up to date.'); }
    else if (k === 'signout') signOut();
  });

  /* ---------- tags in the project list ---------- */
  const _renderProjMenu = window.renderProjMenu;
  window.renderProjMenu = function () {
    _renderProjMenu();
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
    const { data } = await sb.from('profiles').select('plan,subscription_status,plan_renews_at,paddle_customer_id,display_name,role,subject,organization,avatar_color').eq('id', user.id).maybeSingle();
    profile = data || { plan: 'free' };
  }
  async function onSession(s) {
    const was = user && user.id;
    session = s; user = s ? s.user : null;
    signedOutElsewhere();
    if (!user) { profile = null; renderAcct(); showStatus(); return; }
    if (was === user.id) return;
    await loadProfile();
    renderAcct();
    if (!profileDone()) { showStatus(); profileDialog('Welcome! One last step: your projects are saved online once your profile is complete.'); return; }
    const before = projects.filter(p => !p.cloudId && !p.owner).length;
    await syncAll();
    // after a fresh upgrade, decks that were "device only" can now go to the cloud
    if (isPro()) { let any = false; for (const p of projects) if (p.localOnly || p.tooBig || p.needsPro) { p.localOnly = p.tooBig = p.needsPro = false; pending.add(p.id); any = true; } if (any) await flush(); }
    if (!was && before && projects.some(p => p.cloudId)) toast('Signed in. Your decks are saved to your account.');
    try { if (localStorage.getItem('trace-want-upgrade') === '1') { localStorage.removeItem('trace-want-upgrade'); if (!isPro()) upgradeDialog(); } } catch (_) {}
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
                        settings: { displayMode: 'overlay', successUrl: location.origin + location.pathname + '?upgraded=1' } });
    } catch (_) { toast('The payment window could not open. Check your connection or ad blocker.'); }
  }
  async function waitForPro() {
    toast('Payment received. Turning on Pro…');
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      await loadProfile();
      if (isPro()) {
        for (const p of projects) if (p.localOnly || p.tooBig || p.needsPro) { p.localOnly = p.tooBig = p.needsPro = false; pending.add(p.id); }
        await flush(); renderAcct(); showStatus();
        toast('Welcome to Tracé Pro. All your decks are now saved online.');
        return;
      }
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
    if (!user && wantsUpgrade()) signInDialog('Create a free account or sign in first, then choose monthly or yearly.', '?upgrade=1');
    else if (!user && params.get('signin')) location.replace('/login');   // old "Sign in" links
    if (params.get('signin')) history.replaceState(null, '', location.pathname);
  });
  if (params.get('upgraded')) { history.replaceState(null, '', location.pathname); waitForPro(); }
  // "Get Pro" on the home page: /app?upgrade=1 (remembered across the email sign-in)
  if (params.get('upgrade')) { history.replaceState(null, '', location.pathname); try { localStorage.setItem('trace-want-upgrade', '1'); } catch (_) {} }
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
    if (row.owner_plan !== 'pro') present.insertAdjacentHTML('beforeend', '<a class="badge" href="/" target="_blank" rel="noopener"><svg viewBox="0 0 64 64" width="14" height="14" aria-hidden="true"><g fill="currentColor"><circle cx="13" cy="23" r="4.5"/><circle cx="22" cy="16" r="4.5"/><circle cx="32" cy="16" r="4.5"/><circle cx="42" cy="16" r="4.5"/><circle cx="52" cy="16" r="4.5"/><circle cx="32" cy="27" r="4.5"/><circle cx="32" cy="38" r="4.5"/></g><g fill="#3B5BFD"><circle cx="42" cy="49" r="6.5"/></g></svg>Made with <b>Tracé</b></a>');
    const end = document.createElement('div');
    end.id = 'vend'; end.hidden = true;
    end.innerHTML = `<h1>${esc(row.name)}</h1>${row.owner_name ? `<p>by ${esc(row.owner_name)}</p>` : ''}<p>You have reached the end.</p><div class="row" style="display:flex;gap:10px"><button class="btn" id="vAgain">Watch again</button><a class="btn primary" href="/">Make your own with Tracé</a></div>`;
    document.body.appendChild(end);
    $q('#vAgain').onclick = () => { end.hidden = true; openPresent(); };
    window.closePresent = function () { voiceStop(); finishAnim(); stopLoop(); end.hidden = false; };
    $q('#exitPres').textContent = 'Close';
    $q('#exitPres').onclick = e => { e.stopPropagation(); window.closePresent(); };
    const go = () => { cur = 0; openPresent(); };
    if (window.mjReady) go(); else { const prev = window.onMJ; window.onMJ = () => { prev && prev(); go(); }; setTimeout(() => { if ($q('#present').hidden && end.hidden) go(); }, 4000); }
  }
})();
