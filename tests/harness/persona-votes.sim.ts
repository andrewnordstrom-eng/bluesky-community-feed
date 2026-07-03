/**
 * Persona-Driven Vote Integration Test (PROJ-1483 / A2)
 *
 * Real Testcontainers-backed Postgres + Redis (same stack as
 * simulation.integration.sim.ts). Confirms A2's actual deliverable
 * end-to-end: persona-driven synthetic voters — 5-component weight votes AND
 * topic-weight votes, both validated exactly as `POST /api/governance/vote`
 * would (vote-validation.ts) — are bulk-inserted at population scale, every
 * row is FK-valid against `subscribers`, and the REAL `aggregateVotes` /
 * `aggregateTopicWeights` (src/governance/aggregation.ts, not a harness
 * reimplementation) actually see them.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Simulation } from '../../src/harness/simulation.js';
import { parseScenario } from '../../src/harness/scenario.js';
import { db } from '../../src/db/client.js';
import { buildSimulationDeps, resetHarnessData } from './helpers.js';

const POPULATION_SIZE = 40;

describe('Persona-driven votes: bulk seed + real aggregation', () => {
  afterEach(async () => {
    await resetHarnessData();
  });

  it('seeds N persona voters with weight + topic-weight votes, all FK-valid, visible to aggregateVotes and aggregateTopicWeights', async () => {
    const deps = buildSimulationDeps(2026);

    const parsed = parseScenario({
      kind: 'epoch-vote-cycle',
      version: 1,
      seed: 2026,
      population: {
        subscriberCount: POPULATION_SIZE,
        postCount: 5,
        voteParticipationRate: 1,
        contentVoteRate: 0,
        castsWeightVoteRate: 1,
        castsTopicVoteRate: 1,
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }

    const simulation = new Simulation(parsed.data, deps);
    const result = await simulation.run();

    // Sanity: at these rates every one of the N voters cast both a weight
    // vote and a topic-weight vote (not a hardcoded handful of fixtures).
    expect(result.population.subscribers).toHaveLength(POPULATION_SIZE);
    expect(result.population.votes).toHaveLength(POPULATION_SIZE);
    for (const vote of result.population.votes) {
      expect(vote.weights).not.toBeNull();
      expect(Object.keys(vote.topicWeights).length).toBeGreaterThan(0);
    }

    // Bulk-inserted at N: one governance_votes row per voter, not a subset.
    const voteCount = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM governance_votes WHERE epoch_id = $1`,
      [result.epochBeforeId]
    );
    expect(Number(voteCount.rows[0].count)).toBe(POPULATION_SIZE);

    // FK-valid: every voter_did on a seeded vote is a real, active subscriber
    // row (voter_is_subscriber FK + the route's is_active check) — an
    // explicit anti-join, not just "the INSERT didn't throw".
    const orphanCount = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM governance_votes gv
       LEFT JOIN subscribers s ON s.did = gv.voter_did
       WHERE gv.epoch_id = $1 AND (s.did IS NULL OR s.is_active IS NOT TRUE)`,
      [result.epochBeforeId]
    );
    expect(Number(orphanCount.rows[0].count)).toBe(0);

    // Every topic slug any seeded vote carries is one the harness itself
    // registered active in topic_catalog — mirrors the real route's
    // slug-validity gate (vote-validation.ts), not just "some slug string".
    const votedSlugRows = await db.query<{ slug: string }>(
      `SELECT DISTINCT jsonb_object_keys(topic_weight_votes) AS slug
       FROM governance_votes
       WHERE epoch_id = $1 AND topic_weight_votes IS NOT NULL`,
      [result.epochBeforeId]
    );
    const activeSlugRows = await db.query<{ slug: string }>(
      `SELECT slug FROM topic_catalog WHERE is_active = TRUE`
    );
    const activeSlugs = new Set(activeSlugRows.rows.map((row) => row.slug));
    expect(votedSlugRows.rows.length).toBeGreaterThan(0);
    for (const row of votedSlugRows.rows) {
      expect(activeSlugs.has(row.slug)).toBe(true);
    }

    // Dual-write: every weight vote also landed in the governance_vote_weights
    // long table — the table the real aggregateVotes reads from whenever
    // GOVERNANCE_LONGTABLE_READ_ENABLED is on (the production default).
    const longTableVoteCount = await db.query<{ count: string }>(
      `SELECT COUNT(DISTINCT gvw.vote_id) AS count
       FROM governance_vote_weights gvw
       JOIN governance_votes gv ON gv.id = gvw.vote_id
       WHERE gv.epoch_id = $1`,
      [result.epochBeforeId]
    );
    expect(Number(longTableVoteCount.rows[0].count)).toBe(POPULATION_SIZE);

    // The REAL aggregateVotes (imported directly, not a harness
    // reimplementation) sees the seeded votes: re-running it against the
    // same epoch is idempotent (mirrors invariants.sim.ts's idempotency
    // property) and reproduces the exact weights Simulation.run() itself got.
    const { aggregateVotes, aggregateTopicWeights } = await import('../../src/governance/aggregation.js');
    const reaggregated = await aggregateVotes(result.epochBeforeId);
    expect(reaggregated).not.toBeNull();
    expect(reaggregated).toEqual(result.aggregatedWeights);

    // The REAL aggregateTopicWeights sees the seeded topic-weight votes too.
    const topicWeights = await aggregateTopicWeights(result.epochBeforeId);
    expect(Object.keys(topicWeights).length).toBeGreaterThan(0);
    for (const [slug, weight] of Object.entries(topicWeights)) {
      expect(activeSlugs.has(slug)).toBe(true);
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  it('seeds a mix of weight and keyword-only votes: null-weight rows insert FK-valid and are excluded from the long-table dual-write', async () => {
    const deps = buildSimulationDeps(7);

    const parsed = parseScenario({
      kind: 'epoch-vote-cycle',
      version: 1,
      seed: 7,
      population: {
        subscriberCount: POPULATION_SIZE,
        postCount: 5,
        voteParticipationRate: 1,
        contentVoteRate: 1, // every participant carries a keyword, so the...
        castsWeightVoteRate: 0.5, // ...~half who don't cast weights are route-valid keyword-only votes
        castsTopicVoteRate: 0.5,
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }

    const result = await new Simulation(parsed.data, deps).run();

    const weightVotes = result.population.votes.filter((v) => v.weights !== null);
    const keywordOnlyVotes = result.population.votes.filter((v) => v.weights === null);
    // Both paths genuinely exercised — not a degenerate all-one-kind population.
    expect(weightVotes.length).toBeGreaterThan(0);
    expect(keywordOnlyVotes.length).toBeGreaterThan(0);

    // Every participant (weight AND keyword-only) landed exactly one row.
    const voteCount = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM governance_votes WHERE epoch_id = $1`,
      [result.epochBeforeId]
    );
    expect(Number(voteCount.rows[0].count)).toBe(result.population.votes.length);

    // Keyword-only rows carry NULL weight columns (the jsonb_to_recordset null
    // path), not zeros and not a silently-dropped row — count matches the
    // harness's own ground truth for what it generated.
    const nullWeightRows = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM governance_votes
       WHERE epoch_id = $1 AND recency_weight IS NULL`,
      [result.epochBeforeId]
    );
    expect(Number(nullWeightRows.rows[0].count)).toBe(keywordOnlyVotes.length);

    // Dual-write covers exactly the weight votes; keyword-only votes have
    // nothing to write to the long table and are correctly skipped.
    const longTableVoteCount = await db.query<{ count: string }>(
      `SELECT COUNT(DISTINCT gvw.vote_id) AS count
       FROM governance_vote_weights gvw
       JOIN governance_votes gv ON gv.id = gvw.vote_id
       WHERE gv.epoch_id = $1`,
      [result.epochBeforeId]
    );
    expect(Number(longTableVoteCount.rows[0].count)).toBe(weightVotes.length);

    // FK-valid regardless of vote kind.
    const orphanCount = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM governance_votes gv
       LEFT JOIN subscribers s ON s.did = gv.voter_did
       WHERE gv.epoch_id = $1 AND (s.did IS NULL OR s.is_active IS NOT TRUE)`,
      [result.epochBeforeId]
    );
    expect(Number(orphanCount.rows[0].count)).toBe(0);
  });

  it('fails loud when a vote insert collides with an existing (voter_did, epoch_id) row', async () => {
    const deps = buildSimulationDeps(11);
    const scenario = {
      kind: 'epoch-vote-cycle' as const,
      version: 1 as const,
      seed: 11,
      population: {
        subscriberCount: 12,
        postCount: 5,
        voteParticipationRate: 1, // all subscribers vote → index 0 is guaranteed to cast
        contentVoteRate: 0,
        castsWeightVoteRate: 1,
        castsTopicVoteRate: 1,
      },
    };

    // Run 1: seeds subscribers + votes into epoch E1, then transitions to a
    // fresh 'voting' epoch E2 (no votes yet).
    const first = parseScenario(scenario);
    expect(first.success).toBe(true);
    if (!first.success) {
      return;
    }
    const firstResult = await new Simulation(first.data, deps).run();

    // Pre-plant a vote for one of the harness's own subscribers in the
    // now-active epoch E2, manufacturing the (voter_did, epoch_id) collision
    // the harness normally avoids by using a fresh epoch per cycle. Derive the
    // DID from the generated population rather than hardcoding
    // generateSubscribers()'s prefix/padding, so a change to that format keeps
    // this test correct instead of failing with a misleading FK error. The
    // subscriber row already exists from run 1 (FK holds); all-null weight
    // columns satisfy the post-006 all-null CHECK. At voteParticipationRate: 1
    // and a fixed seed, this DID is guaranteed to cast again in run 2 (same
    // population), so the collision is deterministic.
    const collisionDid = firstResult.population.subscribers[0].did;
    const activeEpoch = await db.query<{ id: number }>(
      `SELECT id FROM governance_epochs WHERE status IN ('active', 'voting') ORDER BY id DESC LIMIT 1`
    );
    const epochId = activeEpoch.rows[0].id;
    await db.query(`INSERT INTO governance_votes (voter_did, epoch_id) VALUES ($1, $2)`, [
      collisionDid,
      epochId,
    ]);

    // Run 2 reuses E2 (ensureActiveEpoch) and regenerates a vote for
    // corgisimsub000000 → ON CONFLICT (voter_did, epoch_id) silently skips that
    // one row → the invariant must throw rather than let population.votes
    // diverge from what's actually in Postgres.
    const second = parseScenario(scenario);
    expect(second.success).toBe(true);
    if (!second.success) {
      return;
    }
    await expect(new Simulation(second.data, deps).run()).rejects.toThrow(
      /were not inserted into governance_votes/
    );
  });
});
