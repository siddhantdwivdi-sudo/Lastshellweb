import { useState } from "react";
import { Backdrop } from "../components/Backdrop";
import { Spinner } from "../components/bits";
import { RulesDialog } from "../components/RulesDialog";
import { Toast } from "../components/Toast";
import { GameScreen } from "../game/GameScreen";
import { LobbyScreen } from "../screens/LobbyScreen";
import { TitleScreen } from "../screens/TitleScreen";
import type { AppController } from "./controller";

/** Renders whichever screen the controller says. Used by both the live app and mock mode. */
export function AppView({ c }: { c: AppController }) {
  const [rulesOpen, setRulesOpen] = useState(false);

  return (
    <>
      {c.screen === "title" && (
        <TitleScreen
          connection={c.connection}
          creating={c.creating}
          joining={c.joining}
          onCreate={c.createRoom}
          onJoin={c.joinRoom}
          onRetry={c.retryConnection}
          onHowTo={() => setRulesOpen(true)}
          notice={c.notice}
          onDismissNotice={c.dismissNotice}
        />
      )}
      {c.screen === "lobby" && c.lobby && (
        <LobbyScreen room={c.lobby} starting={c.starting} offline={c.lobbyOffline} onStart={c.startMatch} onLeave={c.leaveRoom} />
      )}
      {c.screen === "game" && c.game && <GameScreen model={c.game} actions={c.gameActions} onRules={() => setRulesOpen(true)} />}
      {c.screen === "loading" && (
        <main className="screen title">
          <Backdrop />
          <p className="title__status" role="status">
            <Spinner label="Loading" /> {c.loadingText ?? "Loading…"}
          </p>
        </main>
      )}
      {rulesOpen && <RulesDialog onClose={() => setRulesOpen(false)} />}
      <Toast toast={c.toast} onDismiss={c.dismissToast} />
    </>
  );
}
