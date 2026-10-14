import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { ItemCue, ShotCue } from "../ui/model";
import { castFor, castModeFromSearch, muzzleAnchor, pickPoseImage, type AimTarget } from "./cast";
import { SILHOUETTE_MUZZLE, SILHOUETTE_SIZE, Silhouette } from "./Silhouette";
import { lookDirTowardNeighbor, type Side } from "./sceneState";

interface Props {
  seat: number;
  side: Side;
  alive: boolean;
  isTurn: boolean;
  aim: AimTarget;
  /** This figure's own gun just went off (server-confirmed, arrived after mount). */
  shot: ShotCue | null;
  /** This figure was just hit / hurt themselves (server-confirmed). */
  hurt: ShotCue | ItemCue | null;
}

function MuzzleFlash({ live }: { live: boolean }) {
  if (!live) return <span className="muzzle muzzle--dry" aria-hidden="true" />;
  return (
    <>
      <span className="muzzle muzzle--live" aria-hidden="true">
        <svg viewBox="-100 -100 200 200">
          <polygon
            points="0,-100 18,-34 70,-70 34,-14 100,0 34,16 70,70 18,34 0,100 -18,34 -70,70 -34,16 -100,0 -34,-14 -70,-70 -18,-34"
            fill="rgba(255,196,96,0.95)"
          />
          <circle r="34" fill="#fff6d0" />
        </svg>
      </span>
      <span className="smoke smoke--a" aria-hidden="true" />
      <span className="smoke smoke--b" aria-hidden="true" />
      <span className="smoke smoke--c" aria-hidden="true" />
    </>
  );
}

/** One opponent across the table: idle life, aiming, recoil, flash, smoke, flinch, and slumping when eliminated. */
export function Figure({ seat, side, alive, isTurn, aim, shot, hurt }: Props) {
  const mode = castModeFromSearch(typeof window === "undefined" ? "" : window.location.search);
  const cast = castFor(seat, side, mode);
  const lookDir = lookDirTowardNeighbor(side);
  // if the character image fails to load, fall back to the silhouette for that image
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const art = cast.art && failedSrc !== cast.art.idle ? cast.art : null;

  // blink (image mode): swap in the closed-eyes image for a moment, at a slightly different time per seat
  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    if (!art?.blink || !alive) return;
    let on: ReturnType<typeof setTimeout>;
    let off: ReturnType<typeof setTimeout>;
    const loop = () => {
      on = setTimeout(() => {
        setBlinking(true);
        off = setTimeout(() => {
          setBlinking(false);
          loop();
        }, 130);
      }, 2600 + ((seat * 937) % 2400));
    };
    loop();
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [art, alive, seat]);

  const muzzle = art ? muzzleAnchor(art.muzzle, aim, lookDir) : muzzleAnchor(SILHOUETTE_MUZZLE, aim, lookDir);
  const aspect = art ? art.width / art.height : SILHOUETTE_SIZE.width / SILHOUETTE_SIZE.height;
  const style = {
    "--aspect": String(aspect),
    "--delay": `${(seat * 1.37) % 3}s`,
    "--mx": `${muzzle.x}%`,
    "--my": `${muzzle.y}%`,
  } as CSSProperties;

  let image: ReactNode;
  let posed = false;
  if (art) {
    const src = pickPoseImage(art, { alive, aim, blinking });
    posed = src !== art.idle; // a dedicated pose image is showing (the CSS then skips the tilt/slump it adds to a plain idle)
    image = (
      <img
        className="fig__img"
        src={src}
        alt=""
        decoding="async"
        draggable={false}
        onError={() => setFailedSrc(art.idle)}
      />
    );
  } else {
    image = <Silhouette variant={cast.variant} aim={aim} lookDir={lookDir} />;
  }

  return (
    <div
      className={`fig fig--${side} fig--aim-${aim}${alive ? "" : " fig--dead"}${isTurn ? " fig--turn" : ""}${posed ? " fig--posed" : ""}`}
      style={style}
      data-seat={seat}
    >
      <div className="fig__breath">
        <div key={`hurt-${hurt?.id ?? 0}`} className={hurt ? "fig__flinch" : undefined}>
          <div key={`shot-${shot?.id ?? 0}`} className={shot ? (shot.live ? "fig__recoil" : "fig__click") : undefined}>
            {image}
          </div>
        </div>
      </div>
      {shot && alive && <div key={`fx-${shot.id}`} className="fig__muzzle"><MuzzleFlash live={shot.live} /></div>}
    </div>
  );
}
