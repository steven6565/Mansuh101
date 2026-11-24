# MANSU101 — Remote Browser Automation & Live Monitoring

A production-ready control plane for driving **real Chromium sessions on a remote Ubuntu VPS** with Puppeteer, streaming every event to a premium dark dashboard over Socket.IO.

Nothing runs in the dashboard browser. No simulated progress. No fake logs. Every counter, screenshot, HTTP code, JS error, network failure and host metric in the UI comes from the backend engine on the server.

---

## 1. What it does

**Browser engine (VPS)**

- Node.js + Express + Puppeteer + system Chromium
- A fresh isolated incognito browser context and tab **per URL**
- Configurable browser profiles / User-Agent, viewport, locale and timezone
- Configurable concurrency, navigation timeout, session duration, screenshot cadence
- Detects DNS, SSL, connection, timeout and HTTP errors with error codes
- Captures page title, final URL, HTTP status, JS errors, failed requests, screenshots
- Closes each tab/context automatically; closes idle Chromium to free RAM
- Restart-safe queue: interrupted runs are marked and history is preserved
- Resource limits for a 7-core / 32 GB / 80 GB VPS

**Dashboard**

- Live stats: total/completed URLs, successes, failures, active sessions, active tabs, current URL, HTTP status, page stage, browser status, timings
- Live browser monitoring cards with screenshots, titles, status codes, JS/network diagnostics, progress
- Start / Pause / Resume / Stop / Restart / Clear logs / Clear history / Export report
- URL manager with bulk add, enable/disable, remove
- Terminal-style live event stream with level filters, search and download
- Throughput/outcome charts, host CPU/RAM/disk gauges, run history
- Responsive layout, real-time Socket.IO updates, secure login

**Operations**

- SQLite (built into Node) with optional PostgreSQL adapter
- PM2 process recovery + graceful shutdown
- Nginx reverse proxy with WebSocket support, TLS via certbot
- Optional visible Chromium mode + secure noVNC remote desktop
- One-command provisioning (`deploy/install.sh`) and deployment (`deploy/deploy.sh`)

---

## 2. Architecture

```
┌──────────────────────────── Android / browser ────────────────────────────┐
│  React + Vite + Tailwind dashboard                                        │
│  · Socket.IO client (snapshot, run, session, log, health events)          │
│  · Cookie-authenticated REST calls (/api/*)                               │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │ HTTPS / WSS (Nginx)
┌───────────────────────────────▼───────────────────────────────────────────┐
│  Ubuntu VPS — Express + Socket.IO (PM2, single instance)                  │
│                                                                           │
│  AuthService ──password→ token cookie ── Socket.IO handshake auth         │
│                                                                           │
│  AutomationEngine ──queue──► N workers (concurrency limit)                │
│        │                         │                                        │
│        │                         ├─► BrowserManager (Puppeteer/Chromium)  │
│        │                         │      fresh context per URL            │
│        │                         │      page.goto → DOM loaded            │
│        │                         │      desktop screenshot (JPEG)         │
│        │                         ▼                                        │
│        │                    events (real): navigation, HTTP, JS errors,  │
│        │                    network failures, screenshots, operator cmds  │
│        ▼                                                                  │
│  Event bus ──► Socket.IO broadcast + database persistence + stdout        │
│                                                                           │
│  Store: SQLite (node:sqlite) │ PostgreSQL (pg) │ JSON fallback            │
│  HealthMonitor: CPU / RAM / disk / load / process metrics (5 s)           │
└───────────────────────────────────────────────────────────────────────────┘
```

### Repository layout

```
mansu101/
├── config/urls.json              # Seed URL configuration (imported once)
├── server/
│   ├── src/
│   │   ├── index.js              # Bootstrap, static frontend, shutdown, maintenance
│   │   ├── config.js             # Env parsing, profiles, settings validation
│   │   ├── auth.js               # Password/token auth, rate limiting, cookie/socket auth
│   │   ├── routes.js             # REST API
│   │   ├── realtime.js           # Socket.IO wiring
│   │   ├── health.js             # Real host metrics
│   │   ├── report.js             # JSON/CSV report generation
│   │   ├── engine/browser.js     # Chromium detection, launch, contexts, idle close
│   │   ├── engine/runner.js      # Queue, workers, navigation workflow, diagnostics
│   │   └── store/                # SQLite / PostgreSQL / JSON persistence + recovery
│   └── scripts/
│       ├── seed-urls.js          # Import config/urls.json
│       ├── doctor.js             # Preflight + real Chromium render test
│       └── engine-smoke-test.js  # Deterministic engine test (fake Chromium)
├── web/
│   └── src/                      # React dashboard (pages, components, store)
├── deploy/
│   ├── install.sh                # Ubuntu provisioner
│   ├── deploy.sh                 # rsync + build + PM2 reload
│   ├── ecosystem.config.cjs      # PM2
│   ├── nginx-http.conf           # Bootstrap reverse proxy (certbot-friendly)
│   ├── nginx.conf                # HTTPS template
│   ├── nginx-vnc-snippet.conf    # Optional /vnc proxy
│   └── vnc-setup.sh              # Xvfb + x11vnc + noVNC systemd units
└── .env.example
```

