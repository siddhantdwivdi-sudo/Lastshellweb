// Production-mode smoke test. It BUILDS the real frontend and server (`npm run build`), starts the
// compiled server exactly like `npm start` does (NODE_ENV=production, PORT from the environment),
// and checks the things a deployment depends on: the built web app, the health check, page
// refreshes, Socket.IO over WebSocket and polling, Origin enforcement, behaviour behind a reverse
// proxy, and that the process never logs secrets.

import { execSync, spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { C2S, S2C } from "@lastshell/shared";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FORBIDDEN_KEYS, collectKeys } from "../room-helpers";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

interface Running {
  port: number;
  url: string;
  output(): string;
  stop(): Promise<void>;
}
const running: Running[] = [];
const sockets: Socket[] = [];
const secrets: string[] = []; // every player token seen, to prove they never reach the logs

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

/** Starts `node apps/server/dist/index.mjs` the way a host's start command would. */
async function startProd(extraEnv: Record<string, string> = {}): Promise<Running> {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", PORT: String(port), ...extraEnv };
  for (const k of ["CLIENT_ORIGIN", "PUBLIC_ORIGIN", "RENDER_EXTERNAL_URL", "TRUST_PROXY", "CLIENT_IP_HEADER", "WEB_DIST"]) {
    if (!(k in extraEnv)) delete env[k];
  }
  const proc: ChildProcess = spawn(process.execPath, ["apps/server/dist/index.mjs"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout?.on("data", (d) => (out += d));
  proc.stderr?.on("data", (d) => (out += d));
  const deadline = Date.now() + 15_000;
  while (!out.includes("listening")) {
    if (Date.now() > deadline || proc.exitCode !== null) throw new Error(`server did not start:\n${out}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  const r: Running = {
    port,
    url: `http://127.0.0.1:${port}`,
    output: () => out,
    stop: () =>
      new Promise((resolve) => {
        if (proc.exitCode !== null) return resolve();
        proc.once("exit", () => resolve());
        proc.kill();
      }),
  };
  running.push(r);
  return r;
}

function connect(url: string, headers: Record<string, string> = {}, transports: ("websocket" | "polling")[] = ["websocket"]): Promise<Socket> {
  const socket = io(url, { transports, forceNew: true, reconnection: false, extraHeaders: headers });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (e) => reject(e));
  });
}

const call = (s: Socket, event: string, payload?: unknown): Promise<any> =>
  new Promise((resolve) => (payload === undefined ? s.emit(event, resolve) : s.emit(event, payload, resolve)));

function rawGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      })
      .on("error", reject);
  });
}

