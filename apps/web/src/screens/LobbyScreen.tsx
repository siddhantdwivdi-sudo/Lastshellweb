import { PLAYER_COLORS, PLAYER_COUNT, type RoomState } from "@lastshell/shared";
import { useEffect, useRef, useState } from "react";
import { Backdrop } from "../components/Backdrop";
import { Btn, Notice } from "../components/bits";
import { formatCountdown, seatName } from "../lib/layout";
import { useNow } from "../lib/hooks";

interface Props {
  room: RoomState;
  starting: boolean;
  /** The connection to the server dropped; we are trying to get back. */
  offline?: boolean;
  onStart(): void;
  onLeave(): void;
}

type CopyState = "idle" | "copied" | "failed";

export function LobbyScreen({ room, starting, offline = false, onStart, onLeave }: Props) {
  const [copy, setCopy] = useState<CopyState>("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const now = useNow(1000, room.seats.some((s) => s && s.graceEndsAt));

  const isAdmin = room.adminSeat === room.you;
  const present = room.seats.filter((s) => s !== null).length;
  const connected = room.seats.filter((s) => s?.connected).length;
  const full = connected === PLAYER_COUNT;

  async function copyCode() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(room.code);
      ok = true;
    } catch {
      // Clipboard API can be unavailable (insecure origin, permissions): fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = room.code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
    }
    setCopy(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopy("idle"), 2200);
  }

  let startHint: string;
  if (!isAdmin) startHint = "Only the room admin can start the match.";
  else if (present < PLAYER_COUNT) startHint = `Waiting for ${PLAYER_COUNT - present} more player${PLAYER_COUNT - present > 1 ? "s" : ""}…`;
  else if (!full) startHint = "A player is disconnected. Wait for them to return.";
  else startHint = "Everyone is here. Start when you're ready.";

  return (
    <main className="screen lobby">
      <Backdrop />
      <div className="lobby__card">
        <header className="lobby__head">
          <p className="eyebrow">ROOM CODE</p>
          <div className="lobby__code-row">
            <span className="lobby__code" aria-label={`Room code ${room.code.split("").join(" ")}`}>
              {room.code}
            </span>
            <Btn variant="ghost" onClick={copyCode} accent="var(--amber)" aria-live="polite">
              {copy === "copied" ? "COPIED" : copy === "failed" ? "COPY FAILED" : "COPY CODE"}
            </Btn>
          </div>
          <p className="lobby__sub">Share this code with two friends. Three players are needed.</p>
        </header>

        <ul className="seats" aria-label="Players">
          {Array.from({ length: PLAYER_COUNT }, (_, seat) => {
            const info = room.seats[seat];
            const color = PLAYER_COLORS[seat];
            const remaining = info?.graceEndsAt ? info.graceEndsAt - now : null;
            return (
              <li key={seat} className={`seat${info ? "" : " seat--empty"}`} style={{ "--seat": color } as React.CSSProperties}>
                <span className="seat__bar" />
                <div className="seat__main">
                  <span className="seat__name">{seatName(seat)}</span>
                  <span className="seat__badges">
                    {seat === room.you && <span className="tag tag--you">YOU</span>}
                    {info?.isAdmin && <span className="tag tag--admin">ADMIN</span>}
                  </span>
                </div>
                <span
                  className={`seat__status ${info ? (info.connected ? "is-on" : "is-off") : "is-empty"}`}
                  role="status"
                >
                  {!info && "Waiting for player…"}
                  {info?.connected && "Connected"}
                  {info && !info.connected && (remaining !== null ? `Disconnected ${formatCountdown(remaining)}` : "Disconnected")}
                </span>
              </li>
            );
          })}
        </ul>

        {offline && <Notice kind="error">Connection lost. Reconnecting…</Notice>}
        <p className={`lobby__hint${full && isAdmin ? " is-ready" : ""}`}>{startHint}</p>
        {!isAdmin && present === PLAYER_COUNT && full && <Notice kind="info">Waiting for the admin to start the match…</Notice>}

        <div className="lobby__actions">
          <Btn size="lg" accent="var(--amber)" onClick={onStart} disabled={!isAdmin || !full || offline} loading={starting}>
            START MATCH
          </Btn>
          <Btn variant="danger" accent="var(--red)" onClick={onLeave} disabled={starting}>
            LEAVE ROOM
          </Btn>
        </div>
      </div>
    </main>
  );
}
