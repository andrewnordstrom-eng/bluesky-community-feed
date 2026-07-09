/**
 * Three-Way Baseline Comparison (A5 / PROJ-1486)
 *
 * The question this experiment answers: on ONE fixed synthetic corpus, is the
 * REAL community-governed feed better than an engagement-maximizing feed, and
 * at what cost? A2 (personas.ts) gave the governance harness realistic voter
 * archetypes; A3 (simulation.ts) drove multi-epoch convergence in WEIGHT
 * space; A4 (strategyproofness.ts) asked whether that voting process is
 * manipulable. This module is the first place the harness compares the
 * OUTCOME of governance against a baseline in FEED space — the ranked list of
 * posts a subscriber actually sees — rather than only in weight space.
 *
 * Three regimes, same corpus, same real scoring pipeline:
 *
 *   1. **no-governance**  — the engine's own bootstrap default
 *      (`createDefaultGovernanceWeightRecord()`: 0.2 across all 5
 *      components).
 *   2. **engagement-only** — all weight on `engagement`, 0 elsewhere, run
 *      through the real `normalizeWeights` (governance.types.ts) so it is
 *      scored with exactly the weight vector the real vote/aggregation path
 *      would ever produce for an all-engagement report, not a hand-rolled
 *      shortcut.
 *   3. **community-governed** — the REAL aggregated outcome: A2 persona
 *      votes (`generatePopulation`) are seeded into a fresh epoch and run
 *      through the REAL `aggregateVotes` -> `forceEpochTransition`, exactly
 *      as `Simulation.runEpochVoteCycle` (simulation.ts) does. This is the
 *      one regime whose weight vector is never hand-specified.
 *
 * For all three, the SAME fixed corpus (subscribers/posts/engagement/topics)
 * is seeded exactly once, and each regime's weights are scored by the REAL,
 * unmodified `runScoringPipeline` (src/scoring/pipeline.ts) into its own
 * epoch's `post_scores` rows — never a harness-side re-implementation of
 * scoring. Regimes 1/2 set their epoch's weight columns directly (no vote
 * aggregation involved — there is no "vote" for a fixed baseline weight
 * vector); regime 3 is the only one that ever calls `aggregateVotes`.
 *
 * Each regime gets its OWN epoch (never reusing/mutating one epoch across
 * regimes) so `post_scores.epoch_id` cleanly separates the three rankings,
 * and `readRankedFeed` below reads back exactly that: `post_scores` rows for
 * one `epoch_id`, ordered by `total_score DESC` then `post_uri ASC` for a
 * total order (same tie-break `Simulation.fetchTopScoredPosts` uses). This
 * mirrors the harness's established "drive the real engine, read back what it
 * persisted" convention (simulation.ts, strategyproofness.ts) rather than
 * reading Redis's `feed:current` — `writeToRedisFromDb` (pipeline.ts)
 * additionally applies `FEED_MIN_RELEVANCE`/`FEED_DEDUP_ENABLED`/
 * `FEED_MAX_POSTS`, which are presentation-layer concerns orthogonal to "how
 * did this weight vector rank the corpus"; reading `post_scores` directly
 * keeps the three regimes comparable on ranking alone.
 *
 * LOAD-BEARING INVARIANT — the three regimes run strictly SEQUENTIALLY,
 * never concurrently: `getActiveEpoch()` (src/db/queries/epochs.ts) and
 * `forceEpochTransition()` (epoch-manager.ts) both pick the single most
 * recent epoch by id (`status = 'active'`/`'voting'` ORDER BY id DESC LIMIT
 * 1) — there is no per-regime scoping. Prior regimes' epochs are never
 * closed by the fixed-weight path either (`insertFixedWeightEpoch` always
 * inserts `status = 'active'`). So regime isolation depends entirely on each
 * regime fully completing (scored + read back) before the next regime
 * inserts its epoch; running two regimes concurrently would race on which
 * epoch `getActiveEpoch()`/`forceEpochTransition()` sees. As defense in
 * depth, each regime's epoch is marked `status = 'closed'` immediately after
 * that regime's feed is read back (see the regime loop below), so a bug that
 * violates sequencing fails loudly (no active epoch / wrong epoch picked up)
 * instead of silently blending two regimes' data.
 *
 * Measurement notes: generated campaign artifacts, not this source comment,
 * are the source of truth for feed-impact numbers. The fixed comparison
 * corpus is intentionally synthetic and bounded to one seed; its output is
 * useful for reproducible rank-churn/concentration receipts, not for broad
 * claims about governance quality, engagement optimization, real Bluesky
 * content, or other populations. `minorityTopicExposure` can be zero when
 * the fixed corpus has no genuine tail topic at the selected threshold; see
 * `feed-metrics.test.ts` for non-zero metric behavior.
 */

