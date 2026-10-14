import "@fontsource/oswald/500.css";
import "@fontsource/oswald/700.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/screens.css";
import "./styles/game.css";
import "./styles/scene.css";
import "./styles/overlays.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
