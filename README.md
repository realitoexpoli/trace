# Tracé — the SaaS version

Tracé is a browser editor for animated maths and physics slides. This package turns it into an online product with:

- **Accounts** (sign in with an email link, optionally Google)
- **Decks saved to the account**, opening on any device
- **Share links** (`/v/…`) that anyone can watch, with live sliders
- **Free and Pro plans**, with limits enforced by the database
- **Payments** through Paddle, which also collects VAT and sales tax worldwide
- A **home page** with pricing, a **user guide** at `/guide`, and **terms / privacy / refund** templates

Everything was tested on a full local copy of the stack (110 automated checks, see [Tests](#tests)).

---

## What is in the folder

```
public/                  the website (served as static files)
  index.html             home page with features, pricing and questions
  app.html               the editor (built from trace.html, see tools/make-app.mjs)
  cloud.js               accounts, cloud saving, sharing, Pro plan (added to the editor)
  config.js              PUBLIC settings: Supabase URL + public key, Paddle client token, price ids
  site.css, img/         home page style and screenshots
  guide/                 the user guide (/guide): getting started, objects, animating, presenting,
                         sharing, cheat sheet. Plain HTML pages; edit them directly. Linked from the
                         editor's Help button and the home page.
  terms.html, privacy.html, refunds.html   legal templates to fill in
  _redirects, _headers   Cloudflare rules: /v/<link> opens the viewer; security headers
functions/api/           two small server functions (run on Cloudflare)
  paddle-webhook.js      Paddle tells us a subscription started or ended → switch Free/Pro
  billing-portal.js      gives Pro users a link to Paddle's billing page (card, invoices, cancel)
lib/server.js            helpers for those functions (signature check, database calls)
supabase/migrations/001_init.sql   the whole database: tables, security rules, plan limits
tests/                   database tests, function tests, end-to-end browser test
tools/make-app.mjs       rebuilds public/app.html when you update trace.html
```

## How it fits together

```
 Browser ──── static pages ────► Cloudflare Pages (index.html, app.html, cloud.js)
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
| Editor, all objects and animations | ✓ | ✓ |
| Decks in the browser | unlimited | unlimited |
| Decks in the account | 3 | unlimited |
| Size of one deck (images included) | 2 MB | 20 MB |
| Share links | with “Made with Tracé” badge | no badge, view counts |

The real limits live in the database function `plan_limits` (in `001_init.sql`). If you change them, also update `freeDecks` in `public/config.js` and the pricing section of `public/index.html`.
Prices are set in Paddle; the labels shown in the app are `priceLabels` in `config.js`.

---

## Setting it up (about 1–2 hours, all free to start)

You need: a GitHub account, and accounts at Supabase, Cloudflare, Paddle and Resend (or another email sender). No credit card is needed for any of them while testing.

### 1. Supabase (database and sign-in)

1. Create a project at [supabase.com](https://supabase.com). Choose a region close to your users (for Europe: Frankfurt). Save the database password somewhere safe.
2. **SQL Editor → New query**: paste the whole of `supabase/migrations/001_init.sql`, then **Run**. It is safe to run again.
3. **Project Settings → API**: copy
   - the **Project URL** → `supabaseUrl` in `public/config.js`
   - the **anon / publishable** key → `supabaseAnonKey` in `public/config.js`
   - the **service_role / secret** key → keep it for step 3 (never put it in `config.js`).
4. **Authentication → URL Configuration**:
   - Site URL: `https://YOUR-DOMAIN/app`
   - Redirect URLs: add `https://YOUR-DOMAIN/app` and, for local testing, `http://localhost:8788/app`.
5. **Sign-in emails.** Supabase's built-in mailer sends only 2 emails an hour, and only to your own team, so it cannot serve real users. Create a free [Resend](https://resend.com) account (3,000 emails a month), verify your domain there, then in Supabase **Authentication → Emails → SMTP Settings** enter Resend's SMTP details (host `smtp.resend.com`, port 465, user `resend`, password = a Resend API key).
6. Optional: **Authentication → Providers → Google** to offer “Continue with Google”, then set `googleSignIn: true` in `config.js`.

> The free Supabase project pauses after a week without visitors. That is fine while testing; switch to Pro ($25 a month) when you launch.

### 2. Paddle (payments)

Start in the **sandbox** ([sandbox-vendors.paddle.com](https://sandbox-vendors.paddle.com)), which uses test cards and no real money.

1. **Catalog → Products → New product**: “Tracé Pro”. Add two prices: **$8 monthly** and **$72 yearly** (recurring). Copy both price ids (`pri_…`) into `prices` in `config.js`.
2. **Developer tools → Authentication**:
   - create a **client-side token** → `paddleClientToken` in `config.js`
   - create an **API key** with permission to write customer portal sessions → keep it for step 3 (`PADDLE_API_KEY`).
3. **Checkout → Checkout settings**: set the default payment link to `https://YOUR-DOMAIN/app`.
4. **Developer tools → Notifications → New destination**:
   - URL: `https://YOUR-DOMAIN/api/paddle-webhook`
   - Events: all `subscription.*` events (created, activated, updated, trialing, past_due, paused, resumed, canceled)
   - copy the **secret key** → `PADDLE_WEBHOOK_SECRET` in step 3.
5. To go live later: create the same things in the live dashboard, set `paddleEnv: 'production'` in `config.js` and `PADDLE_ENV=production` in Cloudflare, and ask Paddle to approve your domain. Paddle checks that the site shows pricing, terms, privacy and refund pages, so fill in the templates first.

### 3. Cloudflare Pages (website and server functions)

1. Put this folder in a GitHub repository (`config.js` holds only public values, so it can be committed; `.dev.vars` is ignored).
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → choose the repository.
   - Framework preset: **None**. Build command: *(empty)*. Build output directory: **`public`**.
   - The `functions/` folder is found automatically.
3. **Settings → Variables and secrets** (Production, and Preview if you use it) — add:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | your Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | the service_role key (**Encrypt**) |
   | `PADDLE_WEBHOOK_SECRET` | from Paddle notifications (**Encrypt**) |
   | `PADDLE_API_KEY` | from Paddle authentication (**Encrypt**) |
   | `PADDLE_ENV` | `sandbox` (later `production`) |

4. **Custom domains**: add your domain. Then use that domain in Supabase (step 1.4) and Paddle (steps 2.3 and 2.4).
5. Every push to GitHub redeploys the site.

### 4. Check it works

1. Open `https://YOUR-DOMAIN` → **Open the editor** → **Sign in** → the email arrives → you are signed in, and the cloud mark next to the project name says **Saved**.
2. **Share** → turn the link on → open it in a private window: the deck plays.
3. Account menu → **Upgrade to Pro** → pay with a [Paddle test card](https://developer.paddle.com/concepts/payment-methods/credit-debit-card) → within a few seconds the menu says **Pro plan**.
   If it does not, look at Paddle → Notifications → the destination's logs, and Cloudflare → your project → Functions logs.
4. **Manage billing** → Paddle's page opens → cancel → the account returns to Free (decks are kept).

Before launch, fill in every highlighted part of `terms.html`, `privacy.html` and `refunds.html`, and replace `hello@your-domain.example` in `index.html`.

---

## Tests

```
npm test                       # server functions (11 checks) + database rules (35 checks)
```

The database tests need a local PostgreSQL (`createdb`, `psql`). The end-to-end test runs real browsers against a local copy of the whole stack: Postgres with the migration, [PostgREST](https://postgrest.org) (the data server Supabase uses), a small stand-in for Supabase Auth, and Cloudflare's own local runtime (wrangler) running the functions:

```
sh tests/e2e/start-stack.sh    # needs postgres, a postgrest binary, and wrangler
python3 tests/e2e/e2e_test.py <MathJax tex-svg.js> <supabase-js dist/umd folder>   # 47 checks
sh tests/e2e/stop-stack.sh
```

`tests/e2e/guide_walkthrough.py` follows the guide's first-slide steps in the real editor (17 checks), so you notice if a change to the editor makes the guide wrong.

The end-to-end test covers: the home page and legal pages, the demo tour, sign-in by email link, saving edits online, the free limit, sharing and the viewer, a second device, upgrading through a signed webhook, the billing portal, cancelling, deleting, signing out, and that the public key can neither read other decks nor grant Pro.

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