---

## 3. Requirements

| Component | Requirement |
|---|---|
| VPS | Ubuntu 22.04 / 24.04, 4+ cores, 8+ GB RAM (tuned for 7c / 32 GB) |
| Node.js | **24 LTS recommended**, must be ≥ 22.5 (built-in SQLite) |
| Chromium | distro `chromium`/`chromium-browser`, or Google Chrome |
| Packages | `pnpm`, `nginx`, `pm2`, `sqlite3` (installed by provisioner) |
| Client | Any modern browser / Android phone |

The dashboard is a PWA-friendly responsive web app; no local browser automation happens on the phone.

---

## 4. Local development

```bash
git clone <your-repo> mansu101   # or copy this directory
cd mansu101
cp .env.example .env

# Edit .env: set APP_PASSWORD, CHROMIUM_PATH if not auto-detected
pnpm install --allow-build=esbuild
pnpm build          # builds web/dist

# Terminal 1 — API + engine (port 4000)
pnpm dev:server

# Terminal 2 — Vite dev server (port 5173, proxies /api + /socket.io)
pnpm dev:web
```

Open `http://localhost:5173`.

If Chromium is not installed yet the server still starts; **Start run** returns a clear error and the dashboard shows “Browser error”. Install Chromium (or set `CHROMIUM_PATH`) and restart. Check everything with:

```bash
pnpm run doctor --launch
```

On a phone/Android environment without Chromium you can still run the deterministic engine test:

```bash
pnpm test
```

---

## 5. VPS deployment (recommended)

### 5.1 Upload and provision

```bash
# From your workstation
rsync -az --exclude node_modules --exclude data --exclude .env \
  ./ mansu@YOUR_VPS_IP:/tmp/mansu101/

ssh mansu@YOUR_VPS_IP
sudo DOMAIN=automation.yourdomain.com bash /tmp/mansu101/deploy/install.sh
```

`install.sh` (idempotent):

1. Installs Node 24, pnpm, PM2, Nginx, Chromium/Chrome, SQLite tools
2. Creates the `mansu` user and `/opt/mansu101`
3. Generates `.env` with a **random 24-character password** (printed once)
4. Installs dependencies, builds the dashboard
5. Starts PM2, enables boot persistence
6. Installs the Nginx reverse proxy and verifies `/api/health`

If you omit `DOMAIN`, Nginx uses `server_name _` and the dashboard is reachable by IP.

### 5.2 TLS

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d automation.yourdomain.com
```

Then set the public origin so cookies are marked `Secure`:

```bash
sudo sed -i 's|^PUBLIC_URL=.*|PUBLIC_URL=https://automation.yourdomain.com|' /opt/mansu101/.env
sudo -u mansu bash -lc 'cd /opt/mansu101 && pm2 restart mansu101 --update-env'
```

> If `PUBLIC_URL` is HTTPS but you open the dashboard over plain HTTP, the browser will reject the login cookie. Keep them consistent (`http://IP` → empty `PUBLIC_URL`).

### 5.3 Verify

```bash
sudo -u mansu bash -lc 'cd /opt/mansu101 && pnpm run doctor --launch'
curl -s https://automation.yourdomain.com/api/health
pm2 logs mansu101
```

Log in with the printed password. Add URLs, start a run, watch screenshots and the terminal stream.

### 5.4 Updates

```bash
# From the source machine (as the user that owns /opt/mansu101)
./deploy/deploy.sh mansu@YOUR_VPS_IP
```

This rsyncs (preserving `.env` and `data/`), rebuilds, reloads PM2 and runs a health check.

### 5.5 Windows Server / Windows RDP (quick start)

The dashboard is a normal web app, so it also runs on a Windows Server with
Remote Desktop — no Linux required. From an **Administrator PowerShell** in the
project folder:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\install-windows.ps1
```

The script installs/validates Node 22+, pnpm and PM2, finds Chrome or Edge
(`CHROMIUM_PATH` is written to `.env` automatically), generates a random
password, installs dependencies, builds the dashboard, opens the firewall port
and starts the process.

Then open `http://127.0.0.1:4000` (or `http://<server-ip>:4000`) in the browser
and log in with the printed password. Keep the RDP session disconnected rather
than signed out so the desktop session (and non-headless Chrome) survives.

