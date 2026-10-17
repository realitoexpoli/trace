// Rebuilds public/app.html from the stand-alone editor (trace.html).
// The editor stays one file you can open anywhere; the SaaS version only adds four scripts
// (settings, Supabase, profile-ui.js, cloud.js) and links the projects page's logo to the website's home page.
// Usage: node tools/make-app.mjs path/to/trace.html
import { readFileSync, writeFileSync } from 'node:fs';
const src = process.argv[2];
if (!src) { console.error('Usage: node tools/make-app.mjs path/to/trace.html'); process.exit(1); }
let t = readFileSync(src, 'utf8');
const swap = (from, to) => { if (!t.includes(from)) throw new Error('Not found in the editor file: ' + from.slice(0, 60)); t = t.replace(from, to); };
// languages: load the runtime from the site root so it also works on /v/ share links
swap('<script src="i18n.js"></script>', '<script src="/i18n.js"></script>');
swap('<title>Tracé: animated maths slides</title>', '<title>Tracé · editor</title>');
// the logo on the projects page leads back to the website's home page
swap('<span class="home-logo">', '<a class="home-logo" href="/" title="Tracé home" aria-label="Tracé home">');
swap('</svg></span><div class="home-search">', '</svg></a><div class="home-search">');
const end = '</script>\n</body>';
if (t.split(end).length !== 2) throw new Error('Expected exactly one closing script before </body>');
swap(end, '</script>\n<script src="/config.js"></script>\n<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>\n<script src="/profile-ui.js"></script>\n<script src="/cloud.js"></script>\n</body>');
writeFileSync(new URL('../public/app.html', import.meta.url), t);
console.log('public/app.html rebuilt from', src);
