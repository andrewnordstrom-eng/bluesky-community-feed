/**
 * Simulation Unit Tests
 *
 * Pure — no Postgres/Redis/Testcontainers dependency. `Simulation`'s
 * constructor and the prod-guard checks (run BEFORE either scenario-kind
 * driver ever touches the db — see `run()`) can be exercised with a fake
 * `QueryableDb` and ephemeral-looking connection strings, same pattern as
 * prod-guard.test.ts. The `multi-epoch-cycle` driver's actual behavior
 * (PROJ-1484 / A3) needs real Postgres/Redis and is covered by
 * multi-epoch-cycle.sim.ts instead.
 */

import { describe, expect, it } from 'vitest';
import { Simulation, type QueryableDb, type SimulationDeps } from '../../src/harness/simulation.js';
import { createRng, SeededClock } from '../../src/harness/rng.js';
import { DEFAULT_PERSONA_MIX } from '../../src/harness/personas.js';
import type { Scenario } from '../../src/harness/scenario.js';

/** Never expected to be called by the guards this suite exercises. */
const unreachableDb: QueryableDb = {
  query: async () => {
    throw new Error('unreachable: Simulation.run() must not touch the db before the prod-guard checks pass');
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

describe('Simulation.run(): prod-guard ordering (multi-epoch-cycle scenario)', () => {
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
        castsWeightVoteRate: 0.9,
        castsTopicVoteRate: 0.5,
        personaMix: { ...DEFAULT_PERSONA_MIX },
      },
    };

    const deps: SimulationDeps = {
      ...buildDeps(),
      databaseUrl: 'postgresql://feed:supersecret@127.0.0.1:5433/bluesky_feed',
    };

    const simulation = new Simulation(scenario, deps);

    await expect(simulation.run()).rejects.toThrow(/Refusing to run simulation/);
  });

  it('still enforces the Redis prod-guard even with an otherwise-ephemeral Postgres URL', async () => {
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
        castsWeightVoteRate: 0.9,
        castsTopicVoteRate: 0.5,
        personaMix: { ...DEFAULT_PERSONA_MIX },
      },
    };

    const deps: SimulationDeps = {
      ...buildDeps(),
      redisUrl: 'redis://127.0.0.1:6380',
    };

    const simulation = new Simulation(scenario, deps);

    await expect(simulation.run()).rejects.toThrow(/Refusing to run simulation/);
  });
});
