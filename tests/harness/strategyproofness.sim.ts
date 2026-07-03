/**
 * Integration test: A4 strategyproofness experiment (PROJ-1485), driven
 * against the real Testcontainers-backed Postgres stack.
 *
 * Same low-level pattern as `invariants.sim.ts`: `insertActiveEpoch` +
 * `seedSubscribers` (helpers.ts) provision the scaffolding; the real
 * `governance_votes` inserts, `governance_vote_weights` dual-write, and the
 * `aggregateVotes` call itself live in `src/harness/strategyproofness.ts`
 * (never re-implemented here).
 *
 * Two things are being demonstrated:
 *   1. The n=10 seed fixture (`SEED_FOCAL_TRUE` / `SEED_FOCAL_CORNER` /
 *      `buildOtherVoterReports(9)`) reproduces the headline result: the
 *      focal voter's own L1/L2 displacement from the real aggregate outcome
 *      is smaller when it reports the corner than when it reports its true
 *      preference sincerely.
 *   2. That result is not a one-off coincidence at n=10 — a sweep across
 *      several population sizes (below, at, and well above the n>=10 trim
 *      threshold) is exercised too, and its CSV artifact is checked for
 *      shape and determinism the same way `multi-epoch-cycle.sim.ts` checks
 *      `epochs.csv`.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/client.js';
import {
  runStrategyproofnessTrial,
  buildOtherVoterReports,
  buildPolarizedAgainstEngagementOtherVoterReports,
  writeStrategyproofnessArtifacts,
  sumsToOne,
  SEED_FOCAL_TRUE,
  SEED_FOCAL_CORNER,
  type StrategyproofnessTrialResult,
} from '../../src/harness/strategyproofness.js';
import type { GovernanceWeights } from '../../src/shared/api-types.js';
import { resetHarnessData, seedSubscribers, insertActiveEpoch } from './helpers.js';

/** Population sizes swept: below the n>=10 trim threshold (6, 8), exactly at
 *  the seed fixture (10), and increasingly above it (15, 20, 30, 50) — wide
 *  enough to show the trim regime engaging and the manipulation payoff's
 *  behavior as the population grows, without an unbounded matrix of points. */
const SWEEP_NS = [6, 8, 10, 15, 20, 30, 50] as const;
const MAX_N = Math.max(...SWEEP_NS);

/**
 * Expected trim count per swept `n`, hardcoded against `aggregateVotes`'s
 * real trim rule (`src/governance/aggregation.ts`, ~line 96-99:
 * `Math.floor(n * 0.1)`, applied only when `n >= 10`) rather than against
 * this harness's own `effectiveTrimCount` copy of that rule — comparing a
 * function to itself would pass unconditionally even if both the harness's
 * copy AND the real formula drifted together (or if the copy alone drifted).
 * This table is the independent pin.
 */
const EXPECTED_TRIM_COUNTS: Readonly<Record<number, number>> = {
  6: 0,
  8: 0,
  10: 1,
  15: 1,
  20: 2,
  30: 3,
  50: 5,
};

