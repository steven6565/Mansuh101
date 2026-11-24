# Visitor — Organic SEO & Website Growth Platform

Visitor is a self-hosted workspace for growing websites **you own**. It pulls real
numbers from Google Search Console and Google Analytics 4, crawls your own site
for technical problems, tracks keyword targeting, plans content, and reports on
the traffic you actually send with UTM-tagged campaigns.

It does **not** simulate visits, generate fake clicks, rotate proxies, or touch
SERP/ad click behaviour. Every figure on screen comes from either a Google API
you authorised or a crawl of a URL you registered. When there is no data, the UI
says so instead of filling the gap with an estimate.

---

## Contents

1. [What it does](#what-it-does)
2. [What it deliberately will not do](#what-it-deliberately-will-not-do)
3. [Quick start](#quick-start)
4. [Configuration reference](#configuration-reference)
5. [Google integration setup](#google-integration-setup)
6. [Email delivery setup](#email-delivery-setup)
7. [Using the platform](#using-the-platform)
8. [Architecture](#architecture)
9. [API surface](#api-surface)
10. [Deployment](#deployment)
11. [Operations & maintenance](#operations--maintenance)
12. [Security model](#security-model)
13. [Troubleshooting](#troubleshooting)
14. [Testing](#testing)
15. [Project layout](#project-layout)
16. [FAQ](#faq)

---

## What it does

### Dashboard
Clicks, impressions, CTR and average position from Search Console alongside
sessions, users, engagement rate and conversions from GA4, for the selected site
and date range. Each KPI shows a period-over-period delta computed from stored
rows; the two sources are always labelled separately so you never compare a GSC
click to a GA4 session by mistake. Daily trend chart, top queries, top pages,
top sources, countries and device split are all included.

### Search Console
Your actual queries, pages, countries and devices for any window, with
pagination, sorting and CSV-friendly tables. Data is imported through the
Search Console API and stored per site, dimension and day, so historical windows
keep working even after Google's rolling 16-month window moves on.

### Analytics (GA4)
Sessions, active users, engagement, conversions, acquisition source/medium and
landing pages. GA4 is presented as a **separate** dataset from Search Console,
because it measures all channels while GSC measures search impressions only.

### Keywords
Track the phrases you are targeting. Each keyword records intent
(informational / commercial / transactional / navigational), a *labelled*
difficulty proxy, and its current coverage in your content. Performance is
joined against real GSC query rows on every load — never invented.

- **Research**: intent classification, clustering of related phrases, long-tail
  suggestions, and coverage gaps.
- **History**: position and clicks over time for any tracked keyword that
  appears in Search Console data.
- Keyword difficulty is explicitly a heuristic (query length + intent) and is
  labelled `heuristic-proxy` in the API. It is not Moz/Ahrefs/Semrush data.

### Site audit
A real crawler (HTTP, optionally headless Chromium) that inspects pages you own
and reports:

- title/description presence and length, duplicate titles/descriptions
- H1 presence, multiple H1s, skipped heading levels
- canonical tags, conflicting canonical clusters, `noindex`
- `robots.txt` parsing, sitemap discovery, sitemap validation and coverage gaps
- broken internal and external links
- images missing `alt` text
- near-duplicate content
- structured data (JSON-LD) presence and validity
- viewport/social meta, HTML weight, slow TTFB
- orphan pages, redirect chains, internal-link opportunities
- a 0–100 score with a letter-style grade, plus a concrete `fix` string per issue

Every issue carries evidence (URL, detail, example URLs), so nothing is a
mystery red number.

### Content
Content briefs generated from a target keyword: suggested title, meta
description, intent-aligned outline, internal-link targets and a word-count
target. Items move through a simple status workflow (idea → draft → review →
published) and can be linked to the keyword they serve.

### Campaigns
Create a campaign, get a correctly built UTM URL
(`utm_source` / `utm_medium` / `utm_campaign`), copy it, and distribute it
yourself. Attribution is then read from GA4's `sessionSourceMedium` rows — if
nobody used your link, the campaign shows no sessions.

### Reports
Generate an immutable snapshot for a site and period (daily, weekly or custom),
containing GSC totals + deltas + top queries/pages/countries/devices, GA4 totals
+ sources/landings, and the latest audit score. Export as Markdown or JSON, or
email it through your own SMTP server.

### Automation
Persisted scheduler for recurring work. Built-in job types:

| Type | What it does |
| --- | --- |
| `gsc-sync` | Import Search Console data for N days |
| `ga4-sync` | Import GA4 data for N days |
| `site-audit` | Crawl the site and record a fresh audit |
| `daily-report` | Generate a 1-day snapshot (optionally email it) |
| `weekly-report` | Generate a 7-day snapshot (optionally email it) |
| `campaign-review` | Reconcile campaigns against the latest GA4 rows |

Jobs survive restarts, retry with exponential backoff, log every run, and
optionally POST to `ALERT_WEBHOOK_URL` when retries are exhausted.

### Activity log
Every sync, crawl, report, scheduler transition and security event is recorded
with a timestamp, level and type, streamed live over Socket.IO and replayable
from the database.

---

## What it deliberately will not do

These are hard product limits, not missing features:

- **No fake traffic.** There is no endpoint that sends a visit, rotates an IP,
  spoofs a referrer or scrolls a page to look human.
- **No fake engagement.** No click loops, no ad clicking, no "dwell time"
  inflation.
- **No CAPTCHA bypass** and no anti-bot evasion. If a site blocks the crawler,
  the audit reports the block.
- **No third-party metric resale.** Difficulty/serp-position numbers come from
  Search Console or a documented heuristic, never from a scraped SERP.
- **No unauthorised crawling.** The crawler refuses private/loopback hosts
  (SSRF guard) and only crawls sites you register.
- **No invented numbers.** A missing integration, missing property or empty
  date range renders an explicit empty state.

---

## Quick start

Requirements: **Node 22.5+** (24 recommended), **pnpm 9+**. Chromium is optional
and only needed for rendered audits/screenshots.

```bash
# 1. Install
pnpm install --allow-build=esbuild

# 2. Configure
cp .env.example .env
# Edit .env: set APP_PASSWORD to a long random string.
openssl rand -base64 32

# 3. Build the dashboard
pnpm build

# 4. Run
pnpm start
# → http://localhost:4000
```

Development with hot reload:

```bash
pnpm dev            # Vite on :5173 + API on :4000 (proxy configured)
```

The SQLite database is created automatically at `data/visitor.db`. No migration
step is required — the schema is created on first boot and extended in place.

### First five minutes

1. Open the dashboard and click **Add site** — enter your domain.
2. Go to **Integrations → Connect Google account** (see
   [Google integration setup](#google-integration-setup)).
3. Click **Choose properties** and map the site to its Search Console property
   and GA4 property.
4. Press **Sync** in the top bar to import 28 days of data.
5. Run a **Site audit** from the *Site audit* page.

---

## Deployment modes

One codebase, three environments. Only environment-specific defaults differ —
every feature works in all three.

| Mode | Bind | Launch |
| --- | --- | --- |
| **VPS** | `0.0.0.0` (behind Nginx + PM2) | `sudo DOMAIN=seo.example.com bash deploy/install.sh` |
| **Localhost** (Linux/macOS/Windows Git Bash) | `127.0.0.1` | `./start-local.sh` |
| **Android Termux** (no root) | `127.0.0.1` | `./start-termux.sh` (run with `bash` if your launcher uses a non-Termux shebang) |

### 1. VPS — production, behind Nginx + PM2

```bash
sudo DOMAIN=seo.example.com bash deploy/install.sh
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d seo.example.com
# in /opt/visitor/.env: PUBLIC_URL=https://seo.example.com
sudo -u visitor bash -lc "cd /opt/visitor && pm2 restart visitor --update-env"
```

This uses `deploy/install.sh` (Node, pnpm, PM2, Chromium, nginx, auto-reloader).
It never touches Nginx or the server in the local scripts, and PM2 is the
process manager here — do not start a second copy with the scripts below.

### 2. Localhost — development on a laptop

```bash
cp .env.example .env        # once; then edit .env and set APP_PASSWORD
./start-local.sh            # start in the background, wait for health
./start-local.sh --status   # pid, mode, bind, uptime
./start-local.sh --restart  # stop + start
./start-local.sh --stop     # stop
./start-local.sh --foreground            # Ctrl-C to stop
PORT=4100 ./start-local.sh  # other port
HOST=0.0.0.0 ./start-local.sh           # only if you really want LAN exposure
node scripts/visitorctl.mjs logs        # tail data/logs/visitor.log
```

Everything is loopback-only by default. `HOST` is the explicit override and
always wins. Equivalent raw commands:

```bash
node scripts/visitorctl.mjs start --mode=local
node scripts/visitorctl.mjs status
```

### 3. Android Termux — on-device, no root

```bash
# once (or: pkg install nodejs-lts git)
./install-termux.sh
./start-termux.sh           # or: bash start-termux.sh
```

Notes for Termux:
- Requires Android 7+, aarch64/armv8l or x86_64 (the other packages are pure JS,
  so the platform gate rarely trips).
- No root, no systemd, no PM2, no apt: installs via `pkg` only and the startup
  uses `scripts/supervisor.mjs` — a built-in supervisor that restarts the
  server on crash with exponential backoff (1 s → 60 s) and stops after
  repeated fast crashes so a broken config stays visible.
- Allow Termux in Android settings (Battery → Unrestricted) or Android will
  freeze it when the screen is off.
- Rendered audits need a user-installed Chromium build (`CHROMIUM_PATH`); HTTP
  audits always work.
- Optional: Termux:Boot to restart after a reboot, and Termux:API for the
  built-in wake-lock + "open dashboard in browser" conveniences.

```bash
./start-termux.sh --status / --restart / --stop
node scripts/visitorctl.mjs logs --follow
```

Both scripts can also be driven from npm:

```bash
npm run local     # visitorctl start --mode=local
npm run termux    # visitorctl start --mode=termux
npm run status    # pnpm status / visitorctl status
npm run stop      # visitorctl stop
npm run restart   # visitorctl restart
```

### How modes are chosen

`DEPLOYMENT_MODE` is the authoritative switch and `start-local.sh` /
`start-termux.sh` set it explicitly. When it is unset, `server/src/runtime.js`
infers: Termux on Android → `termux`, `NODE_ENV=production` → `vps`, otherwise
`local`. `HOST` overrides the per-mode default, and `GET /api/diagnostics`
reports `runtime.bindHost` and `security.localOnly`.

---

## Configuration reference

All configuration is environment variables; see `.env.example` for the annotated
version.

### Core

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port (API + dashboard + Socket.IO) |
| `NODE_ENV` | `development` | `production` enables strict error responses and HSTS |
| `APP_PASSWORD` | — | **Required.** Dashboard password (32+ chars) |
| `AUTH_DISABLED` | `false` | Dev only — disables authentication entirely |
| `SESSION_TTL_DAYS` | `14` | Login session lifetime |
| `PUBLIC_URL` | — | Public origin, e.g. `https://seo.example.com` |
| `TRUST_PROXY` | `true` | Trust `X-Forwarded-*` (needed behind Nginx) |

### Storage

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:./data/visitor.db` | `sqlite:` path, `postgres://` URL, or a `.json` path for the JSON fallback |
| `DATA_DIR` | `./data` | Screenshots, logs, report artefacts, secrets file |
| `RETENTION_DAYS` | `90` | Days of metrics/events/audits to retain |

### Google

| Variable | Default | Purpose |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | — | OAuth 2.0 web client ID |
| `GOOGLE_CLIENT_SECRET` | — | OAuth 2.0 web client secret |
| `GOOGLE_REDIRECT_URI` | `PUBLIC_URL` + callback | Must match Google Console exactly |
| `GSC_DATA_LAG_DAYS` | `1` | Days to subtract from the end of GSC windows |
| `GOOGLE_API_KEY` | — | Optional Chrome UX Report key for field CWV |
| `TOKEN_ENCRYPTION_KEY` | auto | AES-256-GCM key for OAuth tokens at rest |

### Crawler & scheduler

| Variable | Default | Purpose |
| --- | --- | --- |
| `CRAWLER_USER_AGENT` | `VisitorSEO/2.0 (+…)` | Crawler identity — use a real contact URL |
| `MAX_AUDIT_PAGES` | `25` | Hard ceiling on pages per audit |
| `CRAWLER_CONCURRENCY` | `3` | Parallel requests |
| `CRAWLER_TIMEOUT_MS` | `15000` | Per-request timeout |
| `CRAWLER_MAX_BYTES` | `3000000` | Max HTML bytes read per page |
| `CRAWLER_ALLOW_PRIVATE` | `false` | **Disables the SSRF guard.** Dev only |
| `SCHEDULER_ENABLED` | `true` | Turn the job runner on/off |
| `SCHEDULER_TICK_MS` | `30000` | How often due jobs are checked |
| `SCHEDULER_MAX_RETRIES` | `2` | Retries before a job is marked failed |
| `REPORT_TIMEZONE` | `UTC` | Timezone for report windows |
| `ALERT_WEBHOOK_URL` | — | POST target on terminal job failure |

### Security & email

| Variable | Default | Purpose |
| --- | --- | --- |
| `RATE_LIMIT_PER_MINUTE` | `300` | Read-request budget per IP |
| `EXPENSIVE_RATE_LIMIT_PER_MINUTE` | `12` | Crawl/sync/report budget per IP |
| `CSRF_ORIGIN_CHECK` | `true` | Reject cross-origin state changes |
| `SMTP_HOST` / `SMTP_PORT` | — / `587` | Your SMTP relay |
| `SMTP_SECURE` | `false` | Implicit TLS (auto-true on port 465) |
| `SMTP_USER` / `SMTP_PASS` | — | SMTP credentials |
| `EMAIL_FROM` | `SMTP_USER` | From address on report emails |

---

## Google integration setup

Visitor talks to Google with your own OAuth 2.0 client. There is no shared
service account and no bundled credentials — this keeps your data in your own
Google project.

### 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com/> and create (or select) a project.
2. **APIs & Services → Library**, enable both:
   - *Google Search Console API*
   - *Google Analytics Data API*
3. Optional, for real Core Web Vitals field data: enable the
   *Chrome UX Report API*.

### 2. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type *External* (or *Internal* if you are on Workspace and only your
   organisation will use it).
3. Fill in app name, support email and developer contact.
4. Add scopes:
   - `openid`, `email`, `profile`
   - `https://www.googleapis.com/auth/webmasters.readonly`
   - `https://www.googleapis.com/auth/analytics.readonly`
5. While in *Testing* mode, add your own Google account under **Test users**.
6. Publish the app when you are ready for long-lived refresh tokens (otherwise
   test-mode refresh tokens expire after 7 days).

### 3. Create the OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Authorised redirect URI — this must match exactly:
   ```
   https://YOUR_DOMAIN/api/integrations/google/callback
   ```
   For local development: `http://localhost:4000/api/integrations/google/callback`
4. Copy the client ID and secret into `.env`:
   ```bash
   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxx
   GOOGLE_REDIRECT_URI=https://YOUR_DOMAIN/api/integrations/google/callback
   ```

Restart the server. The Integrations page now shows **Connect Google account**
instead of the credentials warning.

### 4. Connect and map

1. **Integrations → Connect Google account** — a popup opens Google's consent
   screen. Authorise the account that already has access to your Search Console
   properties and GA4 properties.
2. Return to the dashboard; the popup closes and the page refreshes.
3. **Choose properties** → map each site to one Search Console property and one
   GA4 property. Mapping only tells Visitor *which* property to read; the
   connected account must already have permission on it.

### 5. Sync

Press **Sync** in the top bar, or schedule a `gsc-sync` / `ga4-sync` job. The
first sync for a 28-day window typically takes a few seconds per source.

### Where tokens live

Refresh tokens are encrypted with AES-256-GCM before being written to the store.
The key comes from `TOKEN_ENCRYPTION_KEY`, or — if unset — is generated once and
stored in `data/.secrets.json` with mode `0600`. Back that file up together with
your database; without it the tokens cannot be decrypted (you would simply
reconnect).

### Disconnecting

**Integrations → Disconnect** deletes the stored tokens. It does not revoke the
grant on Google's side; do that at
<https://myaccount.google.com/permissions> if you want to be thorough.

---

## Email delivery setup

Report emails are optional and use your own SMTP relay — nothing is routed
through a third-party mail service by Visitor.

```bash
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false      # true for implicit TLS (usually port 465)
SMTP_USER=reports@yourdomain.com
SMTP_PASS=your-app-password
EMAIL_FROM=Visitor Reports <reports@yourdomain.com>
```

Check readiness on **Integrations → Email delivery** or `GET /api/diagnostics`
(`integrations.email.ok`). When unset, the **Email** button in Reports stays
disabled and reports can still be exported as Markdown/JSON — nothing is
silently "sent".

Gmail note: normal passwords do not work. Enable 2FA and create an
[App Password](https://myaccount.google.com/apppasswords), or use an SMTP relay
such as SendGrid/Postmark/Mailgun.

---

## Using the platform

### Sites
A *site* is a property you own. It stores the URL, the linked Search Console and
GA4 properties, locale, timezone and notes. Everything else — keywords, audits,
content, campaigns, reports, metrics — is scoped to a site. Removing a site
deletes its metrics and detaches its records.

### Date ranges
The top bar range selector (7 / 28 / 90 / 180 / 365 days) applies to every
analytics view and is persisted in local storage. Requests pass `days` or an
explicit `from`/`to` pair.

### Reading the numbers honestly
- **Clicks / impressions / CTR / position** are Search Console.
- **Sessions / users / engagement / conversions** are GA4 and cover all
  channels.
- A blank table usually means "no rows stored for this window" — press **Sync**,
  then re-check. If it persists, the *Integrations* page will tell you whether
  Google is connected and when the last sync happened.

### Auditing safely
Audits respect `robots.txt` by default, use your configured user agent, cap the
page count and apply a per-request timeout. Enable *Crawler → rendered crawl* in
Settings only if Chromium is installed; it costs far more memory and time.

---

## Architecture

```
server/
  src/
    index.js              bootstrap: store → services → scheduler → HTTP → socket
    routes.js             the entire REST API (single router, mounted at /api)
    config.js             env parsing, defaults, validation helpers
    auth.js               password login, hashed session tokens, rate limiting
    health.js             host metrics sampling (CPU/RAM/disk)
    realtime.js           read-only Socket.IO channels (status + activity)
    engine/
      audit.js            crawler + rule-based SEO analysis + scoring
      browser.js          Puppeteer manager (rendered audits, screenshots only)
    integrations/
      google.js           OAuth, GSC query/sync, GA4 runReport/sync
    services/
      sites.js keywords.js campaigns.js content.js audits.js
      reports.js scheduler.js
    lib/
      net.js              SSRF-guarded fetch
      html.js             HTML parser/analyser
      robots.js           robots.txt + sitemap parser/builder
      keywords.js         intent, clustering, long-tail, coverage, briefs
      smtp.js             minimal SMTP client for report delivery
      vault.js            AES-256-GCM token encryption
      http.js             rate limiting, origin guard, validators
      response.js         cache headers
    store/
      index.js            composition: SqlStore + SeoStore, or JsonStore
      sql-store.js        shared SQL tables (settings, activity events, tokens)
      seo-store.js        entity documents + numeric metric rows
      json-store.js       file-backed fallback with the same interface
      drivers.js          node:sqlite / Postgres drivers
web/
  src/
    App.jsx               shell: auth gate, sidebar, topbar, page router
    store.jsx             app context: theme, sites, range, toasts, socket
    components/           design system (ui.jsx, Charts, Icons, Brand, …)
    pages/                Dashboard, SearchConsole, Analytics, Keywords, Audit,
                          Content, Campaigns, Reports, Automation,
                          Integrations, Settings, Activity
```

### Data model

Two complementary storage shapes live behind one `store` object:

- **Entities** — JSON documents keyed by `(kind, id)`. Kinds: `site`,
  `keyword`, `campaign`, `content`, `audit`, `report`, `job`, `integration`.
  Schemas evolve without migrations.
- **Metrics** — numeric rows in `seo_metrics`, unique on
  `(site_id, source, dimension, dimension_key, date)`. Sources are `gsc` and
  `ga4`; dimensions are `date`, `query`, `page`, `country`, `device`, `source`,
  `landing`. Aggregation happens in SQL (or an equivalent in-memory reduce for
  the JSON store), so charts stay fast as history grows.

Syncs are idempotent: re-importing a day replaces the row rather than
duplicating it, which is why overlapping scheduled syncs are safe.

### Frontend

React 18 + Vite + Tailwind. No chart library — the charts are small SVG
components so the bundle stays lean (~367 kB, ~105 kB gzipped). Every page uses a
shared `useApi` hook that supplies `{ data, loading, error, refetch }`, so
loading skeletons, retry buttons and empty states are consistent and honest.

---

## API surface

All routes are under `/api` and require authentication unless `AUTH_DISABLED=true`.

### Public
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness + scheduler summary |
| `POST` | `/auth/login` | Password login (rate limited) |
| `GET` | `/auth/me` | Session probe |
| `POST` | `/auth/logout` | Destroy session |
| `GET` | `/integrations/google/callback` | OAuth redirect target |

### Sites & analytics
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/bootstrap` | App config, sites, integrations, jobs |
| `GET/POST` | `/sites` | List / create sites |
| `GET/PATCH/DELETE` | `/sites/:id` | Read / update / remove (cascades) |
| `GET` | `/sites/:id/overview` | KPI bundle + series + top lists |
| `GET` | `/sites/:id/performance` | Paginated metric table for any dimension |
| `POST` | `/sites/:id/sync` | Manual GSC/GA4 sync |
| `GET` | `/health/full` | Host metrics sample (CPU/RAM/disk) |

### Google
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/integrations/google` | Status, scopes, setup requirements |
| `GET` | `/integrations/google/authorize` | Returns the consent URL |
| `POST` | `/integrations/google/disconnect` | Delete stored tokens |
| `POST` | `/integrations/google/properties/refresh` | Re-discover properties |
| `POST` | `/integrations/google/select` | Set default property selection |

### Keywords, audits, sitemaps
| Method | Path | Purpose |
| --- | --- | --- |
| `GET/POST` | `/keywords` | List / create |
| `POST` | `/keywords/bulk` | Bulk create (newline or array) |
| `PATCH/DELETE` | `/keywords/:id` | Update / remove |
| `GET` | `/keywords/research` | Intent, clusters, long-tail, coverage |
| `GET` | `/keywords/:id/history` | Position/clicks over time |
| `GET` | `/sites/:id/keywords/performance` | Tracked keywords joined with real GSC rows |
| `GET/POST` | `/sites/:id/audits` | List / run an audit |
| `GET/DELETE` | `/audits/:id` | Full audit / delete |
| `GET` | `/audits/:id/export` | JSON or CSV export |
| `GET` | `/sites/:id/sitemap` | Build a sitemap from the last crawl (`?download=1` for XML) |
| `POST` | `/sites/:id/sitemap/validate` | Validate a sitemap URL |
| `GET` | `/sites/:id/robots` | Fetch and analyse robots.txt |
| `GET` | `/screenshots/:file` | Serve a rendered-audit screenshot (name-validated) |

### Campaigns, content, reports, jobs
| Method | Path | Purpose |
| --- | --- | --- |
| `GET/POST` | `/campaigns` | List / create (returns tagging URL) |
| `PATCH/DELETE` | `/campaigns/:id` | Update / remove |
| `GET` | `/sites/:id/campaigns/performance` | GA4 attribution per campaign |
| `GET/POST` | `/content` | List / create briefs |
| `PATCH/DELETE` | `/content/:id` | Update status / remove |
| `GET` | `/sites/:id/content/gaps` | Keyword coverage gaps |
| `POST` | `/sites/:id/content/optimize` | Brief for an existing page |
| `GET/POST` | `/reports` | List / generate |
| `GET/DELETE` | `/reports/:id` | Read / delete |
| `GET` | `/reports/:id/export` | Markdown or JSON |
| `GET` | `/reports/export` | One-shot generate + export (JSON/CSV, for bookmarks) |
| `POST` | `/reports/:id/deliver` | Email via SMTP |
| `GET/POST` | `/jobs` | List / create scheduled jobs |
| `PATCH/DELETE` | `/jobs/:id` | Update / remove |
| `POST` | `/jobs/:id/run` | Run immediately |
| `GET` | `/activity` | Event log |
| `GET/PUT` | `/settings` | Crawl/retention settings |
| `GET` | `/diagnostics` | Runtime, store, integrations, security |

Errors return `{ "error": "message" }` with a matching status code. Failed
requests are rate limited per IP, and state-changing requests are rejected when
the `Origin` header does not match the host.

---

## Deployment

### systemd / PM2 on a VPS

```bash
sudo DOMAIN=seo.example.com bash deploy/install.sh
```

The script installs Node, pnpm, PM2 and Chromium, copies the app to
`/opt/visitor`, generates a random `APP_PASSWORD`, builds the frontend, starts
PM2, configures Nginx and runs a health check. It is re-runnable and never
overwrites an existing `.env`.

Then:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d seo.example.com
```

Set `PUBLIC_URL=https://seo.example.com` in `/opt/visitor/.env` and
`pm2 restart visitor --update-env`.

### Updating a running instance

```bash
./deploy/deploy.sh visitor@YOUR_SERVER
```

Rsyncs the working copy (excluding `node_modules`, `data`, `.env`), rebuilds,
and does a zero-downtime PM2 reload.

### Docker-free single binary alternative

`pnpm build && node server/src/index.js` is all the runtime needs; the frontend
is served from `web/dist` by the same Express process.

### Reverse proxy notes
- Proxy `/` and `/socket.io` (WebSocket upgrade) to `127.0.0.1:4000`.
- Keep `TRUST_PROXY=1` so client IPs (and rate limits) are correct.
- A full example lives in `deploy/nginx.conf`.

---

## Operations & maintenance

- **Backups** — copy `data/` (database, `.secrets.json`, screenshots) on a
  schedule. The database is a single file in the default configuration.
- **Retention** — a maintenance loop runs at boot and every 6 hours, pruning
  metrics, events and screenshot files older than `RETENTION_DAYS`.
- **Scheduler** — jobs are stored as entities. A job interrupted by a restart is
  left `running`; the next tick clears it and retries according to its policy.
- **Logs** — structured event log in the UI (`/activity`), stdout for the
  process manager, and `data/logs/` for PM2 output if configured.
- **Health** — `GET /api/health` for liveness, `GET /api/diagnostics` for a full
  snapshot (store engine, integrations, scheduler, security flags).
- **Preflight** — `pnpm doctor` checks Node version, writability, Chromium,
  password strength and database reachability. Add `--launch` to verify a real
  Chromium render.

---

## Security model

| Concern | Control |
| --- | --- |
| Dashboard access | Single password, hashed session token in an `HttpOnly`, `SameSite=Lax` cookie; `Secure` when `PUBLIC_URL` is https |
| Brute force | Per-IP lockout after 6 failed logins (15 min), plus general rate limits |
| CSRF | `Origin` header must match the request host for any non-GET request |
| OAuth tokens | AES-256-GCM encrypted at rest; key from env or `data/.secrets.json` (0600) |
| OAuth scopes | Read-only (`webmasters.readonly`, `analytics.readonly`) — Visitor cannot modify your properties |
| SSRF | Crawler resolves DNS and refuses loopback, private, link-local, CGNAT and metadata ranges |
| Secrets in logs | Tokens are never logged; only ids/counts appear in events |
| Errors | 5xx responses return a generic message in production; details stay in logs |
| Headers | `nosniff`, `SAMEORIGIN`, strict referrer policy, restrictive permissions policy, HSTS when https |
| Input | Every route validates and clamps arguments (numbers, enums, dates, lengths) |

> **Before exposing this to the internet:** set a long `APP_PASSWORD`, keep
> `AUTH_DISABLED=false`, set `PUBLIC_URL` to your https origin, serve over TLS,
> and leave `CRAWLER_ALLOW_PRIVATE=false`.

---

## Troubleshooting

**“Google is not configured” persists**
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` must both be present *and* the
server restarted. Check `GET /api/diagnostics → integrations.google.configured`.

**OAuth fails with `redirect_uri_mismatch`**
The URI in Google Console must match `GOOGLE_REDIRECT_URI` byte for byte,
including scheme, host, path and trailing-slash absence.

**Connected, but every chart is empty**
Either no property is mapped (Integrations → Choose properties), or no sync has
run. Press **Sync**, then check **Activity** for the sync result. Search Console
also finalises data 2–3 days late — adjust `GSC_DATA_LAG_DAYS` if you want to
exclude the most recent days.

**GA4 returns no rows for a property**
Confirm the Data API is enabled and the connected account has at least Viewer
access to that property. The property id must look like `properties/123456789`.

**Audit says “Chromium executable not found”**
Install Chromium (`sudo apt install -y chromium` or `snap install chromium`) or
set `CHROMIUM_PATH`. HTTP-only audits work fine without it; rendered audits and
screenshots need the binary.

**Audit reports “private address blocked”**
The SSRF guard refused the target. That is intentional. For local development
against `localhost`, set `CRAWLER_ALLOW_PRIVATE=true` temporarily.

**Reports show “no data”**
The snapshot is accurate — the window genuinely has no stored rows. Sync first,
then regenerate.

**Email button is disabled**
`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM` must all be set.

**Scheduler not running**
`SCHEDULER_ENABLED=true` and the process must stay alive; check
`GET /api/health → scheduler`.

**Rate-limited (429)**
Adjust `RATE_LIMIT_PER_MINUTE` / `EXPENSIVE_RATE_LIMIT_PER_MINUTE`, and make
sure `TRUST_PROXY=1` so the real client IP is used.

---

## Testing

```bash
pnpm test           # 45 assertions against the JSON store
pnpm test:sqlite    # same suite against SQLite
pnpm doctor         # environment preflight
pnpm doctor --launch  # + real Chromium render/screenshot check
pnpm build          # production frontend build
```

The suite (`server/scripts/selftest.js`) needs no network, Chromium or Google
credentials. It covers `robots.txt` parsing/allowing (including named
user-agent groups), sitemap parse/build, HTML analysis, keyword intent and
clustering, campaign URL construction, settings clamping, and store behaviour —
including that aggregating an empty range returns zeros rather than inventing
numbers, that re-upserting a day replaces rather than duplicates a row, that no
metrics are deleted before their cutoff, and that the activity log and login
sessions are written, listed and pruned by retention/expiry.

Manual API smoke test:

```bash
DATA_DIR=/tmp/visitor-check PORT=4111 AUTH_DISABLED=true \
  DATABASE_URL=sqlite:/tmp/visitor-check/test.db node server/src/index.js

curl -s localhost:4111/api/health
curl -s -X POST localhost:4111/api/sites -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","name":"Example"}'
```

---

## Project layout

```
.
├── .env.example
├── package.json            workspace root (scripts, pnpm config)
├── pnpm-workspace.yaml
├── data/                   runtime state (gitignored): db, secrets, screenshots
├── deploy/
│   ├── install.sh          Ubuntu provisioner
│   ├── deploy.sh           rsync + rebuild + PM2 reload
│   ├── ecosystem.config.cjs
│   ├── nginx.conf          HTTPS reverse proxy example
│   ├── nginx-http.conf     HTTP bootstrap proxy
│   └── install-windows.ps1
├── server/
│   ├── package.json
│   ├── scripts/
│   │   ├── selftest.js     offline test suite
│   │   └── doctor.js       preflight checks
│   └── src/                (see Architecture)
└── web/
    ├── index.html
    ├── tailwind.config.js
    ├── vite.config.js
    └── src/
```

---

## FAQ

**Is this a traffic bot?**
No. It is an analytics and audit platform for sites you own. There is no traffic
generation code anywhere in the repository.

**Where do the numbers come from?**
Google Search Console API, Google Analytics Data API, and HTTP crawls of the
URL you registered. Nothing else.

**Why is keyword difficulty a “heuristic proxy”?**
Real difficulty requires backlink and SERP data from a third-party index we do
not have. Visitor computes a transparent proxy (query length + intent) and
labels it as such, then shows *measured* position and CTR from Search Console
wherever that data exists.

**Can I use it without Google?**
Yes. Audits, sitemap/robots tooling, keyword planning, content briefs, campaign
URL building and activity logging all work offline. Analytics tabs show clear
empty states until an integration is connected.

**Does it support multiple sites?**
Yes — unlimited sites, each mapped to its own Google properties.

**Postgres?**
Set `DATABASE_URL=postgres://…` and install the optional `pg` package. SQLite is
the default because it needs no server and no native build.

**Is my data sent anywhere?**
Only to the Google APIs you authorise, and to your SMTP relay if you configure
report email. No telemetry, no analytics beacons, no third-party calls.

---

## License

Private project. All rights reserved by the repository owner.
