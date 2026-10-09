import { useEffect, useRef, useState } from "react";
import { IDLE_AIM } from "../lib/layout";

interface Props {
  /** Target angle in radians. */
  aim: number;
  /** Changes on every shot so the muzzle flash and recoil restart. null before the first shot. */
  shotId: number | null;
  sawed: boolean;
}

const WOOD = "#6b381a";
const STEEL = "#757a85";
const DARK = "#33353b";

/** Shortest signed difference between two angles (like Godot's angle_difference). */
function angleDifference(from: number, to: number): number {
  const d = (to - from) % (Math.PI * 2);
  return ((2 * d) % (Math.PI * 2)) - d;
}

/** The shotgun, drawn from simple shapes using the same coordinates as the Godot version. */
export function ShotgunView({ aim, shotId, sawed }: Props) {
  // Keep a running angle so the barrel always turns the short way round.
  const angle = useRef(IDLE_AIM);
  const [deg, setDeg] = useState((IDLE_AIM * 180) / Math.PI);
  useEffect(() => {
    angle.current = angle.current + angleDifference(angle.current, aim);
    setDeg((angle.current * 180) / Math.PI);
  }, [aim]);

  const star = Array.from({ length: 12 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 12;
    const r = i % 2 === 0 ? 70 : 24;
    return `${(166 + Math.cos(a) * r).toFixed(1)},${(-3 + Math.sin(a) * r).toFixed(1)}`;
  }).join(" ");

  return (
    <svg className="gun" viewBox="-250 -150 500 300" role="img" aria-label="Shotgun" preserveAspectRatio="xMidYMid meet">
      <circle cx="0" cy="10" r="120" fill="rgba(0,0,0,0.22)" />
      <circle cx="0" cy="0" r="118" fill="none" stroke="rgba(191,97,26,0.25)" strokeWidth="2" />
      <g className="gun__aim" style={{ transform: `rotate(${deg}deg)` }}>
        <g key={shotId ?? "idle"} className={shotId !== null ? "gun__recoil" : undefined}>
          <polygon points="-30,-9 -125,0 -140,24 -122,28 -30,15" fill={WOOD} />
          <rect x="-32" y="-11" width="48" height="26" fill={DARK} />
          <rect x="14" y="-8" width="150" height="10" fill={STEEL} />
          <rect x="14" y="-8" width="150" height="3" fill="#b3b8c2" />
          <rect x="14" y="4" width="118" height="7" fill={DARK} />
          <rect x="40" y="3" width="72" height="13" fill={WOOD} />
          <rect x="40" y="3" width="72" height="3" fill="#94562f" />
          <path d="M -1 15 A 9 9 0 0 1 -19 15" fill="none" stroke={DARK} strokeWidth="3" />
          {sawed && <rect x="14" y="-8" width="150" height="10" fill="none" stroke="#ff9926" strokeWidth="2" />}
          {shotId !== null && (
            <g className="gun__flash">
              <polygon points={star} fill="rgba(255,191,64,0.9)" />
              <circle cx="166" cy="-3" r="26" fill="#fff8cc" />
            </g>
          )}
        </g>
      </g>
    </svg>
  );
}
