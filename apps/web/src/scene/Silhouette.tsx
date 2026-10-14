// INTERIM ARTWORK. These are dark, rim-lit vector silhouettes so the scene, animations and HUD can be
// built and reviewed before real character art exists. They are NOT the realistic characters the
// final design calls for: replace them by filling in `art` in cast.ts (see docs/ART.md).

import type { AimTarget, MuzzleAnchors } from "./cast";

/** Where the muzzle is inside the 400x600 drawing, in percent (for the flash and smoke). */
export const SILHOUETTE_MUZZLE: MuzzleAnchors = {
  player: { x: 50, y: 69.5 },
  neighbor: { x: 92.5, y: 68.8 },
  self: { x: 50, y: 53 },
};

export const SILHOUETTE_SIZE = { width: 400, height: 600 };

const TORSO = [
  "M20 600 C20 480 70 392 200 372 C330 392 380 480 380 600 Z", // coat
  "M0 600 C0 470 55 380 200 360 C345 380 400 470 400 600 Z", // broad jacket
  "M30 600 C30 490 80 400 200 380 C320 400 370 490 370 600 Z", // hoodie
] as const;

interface Props {
  variant: 0 | 1 | 2;
  aim: AimTarget;
  /** Which way the figure turns when it covers the other opponent. */
  lookDir: "left" | "right";
}

