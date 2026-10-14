// The 3D room: a round table, three seated people and ONE shotgun lying in the middle.
// It never decides an outcome. The server already told the client what happened (shotFired,
// then shotResolved); this file only plays it: the shooter lifts the gun and aims (startShot),
// and the trigger reveals blank / live / lethal (resolveShot).
//
// Seats are drawn from the local player's point of view: slot 0 is YOU (the camera is your
// head, only your arms and the gun are visible), slot 1 is the left opponent, slot 2 the right.

import * as THREE from "three";
import { box, cyl, glow, lookQuat, mat, Person, TABLE_Y } from "./Person3D";
import { Tweens, ease } from "./tween";

export const PLAYER_HEX = [0xffa838, 0x66d1eb, 0xd185f2];
const HAIR = [0x1a120d, 0x8c6633, 0x0d0d0f];
const SKIN = [0xd9a684, 0x9e6e52, 0xedc2a3];
const SEAT_R = 1.3;
const SLOT_DIRS = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(-0.866, 0, -0.5), new THREE.Vector3(0.866, 0, -0.5)];
const REST_CAM = new THREE.Vector3(0, 2.15, 2.95);
const REST_LOOK = new THREE.Vector3(0, 1.0, -0.4);
const REST_FOV = 54;
const GUN_REST_Y = 0.99;
const MUZZLE = new THREE.Vector3(0, 0.03, -0.62);

/** How long each server event is held on screen (see EVENT_DURATION_MS in the shared package). */
export const SHOT_FIRED_SECONDS = 2.4;

interface Puff {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  max: number;
  grow: number;
  gravity: number;
  baseOpacity: number;
}

interface ShellObj {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  landed: boolean;
  age: number;
}

interface ActiveShot {
  s: Person;
  t: Person;
  sIdx: number;
  tIdx: number;
  self: boolean;
  aimDir: THREE.Vector3;
  targetHead: THREE.Vector3;
}

