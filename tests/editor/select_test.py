"""Run: python3 tests/editor/select_test.py <editor URL, e.g. file:///path/trace.html>
Selecting objects with the mouse: thin lines, overlaps, Alt+click, Tab, the object list."""
import asyncio, sys
from playwright.async_api import async_playwright
passed = []
def check(ok, what):
    if not ok: raise AssertionError('FAIL: ' + what)
    passed.append(what); print('  ok ', what, flush=True)
SETUP = """()=>{createProject('Selecting',blankDeck());const os=slide().objects;
  const line=Object.assign(make('line'),{id:'L',x:-4,y:2.5,dx:2,dy:0,stroke:2});
  const arr=Object.assign(make('arrow'),{id:'A',x:-4,y:0.5,dx:2,dy:0});
  const cur=Object.assign(make('curve'),{id:'C',x:-4,y:-2});
  const ax=Object.assign(make('axes'),{id:'G',x:2.5,y:0,w:6,h:4,fn:'sin(x)'});
  const lab=Object.assign(make('text'),{id:'T',text:'label',x:3.5,y:1.2,fontSize:28});
  os.push(line,arr,cur,ax,lab);sel=null;refresh();}"""
async def px(pg, ux, uy):   # slide units -> screen pixels
    return await pg.evaluate(f"(()=>{{const p=canvas.createSVGPoint();p.x={ux};p.y={-uy};const q=p.matrixTransform(canvas.getScreenCTM());return [q.x,q.y]}})()")
async def click_at(pg, ux, uy, dy_px=0, alt=False):
    x, y = await px(pg, ux, uy)
    if alt: await pg.keyboard.down('Alt')
    await pg.mouse.click(x, y + dy_px)
    if alt: await pg.keyboard.up('Alt')
    await pg.wait_for_timeout(120)
    return await pg.evaluate("sel")
async def run(url, label, full=True):
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 1440, 'height': 900}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("localStorage.setItem('trace-toured','1')")
        await pg.goto(url); await pg.wait_for_timeout(1500)
        await pg.evaluate(SETUP); await pg.wait_for_timeout(800)
        res = {}
        res['line'] = await click_at(pg, -3, 2.5, 6) == 'L'          # 6 px beside a thin line
        await pg.mouse.click(5, 5)
        res['arrow'] = await click_at(pg, -3.5, 0.5, -6) == 'A'       # 6 px beside an arrow
        res['graph inside'] = await click_at(pg, 1.2, -1.2) == 'G'    # empty inside of a graph
        res['label in graph'] = await click_at(pg, 3.5, 1.2) == 'T'   # small text on top of a graph
        print(label, res)
        if full:
            for k, v in res.items(): check(v, f'{k}: picked with a forgiving click')
            check(await click_at(pg, 3.5, 1.2, alt=True) == 'G', 'Alt+click picks the object underneath (the graph)')
            await pg.keyboard.press('Tab'); await pg.wait_for_timeout(100)
            check(await pg.evaluate("sel") == 'T', 'Tab goes to the next object')
            await pg.keyboard.press('Shift+Tab'); await pg.wait_for_timeout(100)
            check(await pg.evaluate("sel") == 'G', 'Shift+Tab goes back')
            # hover label
            await pg.keyboard.press('Escape'); x, y = await px(pg, -3, 2.5); await pg.mouse.move(x, y + 5); await pg.wait_for_timeout(250)
            check('Line' in await pg.inner_text('#hoverBox span'), 'hovering shows a dashed outline with the object name')
            # object list
            await pg.mouse.click(5, 5); await pg.evaluate("sel=null;renderProps();renderCanvas()")
            check('front first' in await pg.inner_text('#props') and await pg.locator('.objlist button').count() == 5, 'the slide panel lists every object on the slide')
            await pg.click('.objlist button:has-text("Curve")'); await pg.wait_for_timeout(100)
            check(await pg.evaluate("sel") == 'C', 'clicking a name in the list selects it')
            await pg.click('#toBack'); await pg.wait_for_timeout(100)
            check(await pg.evaluate("slide().objects[0].id") == 'C', 'Send to back puts it behind the others')
            await pg.click('#toFront'); await pg.wait_for_timeout(100)
            check(await pg.evaluate("slide().objects.at(-1).id") == 'C', 'Bring to front puts it on top')
            # drag a selected graph by its inside even though the label is on top elsewhere
            await click_at(pg, 1.2, -1.2)
            x, y = await px(pg, 1.2, -1.2); await pg.mouse.move(x, y); await pg.mouse.down(); await pg.mouse.move(x - 40, y, steps=5); await pg.mouse.up()
            check(await pg.evaluate("Math.abs(obj('G').x - 2.5) > 0.3"), 'a selected graph can be dragged from its empty inside')
            # settings panel layout
            await pg.evaluate("sel='T';renderProps()")
            order = await pg.evaluate("[...document.querySelectorAll('#props h3')].map(h=>h.textContent.split(' ')[0])")
            check(order[:2] == ['Content', 'Animation'], 'settings show the content first, then the animation')
            check(await pg.evaluate("!document.querySelector('details[data-more=pos]').open"), 'position and size are folded away until needed')
            check('With the slide' in await pg.inner_text('.animsum'), 'the animation section sums up when and how it appears')
            check(not errs, 'no script errors ' + '; '.join(errs))
        await b.close()
        return res
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8788/app'
async def main():
    await run(URL, 'picks: ')
    print(f'\nALL {len(passed)} SELECTION CHECKS PASSED')
asyncio.run(main())
