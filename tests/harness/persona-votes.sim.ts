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
});