export class Stage3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(REST_FOV, 16 / 9, 0.05, 40);
  private readonly tweens = new Tweens();
  private readonly people: Person[] = [];
  private readonly gun = new THREE.Group();
  private readonly gunModel = new THREE.Group();
  private readonly pump = new THREE.Group();
  private readonly barrelMat = mat(0x8a8d94, 0.28, 0.85);
  private readonly flashMesh: THREE.Mesh;
  private readonly flashLight = new THREE.PointLight(0xffbf66, 0, 6, 2);
  private readonly turnLight = new THREE.PointLight(0xffffff, 5, 3, 2);
  private readonly dust: THREE.Points;
  private readonly puffs: Puff[] = [];
  private readonly shells: ShellObj[] = [];
  private readonly puffGeo = new THREE.SphereGeometry(1, 6, 4);

  private slotOfSeat = [0, 1, 2];
  private restCam = REST_CAM.clone();
  private camPos = REST_CAM.clone();
  private camLook = REST_LOOK.clone();
  fov = REST_FOV;
  private shake = 0;
  private clock = 0;
  private timeScale = 1;
  private raf = 0;
  private last = 0;
  private disposed = false;
  private aiming = false;
  private holder = -1;
  private holdPos = new THREE.Vector3();
  private shot: ActiveShot | null = null;
  private chain: Promise<void> = Promise.resolve();
  private slowmoTimer: ReturnType<typeof setTimeout> | null = null;
  /** 0..1: how far the local player's own view has "died" (camera slumps, goes dark). */
  deathFade = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene.background = new THREE.Color(0x050304);
    this.scene.fog = new THREE.FogExp2(0x0c0606, 0.04);

    this.buildRoom();
    this.buildTable();
    this.buildGun();
    for (let i = 0; i < 3; i++) {
      const p = new Person(this.scene, i, PLAYER_HEX[i], HAIR[i], SKIN[i]);
      p.root.position.copy(SLOT_DIRS[i]).multiplyScalar(SEAT_R);
      p.root.rotation.y = Math.atan2(-SLOT_DIRS[i].x, -SLOT_DIRS[i].z);
      this.scene.add(p.root);
      this.people.push(p);
    }
    this.people[0].setFirstPerson(true);

    this.flashMesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), glow(0xffcc59));
    this.flashMesh.position.copy(MUZZLE).add(new THREE.Vector3(0, 0, -0.1));
    this.flashMesh.scale.set(1, 1, 2.2);
    this.flashMesh.visible = false;
    this.gunModel.add(this.flashMesh);
    this.flashLight.position.copy(MUZZLE).add(new THREE.Vector3(0, 0, -0.2));
    this.gunModel.add(this.flashLight);
    this.scene.add(this.turnLight);

    const n = 70;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 4.4;
      pos[i * 3 + 1] = 0.4 + Math.random() * 2.8;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4.4;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xffe6b3, size: 0.014, transparent: true, opacity: 0.45, depthWrite: false }));
    this.scene.add(this.dust);

    this.reset();
  }

  // ================================================================== lifecycle

  start(): void {
    this.last = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.slowmoTimer) clearTimeout(this.slowmoTimer);
    this.tweens.clear();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mm = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
      else mm?.dispose();
    });
    this.renderer.dispose();
  }

  /** `hudPx` is how much of the bottom the HUD covers: the picture is shifted so the table is centred above it. */
  resize(w: number, h: number, dpr: number, hudPx = 0): void {
    this.renderer.setPixelRatio(Math.min(dpr, 2));
    this.renderer.setSize(w, h, false);
    const aspect = w / Math.max(1, h);
    this.camera.aspect = aspect;
    // narrow screens (phones held upright): pull the camera back so both opponents stay in frame
    const scale = Math.min(1.9, Math.max(1, Math.pow(1.7 / aspect, 0.55)));
    this.restCam.copy(REST_LOOK).addScaledVector(REST_CAM.clone().sub(REST_LOOK), scale);
    if (this.holder < 0 && !this.shot && !this.people[0].dead) this.camPos.copy(this.restCam);
    this.camera.setViewOffset(w, h, 0, Math.round(hudPx * 0.5), w, h);
    this.camera.updateProjectionMatrix();
  }

  private frame(dt: number): void {
    const sdt = dt * this.timeScale;
    this.clock += sdt;
    this.tweens.step(sdt);

    if (this.aiming && this.holder >= 0) {
      const sway = Math.sin(this.clock * 3.1) * 0.0025;
      this.gun.position.set(this.holdPos.x + sway, this.holdPos.y + Math.sin(this.clock * 2.3) * 0.002, this.holdPos.z);
    }
    this.gun.updateMatrixWorld(true);
    if (this.holder >= 0) {
      const p = this.people[this.holder];
      p.goal[0].copy(this.gunModel.localToWorld(new THREE.Vector3(0, -0.1, 0.17)));
      p.goal[1].copy(this.pump.localToWorld(new THREE.Vector3(0, -0.045, 0)));
    }
    for (const p of this.people) p.animate(sdt);
    this.updatePuffs(sdt);
    this.updateShells(sdt);

    // dust drifts slowly
    const arr = (this.dust.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] += sdt * 0.03;
      arr[i] += Math.sin(this.clock * 0.3 + i) * sdt * 0.01;
      if (arr[i + 1] > 3.4) arr[i + 1] = 0.4;
    }
    (this.dust.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;

    // camera = the local player's eyes: slow drift, shake, zoom
    this.shake = Math.max(0, this.shake - dt * 0.6);
    const j = this.shake;
    const rj = () => (Math.random() - 0.5) * 2 * j;
    this.camera.position.set(
      this.camPos.x + Math.sin(this.clock * 0.35) * 0.04 + rj(),
      this.camPos.y + Math.sin(this.clock * 0.27) * 0.025 + rj(),
      this.camPos.z + rj(),
    );
    this.camera.lookAt(this.camLook.x + rj() * 0.3, this.camLook.y + rj() * 0.3, this.camLook.z);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  }

  // ================================================================== world

  private buildRoom(): void {
    const concrete = mat(0x1a1616, 0.95);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(16, 0.1, 16), mat(0x141010, 0.7));
    floor.position.y = -0.05;
    floor.receiveShadow = true;
    this.scene.add(floor);
    box(this.scene, 16, 6, 0.3, 0, 3, -5.2, concrete);
    box(this.scene, 0.3, 6, 16, -6, 3, 0, concrete);
    box(this.scene, 0.3, 6, 16, 6, 3, 0, concrete);
    const steel = mat(0x35373b, 0.5, 0.6);
    for (const x of [-4, -2, 0, 2, 4]) box(this.scene, 0.22, 5, 0.22, x, 2.5, -5, steel);
    box(this.scene, 14, 0.14, 0.14, 0, 3.6, -4.95, steel);

    // the lamp
    cyl(this.scene, 0.012, 1.4, 0, 4.3, 0, steel);
    cyl(this.scene, 0.38, 0.28, 0, 3.55, 0, mat(0x0d0d0d, 0.5, 0.4), 0.09);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), glow(0xffdb99));
    bulb.position.set(0, 3.42, 0);
    this.scene.add(bulb);

    const spot = new THREE.SpotLight(0xffcc8c, 95, 9, THREE.MathUtils.degToRad(52), 0.55, 1.6);
    spot.position.set(0, 3.4, 0);
    spot.target.position.set(0, 0, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0004;
    this.scene.add(spot, spot.target);

    this.scene.add(new THREE.HemisphereLight(0x8a6f78, 0x1a0f0f, 0.9));
    const fill = new THREE.PointLight(0xb87373, 14, 12, 2);
    fill.position.set(0, 2.4, 3.6);
    this.scene.add(fill);
    const rim = new THREE.PointLight(0x8c241c, 18, 10, 2);
    rim.position.set(0, 2.2, -3.6);
    this.scene.add(rim);
  }

  private buildTable(): void {
    const wood = mat(0x35190d, 0.45);
    const felt = mat(0x0d2a1a, 1);
    cyl(this.scene, 1.08, 0.1, 0, TABLE_Y - 0.05, 0, wood);
    cyl(this.scene, 0.95, 0.012, 0, TABLE_Y + 0.004, 0, felt);
    cyl(this.scene, 0.22, TABLE_Y - 0.1, 0, (TABLE_Y - 0.1) / 2, 0, wood);
    cyl(this.scene, 0.62, 0.06, 0, 0.03, 0, wood);
  }

  private buildGun(): void {
    this.scene.add(this.gun);
    this.gun.add(this.gunModel);
    const wood = mat(0x572b14, 0.5);
    const dark = mat(0x1a1a1f, 0.4, 0.5);
    box(this.gunModel, 0.07, 0.09, 0.26, 0, 0, 0, dark); // receiver
    const barrel = cyl(this.gunModel, 0.019, 0.5, 0, 0.03, -0.37, this.barrelMat);
    barrel.rotation.x = Math.PI / 2;
    const tube = cyl(this.gunModel, 0.016, 0.42, 0, -0.028, -0.33, dark);
    tube.rotation.x = Math.PI / 2;
    const stock = box(this.gunModel, 0.06, 0.1, 0.34, 0, -0.025, 0.28, wood);
    stock.rotation.x = THREE.MathUtils.degToRad(4);
    box(this.gunModel, 0.05, 0.1, 0.05, 0, -0.085, 0.1, wood); // grip
    this.pump.position.set(0, -0.05, -0.28);
    this.gunModel.add(this.pump);
    box(this.pump, 0.075, 0.06, 0.2, 0, 0, 0, wood);
    this.barrelMat.emissive = new THREE.Color(0xff7319);
    this.barrelMat.emissiveIntensity = 0;
  }

  // ================================================================== helpers

  private slot(seat: number): number {
    return this.slotOfSeat[seat] ?? 0;
  }

  /** World position of a person's head; for the local player that is the camera. */
  private headOf(idx: number): THREE.Vector3 {
    return idx === 0 ? this.restCam.clone() : this.people[idx].headWorld();
  }

  private restXform(yaw: number): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    return { pos: new THREE.Vector3(0, GUN_REST_Y, 0), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)) };
  }

  private moveGun(pos: THREE.Vector3, quat: THREE.Quaternion, dur: number, lift = 0.12): Promise<void> {
    const p0 = this.gun.position.clone();
    const q0 = this.gun.quaternion.clone();
    return this.tweens.run(dur, (k) => {
      this.gun.position.lerpVectors(p0, pos, k);
      this.gun.position.y += Math.sin(k * Math.PI) * lift;
      this.gun.quaternion.slerpQuaternions(q0, quat, k);
    });
  }

  private holdPose(s: Person, targetHead: THREE.Vector3, self: boolean): { pos: THREE.Vector3; quat: THREE.Quaternion; dir: THREE.Vector3 } {
    s.root.updateMatrixWorld(true);
    if (self) {
      const head = s.headWorld();
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(s.root.quaternion);
      const from = head.clone().addScaledVector(fwd, 0.83).add(new THREE.Vector3(0, -0.06, 0));
      const dir = head.clone().sub(from).normalize();
      return { pos: from, quat: lookQuat(dir), dir };
    }
    const chest = s.root.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    const dirh = new THREE.Vector3(targetHead.x - chest.x, 0, targetHead.z - chest.z).normalize();
    const from = chest.clone().addScaledVector(dirh, 0.5).add(new THREE.Vector3(0, 0.14, 0));
    const dir = targetHead.clone().sub(from).normalize();
    return { pos: from, quat: lookQuat(dir), dir };
  }

  private yawTo(p: Person, world: THREE.Vector3): number {
    const l = p.root.worldToLocal(world.clone());
    return Math.max(-1.2, Math.min(1.2, Math.atan2(l.x, l.z)));
  }

  // ================================================================== public API

  /** Back to a fresh table (new match / first sync). */
  reset(): void {
    this.tweens.clear();
    this.chain = Promise.resolve();
    if (this.slowmoTimer) clearTimeout(this.slowmoTimer);
    this.timeScale = 1;
    this.holder = -1;
    this.aiming = false;
    this.shot = null;
    this.shake = 0;
    this.deathFade = 0;
    this.camPos.copy(this.restCam);
    this.camLook.copy(REST_LOOK);
    this.fov = REST_FOV;
    const r = this.restXform(0.5);
    this.gun.position.copy(r.pos);
    this.gun.quaternion.copy(r.quat);
    this.gunModel.position.set(0, 0, 0);
    this.gunModel.rotation.set(0, 0, 0);
    this.pump.position.set(0, -0.05, -0.28);
    this.flashMesh.visible = false;
    this.flashLight.intensity = 0;
    for (const p of this.people) {
      p.resetPose();
      p.lookTarget.set(0, 1, 0);
    }
    this.people[0].setLimbsVisible(false);
  }

  /** Seats are fixed for the whole match: which slot each seat sits in, from my point of view. */
  configure(you: number): void {
    const out = [0, 0, 0];
    for (let seat = 0; seat < 3; seat++) out[seat] = seat === you ? 0 : seat === (you + 1) % 3 ? 1 : 2;
    this.slotOfSeat = out;
    // opponents wear their seat's colour
    // (people were created per slot; colours follow the slot order, which is stable for a viewer)
  }

  /** Follows the public game state (who is alive, whose turn, the saw). Never starts an animation. */
  sync(alive: boolean[], hp: number[], current: number, awaiting: boolean, sawed: boolean): void {
    for (let seat = 0; seat < 3; seat++) {
      const idx = this.slot(seat);
      const p = this.people[idx];
      if (!alive[seat] && !p.dead) this.slumpNow(idx);
      else if (alive[seat] && hp[seat] > 0 && p.dead) p.resetPose();
    }
    const cur = this.slot(current);
    const show = awaiting && alive[current] && cur !== 0;
    this.turnLight.visible = show;
    if (show) {
      this.turnLight.color.setHex(PLAYER_HEX[cur]);
      this.turnLight.position.copy(this.people[cur].root.position).add(new THREE.Vector3(0, 2.0, 0)).addScaledVector(SLOT_DIRS[cur], -0.15);
    }
    this.barrelMat.emissiveIntensity = sawed ? 1.2 : 0;
  }

  private slumpNow(idx: number): void {
    const p = this.people[idx];
    p.dead = true;
    p.mode = "dead";
    p.lookOn = false;
    p.lean = 1.15;
    p.headPitch = 0.55;
    p.headYaw = 0.35;
    p.fear = 0;
    if (idx === 0) this.setYouDead();
  }

  private setYouDead(): void {
    this.camPos.set(0, 1.12, 1.35);
    this.camLook.set(0, 0.7, -0.3);
    this.deathFade = 1;
    this.people[0].setLimbsVisible(false);
  }

  /** Serialises animations: a new one always waits for the previous to finish. */
  private enqueue(fn: () => Promise<void>): Promise<void> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  startShot(shooterSeat: number, targetSeat: number, fast = false): Promise<void> {
    return this.enqueue(() => this.doStartShot(shooterSeat, targetSeat, fast));
  }

  resolveShot(shooterSeat: number, targetSeat: number, live: boolean, lethal: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (!this.shot) await this.doStartShot(shooterSeat, targetSeat, true);
      await this.doResolve(live, lethal);
      await this.doFinish(live);
    });
  }

  hurtSeat(seat: number): void {
    const p = this.people[this.slot(seat)];
    if (p.dead) return;
    if (this.slot(seat) === 0) this.shake = Math.max(this.shake, 0.1);
    else this.hurt(p, new THREE.Vector3((Math.random() < 0.5 ? 1 : -1) * 0.28, 0.5, 0.1), 1);
  }

  killSeat(seat: number): void {
    const idx = this.slot(seat);
    const p = this.people[idx];
    if (p.dead) return;
    p.dead = true;
    p.lookOn = false;
    p.mode = "dead";
    if (idx === 0) {
      void this.youDie();
      return;
    }
    void this.tweens.prop(p, "fear", 0, 0.3);
    void this.tweens.prop(p, "lean", 1.1, 1.1, ease.in);
    void this.tweens.prop(p, "headPitch", 0.5, 1.1);
  }

  ejectShell(live: boolean): void {
    this.spawnShell(live);
  }

  // ================================================================== shot choreography

  private async doStartShot(shooterSeat: number, targetSeat: number, fast: boolean): Promise<void> {
    const f = fast ? 0.25 : 1;
    const sIdx = this.slot(shooterSeat);
    const tIdx = this.slot(targetSeat);
    const s = this.people[sIdx];
    const t = this.people[tIdx];
    const self = sIdx === tIdx;
    this.holder = sIdx;

    // 1. lean in and reach for the gun
    for (const p of this.people) {
      p.lookTarget.copy(this.gun.position).add(new THREE.Vector3(0, 0.1, 0));
      p.lookOn = !p.dead;
    }
    s.mode = "gun";
    s.hand_speed = 9;
    if (sIdx === 0) s.setLimbsVisible(true);
    await this.tweens.prop(s, "lean", 0.42, 0.45 * f, ease.out);

    // 2. lift it and bring it up to aim
    s.hand_speed = 34;
    const targetHead = this.headOf(tIdx);
    const hold = this.holdPose(s, targetHead, self);
    this.holdPos.copy(hold.pos);
    const aimDir = hold.dir.clone();
    const lifts: Promise<unknown>[] = [
      this.moveGun(hold.pos, hold.quat, 0.75 * f),
      this.tweens.prop(s, "lean", 0.1, 0.7 * f),
    ];
    if (!self && sIdx !== 0) lifts.push(this.tweens.prop(s, "twist", this.yawTo(s, targetHead) * 0.55, 0.7 * f));
    for (const p of this.people) if (p !== s) p.lookTarget.copy(hold.pos);
    s.lookTarget.copy(targetHead);
    await Promise.all(lifts);
    this.aiming = true;
    this.shot = { s, t, sIdx, tIdx, self, aimDir, targetHead };

    // 3. tension: nobody moves, the camera creeps toward the muzzle and the victim
    const look = tIdx === 0 ? REST_LOOK.clone().lerp(hold.pos, 0.35) : hold.pos.clone().lerp(targetHead, 0.7);
    const toPos = this.restCam.clone().add(new THREE.Vector3(0, -0.12, -0.3));
    void this.blend(this.camPos, toPos, 1.4 * f);
    void this.blend(this.camLook, look, 1.4 * f);
    void this.tweens.prop(this, "fov", tIdx === 0 ? 47 : 40, 1.4 * f);
    void this.tweens.prop(t, "fear", 1, 0.8 * f);
    for (const p of this.people) if (p !== s && p !== t) void this.tweens.prop(p, "fear", 0.35, 0.8 * f);
    t.lookTarget.copy(hold.pos).addScaledVector(aimDir, 0.5);
    await this.tweens.wait(1.2 * f);
  }

  private async doResolve(live: boolean, lethal: boolean): Promise<void> {
    const sh = this.shot!;
    const { s, t, tIdx, aimDir, targetHead } = sh;
    this.aiming = false;
    if (!live) {
      // the hammer falls on nothing: a twitch, a flinch, then relief
      void this.tweens.run(0.14, (k) => (this.gunModel.rotation.x = Math.sin(k * Math.PI) * 0.03), ease.linear);
      void this.tweens.prop(t, "blink", 1, 0.06);
      void this.tweens.prop(t, "lean", t.lean - 0.12, 0.08);
      await this.tweens.wait(0.45);
      void this.tweens.prop(t, "blink", 0, 0.35);
      void this.tweens.prop(t, "lean", 0, 0.5);
      void this.tweens.prop(t, "fear", 0, 0.8);
      await this.tweens.wait(0.5);
      return;
    }
    const from = this.muzzleWorld();
    this.muzzleFx();
    if (lethal) {
      this.slowmo(0.18, 1100);
      this.tracer(from, targetHead);
      t.dead = true;
      await this.tweens.wait(0.1);
      this.burst(targetHead, aimDir, 40, 0xa60505, 0.014, 0.7, 2.6, -5);
      this.shake = Math.max(this.shake, 0.12);
      if (tIdx === 0) {
        await this.youDie();
        return;
      }
      t.lookOn = false;
      t.mode = "dead";
      t.blink = 0;
      void this.tweens.prop(t, "headPitch", -0.85, 0.12);
      void this.tweens.prop(t, "lean", -0.4, 0.14);
      void this.tweens.prop(t, "fear", 0, 0.2);
      await this.tweens.wait(0.55);
      void this.tweens.prop(t, "lean", 1.15, 1.0, ease.in);
      void this.tweens.prop(t, "headPitch", 0.55, 1.0);
      void this.tweens.prop(t, "headYaw", 0.35, 1.0);
      await this.tweens.wait(1.05);
      return;
    }
    // a live shell that does not kill: it clips the shoulder
    this.slowmo(0.4, 600);
    const local = t.root.worldToLocal(s.root.position.clone());
    const side = local.x >= 0 ? 1 : -1;
    const wound = new THREE.Vector3(side * 0.3, 0.52, 0.08);
    const woundWorld = t.torso.localToWorld(wound.clone());
    this.tracer(from, tIdx === 0 ? this.camPos.clone().add(new THREE.Vector3(0.12, -0.1, 0)) : woundWorld);
    await this.tweens.wait(0.1);
    this.burst(woundWorld, aimDir, 16, 0xa60505, 0.014, 0.7, 2.2, -5);
    this.shake = Math.max(this.shake, 0.1);
    if (tIdx !== 0) this.hurt(t, wound, side);
    await this.tweens.wait(1.0);
  }

  private async doFinish(live: boolean): Promise<void> {
    const sh = this.shot;
    if (!sh) return;
    const { s } = sh;
    this.aiming = false;
    // work the pump, the shell flies out
    await this.tweens.run(0.16, (k) => (this.pump.position.z = -0.28 + 0.18 * k), ease.out);
    this.spawnShell(live);
    await this.tweens.run(0.16, (k) => (this.pump.position.z = -0.1 - 0.18 * k), ease.linear);
    // camera back to the resting view, gun back to the table
    if (!this.people[0].dead) {
      void this.blend(this.camPos, this.restCam, 1.0);
      void this.blend(this.camLook, REST_LOOK, 1.0);
      void this.tweens.prop(this, "fov", REST_FOV, 1.0);
    }
    const rest = this.restXform(Math.random() * 1.6 - 0.8 + (Math.random() < 0.5 ? Math.PI : 0));
    await this.moveGun(rest.pos, rest.quat, 0.7, 0.2);
    this.holder = -1;
    for (const p of this.people) {
      p.mode = p.dead ? "dead" : "idle";
      p.lookTarget.set(0, 1, 0);
      p.lookOn = !p.dead;
      p.hand_speed = 9;
    }
    void this.tweens.prop(s, "twist", 0, 0.6);
    if (sh.sIdx === 0) s.setLimbsVisible(false);
    if (!s.dead) void this.tweens.prop(s, "lean", 0, 0.6);
    for (const p of this.people) if (!p.dead) void this.tweens.prop(p, "fear", 0, 0.6);
    this.shot = null;
  }

  private hurt(t: Person, wound: THREE.Vector3, side: number): void {
    const handIdx = side > 0 ? 0 : 1; // the opposite hand covers the wound
    void this.tweens.prop(t, "lean", -0.45, 0.1);
    void this.tweens.prop(t, "fear", 1, 0.1);
    void this.tweens.prop(t, "headPitch", 0.25, 0.3);
    t.custom[handIdx] = wound;
    t.hand_speed = 20;
    void this.tweens.wait(0.1).then(() => this.tweens.prop(t, "lean", 0.28, 0.6, ease.out));
    void this.tweens.wait(1.7).then(() => {
      t.custom[handIdx] = null;
      t.hand_speed = 9;
      void this.tweens.prop(t, "lean", 0, 0.8);
      void this.tweens.prop(t, "headPitch", 0, 0.8);
      void this.tweens.prop(t, "fear", 0, 1.0);
    });
  }

  /** Your own head: the camera snaps back, then slumps onto the table. */
  private async youDie(): Promise<void> {
    this.people[0].dead = true;
    this.shake = Math.max(this.shake, 0.16);
    this.people[0].setLimbsVisible(false);
    void this.blend(this.camPos, new THREE.Vector3(0, 1.92, 2.0), 0.14);
    await this.tweens.wait(0.5);
    void this.blend(this.camPos, new THREE.Vector3(0, 1.12, 1.35), 1.0, ease.in);
    void this.blend(this.camLook, new THREE.Vector3(0, 0.7, -0.3), 1.0);
    void this.tweens.prop(this, "fov", REST_FOV, 1.0);
    this.deathFade = 1;
    await this.tweens.wait(1.0);
  }

  // ================================================================== effects

  private blend(v: THREE.Vector3, to: THREE.Vector3, dur: number, e = ease.inOut): Promise<void> {
    const from = v.clone();
    return this.tweens.run(dur, (k) => v.lerpVectors(from, to, k), e);
  }

  private muzzleWorld(): THREE.Vector3 {
    this.gun.updateMatrixWorld(true);
    return this.gunModel.localToWorld(MUZZLE.clone());
  }

  private slowmo(scale: number, realMs: number): void {
    this.timeScale = scale;
    if (this.slowmoTimer) clearTimeout(this.slowmoTimer);
    this.slowmoTimer = setTimeout(() => (this.timeScale = 1), realMs);
  }

  private muzzleFx(): void {
    this.flashMesh.visible = true;
    this.flashMesh.scale.set(1, 1, 2.2);
    this.flashLight.intensity = 60;
    void this.tweens.run(0.18, (k) => (this.flashLight.intensity = 60 * (1 - k)), ease.linear);
    void this.tweens.run(0.12, (k) => this.flashMesh.scale.set(1 - k * 0.9, 1 - k * 0.9, 2.2 - k * 2), ease.linear).then(() => (this.flashMesh.visible = false));
    // recoil: the gun kicks back and up, then settles
    void this.tweens.run(0.05, (k) => {
      this.gunModel.position.z = 0.1 * k;
      this.gunModel.rotation.x = -0.22 * k;
    }, ease.out).then(() =>
      this.tweens.run(0.5, (k) => {
        const e = 1 - ease.elasticOut(k);
        this.gunModel.position.z = 0.1 * e;
        this.gunModel.rotation.x = -0.22 * e;
      }, ease.linear),
    );
    const m = this.muzzleWorld();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.gun.quaternion);
    this.burst(m, dir, 26, 0xb8b2aa, 0.05, 0.6, 1.8, 0.35, 1.4, 0.55, true);
    this.shake = Math.max(this.shake, 0.07);
  }

  private tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.4), glow(0xffe68c));
    mesh.position.copy(from);
    mesh.quaternion.copy(lookQuat(to.clone().sub(from).normalize()));
    this.scene.add(mesh);
    void this.tweens.run(0.14, (k) => mesh.position.lerpVectors(from, to, k), ease.linear).then(() => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
  }

  private burst(pos: THREE.Vector3, dir: THREE.Vector3, n: number, color: number, size: number, vmin: number, vmax: number, gravity: number, life = 0.7, opacity = 1, smoke = false): void {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.puffGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity }));
      m.scale.setScalar(size);
      m.position.copy(pos);
      const spread = new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9);
      const v = dir.clone().add(spread).normalize().multiplyScalar(vmin + Math.random() * (vmax - vmin));
      this.scene.add(m);
      this.puffs.push({ mesh: m, vel: v, life: 0, max: life * (0.7 + Math.random() * 0.6), grow: smoke ? 2.2 : -0.5, gravity, baseOpacity: opacity });
    }
  }

  private updatePuffs(dt: number): void {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.puffs.splice(i, 1);
        continue;
      }
      p.vel.y += p.gravity * dt;
      p.vel.multiplyScalar(1 - Math.min(1, dt * 1.2));
      p.mesh.position.addScaledVector(p.vel, dt);
      const s0 = p.mesh.scale.x;
      p.mesh.scale.setScalar(Math.max(0.001, s0 * (1 + p.grow * dt)));
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.baseOpacity * (1 - k);
    }
  }

  private spawnShell(live: boolean): void {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.065, 8), mat(live ? 0xd92619 : 0x5980e6, 0.5));
    mesh.castShadow = true;
    this.gun.updateMatrixWorld(true);
    mesh.position.copy(this.gunModel.localToWorld(new THREE.Vector3(0.04, 0.04, 0.02)));
    const out = new THREE.Vector3(1, 0, 0.2).applyQuaternion(this.gun.quaternion).normalize();
    const vel = out.multiplyScalar(1 + Math.random() * 0.6).add(new THREE.Vector3(0, 1.4 + Math.random() * 0.6, 0));
    this.scene.add(mesh);
    this.shells.push({ mesh, vel, spin: new THREE.Vector3((Math.random() - 0.5) * 28, 0, (Math.random() - 0.5) * 14), landed: false, age: 0 });
  }

  private updateShells(dt: number): void {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.age += dt;
      if (!s.landed) {
        s.vel.y -= 9 * dt;
        s.mesh.position.addScaledVector(s.vel, dt);
        s.mesh.rotation.x += s.spin.x * dt;
        s.mesh.rotation.z += s.spin.z * dt;
        const onTable = Math.hypot(s.mesh.position.x, s.mesh.position.z) < 1.0;
        const floorY = onTable ? TABLE_Y + 0.02 : 0.03;
        if (s.mesh.position.y <= floorY) {
          s.mesh.position.y = floorY;
          s.mesh.rotation.set(0, Math.random() * 6, Math.PI / 2);
          s.landed = true;
        }
      }
      if (s.age > 4) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.shells.splice(i, 1);
      }
    }
  }
}

