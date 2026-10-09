import { PLAYER_COLORS, type PublicPlayer } from "@lastshell/shared";
import { Btn } from "../components/bits";
import { seatName } from "../lib/layout";

interface Props {
  you: number;
  /** Opponent seats in screen order (left, right). */
  opponents: number[];
  players: PublicPlayer[];
  canAct: boolean;
  pending: boolean;
  onShoot(target: number): void;
}

export function ActionBar({ you, opponents, players, canAct, pending, onShoot }: Props) {
  return (
    <div className="actions" role="group" aria-label="Shoot">
      {opponents.map((seat) => {
        const target = players[seat];
        return (
          <Btn
            key={seat}
            size="lg"
            accent={PLAYER_COLORS[seat]}
            className="actions__btn"
            onClick={() => onShoot(seat)}
            disabled={!canAct || !target.alive}
            aria-keyshortcuts={String(seat + 1)}
          >
            SHOOT {seatName(seat)}
            <small>{target.alive ? "ends your turn" : "eliminated"}</small>
          </Btn>
        );
      })}
      <Btn
        size="lg"
        variant="danger"
        accent="var(--red)"
        className="actions__btn"
        onClick={() => onShoot(you)}
        disabled={!canAct}
        loading={pending}
        aria-keyshortcuts="0"
      >
        SHOOT MYSELF
        <small>blank keeps your turn</small>
      </Btn>
    </div>
  );
}
