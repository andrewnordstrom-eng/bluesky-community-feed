/**
 * Fixed-seed golden-snapshot smoke test.
 *
 * Runs the whole config -> run -> artifacts pipeline once, with a fixed seed
 * and a frozen `Date` (so the real-wall-clock `recency` scoring component
 * reads the same instant every run), and asserts the resulting `RunMetrics`
 * exactly match a checked-in fixture. A snapshot diff here is a genuine
 * whole-pipeline regression/drift signal — CI fails loudly on it, it is not
 * a warning.
 *
 * Only `metrics` is snapshotted, not the full `RunArtifacts` envelope:
 * `runId` (a fresh UUID) and `generatedAt` (wall-clock write time) are
 * intentionally excluded from the deterministic surface — see metrics.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runScenario } from '../../src/harness/index.js';
import { buildSimulationDeps, resetHarnessData, HARNESS_FIXED_CLOCK_MS } from './helpers.js';

describe('golden snapshot: epoch-vote-cycle, seed=42', () => {
  beforeEach(() => {
    // Freeze real wall-clock Date so production's recency component (which
    // reads Date.now() directly and is out of scope to edit) computes the
    // same post age every run. Only `Date` is faked — setTimeout/setInterval
    // stay real so Postgres/Redis I/O behaves normally.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(HARNESS_FIXED_CLOCK_MS));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await resetHarnessData();
  });

  it('matches the checked-in golden metrics fixture', async () => {
    const deps = buildSimulationDeps(42, HARNESS_FIXED_CLOCK_MS);

    const { metrics } = await runScenario(
      {
        kind: 'epoch-vote-cycle',
        version: 1,
        seed: 42,
        population: {
          subscriberCount: 8,
          postCount: 10,
          voteParticipationRate: 1,
          contentVoteRate: 0,
        },
      },
      { deps }
    );

    await expect(JSON.stringify(metrics, null, 2)).toMatchFileSnapshot(
      './__golden__/epoch-vote-cycle-seed-42.metrics.json'
    );
  });
});
