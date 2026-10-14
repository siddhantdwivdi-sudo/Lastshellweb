// One seated person built from primitives. Stage3D decides the pose; this file only turns that
// pose into bones: a two-bone arm solver and a head that looks at a point.

import * as THREE from "three";

export const TABLE_Y = 0.92;
const UPPER = 0.46;
const LOWER = 0.46;
const UP = new THREE.Vector3(0, 1, 0);

export type Mode = "idle" | "gun" | "dead";

// ---------------------------------------------------------------- primitive helpers

export function mat(color: number | string, rough = 0.85, metal = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

export function glow(color: number | string, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
}

export function box(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function cyl(parent: THREE.Object3D, r: number, h: number, x: number, y: number, z: number, m: THREE.Material, topR = r): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(topR, r, h, r > 0.5 ? 64 : 24, 1), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function ball(parent: THREE.Object3D, r: number, x: number, y: number, z: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 12), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Orientation whose -Z axis (the gun barrel / camera forward) points along `dir`. */
export function lookQuat(dir: THREE.Vector3): THREE.Quaternion {
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, UP);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

interface Limb {
  up: THREE.Mesh;
  low: THREE.Mesh;
  elbow: THREE.Mesh;
  hand: THREE.Mesh;
}

export class Person {
  readonly root = new THREE.Group();
  readonly torso = new THREE.Group();
  readonly head = new THREE.Group();
  /** Chair, legs and torso: hidden for the local player (you see the table through your own eyes). */
  readonly body = new THREE.Group();

  id = 0;
  mode: Mode = "idle";
  dead = false;
  hand_speed = 9;
  /** World-space hand goals while mode === "gun". */
  goal = [new THREE.Vector3(), new THREE.Vector3()];
  /** Torso-local override per hand (clutching a wound), or null. */
  custom: (THREE.Vector3 | null)[] = [null, null];
  lookTarget = new THREE.Vector3(0, 1, 0);
  lookOn = true;
  lean = 0;
  twist = 0;
  headPitch = 0;
  headYaw = 0;
  fear = 0;
  blink = 0;
  /** Per hand: draw the generic hand? (off while a gun-grip hand is drawn instead.) */
  showHands = [true, true];
  readonly skinHex: number;

  private eyes: THREE.Mesh[] = [];
  private limbs: Limb[] = [];
  private hands = [new THREE.Vector3(), new THREE.Vector3()];
  private t = Math.random() * 10;
  private hy = 0;
  private hp = 0;
  private first = true;

  constructor(world: THREE.Object3D, id: number, shirt: number, hair: number, skinTone: number) {
    this.id = id;
    this.skinHex = skinTone;
    const wood = mat(0x2a1a11, 0.6);
    const pants = mat(0x1a1a21, 0.9);
    const shirtM = mat(new THREE.Color(shirt).multiplyScalar(0.55).getHex(), 0.9);
    const skin = mat(skinTone, 0.7);
    const hairM = mat(hair, 0.9);
    const dark = mat(0x080808, 0.4);
    const white = mat(0xf2f2ea, 0.5);

    this.root.add(this.body);
    // chair
    box(this.body, 0.64, 0.07, 0.64, 0, 0.5, 0, wood);
    box(this.body, 0.64, 0.8, 0.07, 0, 0.92, -0.32, wood);
    for (const sx of [-0.28, 0.28]) for (const sz of [-0.28, 0.28]) box(this.body, 0.06, 0.5, 0.06, sx, 0.25, sz, wood);
    // legs
    for (const sx of [-0.14, 0.14]) {
      box(this.body, 0.18, 0.16, 0.5, sx, 0.62, 0.24, pants);
      box(this.body, 0.16, 0.54, 0.16, sx, 0.3, 0.5, pants);
      box(this.body, 0.17, 0.08, 0.3, sx, 0.04, 0.58, dark);
    }

    // torso, pivoting at the hips so a lean looks right
    this.torso.position.set(0, 0.6, 0);
    this.torso.rotation.order = "YXZ";
    this.body.add(this.torso);
    box(this.torso, 0.52, 0.72, 0.3, 0, 0.36, 0, shirtM);
    box(this.torso, 0.6, 0.12, 0.3, 0, 0.68, 0, shirtM);
    cyl(this.torso, 0.055, 0.12, 0, 0.78, 0, skin);

    this.head.position.set(0, 0.82, 0);
    this.head.rotation.order = "YXZ";
    this.torso.add(this.head);
    const skull = ball(this.head, 0.15, 0, 0.16, 0, skin);
    skull.scale.set(0.95, 1.12, 1.0);
    const cap = ball(this.head, 0.156, 0, 0.225, -0.03, hairM);
    cap.scale.set(1.0, 0.68, 1.0);
    box(this.head, 0.03, 0.04, 0.04, 0, 0.15, 0.15, skin);
    box(this.head, 0.07, 0.012, 0.01, 0, 0.085, 0.14, dark);
    for (const sx of [-0.058, 0.058]) {
      const e = ball(this.head, 0.024, sx, 0.19, 0.128, white);
      ball(e, 0.012, 0, 0, 0.018, dark);
      this.eyes.push(e);
      box(this.head, 0.05, 0.01, 0.01, sx, 0.23, 0.14, hairM);
    }

    // arms are unit-height cylinders the solver stretches between two points (they live in the world)
    for (let i = 0; i < 2; i++) {
      const up = cyl(world, 0.06, 1, 0, 0, 0, shirtM);
      const low = cyl(world, 0.052, 1, 0, 0, 0, skin);
      const elbow = ball(world, 0.062, 0, 0, 0, shirtM);
      const hand = ball(world, 0.07, 0, 0, 0, skin);
      this.limbs.push({ up, low, elbow, hand });
    }
  }

  setFirstPerson(on: boolean): void {
    this.body.visible = !on;
  }

  setLimbsVisible(on: boolean): void {
    for (const l of this.limbs) {
      l.up.visible = l.low.visible = l.elbow.visible = l.hand.visible = on;
    }
  }

  headWorld(): THREE.Vector3 {
    return this.head.localToWorld(new THREE.Vector3(0, 0.16, 0));
  }

  resetPose(): void {
    this.dead = false;
    this.mode = "idle";
    this.lean = this.twist = this.headPitch = this.headYaw = this.fear = this.blink = 0;
    this.lookOn = true;
    this.hand_speed = 9;
    this.custom = [null, null];
    this.showHands = [true, true];
    this.first = true;
  }

  /** Per-frame pose. Call after the root's transform is final. */
  animate(dt: number): void {
    this.t += dt;
    this.root.updateMatrixWorld(true);
    const aliveF = this.dead ? 0 : 1;
    const breath = Math.sin(this.t * 1.7 + this.id * 2) * 0.012 * aliveF;
    const j = this.fear * 0.006;
    this.torso.position.set((Math.random() - 0.5) * 2 * j, 0.6 + (Math.random() - 0.5) * 2 * j, (Math.random() - 0.5) * 2 * j);
    this.torso.rotation.set(this.lean + breath, this.twist, 0);
    this.torso.updateMatrixWorld(true);

    let wantY = this.headYaw;
    let wantP = this.headPitch;
    if (this.lookOn && !this.dead) {
      const l = this.torso.worldToLocal(this.lookTarget.clone()).sub(this.head.position);
      wantY += clamp(Math.atan2(l.x, l.z), -1.1, 1.1);
      wantP += clamp(Math.atan2(-l.y, Math.hypot(l.x, l.z)), -0.5, 0.6);
    }
    const k = 1 - Math.exp(-9 * dt);
    this.hy += (wantY - this.hy) * k;
    this.hp += (wantP - this.hp) * k;
    this.head.rotation.set(this.hp, this.hy, Math.sin(this.t * 0.6 + this.id) * 0.02 * aliveF);

    const open = 1 - this.blink * 0.92;
    const wide = 1 + this.fear * 0.45;
    for (const e of this.eyes) e.scale.set(wide, open * wide, wide);

    const sp = 1 - Math.exp(-this.hand_speed * dt);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1; // hand 0 = right hand; +X is the person's LEFT
      const shoulder = this.torso.localToWorld(new THREE.Vector3(side * 0.3, 0.62, 0));
      const g = new THREE.Vector3();
      if (this.custom[i]) g.copy(this.torso.localToWorld(this.custom[i]!.clone()));
      else if (this.mode === "gun") g.copy(this.goal[i]);
      else g.copy(this.root.localToWorld(new THREE.Vector3(side * (this.dead ? 0.4 : 0.26), TABLE_Y + 0.03 - this.root.position.y, 0.5)));
      if (this.first) this.hands[i].copy(g);
      else this.hands[i].lerp(g, sp);

      const pole = tmp.set(side * 0.6, -1, -0.5).applyQuaternion(this.torso.getWorldQuaternion(new THREE.Quaternion()));
      const [elbow, hand] = solve(shoulder, this.hands[i], pole);
      const l = this.limbs[i];
      place(l.up, shoulder, elbow);
      place(l.low, elbow, hand);
      l.elbow.position.copy(elbow);
      l.hand.position.copy(hand);
      l.hand.visible = this.showHands[i];
    }
    this.first = false;
  }
}

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

function solve(shoulder: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const to = target.clone().sub(shoulder);
  const raw = to.length();
  const dir = raw > 0.001 ? to.clone().divideScalar(raw) : new THREE.Vector3(0, 0, 1);
  const dist = clamp(raw, 0.12, (UPPER + LOWER) * 0.995);
  const a = (UPPER * UPPER - LOWER * LOWER + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(UPPER * UPPER - a * a, 0));
  const side = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (side.length() > 0.001) side.normalize();
  else side.copy(dir).cross(UP).normalize();
  const elbow = shoulder.clone().add(dir.clone().multiplyScalar(a)).add(side.multiplyScalar(h));
  const hand = shoulder.clone().add(dir.multiplyScalar(dist));
  return [elbow, hand];
}

function place(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
  const d = b.clone().sub(a);
  const len = Math.max(d.length(), 0.001);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
  mesh.scale.set(1, len, 1);
}
