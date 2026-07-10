/**
 * Scoring Pipeline
 *
 * The main orchestrator that:
 * 1. Gets current governance epoch and weights
 * 2. Queries posts in the scoring window
 * 3. Scores each post with all 5 components
 * 4. Stores decomposed scores to PostgreSQL (GOLDEN RULE)
 * 5. Writes ranked posts to Redis for fast feed serving
 *
 * This runs every 5 minutes via the scheduler.
 */

import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { config } from '../config.js';
import { invalidateCurrentFeedSnapshot } from '../feed/snapshot-cache.js';
import { logger } from '../lib/logger.js';
import { getActiveEpoch } from '../db/queries/epochs.js';
import { randomUUID } from 'crypto';
import { createAuthorCountMap, scoreSourceDiversity } from './components/source-diversity.js';
import {
  GovernanceEpoch,
  PostForScoring,
  ScoredPost,
  ScoreComponents,
  toPostForScoring,
} from './score.types.js';
import { DEFAULT_COMPONENTS } from './registry.js';
import type { ScoringContext } from './component.interface.js';
import type { GovernanceWeightKey } from '../config/votable-params.js';
import {
  getCurrentContentRules,
  filterPosts,
  hasActiveContentRules,
} from '../governance/content-filter.js';
import type { ContentRules } from '../governance/governance.types.js';
import { updateScoringStatus } from '../admin/status-tracker.js';
import { calculateAuthorConcentration } from '../transparency/metrics.js';

// Maximum time allowed for a single scoring run.
const SCORING_TIMEOUT_MS = config.SCORING_TIMEOUT_MS;
const SCORING_CANDIDATE_LIMIT = config.SCORING_CANDIDATE_LIMIT;
const SQL_BOUNDARY_KEYWORD_PATTERN = /^[a-z0-9][a-z0-9\s-]*$/;
const EPOCH_METRICS_CURRENT_FEED_RETENTION_ROWS = 24;
const FEED_CURRENT_KEY = 'feed:current';
const FEED_LAST_KNOWN_GOOD_KEY = 'feed:last_known_good';
const FEED_EMPTY_RESULT_SKIPPED_TOTAL_KEY = 'feed:empty_result_skipped_total';
const FEED_LAST_EMPTY_RESULT_AT_KEY = 'feed:last_empty_result_at';
const FEED_STAGED_CURRENT_PREFIX = 'feed:staging:current:';
const FEED_STAGED_LAST_KNOWN_GOOD_PREFIX = 'feed:staging:last_known_good:';
const FEED_STAGED_METADATA_PREFIX = 'feed:staging:metadata:';
const FEED_STAGING_TTL_SECONDS = Math.ceil((SCORING_TIMEOUT_MS * 2) / 1000);
const PUBLISH_STAGED_FEED_SCRIPT = `
local sourceCount = tonumber(ARGV[1])
if sourceCount == nil or sourceCount <= 0 or #KEYS ~= sourceCount * 2 then
  return redis.error_reply('invalid staged feed publish arguments')
end
for index = 1, sourceCount do
  if redis.call('EXISTS', KEYS[index]) ~= 1 then
    return redis.error_reply('missing staged feed publish key at index ' .. index)
  end
end
for index = 1, sourceCount do
  local destinationIndex = sourceCount + index
  redis.call('RENAME', KEYS[index], KEYS[destinationIndex])
  redis.call('PERSIST', KEYS[destinationIndex])
end
return 1
`;

type RedisTransactionResult = Array<[Error | null, unknown]>;

class RedisTransactionAbortedError extends Error {
  constructor(operation: string) {
    super(`Redis transaction aborted during ${operation}: exec returned null`);
    this.name = 'RedisTransactionAbortedError';
  }
}

class RedisTransactionCommandError extends Error {
  constructor(operation: string, commandIndex: number, cause: Error) {
    super(
      `Redis transaction failed during ${operation} at command ${commandIndex}: ${cause.message}`,
      { cause }
    );
    this.name = 'RedisTransactionCommandError';
  }
}

// Track last successful run for health checks
let lastSuccessfulRunAt: Date | null = null;

// Track last scored epoch to detect epoch transitions (triggers full rescore)
let lastScoredEpochId: number | null = null;

// Count incremental runs since last full rescore (triggers periodic full rescore for recency decay)
let incrementalRunCount = 0;

// Avoid repeated warnings when a rollout exposes a missing dynamic component weight.
let missingWeightWarned = new Set<string>();
let scoringRunInFlight: Promise<void> | null = null;

function assertRedisTransactionSucceeded(
  results: RedisTransactionResult | null,
  operation: string
): void {
  if (results === null) {
    throw new RedisTransactionAbortedError(operation);
  }

  for (const [index, [error]] of results.entries()) {
    if (error !== null) {
      throw new RedisTransactionCommandError(operation, index, error);
    }
  }
}

async function cleanupStagedFeedPublish(stagedKeys: string[]): Promise<void> {
  try {
    await redis.del(...stagedKeys);
  } catch (error) {
    logger.warn(
      { error, stagedKeys },
      'Failed to clean up staged feed publish keys'
    );
  }
}

interface CurrentFeedStatsSnapshot {
  totalPostsScored: number;
  uniqueAuthors: number;
  avgBridging: number;
  avgEngagement: number;
  medianBridging: number;
  medianTotal: number;
  authorGini: number;
}

interface FeedPublicationResult {
  published: boolean;
  feedStatsSnapshot: CurrentFeedStatsSnapshot | null;
}

