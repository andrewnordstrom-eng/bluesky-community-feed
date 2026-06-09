/**
 * Property tests for the governance vote-aggregation core (Layer 1).
 *
 * These exercise the REAL aggregation logic (`combineVoteWeights`, which
 * `aggregateVotes` delegates to) over thousands of generated electorates — no DB.
 * They pin the invariants the governed feed depends on, including the trimmed-mean
 * outlier-resistance the module claims ("prevent outlier manipulation").
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  combineVoteWeights,
  trimmedMean,
  type WeightVote,
} from '../src/governance/aggregation-core.js';

const KEYS = ['recency', 'engagement', 'bridging', 'sourceDiversity', 'relevance'] as const;

/** A realistic ballot: 5 positive weights normalized to sum to 1 (the DB invariant). */
const arbBallot: fc.Arbitrary<WeightVote> = fc
  .tuple(
    fc.double({ min: 0.001, max: 1, noNaN: true }),
    fc.double({ min: 0.001, max: 1, noNaN: true }),
    fc.double({ min: 0.001, max: 1, noNaN: true }),
    fc.double({ min: 0.001, max: 1, noNaN: true }),
    fc.double({ min: 0.001, max: 1, noNaN: true })
  )
  .map(([r, e, b, d, v]): WeightVote => {
    const s = r + e + b + d + v;
    return {
      recency_weight: r / s,
      engagement_weight: e / s,
      bridging_weight: b / s,
      source_diversity_weight: d / s,
      relevance_weight: v / s,
    };
  });

const sum = (w: ReturnType<typeof combineVoteWeights> & object): number =>
  KEYS.reduce((acc, k) => acc + w[k], 0);

describe('combineVoteWeights — invariants', () => {
  it('adopted weights always sum to 1.0', () => {
    fc.assert(
      fc.property(fc.array(arbBallot, { minLength: 1, maxLength: 250 }), (ballots) => {
        const w = combineVoteWeights(ballots)!;
        expect(sum(w)).toBeCloseTo(1, 9);
      })
    );
  });

  it('every adopted component is a valid weight in [0, 1]', () => {
    fc.assert(
      fc.property(fc.array(arbBallot, { minLength: 1, maxLength: 250 }), (ballots) => {
        const w = combineVoteWeights(ballots)!;
        for (const k of KEYS) {
          expect(w[k]).toBeGreaterThanOrEqual(0);
          expect(w[k]).toBeLessThanOrEqual(1);
        }
      })
    );
  });

  it('returns null for an empty electorate', () => {
    expect(combineVoteWeights([])).toBeNull();
  });

  it('a unanimous electorate adopts exactly the unanimous ballot', () => {
    fc.assert(
      fc.property(arbBallot, fc.integer({ min: 1, max: 60 }), (ballot, n) => {
        const w = combineVoteWeights(Array(n).fill(ballot))!;
        // 2 dp tolerance: the aggregator snaps weights to a 1/WEIGHT_SCALE (0.001)
        // grid via roundToExactUnitSum, so reproduction is exact only up to that grid.
        expect(w.recency).toBeCloseTo(ballot.recency_weight, 2);
        expect(w.engagement).toBeCloseTo(ballot.engagement_weight, 2);
        expect(w.bridging).toBeCloseTo(ballot.bridging_weight, 2);
        expect(w.sourceDiversity).toBeCloseTo(ballot.source_diversity_weight, 2);
        expect(w.relevance).toBeCloseTo(ballot.relevance_weight, 2);
      })
    );
  });
});

describe('combineVoteWeights — outlier resistance (design intent)', () => {
  it('the trimmed mean absorbs a lone extreme ballot when n >= 10', () => {
    const extreme: WeightVote = {
      recency_weight: 1,
      engagement_weight: 0,
      bridging_weight: 0,
      source_diversity_weight: 0,
      relevance_weight: 0,
    };
    fc.assert(
      fc.property(arbBallot, fc.integer({ min: 10, max: 120 }), (honest, n) => {
        const base = combineVoteWeights(Array(n).fill(honest))!;
        const withOutlier = combineVoteWeights([...Array(n).fill(honest), extreme])!;
        for (const k of KEYS) {
          // total n+1 >= 11 → trimCount >= 1 → the single extreme is trimmed away.
          // 2 dp tolerance = the 0.001 normalization grid (WEIGHT_SCALE=1000): the
          // outlier can shift the snapped result by at most one grid cell, never
          // materially. (A tighter tolerance flakes when a value straddles a boundary.)
          expect(withOutlier[k]).toBeCloseTo(base[k], 2);
        }
      })
    );
  });
});

describe('trimmedMean', () => {
  it('equals the plain mean when trimCount is 0', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1 }), (xs) => {
        const plain = xs.reduce((a, b) => a + b, 0) / xs.length;
        expect(trimmedMean(xs, 0)).toBeCloseTo(plain, 9);
      })
    );
  });

  it('is unaffected by adding symmetric extremes that get trimmed', () => {
    const xs = Array(20).fill(0.5);
    expect(trimmedMean([...xs, 0, 1], 1)).toBeCloseTo(0.5, 9);
  });
});

describe('scale smoke', () => {
  it('aggregates 10,000 ballots in-memory and stays normalized', () => {
    const ballots: WeightVote[] = Array.from({ length: 10_000 }, (_, i) => {
      const r = 0.2 + 0.6 * ((i * 2654435761) % 1000) / 1000; // deterministic spread
      const rest = (1 - r) / 4;
      return {
        recency_weight: r,
        engagement_weight: rest,
        bridging_weight: rest,
        source_diversity_weight: rest,
        relevance_weight: rest,
      };
    });
    const w = combineVoteWeights(ballots)!;
    expect(sum(w)).toBeCloseTo(1, 9);
  });
});
