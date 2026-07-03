/**
 * Population Generation Unit Tests
 *
 * Pure — no Postgres/Redis/Testcontainers dependency, same pattern as
 * prod-guard.test.ts / simulation.test.ts. `generatePopulation` is a pure
 * function of `(rng, clock, config)`, so it's fully exercisable here.
 */

import { describe, expect, it } from 'vitest';
import { generatePopulation } from '../../src/harness/population.js';
import { createRng, SeededClock } from '../../src/harness/rng.js';
import { DEFAULT_PERSONA_MIX } from '../../src/harness/personas.js';
import type { PopulationConfig } from '../../src/harness/scenario.js';

function buildConfig(overrides: Partial<PopulationConfig> = {}): PopulationConfig {
  return {
    subscriberCount: 30,
    postCount: 0,
    voteParticipationRate: 1,
    contentVoteRate: 0,
    castsWeightVoteRate: 0.5,
    castsTopicVoteRate: 0.5,
    personaMix: { ...DEFAULT_PERSONA_MIX },
    ...overrides,
  };
}

describe('generateVotes / castsWeightVoteRate', () => {
  it('produces a mix of weighted and keyword-only (weights: null) votes for a mid-range rate', () => {
    const rng = createRng(7);
    const clock = new SeededClock(0);

    const population = generatePopulation(rng, clock, buildConfig({ castsWeightVoteRate: 0.5 }));

    const weighted = population.votes.filter((vote) => vote.weights !== null);
    const keywordOnly = population.votes.filter((vote) => vote.weights === null);

    // Not a hardcoded golden count — just proves both branches are reachable
    // (the point of this fix) for a deterministic seed/config.
    expect(weighted.length).toBeGreaterThan(0);
    expect(keywordOnly.length).toBeGreaterThan(0);
    expect(weighted.length + keywordOnly.length).toBe(population.votes.length);
  });

  it('never produces a null-weight vote when castsWeightVoteRate is 1', () => {
    const rng = createRng(11);
    const clock = new SeededClock(0);

    const population = generatePopulation(rng, clock, buildConfig({ castsWeightVoteRate: 1 }));

    expect(population.votes.every((vote) => vote.weights !== null)).toBe(true);
  });

  it('always produces null-weight votes when castsWeightVoteRate is 0', () => {
    const rng = createRng(13);
    const clock = new SeededClock(0);

    const population = generatePopulation(rng, clock, buildConfig({ castsWeightVoteRate: 0 }));

    expect(population.votes.length).toBeGreaterThan(0);
    expect(population.votes.every((vote) => vote.weights === null)).toBe(true);
  });

  it('is deterministic: the same (seed, config) always produces the same weights: null pattern', () => {
    const config = buildConfig({ castsWeightVoteRate: 0.5 });

    const first = generatePopulation(createRng(99), new SeededClock(0), config);
    const second = generatePopulation(createRng(99), new SeededClock(0), config);

    expect(first.votes.map((vote) => vote.weights === null)).toEqual(
      second.votes.map((vote) => vote.weights === null)
    );
  });

  it('keyword-only (null-weight) votes always carry at least one keyword', () => {
    // Worst case: no weight opinions and contentVoteRate 0. Every vote is
    // keyword-only, and none would draw content by rate — they must still carry
    // keywords, otherwise the population is full of no-op votes the real API
    // would reject.
    const population = generatePopulation(
      createRng(23),
      new SeededClock(0),
      buildConfig({ castsWeightVoteRate: 0, contentVoteRate: 0 })
    );

    expect(population.votes.length).toBeGreaterThan(0);
    for (const vote of population.votes) {
      expect(vote.weights).toBeNull();
      expect(vote.includeKeywords.length + vote.excludeKeywords.length).toBeGreaterThan(0);
    }
  });

  it('produces no votes when there are no participants', () => {
    const rng = createRng(17);
    const clock = new SeededClock(0);

    // Zero subscribers => no voters (and no author-fallback misfire on votes).
    const noSubscribers = generatePopulation(rng, clock, buildConfig({ subscriberCount: 0 }));
    expect(noSubscribers.subscribers).toHaveLength(0);
    expect(noSubscribers.votes).toHaveLength(0);

    // Subscribers exist but nobody participates.
    const noParticipation = generatePopulation(rng, clock, buildConfig({ voteParticipationRate: 0 }));
    expect(noParticipation.votes).toHaveLength(0);
  });
});
