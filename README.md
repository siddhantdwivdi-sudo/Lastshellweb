# Last Shell (web)

Server-authoritative, three-player online version of the Last Shell Godot prototype.
The original Godot project (`C:\Users\siddh\LastShell`) is the gameplay reference and is not touched by anything here.

**Status:** Phase 5 - the full game is playable locally with three browser tabs, and a production build/start
workflow plus a deployment guide are ready (single Node service serving the web app and Socket.IO).
**It has not been deployed anywhere.** See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Layout

```
packages/shared/      Types and constants shared by server and frontend:
                      item data, public/private view types, Socket.IO protocol.
apps/web/             React + TypeScript + Vite frontend.
  src/net/            The Socket.IO client adapter (gameClient.ts), event playback, React hook. No game rules.
  src/app/            AppController (what screens need) + AppView (picks the screen).
  src/screens/        Title and lobby screens.
  src/scene/          The cinematic table scene: figures, cast/artwork manifest, animations driven by server events.
  src/game/           Game screen: panels, shell row, inventory, dialogs, overlays (HUD over the scene).
  src/components/     Shared pieces (buttons, accessible dialog, toast, rules, backdrop).
  src/mock/           DEVELOPMENT ONLY: canned data to explore the UI without a server.
  src/ui/model.ts     The shapes the screens render.
  src/styles/         Plain CSS (tokens, base, screens, game, overlays).
apps/server/
  src/engine/         Pure rules engine (port of the Godot scripts). Only the server imports it.
  src/views/          Projection: what each player is allowed to see.
  src/rooms/          Rooms, seats, admin, tokens, grace period, pacing (BUSY), rate limits.
  src/net/            Socket.IO wiring + Zod schemas for every incoming message.
  src/app.ts          Builds the Express + Socket.IO server.
  src/index.ts        Starts it.
  tests/              Vitest suites (engine, simulations, rooms, sockets, privacy).
  tests/integration/  The real frontend client against the real server (three players).
```

Also in the repository: `docs/DEPLOYMENT.md` (deployment guide), `docs/ART.md` (character artwork spec),
`render.yaml` (Render blueprint), `.env.example` (environment variables), `.node-version` (Node 24).

## The game scene (cinematic UI)

The game screen is a dark room seen from your seat: a hanging lamp, a worn wooden table, film grain and vignette,
and the two opponents sitting across the table with shotguns pointed at you. It is layered 2D art animated with CSS
(no 3D engine, no video), so it stays light on phones and fits Render's free plan.

- **Everything that moves comes from server-confirmed events.** The server's `shotFired` makes the shooter turn and
  aim (at you, at the other opponent, or at themselves); `shotResolved` says live or blank, so a live shell gets the
  recoil, muzzle flash, smoke, camera shake and a flinch on whoever was hit, a blank gets a dry click; your own
  damage shows a red hit effect and a heartbeat vignette at 1 HP; `eliminated` makes the figure slump and go dark.
  The frontend never decides an outcome. (`apps/web/src/net/presenter.ts` copies the event facts into "cues";
  `apps/web/src/scene/sceneState.ts` maps them to poses, with unit tests.)
- **Idle life:** breathing, small head movement and blinking; the player whose turn it is is lit more strongly.
- **HUD:** each opponent's health, status and items sit above their figure; the shell counters, your private intel
  and the latest message are on the table in front of you; your items and the shoot buttons are along the edge.
- **Character artwork is not final.** The two men are currently interim vector silhouettes. Realistic characters
  need real images; see [docs/ART.md](docs/ART.md) for what is needed, the options, prompts and where to drop the
  files (`apps/web/src/scene/cast.ts`). No art has been generated, bought or downloaded.

## Requirements

Node.js 20 or newer (developed and tested on Node 24) and npm 10+.

## Install

```powershell
cd C:\Users\siddh\LastShellWeb
npm install
```

## Play locally (server + frontend in two PowerShell windows)

**Window 1 - the game server** (port 3001):

```powershell
cd C:\Users\siddh\LastShellWeb
npm run start:server
```

**Window 2 - the web app** (port 5173):