interface RedisFeedCandidate {
  post_uri: string;
  total_score: number;
  author_did: string;
  bridging_score: number;
  engagement_score: number;
  embed_url: string | null;
  text_length: number;
}

/**
 * Get the timestamp of the last successful scoring run.
 */
export function getLastScoringRunAt(): Date | null {
  return lastSuccessfulRunAt;
}

/**
 * Reset module-level state for testing.
 */
export function __resetPipelineState(): void {
  lastSuccessfulRunAt = null;
  lastScoredEpochId = null;
  incrementalRunCount = 0;
  missingWeightWarned = new Set<string>();
  scoringRunInFlight = null;
}

/**
 * Run the complete scoring pipeline with timeout.
 * This is the main entry point called by the scheduler.
 */
export async function runScoringPipeline(): Promise<void> {
  if (scoringRunInFlight !== null) {
    logger.warn('Scoring pipeline already running; skipping overlapping trigger');
    return;
  }

  const scoringRun = runScoringPipelineInternal();
  scoringRunInFlight = scoringRun;
  void scoringRun.then(
    () => {
      if (scoringRunInFlight === scoringRun) {
        scoringRunInFlight = null;
      }
    },
    () => {
      if (scoringRunInFlight === scoringRun) {
        scoringRunInFlight = null;
      }
    }
  );

  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error('Scoring pipeline timed out')),
      SCORING_TIMEOUT_MS
    );
  });

  try {
    await Promise.race([
      scoringRun,
      timeoutPromise,
    ]);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  }
}

/**
 * Internal scoring pipeline logic.
 */
async function runScoringPipelineInternal(): Promise<void> {
  const startTime = Date.now();
  logger.info('Starting scoring pipeline');

  try {
    // 1. Get current governance epoch and weights
    const epoch = await getActiveEpoch();
    if (!epoch) {
      logger.error('No active governance epoch found. Cannot score.');
      return;
    }
    const runId = randomUUID();

    logger.info({ epochId: epoch.id, runId }, 'Using governance epoch');

    // 2. Load content rules and determine scoring mode (full vs incremental).
    const contentRules = await getCurrentContentRules();
    const epochChanged = lastScoredEpochId !== null && lastScoredEpochId !== epoch.id;
    const isFirstRun = lastSuccessfulRunAt === null;

    // Force a full rescore periodically to catch recency decay
    const fullRescoreDue = incrementalRunCount >= config.SCORING_FULL_RESCORE_INTERVAL;
    const useIncremental = !isFirstRun && !epochChanged && !fullRescoreDue;

    if (fullRescoreDue && !isFirstRun && !epochChanged) {
      logger.info(
        { incrementalRunCount, interval: config.SCORING_FULL_RESCORE_INTERVAL },
        'Periodic full rescore triggered to refresh recency decay'
      );
    }

    let allPosts: PostForScoring[];
    if (useIncremental) {
      allPosts = await getPostsForIncrementalScoring(contentRules, epoch.id);
      logger.info(
        {
          mode: 'incremental',
          postCount: allPosts.length,
          epochId: epoch.id,
          includeKeywords: contentRules.includeKeywords.length,
          excludeKeywords: contentRules.excludeKeywords.length,
        },
        'Incremental candidate posts fetched for scoring'
      );
    } else {
      allPosts = await getPostsForScoring(contentRules);
      logger.info(
        {
          mode: 'full',
          postCount: allPosts.length,
          epochId: epoch.id,
          reason: epochChanged ? 'epoch_changed' : fullRescoreDue ? 'periodic_full_rescore' : 'first_run',
          includeKeywords: contentRules.includeKeywords.length,
          excludeKeywords: contentRules.excludeKeywords.length,
        },
        'Full candidate posts fetched for scoring'
      );
    }

    if (allPosts.length === 0 && !useIncremental) {
      logger.warn({ epochId: epoch.id }, 'No posts to score in the window');
    }

    // 2b. Apply content filtering as a backup guard.
    // SQL prefilter should handle most cases; JS filter catches any regex edge cases.
    let posts = allPosts;

    if (hasActiveContentRules(contentRules)) {
      const filterResult = filterPosts(allPosts, contentRules);
      posts = filterResult.passed;

      logger.info(
        {
          epochId: epoch.id,
          candidatePosts: allPosts.length,
          passedFilter: posts.length,
          filteredOut: filterResult.filtered.length,
          includeKeywords: contentRules.includeKeywords.length,
          excludeKeywords: contentRules.excludeKeywords.length,
          sqlPrefiltered: true,
        },
        'Content filtering backup applied'
      );

      if (posts.length === 0 && !useIncremental) {
        logger.warn({ epochId: epoch.id }, 'All posts filtered out by content rules');
      }
    }

    logger.info({ postCount: posts.length, epochId: epoch.id, mode: useIncremental ? 'incremental' : 'full' }, 'Scoring filtered posts');

    // 3. Score each post
    const scored = await scoreAllPosts(posts, epoch, runId);

    // 4. Write the full ranked feed to Redis from stored scores.
    // In incremental mode, only new/changed posts were scored above, but
    // previous scores remain in post_scores. Reading from DB gives the
    // complete, correctly-ranked feed.
    const feedPublication = await writeToRedisFromDb(epoch.id, runId);

    const elapsed = Date.now() - startTime;
    logger.info(
      { elapsed, postsScored: posts.length, epochId: epoch.id, mode: useIncremental ? 'incremental' : 'full' },
      'Scoring pipeline complete'
    );

    // Track successful run for health checks
    lastSuccessfulRunAt = new Date();
    lastScoredEpochId = epoch.id;

    // Track incremental run count for periodic full rescore
    if (useIncremental) {
      incrementalRunCount++;
    } else {
      incrementalRunCount = 0;
    }

    // Update scoring status for admin dashboard
    await updateScoringStatus({
      timestamp: new Date().toISOString(),
      duration_ms: elapsed,
      posts_scored: posts.length,
      posts_filtered: allPosts.length - posts.length,
    });
    if (feedPublication.published && feedPublication.feedStatsSnapshot !== null) {
      try {
        await updateEpochMetrics(epoch.id, runId, feedPublication.feedStatsSnapshot);
      } catch (err) {
        logger.warn({ err, epochId: epoch.id, runId }, 'Failed to update epoch transparency metrics');
      }
    }
    await updateCurrentRunScope(runId, epoch.id, elapsed, posts.length, allPosts.length - posts.length);
  } catch (err) {
    logger.error({ err }, 'Scoring pipeline failed');
    throw err;
  }
}

