// An opponent drawn from photographs: one cut-out image per pose, standing behind the table like a
// card. Poses are swapped with a short cross-fade, and the whole card can lean, kick and shake.
// All art is in assets/men (see docs/ART.md); nothing here decides an outcome.

import * as THREE from "three";
import type { Tweens } from "./tween";

export type PhotoPose = "rest" | "forward" | "aim" | "chin" | "hit" | "dead";

/** Pixel measurements of one man's images (all of his poses share one canvas). */
export interface ManCfg {
  w: number;
  h: number;
  /** x of the middle of his head, and y of the table line, in image pixels. */
  fx: number;
  tableY: number;
  headY: number;
  /** Where the barrel ends, in image pixels (for the pose as drawn, before any mirroring). */
  muzzle: { forward: [number, number]; aim: [number, number]; chin: [number, number] };
}

export const MEN: readonly ManCfg[] = [
  { w: 308, h: 294, fx: 125, tableY: 254, headY: 76, muzzle: { forward: [92, 157], aim: [292, 150], chin: [133, 106] } },
  { w: 308, h: 281, fx: 125, tableY: 243, headY: 69, muzzle: { forward: [93, 135], aim: [292, 131], chin: [145, 95] } },
  { w: 308, h: 298, fx: 135, tableY: 258, headY: 80, muzzle: { forward: [103, 125], aim: [292, 118], chin: [140, 82] } },
];

/** Metres per image pixel: a man's shoulders come out about 0.65 m wide. */
const PX = 0.0044;

