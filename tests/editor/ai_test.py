"""Run: python3 tests/editor/ai_test.py <editor URL, e.g. file:///path/trace.html>
The AI builder: without an account it explains where it works; with a (mocked) account it turns the
server's spec into real slides, can add slides to a deck, and Undo removes them. No real AI is called."""
import asyncio, sys, json
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///tmp/trace_test.html'
passed = []
def check(ok, what):
    if not ok: raise AssertionError('FAIL: ' + what)
    passed.append(what); print('  ok ', what, flush=True)
SPEC = {'title': 'Derivatives', 'slides': [
  {'title': 'The slope of a curve', 'items': [
    {'kind': 'equation', 'math': 'y = x^2', 'x': -3, 'y': 2, 'click': 0, 'id': 'eq', 'size': 44},
    {'kind': 'graph', 'fn': 'x^2', 'xmin': -3, 'xmax': 3, 'ymin': -1, 'ymax': 9, 'x': 0, 'y': -1, 'w': 8, 'h': 4.5, 'click': 1, 'point': 1},
    {'kind': 'bullets', 'items': ['Zoom in', 'It looks straight', 'Its slope is the derivative'], 'x': 4, 'y': 0, 'click': 2, 'reveal': True}]},
  {'title': 'Everything else', 'items': [
    {'kind': 'equation', 'latex': "f'(x) = 2x", 'x': -3, 'y': 2, 'click': 0, 'id': 'eq'},
    {'kind': 'shape', 'shape': 'star', 'x': -5, 'y': -2, 'size': 1, 'click': 0, 'color': '#F4D345', 'fill': 0.4},
    {'kind': 'vector', 'x': -2, 'y': -2, 'dx': 2, 'dy': 1, 'label': '\\vec v', 'click': 1},
    {'kind': 'counter', 'value': 42, 'decimals': 0, 'prefix': '', 'suffix': ' %', 'x': 3, 'y': 2, 'click': 1},
    {'kind': 'chart', 'type': 'bar', 'data': [['A', 3], ['B', 5]], 'x': 3, 'y': -1.5, 'w': 5, 'h': 3, 'click': 2},
    {'kind': 'venn', 'labels': ['A', 'B'], 'shade': 'union', 'x': 0, 'y': -2, 'click': 3},
    {'kind': 'text', 'text': 'Well done', 'x': 0, 'y': -3.4, 'click': 0}]}]}
