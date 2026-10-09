import { randomInt, randomBytes } from "node:crypto";

/** All randomness in the engine goes through this interface so tests can control it. */
export interface Rng {
  /** Uniform float in [0, 1). */
  float(): number;
  /** Uniform integer in [min, max] (both inclusive). */
  intInclusive(min: number, max: number): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Uniform in-place Fisher-Yates shuffle. */
  shuffle<T>(items: T[]): void;
}

abstract class BaseRng implements Rng {
  abstract float(): number;
  abstract int(maxExclusive: number): number;

  intInclusive(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  shuffle<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
  }
}

/** Deterministic generator (mulberry32) for tests and simulations. NOT for production. */
class SeededRng extends BaseRng {
  private a: number;

  constructor(seed: number) {
    super();
    this.a = seed >>> 0;
  }

  float(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.float() * maxExclusive);
  }
}

/** Cryptographically secure generator used by the real server. */
class CryptoRng extends BaseRng {
  float(): number {
    // 48 random bits -> double in [0, 1)
    return randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
  }

  int(maxExclusive: number): number {
    return randomInt(maxExclusive);
  }
}

export function createSeededRng(seed: number): Rng {
  return new SeededRng(seed);
}

export function createCryptoRng(): Rng {
  return new CryptoRng();
}
