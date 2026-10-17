// The AI deck builder: the instructions given to the model, and a strict clean-up of what it sends back.
// The model never writes Tracé's internal format directly: it fills in this small, checked "spec",
// which the editor turns into real objects (see specToSlides in the editor).

export const KINDS = ['text', 'bullets', 'equation', 'steps', 'graph', 'shape', 'vector', 'counter', 'chart', 'venn'];
const SHAPES = ['circle', 'rect', 'star', 'triangle', 'arrow', 'line', 'dot'];
const NAMED = { white: '#FFFFFF', blue: '#58C4DD', teal: '#5CD0B3', green: '#83C167', yellow: '#F4D345', orange: '#FF862F', red: '#FC6255', pink: '#C55F73', purple: '#9A72AC', grey: '#888888', gray: '#888888' };

export function systemPrompt(size = '16:9') {
  const v = size === '9:16', W = v ? 4 : 7, H = v ? 7 : 4;
  return `You design animated slides for Tracé, a presentation tool for teachers (mostly maths and science, but any subject).
Answer with ONE JSON object and nothing else (no prose, no code fences).
Write the JSON compactly: no indentation or line breaks, and leave out any field you do not need (it has a sensible default). At most 8 slides and 8 items per slide.

Shape of the answer:
{"title": "deck title", "slides": [ {"title": "slide title", "items": [ ...items ] } ]}

Coordinates: the slide is ${2 * W} units wide and ${2 * H} tall, x from -${W} (left) to ${W} (right), y from -${H} (bottom) to ${H} (top). The slide title is placed for you at the top (y≈${H - 0.7}); keep items between y=-${H - 0.4} and y=${H - 1.4} and do not let them overlap.
"click": 0 means the item is there when the slide opens; 1, 2, 3… means it appears on that click. Build ideas step by step with clicks.
"id" (optional, short, letters/digits): give the same id to an item on two consecutive slides and Tracé animates it moving or changing between them.
Colours: white, blue, teal, green, yellow, orange, red, pink, purple, grey (or #RRGGBB). The background is black.

Items (all numbers in slide units; "size" is a font size, 20 to 60):
- {"kind":"text","text":"…","x":0,"y":1,"size":32,"color":"white","click":0}
- {"kind":"bullets","items":["…","…"],"x":0,"y":0,"size":30,"reveal":true}  (reveal: one bullet per click)
- {"kind":"equation","math":"y = x^2 - 3x + 2","x":0,"y":2,"size":44,"click":0}  (calculator style: ^ * / sqrt() sin() pi; or use "latex" instead of "math")
- {"kind":"steps","lines":["2x^2-3x-5=0","(2x-5)(x+1)=0","x=\\\\tfrac{5}{2}\\\\ \\\\text{or}\\\\ x=-1"],"x":0,"y":2,"size":40,"click":1}  (LaTeX working, one line per click, stacked downwards, the last line highlighted; at most 7 lines)
- {"kind":"graph","fn":"sin(x)","xmin":-6,"xmax":6,"ymin":-2,"ymax":2,"x":0,"y":-1,"w":9,"h":4.5,"click":1,"point":2}  (fn in x; point = x of a marked point, optional; the curve draws itself)
- {"kind":"shape","shape":"circle|rect|star|triangle|arrow|line|dot","x":0,"y":0,"size":1,"w":3,"h":2,"dx":2,"dy":0,"color":"blue","fill":0.3,"click":0}
- {"kind":"vector","x":-2,"y":-1,"dx":3,"dy":2,"label":"\\\\vec v","color":"yellow","click":0}  (x,y = tail)
- {"kind":"counter","value":100,"prefix":"","suffix":" %","decimals":0,"x":0,"y":0,"size":60,"click":1}  (counts up)
- {"kind":"chart","type":"bar|line","data":[["Mon",3],["Tue",5]],"x":0,"y":-1,"w":8,"h":4.5,"click":0}
- {"kind":"venn","labels":["A","B"],"shade":"union|intersection|none","x":0,"y":-0.5,"click":0}

Solving: when asked to solve an equation (or a problem leading to one), first state the problem, then show the working with a "steps" item, one operation per line, with a short text item saying the method (e.g. "Factorise", "Use the quadratic formula"). Do the algebra carefully and never guess. Finish with the answer, and for an equation in one variable add a graph of both sides or of left minus right with a solution marked. On the slide with the answer add, next to "items":
"check": {"equation": "2x^2 - 3x - 5 = 0", "var": "x", "answers": [-1, 2.5]}  (the ORIGINAL equation in calculator style, and EVERY real solution as a decimal; use "none": true instead of answers if there is no real solution). Tracé substitutes the answers back to check them.

Good decks: 4 to 8 slides unless asked otherwise, short text (no paragraphs), one idea per slide, a graph or picture on most maths slides, the key result appearing on a click, accurate maths.`;
}

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v, max) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').slice(0, max);
const color = v => { const s = str(v, 20).trim(); if (/^#[0-9a-f]{6}$/i.test(s)) return s.toUpperCase(); return NAMED[s.toLowerCase()] || null; };
const id = v => { const s = str(v, 24).toLowerCase().replace(/[^a-z0-9_]/g, ''); return s || null; };
// calculator-style maths and graph functions: letters, digits, operators, brackets and a few symbols only
const plain = v => str(v, 160).replace(/[^A-Za-z0-9 +\-*/^().,=_|'<>!θπ√²³]/g, '');
// LaTeX: drop commands that could load anything or style the page
const latex = v => str(v, 300).replace(/\\(href|url|html|class|style|cssId|require|unicode|data|input|include)\b/gi, '');

export function sanitizeSpec(raw, size = '16:9') {
  const v = size === '9:16', W = v ? 4 : 7.1, H = v ? 7.1 : 4;
  const out = { title: str(raw && raw.title, 80).trim() || 'New presentation', slides: [] };
  const slides = Array.isArray(raw && raw.slides) ? raw.slides.slice(0, 15) : [];
  for (const s of slides) {
    const items = [];
    for (const it of (Array.isArray(s && s.items) ? s.items : []).slice(0, 16)) {
      if (!it || !KINDS.includes(it.kind)) continue;
      const o = { kind: it.kind, x: num(it.x, -W, W, 0), y: num(it.y, -H, H, 0), click: Math.round(num(it.click, 0, 12, 0)) };
      const c = color(it.color); if (c) o.color = c;
      const i2 = id(it.id); if (i2) o.id = i2;
      if (it.size != null) o.size = num(it.size, 12, 96, 32);
      switch (it.kind) {
        case 'text': o.text = str(it.text, 300); if (!o.text.trim()) continue; break;
        case 'steps': o.lines = (Array.isArray(it.lines) ? it.lines : []).slice(0, 8).map(t => latex(t)).filter(t => t.trim()); if (!o.lines.length) continue; break;
        case 'bullets': o.items = (Array.isArray(it.items) ? it.items : []).slice(0, 8).map(t => str(t, 160)).filter(t => t.trim()); if (!o.items.length) continue; o.reveal = it.reveal !== false; break;
        case 'equation': if (it.latex) o.latex = latex(it.latex); else o.math = plain(it.math); if (!(o.latex || o.math || '').trim()) continue; break;
        case 'graph': o.fn = plain(it.fn) || 'sin(x)'; o.xmin = num(it.xmin, -1e4, 1e4, -5); o.xmax = num(it.xmax, -1e4, 1e4, 5); o.ymin = num(it.ymin, -1e4, 1e4, -3); o.ymax = num(it.ymax, -1e4, 1e4, 3);
          if (o.xmax <= o.xmin) [o.xmin, o.xmax] = [-5, 5]; if (o.ymax <= o.ymin) [o.ymin, o.ymax] = [-3, 3];
          o.w = num(it.w, 2, 2 * W, 8); o.h = num(it.h, 1.5, 2 * H, 4.5); if (it.point != null && Number.isFinite(Number(it.point))) o.point = num(it.point, o.xmin, o.xmax, 0); break;
        case 'shape': o.shape = SHAPES.includes(it.shape) ? it.shape : 'circle'; o.size = num(it.size, 0.1, 6, 1); o.w = num(it.w, 0.1, 2 * W, 3); o.h = num(it.h, 0.1, 2 * H, 2);
          o.dx = num(it.dx, -2 * W, 2 * W, 2); o.dy = num(it.dy, -2 * H, 2 * H, 0); o.fill = num(it.fill, 0, 1, 0); break;
        case 'vector': o.dx = num(it.dx, -2 * W, 2 * W, 2); o.dy = num(it.dy, -2 * H, 2 * H, 1); o.label = latex(it.label || ''); break;
        case 'counter': o.value = num(it.value, -1e9, 1e9, 100); o.decimals = Math.round(num(it.decimals, 0, 4, 0)); o.prefix = str(it.prefix, 30); o.suffix = str(it.suffix, 30); break;
        case 'chart': o.type = it.type === 'line' ? 'line' : 'bar'; o.data = (Array.isArray(it.data) ? it.data : []).slice(0, 12).map(r => [str(Array.isArray(r) ? r[0] : '', 20).replace(/[,\n]/g, ' '), num(Array.isArray(r) ? r[1] : 0, -1e9, 1e9, 0)]);
          if (!o.data.length) continue; o.w = num(it.w, 2, 2 * W, 8); o.h = num(it.h, 1.5, 2 * H, 4.5); break;
        case 'venn': o.labels = (Array.isArray(it.labels) ? it.labels : ['A', 'B']).slice(0, 3).map(t => str(t, 12).replace(/,/g, ' ')); o.shade = ['union', 'intersection', 'none'].includes(it.shade) ? it.shade : 'intersection'; break;
      }
      items.push(o);
    }
    const sl = { title: str(s && s.title, 90).trim(), items };
    const ck = s && s.check;
    if (ck && typeof ck === 'object' && /=/.test(String(ck.equation || ''))) {
      sl.check = { equation: plain(ck.equation), var: /^[a-z]$/.test(ck.var) ? ck.var : 'x' };
      if (ck.none === true) sl.check.none = true;
      else sl.check.answers = (Array.isArray(ck.answers) ? ck.answers : [ck.answers]).map(Number).filter(Number.isFinite).slice(0, 8);
    }
    out.slides.push(sl);
  }
  return out;
}

// Pulls the first JSON object out of the model's answer (in case it added a code fence or a sentence).
export function extractJSON(text) {
  const t = String(text || ''); const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0) return null;
  if (b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return salvageJSON(t.slice(a));
}

// An answer cut off by the length limit: keep everything up to the last complete value,
// close the open brackets, and drop the last (unfinished) slide.
export function salvageJSON(t) {
  const stack = []; let inStr = false, esc = false, cut = -1, cutStack = null;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') { stack.pop(); if (stack.length) { cut = i + 1; cutStack = stack.slice(); } }
  }
  if (cut < 0) return null;
  const inSlide = cutStack.length > 2; // cut inside a slide, not between two slides
  const close = cutStack.reverse().map(c => (c === '{' ? '}' : ']')).join('');
  let o; try { o = JSON.parse(t.slice(0, cut) + close); } catch { return null; }
  if (inSlide && o && Array.isArray(o.slides) && o.slides.length > 1) o.slides.pop();
  return o;
}
