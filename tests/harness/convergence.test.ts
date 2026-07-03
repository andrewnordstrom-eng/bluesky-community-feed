/**
 * Convergence Metrics Unit Tests (PROJ-1484 / A3)
 *
 * Pure — no Postgres/Redis/Testcontainers dependency, same pattern as
 * population.test.ts / personas.test.ts. `l2Distance` / `weightVectorVariance`
 * / `hasConverged` are pure functions over `GovernanceWeights` vectors, so
 * every case here is exercised against known, hand-computable fixtures
 * rather than a real simulation run.
 */

import { describe, expect, it } from 'vitest';
import { l1Distance, l2Distance, weightVectorVariance, hasConverged } from '../../src/harness/convergence.js';
import { createDefaultGovernanceWeightRecord } from '../../src/config/votable-params.js';
import type { GovernanceWeights } from '../../src/shared/api-types.js';

const ZERO_VECTOR: GovernanceWeights = {
  recency: 0,
  engagement: 0,
  bridging: 0,
  sourceDiversity: 0,
  relevance: 0,
};

function vector(overrides: Partial<GovernanceWeights>): GovernanceWeights {
  return { ...ZERO_VECTOR, ...overrides };
}

describe('l2Distance', () => {
  it('is 0 for two identical vectors', () => {
    const weights = createDefaultGovernanceWeightRecord() as GovernanceWeights;
    expect(l2Distance(weights, { ...weights })).toBe(0);
  });

  it('matches a hand-computed distance on a single-component diff (a 1-D case)', () => {
    // Only `recency` differs, by 1 — Euclidean distance over one dimension
    // is just the absolute difference.
    const a = vector({ recency: 1 });
    const b = ZERO_VECTOR;
    expect(l2Distance(a, b)).toBe(1);
  });

  it('matches a hand-computed distance on a classic 3-4-5 right triangle', () => {
    // diffs: (0.3, 0.4, 0, 0, 0) -> sqrt(0.3^2 + 0.4^2) = sqrt(0.09 + 0.16) = sqrt(0.25) = 0.5
    const a = vector({ recency: 0.3, engagement: 0.4 });
    const b = ZERO_VECTOR;
    expect(l2Distance(a, b)).toBeCloseTo(0.5, 12);
  });

  it('is symmetric: distance(a, b) === distance(b, a)', () => {
    const a = vector({ recency: 0.7, engagement: 0.1, bridging: 0.1, sourceDiversity: 0.05, relevance: 0.05 });
    const b = vector({ recency: 0.2, engagement: 0.2, bridging: 0.2, sourceDiversity: 0.2, relevance: 0.2 });
    expect(l2Distance(a, b)).toBeCloseTo(l2Distance(b, a), 12);
  });

  it('is independent of key insertion order (iterates the canonical component order, not Object.keys)', () => {
    const a = vector({ recency: 0.6, engagement: 0.1, bridging: 0.1, sourceDiversity: 0.1, relevance: 0.1 });
    // Same values, keys declared in a different order.
    const bReordered: GovernanceWeights = {
      relevance: 0.05,
      sourceDiversity: 0.05,
      bridging: 0.1,
      engagement: 0.1,
      recency: 0.7,
    };
    const bCanonical: GovernanceWeights = {
      recency: 0.7,
      engagement: 0.1,
      bridging: 0.1,
      sourceDiversity: 0.05,
      relevance: 0.05,
    };
    expect(l2Distance(a, bReordered)).toBeCloseTo(l2Distance(a, bCanonical), 12);
  });
});

