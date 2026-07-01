/**
 * Deterministic RNG + Clock
 *
 * Deterministic Simulation Testing (DST) requires every source of
 * non-determinism inside the simulated system to be injected rather than
 * read from ambient globals. This module provides the two primitives the
 * rest of the harness (population generation, `Simulation`) is required to
 * use instead of `Math.random()` / `Date.now()` / `new Date()`:
 *
 * - `Rng`: a seeded pseudo-random number generator (mulberry32). Pure,
 *   dependency-free, fully specified by a 32-bit integer seed.
 * - `Clock`: an injectable source of "now" so simulated timestamps are a
 *   pure function of the seed/config rather than wall-clock time.
 *
 * Neither of these touches `Math.random` or `Date.now` internally except
 * `SeededClock`'s starting point, which is itself derived from the caller's
 * seed, not sampled at construction time.
 */

/** A seeded, deterministic source of randomness. */
export interface Rng {
  /** Next pseudo-random float in [0, 1). */
  next(): number;
  /** Next pseudo-random integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Pick a uniformly random element from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Return true with the given probability (0..1). */
  chance(probability: number): boolean;
}

/**
 * mulberry32 seeded PRNG.
 *
 * Small, fast, fully specified by a single 32-bit seed. Not cryptographically
 * secure — that's not a requirement here, only reproducibility.
 *
 * Reference: https://www.4rknova.com/blog/2026/03/01/mulberry32-rng
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function generate(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a deterministic `Rng` from an integer seed. The same seed always
 * produces the same sequence of `next()`/`int()`/`pick()`/`chance()` calls.
 */
export function createRng(seed: number): Rng {
  const generate = mulberry32(seed);

  const next = (): number => generate();

  const int = (maxExclusive: number): number => {
    if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) {
      throw new Error(`Rng.int requires maxExclusive > 0, got ${maxExclusive}`);
    }
    return Math.floor(next() * maxExclusive);
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new Error('Rng.pick requires a non-empty array');
    }
    return items[int(items.length)];
  };

  const chance = (probability: number): boolean => next() < probability;

  return { next, int, pick, chance };
}

/** An injectable source of "now", so simulated code never reads the wall clock directly. */
export interface Clock {
  now(): Date;
}

/**
 * A deterministic clock that starts at a fixed instant and only advances
 * when explicitly told to. Used by the harness so post/vote timestamps are
 * a pure function of `(seed, config)`, not of when the test happened to run.
 */
export class SeededClock implements Clock {
  private currentMs: number;

  constructor(startMs: number) {
    this.currentMs = startMs;
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  /** Advance the clock by `ms` milliseconds and return the new instant. */
  advance(ms: number): Date {
    this.currentMs += ms;
    return this.now();
  }
}
