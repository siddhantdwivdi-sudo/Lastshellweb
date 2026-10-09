# Deploying Last Shell for private testing

This guide deploys Last Shell as **one web service** that serves the React app *and* the Socket.IO game
server from the same address. The chosen host is **Render** (free plan available, WebSockets supported,
HTTPS and a `*.onrender.com` address included). Nothing in this repository deploys anything by itself:
you create the service yourself, following the steps below.

> **Status:** configuration prepared and tested locally. **Not deployed.** Nothing has been tested on a
> real hosted URL yet; see "Post-deployment checks" for what to verify once it is live.

## What you get

```
Browser  --HTTPS-->  Render proxy  --HTTP-->  node apps/server/dist/index.mjs
                                               |-- GET /            the built React app (and page refreshes)
                                               |-- GET /healthz     health check
                                               '-- /socket.io/      WebSocket (polling fallback)
```

One service, one URL, no CORS setup, no secrets. Players are identified by random tokens the server
creates itself; there is no database and no account system.

## Important limits (read before inviting friends)

- **Rooms live in memory.** Every restart ends all active matches and rooms. Restarts happen when you
  deploy, when the platform restarts the service, and (on the free plan) when it wakes up from sleep.
  Players see "That room no longer exists" and start a new one. This is expected for this first version.
- **Free plan sleeps** after 15 minutes without traffic and takes about a minute to wake up on the
  next visit (the first visitor sees a loading page). Render states that WebSocket messages on existing
  connections count as activity, so an ongoing match should keep it awake; confirm this in your first test.
- **Run exactly one instance.** Rooms are in one process's memory, so do not scale to several instances.
- Players per room: 3. Rooms are limited to 500 at once; creating a room is limited per IP address.

## Estimated cost

| Plan | Cost | What it means for Last Shell |
|---|---|---|
| Render workspace **Hobby** | $0 / month | Needed account type. |
| Web service **Free** | $0 / month | 512 MB RAM, 0.1 CPU. Sleeps after 15 min idle; ~1 min wake-up. 750 free instance-hours per month. Fine for testing with friends. |
| Web service **Starter** (optional) | **about $7 / month** | 512 MB RAM, 0.5 CPU, always on (no sleeping). Change `plan: free` to `plan: starter` in `render.yaml`, or change the plan in the dashboard. |
| Domain | $0 | You use the free `https://<name>.onrender.com` address. No domain is purchased. |

Traffic is tiny: the app is about 0.15 MB per first visit and a whole match exchanges well under 1 MB,
so bandwidth limits (a few GB per month on the free workspace) are not a concern for a handful of players.

**Verify before relying on these numbers:** prices and plan details change. They were taken from Render's
documentation and third-party summaries in October 2026; check <https://render.com/pricing> and
<https://render.com/docs/free> (including whether a payment method is required to sign up) before you start.

## Environment variables

Set these in Render (the `render.yaml` already contains the first two). **There are no secrets.**

| Variable | Value | Required | Notes |
|---|---|---|---|
| `NODE_ENV` | `production` | yes | Serves the built web app, strict same-origin rules, ignores `BUSY_SCALE`. |
| `TRUST_PROXY` | `1` | yes on Render | Number of reverse proxies in front of the server. Used to read the player's IP for rate limits. See "Verify the client IP setting". Never set it when the server is reached directly. |
| `PORT` | *(set by Render)* | no | The server listens on `process.env.PORT`. Do not set it yourself. |
| `RENDER_EXTERNAL_URL` | *(set by Render)* | no | The service's public URL; automatically allowed as a page origin. |
| `PUBLIC_ORIGIN` | `https://<your-host>` | no | Only if your proxy changes the `Host` header or you use another host/domain. |
| `CLIENT_ORIGIN` | comma-separated origins | no | Only if the web page is served from a *different* address than the server. |
| `CLIENT_IP_HEADER` | e.g. `cf-connecting-ip` | no | Only after confirming the platform always sets it. |
| `LOG_CONNECTIONS` | `1` | no | Temporary: prints each connecting IP so you can verify `TRUST_PROXY`. Remove afterwards. |
| `BUSY_SCALE` | *(never set)* | no | Testing knob; ignored in production anyway. |

`.env.example` documents the same list. `.env` files are git-ignored: never commit one.

## Try the production build on your own PC first

