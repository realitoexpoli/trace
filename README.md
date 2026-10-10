# Tracé — the SaaS version

Tracé is a browser editor for animated maths and physics slides. This package turns it into an online product with:

- **Accounts** with their own sign-up and sign-in pages (email link, optionally Google), a **profile** people fill in before their projects are saved online, and an **account page**
- **Decks saved to the account**, opening on any device
- **Share links** (`/v/…`) that anyone can watch, with live sliders
- **Free and Pro plans**: Pro adds advanced 3D, recorded voice, the Python video script and no “Made with Tracé” badge; storage limits are enforced by the database
- **Payments** through Paddle, which also collects VAT and sales tax worldwide
- A **home page** with pricing, a **user guide** at `/guide`, and **terms / privacy / refund** templates

Everything was tested on a full local copy of the stack (484 automated checks, see [Tests](#tests)).

---

## What is in the folder

```
wrangler.jsonc, worker.js  Cloudflare Workers settings: publish public/, run the two functions and /v/ links
public/                  the website (served as static files)
  index.html             home page with features, pricing and questions
  app.html               the editor (built from trace.html, see tools/make-app.mjs)
  signup.html, login.html, account.html   create an account, sign in, edit your profile / plan / billing
  account.js             the logic of those three pages
  profile-ui.js          the profile form and the Free/Pro comparison, shared by the pages and the editor
  cloud.js               accounts, cloud saving, sharing, Pro plan (added to the editor)
  config.js              PUBLIC settings: Supabase URL + public key, Paddle client token, price ids
  site.css, img/         home page style and screenshots; img/logo-tile.svg (white on dark, used on the site), logo*.svg, mark.svg, icon.svg are the logo files
  favicon.svg, apple-touch-icon.png, icon-192.png, icon-512.png   browser and phone icons
  guide/                 the user guide (/guide): getting started, objects, animating, presenting,
                         sharing, cheat sheet. Plain HTML pages; edit them directly. Linked from the
                         editor's Help menu (which also starts the interactive tours) and the home page.
  terms.html, privacy.html, refunds.html   legal templates to fill in
  _redirects, _headers   Cloudflare rules: /v/<link> opens the viewer; security headers
functions/api/           two small server functions (run on Cloudflare)
  paddle-webhook.js      Paddle tells us a subscription started or ended → switch Free/Pro
  billing-portal.js      gives Pro users a link to Paddle's billing page (card, invoices, cancel)
lib/server.js            helpers for those functions (signature check, database calls)
supabase/migrations/001_init.sql      the database: tables, security rules, plan limits
supabase/migrations/002_profiles.sql  profiles (name, role, subject, school, badge colour), required
                                      before projects are saved online; author names on shared decks;
                                      deleting your own account
supabase/migrations/003_pro_features.sql  a free account cannot save decks with recorded voice
tests/                   database tests, function tests, end-to-end browser test, editor tests (tours, selecting)
tools/make-app.mjs       rebuilds public/app.html when you update trace.html
```

## How it fits together

```
 Browser ──── static pages ────► Cloudflare Workers or Pages (index.html, app.html, cloud.js)
    │
    ├── sign in, read/write own decks ──► Supabase (Auth + Postgres with row-level security)
    │
    ├── checkout (overlay) ─────────────► Paddle ──► webhook ──► /api/paddle-webhook ──► Supabase: plan = pro
    │
    └── "Manage billing" ───────────────► /api/billing-portal ──► Paddle customer portal
```

- The browser only ever holds the **public** Supabase key. What a user may read or change is decided by the database rules in `001_init.sql`, so editing the page cannot unlock anything.
- Only the two server functions hold secrets (the Supabase service key and the Paddle API key).
- Projects are kept in the browser first and copied to the account a couple of seconds after each change, so editing never waits for the network.

## Plans (change them in one place)

| | Free | Pro |
|---|---|---|
| Editor: every animation, all 2D objects, basic 3D shapes | ✓ | ✓ |
| Advanced 3D (surfaces, 3D scenes, polyhedra, torus, 3D arrows, turning views) | – | ✓ |
| Record your voice on slides and clicks | – | ✓ |
| Python video script (Manim) | – (or with a mark, see below) | ✓ |
| Decks in the browser | unlimited | unlimited |
| Decks in the account | 3 | unlimited |
| Size of one deck (images and voice included) | 2 MB | 20 MB |
| “Made with Tracé” badge | on share links and while presenting | none; view counts |

The real limits live in the database function `plan_limits` (in `001_init.sql`). If you change them, also update `freeDecks` in `public/config.js` and the pricing section of `public/index.html`.
Prices are set in Paddle; the labels shown in the app are `priceLabels` in `config.js`.

- Which add-menu items are Pro is the list `PRO_ADD` in `trace.html` (search for “plans”). The Free/Pro table shown in the app is `TRACE_PLANS` in `public/profile-ui.js`.
- `pythonForFree` in `config.js` (default `false`): set it to `true` to let free accounts export the Python script; their videos then carry a small “Made with Tracé” mark in the corner.
- Advanced 3D, the Python script and the Present badge are unlocked in the browser, so a technically skilled person could get around them with the browser's developer tools. They cannot get around the storage rules: recorded voice, deck counts and sizes are checked by the database.

### Promo codes (free Pro, no card)

Codes give Pro for a number of days (60 by default) with no payment details. When the time is up the account goes back to Free by itself; nothing is charged or deleted. Each account can use one code, once, and 10 wrong tries a day per account are allowed.

Create codes in Supabase → **SQL Editor**:

```sql
-- one code for the first 20 people
insert into promo_codes (code, days, max_uses, note) values ('FOUNDERS-2026', 60, 20, 'First 20 users');

-- or 20 personal codes, one use each, then list them
insert into promo_codes (code, days, max_uses, note)
select 'TRACE-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)), 60, 1, 'Founders batch'
from generate_series(1, 20);
select code from promo_codes where note = 'Founders batch';

-- who used which code, and until when
select r.code, u.email, r.redeemed_at, p.comp_until from promo_redemptions r
join auth.users u on u.id = r.user_id join profiles p on p.id = r.user_id order by r.redeemed_at;

-- stop a code early
update promo_codes set expires_at = now() where code = 'FOUNDERS-2026';
```

People type the code on their account page (**Plan and billing → Have a promo code?**) or in the Pro window of the editor. Easiest is a link that fills it in: `https://www.traceanim.com/app?promo=FOUNDERS-2026` (it asks them to sign up first if needed).

---

## Setting it up (about 1–2 hours, all free to start)

You need: a GitHub account, and accounts at Supabase, Cloudflare, Paddle and Resend (or another email sender). No credit card is needed for any of them while testing.

### 1. Supabase (database and sign-in)

1. Create a project at [supabase.com](https://supabase.com). Choose a region close to your users (for Europe: Frankfurt). Save the database password somewhere safe.
2. **SQL Editor → New query**: paste the whole of `supabase/migrations/001_init.sql`, then **Run**. Then do the same with `002_profiles.sql`, `003_pro_features.sql` and `004_promo_codes.sql`. All are safe to run again (in that order). For promo codes, also turn on **Database → Extensions → pg_cron** before running `004` (it ends finished free periods every hour; without it they still end, as soon as the person signs in).
3. **Project Settings → API**: copy
   - the **Project URL** → `supabaseUrl` in `public/config.js`
   - the **anon / publishable** key → `supabaseAnonKey` in `public/config.js`
   - the **service_role / secret** key → keep it for step 3 (never put it in `config.js`).
4. **Authentication → URL Configuration**:
   - Site URL: `https://www.traceanim.com`
   - Redirect URLs: add `https://www.traceanim.com/**` and `https://traceanim.com/**` (this covers `/signup`, `/login`, `/login?reset=1` and `/app`) and, for local testing, `http://localhost:8788/**`.
5. **Sign-in emails.** Supabase's built-in mailer sends only 2 emails an hour, and only to your own team, so it cannot serve real users. Create a free [Resend](https://resend.com) account (3,000 emails a month), verify your domain there, then in Supabase **Authentication → Emails → SMTP Settings** enter Resend's SMTP details (host `smtp.resend.com`, port 465, user `resend`, password = a Resend API key).
6. **Passwords.** **Authentication → Providers → Email**: keep **Email** enabled, turn on **Confirm email**, and set **Minimum password length** to 8. (The sign-in pages also offer an email link, which needs nothing more.) Under **Authentication → Emails → Templates**, the “Confirm signup” and “Reset password” emails can be reworded; keep `{{ .ConfirmationURL }}` in them.
7. **Continue with GitHub** (optional):
   - GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**. Homepage URL: `https://www.traceanim.com`. Authorization callback URL: `https://YOUR-PROJECT.supabase.co/auth/v1/callback` (Supabase shows the exact one on the GitHub provider page).
   - Copy the **Client ID** and generate a **Client secret**, paste both into Supabase **Authentication → Providers → GitHub**, and enable it.
   - In `config.js`: `signInWith: { google: false, github: true }`.
8. **Continue with Google** (optional):
   - [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → OAuth consent screen**: app name Tracé, your support email, the domain `traceanim.com`, and links to `/privacy` and `/terms`.
   - **Credentials → Create credentials → OAuth client ID → Web application**. Authorized redirect URI: the same `https://YOUR-PROJECT.supabase.co/auth/v1/callback`.
   - Paste the Client ID and secret into Supabase **Authentication → Providers → Google**, enable it, and set `google: true` in `signInWith`.
   - People who use the same email with a password, a link, Google or GitHub land in the same account.

> The free Supabase project pauses after a week without visitors. That is fine while testing; switch to Pro ($25 a month) when you launch.

### 2. Paddle (payments)

Start in the **sandbox** ([sandbox-vendors.paddle.com](https://sandbox-vendors.paddle.com)), which uses test cards and no real money.

1. **Catalog → Products → New product**: “Tracé Pro”. Add two prices: **$8 monthly** and **$72 yearly** (recurring). Copy both price ids (`pri_…`) into `prices` in `config.js`.
2. **Developer tools → Authentication**:
   - create a **client-side token** → `paddleClientToken` in `config.js`
   - create an **API key** with permission to write customer portal sessions → keep it for step 3 (`PADDLE_API_KEY`).
3. **Checkout → Checkout settings**: set the default payment link to `https://traceanim.com/app`.
4. **Developer tools → Notifications → New destination**:
   - URL: `https://traceanim.com/api/paddle-webhook`
   - Events: all `subscription.*` events (created, activated, updated, trialing, past_due, paused, resumed, canceled)
   - copy the **secret key** → `PADDLE_WEBHOOK_SECRET` in step 3.
5. To go live later: create the same things in the live dashboard, set `paddleEnv: 'production'` in `config.js` and `PADDLE_ENV=production` in Cloudflare, and ask Paddle to approve your domain. Paddle checks that the site shows pricing, terms, privacy and refund pages, so fill in the templates first.

### 3. Cloudflare (website and server functions)

Cloudflare offers two ways to host this: **Workers** (what the dashboard creates by default today) and **Pages**. The folder works with both. Use Workers unless you already have a Pages project.

**Workers (recommended)**

1. Put this folder in a GitHub repository (`config.js` holds only public values, so it can be committed; `.dev.vars` is ignored).
2. Cloudflare dashboard → **Workers & Pages → Create → Import a repository** → choose the repository.
   - Project name: the same as `"name"` in `wrangler.jsonc` (`trace`), or change that line to your Worker's name. **They must match**, or the deploy fails.
   - Build command: *(empty)*. Deploy command: `npx wrangler deploy`. Root directory: *(empty)*.
   - `wrangler.jsonc` tells Cloudflare to publish only the `public` folder and to run `worker.js` for `/api/…` and the share links `/v/…`.
3. Your Worker → **Settings → Variables and secrets** → add:

   | Name | Type | Value |
   |---|---|---|
   | `SUPABASE_URL` | Text | your Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | the service_role key |
   | `PADDLE_WEBHOOK_SECRET` | **Secret** | from Paddle notifications |
   | `PADDLE_API_KEY` | **Secret** | from Paddle authentication |
   | `PADDLE_ENV` | Text | `sandbox` (later `production`) |

4. **Settings → Domains & Routes → Add → Custom domain**: add your domain. Then use that domain in Supabase (step 1.4) and Paddle (steps 2.3 and 2.4).
5. Every push to GitHub redeploys the site.

> If a deploy fails with “Asset too large … node_modules/workerd”, the repository has no `wrangler.jsonc` (Cloudflare then tries to publish the whole repository). Add `wrangler.jsonc` and `worker.js` from this folder.

**Pages (if you prefer it)**

1. Dashboard → **Workers & Pages → Create → Pages → Connect to Git** → choose the repository.
   - Framework preset: **None**. Build command: *(empty)*. Build output directory: **`public`**.
   - The `functions/` folder is found automatically; `wrangler.jsonc` and `worker.js` are ignored.
2. **Settings → Variables and secrets**: the same five values as above (secrets **Encrypted**).
3. **Custom domains**: add your domain.

### 4. Check it works

1. Open `https://traceanim.com` → **Sign in** → **Create an account** → the email arrives → the link opens the profile step → fill it in → the editor opens and the cloud mark next to the project name says **Saved**.
2. **Share** → turn the link on → open it in a private window: the deck plays.
3. Account menu → **Upgrade to Pro** → pay with a [Paddle test card](https://developer.paddle.com/concepts/payment-methods/credit-debit-card) → within a few seconds the menu says **Pro plan**.
   If it does not, look at Paddle → Notifications → the destination's logs, and Cloudflare → your Worker → Observability → Logs (on Pages: Functions logs).
4. **Manage billing** → Paddle's page opens → cancel → the account returns to Free (decks are kept).

Before launch, fill in every highlighted part of `terms.html`, `privacy.html` and `refunds.html`.

---

## Updating a site that is already running

1. In Supabase → **SQL Editor**, run `supabase/migrations/002_profiles.sql`, then `supabase/migrations/003_pro_features.sql` (once each; safe to repeat).
2. In Supabase → **Authentication → URL Configuration**, set the Site URL to `https://traceanim.com` and add `https://traceanim.com/**` to the Redirect URLs.
3. Upload the changed files from `public/` to GitHub (keep your own `config.js`). Cloudflare redeploys by itself.

People who already have an account are asked for their profile the next time they open the editor; their projects are saved online again once it is done.

## Tests

```
npm test                       # server functions (11 checks) + database rules (70 checks)
```

The database tests need a local PostgreSQL (`createdb`, `psql`). The end-to-end test runs real browsers against a local copy of the whole stack: Postgres with the migration, [PostgREST](https://postgrest.org) (the data server Supabase uses), a small stand-in for Supabase Auth, and Cloudflare's own local runtime (wrangler) running the functions:

```
sh tests/e2e/start-stack.sh    # needs postgres, a postgrest binary, and wrangler (HOST=workers to run it as a Worker)
python3 tests/e2e/e2e_test.py <MathJax tex-svg.js> <supabase-js dist/umd folder>   # 143 checks
sh tests/e2e/stop-stack.sh
```

`tests/e2e/guide_walkthrough.py` follows the guide's first-slide steps in the real editor (17 checks), so you notice if a change to the editor makes the guide wrong.

Two editor tests need no server, only the editor file (or the running site):

```
python3 tests/editor/tours_test.py file:///path/to/trace.html    # the first chapters done with real clicks, typing and dragging (59 checks)
python3 tests/editor/select_test.py file:///path/to/trace.html   # picking thin lines, overlapping objects, Alt+click, Tab, the object list (17 checks)
python3 tests/editor/pro_test.py file:///path/to/trace.html      # white work area, PRO gates, Present badge, recording voice (26 checks)
python3 tests/editor/slider_test.py file:///path/to/trace.html   # live sliders: grabbing, fine control, − / +, typing a value, reset, keys (20 checks)
python3 tests/editor/drawing_test.py file:///path/to/trace.html  # library, SVG import (and that nothing in it runs), recolouring, paths that turn and leave a trail (30 checks)
python3 tests/editor/video_test.py file:///path/to/trace.html path/to/mp4-muxer.js   # Make a video: frames, voice, badge, 720p/1080p, cancel; checked with ffprobe (19 checks)
python3 tests/editor/tutorial_test.py file:///path/to/trace.html # every chapter of the interactive tutorial, start to finish, on a laptop and a phone (45 checks)
python3 tests/editor/home_test.py file:///path/to/trace.html     # the projects page: templates, cards, search, rename, duplicate, delete, Back/Forward (27 checks)
```

The end-to-end test covers: signing up on the sign-up page, the profile step and the profile reminder in the editor, the account page (editing the profile, signing out, deleting the account), the home page and legal pages, the demo tour, sign-in by email link, saving edits online, the free limit, sharing and the viewer, a second device, upgrading through a signed webhook, the billing portal, cancelling, deleting, signing out, and that the public key can neither read other decks nor grant Pro.

## Updating the editor

The editor is developed as the single file `trace.html`. After changing it:

```
node tools/make-app.mjs path/to/trace.html
```

This rebuilds `public/app.html` (it only adds the three cloud scripts and links the logo to the home page).

## Good to know

- **Two devices editing the same deck at once:** the most recent save wins. There is no live co-editing yet.
- **Images** are stored inside the deck, which is why decks have a size limit. Moving images to Supabase Storage would allow bigger decks later.
- **Signing out** removes the account's decks from that browser (they stay in the account). Decks with changes not yet saved online are kept and the user is asked first.
- **Pausing:** a free Supabase project pauses after 7 days without traffic; upgrade before launch.
- **Costs at launch:** Supabase Pro $25/month, Cloudflare $0, Paddle 5% + 50¢ per payment, Resend $0 up to 3,000 emails/month, domain ~$10–15/year.
