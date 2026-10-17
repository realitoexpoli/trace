"""Run: python3 tests/editor/background_test.py <editor URL, e.g. file:///path/trace.html>
The background designer: presets, gradients and patterns show on the slide, in thumbnails and when presenting;
Cancel changes nothing, Apply can be undone, and the colour advice switches unreadable text."""
import asyncio, sys
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///tmp/trace_test.html'
import os, tempfile
PIC = os.path.join(tempfile.mkdtemp(), 'picture.png')
passed = []
def check(ok, what):
    if not ok: raise AssertionError('FAIL: ' + what)
    passed.append(what); print('  ok ', what, flush=True)
async def main():
    import base64
    open(PIC, 'wb').write(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNgYGBgYGBgYGBgYGBgYAAAAAUAAWq4p3sAAAAASUVORK5CYII='))
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 1440, 'height': 880})
        await ctx.add_init_script("try{localStorage.setItem('trace-toured','1')}catch(e){}")
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL + '#edit'); await pg.wait_for_timeout(1500)
        await pg.evaluate("()=>{insertExample('showcase');cur=3;sel=null;editStep=null;refresh()}"); await pg.wait_for_timeout(800)
        await pg.click('#props .pp-rail [data-go="bg"]')
        check(await pg.is_visible('#bgDesign') and 'cta' in await pg.get_attribute('#bgDesign', 'class'), 'the Background section has a stand-out "Design the background" button')
        await pg.click('#bgDesign'); await pg.wait_for_timeout(500)
        check(await pg.is_visible('#bgModal') and await pg.locator('#bgPresets button').count() >= 12, 'the designer opens with ready-made backgrounds')
        await pg.click('#bgPresets button:has-text("Blueprint")'); await pg.wait_for_timeout(300)
        check(await pg.evaluate("!!document.querySelector('#bgPrev svg pattern')"), 'the preview shows the grid pattern')
        await pg.click('#bgCancel'); await pg.wait_for_timeout(300)
        check(await pg.evaluate("deck.bg==='#000000'&&!deck.bgx"), 'Cancel leaves the background as it was')
        await pg.click('#bgDesign'); await pg.wait_for_timeout(300)
        await pg.click('#bgPresets button:has-text("Sunset")'); await pg.wait_for_timeout(200)
        await pg.click('#bgApply'); await pg.wait_for_timeout(500)
        check(await pg.evaluate("deck.bg==='#2A1035'&&deck.bgx.style==='linear'&&deck.bgx.c2==='#7A2E4E'"), 'Apply saves the gradient in the deck')
        check(await pg.evaluate("!!document.querySelector('#canvas linearGradient') && document.querySelector('#canvas rect').getAttribute('fill').startsWith('url(')"), 'the slide is painted with the gradient')
        check(await pg.evaluate("!!document.querySelector('#thumbs linearGradient')"), 'the thumbnails show it too')
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(400)
        check(await pg.evaluate("deck.bg==='#000000'&&!deck.bgx"), 'Undo brings the old background back')
        await pg.keyboard.press('Control+Shift+z'); await pg.wait_for_timeout(400)
        check(await pg.evaluate("deck.bgx&&deck.bgx.style==='linear'"), 'Redo applies it again')
        # light background: the designer offers to make white writing dark
        await pg.click('#props .pp-rail [data-go="bg"]'); await pg.click('#bgDesign'); await pg.wait_for_timeout(300)
        await pg.click('#bgPresets button:has-text("Whiteboard")'); await pg.wait_for_timeout(300)
        check(await pg.is_visible('#bgFix'), 'on a light background it warns about white writing')
        await pg.click('#bgFix'); await pg.wait_for_timeout(300)
        check(await pg.evaluate("!deck.slides.some(s=>s.objects.some(o=>/^#f{3}(f{3})?$/i.test(o.color||'')))"), '"Make them dark" switches white objects to dark')
        await pg.click('#bgApply'); await pg.wait_for_timeout(300)
        await pg.evaluate("()=>{deck.bgx={pattern:'dots',pop:.3};refresh()}"); await pg.wait_for_timeout(300)
        await pg.evaluate("present()") if await pg.evaluate("typeof present==='function'") else await pg.click('#presentBtn')
        await pg.wait_for_timeout(1200)
        check(await pg.evaluate("!!document.querySelector('#pcanvas pattern')"), 'the pattern shows when presenting')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        # the plot button stands out for an equation
        await pg.evaluate("()=>{cur=3;const o=deck.slides[3].objects.find(o=>o.type==='latex'&&o.mode==='plain');sel=o.id;refresh();}"); await pg.wait_for_timeout(500)
        await pg.click('#props .pp-rail [data-go="content"]')
        check('cta' in await pg.get_attribute('#plotEq', 'class') and await pg.is_visible('#plotEq'), 'the Plot button is the stand-out button for an equation')
        # any colour: the picker next to the swatches
        await pg.click('#props .pp-rail [data-go="style"]')
        await pg.evaluate("()=>{const i=document.querySelector('#props [data-cpick=color]');i.value='#12ab34';i.dispatchEvent(new Event('input'));i.dispatchEvent(new Event('change'));}"); await pg.wait_for_timeout(300)
        check(await pg.evaluate("obj(sel).color==='#12AB34'"), 'any colour can be picked, not only the swatches')
        check(await pg.evaluate("!!document.querySelector('#props [data-ck=color] .sw[data-c=\"#12AB34\"]')"), 'the colour is kept among your colours')
        # side panels
        await pg.click('#hideStrip'); await pg.click('#props .rail-hide'); await pg.wait_for_timeout(300)
        check(not await pg.is_visible('#thumbs') and not await pg.is_visible('#props') and await pg.is_visible('#showStrip') and await pg.is_visible('#showProps'), 'both side panels can be hidden')
        w_full = await pg.evaluate("document.querySelector('.frame').getBoundingClientRect().width")
        await pg.click('#showStrip'); await pg.click('#showProps'); await pg.wait_for_timeout(300)
        check(await pg.is_visible('#thumbs') and await pg.is_visible('#props') and w_full > await pg.evaluate("document.querySelector('.frame').getBoundingClientRect().width"), 'and shown again; hidden panels leave more room for the slide')
        g = await (await pg.query_selector('.pgrip-r')).bounding_box()
        await pg.mouse.move(g['x']+4, g['y']+300); await pg.mouse.down(); await pg.mouse.move(g['x']-100, g['y']+300, steps=5); await pg.mouse.up(); await pg.wait_for_timeout(200)
        check(await pg.evaluate("PANELS.r") > 400 and await pg.evaluate("document.querySelector('aside.props').getBoundingClientRect().width") > 400, 'the settings panel is wider after dragging its edge')
        # picture and slide size
        await pg.evaluate("()=>{sel=null;editStep=null;refresh();showPane('bg')}"); await pg.click('#bgDesign'); await pg.wait_for_timeout(300)
        async with pg.expect_file_chooser() as fc: await pg.click('#bgImgPick')
        await (await fc.value).set_files(PIC); await pg.wait_for_timeout(800)
        check(await pg.evaluate("!!document.querySelector('#bgPrev svg image')"), 'a picture from the computer can be the background')
        await pg.click('#bgSizes [data-size="9:16"]'); await pg.wait_for_timeout(300)
        await pg.click('#bgApply'); await pg.wait_for_timeout(800)
        check(await pg.evaluate("deck.size==='9:16'&&FW===8&&Math.abs(FH-14.2222)<1e-3&&document.querySelector('#canvas').getAttribute('viewBox')==='-4 -7.1111 8 14.2222'"), 'the slides become vertical 9:16')
        check(await pg.evaluate("!!document.querySelector('#canvas image') && !!deckWithImages(deck).images[deck.bgx.img]"), 'the picture shows on the slide and is saved with the deck')
        check(await pg.evaluate("deck.slides.every(s=>s.objects.every(o=>Math.abs(o.x)<=4.2))"), 'objects were shrunk to fit the narrower slide')
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(400)
        check(await pg.evaluate("!deck.size&&FW>14"), 'Undo brings back the wide slides')
        # the vertical example deck
        await pg.evaluate("()=>{deck=buildLighthouseDeck();cur=0;sel=null;editStep=null;refresh();}"); await pg.wait_for_timeout(1200)
        check(await pg.evaluate("deck.slides.length===10&&deck.size==='9:16'&&document.querySelector('#canvas').getAttribute('viewBox').startsWith('-4 ')"), 'the Lighthouses and π example opens as 10 vertical slides')
        # feature search
        await pg.keyboard.press('Control+k'); await pg.wait_for_timeout(200)
        check(await pg.is_visible('#fsInput'), 'Ctrl+K opens the feature search')
        await pg.fill('#fsInput', 'vertical'); await pg.wait_for_timeout(150)
        check('Vertical 9:16' in await pg.inner_text('#fsList'), 'typing "vertical" finds the slide size')
        await pg.fill('#fsInput', 'graf'); await pg.wait_for_timeout(150)
        await pg.fill('#fsInput', 'graph'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(500)
        check(await pg.is_hidden('#fsModal') and await pg.evaluate("slide().objects.some(o=>o.type==='axes')"), 'Enter runs the first result: a graph is added')
        await pg.click('#fsBtn'); await pg.fill('#fsInput', 'background'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(500)
        check(await pg.is_visible('#bgModal'), 'searching "background" opens the background designer')
        await pg.click('#bgCancel')
        check(not errs, 'no script errors ' + '; '.join(errs))
        await b.close()
    print(f'\nALL {len(passed)} BACKGROUND, COLOUR, PANEL AND SIZE CHECKS PASSED')
asyncio.run(main())
