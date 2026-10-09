// Rebuilds public/app.html from the stand-alone editor (trace.html).
// The editor stays one file you can open anywhere; the SaaS version only adds three scripts
// (settings, Supabase, cloud.js) and links the logo to the home page.
// Usage: node tools/make-app.mjs path/to/trace.html
import { readFileSync, writeFileSync } from 'node:fs';
const src = process.argv[2];
if (!src) { console.error('Usage: node tools/make-app.mjs path/to/trace.html'); process.exit(1); }
let t = readFileSync(src, 'utf8');
const swap = (from, to) => { if (!t.includes(from)) throw new Error('Not found in the editor file: ' + from.slice(0, 60)); t = t.replace(from, to); };
swap('<title>Tracé: animated maths slides</title>', '<title>Tracé · editor</title>');
swap('<div class="brand" title="Tracé, a personal project"><b>Tracé</b><span>animated maths slides</span></div>',
     '<a class="brand" href="/" title="Tracé home" style="color:inherit;text-decoration:none"><b>Tracé</b><span>animated maths slides</span></a>');
swap('<button class="btn" id="undo"', '<a class="btn" id="helpLink" href="/guide/" target="_blank" rel="noopener" title="How to use Tracé">Help</a>\n  <button class="btn" id="undo"');
const end = '</script>\n</body>';
if (t.split(end).length !== 2) throw new Error('Expected exactly one closing script before </body>');
swap(end, '</script>\n<script src="/config.js"></script>\n<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>\n<script src="/cloud.js"></script>\n</body>');
writeFileSync(new URL('../public/app.html', import.meta.url), t);
console.log('public/app.html rebuilt from', src);
