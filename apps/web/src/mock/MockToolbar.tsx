import { useState } from "react";
import type { MockApp } from "./useMockApp";

/** Floating panel for exploring the UI with mock data. Removed when real networking arrives. */
export function MockToolbar({ app }: { app: MockApp }) {
  const [open, setOpen] = useState(false);
  const { mock } = app;

  return (
    <aside className={`mock${open ? " is-open" : ""}`} aria-label="Mock data controls">
      <button type="button" className="mock__toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "CLOSE" : "MOCK"}
      </button>
      {open && (
        <div className="mock__panel">
          <p className="mock__note">Mock data only: no server. {mock.frameLabel && <>Script: <em>{mock.frameLabel}</em></>}</p>

          <h4>Screen</h4>
          <div className="mock__row">
            {(["title", "lobby", "game"] as const).map((s) => (
              <button key={s} type="button" className={app.screen === s ? "is-on" : ""} onClick={() => mock.setScreen(s)}>
                {s}
              </button>
            ))}
          </div>

          <h4>Connection (title)</h4>
          <div className="mock__row">
            {(["ready", "connecting", "error"] as const).map((c) => (
              <button key={c} type="button" className={app.connection === c ? "is-on" : ""} onClick={() => mock.setConnection(c)}>
                {c}
              </button>
            ))}
          </div>
          <p className="mock__note">Join codes: 22222 not found · 33333 full · 44444 started · anything else works.</p>

          <h4>Lobby</h4>
          <div className="mock__row">
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" onClick={() => mock.setPlayers(n)}>
                {n} player{n > 1 ? "s" : ""}
              </button>
            ))}
            <button type="button" onClick={mock.toggleAdmin}>
              toggle admin
            </button>
            <button type="button" onClick={mock.disconnectSeat}>
              (dis)connect other
            </button>
          </div>

          <h4>Game screen</h4>
          <div className="mock__list">
            {mock.scenarios.map((s) => (
              <button key={s.id} type="button" className={mock.activeScenario === s.id ? "is-on" : ""} onClick={() => mock.jumpTo(s.id)}>
                {s.label}
              </button>
            ))}
            <button type="button" onClick={mock.resumeScript}>
              ▶ play scripted match
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
