"""Run: python3 tests/editor/features_test.py <editor URL, e.g. file:///path/trace.html>
Self-animating objects (Fourier drawing, derivative sweep, countdown timer), the second set of objects
(statistics, circuit, ray optics, probability tree, fraction, atom, callout, quiz question), presenting tools
(laser, pen, black screen, presenter view with speaker notes) and exporting a slide as PNG and the deck as PDF."""
import asyncio, sys
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///tmp/trace_test.html'
passed = []
def check(ok, what):
    if not ok: raise AssertionError('FAIL: ' + what)
    passed.append(what); print('  ok ', what, flush=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 1440, 'height': 860}, accept_downloads=True)
        await ctx.add_init_script("try{localStorage.setItem('trace-toured','1')}catch(e){};Element.prototype.requestFullscreen=function(){return Promise.resolve()}")
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL + '#edit'); await pg.wait_for_timeout(1500)
        await pg.evaluate("()=>{createProject('Features',blankDeck());}"); await pg.wait_for_timeout(300)

        # Fourier drawing draws itself, over its own time
        await pg.evaluate("()=>{addObj('fourier');}"); await pg.wait_for_timeout(200)
        r = await pg.evaluate("""()=>{const n=slide().objects[0],f=t=>frameItems([],[n],1,t).find(i=>i.obj.id===n.id).obj.prog;return{span:countSpan([],[n]),a:f(0),b:f(3),c:f(6),d:f(9)}}""")
        check(r['span'] == 6 and r['a'] == 0 and abs(r['b'] - 0.5) < 1e-9 and r['c'] == 1 and r['d'] == 1, f'a new Fourier drawing draws itself over 6 seconds when it appears {r}')
        circ = await pg.evaluate("()=>{const n={...slide().objects[0],prog:0.4},g=document.createElementNS(NS,'g');drawExtra(n,g,{});return g.querySelectorAll('circle').length}")
        check(circ > 5, f'while it draws, the turning circles show ({circ})')
        await pg.evaluate("()=>{const o=slide().objects[0];o.prog=0;o.autoDraw=false;o.keys={1:{prog:1}};refresh();}")
        mid = await pg.evaluate("()=>{const o=slide().objects[0];return interp(objAt(o,0),objAt(o,1),0.5).prog}")
        check(abs(mid - 0.5) < 1e-9, 'it can also be drawn on a click, like any other number')
        sw = await pg.evaluate("()=>{const o={...make('deriv')};const f=t=>frameItems([],[o],1,t).find(i=>i.obj.id===o.id).obj.x0;return[f(0),f(5)]}")
        check(sw[0] == -3 and sw[1] == 2.5, f'the derivative explorer sweeps its tangent across when it appears {sw}')

        # countdown timer
        await pg.evaluate("()=>{newSlide();addObj('timer');}"); await pg.wait_for_timeout(200)
        t = await pg.evaluate("()=>{const n=slide().objects[0];const v=s=>counterNum(frameItems([],[n],1,s).find(i=>i.obj.id===n.id).obj);return[n.type,v(0),v(60.2),v(299.5),v(300),countSpan([],[n])]}")
        check(t[0] == 'counter' and t[1:5] == ['5:00', '4:00', '0:01', '0:00'] and t[5] == 300, f'"Countdown timer" counts 5:00 down to 0:00 in real seconds {t}')

        # the second set of objects
        for k in ['stats', 'circuit', 'optics', 'ptree', 'fraction', 'atom', 'callout', 'mcq']:
            await pg.evaluate(f"()=>{{newSlide();addObj('{k}');}}"); await pg.wait_for_timeout(200)
            n = await pg.evaluate("document.querySelectorAll('#canvas path, #canvas circle, #canvas rect, #canvas text').length")
            check(n > 8, f'{k} draws ({n} shapes)')
        fit = await pg.evaluate("s3fit([[1,2],[2,4],[3,6.1],[4,7.9]])")
        check(abs(fit['m'] - 1.97) < 0.02 and fit['r'] > 0.99, f'line of best fit and r are right {fit}')
        img = await pg.evaluate("""()=>{const run=(k,f,u)=>{const g=document.createElementNS(NS,'g');drawExtra({...make('optics'),kind:k,f,u,info:true},g,{});return g.innerHTML.length>200};
            const inv=1/2-1/5;return{v:1/inv,ok:run('convex',2,5)&&run('convex',2,1)&&run('concave',2,5)&&run('concavemirror',2,5)&&run('convexmirror',2,5)&&run('convex',2,2)}}""")
        check(abs(img['v'] - 10/3) < 1e-9 and img['ok'], 'ray diagrams draw for both lenses and both mirrors, including the object at F')
        loops = await pg.evaluate("()=>[withLoop({...make('circuit'),loop:'flow',loopTime:2},1).flow,withLoop({...make('atom'),loop:'flow',loopTime:8},2).spin]")
        check(abs(loops[0] - 0.5) < 1e-9 and abs(loops[1] - 90) < 1e-9, 'the current flows round the circuit and the electrons turn')
        rev = await pg.evaluate("()=>{const q=make('mcq');q.keys={1:{reveal:1}};return[objAt(q,0).reveal,objAt(q,1).reveal]}")
        check(rev == [0, 1], 'a quiz question shows its answer on a click')
        await pg.evaluate("()=>{window.__up=[];PLAN.pro=false;PLAN.upgrade=w=>window.__up.push(w);}")
        n0 = await pg.evaluate("slide().objects.length")
        await pg.evaluate("addObj('optics')")
        check(await pg.evaluate("slide().objects.length") == n0 and await pg.evaluate("window.__up") == ['optics'], 'ray diagrams are Pro')
        await pg.evaluate("()=>{PLAN.pro=true;}")

        # speaker notes
        await pg.evaluate("()=>{cur=0;sel=null;editStep=null;refresh();showPane('slide');}"); await pg.wait_for_timeout(200)
        await pg.fill('#f_notes', 'Start with the heart, then ask what N does.'); await pg.wait_for_timeout(200)
        check(await pg.evaluate("deck.slides[0].notes") == 'Start with the heart, then ask what N does.', 'speaker notes are saved with the slide')

        # presenting tools
        await pg.evaluate("()=>{deck.slides[0].objects[0].autoDraw=true;deck.slides[0].objects[0].keys=null;deck.slides[0].objects[0].prog=1;openPresent();}"); await pg.wait_for_timeout(900)
        check(await pg.is_visible('#ptools') and await pg.locator('#ptools button').count() == 4, 'presenting shows the tools: laser, pen, black screen, presenter view')
        await pg.keyboard.press('l'); await pg.mouse.move(700, 400); await pg.wait_for_timeout(150)
        check(await pg.is_visible('#plaser') and await pg.evaluate("document.querySelector('#present').classList.contains('pt-laser')"), 'L turns on the laser pointer')
        await pg.keyboard.press('p'); await pg.mouse.move(600, 300); await pg.mouse.down(); await pg.mouse.move(800, 420, steps=8); await pg.mouse.up(); await pg.wait_for_timeout(150)
        inked = await pg.evaluate("(()=>{const c=document.querySelector('#pink'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=3;i<d.length;i+=16)if(d[i])return true;return false})()")
        check(inked and await pg.evaluate("pi") == 0, 'P draws on the slide, and drawing does not change slide')
        await pg.keyboard.press('e'); await pg.wait_for_timeout(100)
        check(not await pg.evaluate("(()=>{const c=document.querySelector('#pink'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=3;i<d.length;i+=16)if(d[i])return true;return false})()"), 'E erases the drawing')
        await pg.keyboard.press('Escape'); await pg.keyboard.press('b'); await pg.wait_for_timeout(100)
        check(await pg.is_visible('#pblank'), 'B blacks out the screen')
        await pg.keyboard.press('b'); await pg.wait_for_timeout(100)
        check(await pg.is_hidden('#pblank') and not await pg.evaluate("$('#present').hidden"), 'pressing B again brings the slide back (Escape leaves tools first, not the presentation)')
        async with ctx.expect_page() as pv_info:
            await pg.keyboard.press('s')
        pv = await pv_info.value; await pv.wait_for_timeout(500)
        check('Start with the heart' in await pv.inner_text('#notes') and 'Slide 1 of' in await pv.inner_text('#pos') and await pv.locator('#cur > svg').count() == 1 and await pv.locator('#nxt > svg').count() == 1, 'S opens the presenter view: this slide, the next one, the notes and the position')
        for _ in range(4):
            if await pg.evaluate('pi') != 0: break
            await pv.click('#nx'); await pg.wait_for_timeout(400)
        await pg.wait_for_timeout(400)
        check(await pg.evaluate("pi") == 1 and 'Slide 2 of' in await pv.inner_text('#pos'), '"Next" in the presenter view moves the presentation, and the view follows')
        await pv.close(); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)

        # export
        await pg.evaluate("()=>{cur=0;refresh();}")
        async with pg.expect_download() as dl:
            await pg.evaluate("exportPNG(0)")
        d = await dl.value; path = await d.path(); data = open(path, 'rb').read()
        check(data[:8] == b'\x89PNG\r\n\x1a\n' and 'slide 1' in d.suggested_filename, f'a slide saves as a PNG picture ({len(data)//1024} KB, "{d.suggested_filename}")')
        async with ctx.expect_page() as pdf_info:
            await pg.evaluate("()=>{window.__print=0;exportPDF(true)}")
        pdf = await pdf_info.value; await pdf.wait_for_timeout(300)
        n = await pdf.locator('section.pg').count(); nd = await pg.evaluate("deck.slides.length")
        check(n == nd and await pdf.locator('section.pg .sl > svg').count() == nd and 'Start with the heart' in await pdf.inner_text('body'), f'"Print or save as PDF" lays out all {nd} slides, one per page, with the notes')
        await pdf.close()
        check(not errs, 'no page errors: ' + '; '.join(errs[:3]))
        await b.close()
    print(f'PASSED {len(passed)} checks')
asyncio.run(main())