/** A minimal reverse proxy for the test: appends X-Forwarded-* like real proxies do, supports WebSocket upgrades. */
async function startProxy(targetPort: number, clientAddress: string): Promise<{ url: string; close(): Promise<void> }> {
  const forwarded = (h: http.IncomingHttpHeaders) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(h)) if (v !== undefined) out[k] = Array.isArray(v) ? v.join(", ") : v;
    out["x-forwarded-for"] = out["x-forwarded-for"] ? `${out["x-forwarded-for"]}, ${clientAddress}` : clientAddress; // APPENDS
    out["x-forwarded-proto"] = "https";
    return out;
  };
  const server = http.createServer((req, res) => {
    const up = http.request({ host: "127.0.0.1", port: targetPort, method: req.method, path: req.url, headers: forwarded(req.headers) }, (ur) => {
      res.writeHead(ur.statusCode ?? 502, ur.headers);
      ur.pipe(res);
    });
    up.on("error", () => {
      res.statusCode = 502;
      res.end();
    });
    req.pipe(up);
  });
  const tunnels = new Set<Duplex>(); // upgraded connections are not tracked by http.Server
  server.on("upgrade", (req, socket, head) => {
    tunnels.add(socket);
    socket.once("close", () => tunnels.delete(socket));
    const up = net.connect(targetPort, "127.0.0.1", () => {
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(forwarded(req.headers))) raw += `${k}: ${v}\r\n`;
      up.write(`${raw}\r\n`);
      if (head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as net.AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () =>
      new Promise((r) => {
        for (const t of tunnels) t.destroy();
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

beforeAll(() => {
  // Build exactly what gets deployed.
  execSync("npm run build", { cwd: ROOT, stdio: "pipe", timeout: 240_000 });
}, 300_000);

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await Promise.all(running.map((r) => r.stop()));
});

describe("production build and server", () => {
  it("serves the built web app, the health check and security headers", async () => {
    const srv = await startProd({ BUSY_SCALE: "0" });
    const health = await rawGet(`${srv.url}/healthz`);
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toEqual({ ok: true });

    const home = await rawGet(`${srv.url}/`);
    expect(home.status).toBe(200);
    expect(home.headers["content-type"]).toMatch(/text\/html/);
    expect(home.body).toContain('<div id="root">');
    expect(home.body).toMatch(/<title>Last Shell<\/title>/);
    expect(home.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(home.headers["x-powered-by"]).toBeUndefined();

    // the hashed script referenced by the page exists, is cacheable for a year, and contains no mock mode
    const script = home.body.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    expect(script).toBeTruthy();
    const js = await rawGet(`${srv.url}${script}`);
    expect(js.status).toBe(200);
    expect(js.headers["content-type"]).toMatch(/javascript/);
    expect(js.headers["cache-control"]).toMatch(/immutable/);
    expect(js.body).not.toContain("useMockApp");
    expect(js.body).not.toContain("MOCK");
    const css = home.body.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
    expect((await rawGet(`${srv.url}${css}`)).status).toBe(200);

    // BUSY_SCALE is a testing knob and must be ignored in production
    expect(srv.output()).not.toContain("Busy scale");
    expect(srv.output()).toContain("(production)");
    expect(srv.output()).toContain("Serving the built web app");
  });

  it("a browser refresh on any address returns the app; missing files are 404s", async () => {
    const srv = await startProd();
    for (const p of ["/", "/lobby", "/game/ABCDE", "/some/deep/link?x=1"]) {
      const res = await rawGet(srv.url + p);
      expect(res.status, p).toBe(200);
      expect(res.body, p).toContain('<div id="root">');
    }
    expect((await rawGet(`${srv.url}/assets/does-not-exist.js`)).status).toBe(404);
    expect((await rawGet(`${srv.url}/../package.json`)).body).not.toContain("last-shell-web");
  });

  it("Socket.IO works over polling and WebSocket; a full lobby + match start over the production server", async () => {
    const srv = await startProd();
    const handshake = await rawGet(`${srv.url}/socket.io/?EIO=4&transport=polling`);
    expect(handshake.status).toBe(200);
    expect(handshake.body).toContain('"sid"');
    expect(handshake.body).toContain('"websocket"'); // upgrade is offered

    const [a, b, c] = await Promise.all([connect(srv.url), connect(srv.url), connect(srv.url, {}, ["polling"])]); // C uses plain polling
    const seen: string[] = [];
    for (const s of [a, b, c]) s.onAny((_e, p) => seen.push(JSON.stringify(p ?? null)));
    const created = await call(a, C2S.create);
    expect(created).toMatchObject({ ok: true, seat: 0 });
    expect(created.code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    const jb = await call(b, C2S.join, { code: created.code });
    const jc = await call(c, C2S.join, { code: created.code.toLowerCase() });
    expect(jb).toMatchObject({ ok: true, seat: 1 });
    expect(jc).toMatchObject({ ok: true, seat: 2 });
    secrets.push(created.token, jb.token, jc.token);

    const events = new Promise<void>((resolve) => {
      let n = 0;
      for (const s of [a, b, c]) s.on(S2C.events, () => ++n === 3 && resolve());
    });
    expect(await call(b, C2S.start)).toMatchObject({ ok: false, code: "NOT_ADMIN" });
    expect(await call(a, C2S.start)).toMatchObject({ ok: true });
    await events;

    for (const text of seen) {
      const keys = collectKeys(JSON.parse(text));
      for (const bad of FORBIDDEN_KEYS) expect(keys.has(bad), bad).toBe(false);
    }
    // nobody ever receives anybody else's token
    for (const token of [created.token, jb.token, jc.token]) expect(seen.some((t) => t.includes(token))).toBe(false);

    // an unknown / malformed request is answered, not fatal
    expect(await call(a, C2S.join, { code: "bad" })).toMatchObject({ ok: false, code: "BAD_REQUEST" });
    expect((await rawGet(`${srv.url}/healthz`)).status).toBe(200);
  });

  it("refuses connections from other websites (WebSocket and polling) but accepts its own page", async () => {
    const srv = await startProd();
    await expect(connect(srv.url, { Origin: "https://evil.example" })).rejects.toBeTruthy();
    await expect(connect(srv.url, { Origin: "https://evil.example" }, ["polling"])).rejects.toBeTruthy();
    expect((await rawGet(`${srv.url}/socket.io/?EIO=4&transport=polling`, { Origin: "https://evil.example" })).status).toBe(403);
    const own = await connect(srv.url, { Origin: srv.url });
    expect(own.connected).toBe(true);
    // a configured public origin is accepted too, even when the Host header differs (e.g. an unusual proxy)
    const configured = await startProd({ PUBLIC_ORIGIN: "https://lastshell.example.com" });
    const viaPublic = await connect(configured.url, { Origin: "https://lastshell.example.com" });
    expect(viaPublic.connected).toBe(true);
    await expect(connect(configured.url, { Origin: "https://evil.example" })).rejects.toBeTruthy();
  });
});

describe("behind an HTTPS reverse proxy", () => {
  it("serves the app and upgrades WebSockets through the proxy, and marks HTTPS responses with HSTS", async () => {
    const srv = await startProd({ TRUST_PROXY: "1" });
    const proxy = await startProxy(srv.port, "203.0.113.50");
    try {
      const home = await rawGet(`${proxy.url}/`);
      expect(home.status).toBe(200);
      expect(home.body).toContain('<div id="root">');
      expect(home.headers["strict-transport-security"]).toMatch(/max-age=\d+/);
      expect((await rawGet(`${proxy.url}/healthz`)).status).toBe(200);

      const ws = await connect(proxy.url, { Origin: proxy.url }); // the page's own origin, as the browser would send
      expect(ws.io.engine.transport.name).toBe("websocket");
      const created = await call(ws, C2S.create);
      expect(created).toMatchObject({ ok: true });
      secrets.push(created.token);
    } finally {
      await proxy.close();
    }
  });

  it("rate limits are keyed on the address the PROXY saw, so a forged X-Forwarded-For does not bypass them", async () => {
    const srv = await startProd({ TRUST_PROXY: "1" });
    const proxy = await startProxy(srv.port, "203.0.113.77");
    try {
      const results: any[] = [];
      for (let i = 0; i < 7; i++) {
        const s = await connect(proxy.url, { "X-Forwarded-For": `10.${i}.${i}.${i}` }); // attacker pretends to be someone new each time
        results.push(await call(s, C2S.create));
        if (results[i].ok) secrets.push(results[i].token);
      }
      expect(results.filter((r) => r.ok)).toHaveLength(5);
      expect(results[5]).toMatchObject({ ok: false, code: "RATE_LIMITED" });
      expect(results[6]).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    } finally {
      await proxy.close();
    }
  });

  it("without TRUST_PROXY the header is ignored (a directly exposed server cannot be fooled either)", async () => {
    const srv = await startProd();
    const results: any[] = [];
    for (let i = 0; i < 6; i++) {
      const s = await connect(srv.url, { "X-Forwarded-For": `10.9.${i}.1` });
      results.push(await call(s, C2S.create));
    }
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results[5]).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });
});

describe("logging", () => {
  it("the server's output never contains a player token, shell data or message payloads", async () => {
    expect(secrets.length).toBeGreaterThan(5);
    const everything = running.map((r) => r.output()).join("\n");
    expect(everything.length).toBeGreaterThan(50);
    for (const token of secrets) expect(everything).not.toContain(token);
    for (const word of ["shells", "observedLive", "observations", "knownShells", "token"]) expect(everything).not.toContain(word);
    // only the expected start-up lines are present
    for (const line of everything.split("\n").filter(Boolean)) {
      expect(line).toMatch(/^(Last Shell server listening|Serving the built|Not serving|Allowed origins|Extra allowed origins|Trusting \d|Busy scale)/);
    }
  });
});