import type { QueryableDb } from './simulation.js';
import type { Rng, Clock } from './rng.js';
import { generatePopulation, TOPIC_SLUGS, type Population, type PostSeed } from './population.js';
import type { PopulationConfig } from './scenario.js';
import { validateVote, type VoteValidationContext } from './vote-validation.js';
import { createDefaultGovernanceWeightRecord } from '../config/votable-params.js';
import { weightsToVotePayload, normalizeWeights } from '../governance/governance.types.js';
import type { GovernanceWeights } from '../shared/api-types.js';
import {
  authorGini,
  authorHHI,
  buildCorpusTopicSupport,
  kendallTauDistance,
  minorityTopicExposure,
  normalizedRankDisplacement,
  type FeedEntry,
  type FeedPostInfo,
} from './feed-metrics.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const REGIME_NAMES = ['no-governance', 'engagement-only', 'community-governed'] as const;
export type RegimeName = (typeof REGIME_NAMES)[number];

export interface BaselineComparisonDeps {
  db: QueryableDb;
  rng: Rng;
  clock: Clock;
}

export interface RegimeResult {
  regime: RegimeName;
  epochId: number;
  weights: GovernanceWeights;
  /** Ranked top-K feed for this regime, read back from `post_scores`. */
  feed: FeedEntry[];
  /** `post_uri -> total_score`, for every scored post in this regime's epoch
   *  (not just the top-K feed) — the full quality surface `distortionRatio`
   *  (feed-metrics.ts) needs to score another regime's feed by this regime's
   *  own yardstick. */
  scoreByUri: Map<string, number>;
}

export interface BaselineComparisonResult {
  population: Population;
  corpusTopicSupport: Record<string, number>;
  corpusPostInfo: FeedPostInfo[];
  regimes: Record<RegimeName, RegimeResult>;
}

/**
 * Deferred import of the governance/scoring modules this experiment drives —
 * same rationale as simulation.ts's / strategyproofness.ts's own
 * `loadGovernanceModules`: these transitively import `src/config.ts` /
 * `src/db/client.ts` / `src/db/redis.ts`, which have import-time side
 * effects (env parsing, opening a Redis connection). Deferring means merely
 * importing this file never triggers those; only calling
 * `runBaselineComparison` does.
 */
async function loadGovernanceModules() {
  const { aggregateVotes } = await import('../governance/aggregation.js');
  const { forceEpochTransition } = await import('../governance/epoch-manager.js');
  const { runScoringPipeline, __resetPipelineState } = await import('../scoring/pipeline.js');
  const { writeVoteWeights } = await import('../governance/weight-longtable.js');
  const { config } = await import('../config.js');
  return {
    aggregateVotes,
    forceEpochTransition,
    runScoringPipeline,
    __resetPipelineState,
    writeVoteWeights,
    config,
  };
}

type GovernanceModules = Awaited<ReturnType<typeof loadGovernanceModules>>;

/** Max rows per batched `INSERT ... VALUES (...),(...)` — same bound
 *  simulation.ts's `insertBatched` uses, kept local here to avoid depending
 *  on that file's private helpers (see this file's header: A5 follows A4's
 *  precedent of a self-contained harness module rather than reaching into
 *  `Simulation`'s private methods). */
const INSERT_BATCH_SIZE = 500;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function valuesClause(rowCount: number, colCount: number): string {
  const rows: string[] = [];
  for (let r = 0; r < rowCount; r++) {
    const base = r * colCount;
    const placeholders = Array.from({ length: colCount }, (_, c) => `$${base + c + 1}`);
    rows.push(`(${placeholders.join(', ')})`);
  }
  return rows.join(', ');
}

async function insertBatched<T>(
  db: QueryableDb,
  items: readonly T[],
  buildQuery: (batch: T[]) => { text: string; params: unknown[] }
): Promise<void> {
  for (const batch of chunk(items, INSERT_BATCH_SIZE)) {
    if (batch.length === 0) continue;
    const { text, params } = buildQuery(batch);
    await db.query(text, params);
  }
}