async function updateCurrentRunScope(
  runId: string,
  epochId: number,
  durationMs: number,
  postsScored: number,
  postsFiltered: number
): Promise<void> {
  await db.query(
    `INSERT INTO system_status (key, value, updated_at)
     VALUES ('current_scoring_run', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [
      JSON.stringify({
        run_id: runId,
        epoch_id: epochId,
        timestamp: new Date().toISOString(),
        duration_ms: durationMs,
        posts_scored: postsScored,
        posts_filtered: postsFiltered,
      }),
    ]
  );
}

async function updateEpochMetrics(
  epochId: number,
  runId: string,
  snapshot: CurrentFeedStatsSnapshot
): Promise<void> {
  await db.query(
    `INSERT INTO epoch_metrics (
       epoch_id,
       author_gini,
       avg_bridging,
       median_bridging,
       avg_engagement,
       median_total,
       vs_chronological_overlap,
       vs_engagement_overlap,
       posts_scored,
       unique_authors,
       run_id,
       metrics_source
     )
     VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7, $8, $9, 'current_feed')`,
    [
      epochId,
      snapshot.authorGini,
      snapshot.avgBridging,
      snapshot.medianBridging,
      snapshot.avgEngagement,
      snapshot.medianTotal,
      snapshot.totalPostsScored,
      snapshot.uniqueAuthors,
      runId,
    ]
  );
  await db.query(
    `DELETE FROM epoch_metrics
     WHERE epoch_id = $1
       AND metrics_source = 'current_feed'
       AND id NOT IN (
         SELECT id
         FROM epoch_metrics
         WHERE epoch_id = $1
           AND metrics_source = 'current_feed'
         ORDER BY computed_at DESC, id DESC
         LIMIT $2
       )`,
    [epochId, EPOCH_METRICS_CURRENT_FEED_RETENTION_ROWS]
  );
}

function numericValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  return (lower + upper) / 2;
}

function buildCurrentFeedStatsSnapshot(posts: RedisFeedCandidate[]): CurrentFeedStatsSnapshot {
  const authorCounts = new Map<string, number>();
  for (const post of posts) {
    authorCounts.set(post.author_did, (authorCounts.get(post.author_did) ?? 0) + 1);
  }

  const authorConcentration = calculateAuthorConcentration(authorCounts);
  const bridgingScores = posts.map((post) => post.bridging_score);
  const engagementScores = posts.map((post) => post.engagement_score);
  const totalScores = posts.map((post) => post.total_score);

  return {
    totalPostsScored: posts.length,
    uniqueAuthors: authorCounts.size,
    avgBridging: average(bridgingScores),
    avgEngagement: average(engagementScores),
    medianBridging: median(bridgingScores),
    medianTotal: median(totalScores),
    authorGini: authorConcentration.gini,
  };
}

/**
 * Build a case-insensitive SQL regex for keyword prefiltering.
 * ASCII keywords use explicit boundaries. Symbol/non-ASCII terms fall back to literal substring regex.
 */
function escapeSqlRegex(value: string): string {
  return value.replace(/[\\.^$|()?*+\[\]{}]/g, '\\$&');
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function toSqlKeywordRegex(keyword: string): string {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (!SQL_BOUNDARY_KEYWORD_PATTERN.test(normalized)) {
    return escapeSqlRegex(normalized);
  }

  const phrasePattern = normalized
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map(escapeSqlRegex)
    .join('[[:space:]_-]+');

  return `(^|[^[:alnum:]])${phrasePattern}($|[^[:alnum:]])`;
}

function toSqlLikePattern(keyword: string): string {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  const phrasePattern = normalized
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map(escapeSqlLike)
    .join('%');

  if (!phrasePattern) {
    return '';
  }

  return `%${phrasePattern}%`;
}

/**
 * Get posts within the scoring window.
 * Applies SQL keyword prefiltering so LIMIT is taken from matching posts.
 */
async function getPostsForScoring(contentRules: ContentRules): Promise<PostForScoring[]> {
  const cutoffMs = config.SCORING_WINDOW_HOURS * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - cutoffMs);

  const clauses: string[] = ['p.deleted = FALSE', 'p.created_at > $1', 'p.created_at <= NOW()'];
  const params: unknown[] = [cutoff.toISOString()];

  if (contentRules.includeKeywords.length > 0) {
    const includePredicates: string[] = [];
    for (const keyword of contentRules.includeKeywords) {
      const likePattern = toSqlLikePattern(keyword);
      const regex = toSqlKeywordRegex(keyword);
      if (!likePattern || !regex) {
        continue;
      }
      params.push(likePattern);
      const likeParamPosition = params.length;
      params.push(regex);
      const regexParamPosition = params.length;
      includePredicates.push(
        `(p.text IS NOT NULL AND p.text ILIKE $${likeParamPosition} ESCAPE '\\' AND p.text ~* $${regexParamPosition})`
      );
    }
    if (includePredicates.length > 0) {
      clauses.push(`(${includePredicates.join(' OR ')})`);
    }
  }

  if (contentRules.excludeKeywords.length > 0) {
    const excludePredicates: string[] = [];
    for (const keyword of contentRules.excludeKeywords) {
      const likePattern = toSqlLikePattern(keyword);
      const regex = toSqlKeywordRegex(keyword);
      if (!likePattern || !regex) {
        continue;
      }
      params.push(likePattern);
      const likeParamPosition = params.length;
      params.push(regex);
      const regexParamPosition = params.length;
      excludePredicates.push(
        `(p.text IS NOT NULL AND p.text ILIKE $${likeParamPosition} ESCAPE '\\' AND p.text ~* $${regexParamPosition})`
      );
    }
    if (excludePredicates.length > 0) {
      clauses.push(`NOT (${excludePredicates.join(' OR ')})`);
    }
  }

  params.push(SCORING_CANDIDATE_LIMIT);

  const result = await db.query(
    `SELECT p.uri, p.cid, p.author_did, p.text, p.reply_root, p.reply_parent,
            p.langs, p.has_media, p.created_at, p.topic_vector,
            p.classification_method,
            COALESCE(pe.like_count, 0) as like_count,
            COALESCE(pe.repost_count, 0) as repost_count,
            COALESCE(pe.reply_count, 0) as reply_count
     FROM posts p
     LEFT JOIN post_engagement pe ON p.uri = pe.post_uri
     WHERE ${clauses.join('\n       AND ')}
     ORDER BY p.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map(toPostForScoring);
}

