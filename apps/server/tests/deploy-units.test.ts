import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCsp, createGameServer, type GameServer } from "../src/app";
import { loadServerConfig } from "../src/config";
import { resolveClientIp } from "../src/net/clientIp";
import { isOriginAllowed } from "../src/net/origin";

describe("production configuration", () => {
  it("reads PORT from the environment and falls back safely", () => {
    expect(loadServerConfig({ PORT: "10000" }).port).toBe(10000);
    expect(loadServerConfig({}).port).toBe(3001);
    for (const bad of ["abc", "0", "-5", "70000", "3.5", ""]) expect(loadServerConfig({ PORT: bad }).port).toBe(3001);
  });

  it("production: no hardcoded localhost, same-origin only unless configured", () => {
    const c = loadServerConfig({ NODE_ENV: "production" });
    expect(c.production).toBe(true);
    expect(c.allowedOrigins).toEqual([]);
  });

  it("development: allows the Vite dev server by default", () => {
    const c = loadServerConfig({});
    expect(c.production).toBe(false);
    expect(c.allowedOrigins).toContain("http://localhost:5173");
  });

  it("accepts configured origins, a public origin and Render's automatic URL (normalised)", () => {
    const c = loadServerConfig({
      NODE_ENV: "production",
      CLIENT_ORIGIN: "https://Game.Example.com/, https://other.example",
      PUBLIC_ORIGIN: "https://public.example/",
      RENDER_EXTERNAL_URL: "https://last-shell.onrender.com",
    });
    expect(c.allowedOrigins.sort()).toEqual(
      ["https://game.example.com", "https://last-shell.onrender.com", "https://other.example", "https://public.example"].sort(),
    );
    // explicit configuration replaces the dev defaults
    expect(loadServerConfig({ CLIENT_ORIGIN: "https://x.example" }).allowedOrigins).toEqual(["https://x.example"]);
  });

  it("TRUST_PROXY is a hop count (1 / true = one proxy), capped, never negative", () => {
    expect(loadServerConfig({}).trustProxyHops).toBe(0);
    expect(loadServerConfig({ TRUST_PROXY: "1" }).trustProxyHops).toBe(1);
    expect(loadServerConfig({ TRUST_PROXY: "true" }).trustProxyHops).toBe(1);
    expect(loadServerConfig({ TRUST_PROXY: "2" }).trustProxyHops).toBe(2);
    expect(loadServerConfig({ TRUST_PROXY: "99" }).trustProxyHops).toBe(5);
    expect(loadServerConfig({ TRUST_PROXY: "-1" }).trustProxyHops).toBe(0);
    expect(loadServerConfig({ TRUST_PROXY: "yes" }).trustProxyHops).toBe(0);
  });

  it("BUSY_SCALE (a testing knob) is honoured in development and ignored in production", () => {
    expect(loadServerConfig({ BUSY_SCALE: "0.2" }).rooms).toEqual({ busyScale: 0.2 });
    expect(loadServerConfig({ NODE_ENV: "production", BUSY_SCALE: "0" }).rooms).toEqual({});
    expect(loadServerConfig({ BUSY_SCALE: "5" }).rooms).toEqual({});
  });

  it("optional client-IP header and connection logging are off by default", () => {
    const c = loadServerConfig({});
    expect(c.clientIpHeader).toBeNull();
    expect(c.logConnections).toBe(false);
    expect(loadServerConfig({ CLIENT_IP_HEADER: " CF-Connecting-IP ", LOG_CONNECTIONS: "1" })).toMatchObject({
      clientIpHeader: "cf-connecting-ip",
      logConnections: true,
    });
  });
});

