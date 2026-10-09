"""End-to-end test of the Tracé SaaS on a local copy of the stack (see start-stack.sh).
Drives real browsers through: sign-in by email link, cloud saving, the free limit, sharing,
a second device, upgrading with a (fake) Paddle checkout and a signed webhook, the billing
portal, deleting, and signing out.

Run: python3 tests/e2e/e2e_test.py <path to MathJax tex-svg.js> <path to supabase-js dist/umd folder>
"""
import asyncio, hashlib, hmac, json, os, subprocess, sys, time, urllib.request
from playwright.async_api import async_playwright

SITE = 'http://127.0.0.1:8788'
SB = 'http://127.0.0.1:54321'
DB = 'trace_e2e'
MJ, SBJS = sys.argv[1], sys.argv[2]
EMAIL = 'prof@uni.example'
KEYS = json.load(urllib.request.urlopen(SB + '/__test/keys'))

def sql(q):
    return subprocess.run(['psql', '-qAt', '-d', DB, '-c', q], capture_output=True, text=True, check=True).stdout.strip()

passed = []
def check(ok, what):
    if not ok:
        raise AssertionError('FAIL: ' + what)
    passed.append(what); print('  ok ', what, flush=True)

CONFIG = """window.TRACE_CONFIG = { supabaseUrl: '%s', supabaseAnonKey: '%s', googleSignIn: false,
  paddleEnv: 'sandbox', paddleClientToken: 'test_client_token', prices: { monthly: 'pri_month', yearly: 'pri_year' },
  priceLabels: { monthly: '$8 a month', yearly: '$72 a year' }, freeDecks: 3 };""" % (SB, KEYS['anon'])
PADDLE_STUB = """window.Paddle = { Environment: { set(e) { window.__paddleEnv = e; } },
  Initialize(o) { window.__paddleInit = o; }, Checkout: { open(o) { window.__checkout = o; } } };"""