/**
 * Get only posts that need rescoring: new posts (never scored in this epoch)
 * and posts whose engagement changed since their last score.
 *
 * Uses post_engagement.updated_at (maintained by like/repost/reply handlers)
 * compared against post_scores.scored_at to detect changes.
 */
async function getPostsForIncrementalScoring(
  contentRules: ContentRules,
  epochId: number,
): Promise<PostForScoring[]> {
  const cutoffMs = config.SCORING_WINDOW_HOURS * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - cutoffMs);

  // Build content filter clauses (shared between both halves of the UNION)
  const sharedClauses: string[] = [];
  const sharedParams: unknown[] = [];

  if (contentRules.includeKeywords.length > 0) {
    const includePredicates: string[] = [];
    for (const keyword of contentRules.includeKeywords) {
      const likePattern = toSqlLikePattern(keyword);
      const regex = toSqlKeywordRegex(keyword);
      if (!likePattern || !regex) continue;
      sharedParams.push(likePattern);
      const likeIdx = sharedParams.length;
      sharedParams.push(regex);
      const regexIdx = sharedParams.length;
      includePredicates.push(
        `(p.text IS NOT NULL AND p.text ILIKE $${likeIdx} ESCAPE '\\' AND p.text ~* $${regexIdx})`
      );
    }
    if (includePredicates.length > 0) {
      sharedClauses.push(`(${includePredicates.join(' OR ')})`);
    }
  }

  if (contentRules.excludeKeywords.length > 0) {
    const excludePredicates: string[] = [];
    for (const keyword of contentRules.excludeKeywords) {
      const likePattern = toSqlLikePattern(keyword);
      const regex = toSqlKeywordRegex(keyword);
      if (!likePattern || !regex) continue;
      sharedParams.push(likePattern);
      const likeIdx = sharedParams.length;
      sharedParams.push(regex);
      const regexIdx = sharedParams.length;
      excludePredicates.push(
        `(p.text IS NOT NULL AND p.text ILIKE $${likeIdx} ESCAPE '\\' AND p.text ~* $${regexIdx})`
      );
    }
    if (excludePredicates.length > 0) {
      sharedClauses.push(`NOT (${excludePredicates.join(' OR ')})`);
    }
  }

  const contentFilterSql = sharedClauses.length > 0
    ? ' AND ' + sharedClauses.join(' AND ')
    : '';

  // Parameters: $1 = cutoff, $2 = epochId, $3 = limit, then shared content filter params
  // We need to offset the shared param indices by 3.
  const baseParamCount = 3;
  const offsetContentFilterSql = sharedParams.length > 0
    ? contentFilterSql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + baseParamCount}`)
    : '';

  const params: unknown[] = [cutoff.toISOString(), epochId, SCORING_CANDIDATE_LIMIT, ...sharedParams];

  // The engagement-changed half (second UNION arm) re-scores posts whose
  // engagement moved since they were last scored (pe.updated_at > ps.scored_at).
  // Any in-window post has scored_at >= created_at > $1, so that predicate
  // already implies pe.updated_at > $1 — this MATERIALIZED CTE therefore drops
  // ZERO result rows (verified on prod: symdiff=0 vs the un-CTE'd form). Its sole
  // purpose is to pin the plan: without it the planner nested-loops a
  // post_engagement primary-key probe for every scored in-window post (~575k
  // probes, ~21s at current volume); MATERIALIZED forces a single hash join over
  // the in-window engagement set instead (~2x faster, ~11s), which keeps the
  // fetch well clear of the 60s statement_timeout under background contention.
  // Half 1 keeps its own LEFT JOIN post_engagement — it must include posts with
  // no engagement row at all, which this filtered set would exclude.
  const sql = `WITH changed_engagement AS MATERIALIZED (
      SELECT post_uri, updated_at, like_count, repost_count, reply_count
      FROM post_engagement
      WHERE updated_at > $1
    )
    (
      SELECT p.uri, p.cid, p.author_did, p.text, p.reply_root, p.reply_parent,
             p.langs, p.has_media, p.created_at, p.topic_vector,
             p.classification_method,
             COALESCE(pe.like_count, 0) as like_count,
             COALESCE(pe.repost_count, 0) as repost_count,
             COALESCE(pe.reply_count, 0) as reply_count
      FROM posts p
      LEFT JOIN post_engagement pe ON p.uri = pe.post_uri
      -- Two partition-pruning predicates on the RANGE-by-created_at post_scores
      -- table (created_at is the immutable 1:1 denormalized copy of
      -- posts.created_at): (a) ps.created_at = p.created_at runtime-prunes the
      -- per-row probe when the planner nested-loops this anti-join; (b) the
      -- explicit ps.created_at > $1 prunes post_scores to the same 72h daily
      -- partitions when the planner instead picks a hash join (the equality
      -- alone can't prune a hash scan). Without both, post_scores is scanned in
      -- full (~36 partitions) and the pipeline times out (PROJ-917).
      LEFT JOIN post_scores ps ON p.uri = ps.post_uri AND ps.epoch_id = $2 AND ps.created_at = p.created_at AND ps.created_at > $1
      WHERE p.deleted = FALSE
        AND p.created_at > $1
        AND p.created_at <= NOW()
        AND ps.post_uri IS NULL
        ${offsetContentFilterSql}
      ORDER BY p.created_at DESC
      LIMIT $3
    )
    UNION ALL
    (
      SELECT p.uri, p.cid, p.author_did, p.text, p.reply_root, p.reply_parent,
             p.langs, p.has_media, p.created_at, p.topic_vector,
             p.classification_method,
             COALESCE(pe.like_count, 0) as like_count,
             COALESCE(pe.repost_count, 0) as repost_count,
             COALESCE(pe.reply_count, 0) as reply_count
      FROM posts p
      -- pe is the MATERIALIZED changed_engagement CTE (top of query): the
      -- in-window engagement set, hash-joined here instead of PK-probed per row.
      INNER JOIN changed_engagement pe ON p.uri = pe.post_uri
      -- Same two partition-pruning predicates as the first half. This
      -- engagement-changed half plans as a hash join, so the explicit
      -- ps.created_at > $1 (not just the equality) is what prunes post_scores.
      INNER JOIN post_scores ps ON p.uri = ps.post_uri AND ps.epoch_id = $2 AND ps.created_at = p.created_at AND ps.created_at > $1
      WHERE p.deleted = FALSE
        AND p.created_at > $1
        AND p.created_at <= NOW()
        AND pe.updated_at > ps.scored_at
        ${offsetContentFilterSql}
      ORDER BY p.created_at DESC
      LIMIT $3
    )`;

  // This UNION scans the whole 72h firehose window (hundreds of thousands of
  // posts/scores) and runs ~15-25s at current volume — within the pool's
  // statement_timeout (DB_STATEMENT_TIMEOUT, 60s) with comfortable headroom.
  // Two things keep it there: (a) the explicit ps.created_at > $1 on each half
  // prunes post_scores to the 72h daily partitions instead of scanning all ~36;
  // (b) the changed_engagement MATERIALIZED CTE forces the engagement-changed
  // half into a hash join rather than ~575k per-row PK probes (see the CTE
  // comment above). This is still the heaviest query in the system.
  const result = await db.query(sql, params);
  return result.rows.map(toPostForScoring);
}

/**
 * Score all posts with all 5 components.
 * Also stores decomposed scores to the database (GOLDEN RULE).
 *
 * When TOPIC_EMBEDDING_ENABLED=true and the embedding model is loaded,
 * batch-classifies posts with semantic embeddings before scoring.
 * Falls back gracefully to winkNLP topic vectors on any failure.
 */
async function scoreAllPosts(
  posts: PostForScoring[],
  epoch: GovernanceEpoch,
  runId: string
): Promise<ScoredPost[]> {
  // Deterministic pre-pass (PROJ-917): replay the sequential source-diversity
  // ranking in `posts`-array order BEFORE any parallelism. This calls the same
  // scoreSourceDiversity in the same order as the old sequential loop, so every
  // post receives an identical penalty — the concurrent loop below then only
  // reads these values, so completion order cannot change any score.
  const authorCounts = createAuthorCountMap();
  const sourceDiversityByPost = new Map<PostForScoring, number>();
  for (const post of posts) {
    sourceDiversityByPost.set(post, scoreSourceDiversity(post.authorDid, authorCounts));
  }

  const context: ScoringContext = {
    epoch,
    scoringWindowHours: config.SCORING_WINDOW_HOURS,
    authorCounts,
    sourceDiversityByPost,
  };

  // Score posts through a bounded rolling worker-pool. Each in-flight post holds
  // at most ONE DB connection at a time (sequential components + sequential
  // bridging queries + sequential writes), so peak scoring connections ≈
  // SCORING_CONCURRENCY. A rolling pool (shared cursor) keeps exactly N posts in
  // flight — unlike chunked Promise.all it never stalls on a chunk's slowest post
  // (per-post bridging cost varies from 1 to 21 DB reads).
  const results: (ScoredPost | undefined)[] = new Array(posts.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      // Read-then-increment is atomic in single-threaded JS (no await between).
      const i = next++;
      if (i >= posts.length) return;
      const post = posts[i];
      try {
        // Classification method is determined at ingestion time and stored on
        // the posts row. The pipeline reads it as-is — no runtime override.
        const classificationMethod = post.classificationMethod === 'embedding' ? 'embedding' : 'keyword';

        const scoredPost = await scorePost(post, epoch, context);
        results[i] = scoredPost;

        // Store to database (GOLDEN RULE: all components, weights, and weighted values)
        await storeScore(scoredPost, epoch, runId, classificationMethod);
      } catch (err) {
        // Log and continue - one bad post never fails the whole run.
        logger.error({ err, uri: post.uri }, 'Failed to score post');
      }
    }
  };

  const workerCount = Math.max(1, Math.min(resolveScoringConcurrency(), posts.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // results[] is index-keyed above, so the returned array stays in input order
  // (posts that threw leave an undefined slot, filtered out here).
  return results.filter((r): r is ScoredPost => r !== undefined);
}

/**
 * Resolve SCORING_CONCURRENCY defensively: fall back to 1 (sequential) if the
 * value is missing or non-numeric — e.g. a partially-mocked `config` in tests —
 * so the score loop can never crash on a bad concurrency value.
 */
function resolveScoringConcurrency(): number {
  const n = config.SCORING_CONCURRENCY;
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * Score a single post using all registered components.
 *
 * PROJ-816: looks up weights via the `epoch.weights` Record map instead of
 * the removed fixed-key accessor table. Adding a 6th component to the
 * registry no longer requires editing this file.
 */
async function scorePost(
  post: PostForScoring,
  epoch: GovernanceEpoch,
  context: ScoringContext
): Promise<ScoredPost> {
  const raw: ScoreComponents = {};
  const weights: ScoreComponents = {};
  const weighted: ScoreComponents = {};
  let total = 0;

  for (const component of DEFAULT_COMPONENTS) {
    const rawScore = await component.score(post, context);
    // PROJ-816: GovernanceWeights is Record<string, number>, so `weights[key]`
    // type-checks as `number` even when the key is absent. Use an own-property
    // check so the "unmapped component key → 0 + warning" path is sound rather
    // than relying on a `=== undefined` comparison the types claim can't happen.
    const hasWeight = Object.prototype.hasOwnProperty.call(epoch.weights, component.key);
    if (!hasWeight) {
      const warningKey = `${epoch.id}:${component.key}`;
      if (!missingWeightWarned.has(warningKey)) {
        missingWeightWarned.add(warningKey);
        logger.warn(
          { epochId: epoch.id, componentKey: component.key },
          'Missing governance weight for scoring component; falling back to zero'
        );
      }
    }
    const resolvedWeight = hasWeight ? epoch.weights[component.key] : 0;
    const weightedScore = rawScore * resolvedWeight;

    raw[component.key] = rawScore;
    weights[component.key] = resolvedWeight;
    weighted[component.key] = weightedScore;
    total += weightedScore;
  }

  return {
    uri: post.uri,
    authorDid: post.authorDid,
    createdAt: post.createdAt,
    score: { raw, weights, weighted, total },
  };
}

/**
 * Store the decomposed score to the database.
 * GOLDEN RULE: Store raw, weight, AND weighted values for every component.
 *
 * Writes the existing 15-column wide row into post_scores. When
 * SCORE_LONGTABLE_DUALWRITE_ENABLED is on, additionally writes N rows — one
 * per registered component — into post_score_components (migration 021).
 *
 * The two writes are NOT transactionally atomic. The wide row remains
 * authoritative through PROJ-817 (P4 reader migration), so a failure between
 * the two writes leaves the wide-authoritative path consistent; the missing
 * long-table rows converge via the next scoring cycle (both INSERTs use
 * ON CONFLICT) or via scripts/backfill-score-components.ts. PROJ-819 (P5)
 * removes the wide columns and this code path together.
 *
 * @param scoredPost - Post with computed scores
 * @param epoch - Current governance epoch
 * @param runId - Unique identifier for this scoring run
 * @param classificationMethod - "keyword" (winkNLP) or "embedding" (Tier 2 semantic)
 */
async function storeScore(
  scoredPost: ScoredPost,
  epoch: GovernanceEpoch,
  runId: string,
  classificationMethod: 'keyword' | 'embedding' = 'keyword'
): Promise<void> {
  const { uri, createdAt } = scoredPost;
  const { raw, weights, weighted, total } = scoredPost.score;

  // PROJ-917: post_scores is RANGE-partitioned by a denormalized, immutable
  // copy of the scored post's own posts.created_at (NOT scored_at, which
  // changes on every rescore and would move the row across partitions). It's
  // bound directly from the scored post ($21) — the post row was already read
  // to compute this score, so its created_at is in hand. (A prior version
  // re-looked it up with `(SELECT created_at FROM posts WHERE uri = $1)`, but
  // uri is no longer unique on its own after the PK widened to
  // (uri, created_at), so that scalar subquery could match multiple rows /
  // error, and its NOW() fallback could route a rescore to a different
  // partition than the original write.) unique_post_epoch widened to
  // (post_uri, epoch_id, created_at); created_at is immutable once written, so
  // it is never part of the DO UPDATE SET list.
  await db.query(
    `INSERT INTO post_scores (
      post_uri, epoch_id,
      recency_score, engagement_score, bridging_score,
      source_diversity_score, relevance_score,
      recency_weight, engagement_weight, bridging_weight,
      source_diversity_weight, relevance_weight,
      recency_weighted, engagement_weighted, bridging_weighted,
      source_diversity_weighted, relevance_weighted,
      total_score, component_details, classification_method, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    ON CONFLICT (post_uri, epoch_id, created_at) DO UPDATE SET
      recency_score = $3, engagement_score = $4, bridging_score = $5,
      source_diversity_score = $6, relevance_score = $7,
      recency_weight = $8, engagement_weight = $9, bridging_weight = $10,
      source_diversity_weight = $11, relevance_weight = $12,
      recency_weighted = $13, engagement_weighted = $14, bridging_weighted = $15,
      source_diversity_weighted = $16, relevance_weighted = $17,
      total_score = $18, component_details = $19, classification_method = $20,
      scored_at = NOW()`,
    [
      uri,
      epoch.id,
      raw.recency,
      raw.engagement,
      raw.bridging,
      raw.sourceDiversity,
      raw.relevance,
      weights.recency,
      weights.engagement,
      weights.bridging,
      weights.sourceDiversity,
      weights.relevance,
      weighted.recency,
      weighted.engagement,
      weighted.bridging,
      weighted.sourceDiversity,
      weighted.relevance,
      total,
      JSON.stringify({ run_id: runId, classification_method: classificationMethod }),
      classificationMethod,
      createdAt,
    ]
  );

  if (config.SCORE_LONGTABLE_DUALWRITE_ENABLED) {
    await storeScoreComponents(uri, epoch.id, createdAt, raw, weights, weighted);
  }
}

/**
 * Dual-write the per-component decomposition into post_score_components (added
 * in migration 021). One row per registered scoring component. ON CONFLICT
 * upserts so a rescore overwrites prior decomposition for the same
 * (post_uri, epoch_id, component_key) tuple, and a backfill of an existing row
 * is a no-op when the script has already inserted it.
 */
async function storeScoreComponents(
  postUri: string,
  epochId: number,
  createdAt: Date,
  raw: ScoreComponents,
  weights: ScoreComponents,
  weighted: ScoreComponents
): Promise<void> {
  // Build the VALUES list dynamically. After PROJ-816 (P3) makes ScoreComponents
  // Record-shaped, this loop naturally iterates whatever components the
  // registry produced. Today it iterates exactly 5; tomorrow it may iterate N.
  const keys = Object.keys(raw) as GovernanceWeightKey[];
  if (keys.length === 0) {
    return;
  }

  const params: unknown[] = [];
  const placeholders: string[] = [];
  for (const key of keys) {
    const offset = params.length;
    params.push(postUri, epochId, key, raw[key], weights[key], weighted[key], createdAt);
    // PROJ-917: post_score_components is RANGE-partitioned by created_at
    // (migration 029), denormalized from posts.created_at exactly like
    // post_scores. Bound directly from the scored post ($offset+7), same as
    // storeScore() — see its comment for why the old
    // `(SELECT created_at FROM posts WHERE uri = ...)` lookup was unsafe once
    // uri stopped being unique on its own. PRIMARY KEY widened to
    // (post_uri, epoch_id, component_key, created_at) in the same migration.
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`
    );
  }

  await db.query(
    `INSERT INTO post_score_components
       (post_uri, epoch_id, component_key, raw, weight, weighted, created_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (post_uri, epoch_id, component_key, created_at) DO UPDATE SET
       raw = EXCLUDED.raw,
       weight = EXCLUDED.weight,
       weighted = EXCLUDED.weighted,
       scored_at = NOW()`,
    params
  );
}

