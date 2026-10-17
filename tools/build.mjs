// Builds public/i18n/<lang>.js from tools/i18n/strings.json.
// strings.json maps each English interface string to [French, Spanish, Portuguese, Arabic].
// In the keys, "#" stands for a number (outside links); digits are also treated as numbers,
// so "Slide 3 of 7" and "Slide # of #" find the same entry.
// Usage: node tools/i18n/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const here = new URL('.', import.meta.url);
const src = JSON.parse(readFileSync(new URL('strings.json', here), 'utf8'));
const out = new URL('../../public/i18n/', here);
mkdirSync(out, { recursive: true });
const P = '\u0001';
// numbers become P; a "#" inside href="…" is a link anchor and stays
const tpl = s => s.replace(/\s+/g, ' ').trim()
  .replace(/(href="[^"]*")|#|\d+/g, (m, href) => href || P);
const count = s => (s.match(/\u0001/g) || []).length;
const pieces = new Set(src.pieces);
src.langs.forEach((lang, li) => {
  const dict = {}, pc = [];
  let skipped = 0;
  for (const [en, tr] of Object.entries(src.strings)) {
    const k = tpl(en), v = tpl(tr[li]);
    if (count(k) !== count(v)) {
      // the translation writes a number as words (Arabic "3D"): keep it for this exact text only
      if (/#/.test(en.replace(/href="[^"]*"/g, ''))) { skipped++; continue; }
      dict[en.replace(/\s+/g, ' ').trim()] = tr[li].replace(/\s+/g, ' ').trim(); continue;
    }
    if (k === v) continue;
    dict[k] = v;
    if (pieces.has(en) && k.length >= 10 && /\s/.test(k)) pc.push([k, v]);
  }
  pc.sort((a, b) => b[0].length - a[0].length);
  const body = 'TRACE_I18N.add(' + JSON.stringify(dict) + ',' + JSON.stringify(pc) + ');\n';
  writeFileSync(new URL(lang + '.js', out), body);
  console.log(lang, Object.keys(dict).length, 'strings', (body.length / 1024).toFixed(0) + ' KB', skipped ? skipped + ' skipped' : '');
});
