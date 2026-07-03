/**
 * Convergence Metrics
 *
 * Pure math over a series of governance weight vectors — no I/O, no
 * Postgres/Redis dependency, no `Rng`/`Clock`. `Simulation.runMultiEpochCycle`
 * (simulation.ts) uses `l2Distance` to compute each round's displacement from
 * the previous round's weight vector; tests use `weightVectorVariance` /
 * `hasConverged` to PROVE a homogeneous synthetic population's aggregated
 * weights settle into a stable vector, rather than eyeballing a CSV.
 */

import { GOVERNANCE_WEIGHT_KEYS } from '../config/votable-params.js';
import type { GovernanceWeights } from '../shared/api-types.js';

/**
 * Euclidean (L2) distance between two governance weight vectors. Iterates
 * `GOVERNANCE_WEIGHT_KEYS` (the canonical component order) rather than
 * `Object.keys`/`Object.values`, so the result never depends on either
 * vector's property insertion order.
 */
export function l2Distance(a: GovernanceWeights, b: GovernanceWeights): number {
  const sumSquares = GOVERNANCE_WEIGHT_KEYS.reduce((sum, key) => {
    const diff = a[key] - b[key];
    return sum + diff * diff;
  }, 0);
  return Math.sqrt(sumSquares);
}

/** Componentwise centroid (mean vector) of a non-empty series of weight vectors. */
function centroid(vectors: readonly GovernanceWeights[]): GovernanceWeights {
  const sums = Object.fromEntries(GOVERNANCE_WEIGHT_KEYS.map((key) => [key, 0])) as GovernanceWeights;
  for (const vector of vectors) {
    for (const key of GOVERNANCE_WEIGHT_KEYS) {
      sums[key] += vector[key];
    }
  }
  for (const key of GOVERNANCE_WEIGHT_KEYS) {
    sums[key] /= vectors.length;
  }
  return sums;
}

/**
 * "L2 variance" of a series of weight vectors: the mean squared L2 distance
 * of every vector in `vectors` from their own centroid — the natural
 * multi-dimensional generalization of scalar variance (equivalently, the
 * trace of the series' covariance matrix). A homogeneous population's
 * per-round aggregated weight vectors cluster tightly around one point, so
 * this value sits near 0; real cross-round disagreement (or a small vote
 * sample) produces a larger spread.
 *
 * Throws on an empty series — "variance of nothing" has no meaningful value,
 * and a silent 0 would misleadingly read as "perfectly converged" rather
 * than "no data was given".
 */
export function weightVectorVariance(vectors: readonly GovernanceWeights[]): number {
  if (vectors.length === 0) {
    throw new Error('weightVectorVariance: requires at least one weight vector');
  }
  const mean = centroid(vectors);
  const sumSquaredDistances = vectors.reduce((sum, vector) => sum + l2Distance(vector, mean) ** 2, 0);
  return sumSquaredDistances / vectors.length;
}

/**
 * Has a weight-vector series converged? True only once at least `lastK`
 * rounds have been observed AND the `weightVectorVariance` of the most
 * recent `lastK` vectors is below `threshold`. A series shorter than `lastK`
 * always reports "not yet converged" rather than silently measuring a
 * shorter window the caller didn't ask for.
 */
export function hasConverged(
  weightSeries: readonly GovernanceWeights[],
  lastK: number,
  threshold: number
): boolean {
  // Guard non-positive lastK up front: `slice(-0)` is `slice(0)` (the WHOLE
  // series, not an empty window), and `length < lastK` is false for lastK <= 0,
  // so without this a caller could get "converged over the last 0 rounds" —
  // a meaningless answer measured over the entire run. This is exported API.
  if (!Number.isInteger(lastK) || lastK <= 0) {
    throw new Error(`hasConverged: lastK must be a positive integer (got ${lastK})`);
  }
  if (weightSeries.length < lastK) {
    return false;
  }
  return weightVectorVariance(weightSeries.slice(-lastK)) < threshold;
}
