/**
 * Simulation
 *
 * Drives the REAL Corgi governance/scoring engine (aggregateVotes, an epoch
 * transition, runScoringPipeline) against injected Postgres/Redis. This is
 * the "drive" half of the harness — `metrics.ts` is the "measure" half.
 * Keeping them separate mirrors the DST system/simulator/observer split:
 * `Simulation` never computes metrics itself, it only produces a raw event
 * log that `measure()` turns into a `RunMetrics` snapshot.
 *
 * The governance/scoring modules (`src/governance/*`, `src/scoring/pipeline.js`)
 * are imported dynamically inside `run()`, AFTER the prod-guard check, rather
 * than statically at module top. Two reasons:
 *   1. Those modules transitively import `src/config.ts` (parses `process.env`
 *      at import time) and `src/db/redis.ts` (opens a TCP connection as an
 *      import side effect — see docs/agent build-bible §6). Deferring the
 *      import means constructing a `Simulation` never has that side effect;
 *      only calling `.run()` does, and only after the guard has already
 *      passed.
 *   2. It keeps `src/harness/index.ts` — not this file — as the sole
 *      externally-imported surface: nothing outside the harness needs to
 *      know these modules exist.
 */

import type { Rng, Clock } from './rng.js';
import type { Scenario } from './scenario.js';
import { generatePopulation, type Population } from './population.js';
import { assertEphemeralPostgresUrl, assertEphemeralRedisUrl, type GuardOptions } from './prod-guard.js';
import { createDefaultGovernanceWeightRecord } from '../config/votable-params.js';
import { weightsToVotePayload } from '../governance/governance.types.js';
import type { GovernanceWeights } from '../shared/api-types.js';

/** Minimal query surface `Simulation` needs to seed its own synthetic data. */
export interface QueryableDb {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface SimulationDeps {
  rng: Rng;
  clock: Clock;
  /** Used only for the harness's own population-seeding queries. */
  db: QueryableDb;
  /** Connection string backing `db` — checked by the prod-guard. */
  databaseUrl: string;
  /** Connection string backing the production Redis singleton — checked by the prod-guard. */
  redisUrl: string;
  guard?: GuardOptions;
}

export interface SimulationEvent {
  /** Simulated-time ISO timestamp (from the injected Clock, not wall clock). */
  at: string;
  type: string;
  data?: Record<string, unknown>;
}

export interface TopScoredPost {
  uri: string;
  rank: number;
  totalScore: number;
}

export interface SimulationResult {
  scenario: Scenario;
  population: Population;
  epochBeforeId: number;
  epochAfterId: number;
  aggregatedWeights: GovernanceWeights;
  scoredPostCount: number;
  topPosts: TopScoredPost[];
  events: SimulationEvent[];
}

/**
 * Seed the first governance epoch with equal default weights (mirrors
 * `scripts/seed-governance.ts`'s bootstrap, but driven from the
 * registry-derived default record so a 6th registered component doesn't
 * silently drift). No-ops if an active/voting epoch already exists.
 */
async function ensureActiveEpoch(db: QueryableDb): Promise<number> {
  const existing = await db.query<{ id: number }>(
    `SELECT id FROM governance_epochs WHERE status IN ('active', 'voting') ORDER BY id DESC LIMIT 1`
  );
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  const defaults = createDefaultGovernanceWeightRecord() as GovernanceWeights;
  const payload = weightsToVotePayload(defaults);

  const inserted = await db.query<{ id: number }>(
    `INSERT INTO governance_epochs (
      status, recency_weight, engagement_weight, bridging_weight,
      source_diversity_weight, relevance_weight, vote_count, description
    ) VALUES ('active', $1, $2, $3, $4, $5, 0, 'A1 simulation harness bootstrap epoch')
    RETURNING id`,
    [
      payload.recency_weight,
      payload.engagement_weight,
      payload.bridging_weight,
      payload.source_diversity_weight,
      payload.relevance_weight,
    ]
  );

  return inserted.rows[0].id;
}

export class Simulation {
  constructor(
    private readonly scenario: Scenario,
    private readonly deps: SimulationDeps
  ) {}

