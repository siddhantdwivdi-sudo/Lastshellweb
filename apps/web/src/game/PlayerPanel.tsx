import { ITEM_DEFS, MAX_HP, PLAYER_COLORS, type PublicPlayer, type RoomSeatInfo } from "@lastshell/shared";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { formatCountdown, seatName } from "../lib/layout";
import { useNow } from "../lib/hooks";

interface Props {
  player: PublicPlayer;
  seatInfo: RoomSeatInfo | null;
  isTurn: boolean;
  isYou: boolean;
  /** The local player's items live in the inventory instead. */
  showItems: boolean;
  gameOver: boolean;
  compact?: boolean;
}

function hpColor(hp: number): string {
  if (hp >= 3) return "var(--good)";
  if (hp === 2) return "var(--amber)";
  return "var(--red)";
}

export function PlayerPanel({ player, seatInfo, isTurn, isYou, showItems, gameOver, compact }: Props) {
  const color = PLAYER_COLORS[player.seat];
  const now = useNow(1000, !!seatInfo?.graceEndsAt);

  // Floating "-1" / "+2" whenever HP changes (presentation only).
  const lastHp = useRef(player.hp);
  const [float, setFloat] = useState<{ id: number; text: string; good: boolean } | null>(null);
  useEffect(() => {
    const diff = player.hp - lastHp.current;
    lastHp.current = player.hp;
    if (diff === 0) return;
    const id = Date.now();
    setFloat({ id, text: diff > 0 ? `+${diff}` : `${diff}`, good: diff > 0 });
    const t = window.setTimeout(() => setFloat((f) => (f?.id === id ? null : f)), 1200);
    return () => window.clearTimeout(t);
  }, [player.hp]);

  const tags: string[] = [];
  if (player.cuffed) tags.push("CUFFED");
  if (player.sawed) tags.push("SAW");

  let status = "ALIVE";
  let statusClass = "is-good";
  if (!player.alive) {
    status = "ELIMINATED";
    statusClass = "is-bad";
  } else if (tags.length) {
    status = tags.join(" / ");
    statusClass = "is-warn";
  }

  const dc = seatInfo && !seatInfo.connected;
  const remaining = seatInfo?.graceEndsAt ? seatInfo.graceEndsAt - now : null;

  return (
    <article
      className={`panel${isTurn && !gameOver && player.alive ? " panel--turn" : ""}${!player.alive ? " panel--out" : ""}${compact ? " panel--compact" : ""}`}
      style={{ "--seat": color } as CSSProperties}
      aria-label={`${seatName(player.seat)}${isYou ? " (you)" : ""}, ${player.hp} of ${MAX_HP} HP, ${status}`}
    >
      <header className="panel__head">
        <h3 className="panel__name">
          {seatName(player.seat)}
          {isYou && <span className="tag tag--you">YOU</span>}
          {seatInfo?.isAdmin && <span className="tag tag--admin">ADMIN</span>}
        </h3>
        <span className={`panel__status ${statusClass}`}>{status}</span>
      </header>

      <div className="hp" role="img" aria-label={`HP ${player.hp} of ${MAX_HP}`}>
        <div className="hp__segs">
          {Array.from({ length: MAX_HP }, (_, i) => (
            <span
              key={`${i}-${player.hp}`}
              className={`hp__seg${i < player.hp ? " is-full" : ""}`}
              style={i < player.hp ? ({ background: hpColor(player.hp) } as CSSProperties) : undefined}
            />
          ))}
        </div>
        <span className="hp__num">
          {player.hp}/{MAX_HP}
        </span>
      </div>

      {dc && (
        <p className="panel__conn" role="status">
          {seatInfo.forfeited ? "LEFT THE MATCH" : `DISCONNECTED${remaining !== null ? ` · ${formatCountdown(remaining)}` : ""}`}
        </p>
      )}

      {showItems && (
        <ul className="chips" aria-label={`${seatName(player.seat)} items`}>
          {player.items.length === 0 && player.alive && <li className="chips__empty">no items</li>}
          {player.items.map((item, i) => (
            <li
              key={`${item}-${i}`}
              className="chip"
              style={{ "--item": ITEM_DEFS[item].color } as CSSProperties}
              title={ITEM_DEFS[item].name}
            >
              {ITEM_DEFS[item].short}
            </li>
          ))}
        </ul>
      )}

      {float && (
        <span key={float.id} className={`float ${float.good ? "float--good" : "float--bad"}`} aria-hidden="true">
          {float.text}
        </span>
      )}
      {!player.alive && (
        <span className="stamp" aria-hidden="true">
          ELIMINATED
        </span>
      )}
    </article>
  );
}
