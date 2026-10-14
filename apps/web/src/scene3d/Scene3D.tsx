import { useEffect, useRef } from "react";
import type { GameUiModel } from "../ui/model";
import { Stage3D } from "./Stage3D";

/**
 * The 3D room. It only watches the model (which is built from server-confirmed events):
 *  - model.aim  (shotFired)    -> the shooter lifts the gun and aims
 *  - cues.shot  (shotResolved) -> the trigger: blank click / live hit / head shot
 *  - cues.elim / cues.item     -> deaths and self-inflicted damage
 * It never decides anything. Cues that were already present when it mounted are ignored, so
 * reconnecting never replays an old gunshot.
 */
export default function Scene3D({ model }: { model: GameUiModel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage3D | null>(null);
  const seen = useRef({ aim: model.aim?.shotId ?? -1, shot: model.cues.shot?.id ?? -1, elim: model.cues.elim?.id ?? -1, item: model.cues.item?.id ?? -1 });
  const latest = useRef(model);
  latest.current = model;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stage = new Stage3D(canvas);
    stageRef.current = stage;
    const fit = () => {
      const hud = parseFloat(getComputedStyle(canvas).getPropertyValue("--hud-h")) || 0;
      stage.resize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight), window.devicePixelRatio || 1, hud);
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(canvas);
    window.addEventListener("resize", fit);
    stage.configure(latest.current.you);
    stage.start();
    if (import.meta.env.DEV) (window as unknown as { __stage?: Stage3D }).__stage = stage;
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", fit);
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  const { you, view, cues, aim } = model;

  useEffect(() => {
    stageRef.current?.configure(you);
  }, [you]);

  // follow the public state: who is alive, whose turn it is, the saw
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const alive = view.players.map((p) => p.alive);
    const hp = view.players.map((p) => p.hp);
    stage.configure(you);
    stage.sync(alive, hp, view.current, view.phase === "AWAITING", !!view.players[view.current]?.sawed);
  }, [view, you]);

  // one-shot cues (each id plays once)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const s = seen.current;
    if (!aim && !cues.shot && !cues.elim && !cues.item && (s.aim >= 0 || s.shot >= 0 || s.elim >= 0 || s.item >= 0)) {
      // the table was reset (new match or a fresh snapshot)
      stage.reset();
      seen.current = { aim: -1, shot: -1, elim: -1, item: -1 };
      return;
    }
    if (aim && aim.shotId !== s.aim) {
      s.aim = aim.shotId;
      void stage.startShot(aim.shooter, aim.target);
    }
    if (cues.shot && cues.shot.id !== s.shot) {
      s.shot = cues.shot.id;
      const shot = cues.shot;
      const lethal = shot.live && shot.damage > 0 && view.players[shot.target].hp <= 0;
      void stage.resolveShot(shot.shooter, shot.target, shot.live, lethal);
    }
    if (cues.item && cues.item.id !== s.item) {
      s.item = cues.item.id;
      const item = cues.item;
      if (item.hpChange < 0) stage.hurtSeat(item.seat);
      if (item.eject !== undefined && item.eject >= 0) stage.ejectShell(item.eject === 1);
    }
    if (cues.elim && cues.elim.id !== s.elim) {
      s.elim = cues.elim.id;
      stage.killSeat(cues.elim.seat);
    }
  }, [aim, cues, view]);

  return <canvas ref={canvasRef} className="scene3d" aria-hidden="true" />;
}
