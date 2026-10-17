"""Run: python3 tests/editor/objects_test.py <editor URL, e.g. file:///path/trace.html>
The newer objects: mechanics (inclined plane, free-body diagram, spring, pendulum, pulley), probability
distributions, the derivative explorer, Fourier drawing and imported 3D models (Pro), plus the
PowerPoint-style footer (date, text, slide number) on the slide, the thumbnails and when presenting."""
import asyncio, sys, os, struct, tempfile, math
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///tmp/trace_test.html'
passed = []
def check(ok, what):
    if not ok: raise AssertionError('FAIL: ' + what)
    passed.append(what); print('  ok ', what, flush=True)

TMP = tempfile.mkdtemp()
CUBE = os.path.join(TMP, 'cube.obj')
open(CUBE, 'w').write('# a cube\n' + ''.join(f'v {x} {y} {z}\n' for x in (0, 1) for y in (0, 1) for z in (0, 1)) +
    'f 1 2 4 3\nf 5 7 8 6\nf 1 5 6 2\nf 3 4 8 7\nf 1 3 7 5\nf 2 6 8 4\n')
STL = os.path.join(TMP, 'tetra.stl')
tri = [((0, 0, 0), (1, 0, 0), (0, 1, 0)), ((0, 0, 0), (0, 1, 0), (0, 0, 1)), ((0, 0, 0), (0, 0, 1), (1, 0, 0)), ((1, 0, 0), (0, 0, 1), (0, 1, 0))]
with open(STL, 'wb') as fh:
    fh.write(b'\0' * 80 + struct.pack('<I', len(tri)))
    for t in tri: fh.write(struct.pack('<3f', 0, 0, 0) + b''.join(struct.pack('<3f', *v) for v in t) + b'\0\0')