  async run(): Promise<SimulationResult> {
    assertEphemeralPostgresUrl(this.deps.databaseUrl, this.deps.guard);
    assertEphemeralRedisUrl(this.deps.redisUrl, this.deps.guard);

    // `ScenarioV1Schema` (scenario.ts) accepts `kind: 'multi-epoch-cycle'`
    // (with a `rounds` field) as a documented future shape, but this class
    // only ever drives a single aggregate -> transition -> score cycle today.
    // Without this check, a `multi-epoch-cycle` scenario would silently run
    // exactly one round — `rounds` quietly ignored — and still report
    // `scenarioKind: 'multi-epoch-cycle'` in its metrics, which would be a
    // convincing but wrong signal. Fail fast and loud instead until a real
    // multi-round driver is implemented.
    if (this.scenario.kind !== 'epoch-vote-cycle') {
      throw new Error(
        `Simulation.run(): scenario kind "${this.scenario.kind}" is not yet implemented. ` +
          `Only "epoch-vote-cycle" drives a real cycle today; "multi-epoch-cycle" is a ` +
          `reserved future shape (see src/harness/scenario.ts).`
      );
    }

    // Deferred import — see file header for why this must not be static.
    const { aggregateVotes } = await import('../governance/aggregation.js');
    const { forceEpochTransition } = await import('../governance/epoch-manager.js');
    const { runScoringPipeline, __resetPipelineState } = await import('../scoring/pipeline.js');
    const { writeVoteWeights } = await import('../governance/weight-longtable.js');
    const { config } = await import('../config.js');

    __resetPipelineState();

    const events: SimulationEvent[] = [];
    const record = (type: string, data?: Record<string, unknown>): void => {
      events.push({ at: this.deps.clock.now().toISOString(), type, data });
    };

    const epochBeforeId = await ensureActiveEpoch(this.deps.db);
    record('epoch_ensured', { epochId: epochBeforeId });

    const population = generatePopulation(this.deps.rng, this.deps.clock, this.scenario.population);
    record('population_generated', {
      subscriberCount: population.subscribers.length,
      postCount: population.posts.length,
      voteCount: population.votes.length,
    });

    await this.seedPopulation(population, epochBeforeId, {
      writeVoteWeights,
      dualWriteEnabled: config.GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED,
    });
    record('population_seeded', { epochId: epochBeforeId });

    // 1. Drive the REAL vote aggregation so the harness observes exactly
    //    what the production governance engine computes from the seeded votes.
    const aggregatedWeights = await aggregateVotes(epochBeforeId);
    if (!aggregatedWeights) {
      throw new Error(
        `aggregateVotes(${epochBeforeId}) returned null — no eligible weight votes were seeded. ` +
          'Increase population.subscriberCount / voteParticipationRate.'
      );
    }
    record('votes_aggregated', { epochId: epochBeforeId, weights: aggregatedWeights });

    // 2. Drive the REAL epoch-transition op. `forceEpochTransition` (rather
    //    than the vote-count-gated `triggerEpochTransition`) is used so small
    //    synthetic populations still transition deterministically; it
    //    internally re-runs aggregateVotes/aggregateContentVotes and, on a
    //    best-effort basis, one scoring pass for its transition-impact audit.
    const epochAfterId = await forceEpochTransition();
    record('epoch_transitioned', { fromEpochId: epochBeforeId, toEpochId: epochAfterId });

    // 3. Drive the REAL scoring pipeline as its own explicit, awaited step —
    //    decoupled from step 2's best-effort internal invocation, so a
    //    scoring failure here surfaces as a simulation failure rather than
    //    a swallowed warning.
    await runScoringPipeline();
    record('scoring_pipeline_run', { epochId: epochAfterId });

    const topPosts = await this.fetchTopScoredPosts(epochAfterId, 50);
    record('top_posts_fetched', { epochId: epochAfterId, count: topPosts.length });

    return {
      scenario: this.scenario,
      population,
      epochBeforeId,
      epochAfterId,
      aggregatedWeights,
      scoredPostCount: topPosts.length,
      topPosts,
      events,
    };
  }

  private async seedPopulation(
    population: Population,
    epochId: number,
    voteWeightDualWrite: {
      writeVoteWeights: (voteId: string, weights: GovernanceWeights) => Promise<void>;
      dualWriteEnabled: boolean;
    }
  ): Promise<void> {
    const { db } = this.deps;

    for (const subscriber of population.subscribers) {
      await db.query(`INSERT INTO subscribers (did) VALUES ($1) ON CONFLICT (did) DO NOTHING`, [
        subscriber.did,
      ]);
    }

    for (const post of population.posts) {
      await db.query(
        `INSERT INTO posts (uri, cid, author_did, text, created_at, has_media, embed_url, topic_vector)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (uri) DO NOTHING`,
        [
          post.uri,
          post.cid,
          post.authorDid,
          post.text,
          post.createdAt.toISOString(),
          post.hasMedia,
          post.embedUrl,
          JSON.stringify(post.topicVector),
        ]
      );
      await db.query(
        `INSERT INTO post_engagement (post_uri, like_count, repost_count, reply_count)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (post_uri) DO UPDATE SET
           like_count = EXCLUDED.like_count,
           repost_count = EXCLUDED.repost_count,
           reply_count = EXCLUDED.reply_count`,
        [post.uri, post.likeCount, post.repostCount, post.replyCount]
      );
    }

    for (const vote of population.votes) {
      if (!vote.weights) {
        continue;
      }
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO governance_votes (
          voter_did, epoch_id,
          recency_weight, engagement_weight, bridging_weight,
          source_diversity_weight, relevance_weight,
          include_keywords, exclude_keywords
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (voter_did, epoch_id) DO NOTHING
        RETURNING id`,
        [
          vote.voterDid,
          epochId,
          vote.weights.recency,
          vote.weights.engagement,
          vote.weights.bridging,
          vote.weights.sourceDiversity,
          vote.weights.relevance,
          vote.includeKeywords,
          vote.excludeKeywords,
        ]
      );

      // Mirror src/governance/routes/vote.ts's dual-write exactly: aggregateVotes
      // reads from the governance_vote_weights long table (not the wide columns
      // just inserted above) whenever GOVERNANCE_LONGTABLE_READ_ENABLED is on
      // (the production default) — without this, seeded votes would be
      // invisible to the real aggregateVotes the harness is driving.
      const voteId = inserted.rows[0]?.id;
      if (voteId && voteWeightDualWrite.dualWriteEnabled) {
        await voteWeightDualWrite.writeVoteWeights(voteId, vote.weights);
      }
    }
  }

  private async fetchTopScoredPosts(epochId: number, limit: number): Promise<TopScoredPost[]> {
    const result = await this.deps.db.query<{ post_uri: string; total_score: number | string }>(
      `SELECT post_uri, total_score FROM post_scores WHERE epoch_id = $1 ORDER BY total_score DESC, post_uri ASC LIMIT $2`,
      [epochId, limit]
    );

    return result.rows.map((row, index) => ({
      uri: row.post_uri,
      rank: index + 1,
      totalScore: Number(row.total_score),
    }));
  }
}