const FILES = import.meta.glob("../assets/men/*.webp", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const cache = new Map<string, THREE.Texture>();

function fileFor(pose: PhotoPose): PhotoPose | "left" {
  return pose === "aim" ? "left" : pose;
}

/** Motion strips (6 in-between frames side by side) that exist, by "from>to" in file names. */
const SEQ_FRAMES = 6;
const SEQS = new Set(["rest>forward", "rest>left", "rest>chin", "rest>hit", "forward>hit", "left>hit", "chin>hit", "hit>dead", "hit>rest"]);
const strips = new Map<string, THREE.Texture>();
const frameCache = new Map<string, THREE.Texture>();

function stripFor(man: number, a: string, b: string): THREE.Texture | null {
  if (!SEQS.has(`${a}>${b}`)) return null;
  const key = `s${man}-${a}-${b}`;
  let t = strips.get(key);
  if (!t) {
    t = new THREE.TextureLoader().load(FILES[`../assets/men/${key}.webp`]);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    strips.set(key, t);
  }
  return t;
}

/** One frame of a strip, as its own texture (they share the image, only the UV window differs). */
function stripFrame(man: number, a: string, b: string, i: number): THREE.Texture | null {
  const base = stripFor(man, a, b);
  if (!base) return null;
  const key = `s${man}-${a}-${b}-${i}`;
  let t = frameCache.get(key);
  if (!t) {
    t = base.clone();
    t.repeat.set(1 / SEQ_FRAMES, 1);
    t.offset.set(i / SEQ_FRAMES, 0);
    t.needsUpdate = true;
    frameCache.set(key, t);
  }
  return t;
}

export function preloadMen(): void {
  for (let m = 0; m < 3; m++) {
    for (const p of ["rest", "forward", "aim", "chin", "hit", "dead"] as PhotoPose[]) texFor(m, p);
    for (const k of SEQS) stripFor(m, k.split(">")[0], k.split(">")[1]);
  }
}

function texFor(man: number, pose: PhotoPose): THREE.Texture {
  const key = `m${man}-${fileFor(pose)}`;
  let t = cache.get(key);
  if (!t) {
    t = new THREE.TextureLoader().load(FILES[`../assets/men/${key}.webp`]);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    cache.set(key, t);
  }
  return t;
}

export class PhotoMan {
  /** Placed on the table's far rim, turned toward the camera. */
  readonly root = new THREE.Group();
  /** Animated part: leans, kicks and shakes. */
  readonly body = new THREE.Group();
  man = 0;
  pose: PhotoPose = "rest";
  flip = false;
  /** The right-hand man is always drawn mirrored, so he aims toward the left of the picture. */
  mirror = false;
  dead = false;
  /** Offsets the stage tweens (metres) and a small roll (radians). */
  offset = new THREE.Vector3();
  roll = 0;
  squash = 0;
  fear = 0;
  tint = 0.8;

  private readonly a: THREE.Mesh;
  private readonly b: THREE.Mesh;
  private readonly matA: THREE.MeshBasicMaterial;
  private readonly matB: THREE.MeshBasicMaterial;
  private fading = false;
  private t = Math.random() * 10;

  constructor(man: number) {
    const mk = () => new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, fog: false });
    this.matA = mk();
    this.matB = mk();
    this.a = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.matA);
    this.b = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.matB);
    this.a.renderOrder = 2;
    this.b.renderOrder = 3;
    this.body.add(this.a, this.b);
    this.root.add(this.body);
    this.setMan(man);
  }

  get cfg(): ManCfg {
    return MEN[this.man];
  }

  setMan(man: number): void {
    this.man = man;
    const c = MEN[man];
    // origin of both cards = (head centre x, table line): flipping then mirrors around his body
    for (const m of [this.a, this.b]) {
      m.geometry.dispose();
      const g = new THREE.PlaneGeometry(c.w * PX, c.h * PX);
      g.translate((c.w / 2 - c.fx) * PX, (c.tableY - c.h / 2) * PX, 0);
      m.geometry = g;
    }
    this.show(this.pose, this.flip);
  }

  /** Immediately shows a pose. */
  show(pose: PhotoPose, _flip = false): void {
    const flip = this.mirror;
    this.pose = pose;
    this.flip = flip;
    this.matA.map = texFor(this.man, pose);
    this.matA.needsUpdate = true;
    this.matA.opacity = 1;
    this.a.scale.x = flip ? -1 : 1;
    this.b.visible = false;
  }

  /** Cross-fades to another pose. */
  fadeTo(pose: PhotoPose, _flip: boolean, dur: number, tweens: Tweens): Promise<void> {
    const flip = this.mirror;
    if (pose === this.pose && flip === this.flip) return Promise.resolve();
    this.pose = pose;
    this.flip = flip;
    this.matB.map = texFor(this.man, pose);
    this.matB.needsUpdate = true;
    this.matB.opacity = 0;
    this.b.scale.x = flip ? -1 : 1;
    this.b.visible = true;
    this.fading = true;
    return tweens
      .run(dur, (k) => (this.matB.opacity = k))
      .then(() => {
        this.matA.map = this.matB.map;
        this.matA.needsUpdate = true;
        this.a.scale.x = this.b.scale.x;
        this.matA.opacity = 1;
        this.b.visible = false;
        this.fading = false;
      });
  }

  /** Poses (as picture file names) that a motion strip can go between; 'aim' is drawn from the 'left' pictures. */
  hasMotion(to: PhotoPose): boolean {
    const a = fileFor(this.pose);
    const b = fileFor(to);
    return SEQS.has(`${a}>${b}`) || SEQS.has(`${b}>${a}`);
  }

  /**
   * Plays real in-between frames from the current pose to another (or backwards along a strip that goes the
   * other way). Falls back to a cross-fade when there is no strip for that pair.
   */
  play(to: PhotoPose, _flip: boolean, dur: number, tweens: Tweens): Promise<void> {
    const flip = this.mirror;
    const from = this.pose;
    const a = fileFor(from);
    const b = fileFor(to);
    let list: THREE.Texture[] | null = null;
    const fwd = SEQS.has(`${a}>${b}`);
    const back = SEQS.has(`${b}>${a}`);
    if (fwd || back) {
      const mid: THREE.Texture[] = [];
      for (let i = 0; i < SEQ_FRAMES; i++) {
        const t = fwd ? stripFrame(this.man, a, b, i) : stripFrame(this.man, b, a, SEQ_FRAMES - 1 - i);
        if (t) mid.push(t);
      }
      if (mid.length === SEQ_FRAMES) list = [texFor(this.man, from), ...mid, texFor(this.man, to)];
    }
    if (!list) return this.fadeTo(to, flip, Math.min(dur, 0.25), tweens);

    this.pose = to;
    const startFlip = this.flip;
    this.flip = flip;
    const n = list.length - 1;
    this.b.visible = true;
    this.fading = true;
    let shown = -1;
    return tweens
      .run(
        dur,
        (k) => {
          const p = k * n;
          const i = Math.min(n - 1, Math.floor(p));
          const frac = p - i;
          if (i !== shown) {
            shown = i;
            this.matA.map = list![i];
            this.matB.map = list![i + 1];
            this.matA.needsUpdate = true;
            this.matB.needsUpdate = true;
            this.a.scale.x = startFlip ? -1 : 1;
            this.b.scale.x = flip ? -1 : 1;
          }
          this.matA.opacity = 1;
          this.matB.opacity = frac;
        },
        (t) => t,
      )
      .then(() => {
        this.matA.map = list![n];
        this.matA.needsUpdate = true;
        this.matA.opacity = 1;
        this.a.scale.x = flip ? -1 : 1;
        this.b.visible = false;
        this.fading = false;
      });
  }

  /** Per frame. */
  update(dt: number): void {
    this.t += dt;
    const breathe = this.dead ? 0 : Math.sin(this.t * 1.6 + this.man) * 0.004;
    const j = this.fear * 0.006;
    this.body.position.set(
      this.offset.x + (Math.random() - 0.5) * 2 * j,
      this.offset.y + breathe + (Math.random() - 0.5) * 2 * j,
      this.offset.z,
    );
    this.body.rotation.z = this.roll + (this.dead ? 0 : Math.sin(this.t * 0.7 + this.man * 2) * 0.004);
    this.body.scale.set(1 - this.squash * 0.5, 1 - this.squash, 1);
    const c = this.tint;
    this.matA.color.setRGB(c, c * 0.97, c * 0.94);
    this.matB.color.copy(this.matA.color);
    void this.fading;
  }

  /** A point in the current picture (pixels, as drawn) as a world position. */
  private px(x: number, y: number): THREE.Vector3 {
    const c = this.cfg;
    const sx = this.flip ? -1 : 1;
    this.root.updateMatrixWorld(true);
    return this.body.localToWorld(new THREE.Vector3(sx * (x - c.fx) * PX, (c.tableY - y) * PX, 0.02));
  }

  muzzleWorld(): THREE.Vector3 {
    const m = this.cfg.muzzle;
    const p = this.pose === "forward" ? m.forward : this.pose === "chin" ? m.chin : m.aim;
    return this.px(p[0], p[1]);
  }

  headWorld(): THREE.Vector3 {
    return this.px(this.cfg.fx, this.cfg.headY);
  }

  torsoWorld(): THREE.Vector3 {
    return this.px(this.cfg.fx, this.cfg.tableY - 60);
  }

  /** Where the table line meets his seat (the waist): used for the gun sliding over. */
  seatWorld(): THREE.Vector3 {
    return this.px(this.cfg.fx, this.cfg.tableY);
  }
}