describe("WebSocket / Socket.IO origin check", () => {
  const host = "game.example.com";
  const check = (origin: string | undefined, allowed: string[] = [], extra: object = {}) =>
    isOriginAllowed({ origin, host, allowedOrigins: allowed, ...extra });

  it("allows the page served by this very server (same host), any scheme the proxy used", () => {
    expect(check("https://game.example.com")).toBe(true);
    expect(check("http://game.example.com")).toBe(true);
    expect(check("https://GAME.example.com")).toBe(true);
  });

  it("refuses other websites", () => {
    expect(check("https://evil.example")).toBe(false);
    expect(check("https://game.example.com.evil.example")).toBe(false);
    expect(check("https://evil.example", ["https://game.example.com"])).toBe(false);
    expect(check("null")).toBe(false);
    expect(check("not a url")).toBe(false);
    expect(check("file:///etc/passwd")).toBe(false);
    expect(check("chrome-extension://abc")).toBe(false);
  });

  it("allows listed origins (including the dev server) and non-browser clients without an Origin", () => {
    expect(check("http://localhost:5173", ["http://localhost:5173"])).toBe(true);
    expect(check("https://friends.example", ["https://friends.example/"])).toBe(true);
    expect(check(undefined)).toBe(true);
    expect(check("")).toBe(true);
  });

  it("'*' allows everything (local testing only)", () => {
    expect(check("https://evil.example", ["*"])).toBe(true);
  });

  it("a forwarded host only counts when the caller passes it (i.e. a trusted proxy is configured)", () => {
    expect(isOriginAllowed({ origin: "https://public.example", host: "internal:10000", allowedOrigins: [] })).toBe(false);
    expect(
      isOriginAllowed({ origin: "https://public.example", host: "internal:10000", forwardedHost: "public.example", allowedOrigins: [] }),
    ).toBe(true);
  });
});

