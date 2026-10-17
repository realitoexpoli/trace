"""Run: python3 tests/editor/video_test.py <editor URL, e.g. file:///path/trace.html> <path to mp4-muxer.js>
"Make a video": the deck is rendered frame by frame into an MP4 with the recorded voice; checked with ffprobe/ffmpeg."""
import asyncio, base64, json, os, subprocess, sys, tempfile
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///tmp/trace_test.html'
MUX = sys.argv[2] if len(sys.argv) > 2 else '/tmp/mux/package/build/mp4-muxer.js'
passed = []
def check(ok, what):
    if not ok: raise AssertionError('FAIL: ' + what)
    passed.append(what); print('  ok ', what, flush=True)
def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], capture_output=True, text=True, check=True).stdout
    return json.loads(out)
async def save(pg, js, path):
    b64 = await pg.evaluate("async()=>{const r=" + js + ";const b=new Uint8Array(await r.blob.arrayBuffer());let s='';for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return {data:btoa(s),meta:{codec:r.codec,audio:r.audio,seconds:r.seconds,frames:r.frames,w:r.width,h:r.height}};}")
    open(path, 'wb').write(base64.b64decode(b64['data'])); return b64['meta']
async def main():
    tmp = os.environ.get('VIDTMP') or tempfile.mkdtemp()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 1440, 'height': 860}, accept_downloads=True)
        await ctx.add_init_script("try{localStorage.setItem('trace-toured','1')}catch(e){}")
        await ctx.route('https://cdn.jsdelivr.net/npm/mp4-muxer@*/build/mp4-muxer.js', lambda r: r.fulfill(path=MUX, content_type='application/javascript'))
        await ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL + '#edit'); await pg.wait_for_function('window.mjReady', timeout=20000); await pg.wait_for_timeout(500)
        # a small deck: an equation, then a circle that appears on click 1 and moves on click 2, and a second slide
        await pg.evaluate("""()=>{createProject('Video test',blankDeck());const s=slide();
          const e=make('latex');e.tex='y = \\\\sin(kx)';e.y=2.5;s.objects.push(e);
          const c=Object.assign(make('circle'),{id:'vc',x:-3,color:'#F4D345'});c.step=1;s.objects.push(c);
          c.keys={2:{x:3}};deck.slides.push(clone(s));deck.slides[1].objects=deck.slides[1].objects.filter(o=>o.type==='latex');
          syncAll();refresh();}""")
        tl = await pg.evaluate("(()=>{const t=vidTimeline(1,false,new Map());return {n:t.segs.length,dur:t.dur,steps:t.segs.map(s=>[s.slide,s.step])};})()")
        check(tl['n'] == 4 and tl['steps'] == [[0, 0], [0, 1], [0, 2], [1, 0]], f'the video plays every click of every slide in order {tl["steps"]}')
        # record a voice clip on click 1 (fake microphone)
        await pg.evaluate("()=>{editStep=1;renderCanvas();renderStepBar();}")
        await pg.click('#vRec'); await pg.wait_for_timeout(2200); await pg.click('#vRec'); await pg.wait_for_timeout(800)
        vdur = await pg.evaluate("slide().voice&&slide().voice[1]&&slide().voice[1].dur")
        check(vdur and vdur >= 1.5, f'a voice clip is recorded on click 1 ({vdur} s)')
        tl2 = await pg.evaluate("(()=>vidTimeline(1,true,new Map()).dur)()")
        check(tl2 >= tl['dur'], 'a long voice clip makes its click last longer')

        # free plan: 720p with the badge, through the window
        await pg.evaluate("PLAN.pro=false;PLAN.badge=true;planChanged&&planChanged();")
        await pg.click('[data-menu="export"]'); await pg.click('#videoBtn')
        check(await pg.is_visible('#vidModal') and 'Video length' in await pg.inner_text('#vidEst'), 'More → Make a video opens the window with the video length')
        check('Made with Tracé' in await pg.inner_text('#vidBody'), 'on Free, the window says the video carries the badge and Pro removes it')
        await pg.select_option('#vidQ', '720'); await pg.select_option('#vidP', '1')
        await pg.click('#vidGo')
        await pg.wait_for_selector('#vidSave, #vidDone .vid-note', timeout=240000)
        if not await pg.query_selector('#vidSave'): raise AssertionError('FAIL: ' + await pg.inner_text('#vidDone'))
        check(await pg.is_visible('#vidDone video'), 'when it is ready, the window shows the video and a Download button')
        async with pg.expect_download() as dl:
            await pg.click('#vidSave')
        d = await dl.value; f1 = os.path.join(tmp, 'free.mp4'); await d.save_as(f1)
        check(d.suggested_filename == 'Video test.mp4', f'the file is named after the project ({d.suggested_filename})')
        info = probe(f1); vs = [s for s in info['streams'] if s['codec_type'] == 'video'][0]; aus = [s for s in info['streams'] if s['codec_type'] == 'audio']
        check(info['format']['format_name'].startswith('mov,mp4') and vs['width'] == 1280 and vs['height'] == 720, f"it is an MP4 at 1280×720 ({vs['codec_name']})")
        dur = float(info['format']['duration'])
        check(abs(dur - tl2) < 0.6, f'its length matches the clicks and pauses ({dur:.2f} s vs {tl2:.2f} s)')
        check(len(aus) == 1 and float(aus[0].get('duration', dur)) > 1, f"it has a sound track with the voice ({aus[0]['codec_name'] if aus else 'none'})")
        # look at frames: badge at the bottom centre, the circle appearing then moving
        def frame(t, path):
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-i', f1, '-frames:v', '1', path], check=True)
            return path
        from PIL import Image
        segs = await pg.evaluate("(()=>vidTimeline(1,true,new Map([[slide().voice[1].id,"+str(vdur)+"]])).segs.map(s=>[s.t0,s.len]))()")
        a = Image.open(frame(segs[0][0] + segs[0][1] - 0.3, os.path.join(tmp, 'a.png'))).convert('RGB')
        bimg = Image.open(frame(segs[1][0] + segs[1][1] - 0.3, os.path.join(tmp, 'b.png'))).convert('RGB')
        c = Image.open(frame(segs[2][0] + segs[2][1] - 0.3, os.path.join(tmp, 'c.png'))).convert('RGB')
        yellow = lambda im, x0, x1: sum(1 for x in range(x0, x1, 3) for y in range(300, 420, 3) if (lambda p: p[0] > 180 and p[1] > 160 and p[2] < 120)(im.getpixel((x, y))))
        check(yellow(a, 0, 1280) < 5 and yellow(bimg, 300, 560) > 20, 'the circle is absent before click 1 and drawn after it')
        check(yellow(c, 720, 980) > 20 and yellow(c, 300, 560) < 5, 'on click 2 it has moved to the right')
        eq = sum(1 for x in range(400, 880, 2) for y in range(60, 160, 2) if sum(a.getpixel((x, y))) > 600)
        check(eq > 30, f'the equation is drawn (MathJax inside the frames: {eq} bright pixels)')
        corner = [a.getpixel((x, y)) for x in range(500, 780) for y in range(680, 702)]
        check(sum(1 for p in corner if sum(p) > 600) > 20, 'the free video carries the “Made with Tracé · traceanim.com” badge at the bottom centre')
        await pg.click('#vidClose')

        # Pro: no badge, 1080p, through the function
        await pg.evaluate("PLAN.pro=true;PLAN.badge=false;")
        meta = await save(pg, "await makeVideo({quality:1080,pause:1,voice:false})", os.path.join(tmp, 'pro.mp4'))
        info2 = probe(os.path.join(tmp, 'pro.mp4')); vs2 = [s for s in info2['streams'] if s['codec_type'] == 'video'][0]
        check(vs2['width'] == 1920 and vs2['height'] == 1080 and not [s for s in info2['streams'] if s['codec_type'] == 'audio'], 'Pro makes 1920×1080; without voice there is no sound track')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '1.0', '-i', os.path.join(tmp, 'pro.mp4'), '-frames:v', '1', os.path.join(tmp, 'p.png')], check=True)
        pimg = Image.open(os.path.join(tmp, 'p.png')).convert('RGB')
        corner = [pimg.getpixel((x, y)) for x in range(750, 1170) for y in range(1020, 1056)]
        check(sum(1 for p in corner if sum(p) > 600) < 5, 'Pro videos have no badge')
        # cancelling
        r = await pg.evaluate("async()=>{const job={};setTimeout(()=>job.cancel=true,300);try{await makeVideo({quality:720,pause:1,voice:false},()=>{},job);return 'finished'}catch(e){return e.message}}")
        check(r == 'cancelled', 'a video in progress can be cancelled')
        check(await pg.evaluate("document.querySelectorAll('body>div[aria-hidden] svg').length") == 0, 'nothing is left behind on the page')
        check(not errs, 'no script errors: ' + '; '.join(errs))
        await b.close()
    print(f'\nVIDEO TEST OK {len(passed)}')
asyncio.run(main())