async def new_device(browser, errors, name):
    ctx = await browser.new_context(viewport={'width': 1440, 'height': 860}, color_scheme='dark')
    async def r_config(route): await route.fulfill(body=CONFIG, content_type='application/javascript')
    async def r_mj(route):   # MathJax and the extensions it loads next to itself
        rel = route.request.url.split('/es5/', 1)[1].split('?')[0]
        await route.fulfill(path=os.path.join(os.path.dirname(MJ), rel), content_type='application/javascript')
    async def r_sb(route): await route.fulfill(path=os.path.join(SBJS, route.request.url.rsplit('/', 1)[1]), content_type='application/javascript')
    async def r_paddle(route): await route.fulfill(body=PADDLE_STUB, content_type='application/javascript')
    await ctx.route(SITE + '/config.js', r_config)
    await ctx.route('https://cdn.jsdelivr.net/npm/mathjax@3.2.2/**', r_mj)
    await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/*', r_sb)
    await ctx.route('https://cdn.paddle.com/**', r_paddle)
    await ctx.route('https://customer-portal.paddle.example/**', lambda r: r.fulfill(body='<h1>Paddle customer portal (fake)</h1>', content_type='text/html'))
    await ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    await ctx.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(f'{name}: {e}'))
    pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
    return ctx, pg

async def wait_for(pg, js, timeout=15000, what=''):
    try:
        await pg.wait_for_function(js, timeout=timeout)
    except Exception:
        raise AssertionError('FAIL (timed out): ' + (what or js))

async def sign_in(pg):
    await pg.goto(SITE + '/app'); await pg.wait_for_timeout(1200)
    await pg.click('#acctBtn')
    await pg.fill('#otpEmail', EMAIL)
    await pg.click('#otpForm button[type=submit]')
    await wait_for(pg, "document.querySelector('#otpMsg').textContent.includes('Check')", what='email sent message')
    code = json.load(urllib.request.urlopen(SB + '/__test/code?email=' + EMAIL))['code']
    await pg.goto(SITE + '/app?code=' + code)         # what clicking the link in the email does
    await wait_for(pg, "window.__traceCloud && window.__traceCloud.state().user", what='signed in')

def webhook(event_type, status, user_id, occurred):
    body = json.dumps({'event_id': 'evt_' + str(time.time()), 'event_type': event_type, 'occurred_at': occurred,
                       'data': {'id': 'sub_e2e', 'status': status, 'customer_id': 'ctm_e2e', 'custom_data': {'user_id': user_id},
                                'current_billing_period': {'ends_at': '2026-11-09T12:00:00Z'}}})
    ts = str(int(time.time()))
    sig = hmac.new(b'pdl_ntfset_test_secret', f'{ts}:{body}'.encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(SITE + '/api/paddle-webhook', data=body.encode(), method='POST',
                                 headers={'paddle-signature': f'ts={ts};h1={sig}', 'content-type': 'application/json'})
    return urllib.request.urlopen(req).status

async def main():
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()

        print('Website')
        ctxW, W = await new_device(browser, errors, 'site')
        await W.goto(SITE + '/'); await W.wait_for_timeout(800)
        check('Slides where the maths' in await W.inner_text('h1'), 'the home page loads')
        for path in ['/terms', '/privacy', '/refunds']:
            r = await W.goto(SITE + path)
            check(r.status == 200 and 'Paddle' in await W.inner_text('main'), f'{path} page exists and names Paddle as reseller')
        await W.goto(SITE + '/app?demo=showcase'); await W.wait_for_timeout(2500)
        check(not await W.is_hidden('#present') and await W.evaluate('deck.slides.length') == 14, 'the "Watch the tour" button plays the 14-slide tour')
        check(await W.evaluate("!localStorage.getItem('trace-projects') || !localStorage.getItem('trace-projects').includes('Tracé in motion')"), 'watching the tour saves nothing')
        await ctxW.close()

        print('Device A: not signed in')
        ctxA, A = await new_device(browser, errors, 'A')
        await A.goto(SITE + '/app'); await A.wait_for_timeout(1500)
        check(await A.inner_text('#acctBtn') == 'Sign in', 'shows a Sign in button')
        check(await A.evaluate('deck.slides.length') > 0, 'the editor works without an account')
        check(sql('select count(*) from decks') == '0', 'nothing is uploaded before signing in')

        print('Device A: sign in with an email link')
        await sign_in(A)
        uid = sql(f"select id from auth.users where email = '{EMAIL}'")
        check(sql(f"select plan from profiles where id = '{uid}'") == 'free', 'a free account is created')
        await wait_for(A, "document.querySelector('#cloudStat').title === 'Saved to your account'", what='saved status')
        check(sql(f"select count(*) from decks where owner = '{uid}'") == '1', 'the project on this device is saved to the account')
        check(await A.inner_text('#acctBtn') == 'P' and EMAIL in await A.get_attribute('#acctBtn', 'aria-label'), 'the account button shows the user')

        print('Device A: edits are saved online')
        await A.evaluate("snap(); deck.slides[0].objects.push(Object.assign(make('circle'), {id: 'e2e_circle', x: 1.5})); persist(); refresh();")
        await wait_for(A, "document.querySelector('#cloudStat').textContent.includes('Saved')", what='saved after edit')
        await A.wait_for_timeout(2600)
        check(sql(f"select count(*) from decks where owner = '{uid}' and data::text like '%e2e_circle%'") == '1', 'an edit reaches the database within a few seconds')
        await A.fill('#projName', 'Waves lecture'); await A.press('#projName', 'Enter'); await A.wait_for_timeout(1500)
        check(sql(f"select name from decks where owner = '{uid}'") == 'Waves lecture', 'renaming is saved online')

        print('Device A: the free plan keeps 3 decks')
        for i in range(3):
            await A.evaluate(f"createProject('Extra {i + 1}', blankDeck())")
            await A.wait_for_timeout(1300)
        await A.wait_for_timeout(1500)
        check(sql(f"select count(*) from decks where owner = '{uid}'") == '3', 'only 3 decks go to the cloud on Free')
        check('on this device only' in (await A.get_attribute('#cloudStat', 'title')).lower(), 'the 4th deck says it is on this device only')
        await wait_for(A, "!document.querySelector('#cloudModal').hidden", what='upgrade suggestion')
        check('Tracé Pro' in await A.inner_text('#cloudBody'), 'an upgrade suggestion explains the limit')
        await A.click('#cloudClose')

        print('Device A: share a deck')
        first = await A.evaluate("projects.find(p => p.name === 'Waves lecture').id")
        await A.evaluate(f"openProject('{first}')"); await A.wait_for_timeout(600)
        await A.click('#shareBtn')
        await wait_for(A, "!!document.querySelector('#shareOn')", what='share dialog')
        await A.check('#shareOn')
        await wait_for(A, "!!document.querySelector('#shareLink')", what='share link')
        link = await A.input_value('#shareLink')
        check('/v/' in link and len(link.rsplit('/', 1)[1]) == 12, 'a share link is created')
        await A.click('#cloudClose')

        print('Viewer: anyone with the link')
        ctxV, V = await new_device(browser, errors, 'viewer')
        await V.goto(link.replace('http://127.0.0.1:8788', SITE)); await V.wait_for_timeout(2500)
        check(not await V.is_hidden('#present'), 'the link opens straight into the presentation')
        check(await V.is_visible('#present .badge'), 'free decks show the "Made with Tracé" badge')
        check(await V.evaluate("deck.slides[0].objects.some(o => o.id === 'e2e_circle')"), 'the viewer sees the latest version')
        check(await V.evaluate("projects.every(p => !p.cloudId)") and await V.evaluate("!localStorage.getItem('trace-projects').includes('e2e_circle')"), "the shared deck is not copied into the viewer's own projects")
        await V.click('#exitPres'); await V.wait_for_timeout(300)
        check(await V.is_visible('#vend'), 'closing shows an end card with "Make your own"')
        check(sql(f"select view_count from decks where share_slug = '{link.rsplit('/', 1)[1]}'") == '1', 'the view is counted')
        await V.goto(SITE + '/v/notarealslug1'); await V.wait_for_timeout(1500)
        check('not shared' in (await V.inner_text('#vend')).lower(), 'a wrong link explains itself')

        print('Device B: same account on another computer')
        ctxB, B = await new_device(browser, errors, 'B')
        await sign_in(B)
        await B.wait_for_timeout(2500)
        names = await B.evaluate("projects.map(p => p.name)")
        check(all(n in names for n in ['Waves lecture', 'Extra 1', 'Extra 2']), 'decks saved on A appear on B')
        bid = await B.evaluate("projects.find(p => p.name === 'Waves lecture').id")
        await B.evaluate(f"openProject('{bid}')"); await B.wait_for_timeout(1500)
        check(await B.evaluate("deck.slides[0].objects.some(o => o.id === 'e2e_circle')"), 'opening a deck on B downloads its content')
        await B.evaluate("snap(); deck.slides[0].objects.push(Object.assign(make('rect'), {id: 'from_b'})); persist(); refresh();")
        await B.wait_for_timeout(3500)
        check(sql("select count(*) from decks where data::text like '%from_b%'") == '1', 'B saves its edit')
        await A.evaluate("window.__traceCloud.syncAll()"); await A.wait_for_timeout(2500)
        check(await A.evaluate("deck.slides[0].objects.some(o => o.id === 'from_b')"), 'A picks up the change made on B')

        print('Device A: upgrade to Pro (from the home page "Get Pro" button)')
        await A.goto(SITE + '/app?upgrade=1'); await A.wait_for_timeout(2500)
        check(not await A.is_hidden('#cloudModal') and 'Tracé Pro' in await A.inner_text('#cloudBody'), '"Get Pro" opens the plan choice for a signed-in user')
        await A.click('#cloudBody [data-price="pri_year"]'); await A.wait_for_timeout(800)
        co = await A.evaluate("window.__checkout")
        check(co and co['items'][0]['priceId'] == 'pri_year' and co['customData']['user_id'] == uid and co['customer']['email'] == EMAIL, 'checkout opens with the price and the account id')
        check(await A.evaluate("window.__paddleEnv") == 'sandbox', 'Paddle runs in sandbox while testing')
        check(webhook('subscription.created', 'active', uid, '2026-10-09T15:00:00Z') == 200, 'the signed webhook is accepted')
        await A.evaluate("window.__paddleInit.eventCallback({ name: 'checkout.completed' })")
        await wait_for(A, "window.__traceCloud.state().profile && window.__traceCloud.state().profile.plan === 'pro'", 20000, 'Pro switched on')
        await A.wait_for_timeout(3000)
        check(sql(f"select plan from profiles where id = '{uid}'") == 'pro', 'the account is Pro in the database')
        check(sql(f"select count(*) from decks where owner = '{uid}'") == '4', 'the deck that was device-only is now saved online')
        await V.goto(link.replace('http://127.0.0.1:8788', SITE)); await V.wait_for_timeout(2000)
        check(not await V.is_visible('#present .badge'), 'Pro decks are shared without the badge')

        print('Device A: billing portal')
        await A.click('#acctBtn')
        check('Pro plan' in await A.inner_text('#acctMenu'), 'the account menu says Pro')
        async with ctxA.expect_page() as newp:
            await A.click('[data-acct="billing"]')
        portal = await newp.value
        await portal.wait_for_load_state('commit')
        for _ in range(30):
            if 'customer-portal' in portal.url: break
            await A.wait_for_timeout(200)
        check('customer-portal.paddle.example/ctm_e2e' in portal.url, 'Manage billing opens the Paddle portal for this customer')
        await portal.close()

        print('Cancelling')
        check(webhook('subscription.canceled', 'canceled', uid, '2026-10-09T16:00:00Z') == 200, 'cancellation webhook accepted')
        check(sql(f"select plan from profiles where id = '{uid}'") == 'free', 'cancelling returns the account to Free')
        check(sql(f"select count(*) from decks where owner = '{uid}'") == '4', 'no deck is lost after cancelling')

        print('Device A: delete and sign out')
        extra = await A.evaluate("projects.find(p => p.name === 'Extra 3').id")
        await A.evaluate(f"openProject('{extra}')"); await A.wait_for_timeout(500)
        await A.evaluate("projAction('delete', {textContent: ''}).then(() => projAction('delete', {textContent: ''}))")
        await A.wait_for_timeout(1500)
        check(sql(f"select count(*) from decks where owner = '{uid}' and name = 'Extra 3'") == '0', 'deleting a project deletes its cloud copy')
        await A.click('#acctBtn'); await A.click('[data-acct="signout"]'); await A.wait_for_timeout(2000)
        check(await A.inner_text('#acctBtn') == 'Sign in', 'signed out')
        check(await A.evaluate("projects.every(p => !p.cloudId)"), "the account's decks are removed from this browser")
        check(sql(f"select count(*) from decks where owner = '{uid}'") == '3', 'and they are still safe in the account')

        print('Security from the browser')
        r = await V.evaluate("""async (k) => { const c = supabase.createClient('%s', k);
            const a = await c.from('decks').select('*'); const b = await c.rpc('apply_subscription', {p_user: null, p_customer: 'ctm_e2e', p_subscription: 's', p_status: 'active', p_renews_at: null, p_event_at: '2030-01-01'});
            return [a.error ? 'denied' : a.data.length, b.error ? 'denied' : 'allowed']; }""" % SB, KEYS['anon'])
        check(r == ['denied', 'denied'], 'a visitor with the public key can neither read decks nor grant Pro')

        check(not errors, 'no script errors: ' + '; '.join(errors))
        await browser.close()
    print(f'\nALL {len(passed)} END-TO-END CHECKS PASSED')

asyncio.run(main())
