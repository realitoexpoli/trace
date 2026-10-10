"""Run: python3 tests/editor/tours_test.py <editor URL, e.g. file:///path/trace.html>
Runs every interactive tour the way a person would: real clicks, typing and dragging."""
import asyncio, sys
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///tmp/trace_test.html'
passed = []
def check(ok, what):
    if not ok: raise AssertionError('FAIL: ' + what)
    passed.append(what); print('  ok ', what, flush=True)

async def title(pg):
    return await pg.evaluate("document.querySelector('.tour-card h3')?.textContent || ''")
async def body(pg):
    return await pg.evaluate("document.querySelector('.tour-card p')?.textContent || ''")
async def center(pg, js):
    r = await pg.evaluate(f"(()=>{{const e={js};if(!e)return null;const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,r.width,r.height]}})()")
    return r
async def drag(pg, js, dx, dy, at=None):
    c = await center(pg, js)
    x, y = (c[0], c[1]) if at is None else (c[0] + at[0], c[1] + at[1])
    await pg.mouse.move(x, y); await pg.mouse.down()
    for i in range(1, 11): await pg.mouse.move(x + dx * i / 10, y + dy * i / 10)
    await pg.mouse.up()
async def until_changed(pg, old, timeout=6000):
    for _ in range(timeout // 100):
        t = await title(pg) + '|' + await body(pg)
        if t != old: return t
        await pg.wait_for_timeout(100)
    raise AssertionError('FAIL (stuck): ' + old[:80])
COVER = "(()=>{const s=document.querySelector('.tour-spot'),c=document.querySelector('.tour-card');if(!s||!c||getComputedStyle(s).display==='none')return false;const r=s.getBoundingClientRect(),q=c.getBoundingClientRect();return !(q.right<=r.left||q.left>=r.right||q.bottom<=r.top||q.top>=r.bottom)?JSON.stringify([[r.left,r.top,r.right,r.bottom],[q.left,q.top,q.right,q.bottom]].map(a=>a.map(Math.round))):false})()"
async def step(pg, action, expect=None):
    await pg.wait_for_timeout(350)
    t0 = await title(pg); b0 = await body(pg)
    cov = await pg.evaluate(COVER)
    if cov: raise AssertionError('FAIL: the tour card covers the place to act at “' + t0 + '” ' + cov)
    if expect: check(expect in t0 + ' ' + b0, f'tour shows “{expect}”')
    await action()
    return await until_changed(pg, t0 + '|' + b0)
objc = lambda t: f"canvas.querySelector('g[data-id=\"'+slide().objects.find(o=>o.type==='{t}').id+'\"]')"

async def tour_first(pg):
    print('Tour: your first animated slide')
    await step(pg, lambda: pg.click('.tour-card [data-tour="first"]'), 'Welcome')
    await step(pg, lambda: pg.click('.tour-card [data-tb="next"]'), 'first animated slide')
    check(await pg.evaluate("curMeta().name") == 'My first animation', 'the tour works in a new project')
    check(await pg.is_visible('.tour-spot'), 'a spotlight shows where to act')
    await step(pg, lambda: pg.click('#tools >> text=Write'), 'Open Write')
    await step(pg, lambda: pg.click('#tools .menu:not([hidden]) [data-t="text"]'), 'Choose Text')
    async def typetitle():
        await pg.click('#props .rte'); await pg.keyboard.press('Control+A'); await pg.keyboard.type('Waves')
    await step(pg, typetitle, 'Type your title')
    await step(pg, lambda: drag(pg, objc('text'), 0, -170), 'Drag the title')
    check(await pg.evaluate("slide().objects.find(o=>o.type==='text').y") >= 1.5, 'the title was dragged to the top')
    await step(pg, lambda: pg.click('#tools >> text=Write'), 'Open Write again')
    await step(pg, lambda: pg.click('#tools .menu:not([hidden]) [data-t="latex"]'), 'choose Equation')
    async def typeeq():
        await pg.click('#f_src'); await pg.keyboard.press('Control+A'); await pg.keyboard.type('y = sin(k x)')
    await step(pg, typeeq, 'y = sin(k x)')
    await step(pg, lambda: pg.click('#plotEq'), 'Plot this equation')
    await step(pg, lambda: pg.select_option('#f_step', '1'), 'On click 1')
    await step(pg, lambda: pg.click('.tour-card [data-tb="next"]'), 'Enters with')
    await step(pg, lambda: pg.click('.tour-card [data-tb="next"]'), 'Opens')
    await step(pg, lambda: pg.click('#preview'), 'Preview')
    await pg.wait_for_timeout(1500)
    await step(pg, lambda: pg.check('[data-live="k"]'), 'Live slider')
    await step(pg, lambda: pg.click('#presentBtn'), 'Present')
    async def present():
        await pg.wait_for_timeout(900); await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(1800)
        check(await pg.is_visible('#plive input[type=range]'), 'the k slider is there while presenting')
        check(await pg.is_visible('.tour-card'), 'the tour card stays visible while presenting')
        await pg.keyboard.press('Escape')
    await step(pg, present, 'Press Esc')
    check('whole idea' in await title(pg), 'the tour ends with what to learn next')
    await pg.click('.tour-card [data-tb="next"]'); await pg.wait_for_timeout(300)
    check(not await pg.evaluate("!!document.querySelector('.tour-card')"), 'Finish closes the tour')
    r = await pg.evaluate("""(()=>{const os=slide().objects,a=os.find(o=>o.type==='axes'),q=os.find(o=>o.type==='latex');
      return [os.some(o=>o.type==='text'&&plainOf(o.text)==='Waves'), a.step===1&&a.enter==='create', !!(q.live&&q.live.k&&q.live.k.on)]})()""")
    check(r == [True, True, True], 'the slide made during the tour is right: title, graph on click 1 drawn, k slider')

async def tour_clicks(pg):
    print('Tour: change things on a click')
    await pg.click('[data-menu="help"]'); await pg.click('.helpmenu [data-tour="clicks"]'); await pg.wait_for_timeout(300)
    await step(pg, lambda: pg.click('.tour-card [data-tb="next"]'), 'Change things on a click')
    await step(pg, lambda: pg.click('#addClick'), '+ Click')
    async def pick_circle():
        c = await center(pg, objc('circle')); await pg.mouse.click(c[0], c[1])
    await step(pg, pick_circle, 'Select the circle')
    await step(pg, lambda: drag(pg, objc('circle'), 380, 0), 'Drag the circle')
    check(await pg.evaluate("slide().objects.find(o=>o.type==='circle').keys[1].x") > -2, 'the move is stored on Click 1')
    await step(pg, lambda: pg.click('#props [data-ck="color"] [data-c="#FC6255"]'), 'Pick another colour')
    await step(pg, lambda: pg.click('#playStep'), 'Play')
    await step(pg, lambda: pg.click('.tour-card [data-tb="next"]'), 'Click 1 again')
    await pg.click('.tour-card [data-tb="next"]'); await pg.wait_for_timeout(200)
    check(not await pg.evaluate("!!document.querySelector('.tour-card')"), 'the click tour finishes')

async def tour_slides(pg):
    print('Tour: animate between slides')
    await pg.click('[data-menu="help"]'); await pg.click('.helpmenu [data-tour="slides"]'); await pg.wait_for_timeout(300)
    await step(pg, lambda: pg.click('.tour-card [data-tb="next"]'), 'Animate between slides')
    await step(pg, lambda: pg.click('#dupSlide'), 'Duplicate')
    await step(pg, lambda: drag(pg, objc('rect'), 380, 0), 'Drag the square')
    async def grow():
        await pg.mouse.click(*(await center(pg, objc('rect')))[:2]); await pg.wait_for_timeout(200)
        h = await center(pg, "canvas.querySelector('[data-handle=\"se\"]')")
        await pg.mouse.move(h[0], h[1]); await pg.mouse.down()
        for i in range(1, 11): await pg.mouse.move(h[0] + 6 * i, h[1] + 6 * i)
        await pg.mouse.up()
    await step(pg, grow, 'corner handle')
    await step(pg, lambda: pg.click('#preview'), 'Preview')
    await pg.wait_for_timeout(1500)
    check('1 move' in await pg.inner_text('#thumbs'), 'the slide list says what animates')
    await step(pg, lambda: pg.click('.tour-card [data-tb="next"]'), 'slide list')
    await pg.click('.tour-card [data-tb="next"]'); await pg.wait_for_timeout(200)
    check(not await pg.evaluate("!!document.querySelector('.tour-card')"), 'the slides tour finishes')

async def tour_screen_and_auto(pg):
    print('Tour: the screen, and “Do it for me” everywhere')
    await pg.click('[data-menu="help"]'); await pg.click('.helpmenu [data-tour="screen"]'); await pg.wait_for_timeout(300)
    n = 0
    while await pg.evaluate("!!document.querySelector('.tour-card')") and n < 15:
        check(await pg.is_visible('.tour-spot'), f'screen tour step {n+1} points at something') if n < 9 else None
        await pg.click('.tour-card [data-tb="next"]'); await pg.wait_for_timeout(250); n += 1
    check(n == 9, 'the screen tour has 9 stops')
    # every tour can be finished with "Do it for me" alone
    for name in ['first', 'clicks', 'slides']:
        await pg.evaluate(f"startTour('{name}')"); await pg.wait_for_timeout(200)
        for _ in range(40):
            if not await pg.evaluate("!!document.querySelector('.tour-card')"): break
            if await pg.evaluate("!$('#present').hidden"):
                await pg.wait_for_timeout(400)
            b = await pg.query_selector('.tour-card [data-tb="auto"]') or await pg.query_selector('.tour-card [data-tb="next"]')
            t0 = await title(pg) + await body(pg)
            await b.click()
            for _ in range(40):
                await pg.wait_for_timeout(100)
                if not await pg.evaluate("!!document.querySelector('.tour-card')") or await title(pg) + await body(pg) != t0: break
        check(not await pg.evaluate("!!document.querySelector('.tour-card')"), f'the “{name}” tour can be completed with Do it for me')

async def main():
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: errors.append(str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(2400)
        check(await pg.evaluate("!!document.querySelector('.tour-card')"), 'first-time visitors are offered the tour')
        await tour_first(pg)
        await tour_clicks(pg)
        await tour_slides(pg)
        await tour_screen_and_auto(pg)
        await pg.reload(); await pg.wait_for_timeout(2400)
        check(not await pg.evaluate("!!document.querySelector('.tour-card')"), 'the welcome is offered only once')
        check(not errors, 'no script errors ' + '; '.join(errors))
        await b.close()
    print(f'\nALL {len(passed)} TOUR CHECKS PASSED')
asyncio.run(main())
