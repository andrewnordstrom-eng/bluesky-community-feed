/**
 * fast-check invariants for the governance vote-aggregation math.
 *
 * - `normalizeWeights` (pure, exported): weights always sum to 1 within 1e-9.
 * - trimmed mean (general math property, see comment below): stays within
 *   [min, max] of its input.
 * - `aggregateVotes` (real production code, real Postgres via Testcontainers):
 *   calling it twice on the same epoch is idempotent.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalizeWeights } from '../../src/governance/governance.types.js';
import { aggregateVotes } from '../../src/governance/aggregation.js';
import { writeVoteWeights } from '../../src/governance/weight-longtable.js';
import { config } from '../../src/config.js';
import { db } from '../../src/db/client.js';
import { resetHarnessData, seedSubscribers, insertActiveEpoch } from './helpers.js';

const FC_SEED = 20260630;
const MAX_VOTERS = 15;

describe('normalizeWeights (real, exported production code): sum invariant', () => {
  it('normalized weights always sum to exactly 1 within 1e-9, regardless of input scale', () => {
    fc.assert(
      fc.property(
        fc
          .tuple(
            fc.float({ min: 0, max: 1000, noNaN: true }),
            fc.float({ min: 0, max: 1000, noNaN: true }),
            fc.float({ min: 0, max: 1000, noNaN: true }),
            fc.float({ min: 0, max: 1000, noNaN: true }),
            fc.float({ min: 0, max: 1000, noNaN: true })
          )
          .filter(([a, b, c, d, e]) => a + b + c + d + e > 0),
        ([recency, engagement, bridging, sourceDiversity, relevance]) => {
          const normalized = normalizeWeights({
            recency,
            engagement,
            bridging,
            sourceDiversity,
            relevance,
          });
          const sum = Object.values(normalized).reduce((total, value) => total + value, 0);
          return Math.abs(sum - 1) < 1e-9;
        }
      ),
      { seed: FC_SEED, numRuns: 200 }
    );
  });

  it('every normalized component stays within [0, 1]', () => {
    fc.assert(
      fc.property(
        fc
          .tuple(
            fc.float({ min: -1000, max: 1000, noNaN: true }),
            fc.float({ min: -1000, max: 1000, noNaN: true }),
            fc.float({ min: -1000, max: 1000, noNaN: true }),
            fc.float({ min: -1000, max: 1000, noNaN: true }),
            fc.float({ min: -1000, max: 1000, noNaN: true })
          )
          .filter(([a, b, c, d, e]) => a + b + c + d + e > 0),
        ([recency, engagement, bridging, sourceDiversity, relevance]) => {
          const normalized = normalizeWeights({
            recency,
            engagement,
            bridging,
            sourceDiversity,
            relevance,
          });
          return Object.values(normalized).every((value) => value >= 0 && value <= 1);
        }
      ),
      { seed: FC_SEED, numRuns: 200 }
    );
  });
});

/**
 * Pure re-implementation of the trim-then-mean step inside
 * `aggregateVotes` (src/governance/aggregation.ts): 10% trim from each end
 * when n >= 10, else no trim, then arithmetic mean of the remainder.
 *
 * DEVIATION FROM THE BLUEPRINT (documented, see builder report): the
 * production code doesn't export this step standalone — it always follows
 * it with a cross-component `normalizeWeights` call that rescales every
 * component so the 5-vector sums to 1, which would make "the aggregated
 * weight stays within [min, max] of that one component's raw votes" true or
 * false almost by accident of how the OTHER four components happened to
 * trim, not a meaningful test of the trim/mean step itself. So this test
 * targets the general trimmed-mean algorithm in isolation — a property that
 * must hold for ANY correct trimmed-mean implementation, independent of
 * which of aggregateVotes's five components it's later plugged into. The
 * idempotency test below covers `aggregateVotes` end-to-end against real
 * Postgres, exactly as instructed as the fallback when the pure math isn't
 * separately exported.
 */
function trimmedMean(values: readonly number[]): number {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const trimCount = n >= 10 ? Math.floor(n * 0.1) : 0;
  const trimmed = trimCount > 0 ? sorted.slice(trimCount, n - trimCount) : sorted;
  return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
}

describe('trimmed mean: general bounds invariant', () => {
  it('stays within [min, max] of the input population', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 200 }),
        (values) => {
          const result = trimmedMean(values);
          const lo = Math.min(...values);
          const hi = Math.max(...values);
          return result >= lo - 1e-9 && result <= hi + 1e-9;
        }
      ),
      { seed: FC_SEED, numRuns: 200 }
    );
  });
});

describe('aggregateVotes (real production code, real Postgres): idempotency', () => {
  let subscriberDids: string[] = [];

  beforeAll(async () => {
    subscriberDids = await seedSubscribers(MAX_VOTERS);
  });

  afterAll(async () => {
    await resetHarnessData();
  });

  it('calling aggregateVotes twice on the same epoch returns identical output', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            recency: fc.float({ min: 0, max: 1, noNaN: true }),
            engagement: fc.float({ min: 0, max: 1, noNaN: true }),
            bridging: fc.float({ min: 0, max: 1, noNaN: true }),
            sourceDiversity: fc.float({ min: 0, max: 1, noNaN: true }),
            relevance: fc.float({ min: 0, max: 1, noNaN: true }),
          }),
          { minLength: 1, maxLength: MAX_VOTERS }
        ),
        async (rawVotes) => {
          const epochId = await insertActiveEpoch('idempotency-property-epoch');

          for (const [index, raw] of rawVotes.entries()) {
            const weights = normalizeWeights(raw);
            const inserted = await db.query<{ id: string }>(
              `INSERT INTO governance_votes (
                voter_did, epoch_id, recency_weight, engagement_weight,
                bridging_weight, source_diversity_weight, relevance_weight
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)
              RETURNING id`,
              [
                subscriberDids[index],
                epochId,
                weights.recency,
                weights.engagement,
                weights.bridging,
                weights.sourceDiversity,
                weights.relevance,
              ]
            );

            // aggregateVotes reads governance_vote_weights (the long table),
            // not the wide columns just inserted above, whenever
            // GOVERNANCE_LONGTABLE_READ_ENABLED is on (the production
            // default) — mirror src/governance/routes/vote.ts's dual-write
            // or the seeded votes would be invisible to it.
            if (config.GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED) {
              await writeVoteWeights(inserted.rows[0].id, weights);
            }
          }

          const once = await aggregateVotes(epochId);
          const twice = await aggregateVotes(epochId);

          expect(once).not.toBeNull();
          expect(twice).toEqual(once);
        }
      ),
      { seed: FC_SEED, numRuns: 10 }
    );
  }, 60_000);
});
