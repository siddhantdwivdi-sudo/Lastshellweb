/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the game server (Socket.IO). Defaults: dev = this host on port 3001, production = same origin. */
  readonly VITE_SERVER_URL?: string;
  /** "1" starts the development-only mock mode (see `npm run dev:mock`). */
  readonly VITE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
