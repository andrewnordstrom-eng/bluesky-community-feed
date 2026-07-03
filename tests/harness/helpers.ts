/**
 * Shared test-only helpers for the A1 simulation-harness integration suite.
 *
 * NOT imported by src/harness — this is test infrastructure, analogous to
 * tests/stress/_helpers.ts (which also imports the real db/redis singletons
 * directly rather than mocking, for the same reason: these are the one
 * corner of the test suite meant to exercise real infrastructure).
 *
 * Must only be imported from a test file AFTER `setup-env.ts` (a vitest
 * `setupFiles` entry) has already set `process.env.DATABASE_URL` /
 * `REDIS_URL` — see that file's header comment for why ordering matters.
 */

import { db } from '../../src/db/client.js';
import { redis } from '../../src/db/redis.js';
import { createRng, SeededClock } from '../../src/harness/rng.js';
import type { SimulationDeps } from '../../src/harness/simulation.js';

/**
 * Fixed simulated "now" used only by the golden-snapshot smoke test, paired
 * there with `vi.useFakeTimers({ toFake: ['Date'] })` so recency scoring
 * (real wall-clock `Date.now()`, not Clock-injected) reads this exact
 * instant too, giving byte-for-byte reproducible scores independent of the
 * real calendar date the suite runs on.
 */
export const HARNESS_FIXED_CLOCK_MS = Date.UTC(2026, 0, 1, 12, 0, 0);

/**
 * Default clock anchor: a real `Date.now()` read taken once, here in test
 * setup — never inside `Simulation`/`population.ts`, which only ever see an
 * already-constructed `Clock` and must stay pure functions of it. This is
 * what production's `recency` scoring component (`src/scoring/components/
 * recency.ts`) implicitly requires: it computes post age against the REAL
 * wall clock (it isn't, and per the task, must not be, edited to take an
 * injected Clock), so seeded posts need `created_at` timestamps close to
 * real "now" to land inside `SCORING_WINDOW_HOURS` regardless of which
 * calendar day the suite happens to run on.
 *
 * Tests that need byte-for-byte reproducibility independent of the actual
 * wall-clock date (the golden-snapshot smoke test) instead pass a fixed
 * `startMs` here AND freeze `Date` itself with `vi.useFakeTimers({ toFake:
 * ['Date'] })` so recency scoring reads that same fixed instant too — see
 * golden-snapshot.sim.ts.
 */
export function buildSimulationDeps(seed: number, startMs: number = Date.now()): SimulationDeps {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl || !redisUrl) {
    throw new Error(
      'DATABASE_URL/REDIS_URL are not set — was this test file loaded without ' +
        'tests/harness/setup-env.ts as a vitest setupFiles entry?'
    );
  }

  return {
    rng: createRng(seed),
    clock: new SeededClock(startMs),
    db,
    databaseUrl,
    redisUrl,
  };
}

/**
 * Tables the harness itself writes to (population seeding + the real
 * governance/scoring writes it drives). Truncated between tests so each
 * test starts from a clean, epoch-free database.
 */
const HARNESS_TABLES = [
  'post_score_components',
  'post_scores',
  'post_engagement',
  'likes',
  'reposts',
  'follows',
  'posts',
  'governance_vote_weights',
  'governance_epoch_weights',
  'governance_votes',
  'governance_audit_log',
  'governance_epochs',
  'subscribers',
  'system_status',
  'topic_catalog',
] as const;

export async function resetHarnessData(): Promise<void> {
  await db.query(`TRUNCATE TABLE ${HARNESS_TABLES.join(', ')} RESTART IDENTITY CASCADE`);

  const feedKeys = await redis.keys('feed:*');
  if (feedKeys.length > 0) {
    await redis.del(...feedKeys);
  }
  const contentRuleKeys = await redis.keys('content_rules:*');
  if (contentRuleKeys.length > 0) {
    await redis.del(...contentRuleKeys);
  }
}

/**
 * Insert `count` bare subscriber rows (no posts/votes) — used by property
 * tests that only need real subscriber DIDs to satisfy `governance_votes`'
 * `voter_is_subscriber` foreign key, independent of full population
 * generation.
 */
export async function seedSubscribers(count: number, prefix = 'did:plc:corgipropsub'): Promise<string[]> {
  const dids = Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(6, '0')}`);
  for (const did of dids) {
    await db.query(`INSERT INTO subscribers (did) VALUES ($1) ON CONFLICT (did) DO NOTHING`, [did]);
  }
  return dids;
}

/** Insert a fresh 'active' governance epoch with equal default weights. Returns its id. */
export async function insertActiveEpoch(description = 'harness test epoch'): Promise<number> {
  const result = await db.query<{ id: number }>(
    `INSERT INTO governance_epochs (
      status, recency_weight, engagement_weight, bridging_weight,
      source_diversity_weight, relevance_weight, vote_count, description
    ) VALUES ('active', 0.2, 0.2, 0.2, 0.2, 0.2, 0, $1)
    RETURNING id`,
    [description]
  );
  return result.rows[0].id;
}