/**
 * Seed the fixed corpus ONCE: subscribers, posts + engagement, and active
 * topic slugs. No votes here — mirrors `Simulation.seedCorpus`'s split
 * (simulation.ts), reimplemented here (not imported — it is a private
 * method) at the same low level `strategyproofness.ts` already uses for its
 * own vote inserts.
 */
async function seedCorpus(db: QueryableDb, population: Population): Promise<void> {
  await insertBatched(db, population.subscribers, (batch) => ({
    text: `INSERT INTO subscribers (did) VALUES ${valuesClause(batch.length, 1)} ON CONFLICT (did) DO NOTHING`,
    params: batch.map((s) => s.did),
  }));

  await insertBatched(db, population.posts, (batch) => ({
    // PROJ-917: posts' PK widened to (uri, created_at) — partitioned tables
    // require the partition key in every unique constraint.
    text: `INSERT INTO posts (uri, cid, author_did, text, created_at, has_media, embed_url, topic_vector)
           VALUES ${valuesClause(batch.length, 8)}
           ON CONFLICT (uri, created_at) DO NOTHING`,
    params: batch.flatMap((post) => [
      post.uri,
      post.cid,
      post.authorDid,
      post.text,
      post.createdAt.toISOString(),
      post.hasMedia,
      post.embedUrl,
      JSON.stringify(post.topicVector),
    ]),
  }));

  await insertBatched(db, population.posts, (batch) => ({
    text: `INSERT INTO post_engagement (post_uri, like_count, repost_count, reply_count)
           VALUES ${valuesClause(batch.length, 4)}
           ON CONFLICT (post_uri) DO UPDATE SET
             like_count = EXCLUDED.like_count,
             repost_count = EXCLUDED.repost_count,
             reply_count = EXCLUDED.reply_count`,
    params: batch.flatMap((post) => [post.uri, post.likeCount, post.repostCount, post.replyCount]),
  }));

  const slugLabel = (slug: string): string =>
    slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  await insertBatched(db, TOPIC_SLUGS, (batch) => ({
    text: `INSERT INTO topic_catalog (slug, name, is_active)
           VALUES ${valuesClause(batch.length, 3)}
           ON CONFLICT (slug) DO UPDATE SET is_active = TRUE`,
    params: batch.flatMap((slug) => [slug, slugLabel(slug), true]),
  }));
}

/**
 * Insert a fresh epoch with the given weight vector directly on its weight
 * columns (`status = 'active'`, `phase = 'voting'`) — the "fixed-weight
 * injection" lever the no-governance and engagement-only regimes use INSTEAD
 * of vote aggregation: there is no vote to aggregate for a hand-specified
 * baseline vector, so this bypasses `aggregateVotes`/`forceEpochTransition`
 * entirely and writes the vector straight onto a new epoch row, mirroring
 * `Simulation.ensureActiveEpoch`'s INSERT shape (simulation.ts) but for an
 * arbitrary caller-supplied vector instead of only the bootstrap default.
 *
 * `phase = 'voting'` is set for consistency with every other epoch this
 * harness creates (vote-validation.ts only accepts votes into that phase) —
 * irrelevant here since this regime casts no votes, but keeps every epoch
 * this module creates uniform.
 */
async function insertFixedWeightEpoch(
  db: QueryableDb,
  weights: GovernanceWeights,
  description: string
): Promise<number> {
  const payload = weightsToVotePayload(weights);
  const inserted = await db.query<{ id: number }>(
    `INSERT INTO governance_epochs (
      status, phase, recency_weight, engagement_weight, bridging_weight,
      source_diversity_weight, relevance_weight, vote_count, description
    ) VALUES ('active', 'voting', $1, $2, $3, $4, $5, 0, $6)
    RETURNING id`,
    [
      payload.recency_weight,
      payload.engagement_weight,
      payload.bridging_weight,
      payload.source_diversity_weight,
      payload.relevance_weight,
      description,
    ]
  );
  return inserted.rows[0].id;
}

/**
 * Insert a fresh 'voting'-phase epoch, seeded with the bootstrap-equal 0.2
 * vector on its (NOT NULL) weight columns — a placeholder only, since this
 * epoch's weights are about to be overwritten by `forceEpochTransition`
 * aggregating the votes seeded into it — for the community-governed regime
 * to cast A2 persona votes into.
 */