Manual equivalent:

```powershell
cd C:\mansu101
copy .env.example .env      # then set APP_PASSWORD and CHROMIUM_PATH
pnpm install --allow-build=esbuild
pnpm build
pm2 start server/src/index.js --name mansu101
```

> For a public server prefer HTTPS (IIS ARR / reverse proxy or Caddy) and never
> expose port 4000 directly to the internet.

### 5.6 Manual deployment (no provisioner)

```bash
cd /opt/mansu101
pnpm install --allow-build=esbuild && pnpm build
pm2 start deploy/ecosystem.config.cjs && pm2 save
sudo cp deploy/nginx-http.conf /etc/nginx/sites-available/mansu101
sudo ln -sf /etc/nginx/sites-available/mansu101 /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 6. Configuration

All runtime configuration lives in `.env` (see `.env.example`). Automation limits are also editable in the dashboard and persisted in the database.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | Express + Socket.IO port |
| `APP_PASSWORD` | `mansu101` | Dashboard password — **change this** |
| `AUTH_DISABLED` | `false` | Dev-only; never on a public VPS |
| `SESSION_TTL_DAYS` | `14` | Login token lifetime |
| `PUBLIC_URL` | — | Public origin; enables secure cookies on HTTPS |
| `TRUST_PROXY` | `1` | Trust Nginx `X-Forwarded-*` |
| `DATABASE_URL` | `sqlite:./data/mansu101.db` | `sqlite:` or `postgres://` |
| `DATA_DIR` | `./data` | Database, screenshots, PM2 logs |
| `RETENTION_DAYS` | `30` | History/event/screenshot retention |
| `CHROMIUM_PATH` | auto-detect | System browser executable |
| `BROWSER_HEADLESS` | `true` | `false` needs Xvfb + `DISPLAY` |
| `MAX_CONCURRENCY` | `8` | Hard ceiling for dashboard setting |
| `BROWSER_IDLE_CLOSE_MS` | `180000` | Close idle Chromium after 3 min |
| `CHROMIUM_EXTRA_ARGS` | — | Comma-separated extra flags |
| `VNC_URL` | — | noVNC URL embedded in the dashboard |
| `DISPLAY` | — | e.g. `:99` for visible mode |

### Browser profiles

Built in (Settings → profile):

- Desktop Chrome / Windows, Desktop Chrome / macOS
- Mobile Chrome / Android, Mobile Safari / iPhone, Tablet Safari / iPad
- Custom User-Agent

Each context also receives the configured viewport, scale factor, touch/mobile flags, locale and timezone.

---

## 7. Automation workflow (per URL)

1. Create a fresh incognito browser context
2. Open a new tab, apply profile / UA / viewport / locale / timezone
3. Navigate with `page.goto`, wait for **DOM content loaded**
4. Monitor network activity (best-effort idle wait, never fatal)
5. Record HTTP response status, final URL and page title
6. Capture `pageerror` + console errors and failed requests
7. Capture a JPEG screenshot (plus periodic live screenshots if enabled)
8. Stream progress/events to the dashboard and persist a session record
9. Close the tab and context; release the worker slot
10. When all URLs finish, finalize the run, write totals and close idle Chromium

Errors are classified as `DNS_ERROR`, `SSL_ERROR`, `CONNECTION_ERROR`, `TIMEOUT`, `HTTP_ERROR`, `ABORTED`, `NAVIGATION_ERROR` or `SESSION_ERROR` and shown on the session card and in reports.

**The engine never clicks ads, simulates ad impressions or generates artificial advertising traffic.** It only loads the URLs you provide for legitimate automation and browser compatibility testing.

---

## 8. Resource tuning (7 CPU / 32 GB / 80 GB)

- Default/recommended concurrency: **4–6** headless sessions. Each Chromium context shares the browser process; memory grows with tabs and heavy pages. `MAX_CONCURRENCY` is capped at 8.
- `BROWSER_IDLE_CLOSE_MS=180000` frees Chromium between runs.
- Keep `screenshotIntervalMs` at 8–15 s for live previews, or `0` to capture only the final screenshot (lightest).
- Enable **Block images** for fast compatibility/status sweeps.
- Screenshots are JPEG quality 72, one file per session (overwritten by later captures), retained with `RETENTION_DAYS`.
- 80 GB is ample; monitor via the Disk gauge. Rough estimate: ~50–200 KB per screenshot, plus SQLite history.
- PM2 caps the process at 1.5 GB `max_memory_restart`; Chromium is a child process and is terminated on restart. Use `pm2 monit` for live monitoring.
- Run **one** PM2 instance. The queue and browser contexts are in-process; clustering would duplicate state.

