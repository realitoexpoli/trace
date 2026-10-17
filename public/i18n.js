/* Tracé interface languages: English, French, Spanish, Portuguese, Arabic.
   Load it in <head> (not async). It picks the language (?lang=, then the saved choice, then the browser),
   loads i18n/<lang>.js from the same folder, and translates the page:
   - website pages call TRACE_I18N.page() once, before their own scripts, to translate whole paragraphs;
   - the editor calls TRACE_I18N.observe(), which translates text and tooltips as they appear.
   Slides, equations, project names and anything inside [translate="no"] are never touched. */
(function () {
  var LANGS = { en: 'English', fr: 'Français', es: 'Español', pt: 'Português', ar: 'العربية' };
  var KEY = 'trace-lang', P = '\u0001', NUM = /\d+/g;
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function pick() {
    var q = null;
    try { q = new URLSearchParams(location.search).get('lang'); } catch (e) {}
    if (q && LANGS[q]) { try { localStorage.setItem(KEY, q); } catch (e) {} return q; }
    var s = saved();
    if (s && LANGS[s]) return s;
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < list.length; i++) { var c = String(list[i] || '').slice(0, 2).toLowerCase(); if (LANGS[c]) return c; }
    return 'en';
  }
  var lang = pick(), D = null, PIECES = [];
  var me = document.currentScript, base = me && me.src ? me.src.replace(/[^\/]*(\?.*)?$/, '') : '/';
  var NOTE = {
    fr: 'Traduction fournie pour votre confort. En cas de différence, la version anglaise fait foi.',
    es: 'Traducción ofrecida para tu comodidad. Si hay diferencias, prevalece la versión en inglés.',
    pt: 'Tradução oferecida para sua conveniência. Em caso de diferença, vale a versão em inglês.',
    ar: 'هذه الترجمة للتيسير فقط. عند وجود أي اختلاف، تكون النسخة الإنجليزية هي المعتمدة.'
  };
  var NAMES = { fr: 'French', es: 'Spanish', pt: 'Portuguese (Brazil)', ar: 'Arabic' };

  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  // the translation of one piece of text, or null
  function look(s) {
    if (!D) return null;
    var n = norm(s);
    if (n.length < 2) return null;
    var hit = D[n];
    if (hit != null) return hit;
    var nums = n.match(NUM);
    if (!nums) return null;
    hit = D[n.replace(NUM, P)];
    if (hit == null) return null;
    var i = 0;
    return hit.replace(/\u0001/g, function () { return nums[i++] || ''; });
  }
  // longer messages built from known parts ("AI credits added. You have 55 credits.")
  function byPieces(n) {
    if (n.length < 12 || !PIECES.length) return null;
    var t = n.replace(NUM, P), changed = false, nums = n.match(NUM) || [];
    for (var i = 0; i < PIECES.length; i++) {
      var p = PIECES[i];
      if (t.indexOf(p[0]) >= 0) { t = t.split(p[0]).join(p[1]); changed = true; }
    }
    if (!changed) return null;
    var j = 0;
    return t.replace(/\u0001/g, function () { return nums[j++] || ''; });
  }
  // "Animates from slide 3: 2 moving, 1 new": every part is known on its own
  function byParts(n) {
    if (!/[:,;·] /.test(n)) return null;
    var bits = n.split(/(: |, |; | · )/), any = false;
    for (var i = 0; i < bits.length; i += 2) {
      var b = bits[i];
      if (!b || !/[A-Za-z]/.test(b)) continue;
      var r = look(b);
      if (r == null) return null;
      bits[i] = r; any = true;
    }
    return any ? bits.join('') : null;
  }
  function T(s) {
    if (lang === 'en' || s == null) return s;
    var str = String(s), m = str.match(/^(\s*)([\s\S]*?)(\s*)$/);
    var r = look(m[2]);
    if (r == null) r = byParts(norm(m[2]));
    if (r == null) r = byPieces(norm(m[2]));
    return r == null ? str : m[1] + r + m[3];
  }

  var SKIP = 'svg,canvas,script,style,textarea,code,pre,mjx-container,.katex,[translate="no"],.notranslate,#canvas,#pcanvas,.stage .frame,.pc-th,.tpl-th';
  var ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  var seen = typeof WeakMap === 'function' ? new WeakMap() : null;
  function textNode(t) {
    var v = t.nodeValue;
    if (!v || !/[A-Za-z]{2}/.test(v)) return;
    if (seen && seen.get(t) === v) return;
    var r = T(v);
    if (seen) seen.set(t, r);
    if (r !== v) t.nodeValue = r;
  }
  function attrs(e) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!e.hasAttribute(a)) continue;
      var v = e.getAttribute(a), mark = 'data-tr-' + a;
      if (e.getAttribute(mark) === v) continue;
      var r = T(v);
      if (r !== v) e.setAttribute(a, r);
      e.setAttribute(mark, r);
    }
  }
  function walk(n) {
    if (n.nodeType === 3) { var p = n.parentNode; if (p && p.nodeType === 1 && !(p.closest && p.closest(SKIP))) textNode(n); return; }
    if (n.nodeType !== 1 || (n.matches && n.matches(SKIP))) return;
    if (n.closest && n.parentNode && n.parentNode.closest && n.parentNode.closest(SKIP)) return;
    attrs(n);
    for (var c = n.firstChild; c; c = c.nextSibling) walkIn(c);
  }
  function walkIn(n) { // below an element already checked
    if (n.nodeType === 3) { textNode(n); return; }
    if (n.nodeType !== 1 || n.matches(SKIP)) return;
    attrs(n);
    for (var c = n.firstChild; c; c = c.nextSibling) walkIn(c);
  }
  var obs = null;
  function observe() {
    if (lang === 'en' || obs || !D) return;
    walk(document.body || document.documentElement);
    obs = new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (m.type === 'childList') { for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]); }
        else if (m.type === 'characterData') walk(m.target);
        else if (m.type === 'attributes' && ATTRS.indexOf(m.attributeName) >= 0) { if (!(m.target.closest && m.target.closest(SKIP))) attrs(m.target); }
      }
    });
    obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    var tt = document.querySelector('title');
    if (tt) { var r = T(tt.textContent); if (r !== tt.textContent) tt.textContent = r; }
  }

  // website pages: whole paragraphs (with their links and bold words) are translated at once
  var INL = { B: 1, I: 1, EM: 1, STRONG: 1, A: 1, CODE: 1, KBD: 1, SPAN: 1, BR: 1, SMALL: 1, SUP: 1, SUB: 1, MARK: 1, U: 1 };
  function inlineOnly(e) { for (var c = e.firstElementChild; c; c = c.nextElementSibling) { if (!INL[c.tagName] || !inlineOnly(c)) return false; } return true; }
  function blocks(n) {
    if (n.nodeType !== 1 || n.matches('script,style,svg,code,pre,[translate="no"]')) return;
    attrs(n);
    if (n.matches('meta[name=description],meta[property="og:title"],meta[property="og:description"]')) { var c = n.getAttribute('content'), r = look(c); if (r) n.setAttribute('content', r); }
    if (n.tagName === 'TITLE') { var tr = look(n.textContent); if (tr) n.textContent = tr; return; }
    var hasText = false;
    for (var t = n.firstChild; t; t = t.nextSibling) if (t.nodeType === 3 && norm(t.nodeValue)) { hasText = true; break; }
    if (!INL[n.tagName] && inlineOnly(n) && (hasText || n.firstElementChild) && norm(n.textContent)) {
      var h = look(n.innerHTML);
      if (h != null) { n.innerHTML = h; return; }
    }
    for (var k = n.firstElementChild; k; k = k.nextElementSibling) blocks(k);
  }
  function page() {
    if (lang !== 'en' && D) blocks(document.documentElement);
    var slots = document.querySelectorAll('[data-langslot]');
    if (!slots.length) { var f = document.querySelector('footer .wrap') || document.querySelector('footer'); if (f) slots = [f]; }
    for (var i = 0; i < slots.length; i++) slots[i].appendChild(picker('lang-pick'));
    if (lang === 'en' || !D) return;
    if (/\/(terms|privacy|refunds)(\.html)?$/.test(location.pathname) && NOTE[lang]) {
      var main = document.querySelector('main') || document.body, note = document.createElement('p');
      note.className = 'tr-note'; note.textContent = NOTE[lang];
      var h1 = main.querySelector('h1');
      if (h1 && h1.parentNode) h1.parentNode.insertBefore(note, h1.nextSibling); else main.insertBefore(note, main.firstChild);
    }
    observe();
  }

  function setLang(l) {
    if (!LANGS[l] || l === lang) return;
    try { localStorage.setItem(KEY, l); } catch (e) {}
    var u = new URL(location.href);
    if (u.searchParams.has('lang')) { u.searchParams.set('lang', l); location.replace(u.href); } else location.reload();
  }
  // a <select> listing the languages, each in its own language
  function picker(cls) {
    var s = document.createElement('select');
    s.className = cls || 'lang-pick';
    s.setAttribute('translate', 'no');
    s.setAttribute('aria-label', 'Language');
    for (var k in LANGS) { var o = document.createElement('option'); o.value = k; o.textContent = LANGS[k]; if (k === lang) o.selected = true; s.appendChild(o); }
    s.addEventListener('change', function () { setLang(s.value); });
    return s;
  }

  window.TRACE_I18N = {
    lang: lang, langs: LANGS, rtl: lang === 'ar', name: NAMES[lang] || 'English',
    T: T, page: page, observe: observe, setLang: setLang, picker: picker,
    add: function (d, pieces) { D = d; PIECES = pieces || []; }
  };
  if (lang !== 'en') {
    var html = document.documentElement;
    html.lang = lang === 'pt' ? 'pt-BR' : lang;
    if (lang === 'ar') html.dir = 'rtl';
    html.classList.add('lang-' + lang);
    document.write('<script src="' + base + 'i18n/' + lang + '.js"><\/script>');
  }
})();
