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

export function preloadMen(): void {
  for (let m = 0; m < 3; m++) for (const p of ["rest", "forward", "aim", "chin", "hit", "dead"] as PhotoPose[]) texFor(m, p);
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
  show(pose: PhotoPose, flip = false): void {
    this.pose = pose;
    this.flip = flip;
    this.matA.map = texFor(this.man, pose);
    this.matA.needsUpdate = true;
    this.matA.opacity = 1;
    this.a.scale.x = flip ? -1 : 1;
    this.b.visible = false;
  }

  /** Cross-fades to another pose. */
  fadeTo(pose: PhotoPose, flip: boolean, dur: number, tweens: Tweens): Promise<void> {
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

