// A tiny promise-based tween engine. The 3D stage calls step(dt) once per frame, so every
// animation shares one clock (which is what makes slow motion and pausing trivial).

export type EaseFn = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  in: (t: number) => t * t,
  elasticOut: (t: number) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1),
} as const;

interface Job {
  elapsed: number;
  dur: number;
  fn: (k: number) => void;
  e: EaseFn;
  done: () => void;
}

export class Tweens {
  private jobs: Job[] = [];

  /** Calls fn(k) with k eased from 0 to 1 over `dur` seconds. */
  run(dur: number, fn: (k: number) => void, e: EaseFn = ease.inOut): Promise<void> {
    return new Promise((resolve) => {
      if (dur <= 0) {
        fn(1);
        resolve();
        return;
      }
      this.jobs.push({ elapsed: 0, dur, fn, e, done: resolve });
    });
  }

  /** Tweens a numeric property. */
  prop<T extends object>(obj: T, key: keyof T & string, to: number, dur: number, e: EaseFn = ease.inOut): Promise<void> {
    const from = obj[key] as unknown as number;
    return this.run(dur, (k) => ((obj as Record<string, unknown>)[key] = from + (to - from) * k), e);
  }

  wait(dur: number): Promise<void> {
    return this.run(dur, () => {}, ease.linear);
  }

  step(dt: number): void {
    const jobs = this.jobs;
    for (let i = jobs.length - 1; i >= 0; i--) {
      const j = jobs[i];
      j.elapsed += dt;
      const k = Math.min(1, j.elapsed / j.dur);
      j.fn(j.e(k));
      if (k >= 1) {
        jobs.splice(i, 1);
        j.done();
      }
    }
  }

  /** Drops everything. Pending promises never resolve, so cancelled sequences simply stop. */
  clear(): void {
    this.jobs.length = 0;
  }
}
