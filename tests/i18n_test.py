"""Run: python3 tests/editor/i18n_test.py <editor URL, e.g. file:///tmp/trace_test.html>
Interface languages: the editor in French, Spanish, Portuguese and Arabic (right to left), the language picker,
tours and messages in the chosen language, numbers kept, slides and project names never translated,
English untouched. The runtime (public/i18n.js) and dictionaries (public/i18n/) are copied next to the editor file."""
import asyncio, sys, os, shutil
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///tmp/trace_test.html'
PUB = os.path.join(os.path.dirname(__file__), '..', '..', 'public')
if URL.startswith('file://'):
    d = os.path.dirname(URL[7:])
    shutil.copy(os.path.join(PUB, 'i18n.js'), d)
    shutil.copytree(os.path.join(PUB, 'i18n'), os.path.join(d, 'i18n'), dirs_exist_ok=True)
passed = []
def check(ok, what):
    if not ok: raise AssertionError('FAIL: ' + what)
    passed.append(what); print('  ok ', what, flush=True)

async def open_in(b, lang, locale='en-US'):
    ctx = await b.new_context(viewport={'width': 1440, 'height': 860}, locale=locale)
    await ctx.add_init_script("try{localStorage.setItem('trace-toured','1')}catch(e){}")
    pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    q = f'?lang={lang}' if lang else ''
    await pg.goto(URL + q + '#edit'); await pg.wait_for_timeout(1500)
    return ctx, pg, errs

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # English: nothing changes
        ctx, pg, errs = await open_in(b, None)
        r = await pg.evaluate("()=>({lang:TRACE_I18N.lang,dir:document.documentElement.dir,write:document.querySelector('[data-menu=lib]')?.textContent.trim(),n:document.querySelectorAll('.lang-pick option').length})")
        check(r['lang'] == 'en' and r['dir'] == '' and r['write'] == 'Library', f'an English browser gets the English editor {r}')
        check(r['n'] >= 5, 'the language picker lists English, French, Spanish, Portuguese and Arabic')
        check(not errs, f'no errors in English {errs}')
        await ctx.close()

        # the browser language is followed when nothing was chosen
        ctx, pg, errs = await open_in(b, None, 'es-ES')
        check(await pg.evaluate("TRACE_I18N.lang") == 'es', 'a Spanish browser opens the editor in Spanish')
        check(await pg.evaluate("document.querySelector('[data-menu=lib]').textContent.trim()") == 'Biblioteca', 'menus are in Spanish')
        await ctx.close()

        # French
        ctx, pg, errs = await open_in(b, 'fr')
        r = await pg.evaluate("()=>({html:document.documentElement.lang,write:document.querySelector('[data-menu=lib]').textContent.trim(),present:document.querySelector('#presentBtn')?.textContent.trim()})")
        check(r['html'] == 'fr' and r['write'] == 'Bibliothèque', f'?lang=fr gives the French editor {r}')
        check(await pg.evaluate("localStorage.getItem('trace-lang')") == 'fr', 'the choice is remembered')
        await pg.evaluate("()=>{createProject('Graph',blankDeck());addObj('text');const o=slide().objects.at(-1);o.text='Graph';sel=o.id;renderProps();refresh();}"); await pg.wait_for_timeout(400)
        r = await pg.evaluate("()=>({canvas:[...document.querySelectorAll('#canvas text, #canvas tspan')].some(t=>t.textContent.includes('Graph')),inp:document.querySelector('#projName').value})")
        check(r['canvas'], 'text on the slide is never translated')
        check(r['inp'] == 'Graph', 'the project name stays as typed')
        await pg.evaluate("showHome()"); await pg.wait_for_timeout(500)
        check(await pg.evaluate("[...document.querySelectorAll('.pc-meta b')].some(b=>b.textContent==='Graph')"), 'project names on the projects page stay as typed')
        await pg.evaluate("showEditor()"); await pg.wait_for_timeout(300)
        await pg.evaluate("toast('Saved as a picture.')"); await pg.wait_for_timeout(100)
        t = await pg.evaluate("TRACE_I18N.T('Step 3 of 7')")
        check(t == 'Étape 3 sur 7', f'numbers are kept inside translated text ({t})')
        t = await pg.evaluate("TRACE_I18N.T('Animates from slide 3: 2 moving, 1 new')")
        check(t.startswith('Animation depuis la diapositive 3') and '2 en mouvement' in t and '1 nouveaux' in t, f'labels made of parts are translated part by part ({t})')
        check(await pg.evaluate("TRACE_I18N.T('Some words nobody wrote')") == 'Some words nobody wrote', 'unknown text is left as it is')
        await pg.evaluate("startTour('screen')"); await pg.wait_for_timeout(500)
        r = await pg.evaluate("()=>{const c=document.querySelector('.tour-card,#tourCard')||document.querySelector('[data-tb=next]')?.closest('div');return c?c.textContent:''}")
        check('Étape' in r or 'Suivant' in r, f'tour cards are in French ({r[:80]})')
        await pg.evaluate("endTour()")
        await pg.evaluate("()=>{const o=slide().objects.at(-1);sel=o.id;renderProps();}"); await pg.wait_for_timeout(300)
        r = await pg.evaluate("document.querySelector('#props').textContent")
        check('Contenu' in r, 'the settings panel is in French')
        sel = await pg.evaluate("document.querySelector('.mm-lang .lang-pick')?.value")
        check(sel == 'fr', 'the picker in the ⋯ menu shows French')
        check(not errs, f'no errors in French {errs}')
        await ctx.close()

        # Portuguese and Arabic
        ctx, pg, errs = await open_in(b, 'pt')
        check(await pg.evaluate("document.querySelector('[data-menu=lib]').textContent.trim()") == 'Biblioteca' and await pg.evaluate("document.documentElement.lang") == 'pt-BR', 'Portuguese (Brazil) works')
        await ctx.close()
        ctx, pg, errs = await open_in(b, 'ar')
        r = await pg.evaluate("()=>({dir:document.documentElement.dir,stage:getComputedStyle(document.querySelector('#canvas')).direction,write:document.querySelector('[data-menu=lib]').textContent.trim()})")
        check(r['dir'] == 'rtl' and r['write'] == 'المكتبة', f'Arabic reads right to left {r}')
        check(r['stage'] == 'ltr', 'the slide itself stays left to right')
        # switching the language from the picker
        await pg.evaluate("()=>{const s=document.querySelector('.home-lang .lang-pick')||document.querySelector('.lang-pick');s.value='en';s.dispatchEvent(new Event('change'))}")
        await pg.wait_for_timeout(1500)
        r = await pg.evaluate("()=>({lang:TRACE_I18N.lang,dir:document.documentElement.dir})")
        check(r['lang'] == 'en' and r['dir'] == '', f'choosing English in the picker switches back {r}')
        check(not errs, f'no errors in Arabic {errs}')
        await ctx.close()
        await b.close()
    print(f'ALL {len(passed)} LANGUAGE CHECKS PASSED')

asyncio.run(main())
