/**
 * Simulation Unit Tests
 *
 * Pure — no Postgres/Redis/Testcontainers dependency. `Simulation`'s
 * constructor and the `multi-epoch-cycle` fail-fast guard (checked before
 * any dynamic import of the governance/scoring modules) can be exercised
 * with a fake `QueryableDb` and ephemeral-looking connection strings, same
 * pattern as `prod-guard.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { Simulation, type QueryableDb, type SimulationDeps } from '../../src/harness/simulation.js';
import { createRng, SeededClock } from '../../src/harness/rng.js';
import type { Scenario } from '../../src/harness/scenario.js';

/** Never expected to be called by the guards this suite exercises. */
const unreachableDb: QueryableDb = {
  query: async () => {
    throw new Error('unreachable: Simulation.run() must not touch the db for an unimplemented scenario kind');
  },
};

function buildDeps(): SimulationDeps {
  return {
    rng: createRng(1),
    clock: new SeededClock(0),
    db: unreachableDb,
    databaseUrl: 'postgresql://corgi_sim:corgi_sim@127.0.0.1:55432/corgi_sim_test',
    redisUrl: 'redis://127.0.0.1:54932',
  };
}

describe('Simulation.run(): multi-epoch-cycle (reserved, unimplemented)', () => {
  it('throws a clear error instead of silently running a single round', async () => {
    const scenario: Scenario = {
      kind: 'multi-epoch-cycle',
      version: 1,
      seed: 1,
      rounds: 3,
      population: {
        subscriberCount: 10,
        postCount: 10,
        voteParticipationRate: 0.8,
        contentVoteRate: 0.2,
      },
    };

    const simulation = new Simulation(scenario, buildDeps());

    await expect(simulation.run()).rejects.toThrow(/multi-epoch-cycle.*not yet implemented/i);
  });

  it('still enforces the prod-guard before the scenario-kind check', async () => {
    const scenario: Scenario = {
      kind: 'multi-epoch-cycle',
      version: 1,
      seed: 1,
      rounds: 1,
      population: {
        subscriberCount: 1,
        postCount: 0,
        voteParticipationRate: 0,
        contentVoteRate: 0,
      },
    };

    const deps: SimulationDeps = {
      ...buildDeps(),
      databaseUrl: 'postgresql://feed:supersecret@127.0.0.1:5433/bluesky_feed',
    };

    const simulation = new Simulation(scenario, deps);

    await expect(simulation.run()).rejects.toThrow(/Refusing to run simulation/);
  });
});
