import { lazy, Suspense, useRef, type CSSProperties, type ReactNode } from "react";
import type { GameUiModel } from "../ui/model";
import { canUse3dScene } from "../scene3d/support";
import { Figure } from "./Figure";
import { aimOf, hurtByItem, opponentSeats, shotBy, sideOf, wasShot } from "./sceneState";

interface Props {
  model: GameUiModel;
  /** The HUD plate (name, health, status, items) for an opponent, drawn above their figure. */
  renderPlate(seat: number): ReactNode;
}

/**
 * A cue only counts as "new" if it arrived after this component mounted. Without this, reopening a
 * screen or reconnecting would replay the last gunshot.
 */
function useFresh<T extends { id: number }>(cue: T | null): T | null {
  const atMount = useRef<number | null>(cue ? cue.id : null);
  return cue && cue.id !== atMount.current ? cue : null;
}

/**
 * The dark room: far wall, hanging lamp, worn table, the two opponents across it with their guns on
 * the player, grain and vignette. Everything that moves is
 * driven by server-confirmed events (the cues in the model); nothing here decides an outcome.
 */
const USE_3D = canUse3dScene();
// three.js is only downloaded when the 3D room is actually used
const Scene3D = lazy(() => import("../scene3d/Scene3D"));

export function SceneStage({ model, renderPlate }: Props) {
  const { you, view } = model;
  const shot = useFresh(model.cues.shot);
  const item = useFresh(model.cues.item);
  const [leftSeat, rightSeat] = opponentSeats(you);

  const me = view.players[you];
  const hitMe = (wasShot(shot, you) ? shot : null) ?? (hurtByItem(item, you) ? item : null);
  const lowHealth = me.alive && me.hp === 1 && view.phase === "AWAITING";
  const shake = model.fx?.shake ? (model.fx.id % 2 ? " shake-a" : " shake-b") : "";

  const figure = (seat: number) => {
    const alive = view.players[seat].alive;
    const hurt = (wasShot(shot, seat) ? shot : null) ?? (hurtByItem(item, seat) ? item : null);
    return (
      <Figure
        key={seat}
        seat={seat}
        side={sideOf(seat, you)}
        alive={alive}
        isTurn={view.phase === "AWAITING" && view.current === seat && alive}
        aim={aimOf(model.aim, seat, you)}
        shot={shotBy(shot, seat)}
        hurt={hurt}
      />
    );
  };

  const plate = (seat: number) => (
    <div key={seat} className={`scene__plate scene__plate--${sideOf(seat, you)}`} style={{ "--seat-order": seat } as CSSProperties}>
      {renderPlate(seat)}
    </div>
  );

  return (
    <div className={`scene${USE_3D ? " scene--3d" : ""}${shake}${lowHealth ? " scene--lowhp" : ""}`} aria-hidden="false">
      {USE_3D ? (
        <div className="scene__world">
          <Suspense fallback={null}>
            <Scene3D model={model} />
          </Suspense>
        </div>
      ) : (
        <div className="scene__world">
          <div className="scene__wall" />
          <div className="scene__lamp">
            <div className="scene__cone" />
            <div className="scene__bulb" />
          </div>
          <div className="scene__dust">
            {Array.from({ length: 14 }, (_, i) => (
              <i key={i} style={{ "--i": i } as CSSProperties} />
            ))}
          </div>
          <div className="scene__figures">
            {figure(leftSeat)}
            {figure(rightSeat)}
          </div>
          <div className="scene__table">
            <div className="scene__grainwood" />
            <div className="scene__pool" />
            <div className="scene__edge" />
          </div>
        </div>
      )}
      <div className="scene__plates">
        {plate(leftSeat)}
        {plate(rightSeat)}
      </div>
      <div className="scene__vignette" />
      <div className="scene__filmgrain" />
      {hitMe && <div key={`hit-${hitMe.id}`} className="scene__hit" />}
      {lowHealth && <div className="scene__heartbeat" />}
    </div>
  );
}
