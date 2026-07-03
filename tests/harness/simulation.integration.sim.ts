/**
 * Integration test: one full aggregate -> transition -> score cycle driven
 * against the real Testcontainers-backed Postgres + Redis stack.
 *
 * This is also what `npm run sim:core` runs.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runScenario } from '../../src/harness/index.js';
import { assertEphemeralPostgresUrl, assertEphemeralRedisUrl } from '../../src/harness/prod-guard.js';
import { db } from '../../src/db/client.js';
import { redis } from '../../src/db/redis.js';
import { buildSimulationDeps, resetHarnessData } from './helpers.js';

describe('Simulation: epoch-vote-cycle integration', () => {
  let artifactsDir: string;

  beforeAll(async () => {
    artifactsDir = await mkdtemp(path.join(tmpdir(), 'corgi-sim-artifacts-'));
  });

  afterEach(async () => {
    await resetHarnessData();
  });

  afterAll(async () => {
    await rm(artifactsDir, { recursive: true, force: true });
  });

  it('seeds epoch 1 + a synthetic population, then completes one real aggregate -> transition -> score cycle with zero prod contact', async () => {
    const deps = buildSimulationDeps(1234);

    // Zero prod contact: the exact same guard `Simulation.run()` calls
    // internally must pass on the URLs this test is about to drive against,
    // and those URLs must not resemble the known production signature.
    expect(() => assertEphemeralPostgresUrl(deps.databaseUrl)).not.toThrow();
    expect(() => assertEphemeralRedisUrl(deps.redisUrl)).not.toThrow();
    const pgUrl = new URL(deps.databaseUrl);
    const redisUrl = new URL(deps.redisUrl);
    expect(['127.0.0.1', 'localhost']).toContain(pgUrl.hostname);
    expect(pgUrl.port).not.toBe('5433');
    expect(['127.0.0.1', 'localhost']).toContain(redisUrl.hostname);
    expect(redisUrl.port).not.toBe('6380');

    const { metrics, artifacts, artifactPaths } = await runScenario(
      {
        kind: 'epoch-vote-cycle',
        version: 1,
        seed: 1234,
        population: {
          subscriberCount: 12,
          postCount: 20,
          voteParticipationRate: 0.9,
          // 0 content vote rate alone only made "zero content votes cast"
          // *likely*, not guaranteed: a voter who doesn't cast a weight vote
          // always casts a keyword vote regardless of contentVoteRate (see
          // population.ts), and aggregateContentVotes's promotion threshold
          // is computed against just those content-voters, so even a single
          // stray keyword-only vote can get promoted into a real (and
          // scoredPostCount-reducing) include-keyword filter. castsWeightVoteRate:
          // 1 removes that keyword-only path entirely, so contentVoteRate: 0
          // deterministically means aggregateContentVotes takes its
          // "no content votes" safety-net branch (exclude-only defaults, no
          // include-keyword restriction) — not just "usually" for this seed.
          castsWeightVoteRate: 1,
          contentVoteRate: 0,
        },
      },
      { deps, artifactsDir }
    );

    // Seeded epoch 1 -> transitioned to epoch 2 (RESTART IDENTITY in
    // resetHarnessData guarantees this is a fresh sequence starting at 1).
    expect(metrics.transition.fromEpochId).toBe(1);
    expect(metrics.transition.toEpochId).toBe(2);
    expect(metrics.aggregation.epochId).toBe(1);

    // Real aggregateVotes output: normalized weights sum to 1.
    expect(metrics.aggregation.weightSum).toBeCloseTo(1, 6);
    const weightValues = Object.values(metrics.aggregation.weights);
    expect(weightValues).toHaveLength(5);
    for (const value of weightValues) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }

    // Real runScoringPipeline output: every seeded post got scored into the
    // new epoch (first run against this epoch => full rescore, not incremental).
    expect(metrics.scoring.epochId).toBe(2);
    expect(metrics.scoring.scoredPostCount).toBe(20);
    expect(metrics.scoring.topPosts.length).toBe(20);
    expect(metrics.population.subscriberCount).toBe(12);
    expect(metrics.population.postCount).toBe(20);
    expect(metrics.population.voteCount).toBe(Math.round(12 * 0.9));

    // Ranks are contiguous starting at 1, descending by score.
    const ranks = metrics.scoring.topPosts.map((post) => post.rank);
    expect(ranks).toEqual(Array.from({ length: ranks.length }, (_, i) => i + 1));
    for (let i = 1; i < metrics.scoring.topPosts.length; i++) {
      expect(metrics.scoring.topPosts[i - 1].totalScore).toBeGreaterThanOrEqual(
        metrics.scoring.topPosts[i].totalScore
      );
    }

    // The event log recorded all three "drive" steps in order.
    const eventTypes = artifacts.events.map((event) => event.type);
    expect(eventTypes).toEqual([
      'epoch_ensured',
      'population_generated',
      'population_seeded',
      'votes_aggregated',
      'epoch_transitioned',
      'scoring_pipeline_run',
      'top_posts_fetched',
    ]);

    // Real audit trail: the epoch transition was actually persisted, not just computed in memory.
    const auditRows = await db.query<{ action: string }>(
      `SELECT action FROM governance_audit_log WHERE epoch_id = $1 ORDER BY id ASC`,
      [metrics.transition.toEpochId]
    );
    expect(auditRows.rows.map((r) => r.action)).toContain('epoch_created');

    // Real Redis write: the scored feed was published to the sorted set.
    const feedCount = await redis.get('feed:count');
    expect(Number(feedCount)).toBe(20);
    const feedEpoch = await redis.get('feed:epoch');
    expect(Number(feedEpoch)).toBe(2);

    // Artifacts were actually written to disk and are valid JSON matching the returned object.
    expect(artifactPaths).toBeDefined();
    const writtenJson = JSON.parse(await readFile(artifactPaths!.jsonPath, 'utf8'));
    expect(writtenJson.metrics).toEqual(metrics);
    const writtenCsv = await readFile(artifactPaths!.csvPath, 'utf8');
    expect(writtenCsv).toContain('epoch-vote-cycle');
  });

  it('rejects invalid scenario input via .safeParse before touching the database', async () => {
    const deps = buildSimulationDeps(1);

    await expect(
      runScenario({ kind: 'not-a-real-kind', version: 1, seed: 1 }, { deps })
    ).rejects.toThrow(/Invalid scenario/);

    // No epoch should have been created — the guard/parse rejected before any I/O.
    const epochs = await db.query(`SELECT id FROM governance_epochs`);
    expect(epochs.rows).toHaveLength(0);
  });
});