describe('l1Distance', () => {
  it('is 0 for two identical vectors', () => {
    const weights = createDefaultGovernanceWeightRecord() as GovernanceWeights;
    expect(l1Distance(weights, { ...weights })).toBe(0);
  });

  it('matches a hand-computed distance on a single-component diff (a 1-D case)', () => {
    const a = vector({ recency: 1 });
    const b = ZERO_VECTOR;
    expect(l1Distance(a, b)).toBe(1);
  });

  it('sums absolute per-component differences (not squared, unlike l2Distance)', () => {
    // diffs: (0.3, 0.4, 0, 0, 0) -> |0.3| + |0.4| = 0.7 (l2Distance on the
    // same vectors is 0.5, the classic 3-4-5 right triangle — see above).
    const a = vector({ recency: 0.3, engagement: 0.4 });
    const b = ZERO_VECTOR;
    expect(l1Distance(a, b)).toBeCloseTo(0.7, 12);
  });

  it('handles negative-direction diffs the same as positive ones (absolute value, not signed sum)', () => {
    const a = vector({ recency: 0.9, engagement: 0.025, bridging: 0.025, sourceDiversity: 0.025, relevance: 0.025 });
    const b = vector({ recency: 0.05, engagement: 0.05, bridging: 0.1, sourceDiversity: 0.1, relevance: 0.7 });
    // |0.9-0.05| + |0.025-0.05| + |0.025-0.1| + |0.025-0.1| + |0.025-0.7|
    // = 0.85 + 0.025 + 0.075 + 0.075 + 0.675 = 1.7
    expect(l1Distance(a, b)).toBeCloseTo(1.7, 12);
  });

  it('is symmetric: distance(a, b) === distance(b, a)', () => {
    const a = vector({ recency: 0.7, engagement: 0.1, bridging: 0.1, sourceDiversity: 0.05, relevance: 0.05 });
    const b = vector({ recency: 0.2, engagement: 0.2, bridging: 0.2, sourceDiversity: 0.2, relevance: 0.2 });
    expect(l1Distance(a, b)).toBeCloseTo(l1Distance(b, a), 12);
  });

  it('is independent of key insertion order (iterates the canonical component order, not Object.keys)', () => {
    const a = vector({ recency: 0.6, engagement: 0.1, bridging: 0.1, sourceDiversity: 0.1, relevance: 0.1 });
    const bReordered: GovernanceWeights = {
      relevance: 0.05,
      sourceDiversity: 0.05,
      bridging: 0.1,
      engagement: 0.1,
      recency: 0.7,
    };
    const bCanonical: GovernanceWeights = {
      recency: 0.7,
      engagement: 0.1,
      bridging: 0.1,
      sourceDiversity: 0.05,
      relevance: 0.05,
    };
    expect(l1Distance(a, bReordered)).toBeCloseTo(l1Distance(a, bCanonical), 12);
  });

  it('never returns less than l2Distance for the same pair (L1 >= L2 always, equal only in the 1-D case)', () => {
    const a = vector({ recency: 0.7, engagement: 0.1, bridging: 0.1, sourceDiversity: 0.05, relevance: 0.05 });
    const b = vector({ recency: 0.2, engagement: 0.2, bridging: 0.2, sourceDiversity: 0.2, relevance: 0.2 });
    expect(l1Distance(a, b)).toBeGreaterThanOrEqual(l2Distance(a, b));
  });
});

describe('weightVectorVariance', () => {
  it('is exactly 0 for a series of identical vectors', () => {
    const weights = vector({ recency: 0.4, engagement: 0.3, bridging: 0.1, sourceDiversity: 0.1, relevance: 0.1 });
    const variance = weightVectorVariance([weights, { ...weights }, { ...weights }, { ...weights }]);
    expect(variance).toBe(0);
  });

  it('matches a hand-computed variance for two vectors a fixed L2 distance apart', () => {
    // Two vectors differing only in `recency` by 1: distance = 1. Their
    // centroid sits exactly halfway (distance 0.5 from each), so the mean
    // squared distance from the centroid is 0.5^2 = 0.25.
    const a = vector({ recency: 1 });
    const b = ZERO_VECTOR;
    expect(weightVectorVariance([a, b])).toBeCloseTo(0.25, 12);
  });

  it('grows with spread: a tighter cluster has lower variance than a wider one', () => {
    const tight = [
      vector({ recency: 0.24, engagement: 0.19, bridging: 0.19, sourceDiversity: 0.19, relevance: 0.19 }),
      vector({ recency: 0.2, engagement: 0.2, bridging: 0.2, sourceDiversity: 0.2, relevance: 0.2 }),
      vector({ recency: 0.16, engagement: 0.21, bridging: 0.21, sourceDiversity: 0.21, relevance: 0.21 }),
    ];
    const wide = [
      vector({ recency: 0.7, engagement: 0.1, bridging: 0.1, sourceDiversity: 0.05, relevance: 0.05 }),
      vector({ recency: 0.2, engagement: 0.2, bridging: 0.2, sourceDiversity: 0.2, relevance: 0.2 }),
      vector({ recency: 0.05, engagement: 0.05, bridging: 0.1, sourceDiversity: 0.1, relevance: 0.7 }),
    ];
    expect(weightVectorVariance(tight)).toBeLessThan(weightVectorVariance(wide));
  });

  it('throws on an empty series rather than silently reporting 0 ("converged")', () => {
    expect(() => weightVectorVariance([])).toThrow(/at least one/);
  });

  it('is 0 for a single-element series (the minimum non-empty input)', () => {
    expect(weightVectorVariance([vector({ recency: 0.4, engagement: 0.3, bridging: 0.1, sourceDiversity: 0.1, relevance: 0.1 })])).toBe(0);
  });
});