async function insertVotingEpoch(db: QueryableDb, description: string): Promise<number> {
  const bootstrap = weightsToVotePayload(createDefaultGovernanceWeightRecord() as GovernanceWeights);
  const inserted = await db.query<{ id: number }>(
    `INSERT INTO governance_epochs (
      status, phase, recency_weight, engagement_weight, bridging_weight,
      source_diversity_weight, relevance_weight, vote_count, description
    ) VALUES ('active', 'voting', $1, $2, $3, $4, $5, 0, $6)
    RETURNING id`,
    [
      bootstrap.recency_weight,
      bootstrap.engagement_weight,
      bootstrap.bridging_weight,
      bootstrap.source_diversity_weight,
      bootstrap.relevance_weight,
      description,
    ]
  );
  return inserted.rows[0].id;
}

/**
 * Seed `population.votes` (A2 persona-driven weight votes — see
 * `generatePopulation`/`personas.ts`) into `epochId`, validating each vote
 * against the real `POST /api/governance/vote` route rules first
 * (`vote-validation.ts`) exactly as `Simulation.insertVotes` does, then
 * dual-writing into the `governance_vote_weights` long table when enabled —
 * without the dual-write, `aggregateVotes` would see zero eligible votes
 * whenever `GOVERNANCE_LONGTABLE_READ_ENABLED` is on (the production
 * default).
 */
/**
 * Fail loud, before any vote is seeded, when the long-table read/write flags
 * disagree: with READ on but DUALWRITE off, `aggregateVotes`
 * (src/governance/aggregation.ts) reads `governance_vote_weights` — a table the
 * governed regime never wrote into under that config — and sees 0 eligible
 * weight votes no matter how many are seeded. Left unchecked, that surfaces as
 * the generic "aggregateVotes returned null … no eligible weight votes" error,
 * mispointing an operator at participation-rate config instead of the real
 * cause (these two flags disagreeing). Exported as a pure function so the
 * precondition is unit-testable without a live config.
 */
export function assertLongtableWriteConfig(config: {
  GOVERNANCE_LONGTABLE_READ_ENABLED: boolean;
  GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED: boolean;
}): void {
  if (config.GOVERNANCE_LONGTABLE_READ_ENABLED && !config.GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED) {
    throw new Error(
      'GOVERNANCE_LONGTABLE_READ_ENABLED is on but GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED is off — ' +
        'aggregateVotes will read the (empty) governance_vote_weights long table and see 0 eligible weight votes ' +
        'regardless of how many votes are seeded. Enable GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED (or disable ' +
        'GOVERNANCE_LONGTABLE_READ_ENABLED) so seeded votes are visible to the real aggregation path.'
    );
  }
}