```powershell
cd C:\Users\siddh\LastShellWeb
npm run dev:web
```

Check the server is alive from any window: `Invoke-RestMethod http://localhost:3001/healthz` (answers `{ ok: true }`).

### Three players on one PC

1. Open <http://localhost:5173> in **three separate browser tabs or windows** (a normal one, an incognito one, or any mix).
   Each tab keeps its own seat, so three tabs of the same browser are three different players.
2. **Tab 1:** click **CREATE ROOM**. You are PLAYER 1 and the room admin. Note the 5-character room code.
3. **Tabs 2 and 3:** click **JOIN ROOM**, type the code, click **JOIN**. They become PLAYER 2 and PLAYER 3.
4. When all three seats show "Connected", **Tab 1** clicks **START MATCH** (only the admin can).
5. Play: only the player whose turn it is can shoot or use items. Tap an item to read it and press **USE ITEM**.
   Keyboard: `1` / `2` / `3` shoot that player, `0` shoot yourself, `Esc` menu.
6. At the end, only the admin (Tab 1) can press **PLAY AGAIN**. If someone has left, everyone returns to the lobby.

Things worth trying: refresh a tab mid-match (you return to your seat), close a tab (the others see a 60 second
countdown), use Magnifying Glass / Burner Phone (only you see the result), use an Inverter after someone looked at
the chamber (their information turns dashed/OUTDATED).

### Playing from a phone or another PC on the same Wi-Fi

Find the PC's address with `ipconfig` (for example `192.168.1.6`). Start the server allowing that page origin:

```powershell
$env:CLIENT_ORIGIN = "http://localhost:5173,http://192.168.1.6:5173"
npm run start:server
```

(`$env:CLIENT_ORIGIN = "*"` allows any origin; use that only on a trusted home network.) Start the web app as usual,
then open `http://192.168.1.6:5173` on the phone. In development the page connects to the server on the same host,
port 3001. Windows Firewall may ask to allow Node.js on private networks: allow it.

## Production build and start (one service: web app + Socket.IO)

```powershell
cd C:\Users\siddh\LastShellWeb
npm ci --include=dev       # or `npm install` locally
npm run build              # builds apps/web/dist (React) and apps/server/dist/index.mjs (server)
$env:NODE_ENV = "production"; $env:PORT = "8080"
npm start                  # = node apps/server/dist/index.mjs
```

Open <http://localhost:8080>: the same server serves the page, `/healthz` and `/socket.io/`. A refresh on any address
returns the app. This is exactly what a host runs; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for hosting steps,
environment variables, costs and post-deployment checks. Rooms are kept in memory, so **a server restart ends all
active matches**.

`npm run smoke` builds everything and runs only the production smoke tests (they also run as part of `npm test`).

| Command | What it does |
|---|---|
| `npm run build` | Production build of the web app and the server. |
| `npm start` | Starts the **built** server (production). Needs `npm run build` first. |
| `npm run start:server` | Development server (runs the TypeScript directly, port 3001). |
| `npm run dev:web` | Vite dev server for the frontend (port 5173). |
| `npm test` / `npm run typecheck` | Everything. `npm test` includes the production smoke test (it runs a real build). |

## Configuration

Server (environment variables; full list in `.env.example`):

| Variable        | Default                  | Meaning                                                                 |
|-----------------|--------------------------|-------------------------------------------------------------------------|
| `NODE_ENV`      | unset                    | `production` = serve the built web app, same-origin only, ignore `BUSY_SCALE`. |
| `PORT`          | `3001`                   | Port to listen on (hosts provide this).                                  |
| `CLIENT_ORIGIN` | development: `http://localhost:5173`; production: none | Extra page origins allowed to connect (comma-separated). The server's own pages are always allowed. `*` = any (local testing only). |
| `PUBLIC_ORIGIN` | unset                    | The public URL, if the proxy changes the Host header.                   |
| `TRUST_PROXY`   | `0`                      | Number of reverse proxies in front of the server (`1` on hosting platforms). Never set it without a proxy. |
| `CLIENT_IP_HEADER` | unset                 | Header a trusted CDN sets to the client IP (e.g. `cf-connecting-ip`).    |
| `LOG_CONNECTIONS` | off                    | `1` prints each connecting IP (temporary debugging only).               |
| `BUSY_SCALE`    | `1`                      | Testing only: `0.2` makes animations/turn pacing 5x shorter. Ignored in production. |