export function Silhouette({ variant, aim, lookDir }: Props) {
  const id = (n: string) => `sil${variant}-${n}`;
  return (
    <svg
      className={`sil sil--v${variant} sil--aim-${aim}`}
      viewBox="0 0 400 600"
      role="img"
      aria-label="Opponent"
      preserveAspectRatio="xMidYMax meet"
    >
      <defs>
        <linearGradient id={id("coat")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c1714" />
          <stop offset="1" stopColor="#060506" />
        </linearGradient>
        <linearGradient id={id("rim")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ff9a4d" stopOpacity="0.5" />
          <stop offset="0.22" stopColor="#ff9a4d" stopOpacity="0" />
          <stop offset="0.8" stopColor="#c0392b" stopOpacity="0" />
          <stop offset="1" stopColor="#c0392b" stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id={id("face")} cx="0.5" cy="0.28" r="0.75">
          <stop offset="0" stopColor="#5a4234" />
          <stop offset="0.55" stopColor="#1d1411" />
          <stop offset="1" stopColor="#070505" />
        </radialGradient>
        <linearGradient id={id("steel")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8d939c" />
          <stop offset="0.5" stopColor="#3b3f47" />
          <stop offset="1" stopColor="#15171a" />
        </linearGradient>
        <linearGradient id={id("wood")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7a4726" />
          <stop offset="1" stopColor="#2c170b" />
        </linearGradient>
        <radialGradient id={id("bore")} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" />
          <stop offset="0.7" stopColor="#050505" />
          <stop offset="1" stopColor="#262a30" />
        </radialGradient>
      </defs>

      <g className="sil-body">
        {/* torso + collar */}
        <path d={TORSO[variant]} fill={`url(#${id("coat")})`} />
        <path d={TORSO[variant]} fill={`url(#${id("rim")})`} />
        <path d="M168 372 L200 430 L232 372 Q200 360 168 372Z" fill="#2a2420" opacity="0.85" />
        <path d="M58 462 C92 412 142 388 200 380" stroke="#ff9d55" strokeWidth="2.5" fill="none" opacity="0.4" strokeLinecap="round" />
        <path d="M342 462 C308 412 258 388 200 380" stroke="#d6402c" strokeWidth="2.5" fill="none" opacity="0.28" strokeLinecap="round" />

        <g className="sil-head">
          <path d="M170 292 H230 L236 384 H164Z" fill="#120d0b" />
          {/* hood sits behind the face */}
          {variant === 2 && (
            <path d="M100 350 C74 108 326 108 300 350 C276 292 124 292 100 350Z" fill="#16120f" stroke="#2a211b" strokeWidth="2" />
          )}
          <ellipse cx="140" cy="240" rx="9" ry="17" fill="#140e0c" />
          <ellipse cx="260" cy="240" rx="9" ry="17" fill="#140e0c" />
          {/* skull and jaw */}
          <path
            d={
              variant === 1
                ? "M134 232 C134 160 266 160 266 232 C266 272 254 302 228 316 C214 324 186 324 172 316 C146 302 134 272 134 232Z"
                : "M142 228 C142 166 258 166 258 228 C258 264 248 292 224 308 C212 316 188 316 176 308 C152 292 142 264 142 228Z"
            }
            fill={`url(#${id("face")})`}
          />
          {/* lamp on the top of the head and the left cheek */}
          <ellipse cx="198" cy="172" rx="44" ry="9" fill="#ffd2a0" opacity="0.14" />
          <ellipse cx="166" cy="266" rx="17" ry="24" fill="#ffbe8c" opacity="0.09" />
          {/* brow shadow, nose */}
          <path d="M150 230 Q176 215 197 229 M203 229 Q224 215 250 230" stroke="#000" strokeWidth="9" fill="none" opacity="0.62" strokeLinecap="round" />
          <path d="M200 238 L194 272 Q200 277 206 272" stroke="#ffc896" strokeWidth="2" fill="none" opacity="0.16" />
          {variant === 1 && <path d="M142 262 C150 330 250 330 258 262 C240 292 160 292 142 262Z" fill="#070505" opacity="0.92" />}
          {variant === 0 && (
            <>
              <ellipse cx="200" cy="198" rx="116" ry="18" fill="#0d0a09" />
              <path d="M128 198 C126 118 274 118 272 198Z" fill="#14100e" />
              <path d="M130 188 H270 V198 H130Z" fill="#3a0e0e" />
              <ellipse cx="200" cy="206" rx="64" ry="12" fill="#000" opacity="0.55" />
            </>
          )}
          {/* eyes: only a faint glint in the shadow */}
          <g className="sil-eyes">
            <ellipse className="sil-eye" cx="176" cy="242" rx="7" ry="2.6" fill="#d8ccb4" opacity="0.8" />
            <ellipse className="sil-eye" cx="224" cy="242" rx="7" ry="2.6" fill="#d8ccb4" opacity="0.8" />
          </g>
          <path d="M184 288 Q200 294 216 288" stroke="#000" strokeWidth="2" fill="none" opacity="0.5" />
        </g>
      </g>

      {/* ---- weapon: three poses cross-fade ---- */}
      <g className="sil-pose sil-pose--player">
        <path d="M70 600 C88 520 138 470 186 438 L202 462 C160 492 124 540 110 600Z" fill="#0b0908" />
        <path d="M330 600 C312 520 262 470 214 438 L198 462 C240 492 276 540 290 600Z" fill="#0b0908" />
        <ellipse cx="190" cy="452" rx="15" ry="11" fill="#17110e" />
        <ellipse cx="212" cy="452" rx="15" ry="11" fill="#17110e" />
        <rect x="176" y="398" width="48" height="52" rx="9" fill="#101214" />
        <circle cx="200" cy="448" r="10" fill={`url(#${id("steel")})`} />
        <circle cx="200" cy="418" r="22" fill={`url(#${id("steel")})`} />
        <circle cx="200" cy="418" r="22" fill="none" stroke="#a9afb8" strokeWidth="1.5" opacity="0.5" />
        <circle cx="200" cy="418" r="12.5" fill={`url(#${id("bore")})`} />
        <circle cx="200" cy="394" r="3" fill="#cfd3d8" />
      </g>

      {/* profile, pointing right; mirrored by CSS when the figure covers the opponent on its left */}
      <g className={`sil-pose sil-pose--neighbor sil-look-${lookDir}`}>
        <path d="M70 600 C90 540 150 490 214 444 L228 462 C176 506 134 548 112 600Z" fill="#0b0908" />
        <path d="M330 600 C316 546 270 500 236 470 L222 470 C250 510 290 560 296 600Z" fill="#0b0908" />
        <path d="M118 408 L58 434 L68 476 L122 446Z" fill={`url(#${id("wood")})`} />
        <rect x="118" y="402" width="64" height="36" rx="7" fill="#101214" />
        <rect x="170" y="406" width="204" height="14" rx="4" fill={`url(#${id("steel")})`} />
        <rect x="170" y="424" width="136" height="10" rx="4" fill="#15171a" />
        <rect x="206" y="424" width="62" height="18" rx="6" fill={`url(#${id("wood")})`} />
        <ellipse cx="236" cy="448" rx="15" ry="10" fill="#17110e" />
        <ellipse cx="160" cy="432" rx="13" ry="10" fill="#17110e" />
        <circle cx="371" cy="404" r="2.5" fill="#cfd3d8" />
      </g>

      {/* barrel turned up under the chin */}
      <g className="sil-pose sil-pose--self">
        <path d="M80 600 C92 540 140 500 186 480 L202 502 C164 520 128 552 112 600Z" fill="#0b0908" />
        <path d="M320 600 C308 540 262 500 214 480 L198 502 C236 520 272 552 288 600Z" fill="#0b0908" />
        <rect x="190" y="316" width="20" height="150" rx="5" fill={`url(#${id("steel")})`} />
        <rect x="180" y="440" width="40" height="52" rx="8" fill="#101214" />
        <ellipse cx="200" cy="318" rx="10" ry="4" fill="#000" />
        <ellipse cx="190" cy="470" rx="14" ry="10" fill="#17110e" />
        <ellipse cx="212" cy="470" rx="14" ry="10" fill="#17110e" />
      </g>
    </svg>
  );
}