describe('strategyproofness (PROJ-1485 / A4): real trimmed-mean aggregateVotes manipulability', () => {
  let subscriberDids: string[] = [];

  beforeAll(async () => {
    subscriberDids = await seedSubscribers(MAX_N, 'did:plc:corgistratsub');
  });

  afterAll(async () => {
    await resetHarnessData();
  });

  /**
   * Run one sincere-vs-strategic trial pair for population size `n`, seeding
   * two FRESH epochs (never reused across trials/tests in this file, so
   * differently-sized trials never collide on `governance_votes`'
   * `(voter_did, epoch_id)` uniqueness constraint). Reuses the same first
   * `n` subscriber DIDs seeded once in `beforeAll` — a subscriber casting
   * votes in more than one epoch over time is the normal case in production,
   * not a test artifact.
   *
   * `otherReports` defaults to the documented 3:3:2:1 baseline population
   * (`buildOtherVoterReports`) but can be overridden — used by the
   * population-robustness test below to run the identical trial shape
   * against `buildPolarizedAgainstEngagementOtherVoterReports` instead.
   */
  async function runTrial(
    n: number,
    otherReports: readonly GovernanceWeights[] = buildOtherVoterReports(n - 1)
  ): Promise<StrategyproofnessTrialResult> {
    const dids = subscriberDids.slice(0, n);
    const sincereEpochId = await insertActiveEpoch(`a4-strategyproofness-n${n}-sincere`);
    const strategicEpochId = await insertActiveEpoch(`a4-strategyproofness-n${n}-strategic`);

    return runStrategyproofnessTrial(
      { db },
      {
        n,
        focalTrue: SEED_FOCAL_TRUE,
        focalCorner: SEED_FOCAL_CORNER,
        otherReports,
        subscriberDids: dids,
        sincereEpochId,
        strategicEpochId,
      }
    );
  }

  it(
    'n=10 seed fixture: reporting the corner vote reduces the focal voter\'s own L1/L2 ' +
      'displacement from the real aggregate outcome',
    async () => {
      expect(sumsToOne(SEED_FOCAL_TRUE)).toBe(true);
      expect(sumsToOne(SEED_FOCAL_CORNER)).toBe(true);

      const result = await runTrial(10);

      // n=10 is exactly at the n>=10 trim threshold: floor(10 * 0.1) = 1.
      expect(result.trimCount).toBe(1);
      expect(result.sincereOutcome).toBeTruthy();
      expect(result.strategicOutcome).toBeTruthy();
      expect(sumsToOne(result.sincereOutcome)).toBe(true);
      expect(sumsToOne(result.strategicOutcome)).toBe(true);

      // The headline, bounded claim: on THIS real aggregator against THIS
      // population, misreporting the corner leaves the focal voter's true
      // preference closer to the outcome than reporting it sincerely does.
      expect(result.strategicL1).toBeLessThan(result.sincereL1);
      expect(result.strategicL2).toBeLessThan(result.sincereL2);
      expect(result.deltaL1).toBeGreaterThan(0);
      expect(result.deltaL2).toBeGreaterThan(0);

      // Pin the actual measured numbers against this repo's own documented
      // population (see strategyproofness.ts's file header for why this is
      // NOT a byte-for-byte reproduction of an external 0.313 -> 0.146
      // target fixture — that exact population was not recoverable from
      // anything in this repo). These are the real numbers the real
      // `aggregateVotes` produced for this population: sincere L1 ~0.302,
      // strategic L1 ~0.236 — a smaller improvement than the 0.313 -> 0.146
      // target, but the same direction (manipulation pays) on real code.
      expect(result.sincereL1).toBeCloseTo(0.302, 9);
      expect(result.strategicL1).toBeCloseTo(0.236, 9);
      expect(result.sincereL2).toBeCloseTo(0.1560320479901485, 9);
      expect(result.strategicL2).toBeCloseTo(0.13739723432442155, 9);

      // eslint-disable-next-line no-console
      console.log(
        '[PROJ-1485 A4 seed n=10] sincere L1=%s L2=%s | strategic L1=%s L2=%s | deltaL1=%s deltaL2=%s',
        result.sincereL1,
        result.sincereL2,
        result.strategicL1,
        result.strategicL2,
        result.deltaL1,
        result.deltaL2
      );
    }
  );

  it(
    'determinism: re-running the identical n=10 trial in fresh epochs yields identical displacement numbers',
    async () => {
      const first = await runTrial(10);
      const second = await runTrial(10);

      expect(second.sincereL1).toBe(first.sincereL1);
      expect(second.strategicL1).toBe(first.strategicL1);
      expect(second.sincereL2).toBe(first.sincereL2);
      expect(second.strategicL2).toBe(first.strategicL2);
      expect(second.sincereOutcome).toEqual(first.sincereOutcome);
      expect(second.strategicOutcome).toEqual(first.strategicOutcome);
    }
  );

  it(
    'population-robustness: polarizing the population against the focal voter\'s ' +
      'engagement-leaning true preference reverses the manipulation-pays sign',
    async () => {
      // Baseline (documented 3:3:2:1 mix): reproduces the headline claim —
      // reporting the corner pays for the focal voter at n=10.
      const baseline = await runTrial(10);
      expect(baseline.deltaL1).toBeGreaterThan(0);

      // Alternative population: every other voter is a chronological-purist
      // (recency 0.7 / engagement 0.05 / ...) instead of the 3:3:2:1 mix —
      // i.e. the community is polarized AGAINST the focal voter's own
      // engagement-leaning true preference, with no engagement-favoring peer
      // left for the focal's corner vote to displace out of the top-trim
      // slot. Same n, same focal true/corner reports, same trial shape —
      // only the other voters' reports differ.
      const polarizedOtherReports = buildPolarizedAgainstEngagementOtherVoterReports(9);
      const polarized = await runTrial(10, polarizedOtherReports);
      expect(polarized.deltaL1).toBeLessThanOrEqual(0);

      // eslint-disable-next-line no-console
      console.log(
        '[PROJ-1485 A4 population-robustness] baseline deltaL1=%s | polarized deltaL1=%s',
        baseline.deltaL1,
        polarized.deltaL1
      );
    }
  );

  it(
    'sweep across population sizes: writes a well-formed CSV artifact',
    async () => {
      const artifactsDir = await mkdtemp(path.join(tmpdir(), 'corgi-sim-strategyproofness-'));
      try {
        const rows: StrategyproofnessTrialResult[] = [];
        for (const n of SWEEP_NS) {
          rows.push(await runTrial(n));
        }

        expect(rows.map((row) => row.n)).toEqual([...SWEEP_NS]);

        // Trim regime matches the real aggregateVotes trim rule exactly
        // (no trim below n=10, floor(n*0.1) at/above it) — pinned against the
        // hardcoded EXPECTED_TRIM_COUNTS table, not against this harness's
        // own effectiveTrimCount copy of the same rule (which would compare
        // the function to itself and pass unconditionally even if both drift
        // together).
        //
        // Also pin the headline sign split this experiment actually claims:
        // manipulation pays (deltaL1 > 0) at every trim-eligible n >= 10, and
        // does NOT pay (deltaL1 <= 0) below the trim threshold. Without this,
        // a regression could flip n=8 positive or n=20 negative and the CSV
        // shape checks below would stay green.
        for (const row of rows) {
          expect(row.trimCount).toBe(EXPECTED_TRIM_COUNTS[row.n]);
          expect(sumsToOne(row.sincereOutcome)).toBe(true);
          expect(sumsToOne(row.strategicOutcome)).toBe(true);
          if (row.n >= 10) {
            expect(row.deltaL1).toBeGreaterThan(0);
          } else {
            expect(row.deltaL1).toBeLessThanOrEqual(0);
          }
        }

        const { csvPath } = await writeStrategyproofnessArtifacts(artifactsDir, rows);
        const csvContent = await readFile(csvPath, 'utf8');
        const csvLines = csvContent.trim().split('\n');

        // One header + one row per swept n, every line the same column count
        // as the header (well-formed, not ragged) — same shape check
        // multi-epoch-cycle.sim.ts applies to epochs.csv.
        expect(csvLines).toHaveLength(SWEEP_NS.length + 1);
        const headerColumnCount = csvLines[0].split(',').length;
        for (const line of csvLines.slice(1)) {
          expect(line.split(',')).toHaveLength(headerColumnCount);
        }
        expect(csvLines[0]).toBe(
          'n,trimCount,sincereL1,sincereL2,strategicL1,strategicL2,deltaL1,deltaL2,manipulationPaid'
        );

        // eslint-disable-next-line no-console
        console.log('[PROJ-1485 A4 sweep]\n%s', csvContent);
      } finally {
        await rm(artifactsDir, { recursive: true, force: true });
      }
    },
    120_000
  );
});
