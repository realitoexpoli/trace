"""Run: python3 tests/editor/slider_test.py <editor URL, e.g. file:///path/trace.html>
Live sliders: easy to grab, fine control, step buttons, typing a value, reset, keys, no accidental slide changes."""
import asyncio, sys
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///tmp/trace_test.html'
passed = []
def check(ok, what):
    if not ok: raise AssertionError('FAIL: ' + what)
    passed.append(what); print('  ok ', what, flush=True)
SEL = '#plive .lv:has(input[data-cname="k"])'
async def val(pg, sel=SEL): return await pg.evaluate(f"+document.querySelector('{sel} input').value")
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        ctx = await b.new_context(viewport={'width': 1440, 'height': 860})
        await ctx.add_init_script("try{localStorage.setItem('trace-toured','1')}catch(e){}")
        pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL + '#edit'); await pg.wait_for_timeout(1500)
        await pg.evaluate("()=>{insertExample('showcase');cur=3;refresh();openPresent();}"); await pg.wait_for_timeout(2500)
        pos = await pg.evaluate("[pi,ps]")
        r = await pg.evaluate(f"(()=>{{const e=document.querySelector('{SEL} input').getBoundingClientRect();return [e.x,e.y,e.width,e.height]}})()")
        check(r[3] >= 30 and r[2] >= 180, f'the slider is big enough to grab {r}')
        st = await pg.evaluate(f"+document.querySelector('{SEL} input').step")
        check(st in (0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 0.005, 0.002), f'steps are round numbers ({st})')
        lo, hi = await pg.evaluate(f"[+document.querySelector('{SEL} input').min,+document.querySelector('{SEL} input').max]")
        cy = r[1] + r[3] / 2
        # click on the track jumps there
        await pg.mouse.click(r[0] + 10 + (r[2] - 20) * 0.75, cy); await pg.wait_for_timeout(150)
        v = await val(pg); check(abs(v - (lo + (hi - lo) * 0.75)) <= (hi - lo) * 0.03, f'clicking the track moves the slider there ({v})')
        check(await pg.evaluate("[pi,ps]") == pos, 'using a slider does not change the slide')
        frac = (v - lo) / (hi - lo); tx = r[0] + 10 + (r[2] - 20) * frac
        # drag along the slider: normal speed
        await pg.mouse.move(tx, cy); await pg.mouse.down(); await pg.mouse.move(tx - 60, cy, steps=6); await pg.mouse.up(); await pg.wait_for_timeout(100)
        d1 = v - await val(pg); v = await val(pg)
        # drag 150 px below the slider: slower
        frac = (v - lo) / (hi - lo); tx = r[0] + 10 + (r[2] - 20) * frac
        await pg.mouse.move(tx, cy); await pg.mouse.down(); await pg.mouse.move(tx, cy + 150, steps=4); await pg.mouse.move(tx - 60, cy + 150, steps=6)
        fine = await pg.evaluate(f"document.querySelector('{SEL}').dataset.fine")
        await pg.mouse.up(); await pg.wait_for_timeout(100)
        d2 = v - await val(pg)
        check(d1 > 0 and 0 < d2 < d1 * 0.3, f'moving the pointer away from the slider makes it slower ({d1:.3f} vs {d2:.3f})')
        check(fine in ('fine', 'finest'), 'a “slower” hint shows while fine-tuning')
        drawn = await pg.evaluate("JSON.stringify(presOv)")
        check('"k"' in drawn, 'the slide follows the slider')
        # + button
        v = await val(pg); await pg.click(f'{SEL} .lvb[data-d="1"]'); await pg.wait_for_timeout(100)
        check(abs(await val(pg) - (v + st)) < 1e-9, '+ moves one step')
        v = await val(pg)
        await pg.hover(f'{SEL} .lvb[data-d="-1"]'); await pg.mouse.down(); await pg.wait_for_timeout(900); await pg.mouse.up()
        check(v - await val(pg) >= 5 * st, 'holding − keeps moving')
        check(await pg.evaluate("[pi,ps]") == pos, 'the step buttons do not change the slide')
        # type a value
        await pg.click(f'{SEL} output'); await pg.wait_for_timeout(100)
        await pg.keyboard.press('Control+A'); await pg.keyboard.type('2.5'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(150)
        check(abs(await val(pg) - min(hi, 2.5)) < 1e-9 and await pg.evaluate("presOv[Object.keys(presOv).find(k=>presOv[k].k!==undefined)].k") == min(hi, 2.5), 'clicking the value lets you type an exact number')
        check(await pg.evaluate("[pi,ps]") == pos and not await pg.is_hidden('#present'), 'typing in the value box does not move the slides or close Present')
        # keys
        await pg.focus(f'{SEL} input'); v = await val(pg)
        await pg.keyboard.press('ArrowLeft'); await pg.keyboard.press('Shift+ArrowLeft'); await pg.wait_for_timeout(100)
        check(abs((v - await val(pg)) - 11 * st) < 1e-6, '← one step, Shift+← ten steps')
        check(await pg.evaluate("[pi,ps]") == pos, 'arrow keys on a slider do not change the slide')
        # hide/show keeps the value
        v = await val(pg)
        await pg.evaluate("toggleLive();toggleLive();"); await pg.wait_for_timeout(100)
        check(abs(await val(pg) - v) < 1e-9, 'hiding and showing the sliders keeps their values')
        # reset
        v0 = await pg.evaluate(f"+document.querySelector('{SEL}').dataset.v0")
        await pg.dblclick(f'{SEL} .lvname'); await pg.wait_for_timeout(100)
        check(abs(await val(pg) - v0) < 1e-9, 'double-clicking the name puts it back')
        await pg.screenshot(path='/tmp/claude-0/-home-claude/46672bc0-61fd-51cb-a980-beae51fb1eba/scratchpad/sl_present.png')
        # clicking the slide still advances
        await pg.mouse.click(700, 200); await pg.wait_for_timeout(300)
        check(await pg.evaluate("[pi,ps]") != pos, 'clicking the slide still goes to the next step')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        # the editor's slider bar
        await pg.evaluate("()=>{cur=3;sel=null;editStep=null;refresh();}"); await pg.wait_for_timeout(500)
        ES = '#livebar .lv:has(input[data-cname="k"])'
        v = await val(pg, ES); await pg.click(f'{ES} .lvb[data-d="1"]'); await pg.wait_for_timeout(150)
        check(await pg.evaluate("slide().objects.find(o=>o.type==='latex'&&o.params&&o.params.k!==undefined).params.k") == await val(pg, ES) and await val(pg, ES) > v, 'the editor’s slider bar works the same way and changes the slide')
        await pg.screenshot(path='/tmp/claude-0/-home-claude/46672bc0-61fd-51cb-a980-beae51fb1eba/scratchpad/sl_editor.png')
        await ctx.close()
        # touch screen
        ctx = await b.new_context(viewport={'width': 1024, 'height': 768}, is_mobile=True, has_touch=True)
        await ctx.add_init_script("try{localStorage.setItem('trace-toured','1')}catch(e){}")
        pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL + '#edit'); await pg.wait_for_timeout(1500)
        await pg.evaluate("()=>{insertExample('showcase');cur=3;refresh();openPresent();}"); await pg.wait_for_timeout(2000)
        h = await pg.evaluate(f"[document.querySelector('{SEL} input').getBoundingClientRect().height,document.querySelector('{SEL} .lvb').getBoundingClientRect().height]")
        check(h[0] >= 44 and h[1] >= 40, f'on touch screens the slider and buttons are finger-sized {h}')
        await pg.screenshot(path='/tmp/claude-0/-home-claude/46672bc0-61fd-51cb-a980-beae51fb1eba/scratchpad/sl_tablet.png')
        check(not errs, 'no script errors ' + '; '.join(errs))
        await b.close()
    print(f'\nALL {len(passed)} SLIDER CHECKS PASSED')
asyncio.run(main())