Frontend (Vite environment variables):

| Variable          | Default                                              | Meaning                              |
|-------------------|------------------------------------------------------|--------------------------------------|
| `VITE_SERVER_URL` | dev: this host on port 3001 / production: same origin | Where the Socket.IO server is.       |
| `VITE_MOCK`       | unset                                                | `1` = development-only mock mode.    |

## Mock mode (development only, no server)

To explore or restyle the UI with canned data:

```powershell
cd C:\Users\siddh\LastShellWeb
npm run dev:mock
```

(or add `?mock=1` to the URL of a normal `npm run dev:web`). A **MOCK** tab appears on the left edge: jump to any
screen, change the connection/lobby state, or open any game state (reload, outdated info, elimination, winner...).
Deep links: `/?mock=1&screen=game&scenario=your-turn&you=1`, `/?mock=1&screen=lobby&players=2`.
Join codes in mock mode: `22222` not found, `33333` full, `44444` already started.

Mock mode only exists in the development server. It is removed from production builds at build time.

## Tests, typecheck, build

```powershell
cd C:\Users\siddh\LastShellWeb
npm test               # server + frontend unit tests + real client-to-server integration tests
npm run typecheck      # all packages
npm run build:web      # production build into apps/web/dist
```

## How the protocol works (summary)

All requests use Socket.IO acknowledgements. Every request is validated with Zod; the player's seat is never read from a message - it comes from the connection that sent it.

| Client sends        | Payload                                   | Notes                                         |
|---------------------|-------------------------------------------|-----------------------------------------------|
| `room:create`       | none                                      | Creator becomes seat 0 and admin.             |
| `room:join`         | `{ code }`                                | Lobby only, max 3 players.                    |
| `room:resume`       | `{ code, token }`                         | Reconnect after a refresh or dropped link.    |
| `room:leave`        | none                                      | In a match this forfeits.                     |
| `game:start`        | none                                      | Admin only; needs 3 connected players.        |
| `game:action`       | `{ actionId, version, action }`           | `action` is `shoot` or `useItem`.             |
| `game:playAgain`    | none                                      | Admin only, after game over.                  |

The server pushes `room:state`, `game:snapshot`, `game:events`, `game:idle` and `room:replaced`.
Each player receives their own projection: public state plus only their own observations. The hidden shell order never leaves the server.

**Legal-action hints:** each player's private view includes `legal` while it is their turn: which of their items are
usable (and why not), which opponents can be handcuffed, and which opponent items can be stolen. It is computed from
public information and the player's own items only, and exists just to grey out buttons. The server validates every
action regardless.

Rules worth knowing:

- **Versions:** the server counts every change in `version`. The client sends the last version it saw; stale requests are refused (`STALE_VERSION`). Older event batches are ignored by the client.
- **Action IDs:** resending the same `actionId` returns the first result and never applies it twice. The client sends one action at a time.
- **Pacing:** after each action the table is busy for the animation time (same timings as the Godot game). The client plays events in order and only enables buttons after `game:idle`; early actions get `BUSY`.
- **Disconnects:** in a match you have 60 seconds to come back with your token (kept per browser tab); after that you forfeit. In the lobby the seat is freed immediately.
- **Admin:** the creator. If they leave, the role passes to the lowest connected seat.
- **PLAY AGAIN:** admin only, after game over. With all three connected it starts a new match; otherwise everyone returns to the lobby.
- **Empty rooms:** deleted 10 minutes after the last player is gone (immediately in the lobby).
- **Server restarts:** rooms live in memory, so a restart ends them; clients reconnect, find the room gone and say so.
- **Origin check:** every Socket.IO connection must come from the server's own pages or a configured origin (browsers do not apply CORS to WebSockets, so this is checked explicitly).