describe("client IP behind proxies", () => {
  const ip = (headers: Record<string, string | string[] | undefined>, hops: number, extra: object = {}) =>
    resolveClientIp({ remoteAddress: "10.0.0.1", headers, trustProxyHops: hops, ...extra });

  it("without a trusted proxy the header is ignored completely", () => {
    expect(ip({ "x-forwarded-for": "6.6.6.6" }, 0)).toEqual({ ip: "10.0.0.1", source: "remote" });
  });

  it("with one proxy it takes the LAST entry, so a forged leftmost entry changes nothing", () => {
    expect(ip({ "x-forwarded-for": "203.0.113.7" }, 1).ip).toBe("203.0.113.7");
    expect(ip({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.7" }, 1).ip).toBe("203.0.113.7");
    expect(ip({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }, 1).ip).toBe("203.0.113.7");
  });

  it("with two proxies it takes the second from the right", () => {
    expect(ip({ "x-forwarded-for": "forged, 203.0.113.7, 172.16.0.5" }, 2).ip).toBe("203.0.113.7");
  });

  it("repeated headers are treated as one list", () => {
    expect(ip({ "x-forwarded-for": ["1.1.1.1", "203.0.113.7"] }, 1).ip).toBe("203.0.113.7");
  });

  it("falls back to the socket address when the header is missing, too short or not an address", () => {
    expect(ip({}, 1).source).toBe("remote");
    expect(ip({ "x-forwarded-for": "203.0.113.7" }, 2).source).toBe("remote");
    expect(ip({ "x-forwarded-for": "<script>" }, 1).source).toBe("remote");
    expect(ip({ "x-forwarded-for": "a".repeat(200) }, 1).source).toBe("remote");
  });

  it("a CDN client-IP header is used only when configured AND a proxy is trusted", () => {
    const headers = { "cf-connecting-ip": "198.51.100.4", "x-forwarded-for": "203.0.113.7" };
    expect(ip(headers, 1, { clientIpHeader: "cf-connecting-ip" })).toEqual({ ip: "198.51.100.4", source: "client-ip-header" });
    expect(ip(headers, 1).ip).toBe("203.0.113.7");
    expect(ip(headers, 0, { clientIpHeader: "cf-connecting-ip" }).ip).toBe("10.0.0.1");
    expect(ip({ "cf-connecting-ip": "garbage!!" }, 1, { clientIpHeader: "cf-connecting-ip" }).source).toBe("remote");
  });

  it("IPv6 addresses are accepted", () => {
    expect(ip({ "x-forwarded-for": "2001:db8::1" }, 1).ip).toBe("2001:db8::1");
  });
});

describe("Content-Security-Policy", () => {
  it("allows only our own resources", () => {
    const csp = buildCsp([]);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
  });

  it("adds sockets for listed cross-origin servers only", () => {
    const csp = buildCsp(["https://game.example.com", "http://localhost:5173", "*"]);
    expect(csp).toContain("https://game.example.com");
    expect(csp).toContain("wss://game.example.com");
    expect(csp).toContain("ws://localhost:5173");
    expect(csp).not.toContain("*");
  });
});

describe("serving the built web app", () => {
  let server: GameServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  function fakeDist(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "lastshell-dist-"));
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "index.html"), '<!doctype html><div id="root"></div><script src="/assets/app-abc123.js"></script>');
    writeFileSync(path.join(dir, "assets", "app-abc123.js"), "console.log('app')");
    writeFileSync(path.join(dir, "robots.txt"), "User-agent: *");
    return dir;
  }

  async function start(options: object = {}) {
    server = createGameServer({ webDist: fakeDist(), allowedOrigins: [], ...options });
    const port = await server.listen(0);
    return `http://127.0.0.1:${port}`;
  }

  it("serves index.html, hashed assets with long caching, and plain files", async () => {
    const base = await start();
    expect(server!.servingWeb).toBe(true);
    const home = await fetch(`${base}/`);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('id="root"');
    expect(home.headers.get("cache-control")).toBe("no-cache");
    const asset = await fetch(`${base}/assets/app-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toMatch(/max-age=31536000.*immutable/);
    expect((await fetch(`${base}/robots.txt`)).status).toBe(200);
  });

  it("any other page address returns the app (refresh works); missing files are real 404s", async () => {
    const base = await start();
    for (const p of ["/lobby", "/game/ABCDE", "/a/b/c/d", "/room/ABCDE?x=1"]) {
      const res = await fetch(base + p);
      expect(res.status, p).toBe(200);
      expect(await res.text(), p).toContain('id="root"');
    }
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/nope.png`)).status).toBe(404);
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${base}/healthz`)).headers.get("cache-control")).toBe("no-store");
  });

  it("cannot be tricked into serving files outside the web folder", async () => {
    const base = await start();
    for (const p of ["/../package.json", "/%2e%2e/%2e%2e/package.json", "/assets/..%2f..%2fpackage.json", "/..%5c..%5cpackage.json"]) {
      const res = await fetch(base + p);
      const body = await res.text();
      expect(body, p).not.toContain("last-shell-web");
    }
  });

  it("sends security headers on every response, and HSTS only when the request came in over HTTPS", async () => {
    const base = await start({ trustProxyHops: 1 });
    const plain = await fetch(`${base}/`);
    expect(plain.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(plain.headers.get("x-content-type-options")).toBe("nosniff");
    expect(plain.headers.get("x-frame-options")).toBe("DENY");
    expect(plain.headers.get("x-powered-by")).toBeNull();
    expect(plain.headers.get("strict-transport-security")).toBeNull();
    const https = await fetch(`${base}/`, { headers: { "x-forwarded-proto": "https" } });
    expect(https.headers.get("strict-transport-security")).toMatch(/max-age=\d+/);
    // a client cannot fake HTTPS when no proxy is trusted
    const direct = await start();
    expect((await fetch(`${direct}/`, { headers: { "x-forwarded-proto": "https" } })).headers.get("strict-transport-security")).toBeNull();
  });

  it("is API-only when there is no built web app (development workflow unchanged)", async () => {
    server = createGameServer({ webDist: path.join(tmpdir(), "does-not-exist-lastshell"), allowedOrigins: [] });
    const port = await server.listen(0);
    expect(server.servingWeb).toBe(false);
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
  });
});