/**
 * Write the ranked feed to Redis by reading stored scores from the database.
 *
 * Works for both full and incremental runs: in incremental mode, only new/changed
 * posts were scored and upserted into post_scores, but previous scores remain.
 * Reading from DB produces the complete, correctly-ranked feed.
 *
 * Applies the scoring window cutoff so posts older than SCORING_WINDOW_HOURS
 * are excluded even if they have stale scores in post_scores.
 */
async function writeToRedisFromDb(epochId: number, runId: string): Promise<FeedPublicationResult> {
  const cutoffMs = config.SCORING_WINDOW_HOURS * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - cutoffMs);

  const result = await db.query<{
    post_uri: string;
    total_score: number | string;
    author_did: string;
    bridging_score: number | string;
    engagement_score: number | string;
    embed_url: string | null;
    text_length: number | string;
  }>(
    `SELECT ps.post_uri, ps.total_score, p.author_did,
            ps.bridging_score, ps.engagement_score, p.embed_url,
            COALESCE(LENGTH(p.text), 0) as text_length
     FROM post_scores ps
     -- p.created_at = ps.created_at is the partition key (posts is
     -- RANGE-partitioned by created_at); pairing it with the p.created_at
     -- window below lets both posts and post_scores prune to the same handful
     -- of daily partitions instead of scanning all ~36 (PROJ-917).
     INNER JOIN posts p ON p.uri = ps.post_uri AND p.created_at = ps.created_at
     WHERE ps.epoch_id = $1
       AND p.deleted = FALSE
       AND p.created_at > $3
       AND p.created_at <= NOW()
       -- Explicit cutoff on post_scores.created_at as well (identical to
       -- p.created_at via the join equality). This epoch-driven query plans as a
       -- hash join, which — unlike the nested-loop incremental query — does NOT
       -- runtime-prune post_scores from the join alone; the explicit predicate
       -- prunes the post_scores scan to the 72h partitions (18.7s -> 2.6s).
       AND ps.created_at > $3
       AND ps.relevance_score >= $4
     ORDER BY ps.total_score DESC
     LIMIT $2`,
    [epochId, config.FEED_MAX_POSTS, cutoff.toISOString(), config.FEED_MIN_RELEVANCE]
  );

  const feedCandidates: RedisFeedCandidate[] = result.rows.map((post) => ({
    post_uri: post.post_uri,
    total_score: numericValue(post.total_score),
    author_did: post.author_did,
    bridging_score: numericValue(post.bridging_score),
    engagement_score: numericValue(post.engagement_score),
    embed_url: post.embed_url,
    text_length: numericValue(post.text_length),
  }));

  // URL deduplication: penalize reshares of the same external link.
  // Posts are already sorted by total_score DESC, so the highest-scored post
  // sharing a URL gets full score and later duplicates get decayed.
  let topPosts: RedisFeedCandidate[];

  if (config.FEED_DEDUP_ENABLED) {
    const DEDUP_DECAY = [1.0, 0.7, 0.5, 0.3];
    const urlCounts = new Map<string, number>();

    const dedupedPosts = feedCandidates.map(post => {
      // No URL or substantial original text → no penalty
      if (!post.embed_url || post.text_length >= config.FEED_DEDUP_MIN_TEXT) {
        return post;
      }

      const count = urlCounts.get(post.embed_url) ?? 0;
      urlCounts.set(post.embed_url, count + 1);

      const decayIndex = Math.min(count, DEDUP_DECAY.length - 1);
      const adjustedScore = post.total_score * DEDUP_DECAY[decayIndex];

      return { ...post, total_score: adjustedScore };
    });

    // Re-sort after dedup adjustment (order may have changed)
    dedupedPosts.sort((a, b) => b.total_score - a.total_score);

    const dedupedUrls = [...urlCounts.entries()].filter(([, c]) => c > 1).length;
    if (dedupedUrls > 0) {
      logger.info({ dedupedUrls, totalUrls: urlCounts.size }, 'URL dedup applied');
    }

    topPosts = dedupedPosts;
  } else {
    topPosts = feedCandidates;
  }

  const feedStatsSnapshot = buildCurrentFeedStatsSnapshot(topPosts);
  if (topPosts.length === 0) {
    const emptyResultAt = new Date().toISOString();
    logger.warn(
      { epochId, runId, emptyResultAt },
      'Scoring result produced zero feed rows; preserving current feed'
    );
    try {
      await redis.incr(FEED_EMPTY_RESULT_SKIPPED_TOTAL_KEY);
      await redis.set(FEED_LAST_EMPTY_RESULT_AT_KEY, emptyResultAt);
    } catch (error) {
      logger.warn(
        { error, epochId, runId, emptyResultAt },
        'Failed to record empty feed publish telemetry'
      );
    }
    return { published: false, feedStatsSnapshot: null };
  }

  const stagedCurrentKey = `${FEED_STAGED_CURRENT_PREFIX}${runId}`;
  const stagedLastKnownGoodKey = `${FEED_STAGED_LAST_KNOWN_GOOD_PREFIX}${runId}`;
  const updatedAt = new Date().toISOString();
  const metadataEntries: ReadonlyArray<readonly [string, string]> = [
    ['feed:epoch', epochId.toString()],
    ['feed:run_id', runId],
    ['feed:updated_at', updatedAt],
    ['feed:count', topPosts.length.toString()],
    ['feed:last_known_good_epoch', epochId.toString()],
    ['feed:last_known_good_run_id', runId],
    ['feed:last_known_good_count', topPosts.length.toString()],
  ];
  const stagedMetadataKeys = metadataEntries.map(
    (_entry, index) => `${FEED_STAGED_METADATA_PREFIX}${runId}:${index}`
  );
  const stagedKeys = [stagedCurrentKey, stagedLastKnownGoodKey, ...stagedMetadataKeys];
  const publishDestinationKeys = [
    FEED_CURRENT_KEY,
    FEED_LAST_KNOWN_GOOD_KEY,
    ...metadataEntries.map(([destinationKey]) => destinationKey),
  ];

  try {
    const stagingTransaction = redis.multi();
    stagingTransaction.del(...stagedKeys);
    const zaddArguments: Array<string | number> = [];
    for (const post of topPosts) {
      zaddArguments.push(post.total_score, post.post_uri);
    }
    stagingTransaction.zadd(stagedCurrentKey, ...zaddArguments);
    stagingTransaction.zadd(stagedLastKnownGoodKey, ...zaddArguments);
    for (const [index, [, value]] of metadataEntries.entries()) {
      stagingTransaction.set(stagedMetadataKeys[index], value);
    }
    for (const stagedKey of stagedKeys) {
      stagingTransaction.expire(stagedKey, FEED_STAGING_TTL_SECONDS);
    }
    assertRedisTransactionSucceeded(
      await stagingTransaction.exec(),
      'staged feed materialization'
    );

    const published = await redis.eval(
      PUBLISH_STAGED_FEED_SCRIPT,
      stagedKeys.length + publishDestinationKeys.length,
      ...stagedKeys,
      ...publishDestinationKeys,
      stagedKeys.length.toString()
    );
    if (published !== 1) {
      throw new Error(`Atomic feed publish returned unexpected result: ${String(published)}`);
    }
  } catch (error) {
    await cleanupStagedFeedPublish(stagedKeys);
    throw error;
  }

  try {
    await invalidateCurrentFeedSnapshot();
  } catch (err) {
    logger.warn({ err, epochId, runId }, 'Failed to invalidate current feed snapshot cache after feed write');
  }

  logger.info({ postCount: topPosts.length, epochId }, 'Feed written to Redis');
  return { published: true, feedStatsSnapshot };
}
