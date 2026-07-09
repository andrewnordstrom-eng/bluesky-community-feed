/**
 * Integration test: `multi-epoch-cycle` scenario (PROJ-1484 / A3) driven
 * against the real Testcontainers-backed Postgres + Redis stack.
 *
 * Covers what `epoch-vote-cycle` integration/golden tests already cover for
 * a single cycle, extended to a real K-round loop: `Simulation.run()`
 * dispatches to `runMultiEpochCycle` instead of throwing, every round drives
 * the REAL `forceEpochTransition`/`runScoringPipeline` (not a harness
 * reimplementation), the per-epoch CSV + audit-log artifacts are
 * well-formed, a homogeneous population's weight-vector series measurably
 * converges, and the whole run is deterministic for a fixed seed.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runScenario } from '../../src/harness/index.js';
import { Simulation } from '../../src/harness/simulation.js';
import { parseScenario } from '../../src/harness/scenario.js';
import { measureEpochSeries } from '../../src/harness/metrics.js';
import { weightVectorVariance, hasConverged, l2Distance } from '../../src/harness/convergence.js';
import { DEFAULT_PERSONA_MIX } from '../../src/harness/personas.js';
import { createDefaultGovernanceWeightRecord } from '../../src/config/votable-params.js';
import type { GovernanceWeights } from '../../src/shared/api-types.js';
import { db } from '../../src/db/client.js';
import { buildSimulationDeps, resetHarnessData, HARNESS_FIXED_CLOCK_MS } from './helpers.js';

describe('Simulation: multi-epoch-cycle integration', () => {
  let artifactsDir: string;

  beforeAll(async () => {
    artifactsDir = await mkdtemp(path.join(tmpdir(), 'corgi-sim-multi-epoch-artifacts-'));
  });

  afterEach(async () => {
    await resetHarnessData();
  });

  afterAll(async () => {
    await rm(artifactsDir, { recursive: true, force: true });
  });

  it('drives ROUNDS real aggregate -> transition -> score cycles, one metrics row per epoch, CSV + audit log well-formed', async () => {
    const ROUNDS = 6;
    const deps = buildSimulationDeps(4242);

    const { metrics, epochSeries, epochSeriesPaths } = await runScenario(
      {
        kind: 'multi-epoch-cycle',
        version: 1,
        seed: 4242,
        rounds: ROUNDS,
        population: {
          subscriberCount: 12,
          postCount: 5,
          voteParticipationRate: 1,
          contentVoteRate: 0,
          castsWeightVoteRate: 1,
          castsTopicVoteRate: 1,
        },
      },
      { deps, artifactsDir }
    );

    expect(metrics.scenarioKind).toBe('multi-epoch-cycle');
    expect(epochSeries).toBeDefined();
    expect(epochSeries).toHaveLength(ROUNDS);
    const rows = epochSeries!;

    // Rounds are numbered 1..ROUNDS in order, and each round's epoch chains
    // into the next (this round's toEpochId is the next round's fromEpochId)
    // — the loop is really re-using the epoch forceEpochTransition just
    // created, not seeding a disconnected epoch each time.
    expect(rows.map((row) => row.round)).toEqual(Array.from({ length: ROUNDS }, (_, i) => i + 1));
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].fromEpochId).toBe(rows[i - 1].toEpochId);
    }
    expect(rows[0].fromEpochId).toBeLessThan(rows[0].toEpochId);

    // Every round: 12 subscribers * 100% participation = 12 votes, and the
    // real aggregateVotes output (read back from governance_epochs) sums to 1.
    for (const row of rows) {
      expect(row.voteCount).toBe(12);
      expect(row.weightSum).toBeCloseTo(1, 6);
      expect(row.l2Displacement).toBeGreaterThanOrEqual(0);
    }

    // epochs.csv: one header + ROUNDS data lines, every line has the same
    // column count as the header (well-formed, not ragged).
    expect(epochSeriesPaths).toBeDefined();
    const csvContent = await readFile(epochSeriesPaths!.csvPath, 'utf8');
    const csvLines = csvContent.trim().split('\n');
    expect(csvLines).toHaveLength(ROUNDS + 1);
    const headerColumnCount = csvLines[0].split(',').length;
    for (const line of csvLines.slice(1)) {
      expect(line.split(',')).toHaveLength(headerColumnCount);
    }
    expect(csvLines[0]).toBe(
      'round,fromEpochId,toEpochId,voteCount,recency,engagement,bridging,sourceDiversity,relevance,weightSum,' +
        'topic_software-development,topic_sports,topic_music,topic_science,topic_politics,l2Displacement'
    );

    // audit-log.json: the REAL governance_audit_log rows this run's
    // forceEpochTransition calls wrote — 'epoch_closed' + 'epoch_created'
    // (forceEpochTransition itself) + 'epoch_transition_impact'
    // (logTransitionImpact) per round, in that order, id-ascending.
    const auditLogContent = await readFile(epochSeriesPaths!.auditLogPath, 'utf8');
    const auditLog = JSON.parse(auditLogContent) as Array<{ id: number; action: string; epochId: number | null }>;
    expect(auditLog).toHaveLength(ROUNDS * 3);
    expect(auditLog.map((row) => row.action)).toEqual(
      Array.from({ length: ROUNDS }, () => ['epoch_closed', 'epoch_created', 'epoch_transition_impact']).flat()
    );
    const auditIds = auditLog.map((row) => row.id);
    expect(auditIds).toEqual([...auditIds].sort((a, b) => a - b));
    expect(new Set(auditIds).size).toBe(auditIds.length);
  });

  it('a homogeneous, low-heterogeneity population converges: last-K weight-vector variance drops near 0', async () => {
    const ROUNDS = 20;
    const LAST_K = 10;
    // Loose enough to never flake on real trimmed-mean sampling noise at
    // N=60 voters, tight enough that it would fail if convergence.ts's math
    // were broken or the population were NOT actually homogeneous (a mixed
    // 4-persona population's cross-round variance is roughly two orders of
    // magnitude larger).
    const VARIANCE_THRESHOLD = 5e-3;

    const deps = buildSimulationDeps(777);
    const scenario = parseScenario({
      kind: 'multi-epoch-cycle',
      version: 1,
      seed: 777,
      rounds: ROUNDS,
      population: {
        subscriberCount: 60,
        postCount: 8,
        voteParticipationRate: 1,
        contentVoteRate: 0,
        castsWeightVoteRate: 1,
        castsTopicVoteRate: 0,
        // Homogeneous electorate: every participating voter is the SAME
        // persona (only 'balanced' has positive weight), so the only
        // remaining round-to-round noise source is that persona's own
        // jitter (personas.ts), not disagreement between personas.
        personaMix: { 'engagement-maximizer': 0, 'chronological-purist': 0, 'bridge-builder': 0, balanced: 1 },
      },
    });
    expect(scenario.success).toBe(true);
    if (!scenario.success) {
      return;
    }

    const result = await new Simulation(scenario.data, deps).run();
    expect(result.rounds).toHaveLength(ROUNDS);

    const weightSeries = result.rounds!.map((round) => round.weights);
    const lastKVariance = weightVectorVariance(weightSeries.slice(-LAST_K));

    expect(lastKVariance).toBeLessThan(VARIANCE_THRESHOLD);
    expect(hasConverged(weightSeries, LAST_K, VARIANCE_THRESHOLD)).toBe(true);

    // Every round actually landed a distinct weight vector (not a degenerate
    // "same object reused" false positive) while still staying tightly
    // clustered — spot-check the stable component (balanced's signature is
    // recency ~= engagement ~= bridging ~= sourceDiversity ~= relevance).
    for (const weights of weightSeries.slice(-LAST_K)) {
      expect(weights.recency).toBeCloseTo(0.2, 1);
      expect(weights.engagement).toBeCloseTo(0.2, 1);
    }
  }, 60_000);

  it('round-1 displacement baseline is the ACTUAL starting-epoch weights, not the bootstrap default', async () => {
    // Regression guard for the round-1 baseline fix. Pre-seed a NON-default
    // active epoch; ensureActiveEpoch reuses it, so round 1 transitions FROM
    // these weights. If the baseline ever regressed to hardcoded bootstrap
    // defaults (0.2 each), round-1's l2Displacement would be measured from the
    // wrong reference point and these assertions would fail.
    const startWeights: GovernanceWeights = {
      recency: 0.5,
      engagement: 0.5,
      bridging: 0,
      sourceDiversity: 0,
      relevance: 0,
    };
    await db.query(
      `INSERT INTO governance_epochs
         (status, phase, recency_weight, engagement_weight, bridging_weight,
          source_diversity_weight, relevance_weight, vote_count, description)
       VALUES ('active', 'voting', $1, $2, $3, $4, $5, 0, 'regression: non-default start epoch')`,
      [
        startWeights.recency,
        startWeights.engagement,
        startWeights.bridging,
        startWeights.sourceDiversity,
        startWeights.relevance,
      ]
    );

    const parsed = parseScenario({
      kind: 'multi-epoch-cycle',
      version: 1,
      seed: 77,
      rounds: 1,
      population: {
        subscriberCount: 30,
        postCount: 5,
        voteParticipationRate: 1,
        contentVoteRate: 0,
        castsWeightVoteRate: 1,
        castsTopicVoteRate: 1,
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const result = await new Simulation(parsed.data, buildSimulationDeps(77)).run();
    const round1 = result.rounds?.[0];
    expect(round1).toBeDefined();
    if (!round1) return;

    // Baseline is the ACTUAL non-default start weights (exact — l2Displacement
    // is computed from the same read-back the code uses)...
    expect(round1.l2Displacement).toBeCloseTo(l2Distance(startWeights, round1.weights), 6);
    // ...and measurably different from what a bootstrap-default baseline would
    // have produced — so a silent revert to defaults would fail this test.
    const fromDefaultBaseline = l2Distance(createDefaultGovernanceWeightRecord(), round1.weights);
    expect(Math.abs(round1.l2Displacement - fromDefaultBaseline)).toBeGreaterThan(0.05);
  }, 60_000);

  it('returns the drift-seeded round-1 votes when persona drift overrides the base mix', async () => {
    const parsed = parseScenario({
      kind: 'multi-epoch-cycle',
      version: 1,
      seed: 808,
      rounds: 2,
      population: {
        subscriberCount: 40,
        postCount: 5,
        voteParticipationRate: 1,
        contentVoteRate: 0,
        castsWeightVoteRate: 1,
        castsTopicVoteRate: 0,
        personaMix: { ...DEFAULT_PERSONA_MIX },
      },
      personaDrift: {
        from: { 'engagement-maximizer': 1, 'chronological-purist': 0, 'bridge-builder': 0, balanced: 0 },
        to: { 'engagement-maximizer': 0, 'chronological-purist': 0, 'bridge-builder': 1, balanced: 0 },
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const result = await new Simulation(parsed.data, buildSimulationDeps(808)).run();
    const returnedWeightVotes = result.population.votes.map((vote) => vote.weights);

    expect(result.rounds).toHaveLength(2);
    expect(result.rounds?.[0]?.voteCount).toBe(returnedWeightVotes.length);
    expect(returnedWeightVotes.every((weights) => weights !== null && weights.engagement > 0.5)).toBe(true);
    expect(result.rounds?.[0]?.weights.engagement).toBeGreaterThan(0.5);
    expect(result.rounds?.[1]?.weights.bridging).toBeGreaterThan(0.5);
  }, 60_000);

  it('uses the drift target mix for single-round persona drift runs', async () => {
    const parsed = parseScenario({
      kind: 'multi-epoch-cycle',
      version: 1,
      seed: 809,
      rounds: 1,
      population: {
        subscriberCount: 40,
        postCount: 5,
        voteParticipationRate: 1,
        contentVoteRate: 0,
        castsWeightVoteRate: 1,
        castsTopicVoteRate: 0,
        personaMix: { ...DEFAULT_PERSONA_MIX },
      },
      personaDrift: {
        from: { 'engagement-maximizer': 1, 'chronological-purist': 0, 'bridge-builder': 0, balanced: 0 },
        to: { 'engagement-maximizer': 0, 'chronological-purist': 0, 'bridge-builder': 1, balanced: 0 },
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const result = await new Simulation(parsed.data, buildSimulationDeps(809)).run();
    const returnedWeightVotes = result.population.votes.map((vote) => vote.weights);

    expect(result.rounds).toHaveLength(1);
    expect(returnedWeightVotes.every((weights) => weights !== null && weights.bridging > 0.5)).toBe(true);
    expect(result.rounds?.[0]?.weights.bridging).toBeGreaterThan(0.5);
  }, 60_000);

  it('same seed -> byte-identical per-epoch metrics across two independent runs', async () => {
    const ROUNDS = 6;

    // Freeze real wall-clock Date (same technique as golden-snapshot.sim.ts)
    // so production's recency scoring component — which reads Date.now()
    // directly and is out of scope to edit — computes the exact same post
    // age both runs. Without this, the two runs' post_scores (and the
    // scores embedded in the epoch_transition_impact audit rows) would
    // differ in their last few floating-point digits purely because the two
    // runs happen at genuinely different real instants, which isn't a
    // harness/governance determinism bug — it's real non-determinism this
    // test must control for, not assert away.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(HARNESS_FIXED_CLOCK_MS));

    try {
      const startMs = HARNESS_FIXED_CLOCK_MS;
      const scenarioInput = {
        kind: 'multi-epoch-cycle' as const,
        version: 1 as const,
        seed: 909,
        rounds: ROUNDS,
        population: {
          subscriberCount: 10,
          postCount: 5,
          voteParticipationRate: 1,
          contentVoteRate: 0.2,
          castsWeightVoteRate: 0.8,
          castsTopicVoteRate: 0.5,
          personaMix: { ...DEFAULT_PERSONA_MIX },
        },
      };

      const first = parseScenario(scenarioInput);
      expect(first.success).toBe(true);
      if (!first.success) return;
      const firstResult = await new Simulation(first.data, buildSimulationDeps(909, startMs)).run();
      const firstRows = measureEpochSeries(firstResult);
      const firstAudit = firstResult.auditLog ?? [];

      await resetHarnessData();

      const second = parseScenario(scenarioInput);
      expect(second.success).toBe(true);
      if (!second.success) return;
      const secondResult = await new Simulation(second.data, buildSimulationDeps(909, startMs)).run();
      const secondRows = measureEpochSeries(secondResult);
      const secondAudit = secondResult.auditLog ?? [];

      expect(secondRows).toHaveLength(ROUNDS);
      expect(JSON.stringify(secondRows)).toBe(JSON.stringify(firstRows));
      // Same audit-trail content, ids included (resetHarnessData's RESTART
      // IDENTITY resets the sequence). Compared directly with no field
      // stripping: AuditLogRow no longer surfaces the wall-clock created_at, so
      // the audit rows are inherently reproducible across runs.
      expect(JSON.stringify(secondAudit)).toBe(JSON.stringify(firstAudit));
    } finally {
      vi.useRealTimers();
    }
  });
});