---

## 9. Persistence, restart safety & retention

- **SQLite** via Node's built-in `node:sqlite` (WAL mode) — zero native builds. If unavailable (old Node), the server falls back to an atomic JSON store and logs a warning.
- **PostgreSQL** support is included:
  ```bash
  pnpm --dir server add pg
  # .env: DATABASE_URL=postgres://mansu:secret@127.0.0.1:5432/mansu101
  ```
- Runs, sessions, diagnostics, events and auth tokens are persisted.
- On startup, any run/session left `running`/`paused` is marked `interrupted` (`SERVER_RESTART`) so history never lies.
- A maintenance job prunes events, terminal sessions, old runs, expired tokens and screenshots every 6 hours according to `RETENTION_DAYS`.

Database schema: `settings`, `urls`, `runs`, `sessions`, `events`, `auth_tokens` (see `server/src/store/sql-store.js`).

**Clearing history.** *History → Clear history* (`POST /api/history/clear`) deletes finished runs, their sessions, their events and their screenshot files, then broadcasts `history:cleared` so every open dashboard resets. The URL queue, automation settings and login tokens are kept. The request returns `409` while a run is active — stop the run first. *Clear logs* (`POST /api/logs/clear`) only empties the live event buffer.

**Exporting.** *Export* on the dashboard downloads the current/latest run as JSON; the history table also offers CSV, and run details add `events=1` for the full event log.

---

## 10. Remote desktop (optional)

Headless is recommended. For visible mode:

```bash
sudo bash deploy/vnc-setup.sh
```

This installs Xvfb (`:99`), x11vnc (localhost only), noVNC and systemd units, sets `BROWSER_HEADLESS=false` and `DISPLAY=:99`, and prints the VNC password. Expose it through Nginx with basic auth using `deploy/nginx-vnc-snippet.conf`, set `VNC_URL`, restart PM2, then use **Open remote desktop** in the dashboard. The VNC port itself is never exposed publicly.

---

## 11. REST API

All `/api` routes except `/health`, `/auth/login`, `/auth/me`, `/auth/logout` require the session cookie.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Public liveness probe |
| `POST` | `/api/auth/login` | `{ password }` → cookie |
| `GET` | `/api/auth/me` | Session status |
| `POST` | `/api/auth/logout` | Revoke token |
| `GET` | `/api/state` | Full dashboard snapshot |
| `GET` | `/api/config` | Profiles, limits, feature flags |
| `GET` | `/api/health/full` | CPU/RAM/disk/load/process metrics |
| `POST` | `/api/run/start` | Start a run |
| `POST` | `/api/run/pause` `/resume` `/stop` `/restart` | Run controls |
| `POST` | `/api/sessions/:id/close` | Close one active tab |
| `GET` | `/api/sessions` | History (`runId`, `status`, `limit`, `offset`) |
| `GET` | `/api/sessions/:id` | Session + its events |
| `GET` | `/api/runs` `/api/runs/:id` | Run history/detail |
| `GET` | `/api/reports/export` | `format=json|csv`, `runId`, `events=1` |
| `GET` | `/api/urls` | List URLs |
| `POST` | `/api/urls` | `{ url }`, `{ urls: [] }` or newline text |
| `PATCH` | `/api/urls/:id` | `{ enabled }` |
| `DELETE` | `/api/urls/:id` | Remove |
| `GET/PUT` | `/api/settings` | Read/update automation limits |
| `GET` | `/api/logs` | Persisted events |
| `POST` | `/api/logs/clear` | Clear event buffer |
| `POST` | `/api/history/clear` | Delete stored runs/sessions/events + screenshots (blocked during a run) |
| `GET` | `/api/screenshots/:file` | Authenticated JPEG |
| `GET` | `/api/browser` | Browser state |
| `POST` | `/api/browser/restart` `/close` | Engine controls (blocked during a run) |

### Socket.IO events (server → client)

`snapshot`, `state`, `run:update`, `session:update`, `browser`, `health`, `settings:update`, `urls:update`, `log`, `logs:init`, `logs:cleared`, `history:cleared`, `notice`, `config`.

Connection requires the auth cookie when `AUTH_DISABLED=false`; unauthorized sockets receive an error with code `UNAUTHORIZED`.

---

## 12. Security checklist

