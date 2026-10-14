# Character artwork for the table scene

The game screen is a layered 2D scene (room, lamp, worn table, grain, smoke) with two opponent figures sitting
across the table, holding shotguns pointed at you. **The scene, animations and HUD are finished and driven by
server events. The characters are currently interim vector silhouettes** (`apps/web/src/scene/Silhouette.tsx`),
drawn so the scene could be built and reviewed. They are *not* the realistic men the final design asks for.

This document says exactly what artwork is needed so real characters can replace them without touching any game code.

## Why this is a separate step

Photorealistic faces cannot be produced with CSS/SVG. They need real images, and the options all have a
cost or a licence question. Nothing has been generated, bought or downloaded for this project.

| Option | Cost | Realism | Notes |
|---|---|---|---|
| **A. AI-generated images** (e.g. an image model you subscribe to) | Usually credits/subscription | High | Needs a consistent character across several poses (use an image model that accepts a reference image). **Check the tool's commercial-use terms and keep a record of them.** The image service connected to this workspace showed 0 credits on a free plan when checked, so nothing was generated. |
| **B. Commission an illustrator / photographer** | Paid, one-off | Highest, fully controlled | Cleanest licence: get a written licence (or assignment) for web/game use. |
| **C. Licensed stock photos or 3D models** (e.g. CC0 / properly licensed) | Free to modest | Medium; you need men holding shotguns toward the camera | Hard to find in the right poses; check each licence allows modification and redistribution inside a game. |
| **D. Keep the interim silhouettes** | Free | Stylised, not realistic | A legitimate noir look, but not what was asked for. |

Never use art taken from Buckshot Roulette or any other game.

## What the scene needs per character (2 characters per player view; 3 are defined so every seat is a distinct man)

Seat 0, 1 and 2 each always show the **same** man, so he is recognisable from match to match.
The viewer sees the other two seats, so you need three different men (only two appear on screen at once).

Provide these images per man, all with the **same canvas size, camera and framing** (the scene cross-fades between them):

| Pose | File name | Required | What it shows |
|---|---|---|---|
| Idle | `seatN-idle.webp` | yes | Seated behind the table, torso up, shotgun raised and pointed at the camera, face in dramatic top light. |
| Aiming at the other opponent | `seatN-aim-neighbor.webp` | recommended | Same man turned slightly, shotgun swung sideways toward the man on his **right** (the scene mirrors it for the man on the left). |
| Gun turned on himself | `seatN-aim-self.webp` | optional | Barrel under his chin / at his temple. Falls back to idle if missing. |
| Eyes closed | `seatN-blink.webp` | optional | Idle pose with eyes closed (a blink is shown for ~0.13 s every few seconds). |
| Eliminated | `seatN-dead.webp` | recommended | Slumped over the table, weapon lowered. Falls back to idle (dimmed and lowered by the scene) if missing. |

Technical specs:

- Canvas: **800 x 1200 px (2:3, portrait)**; the figure's waist is at the bottom edge (the table hides the lowest ~8 %).
- **Transparent background** (cut out) so the lamp, wall and table show behind them; or a black background if the
  image is lit and cropped to blend into darkness (then tell me and I will add a blend mode).
- Format: **WebP**, quality ~80, **under ~120 KB each**. (Render's free plan is fine with this: the whole
  game would add roughly 1.5 MB of images, loaded lazily.)
- Lighting: warm key light from above-centre (the lamp), low fill, faces partly in shadow, subtle red accent
  from one side (restrained). Grain and vignette are added by the scene, so don't bake them in heavily.
- Mood: tense, gritty, realistic; men in plain, worn clothing; no logos, no text, no copyrighted characters.

## Where the files go and how they are wired

1. Put the images in `apps/web/src/assets/cast/` (Vite hashes and bundles them).
2. Fill in `art` for each seat in `apps/web/src/scene/cast.ts`:

```ts
import s0Idle from "../assets/cast/seat0-idle.webp";
// ...
export const CAST: readonly CastMember[] = [
  {
    variant: 0, // interim silhouette used only when art is null
    art: {
      idle: s0Idle,
      aimNeighbor: s0Aim,   // optional
      blink: s0Blink,       // optional
      dead: s0Dead,         // optional
      width: 800, height: 1200,
      // Where the barrel's muzzle is, in % of the image (for the muzzle flash and smoke).
      muzzle: {
        player:   { x: 50, y: 62 },  // pointing at the camera
        neighbor: { x: 92, y: 60 },  // pointing sideways, for a man looking RIGHT (mirrored automatically)
        self:     { x: 50, y: 38 },  // under the chin
      },
    },
  },
  // seats 1 and 2 ...
];
```

3. Nothing else changes: breathing, head motion, recoil, flash, smoke, flinch, slump and the turn highlight are
   applied by CSS around whatever image is shown. Muzzle anchors are the only per-image tuning.

## Prompts (starting points for option A)

Generate **one reference portrait first**, approve it, then create the other poses of the *same man* from that
reference (use the model's reference-image / image-edit feature) so the face stays consistent.

Base prompt (edit the character description per seat):

> Photorealistic cinematic still, medium shot, a rough-looking man in his 40s seated at a wooden table in a dark
> room, aiming a pump-action shotgun directly at the camera, barrel pointing at the viewer, intense stare, face
> half in shadow, single warm overhead lamp, gritty film grain, shallow depth of field, muted colours with a
> restrained deep-red accent, realistic skin texture, worn dark clothing, no text, no logos, plain dark background.

Per-seat character descriptions (suggested, all distinct):

- **Seat 0:** wide-brimmed dark fedora, lean face, three-day stubble, long dark coat.
- **Seat 1:** bald, heavy build, thick grey-black beard, battered leather jacket.
- **Seat 2:** hooded, pale gaunt face, sunken eyes, hooded sweatshirt under a work jacket.

Pose variants (from the approved reference):

- *aim-neighbor:* "same man, turning his head and torso to his left, swinging the shotgun sideways to the left of frame, eyes on a target off-screen."
- *aim-self:* "same man, pressing the shotgun barrel under his own chin, eyes closed, tense."
- *blink:* "same image, eyes closed."
- *dead:* "same man slumped forward over the table, head down, shotgun lowered across the table, dim light."

## Licence record (fill in when art is added)

Keep this table up to date. Do not ship an image without a row.

| File | Source (tool / artist / URL) | Date | Licence / terms (link) | Commercial use OK? |
|---|---|---|---|---|
| *(none yet; interim silhouettes are original vector art made for this project)* | | | | |

## The photographed men in the 3D room (current)

The 3D room (`apps/web/src/scene3d/`) draws the two opponents from photographs, one cut-out per pose, in
`apps/web/src/assets/men/m{0,1,2}-{rest,forward,left,chin,hit,dead}.webp` (man 0 = the curly-haired bearded man,
1 = the bald man, 2 = the man with the cigar; a man is always the same seat). They were cut out of the supplied
pose sheets with a background-remover and aligned on one canvas per man (308 px wide, ~290 px high).

- `rest` is cropped from the first (seated, hands down) sheet; `forward` = gun pointed at the viewer; `left` = gun pointed
  sideways (the right-hand man's image is mirrored in code); `chin` = barrel under the chin; `hit`; `dead`.
- Muzzle positions and head/table lines are measured in pixels in `scene3d/PhotoMan.ts` (`MEN`).
- The images are only ~250 px wide, so they look soft on large screens. Sharper replacements can be dropped in
  at the same names and canvas proportions; update `MEN` if the pixel measurements change.