```powershell
cd C:\Users\siddh\LastShellWeb
npm ci --include=dev
npm run build
$env:NODE_ENV = "production"
$env:PORT = "8080"
npm start
```

Open <http://localhost:8080> in three tabs and play. (Stop with Ctrl+C. `$env:NODE_ENV = $null; $env:PORT = $null`
resets the variables for your PowerShell session.)

## Deployment steps (Render)

You need a Render account and a Git repository that Render can read (for example a **private** GitHub repo).

### 1. Put the project in a Git repository

`C:\Users\siddh\LastShellWeb` is already a Git repository with no commits yet. First check what will be committed:

```powershell
cd C:\Users\siddh\LastShellWeb
git status --short
git check-ignore -v node_modules apps/web/dist apps/server/dist .env
```

`node_modules`, the `dist` folders and `.env` must appear as ignored. Then create an **empty private repository**
on GitHub (no README) and run (replace the URL):

```powershell
git add -A
git commit -m "Last Shell web"
git branch -M main
git remote add origin https://github.com/<you>/last-shell-web.git
git push -u origin main
```

### 2. Create the service on Render

Option A, with the Blueprint (recommended):
1. Render dashboard -> **New** -> **Blueprint** -> connect the repository -> it finds `render.yaml`.
2. Review the service (plan **Free**, build `npm ci --include=dev && npm run build`, start `npm start`,
   health check `/healthz`) and click **Apply**.

Option B, manually: **New** -> **Web Service** -> your repo, then:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check path | `/healthz` |
| Plan | Free |
| Environment | `NODE_ENV=production`, `TRUST_PROXY=1` |
| Auto-deploy | Off (deploy from the dashboard when you choose) |

The `.node-version` file pins Node 24, the version used for all testing.

### 3. First deploy

Press **Deploy** (or wait for the first build). It takes a few minutes. The log should end with
`Last Shell server listening on port ... (production)` and `Serving the built web app`.
Your address is `https://<service-name>.onrender.com`.

## Post-deployment checks

Replace `$u` with your URL. Run these only after the deploy shows "Live".

```powershell
$u = "https://<service-name>.onrender.com"

# 1. health check
Invoke-RestMethod "$u/healthz"                        # expect: ok = True

# 2. the app and a refresh on a deep link both return the page
(Invoke-WebRequest $u -UseBasicParsing).StatusCode    # 200
(Invoke-WebRequest "$u/some/deep/link" -UseBasicParsing).Content -match 'id="root"'   # True

# 3. security headers are present
(Invoke-WebRequest $u -UseBasicParsing).Headers["Content-Security-Policy"]
(Invoke-WebRequest $u -UseBasicParsing).Headers["Strict-Transport-Security"]

# 4. other websites are refused (expect a 403 error)
Invoke-WebRequest "$u/socket.io/?EIO=4&transport=polling" -Headers @{ Origin = "https://evil.example" } -UseBasicParsing

# 5. a missing file is a real 404, not the app
Invoke-WebRequest "$u/assets/nope.js" -UseBasicParsing
```

Then, in the browser:

- [ ] Open the URL on your PC and on a phone (mobile data, not your home Wi-Fi). The title screen loads.
- [ ] Three players (three tabs, or PC + two phones): create room, join with the code, start, play to the end.
- [ ] Refresh a tab mid-match: you return to your seat. Close a tab: the others see the 60 second countdown.
- [ ] PLAY AGAIN works for the admin only.
- [ ] In DevTools (F12) -> Console: no red errors. Network: one WebSocket connection to `/socket.io/`.
- [ ] Leave the service idle for 20+ minutes (free plan) and visit again: it wakes up (about a minute) and a
      *new* room can be created. Note whether an *ongoing* match keeps it awake.

### Verify the client IP setting (`TRUST_PROXY`)

Rate limits (rooms per minute, wrong codes) are keyed on the player's IP. Render's traffic passes through
more than one proxy and Render appends to, rather than replaces, `X-Forwarded-For`, so the right setting must
be confirmed on the real platform once:

