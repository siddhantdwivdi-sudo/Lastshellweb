import { fileURLToPath } from "node:url";
import { createGameServer } from "./app";
import { loadServerConfig } from "./config";

const config = loadServerConfig();

// The built frontend lives at apps/web/dist. This file is apps/server/src/index.ts (development)
// or apps/server/dist/index.mjs (production build): both are two levels below apps/.
const defaultWebDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
const server = createGameServer({ ...config, webDist: config.webDist ?? defaultWebDist });

server.listen(config.port).then((port) => {
  // Only non-secret facts are logged: never tokens, room contents or player messages.
  console.log(`Last Shell server listening on port ${port} (${config.production ? "production" : "development"})`);
  console.log(server.servingWeb ? "Serving the built web app" : "Not serving a web app (API/Socket.IO only)");
  console.log(
    config.allowedOrigins.length > 0
      ? `Extra allowed origins: ${config.allowedOrigins.join(", ")}`
      : "Allowed origins: this server's own address only",
  );
  if (config.trustProxyHops > 0) console.log(`Trusting ${config.trustProxyHops} reverse proxy hop(s) for client IPs`);
  if (config.rooms.busyScale !== undefined) console.log(`Busy scale: ${config.rooms.busyScale} (testing only)`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received: closing (active matches end)`);
    server.close().finally(() => process.exit(0));
  });
}

process.on("unhandledRejection", (reason) => {
  console.error(`unhandled rejection: ${reason instanceof Error ? reason.name : "unknown"}`);
});