async function seedGovernedVotes(
  db: QueryableDb,
  modules: Pick<GovernanceModules, 'writeVoteWeights' | 'config'>,
  population: Population,
  epochId: number
): Promise<void> {
  assertLongtableWriteConfig(modules.config);

  if (population.votes.length === 0) {
    throw new Error(
      'seedGovernedVotes: population.votes is empty — the community-governed regime needs at least one ' +
        'eligible weight vote for aggregateVotes to produce a real outcome. Increase voteParticipationRate / ' +
        'castsWeightVoteRate in the population config.'
    );
  }

  const ctx: VoteValidationContext = {
    subscriberDids: new Set(population.subscribers.map((s) => s.did)),
    activeTopicSlugs: new Set(TOPIC_SLUGS),
    epochPhase: 'voting',
  };
  const failures: string[] = [];
  for (const vote of population.votes) {
    const weightFields = vote.weights ? weightsToVotePayload(vote.weights) : {};
    const result = validateVote(
      {
        voterDid: vote.voterDid,
        ...weightFields,
        include_keywords: vote.includeKeywords,
        exclude_keywords: vote.excludeKeywords,
        topic_weights: vote.topicWeights,
      },
      ctx
    );
    if (!result.valid) {
      failures.push(`${vote.voterDid}: ${result.errors.join('; ')}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `seedGovernedVotes: ${failures.length} generated vote(s) would be rejected by the real vote route:\n` +
        failures.slice(0, 10).join('\n')
    );
  }

  const rows = population.votes.map((vote) => ({
    voter_did: vote.voterDid,
    recency_weight: vote.weights?.recency ?? null,
    engagement_weight: vote.weights?.engagement ?? null,
    bridging_weight: vote.weights?.bridging ?? null,
    source_diversity_weight: vote.weights?.sourceDiversity ?? null,
    relevance_weight: vote.weights?.relevance ?? null,
    include_keywords: vote.includeKeywords.length > 0 ? vote.includeKeywords : null,
    exclude_keywords: vote.excludeKeywords.length > 0 ? vote.excludeKeywords : null,
    topic_weight_votes: Object.keys(vote.topicWeights).length > 0 ? vote.topicWeights : null,
  }));

  const voteIdByVoterDid = new Map<string, string>();
  for (const batch of chunk(rows, INSERT_BATCH_SIZE)) {
    const inserted = await db.query<{ id: string; voter_did: string }>(
      `INSERT INTO governance_votes (
        voter_did, epoch_id,
        recency_weight, engagement_weight, bridging_weight,
        source_diversity_weight, relevance_weight,
        include_keywords, exclude_keywords, topic_weight_votes
      )
      SELECT
        x.voter_did, $2::int,
        x.recency_weight, x.engagement_weight, x.bridging_weight,
        x.source_diversity_weight, x.relevance_weight,
        x.include_keywords, x.exclude_keywords, x.topic_weight_votes
      FROM jsonb_to_recordset($1::jsonb) AS x(
        voter_did text,
        recency_weight float8,
        engagement_weight float8,
        bridging_weight float8,
        source_diversity_weight float8,
        relevance_weight float8,
        include_keywords text[],
        exclude_keywords text[],
        topic_weight_votes jsonb
      )
      ON CONFLICT (voter_did, epoch_id) DO NOTHING
      RETURNING id, voter_did`,
      [JSON.stringify(batch), epochId]
    );
    for (const row of inserted.rows) {
      voteIdByVoterDid.set(row.voter_did, row.id);
    }
  }

  if (voteIdByVoterDid.size !== rows.length) {
    throw new Error(
      `seedGovernedVotes: ${rows.length - voteIdByVoterDid.size} of ${rows.length} generated vote(s) were ` +
        `not inserted into governance_votes for epoch ${epochId} (ON CONFLICT skipped them) — unexpected for ` +
        'a freshly-created epoch with unique voter DIDs.'
    );
  }

  if (!modules.config.GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED) {
    return;
  }
  for (const vote of population.votes) {
    if (!vote.weights) continue;
    const voteId = voteIdByVoterDid.get(vote.voterDid);
    if (voteId) {
      await modules.writeVoteWeights(voteId, vote.weights);
    }
  }
}

/** Read back the epoch's persisted weight vector — mirrors
 *  `Simulation.fetchEpochWeightsAndTopics`'s read-back convention (never
 *  recompute, always read what the real engine wrote). */
async function fetchEpochWeights(db: QueryableDb, epochId: number): Promise<GovernanceWeights> {
  const result = await db.query<{
    recency_weight: number;
    engagement_weight: number;
    bridging_weight: number;
    source_diversity_weight: number;
    relevance_weight: number;
  }>(
    `SELECT recency_weight, engagement_weight, bridging_weight, source_diversity_weight, relevance_weight
     FROM governance_epochs WHERE id = $1`,
    [epochId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`fetchEpochWeights: epoch ${epochId} not found`);
  }
  return {
    recency: Number(row.recency_weight),
    engagement: Number(row.engagement_weight),
    bridging: Number(row.bridging_weight),
    sourceDiversity: Number(row.source_diversity_weight),
    relevance: Number(row.relevance_weight),
  };
}

/**
 * Read back one regime's ranked feed from `post_scores` — same table/order
 * `Simulation.fetchTopScoredPosts` reads (simulation.ts), see this file's
 * header for why `post_scores` (not Redis `feed:current`) is the read-back
 * source of truth here. Also returns every scored post's `total_score`
 * (`scoreByUri`, unbounded by `limit`) — `feed-metrics.ts`'s
 * `distortionRatio` needs a regime's FULL scoring surface, not just its own
 * top-K, to score another regime's feed by this regime's yardstick.
 */
async function readRegimeResults(
  db: QueryableDb,
  epochId: number,
  limit: number
): Promise<{ feed: FeedEntry[]; scoreByUri: Map<string, number> }> {
  const result = await db.query<{ post_uri: string; total_score: number | string }>(
    `SELECT post_uri, total_score FROM post_scores WHERE epoch_id = $1 ORDER BY total_score DESC, post_uri ASC`,
    [epochId]
  );

  const scoreByUri = new Map<string, number>();
  for (const row of result.rows) {
    scoreByUri.set(row.post_uri, Number(row.total_score));
  }

  const feed = result.rows.slice(0, limit).map((row, index) => ({
    uri: row.post_uri,
    rank: index + 1,
  }));

  return { feed, scoreByUri };
}

/**
 * Defense-in-depth for the sequential-execution invariant documented in this
 * file's header: mark a regime's epoch `status = 'closed'` once that
 * regime's feed has been fully read back from `post_scores`, so a later
 * `getActiveEpoch()`/`forceEpochTransition()` call (from a subsequent
 * regime) can never accidentally pick up a stale regime's epoch. Safe to
 * call after read-back — nothing downstream re-reads this epoch's `status`
 * or re-scores it.
 */
async function closeRegimeEpoch(db: QueryableDb, epochId: number): Promise<void> {
  await db.query(`UPDATE governance_epochs SET status = 'closed', closed_at = NOW() WHERE id = $1`, [epochId]);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`runBaselineComparison: "${label}" did not complete within ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const DEFAULT_STEP_TIMEOUT_MS = 30_000;
const DEFAULT_FEED_TOP_K = 50;

export interface RunBaselineComparisonOptions {
  populationConfig: PopulationConfig;
  /** How many top-ranked posts to read back per regime (feed-space K). */
  topK?: number;
  pipelineStepTimeoutMs?: number;
}

/**
 * Seed one fixed corpus, then score it under all three regimes (see file
 * header), returning each regime's epoch id, weight vector, ranked top-K
 * feed, and full scoring surface, plus the corpus's own post/topic-support
 * data that `feed-metrics.ts`'s minority-topic/author metrics join against.
 */
export async function runBaselineComparison(
  deps: BaselineComparisonDeps,
  options: RunBaselineComparisonOptions
): Promise<BaselineComparisonResult> {
  const { db, rng, clock } = deps;
  const topK = options.topK ?? DEFAULT_FEED_TOP_K;
  const timeoutMs = options.pipelineStepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;

  const modules = await loadGovernanceModules();
  modules.__resetPipelineState();

  const population = generatePopulation(rng, clock, options.populationConfig);
  await seedCorpus(db, population);

  const corpusPostInfo: FeedPostInfo[] = population.posts.map((post: PostSeed) => ({
    uri: post.uri,
    authorDid: post.authorDid,
    topicVector: post.topicVector,
  }));

  const regimes: Partial<Record<RegimeName, RegimeResult>> = {};

  // These three regimes MUST run strictly sequentially (never concurrently)
  // — see this file's header "LOAD-BEARING INVARIANT" note:
  // getActiveEpoch()/forceEpochTransition() both pick the single most-recent
  // epoch by id, with no per-regime scoping. Each regime's epoch is closed
  // (defense-in-depth, see `closeRegimeEpoch`) immediately after that
  // regime's feed is read back, below.

  // Regime 1: no-governance — the engine's own bootstrap default.
  {
    const weights = createDefaultGovernanceWeightRecord() as GovernanceWeights;
    const epochId = await insertFixedWeightEpoch(db, weights, 'A5 baseline: no-governance (bootstrap default)');
    // Fixed-weight regimes never depend on the pipeline's incremental
    // epoch-tracking state left over from a prior regime — reset it so this
    // regime always does a genuine full rescore of the corpus against its
    // own weights, regardless of what regime (if any) ran before it.
    modules.__resetPipelineState();
    await withTimeout(modules.runScoringPipeline(), timeoutMs, 'runScoringPipeline[no-governance]');
    const persistedWeights = await fetchEpochWeights(db, epochId);
    const { feed, scoreByUri } = await readRegimeResults(db, epochId, topK);
    regimes['no-governance'] = { regime: 'no-governance', epochId, weights: persistedWeights, feed, scoreByUri };
    await closeRegimeEpoch(db, epochId);
  }

  // Regime 2: engagement-only — all weight on engagement, run through the
  // real normalizeWeights so it reflects exactly what the real vote path
  // would ever persist for this report.
  {
    const rawWeights: GovernanceWeights = {
      recency: 0,
      engagement: 1,
      bridging: 0,
      sourceDiversity: 0,
      relevance: 0,
    };
    const weights = normalizeWeights(rawWeights);
    const epochId = await insertFixedWeightEpoch(db, weights, 'A5 baseline: engagement-only');
    // See regime 1 above: reset before scoring so this regime's full rescore
    // never depends on the previous regime's incremental-tracking state.
    modules.__resetPipelineState();
    await withTimeout(modules.runScoringPipeline(), timeoutMs, 'runScoringPipeline[engagement-only]');
    const persistedWeights = await fetchEpochWeights(db, epochId);
    const { feed, scoreByUri } = await readRegimeResults(db, epochId, topK);
    regimes['engagement-only'] = { regime: 'engagement-only', epochId, weights: persistedWeights, feed, scoreByUri };
    await closeRegimeEpoch(db, epochId);
  }

  // Regime 3: community-governed — the REAL aggregated outcome from A2
  // persona votes, via the REAL aggregateVotes -> forceEpochTransition path.
  {
    const votingEpochId = await insertVotingEpoch(db, 'A5 baseline: community-governed (pre-aggregation)');
    await seedGovernedVotes(db, modules, population, votingEpochId);

    const aggregated = await withTimeout(
      modules.aggregateVotes(votingEpochId),
      timeoutMs,
      'aggregateVotes[community-governed]'
    );
    if (!aggregated) {
      throw new Error(
        'runBaselineComparison: aggregateVotes returned null for the community-governed regime — no eligible ' +
          'weight votes were seeded. Increase population.subscriberCount / voteParticipationRate / castsWeightVoteRate.'
      );
    }

    const epochId = await withTimeout(
      modules.forceEpochTransition(),
      timeoutMs,
      'forceEpochTransition[community-governed]'
    );
    // forceEpochTransition() scores the new epoch internally
    // (logTransitionImpact -> runScoringPipeline); no second scoring pass is
    // needed here. An explicit extra call here previously only "worked" by
    // landing in the pipeline's incremental "no changed posts" mode, purely
    // because this epoch's id happened to already equal lastScoredEpochId —
    // fragile, not a real invariant.
    const persistedWeights = await fetchEpochWeights(db, epochId);
    const { feed, scoreByUri } = await readRegimeResults(db, epochId, topK);
    regimes['community-governed'] = {
      regime: 'community-governed',
      epochId,
      weights: persistedWeights,
      feed,
      scoreByUri,
    };
    await closeRegimeEpoch(db, epochId);
  }

  // Dominant-topic tie-break is centralized in feed-metrics.ts's
  // buildCorpusTopicSupport (via dominantTopic) — reuse it here instead of
  // reimplementing the same sort/tie-break inline, so there is exactly one
  // place that decides a post's dominant topic.
  const corpusTopicSupport: Record<string, number> = buildCorpusTopicSupport(corpusPostInfo);

  return {
    population,
    corpusTopicSupport,
    corpusPostInfo,
    regimes: regimes as Record<RegimeName, RegimeResult>,
  };
}

// ============================================================================
// CSV artifact writer — mirrors metrics.ts's `writeArtifacts` /
// strategyproofness.ts's `writeStrategyproofnessArtifacts` convention: a
// `<baseDir>/baseline-comparison/` subdirectory, one `mkdir(recursive)` +
// one `writeFile`, plain CSV.
// ============================================================================

export interface BaselineComparisonCsvRow {
  regimeA: RegimeName;
  regimeB: RegimeName;
  rankDisplacement: number | null;
  kendallTau: number | null;
  sharedCount: number;
}

export interface RegimeSummaryCsvRow {
  regime: RegimeName;
  epochId: number;
  weights: GovernanceWeights;
  authorHHI: number | null;
  authorGini: number | null;
  minorityTopicExposure: number;
}

export interface BaselineComparisonArtifactRows {
  summaryRows: RegimeSummaryCsvRow[];
  pairwiseRows: BaselineComparisonCsvRow[];
}

function requirePostInfo(postInfoByUri: ReadonlyMap<string, FeedPostInfo>, uri: string): FeedPostInfo {
  const info = postInfoByUri.get(uri);
  if (!info) {
    throw new Error(
      `buildBaselineComparisonArtifactRows: uri "${uri}" is missing from corpusPostInfo — seeded corpus and scored feed have diverged`
    );
  }
  return info;
}

function sharedFeedCount(feedA: readonly FeedEntry[], feedB: readonly FeedEntry[]): number {
  const feedBUris = new Set(feedB.map((entry) => entry.uri));
  return feedA.reduce((count, entry) => count + (feedBUris.has(entry.uri) ? 1 : 0), 0);
}

export function buildBaselineComparisonArtifactRows(
  result: BaselineComparisonResult,
  tailThreshold: number
): BaselineComparisonArtifactRows {
  const postInfoByUri = new Map(result.corpusPostInfo.map((post) => [post.uri, post]));
  const summaryRows: RegimeSummaryCsvRow[] = REGIME_NAMES.map((name) => {
    const regime = result.regimes[name];
    const feedPosts = regime.feed.map((entry) => requirePostInfo(postInfoByUri, entry.uri));
    const { exposure } = minorityTopicExposure(feedPosts, result.corpusTopicSupport, tailThreshold);
    return {
      regime: name,
      epochId: regime.epochId,
      weights: regime.weights,
      authorHHI: feedPosts.length === 0 ? null : authorHHI(feedPosts),
      authorGini: feedPosts.length === 0 ? null : authorGini(feedPosts),
      minorityTopicExposure: exposure,
    };
  });

  const pairwiseRows: BaselineComparisonCsvRow[] = [];
  for (let i = 0; i < REGIME_NAMES.length; i += 1) {
    for (let j = i + 1; j < REGIME_NAMES.length; j += 1) {
      const regimeA = REGIME_NAMES[i];
      const regimeB = REGIME_NAMES[j];
      const a = result.regimes[regimeA].feed;
      const b = result.regimes[regimeB].feed;
      const sharedCount = sharedFeedCount(a, b);
      const displacement = sharedCount === 0 ? null : normalizedRankDisplacement(a, b).displacement;
      pairwiseRows.push({
        regimeA,
        regimeB,
        rankDisplacement: displacement,
        kendallTau: sharedCount < 2 ? null : kendallTauDistance(a, b),
        sharedCount,
      });
    }
  }

  return { summaryRows, pairwiseRows };
}

function csvNumber(value: number, digits = 6): string {
  return value.toFixed(digits);
}

function csvNullableNumber(value: number | null, digits: number): string {
  return value === null ? 'NA' : csvNumber(value, digits);
}

const PAIRWISE_CSV_HEADER = ['regimeA', 'regimeB', 'rankDisplacement', 'kendallTau', 'sharedCount'] as const;
const SUMMARY_CSV_HEADER = [
  'regime',
  'epochId',
  'recency',
  'engagement',
  'bridging',
  'sourceDiversity',
  'relevance',
  'authorHHI',
  'authorGini',
  'minorityTopicExposure',
] as const;

function toPairwiseCsv(rows: readonly BaselineComparisonCsvRow[]): string {
  const lines = rows.map((row) =>
    [
      row.regimeA,
      row.regimeB,
      row.rankDisplacement === null ? 'NA' : csvNumber(row.rankDisplacement),
      row.kendallTau === null ? 'NA' : csvNumber(row.kendallTau),
      row.sharedCount,
    ].join(',')
  );
  return `${PAIRWISE_CSV_HEADER.join(',')}\n${lines.join('\n')}\n`;
}

function toSummaryCsv(rows: readonly RegimeSummaryCsvRow[]): string {
  const lines = rows.map((row) =>
    [
      row.regime,
      row.epochId,
      csvNumber(row.weights.recency),
      csvNumber(row.weights.engagement),
      csvNumber(row.weights.bridging),
      csvNumber(row.weights.sourceDiversity),
      csvNumber(row.weights.relevance),
      csvNullableNumber(row.authorHHI, 6),
      csvNullableNumber(row.authorGini, 6),
      csvNumber(row.minorityTopicExposure),
    ].join(',')
  );
  return `${SUMMARY_CSV_HEADER.join(',')}\n${lines.join('\n')}\n`;
}

export interface WrittenBaselineComparisonPaths {
  summaryCsvPath: string;
  pairwiseCsvPath: string;
}

/**
 * Persist the three-regime comparison to `<baseDir>/baseline-comparison/`:
 * `regime-summary.csv` (one row per regime: weights + feed-quality metrics)
 * and `pairwise-churn.csv` (one row per regime pair: rank-churn metrics).
 */
export async function writeBaselineComparisonArtifacts(
  baseDir: string,
  summaryRows: readonly RegimeSummaryCsvRow[],
  pairwiseRows: readonly BaselineComparisonCsvRow[]
): Promise<WrittenBaselineComparisonPaths> {
  const dir = path.join(baseDir, 'baseline-comparison');
  await mkdir(dir, { recursive: true });

  const summaryCsvPath = path.join(dir, 'regime-summary.csv');
  const pairwiseCsvPath = path.join(dir, 'pairwise-churn.csv');

  await writeFile(summaryCsvPath, toSummaryCsv(summaryRows), 'utf8');
  await writeFile(pairwiseCsvPath, toPairwiseCsv(pairwiseRows), 'utf8');

  return { summaryCsvPath, pairwiseCsvPath };
}
