"""Follows the first-slide steps of the user guide (/guide/start) in the real editor, to keep the guide true."""
import asyncio,sys
# Run: python3 tests/e2e/guide_walkthrough.py <MathJax tex-svg.js> <supabase-js dist/umd folder> (stack running)
exec(open('tests/e2e/e2e_test.py').read().split('async def main')[0])
async def m():
    async with async_playwright() as p:
        b=await p.chromium.launch(); errs=[]
        ctx,A=await new_device(b,errs,'A')
        await A.goto(SITE+'/app'); await A.wait_for_timeout(1500)
        # 1 new project
        await A.click('[data-menu=proj]'); await A.click('#projMenu [data-pa=new]'); await A.wait_for_timeout(400)
        check(await A.evaluate('deck.slides.length==1 && deck.slides[0].objects.length==0'), 'New project gives a blank slide')
        # 2 title
        await A.click('#tools >> text=Write'); await A.click('.menu:not([hidden]) >> text=Text'); await A.wait_for_timeout(300)
        await A.click('#props .rte'); await A.keyboard.press('Control+A'); await A.keyboard.type('Waves'); await A.wait_for_timeout(400)
        await A.click('#canvas', position={'x':5,'y':5})
        check(await A.evaluate("slide().objects[0].text.includes('Waves')"), 'Typing in the Text box sets the title')
        g=await A.evaluate("(()=>{const r=document.querySelector('#canvas g[data-id]').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()")
        await A.mouse.dblclick(g[0],g[1]); await A.wait_for_timeout(300)
        check(await A.evaluate("document.activeElement && document.activeElement.classList.contains('rte')"), 'Double-clicking a text takes you to its box')
        # 3 equation
        await A.click('#tools >> text=Write'); await A.click('.menu:not([hidden]) >> text=Equation'); await A.wait_for_timeout(300)
        await A.fill('#f_src','y = sin(k x)'); await A.wait_for_timeout(500)
        check(await A.evaluate("obj(sel).src")=='y = sin(k x)', 'Equation box takes calculator-style maths')
        # 4 plot
        await A.click('#plotEq'); await A.wait_for_timeout(600)
        check(await A.evaluate("slide().objects.some(o=>o.type==='axes'&&o.source)"), 'Plot this equation as a graph makes a linked graph')
        # 5 live slider
        eqid=await A.evaluate("slide().objects.find(o=>o.type==='latex').id")
        await A.evaluate(f"()=>{{sel='{eqid}';renderProps();renderCanvas();}}")
        txt=await A.inner_text('#props'); check('Reads as y against x, holding k fixed' in txt, 'Plotting says: y against x, holding k fixed')
        await A.check('[data-live=k]'); await A.wait_for_timeout(300)
        check(await A.is_visible('#livebar'), 'Ticking Live slider shows a slider under the slide')
        # 6 graph on click 1 with Draw
        gid=await A.evaluate("slide().objects.find(o=>o.type==='axes').id")
        await A.evaluate(f"()=>{{sel='{gid}';renderProps();renderCanvas();}}")
        await A.select_option('#f_step','1'); await A.wait_for_timeout(200); await A.select_option('#f_enter','create'); await A.wait_for_timeout(200)
        check(await A.evaluate("(o=>o.step===1&&o.enter==='create')(slide().objects.find(o=>o.type==='axes'))"), 'Appears On click 1 and Enters with Draw are set')
        check('Click 1' in await A.inner_text('#stepbar'), 'The clicks bar now shows Click 1')
        # 7 present
        await A.click('#presentBtn'); await A.wait_for_timeout(1500)
        check(await A.evaluate("visibleAt(deck.slides[pi],ps).every(o=>o.type!=='axes')"), 'Slide opens without the graph')
        await A.keyboard.press('ArrowRight'); await A.wait_for_timeout(1800)
        check(await A.evaluate("ps===1 && presShown.some(o=>o.type==='axes')"), 'One click draws the graph')
        check(await A.is_visible('#plive input[type=range]'), 'The k slider is there while presenting')
        await A.keyboard.press('Escape'); await A.wait_for_timeout(500)
        check(await A.is_hidden('#present'), 'Esc leaves presenting')
        # clicks bar step toggle
        await A.click('#stepbar [data-step="1"]'); await A.wait_for_timeout(200)
        check(await A.evaluate('editStep===1') and 'Lasts' in await A.inner_text('#stepbar'), 'Clicking a step shows Lasts, View and Play')
        await A.click('#stepbar [data-step="1"]'); await A.wait_for_timeout(200)
        check(await A.evaluate('editStep===null'), 'Clicking the step again goes back to the whole slide')
        # duplicate summary text
        await A.click('#dupSlide'); await A.wait_for_timeout(400)
        await A.evaluate("()=>{const o=slide().objects.find(o=>o.type==='latex');o.y+=1;persist();refresh();}"); await A.wait_for_timeout(400)
        t=await A.inner_text('#thumbs'); check('1 move' in t, 'The slide list says what animates (e.g. "1 move")')
        # Help link
        check(await A.get_attribute('#helpLink','href')=='/guide/', 'Help in the header opens the guide')
        print(errs); print('WALKTHROUGH OK', len(passed))
asyncio.run(m())
