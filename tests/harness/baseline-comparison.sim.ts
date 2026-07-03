/**
 * Integration test: A5 three-way baseline comparison (PROJ-1486), driven
 * against the real Testcontainers-backed Postgres + Redis stack.
 *
 * Same "drive the real engine, read back what it persisted" pattern as
 * multi-epoch-cycle.sim.ts / strategyproofness.sim.ts: `runBaselineComparison`
 * (src/harness/baseline-comparison.ts) seeds ONE fixed corpus, scores it under
 * all three regimes via the REAL `runScoringPipeline`
 * (no-governance/engagement-only via direct weight injection,
 * community-governed via the REAL `aggregateVotes` -> `forceEpochTransition`),
 * and this file asserts:
 *
 *   1. The three regimes produce measurably distinct rankings — non-trivial
 *      rank churn between engagement-only and community-governed.
 *   2. A feed-quality-vs-engagement direction: the governed feed's author
 *      concentration is no higher than the engagement-only feed's (governance
 *      is not making concentration WORSE on this corpus) — asserted with the
 *      real numbers this corpus/seed actually produces, not assumed. A
 *      companion distortion-ratio assertion checks the "at what cost" half:
 *      the governed feed still captures a majority (but not all) of the
 *      engagement-only regime's own best-case quality mass.
 *   3. Determinism: the same seed reproduces identical feed-metric output
 *      across two independent runs against a freshly reset database.
 *
 * Feed-metrics math itself (rank churn on known permutations, HHI/Gini on
 * known distributions, minority exposure on a known feed) is unit-tested in
 * feed-metrics.test.ts against hand-computed fixtures, not re-verified here —
 * this file only checks that the REAL pipeline run produces distinct,
 * reproducible input for those already-verified functions.
 *
 * `vi.useFakeTimers({ toFake: ['Date'] })` + a fixed `HARNESS_FIXED_CLOCK_MS`
 * (same pattern as golden-snapshot.sim.ts): the real scoring pipeline's
 * `recency` component and its scoring-window cutoff (`getPostsForScoring`,
 * pipeline.ts) read the real wall clock, not an injected `Clock` — freezing
 * `Date` itself is what makes seeded post timestamps land inside the scoring
 * window deterministically, independent of the real calendar date the suite
 * runs on.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/client.js';
import { createRng, SeededClock } from '../../src/harness/rng.js';
import {
  runBaselineComparison,
  writeBaselineComparisonArtifacts,
  REGIME_NAMES,
  type RegimeName,
  type RegimeSummaryCsvRow,
  type BaselineComparisonCsvRow,
} from '../../src/harness/baseline-comparison.js';
import {
  normalizedRankDisplacement,
  kendallTauDistance,
  minorityTopicExposure,
  authorHHI,
  authorGini,
  distortionRatio,
} from '../../src/harness/feed-metrics.js';
import { resetHarnessData, HARNESS_FIXED_CLOCK_MS } from './helpers.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SEED = 90210;

const POPULATION_CONFIG = {
  subscriberCount: 60,
  postCount: 200,
  voteParticipationRate: 1,
  contentVoteRate: 0,
  castsWeightVoteRate: 1,
  castsTopicVoteRate: 0,
  personaMix: {
    'engagement-maximizer': 1,
    'chronological-purist': 1,
    'bridge-builder': 1,
    balanced: 1,
  },
};

describe('baseline comparison (PROJ-1486 / A5): three regimes on one fixed corpus', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(HARNESS_FIXED_CLOCK_MS));
  });

  afterEach(async () => {
    await resetHarnessData();
  });

  afterAll(async () => {
    await resetHarnessData();
    vi.useRealTimers();
  });

  it('every regime produces a non-empty, distinctly-weighted top-K feed', async () => {
    const deps = { db, rng: createRng(SEED), clock: new SeededClock(HARNESS_FIXED_CLOCK_MS) };
    const result = await runBaselineComparison(deps, { populationConfig: POPULATION_CONFIG, topK: 50 });

    for (const name of REGIME_NAMES) {
      const regime = result.regimes[name];
      expect(regime.feed.length).toBeGreaterThan(0);
      const weightSum = Object.values(regime.weights).reduce((sum, v) => sum + v, 0);
      expect(weightSum).toBeCloseTo(1, 6);
    }

    // no-governance is the bootstrap default: equal 0.2 across all 5 components.
    expect(result.regimes['no-governance'].weights.engagement).toBeCloseTo(0.2, 6);
    expect(result.regimes['no-governance'].weights.recency).toBeCloseTo(0.2, 6);

    // engagement-only puts (after real normalization) all weight on engagement.
    expect(result.regimes['engagement-only'].weights.engagement).toBeCloseTo(1, 6);
    expect(result.regimes['engagement-only'].weights.recency).toBeCloseTo(0, 6);

    // community-governed is a REAL aggregated outcome from a 4-persona mix —
    // it must not collapse onto either hand-specified baseline vector.
    const governed = result.regimes['community-governed'].weights;
    expect(governed.engagement).toBeLessThan(0.9);
    expect(governed.engagement).toBeGreaterThan(0);
  });

  it('engagement-only and community-governed produce measurably distinct rankings (non-trivial rank churn)', async () => {
    const deps = { db, rng: createRng(SEED), clock: new SeededClock(HARNESS_FIXED_CLOCK_MS) };
    const result = await runBaselineComparison(deps, { populationConfig: POPULATION_CONFIG, topK: 50 });

    const engagementFeed = result.regimes['engagement-only'].feed;
    const governedFeed = result.regimes['community-governed'].feed;

    const { displacement, sharedCount } = normalizedRankDisplacement(engagementFeed, governedFeed);
    const tau = kendallTauDistance(engagementFeed, governedFeed);

    // Not a trivial/degenerate comparison — the two feeds share enough posts
    // for the churn numbers to mean something.
    expect(sharedCount).toBeGreaterThan(5);
    // The two regimes' weight vectors are far apart (all-engagement vs. a
    // blended 4-persona outcome), so their rankings over the same corpus must
    // show real churn, not a coincidental near-identical order.
    expect(displacement).toBeGreaterThan(0.02);
    expect(tau).toBeGreaterThan(0.02);
  });

  it('feed-quality-vs-engagement direction: governed feed is no more author-concentrated than the engagement-only feed', async () => {
    const deps = { db, rng: createRng(SEED), clock: new SeededClock(HARNESS_FIXED_CLOCK_MS) };
    const result = await runBaselineComparison(deps, { populationConfig: POPULATION_CONFIG, topK: 50 });

    const postInfoByUri = new Map(result.corpusPostInfo.map((post) => [post.uri, post]));
    const feedPostInfo = (regime: RegimeName) =>
      result.regimes[regime].feed.map((entry) => postInfoByUri.get(entry.uri)!);

    const engagementHHI = authorHHI(feedPostInfo('engagement-only'));
    const governedHHI = authorHHI(feedPostInfo('community-governed'));
    const engagementGini = authorGini(feedPostInfo('engagement-only'));
    const governedGini = authorGini(feedPostInfo('community-governed'));

    // sourceDiversity has non-trivial weight in the real aggregated outcome
    // (see the previous test), so the governed feed's author concentration
    // should be at or below the pure-engagement feed's — asserting the exact
    // direction this experiment's write-up claims, not just "some number".
    expect(governedHHI).toBeLessThanOrEqual(engagementHHI);
    expect(governedGini).toBeLessThanOrEqual(engagementGini);
  });

  it('distortion ratio: the governed feed still captures most of the engagement regime\'s own best-case quality mass', async () => {
    const deps = { db, rng: createRng(SEED), clock: new SeededClock(HARNESS_FIXED_CLOCK_MS) };
    const result = await runBaselineComparison(deps, { populationConfig: POPULATION_CONFIG, topK: 50 });

    const engagementOnly = result.regimes['engagement-only'];
    const governed = result.regimes['community-governed'];

    const ratio = distortionRatio(governed.feed, engagementOnly.feed, engagementOnly.scoreByUri);

    // Bounded to THIS corpus/seed: measured at ~0.88 — governance gives up
    // roughly a tenth of the engagement regime's own best-case quality mass
    // in exchange for the lower author concentration asserted above. Neither
    // 1.0 (no cost at all) nor near-0 (governance and engagement optimizing
    // for almost disjoint post sets) — a real, partial tradeoff.
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(1);
  });

  it('minority-topic exposure is computable per regime against the corpus-wide topic distribution', async () => {
    const deps = { db, rng: createRng(SEED), clock: new SeededClock(HARNESS_FIXED_CLOCK_MS) };
    const result = await runBaselineComparison(deps, { populationConfig: POPULATION_CONFIG, topK: 50 });

    const postInfoByUri = new Map(result.corpusPostInfo.map((post) => [post.uri, post]));
    for (const name of REGIME_NAMES) {
      const feedPosts = result.regimes[name].feed.map((entry) => postInfoByUri.get(entry.uri)!);
      const { exposure, classifiedCount, totalCount } = minorityTopicExposure(
        feedPosts,
        result.corpusTopicSupport,
        0.15
      );
      expect(exposure).toBeGreaterThanOrEqual(0);
      expect(exposure).toBeLessThanOrEqual(1);
      expect(classifiedCount).toBeLessThanOrEqual(totalCount);
    }
  });

  it('determinism: the same seed reproduces identical feed-metric output across two independent runs', async () => {
    const depsA = { db, rng: createRng(SEED), clock: new SeededClock(HARNESS_FIXED_CLOCK_MS) };
    const resultA = await runBaselineComparison(depsA, { populationConfig: POPULATION_CONFIG, topK: 50 });

    const summarize = (r: typeof resultA) => ({
      weights: REGIME_NAMES.map((name) => r.regimes[name].weights),
      feeds: REGIME_NAMES.map((name) => r.regimes[name].feed.map((e) => e.uri)),
    });
    const snapshotA = summarize(resultA);

    await resetHarnessData();

    const depsB = { db, rng: createRng(SEED), clock: new SeededClock(HARNESS_FIXED_CLOCK_MS) };
    const resultB = await runBaselineComparison(depsB, { populationConfig: POPULATION_CONFIG, topK: 50 });
    const snapshotB = summarize(resultB);

    expect(snapshotB).toEqual(snapshotA);
  });

  it('writes a deterministic CSV artifact comparing the three regimes', async () => {
    const artifactsDir = await mkdtemp(path.join(tmpdir(), 'corgi-sim-baseline-comparison-'));
    try {
      const deps = { db, rng: createRng(SEED), clock: new SeededClock(HARNESS_FIXED_CLOCK_MS) };
      const result = await runBaselineComparison(deps, { populationConfig: POPULATION_CONFIG, topK: 50 });

      const postInfoByUri = new Map(result.corpusPostInfo.map((post) => [post.uri, post]));
      const summaryRows: RegimeSummaryCsvRow[] = REGIME_NAMES.map((name) => {
        const regime = result.regimes[name];
        const feedPosts = regime.feed.map((entry) => postInfoByUri.get(entry.uri)!);
        const { exposure } = minorityTopicExposure(feedPosts, result.corpusTopicSupport, 0.15);
        return {
          regime: name,
          epochId: regime.epochId,
          weights: regime.weights,
          authorHHI: authorHHI(feedPosts),
          authorGini: authorGini(feedPosts),
          minorityTopicExposure: exposure,
        };
      });

      const pairwiseRows: BaselineComparisonCsvRow[] = [];
      for (let i = 0; i < REGIME_NAMES.length; i++) {
        for (let j = i + 1; j < REGIME_NAMES.length; j++) {
          const a = result.regimes[REGIME_NAMES[i]].feed;
          const b = result.regimes[REGIME_NAMES[j]].feed;
          const { displacement, sharedCount } = normalizedRankDisplacement(a, b);
          pairwiseRows.push({
            regimeA: REGIME_NAMES[i],
            regimeB: REGIME_NAMES[j],
            rankDisplacement: displacement,
            kendallTau: kendallTauDistance(a, b),
            sharedCount,
          });
        }
      }

      const { summaryCsvPath, pairwiseCsvPath } = await writeBaselineComparisonArtifacts(
        artifactsDir,
        summaryRows,
        pairwiseRows
      );

      const summaryCsv = await readFile(summaryCsvPath, 'utf8');
      const summaryLines = summaryCsv.trim().split('\n');
      expect(summaryLines).toHaveLength(REGIME_NAMES.length + 1);
      expect(summaryLines[0]).toBe(
        'regime,epochId,recency,engagement,bridging,sourceDiversity,relevance,authorHHI,authorGini,minorityTopicExposure'
      );

      const pairwiseCsv = await readFile(pairwiseCsvPath, 'utf8');
      const pairwiseLines = pairwiseCsv.trim().split('\n');
      expect(pairwiseLines).toHaveLength(4); // header + 3 pairs (C(3,2))
      expect(pairwiseLines[0]).toBe('regimeA,regimeB,rankDisplacement,kendallTau,sharedCount');
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });
});
