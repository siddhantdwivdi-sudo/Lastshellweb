import { PLAYER_COLORS } from "@lastshell/shared";
import { useState } from "react";
import { Btn, Notice, Spinner } from "../components/bits";
import { Dialog } from "../components/Dialog";
import { seatName } from "../lib/layout";
import type { ReloadModel } from "../ui/model";

/** "RELOADING..." with the new load's public counts. */
export function ReloadOverlay({ reload }: { reload: ReloadModel }) {
  return (
    <div className="reload" role="status" aria-live="polite">
      <h2 className="reload__title">RELOADING…</h2>
      <p className="reload__sub">
        LOAD {reload.loadNumber} &nbsp;·&nbsp; {reload.live} LIVE / {reload.blank} BLANK
      </p>
      <div className="reload__shells" aria-hidden="true">
        {Array.from({ length: reload.live + reload.blank }, (_, i) => (
          <span key={i} className={`reload__shell ${i < reload.live ? "is-live" : "is-blank"}`} style={{ animationDelay: `${i * 70}ms` }} />
        ))}
      </div>
    </div>
  );
}

interface WinnerProps {
  winner: number;
  you: number;
  isAdmin: boolean;
  /** PLAY AGAIN has been sent and the server hasn't answered yet. */
  pending: boolean;
  onPlayAgain(): void;
  onMenu(): void;
}

export function WinnerOverlay({ winner, you, isAdmin, pending, onPlayAgain, onMenu }: WinnerProps) {
  const none = winner < 0;
  return (
    <Dialog title="WINNER" hideTitle accent="var(--amber)">
      <div className="winner">
        <p className="winner__head" aria-hidden="true">
          WINNER
        </p>
        <p className="winner__name" style={{ color: none ? "var(--dim)" : PLAYER_COLORS[winner] }}>
          {none ? "NO SURVIVORS" : seatName(winner)}
        </p>
        {!none && <p className="winner__you">{winner === you ? "That's you." : "Better luck next time."}</p>}
        <div className="winner__actions">
          <Btn
            size="lg"
            accent="var(--amber)"
            disabled={!isAdmin}
            loading={pending}
            onClick={onPlayAgain}
          >
            PLAY AGAIN
          </Btn>
          <Btn variant="ghost" accent="var(--dim)" onClick={onMenu}>
            MAIN MENU
          </Btn>
        </div>
        {!isAdmin && <Notice kind="info">Waiting for the room admin to start the next match.</Notice>}
      </div>
    </Dialog>
  );
}

interface MenuProps {
  onResume(): void;
  onRules(): void;
  onLeave(): void;
}

/** In-match menu. There is deliberately no restart here: only the admin can start a new match, after game over. */
export function MenuOverlay({ onResume, onRules, onLeave }: MenuProps) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Dialog title="MENU" onClose={onResume} accent="var(--amber)">
      <p className="menu__note">The match keeps going while this menu is open.</p>
      <div className="menu">
        <Btn size="lg" accent="var(--amber)" onClick={onResume}>
          RESUME
        </Btn>
        <Btn size="lg" variant="ghost" accent="var(--amber)" onClick={onRules}>
          HOW TO PLAY
        </Btn>
        {!confirm ? (
          <Btn size="lg" variant="danger" accent="var(--red)" onClick={() => setConfirm(true)}>
            LEAVE ROOM
          </Btn>
        ) : (
          <div className="menu__confirm">
            <Notice kind="error">Leaving forfeits the match. You can't come back.</Notice>
            <Btn size="lg" variant="danger" accent="var(--red)" onClick={onLeave}>
              YES, LEAVE
            </Btn>
            <Btn variant="ghost" accent="var(--dim)" onClick={() => setConfirm(false)}>
              STAY
            </Btn>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function ReconnectOverlay() {
  return (
    <div className="reconnect" role="alert" aria-live="assertive">
      <Spinner label="Reconnecting" />
      <p>RECONNECTING TO THE MATCH…</p>
      <small>Your seat is held for 60 seconds.</small>
    </div>
  );
}