1. In Render, add `LOG_CONNECTIONS=1` and redeploy/restart. Open the site from your phone on mobile data.
2. Open the service logs. You should see `connection from <your public IP> (via x-forwarded-for)`.
3. **If you see your own public IP:** correct. Remove `LOG_CONNECTIONS`.
4. **If you see a different, constant address** (the same one for every visitor, such as a proxy/CDN address):
   try `TRUST_PROXY=2`; or, if the logs/headers confirm Cloudflare sets it, `CLIENT_IP_HEADER=cf-connecting-ip`.
   If it cannot be fixed, the failure mode is safe but strict: all players share one rate-limit bucket
   (5 new rooms per minute in total), which is still fine for a few friends.
5. Remove `LOG_CONNECTIONS` when done (it prints IP addresses).

## Operations

- **Logs:** Render dashboard -> your service -> Logs. The server logs only start-up lines, shutdown, and
  generic error names. It never logs player tokens, room codes, shell information or messages
  (this is tested).
- **Update:** push to the repository, then **Manual Deploy** in the dashboard. This ends active matches.
- **Stop / delete:** Render dashboard -> service -> Settings -> Suspend or Delete.
- **Roll back:** Render dashboard -> Events/Deploys -> pick an earlier deploy and redeploy it.

## Other hosts / your own reverse proxy

Any Node host works (`npm ci --include=dev && npm run build`, then `npm start`; set `NODE_ENV=production`, and
`PORT` if the host does not). If you put your own proxy in front, it must:

- terminate HTTPS and forward to the Node port;
- pass WebSocket upgrades (`Upgrade` and `Connection` headers) for `/socket.io/`;
- keep connections open for at least 60 seconds (Socket.IO pings every 25 s);
- forward the original `Host` header (or set `PUBLIC_ORIGIN` to the public URL);
- **append** the client address to `X-Forwarded-For` (set `TRUST_PROXY` to the number of proxies).

A typical nginx location block (not tested here; the Node-based proxy test in `apps/server/tests/smoke`
covers the same behaviour):

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
}
```

## Pre-deployment security review

What was checked and changed for this deployment (all covered by automated tests unless noted):

| Area | Finding / state |
|---|---|
| **WebSocket origin** | Browsers do not apply CORS to WebSockets, so any website could have connected. **Fixed:** every Socket.IO connection (WebSocket and polling) now has its `Origin` checked: only this server's own pages and explicitly configured origins are accepted. |
| **CORS** | Production default is same-origin only (no `localhost` anywhere). Extra origins come from `CLIENT_ORIGIN` / `PUBLIC_ORIGIN`. `*` exists for local network testing only and is documented as such. |
| **Client IP / rate limits** | **Fixed a real weakness:** behind a proxy the code trusted the *leftmost* `X-Forwarded-For` entry, which a client can forge to dodge the limits. Now only the entry added by the configured number of trusted proxies (counted from the right) is used; the header is ignored entirely without `TRUST_PROXY`. |
| **Room creation / joining limits** | 5 new rooms per minute per IP, 10 wrong codes/tokens per minute per IP (blocks code guessing), max 500 rooms, max 20 sockets per IP, 40 messages per 5 s per connection. Unchanged; now effective behind a proxy. 3-player friends sharing one home IP are well within them. |
| **Tokens** | 128-bit random, stored only as SHA-256 hashes, compared in constant time, never broadcast (tested), kept per browser tab in `sessionStorage`. A strict CSP (`script-src 'self'`) limits script injection that could steal them. |
| **Message limits** | 10 kB maximum message size; every message validated with Zod (strict objects, integer ranges); the seat always comes from the connection. |
| **Private information** | Per-player projection tested with random full games, a non-interference test, and wire inspection in the browser/integration/smoke tests: no shell order, observations or other players' reveals ever leave the server. |
| **Logging** | Server logs contain only start-up/shutdown lines and error *names*. A test starts the production server, plays through lobby and match start, and asserts no token, shell data or payload text appears in its output. The client logs nothing. |
| **Security headers** | CSP (own scripts/styles/fonts only, sockets only to self and listed origins, no framing, no plugins), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options`, `Permissions-Policy`, and HSTS when the request came over HTTPS. |
| **Static files** | Served only from the build folder; traversal attempts tested; missing files are real 404s. |
| **Dependencies** | `npm audit` reported 0 known vulnerabilities (all and production-only) at the time of writing. |
| **Not covered (accepted for a private test)** | No accounts or bans; no HTTP rate limiting beyond what the host provides; in-memory rooms; a single instance; denial-of-service protection is whatever the host offers. |
