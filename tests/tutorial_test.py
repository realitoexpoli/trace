"""Run: python3 tests/editor/tutorial_test.py <editor URL, e.g. file:///path/trace.html>
Runs every chapter of the interactive tutorial from start to finish, on a laptop and a phone screen:
each step must point at something visible, never be covered by its card, and “Do it for me” must complete it."""
import asyncio, sys, json
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///tmp/trace_test.html'
passed = []
def check(ok, what):
    if not ok: raise AssertionError('FAIL: ' + what)
    passed.append(what); print('  ok ', what, flush=True)
COVER = "(()=>{const s=document.querySelector('.tour-spot'),c=document.querySelector('.tour-card');if(!s||!c||getComputedStyle(s).display==='none')return false;const r=s.getBoundingClientRect(),q=c.getBoundingClientRect();if(r.width*r.height>innerWidth*innerHeight*0.3)return false;return !(q.right<=r.left||q.left>=r.right||q.bottom<=r.top||q.top>=r.bottom)})()"
STATE = "(()=>{const c=document.querySelector('.tour-card');if(!c)return null;const s=document.querySelector('.tour-spot');return {i:tour?tour.i:-1,n:tour?tour.steps.length:0,title:c.querySelector('h3').textContent,btns:[...c.querySelectorAll('[data-tb]')].map(b=>b.dataset.tb),target:!!(tour&&tour.steps[tour.i].target),spot:!!s&&getComputedStyle(s).display!=='none',done:!!(tour&&tour.steps[tour.i].done)}})()"
async def run_chapter(pg, name, label):
    await pg.evaluate(f"startTour('{name}')"); await pg.wait_for_timeout(300)
    seen = 0
    for _ in range(40):
        st = await pg.evaluate(STATE)
        if st is None: break
        await pg.wait_for_timeout(250)
        POS = "(()=>{const s=document.querySelector('.tour-spot'),c=document.querySelector('.tour-card');return JSON.stringify([s&&s.getBoundingClientRect(),c&&c.getBoundingClientRect(),scrollY])})()"
        for _ in range(12):   # let smooth scrolling settle first
            a1 = await pg.evaluate(POS); await pg.wait_for_timeout(200); a2 = await pg.evaluate(POS)
            if a1 == a2: break
        if await pg.evaluate(COVER): raise AssertionError(f'FAIL: {label} {name}: the card covers the target at “{st["title"]}”')
        if st['target'] and not st['spot'] and not await pg.evaluate("!document.querySelector('#present').hidden"):
            raise AssertionError(f'FAIL: {label} {name}: nothing to point at in “{st["title"]}”')
        if st['done']:
            check(await pg.evaluate(f"tutDone().has('{name}')"), f'{label}: “{name}” can be done from start to finish ({seen} steps) and is ticked off')
            await pg.click('.tour-card [data-tb="next"]'); await pg.wait_for_timeout(200)
            return
        key = 'auto' if 'auto' in st['btns'] else 'next'
        if key not in st['btns']: raise AssertionError(f'FAIL: {label} {name}: no way on at “{st["title"]}” {st["btns"]}')
        await pg.click(f'.tour-card [data-tb="{key}"]')
        for _ in range(40):
            await pg.wait_for_timeout(150)
            st2 = await pg.evaluate(STATE)
            if st2 is None or st2['i'] != st['i']: break
        else: raise AssertionError(f'FAIL: {label} {name}: “{"Do it for me" if key=="auto" else "Next"}” did not finish “{st["title"]}”')
        seen += 1
    raise AssertionError(f'FAIL: {label} {name}: never reached its end')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        for label, vp, mob in [('laptop', {'width': 1440, 'height': 860}, False), ('phone', {'width': 390, 'height': 844}, True)]:
            ctx = await b.new_context(viewport=vp, is_mobile=mob, has_touch=mob)
            await ctx.add_init_script("try{localStorage.setItem('trace-toured','1')}catch(e){}")
            pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(URL + '#edit'); await pg.wait_for_timeout(1500)
            chapters = await pg.evaluate("TUT_FLAT.map(c=>c[0])")
            if label == 'laptop': check(len(chapters) >= 19, f'the tutorial has {len(chapters)} chapters')
            await pg.click('#tourBtn'); await pg.wait_for_timeout(200)
            txt = await pg.inner_text('.tourmenu')
            if label == 'laptop': check('0 of' in txt and 'Start:' in txt, 'the Tour button opens the chapter list with progress and a Start button')
            await pg.keyboard.press('Escape')
            todo = chapters
            for ch in todo: await run_chapter(pg, ch, label)
            nproj = await pg.evaluate("projects.filter(p=>p.practice).length")
            check(nproj == 1, f'{label}: all chapters share one practice project')
            if label == 'laptop':
                await pg.click('#tourBtn'); await pg.wait_for_timeout(200)
                txt = await pg.inner_text('.tourmenu')
                check(f'{len(chapters)} of {len(chapters)}' in txt and await pg.evaluate("document.querySelectorAll('.tutlist .done').length") == len(chapters), 'every chapter is ticked in the list')
                await pg.keyboard.press('Escape')
            check(not errs, f'{label}: no script errors ' + '; '.join(errs))
            await ctx.close()
        await b.close()
    print(f'\nALL {len(passed)} TUTORIAL CHECKS PASSED')
asyncio.run(main())