- [ ] Long random `APP_PASSWORD` (provisioner generates one)
- [ ] HTTPS via certbot; `PUBLIC_URL` matches the scheme
- [ ] `AUTH_DISABLED=false` in production
- [ ] UFW: allow OpenSSH + Nginx Full only (`ufw enable`)
- [ ] PM2/Nginx run as non-root `mansu`; Chromium sandbox disabled only because headless containers/VPS often require it
- [ ] VNC bound to localhost + Nginx basic auth
- [ ] Rotate the dashboard password and VNC password periodically
- [ ] Keep Node, Chromium and system packages patched
- [ ] Restrict `/api/reports/export` access to the authenticated dashboard (already default)
- [ ] Back up `data/mansu101.db` (or Postgres) and `.env` securely

Login is rate limited (6 failures → 15 minute block per IP). Tokens are random 256-bit values stored hashed (SHA-256) with expiry.

---

## 13. Testing & diagnostics

```bash
pnpm test            # engine smoke test with fake Chromium (JSON store):
                     # success, HTTP 404, DNS failure, timeout, JS/network capture,
                     # screenshots, persistence, pause/resume/stop, single-tab close,
                     # history clearing (incl. screenshot deletion)
pnpm test:sqlite     # same suite against the production SQLite store
pnpm run doctor          # environment checks
pnpm run doctor --launch # real Chromium launch + render + screenshot
pnpm db:seed         # import config/urls.json (empty DB) / --append
```

The smoke test writes only to a temporary directory, so it never touches `./data`.

The smoke test is deterministic and requires no browser, so it can run in CI. The doctor's `--launch` mode is the definitive check on the VPS.

---

## 14. Troubleshooting

| Symptom | Fix |
|---|---|
| **Start run: “Chromium executable not found”** | `sudo apt install chromium-browser` or install Google Chrome and set `CHROMIUM_PATH=/usr/bin/google-chrome-stable`, restart PM2 |
| Snap Chromium fails for another user | Install the Google Chrome `.deb` instead, or run the app as the snap-owning user; set `CHROMIUM_PATH` |
| Login succeeds but immediately returns to login | `PUBLIC_URL` says HTTPS while you use HTTP (secure cookie). Match scheme or clear `PUBLIC_URL` |
| Live indicator keeps reconnecting behind Nginx | Ensure `/socket.io/` proxies WebSocket Upgrade headers and long `proxy_read_timeout` (templates already do) |
| Navigation timeouts on heavy pages | Increase Settings → navigation timeout (up to 300 s) or reduce concurrency |
| Browser process grows in RAM | Lower concurrency, enable block images, increase screenshot interval, let idle close run |
| `node:sqlite` warning / JSON fallback | Use Node 24+; verify `node -v` |
| VNC page blank | Check `DISPLAY=:99` in `.env`, `systemctl status mansu101-xvfb mansu101-x11vnc mansu101-novnc`, restart PM2 |
| Screenshot 404 after some days | Retention cleanup removed old files — expected |
| Run shows `interrupted` after reboot | Restart-safety marking; start a fresh run |
| PostgreSQL connection error | `pnpm --dir server add pg`, verify `DATABASE_URL` and that the DB exists |
| PM2 restart while run active | The process marks in-flight sessions interrupted; start a new run |

Useful commands:

```bash
pm2 status
pm2 logs mansu101 --lines 100
pm2 restart mansu101 --update-env
tail -f /opt/mansu101/data/logs/pm2-out.log
curl http://127.0.0.1:4000/api/health
```

---

## 15. Migrating an existing Puppeteer script

The original URL list and terminal-style logging are preserved as configuration and engine events:

1. Put your target URLs in `config/urls.json` (or paste them into **URLs → Add URLs**).
2. Start the app once — the seed file is imported into the database when it is empty.
3. The dashboard terminal uses the same operational vocabulary:
   ```
   [08:30:01] SERVER STARTING
   [08:30:05] BROWSER SESSION CREATED — https://…
   [08:30:06] NEW TAB OPENED
   [08:30:08] NAVIGATING TO WEBSITE — https://…
   [08:30:10] PAGE LOADED — DOM content ready
   [08:30:11] HTTP STATUS: 200
   [08:30:12] SCREENSHOT CAPTURED
   [08:30:13] SESSION COMPLETED — 8421ms
   ```
4. Existing logging can be compared via exported JSON/CSV reports (per-URL status, HTTP code, title, duration, errors).

No advertising interaction or artificial traffic generation is implemented by design.

---

## 16. License / responsible use

Use only against sites you own or are authorized to test. Respect robots.txt, terms of service and applicable law. The platform is intended for legitimate monitoring, QA and browser compatibility testing.
