"""Run: python3 tests/editor/drawing_test.py <editor URL, e.g. file:///path/trace.html>
Drawings: the library, importing SVG (safely), recolouring, drawing itself, morphing,
travelling along a path facing forward with a trail, and the Python export."""
import asyncio, sys, ast
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///tmp/trace_test.html'
passed = []
def check(ok, what):
    if not ok: raise AssertionError('FAIL: ' + what)
    passed.append(what); print('  ok ', what, flush=True)
SVG = '''<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 100" onload="window.__pwned=1">
<style>.a{fill:#ff0000}.b{stroke:#00ff00;stroke-width:4;fill:none}</style>
<defs><linearGradient id="g"><stop offset="0" stop-color="#0000ff"/><stop offset="1" stop-color="#00ffff"/></linearGradient><circle id="dot" r="5"/></defs>
<script>window.__pwned=2</script>
<g transform="translate(20 10) scale(2)"><rect class="a" x="0" y="0" width="20" height="10"/></g>
<circle cx="120" cy="50" r="30" fill="url(#g)"/>
<path class="b" d="M10 90 L190 90"/>
<use href="#dot" x="170" y="20" fill="#ffff00"/>
<text x="10" y="50">ignored</text>
<image href="https://example.com/x.png" x="0" y="0" width="10" height="10"/>
</svg>'''
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
        await ctx.add_init_script("try{localStorage.setItem('trace-toured','1')}catch(e){}")
        pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL + '#edit'); await pg.wait_for_timeout(1200)
        await pg.evaluate("()=>{createProject('Drawings',blankDeck());refresh();}")
        # library
        check(await pg.evaluate("Object.keys(LIB).length") >= 35, 'the library has more than 35 drawings')
        await pg.click('[data-menu="lib"]'); await pg.wait_for_timeout(200)
        await pg.fill('#libSearch', 'magnet'); await pg.wait_for_timeout(100)
        check(await pg.evaluate("document.querySelectorAll('.libtile').length") == 1, 'searching the library finds the magnet')
        await pg.fill('#libSearch', 'newton'); await pg.wait_for_timeout(100)
        check(await pg.evaluate("[...document.querySelectorAll('.libtile')].map(t=>t.dataset.lib).join()") == 'apple', 'search also looks at tags (newton → apple)')
        await pg.fill('#libSearch', 'rocket'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(300)
        o = await pg.evaluate("(()=>{const o=slide().objects.at(-1);return o&&[o.type,o.lib,o.nose,sel===o.id]})()")
        check(o == ['drawing', 'rocket', 90, True], f'Enter adds the first result, selected, with its front pointing up {o}')
        check(await pg.evaluate("objEl(slide().objects.at(-1)).querySelectorAll('path').length") >= 8, 'the rocket is drawn as vector shapes')
        check('Rocket' in await pg.inner_text('#props h2') and await pg.evaluate("objName(slide().objects.at(-1))") == 'Rocket', 'the settings and the object list call it “Rocket”')
        # change drawing
        await pg.click('#swapDrawing'); await pg.wait_for_timeout(200)
        await pg.click('.libtile[data-lib="car"]'); await pg.wait_for_timeout(200)
        check(await pg.evaluate("slide().objects.length===1 && slide().objects[0].lib==='car'"), '“Change drawing…” swaps the drawing in place')
        await pg.evaluate("()=>{const o=slide().objects[0];o.lib='rocket';o.nose=90;refresh();}")
        # one colour
        await pg.evaluate("showPane('style')")
        await pg.select_option('#props select[data-k="paint"]', 'one'); await pg.wait_for_timeout(200)
        check(await pg.is_visible('#props [data-ck="color"]'), 'choosing One colour shows the colour swatches')
        cols = await pg.evaluate("[...new Set([...objEl(slide().objects[0]).querySelectorAll('path')].map(p=>p.getAttribute('fill')).filter(f=>f&&f!=='none'))]")
        check(cols == ['#58C4DD'], f'One colour paints every part in the chosen colour {cols}')
        await pg.select_option('#props select[data-k="paint"]', 'original'); await pg.wait_for_timeout(200)
        check(not await pg.is_visible('#props [data-ck="color"]'), 'with its own colours there is no colour to pick')
        # drawing itself
        part = await pg.evaluate("(()=>{const g=document.createElementNS(NS,'g');drawObj({...slide().objects[0]},g,{reveal:0.3});const ps=[...g.querySelectorAll('path')];return [ps.length,ps.filter(p=>p.getAttribute('stroke-dasharray')).length]})()")
        check(part[0] > 0 and part[0] == part[1], f'it draws itself: every shape is traced as it enters {part}')
        # import
        await pg.evaluate("(t)=>addDrawingFromText(t,'shapes.svg')", SVG); await pg.wait_for_timeout(500)
        d = await pg.evaluate("(()=>{const o=slide().objects.at(-1);const D=drawingOf(o);return {type:o.type,name:o.name,n:D&&D.p.length,fills:D&&D.p.map(q=>q.f||null),strokes:D&&D.p.map(q=>q.s||null),vb:D&&D.vb,m:D&&D.p[0].m,stored:!!IMG.get(o.drawId),pw:window.__pwned||0}})()")
        check(d['type'] == 'drawing' and d['name'] == 'shapes' and d['n'] == 4, f'an SVG file becomes a drawing with its 4 shapes (text and photos left out) {d["n"]}')
        check(d['pw'] == 0, 'scripts and event handlers inside the SVG never run')
        check('#ff0000' in d['fills'] and '#00ffff' in d['fills'] or '#0000ff' in d['fills'], f'class colours and gradients are kept as colours {d["fills"]}')
        check('#00ff00' in d['strokes'] and '#ffff00' in d['fills'], 'strokes and <use> copies are kept')
        check(d['m'] and abs(d['m'][0] - 2) < 1e-6 and abs(d['m'][4] - 20) < 1e-6, 'transforms are kept')
        check(d['vb'][0] < 12 and d['vb'][2] > 175, f'the drawing is framed around its shapes {d["vb"]}')
        check(d['stored'] and await pg.evaluate("Object.keys(deckWithImages(deck).images||{}).some(k=>k.startsWith('drw'))"), 'the drawing is saved with the deck (and travels when shared)')
        bad = await pg.evaluate("(()=>{const n=slide().objects.length;return addDrawingFromText('<html>nope</html>','x.svg').then(r=>[r,slide().objects.length===n,document.querySelector('#toast').textContent])})()")
        check(bad[0] is False and bad[1] and 'not a valid SVG' in bad[2], 'a file that is not SVG is refused with a clear message')
        # paste and drop
        n0 = await pg.evaluate("slide().objects.length")
        await pg.evaluate("(t)=>{const dt=new DataTransfer();dt.setData('text/plain',t);document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true}));}", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#f00"/></svg>')
        await pg.wait_for_timeout(300)
        check(await pg.evaluate("slide().objects.length") == n0 + 1, 'pasting SVG code adds a drawing')
        await pg.evaluate("(t)=>{const dt=new DataTransfer();dt.items.add(new File([t],'star.svg',{type:'image/svg+xml'}));const st=document.querySelector('.stage');st.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));}", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M5 0L6 4L10 5L6 6L5 10L4 6L0 5L4 4Z" fill="#ff0"/></svg>')
        await pg.wait_for_timeout(400)
        check(await pg.evaluate("slide().objects.length") == n0 + 2 and await pg.evaluate("slide().objects.at(-1).name") == 'star', 'dropping an SVG file on the slide adds a drawing')
        # morph
        k = await pg.evaluate("sampleShapes({...slide().objects[0]}).length")
        check(k >= 8, f'drawings can morph: their shapes are sampled ({k})')
        # path, face, trail
        await pg.evaluate("""()=>{const s=slide();s.objects=s.objects.slice(0,1);const r=s.objects[0];r.x=-4;r.y=0;r.rot=0;r.w=1.2;
          const c=Object.assign(make('circle'),{id:'orbit',radius:2.5,x:0,y:0});s.objects.push(c);sel=r.id;editStep=1;s.cams={1:{...CAM0}};refresh();}""")
        await pg.wait_for_timeout(200)
        await pg.select_option('#f_path', 'orbit'); await pg.wait_for_timeout(200)
        await pg.check('#f_face'); await pg.wait_for_timeout(150)
        await pg.check('#f_trail'); await pg.wait_for_timeout(150)
        st = await pg.evaluate("(()=>{const r=slide().objects[0];return {ph:r.paths[1],rot1:r.keys[1].rot,rot0:objAt(r,0).rot}})()")
        check(st['ph']['face'] and st['ph']['trail'], 'Turn to face where it goes and Leave a trail are saved for the click')
        mid = await pg.evaluate("""(()=>{const s=slide(),from=visibleAt(s,0),to=visibleAt(s,1);const its=frameItems(from,to,0.5,undefined,{step:1,slideObjs:s.objects});const r=its.find(i=>i.obj.id===s.objects[0].id).obj;
           const P=pathPts(objAt(s.objects[1],1));return [r.rot,headingAt(P,0.5)-90]})()""")
        diff = ((mid[0] - mid[1]) % 360 + 540) % 360 - 180
        check(abs(diff) < 2, f'halfway round, the rocket points along the circle ({mid[0]:.1f}° vs {mid[1]:.1f}°)')
        tr = await pg.evaluate("(()=>{const s=slide();const a=visibleAt(s,0).some(o=>o.type==='trail'),b=visibleAt(s,1).find(o=>o.type==='trail');return [a,!!b,b&&b.pts.length,diffSummary(visibleAt(s,0),visibleAt(s,1))]})()")
        check(not tr[0] and tr[1] and tr[2] > 20, 'the trail appears on that click and stays after it')
        check('new' not in tr[3], f'the trail is not counted as a new object ({tr[3]})')
        await pg.click('#playStep'); await pg.wait_for_timeout(2600)
        # export
        code = await pg.evaluate("genCode()")
        try: ast.parse(code); okpy = True
        except SyntaxError as e: okpy = str(e)
        check(okpy is True, f'the Python script is valid {okpy}')
        check('load_drawing("lib_rocket"' in code and 'DRAWINGS = {' in code and 'FaceAlong(' in code and 'DashedVMobject(' in code, 'the Python script includes the drawing, the turning motion and the trail')
        # survives a reload
        await pg.reload(); await pg.wait_for_timeout(1500)
        print('   (after reload the open project is', await pg.evaluate("deck.slides[0].objects.map(o=>o.type).join()"), ')')
        check(await pg.evaluate("objEl(slide().objects[0])&&objEl(slide().objects[0]).querySelectorAll('path').length>5"), 'drawings are still there after reloading')
        check(not errs, 'no script errors ' + '; '.join(errs))
        await b.close()
    print(f'\nALL {len(passed)} DRAWING CHECKS PASSED')
asyncio.run(main())
