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
import type { PopulationConfig } from '../../src/harness/scenario.js';

function buildConfig(overrides: Partial<PopulationConfig> = {}): PopulationConfig {
  return {
    subscriberCount: 30,
    postCount: 0,
    voteParticipationRate: 1,
    contentVoteRate: 0,
    castsWeightVoteRate: 0.5,
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
});