BIG = os.path.join(TMP, 'sphere.obj')
with open(BIG, 'w') as fh:   # about 20,000 triangles
    nu, nv = 100, 100
    for i in range(nu + 1):
        for j in range(nv):
            th, ph = math.pi * i / nu, 2 * math.pi * j / nv
            fh.write(f'v {math.sin(th)*math.cos(ph):.5f} {math.cos(th):.5f} {math.sin(th)*math.sin(ph):.5f}\n')
    for i in range(nu):
        for j in range(nv):
            a, b2, c, d = i*nv+j+1, i*nv+(j+1) % nv+1, (i+1)*nv+(j+1) % nv+1, (i+1)*nv+j+1
            fh.write(f'f {a} {b2} {c}\nf {a} {c} {d}\n')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 1440, 'height': 860})
        await ctx.add_init_script("try{localStorage.setItem('trace-toured','1')}catch(e){}")
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL + '#edit'); await pg.wait_for_timeout(1500)
        await pg.evaluate("()=>{createProject('Objects',blankDeck());}"); await pg.wait_for_timeout(400)

        # the menus
        await pg.click('#tools .tool:has-text("Science")'); await pg.wait_for_timeout(200)
        txt = await pg.inner_text('#tools .menu:not([hidden])')
        check(all(t.lower() in txt.lower() for t in ['Mechanics', 'Inclined plane', 'Free-body diagram', 'Spring and mass', 'Pendulum', 'Pulley']), 'Science has a Mechanics section with five objects')
        await pg.click('#tools .menu:not([hidden]) [data-t="incline"]'); await pg.wait_for_timeout(400)
        check(await pg.evaluate("slide().objects.at(-1).type") == 'incline', 'choosing Inclined plane adds it')
        await pg.click('#tools .tool:has-text("Plot")'); await pg.wait_for_timeout(200)
        txt = await pg.inner_text('#tools .menu:not([hidden])')
        check('Probability distribution' in txt and 'Derivative explorer' in txt and 'Fourier drawing' in txt and await pg.evaluate("!!document.querySelector('[data-t=fourier] .protag')&&!!document.querySelector('[data-t=deriv] .protag')&&!document.querySelector('[data-t=dist] .protag')"), 'Plot has distributions (free), the derivative explorer and Fourier drawing (Pro)')
        await pg.keyboard.press('Escape')
        await pg.click('#tools .tool:has-text("3D")'); await pg.wait_for_timeout(200)
        check('Import a 3D model' in await pg.inner_text('#tools .menu:not([hidden])'), '3D has "Import a 3D model"')
        await pg.keyboard.press('Escape')

        # every object draws, and its settings change the drawing
        for t in ['fbd', 'spring', 'pendulum', 'pulley', 'dist', 'deriv', 'fourier']:
            await pg.evaluate(f"()=>{{newSlide();addObj('{t}');}}"); await pg.wait_for_timeout(250)
            n = await pg.evaluate("document.querySelectorAll('#canvas .obj path, #canvas path').length")
            check(n > (0 if t == 'fourier' else 6), f'{t} draws ({n} shapes)')
        before = await pg.evaluate("document.querySelector('#canvas').innerHTML.length")
        await pg.evaluate("()=>{newSlide();addObj('pendulum');}"); await pg.wait_for_timeout(200)
        a0 = await pg.evaluate("document.querySelector('#canvas').innerHTML")
        await pg.fill('#f_ang', '-40'); await pg.dispatch_event('#f_ang', 'input'); await pg.wait_for_timeout(250)
        check(await pg.evaluate("slide().objects[0].ang") == -40 and await pg.evaluate("document.querySelector('#canvas').innerHTML") != a0, 'the pendulum angle setting moves the pendulum')

        # animation: numbers in between, and the "Keep going" loops
        mid = await pg.evaluate("()=>{const a=make('fourier'),b={...a,prog:1};a.prog=0;return interp(a,b,0.5).prog}")
        check(abs(mid - 0.5) < 1e-9, 'a Fourier drawing half-way through a click is half drawn')
        sw = await pg.evaluate("()=>{const o={...make('pendulum'),loop:'flow',loopTime:2};return [withLoop(o,0).ang,withLoop(o,1).ang,withLoop(o,1.999999).ang]}")
        check(abs(sw[0] - 25) < 1e-6 and abs(sw[1] + 25) < 1e-6 and abs(sw[2] - 25) < 1e-6, f'"Keep swinging" swings the pendulum from +25° to −25° and back {sw}')
        osc = await pg.evaluate("()=>{const o={...make('spring'),loop:'flow',loopTime:2};return withLoop(o,0.5).ext}")
        check(abs(osc - 0.8) < 1e-6, 'a spring set to "Keep oscillating" stretches and compresses')

        # probability values
        pr = await pg.evaluate("""()=>{const P=(o,a,b)=>distProb(distInfo({...make('dist'),...o}),a,b);return[P({},-1,1),P({kind:'binomial',nn:10,pp:0.5},4,6),P({kind:'poisson',lam:3},0,2),P({kind:'exponential',rate:1},0,1),P({kind:'uniform',ua:0,ub:4},1,2),P({mu:100,sig:15},85,115)]}""")
        exp = [0.682689, 0.65625, 0.423190, 0.632121, 0.25, 0.682689]
        check(all(abs(a - e) < 2e-4 for a, e in zip(pr, exp)), f'probabilities are right (normal, binomial, Poisson, exponential, uniform) {[round(x, 5) for x in pr]}')

        # Pro gates
        await pg.evaluate("()=>{window.__up=[];PLAN.pro=false;PLAN.upgrade=w=>window.__up.push(w);planChanged();}")
        n0 = await pg.evaluate("slide().objects.length")
        await pg.evaluate("()=>{addObj('fourier');addObj('deriv');addObj('model3d');}")
        check(await pg.evaluate("slide().objects.length") == n0 and await pg.evaluate("window.__up") == ['fourier', 'deriv', 'model3d'], 'on Free, Fourier drawing, the derivative explorer and 3D import open the Pro offer instead')
        await pg.evaluate("()=>{addObj('pendulum');addObj('dist');}")
        check(await pg.evaluate("slide().objects.length") == n0 + 2, 'mechanics and distributions stay free')
        await pg.evaluate("()=>{PLAN.pro=true;planChanged();}")

        # 3D models
        await pg.evaluate("()=>{newSlide();}")
        async with pg.expect_file_chooser() as fc:
            await pg.evaluate("addObj('model3d')")
        await (await fc.value).set_files(CUBE); await pg.wait_for_timeout(700)
        m = await pg.evaluate("()=>{const o=slide().objects.at(-1);return{t:o.type,id:o.meshId,name:o.name,stored:!!IMG.get(o.meshId),paths:document.querySelectorAll('#canvas path').length,faces:JSON.parse(IMG.get(o.meshId)).f.length/3}}")
        check(m['t'] == 'model3d' and m['stored'] and m['name'] == 'cube' and m['faces'] == 12, f'an OBJ cube imports with its 12 triangles {m}')
        check(m['paths'] >= 12, 'the model is drawn shaded')
        check(await pg.evaluate("deckWithImages(deck).images && Object.keys(deckWithImages(deck).images).includes(slide().objects.at(-1).meshId)"), 'the model is saved with the deck (online and in the project file)')
        spin = await pg.evaluate("()=>{const o={...slide().objects.at(-1),loop:'flow',loopTime:4};return withLoop(o,1).az-o.az}")
        check(abs(spin - 90) < 1e-6, '"Keep turning" spins the model')
        async with pg.expect_file_chooser() as fc:
            await pg.evaluate("addObj('model3d')")
        await (await fc.value).set_files(STL); await pg.wait_for_timeout(600)
        check(await pg.evaluate("JSON.parse(IMG.get(slide().objects.at(-1).meshId)).f.length/3") == 4, 'a binary STL file imports')
        async with pg.expect_file_chooser() as fc:
            await pg.evaluate("addObj('model3d')")
        await (await fc.value).set_files(BIG); await pg.wait_for_timeout(2500)
        nf = await pg.evaluate("JSON.parse(IMG.get(slide().objects.at(-1).meshId)).f.length/3")
        check(200 < nf <= 2500, f'a 20,000-triangle model is simplified to {nf} triangles so it stays fast')
        await pg.evaluate("()=>{sel=slide().objects.at(-1).id;renderProps();}"); await pg.wait_for_timeout(200)
        check(await pg.is_visible('#swapModel'), 'a selected model can be swapped for another file')

        # Python script: never breaks on the new objects
        ok = await pg.evaluate("()=>SCI2.every(t=>typeof mob({...make(t)})==='string')")
        check(ok, 'the Python script still builds with the new objects in a deck')

        # footer, date and slide number
        await pg.evaluate("()=>{cur=0;sel=null;editStep=null;refresh();showPane('slide');}"); await pg.wait_for_timeout(300)
        check(await pg.is_visible('#footBox'), 'Slide settings have "Footer, date and slide number"')
        await pg.check('#ft_num'); await pg.fill('#ft_text', 'Physics · Year 11'); await pg.select_option('#ft_date', 'fixed'); await pg.wait_for_timeout(200)
        await pg.fill('#ft_dt', '17 October 2026'); await pg.wait_for_timeout(600)
        foot = await pg.evaluate("[...document.querySelectorAll('#canvas text')].map(t=>t.textContent)")
        check('1' in foot and 'Physics · Year 11' in foot and '17 October 2026' in foot, f'the slide shows the number, the footer text and the date {foot[-3:]}')
        th = await pg.evaluate("[...document.querySelectorAll('#thumbs .thumb > svg')].map(s=>[...s.querySelectorAll('text')].map(t=>t.textContent))")
        check(len(th) > 2 and '3' in th[2], 'each thumbnail shows its own slide number')
        await pg.check('#ft_total'); await pg.check('#ft_skip'); await pg.wait_for_timeout(500)
        check(not any('Physics' in t for t in await pg.evaluate("[...document.querySelectorAll('#canvas text')].map(t=>t.textContent)")), '"Not on the title slide" hides it on slide 1')
        n = await pg.evaluate("deck.slides.length")
        await pg.evaluate("()=>{cur=2;refresh();}"); await pg.wait_for_timeout(300)
        check(f'3 / {n}' in await pg.evaluate("[...document.querySelectorAll('#canvas text')].map(t=>t.textContent)"), f'"3 / {n}" style numbering works')
        await pg.evaluate("openPresent && openPresent()"); await pg.wait_for_timeout(1200)
        await pg.evaluate("presAt(1,false)"); await pg.wait_for_timeout(400)
        check(f'2 / {n}' in await pg.evaluate("[...document.querySelectorAll('#present svg text')].map(t=>t.textContent)"), 'presenting shows the slide number too')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await pg.evaluate("()=>{cur=1;refresh();}"); await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(300)
        check(await pg.evaluate("!deck.footer || !deck.footer.skipFirst"), 'footer changes can be undone')
        await pg.screenshot(path=sys.argv[2] if len(sys.argv) > 2 else '/tmp/objects.png')
        check(not errs, 'no page errors: ' + '; '.join(errs[:3]))
        await b.close()
    print(f'PASSED {len(passed)} checks')
asyncio.run(main())
