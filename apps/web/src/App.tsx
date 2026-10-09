import { lazy, Suspense } from "react";
import { AppView } from "./app/AppView";
import { useGameClient } from "./net/useGameClient";

/**
 * Development-only mock mode (canned data, no server): `npm run dev:mock`, or add ?mock=1 to the URL
 * of a dev server. The condition is a build-time constant, so production builds contain none of it.
 */
const MockRoot = import.meta.env.DEV ? lazy(() => import("./mock/MockRoot")) : null;
const mockRequested =
  import.meta.env.DEV && (import.meta.env.VITE_MOCK === "1" || new URLSearchParams(window.location.search).get("mock") === "1");

function LiveApp() {
  const controller = useGameClient();
  return <AppView c={controller} />;
}

export function App() {
  if (MockRoot && mockRequested) {
    return (
      <Suspense fallback={null}>
        <MockRoot />
      </Suspense>
    );
  }
  return <LiveApp />;
}