describe('hasConverged', () => {
  const stable = vector({ recency: 0.3, engagement: 0.2, bridging: 0.2, sourceDiversity: 0.15, relevance: 0.15 });

  it('is false when the series is shorter than lastK, regardless of how tight it is', () => {
    const series = [stable, { ...stable }];
    expect(hasConverged(series, 3, 1)).toBe(false);
  });

  it('is true once the last lastK vectors are tighter than threshold', () => {
    const noisyStart = vector({ recency: 0.9, engagement: 0.025, bridging: 0.025, sourceDiversity: 0.025, relevance: 0.025 });
    const series = [noisyStart, stable, { ...stable }, { ...stable }];
    expect(hasConverged(series, 3, 1e-9)).toBe(true);
  });

  it('is false when the last lastK vectors are still spread wider than threshold', () => {
    const a = vector({ recency: 0.9, engagement: 0.025, bridging: 0.025, sourceDiversity: 0.025, relevance: 0.025 });
    const b = vector({ recency: 0.05, engagement: 0.05, bridging: 0.1, sourceDiversity: 0.1, relevance: 0.7 });
    expect(hasConverged([a, b], 2, 1e-6)).toBe(false);
  });

  it('only looks at the TAIL of the series, ignoring earlier noisy rounds', () => {
    const noisy = [
      vector({ recency: 0.9, engagement: 0.025, bridging: 0.025, sourceDiversity: 0.025, relevance: 0.025 }),
      vector({ recency: 0.05, engagement: 0.05, bridging: 0.1, sourceDiversity: 0.1, relevance: 0.7 }),
    ];
    const settled = [stable, { ...stable }, { ...stable }];
    expect(hasConverged([...noisy, ...settled], 3, 1e-9)).toBe(true);
  });

  it('throws on a non-positive lastK (a zero/negative window is meaningless)', () => {
    // Without the guard, slice(-0) === slice(0) would measure the WHOLE series.
    expect(() => hasConverged([stable, { ...stable }], 0, 1e-6)).toThrow(/positive integer/);
    expect(() => hasConverged([stable, { ...stable }], -1, 1e-6)).toThrow(/positive integer/);
    expect(() => hasConverged([stable, { ...stable }], 1.5, 1e-6)).toThrow(/positive integer/);
  });

  it('measures exactly the last lastK when series length === lastK', () => {
    // Two identical vectors, lastK=2 (== length): variance 0 < threshold.
    expect(hasConverged([stable, { ...stable }], 2, 1e-9)).toBe(true);
  });

  it('uses a strict < threshold — tail variance exactly at threshold is NOT converged', () => {
    const a = vector({ recency: 0.3, engagement: 0.2, bridging: 0.2, sourceDiversity: 0.15, relevance: 0.15 });
    const b = vector({ recency: 0.4, engagement: 0.2, bridging: 0.2, sourceDiversity: 0.15, relevance: 0.05 });
    const varianceAtTail = weightVectorVariance([a, b]);
    expect(hasConverged([a, b], 2, varianceAtTail)).toBe(false); // exactly at threshold → strict < → false
    expect(hasConverged([a, b], 2, varianceAtTail + 1e-12)).toBe(true); // just above → true
  });
});