MOCK = """window.__aiCalls=[];window.__left=0;window.__buy=0;window.__up=0;window.TRACE_AI={signedIn:()=>true,signIn(){},upgrade(){window.__up++},buy(){window.__buy++},
 async usage(){return{pro:false,left:window.__left,month_left:0,bought:window.__left}},
 async build(b){window.__aiCalls.push(b);await new Promise(r=>setTimeout(r,150));
   if(/limit/.test(b.prompt))return{error:'no_credits',pro:true};
   const s=JSON.parse(JSON.stringify(window.__SPEC));if(b.mode==='add'){s.slides=[s.slides[1]];}return{spec:s,left:4};}};"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 1440, 'height': 880})
        await ctx.add_init_script("try{localStorage.setItem('trace-toured','1')}catch(e){}")
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(1500)
        check(await pg.is_visible('#aiHome'), 'the projects page has a "Create with AI" button')
        await pg.click('#aiHome'); await pg.wait_for_timeout(300)
        check(await pg.is_visible('#aiModal') and 'traceanim.com' in await pg.inner_text('#aiLog'), 'opened outside the site, it says the AI works in a Tracé account')
        check(await pg.is_hidden('#aiChips') and await pg.get_attribute('#aiPrompt','placeholder') == 'What should the slides cover?', 'the window is plain: a short prompt and no example chips')
        await pg.click('#aiClose')
        await pg.evaluate("s=>{window.__SPEC=s}", SPEC); await pg.evaluate(MOCK)
        await pg.evaluate("()=>{AI.log=[]}")
        await pg.click('#aiHome'); await pg.wait_for_timeout(400)
        check('no AI credits left' in await pg.inner_text('#aiLog') and await pg.locator('#aiLog [data-aiup]').count() == 1, 'with no credits it says so, and offers packs and Pro')
        await pg.click('#aiLog [data-aiup]'); await pg.wait_for_timeout(200)
        check(await pg.evaluate("window.__up") == 1 and await pg.is_hidden('#aiModal'), '"See Pro" opens the Pro offer')
        await pg.click('#aiHome'); await pg.wait_for_timeout(300); await pg.click('#aiLog [data-aibuy]'); await pg.wait_for_timeout(200)
        check(await pg.evaluate("window.__buy") == 1 and await pg.is_hidden('#aiModal'), '"Buy credits" opens the credit packs')
        await pg.evaluate("()=>{window.__left=5;AI.log=[]}")
        await pg.click('#aiHome'); await pg.wait_for_timeout(300)
        check(await pg.is_disabled('[data-aimode="add"]'), 'from the projects page only "New presentation" is possible')
        check('5 credits left' in await pg.inner_text('#aiUsage'), 'it shows how many AI credits are left')
        await pg.fill('#aiPrompt', 'Introduce derivatives with a tangent line, 5 slides')
        await pg.select_option('#aiSize', '9:16')
        await pg.click('#aiGo'); await pg.wait_for_timeout(150)
        check(await pg.locator('#aiLog .ai-msg.me').count() == 1, 'the request shows in the chat')
        await pg.wait_for_timeout(1200)
        st = await pg.evaluate("""()=>({home:homeShown,n:deck.slides.length,size:deck.size,name:curMeta()?.name,
          t:deck.slides.map(s=>s.objects.map(o=>o.type)),o0:deck.slides[0].objects,call:window.__aiCalls[0]})""")
        check(not st['home'] and st['name'] == 'Derivatives' and st['n'] == 2, 'a new project "Derivatives" opens with 2 slides')
        check(st['size'] == '9:16' and st['call']['size'] == '9:16' and st['call']['mode'] == 'new', 'the chosen 9:16 format is used')
        check(st['t'][0] == ['text', 'latex', 'axes', 'bullets'], 'slide 1: title, equation, graph, bullets')
        check(st['t'][1] == ['text', 'latex', 'star', 'vector', 'counter', 'chart', 'venn', 'text'], 'slide 2 has every other kind of item')
        g = next(o for o in st['o0'] if o['type'] == 'axes'); bl = next(o for o in st['o0'] if o['type'] == 'bullets')
        check(g['step'] == 1 and g['fn'] == 'x^2' and g.get('mark') and g['markX'] == 1, 'the graph appears on click 1 with its marked point')
        check(bl['step'] == 2 and bl['shown'] == 1 and bl['keys'] == {'3': {'shown': 2}, '4': {'shown': 3}}, 'bullets appear one per click')
        check(await pg.evaluate("deck.slides[0].objects[1].id==='ai_eq'&&deck.slides[1].objects[1].id==='ai_eq'&&deck.slides[1].objects[1].mode==='latex'"), 'the same id on both slides lets the equation morph')
        check(await pg.evaluate("deck.slides[0].objects[0].y>6&&deck.slides[0].objects.every(o=>Math.abs(o.x)<4)"), 'titles sit at the top and items stay inside the tall slide')
        check(await pg.locator('#canvas svg *').count() > 20 and not errs, 'the slides draw without errors')
        check(await pg.evaluate("!document.querySelector('[data-aimode=\"add\"]').disabled&&document.querySelector('[data-aimode=\"add\"]').getAttribute('aria-pressed')==='true'"), 'after creating, the chat switches to adding slides')
        await pg.fill('#aiPrompt', 'add a summary slide'); await pg.click('#aiGo'); await pg.wait_for_timeout(1000)
        st = await pg.evaluate("()=>({n:deck.slides.length,cur,call:window.__aiCalls[1]})")
        check(st['n'] == 3 and st['cur'] == 2, 'adding puts the new slide at the end and shows it')
        check('4 credits left' in await pg.inner_text('#aiUsage'), 'the balance updates after each request')
        check(st['call']['mode'] == 'add' and st['call']['context']['slides'][0] == 'The slope of a curve', 'the AI is told the existing slide titles')
        await pg.click('#aiLog [data-aiundo]'); await pg.wait_for_timeout(400)
        check(await pg.evaluate("deck.slides.length") == 2, 'Undo removes the added slides')
        await pg.fill('#aiPrompt', 'over the limit'); await pg.click('#aiGo'); await pg.wait_for_timeout(600)
        check('come back on the 1st' in await pg.inner_text('#aiLog') and await pg.evaluate("deck.slides.length") == 2, 'out of credits it explains and changes nothing')
        # solving: worked steps one per click, and the answer is checked by substituting it back
        await pg.evaluate("""()=>{TRACE_AI.build=async b=>{window.__aiCalls.push(b);const good=!/wrong/.test(b.prompt);
          return{left:3,spec:{title:'Solve',slides:[{title:'Solve 2x² − 3x − 5 = 0',items:[{kind:'steps',lines:['2x^2-3x-5=0','(2x-5)(x+1)=0','x=\\\\tfrac52\\\\ \\\\text{or}\\\\ x=-1'],x:0,y:2,size:40,click:1}],
            check:{equation:'2x^2 - 3x - 5 = 0',var:'x',answers:good?[-1,2.5]:[2.5]}}]}};};AI.log=[]}""")
        await pg.click('[data-aimode="solve"]')
        check('Solve it' in await pg.inner_text('#aiGo') and 'equation' in await pg.get_attribute('#aiPrompt','placeholder'), 'the "Solve an equation" tab asks for an equation')
        n0 = await pg.evaluate("deck.slides.length")
        await pg.fill('#aiPrompt', '2x^2 - 3x - 5 = 0'); await pg.click('#aiGo'); await pg.wait_for_timeout(600)
        st = await pg.evaluate("()=>({n:deck.slides.length,call:window.__aiCalls.at(-1),o:deck.slides.at(-1).objects})")
        check(st['call']['solve'] is True and st['call']['mode'] == 'add' and st['n'] == n0 + 1, 'in the editor, solving adds the worked solution as new slides')
        L = [o for o in st['o'] if o['type'] == 'latex']
        check([o.get('step', 0) for o in L] == [1, 2, 3] and L[2].get('color') == '#F4D345' and L[0]['y'] > L[1]['y'] > L[2]['y'], 'each line of working appears on its own click, stacked, the answer highlighted')
        check(L[2]['tex'].startswith('x=\\tfrac'), 'the LaTeX in the working arrives intact')
        log = await pg.inner_text('#aiLog')
        check('✓ Checked' in log and 'x = −1 and x = 2.5' in log, 'the answers are checked by putting them back into the equation')
        await pg.fill('#aiPrompt', 'wrong 2x^2 - 3x - 5 = 0'); await pg.click('#aiGo'); await pg.wait_for_timeout(600)
        log = await pg.inner_text('#aiLog')
        check('Check the answer' in log and 'x ≈ −1' in log, 'a missing solution is caught and the teacher is warned')
        await pg.click('#aiLog .ai-msg.warn [data-aigo]'); await pg.wait_for_timeout(300)
        check(await pg.evaluate("cur") == await pg.evaluate("deck.slides.length-1") and await pg.is_hidden('#aiModal'), '"Show slide" jumps to the slide to correct')
        bad = await pg.evaluate("""()=>[aiCheckSolve({equation:'3(x - 4) = 2x + 7',var:'x',answers:[19]}).ok, aiCheckSolve({equation:'3(x - 4) = 2x + 7',var:'x',answers:[18]}).ok,
          aiCheckSolve({equation:'x^2 + 6x + 13 = 0',var:'x',none:true}).ok, aiCheckSolve({equation:'e^x = 5',var:'x',answers:[1.6094]}).ok, aiCheckSolve({equation:'1/x = 2',var:'x',answers:[0.5]}).ok]""")
        check(bad == [True, False, True, True, True], 'the checker handles linear, no-solution, exponential and 1/x equations (and rounded answers)')
        await pg.click('#aiBtn'); await pg.wait_for_timeout(200)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        check(await pg.is_hidden('#aiModal'), 'Escape closes the chat')
        check(await pg.is_visible('#aiBtn'), 'the editor header has an AI button')
        await pg.screenshot(path=sys.argv[2] if len(sys.argv) > 2 else '/tmp/ai.png')
        check(not errs, 'no page errors: ' + '; '.join(errs))
        await b.close()
    print(f'PASSED {len(passed)} checks')
asyncio.run(main())
