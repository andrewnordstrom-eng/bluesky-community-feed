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
import { logger } from '../lib/logger.js';
import { getActiveEpoch } from '../db/queries/epochs.js';
import { randomUUID } from 'crypto';
import { createAuthorCountMap } from './components/source-diversity.js';
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

// Maximum time allowed for a single scoring run.
const SCORING_TIMEOUT_MS = config.SCORING_TIMEOUT_MS;
const SCORING_CANDIDATE_LIMIT = config.SCORING_CANDIDATE_LIMIT;
const SQL_BOUNDARY_KEYWORD_PATTERN = /^[a-z0-9][a-z0-9\s-]*$/;

// Track last successful run for health checks
let lastSuccessfulRunAt: Date | null = null;

// Track last scored epoch to detect epoch transitions (triggers full rescore)
let lastScoredEpochId: number | null = null;

// Count incremental runs since last full rescore (triggers periodic full rescore for recency decay)
let incrementalRunCount = 0;

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
}

/**
 * Run the complete scoring pipeline with timeout.
 * This is the main entry point called by the scheduler.
 */
export async function runScoringPipeline(): Promise<void> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error('Scoring pipeline timed out')),
      SCORING_TIMEOUT_MS
    );
  });

  await Promise.race([
    runScoringPipelineInternal(),
    timeoutPromise,
  ]);
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
      logger.warn({ epochId: epoch.id }, 'No posts to score in the window, clearing feed');
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
        logger.warn({ epochId: epoch.id }, 'All posts filtered out by content rules, clearing feed');
      }
    }

    logger.info({ postCount: posts.length, epochId: epoch.id, mode: useIncremental ? 'incremental' : 'full' }, 'Scoring filtered posts');

    // 3. Score each post
    const scored = await scoreAllPosts(posts, epoch, runId);

    // 4. Write the full ranked feed to Redis from stored scores.
    // In incremental mode, only new/changed posts were scored above, but
    // previous scores remain in post_scores. Reading from DB gives the
    // complete, correctly-ranked feed.
    await writeToRedisFromDb(epoch.id, runId);

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

  const clauses: string[] = ['p.deleted = FALSE', 'p.created_at > $1'];
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

  const result = await db.query(
    `(
      SELECT p.uri, p.cid, p.author_did, p.text, p.reply_root, p.reply_parent,
             p.langs, p.has_media, p.created_at, p.topic_vector,
             COALESCE(pe.like_count, 0) as like_count,
             COALESCE(pe.repost_count, 0) as repost_count,
             COALESCE(pe.reply_count, 0) as reply_count
      FROM posts p
      LEFT JOIN post_engagement pe ON p.uri = pe.post_uri
      LEFT JOIN post_scores ps ON p.uri = ps.post_uri AND ps.epoch_id = $2
      WHERE p.deleted = FALSE
        AND p.created_at > $1
        AND ps.post_uri IS NULL
        ${offsetContentFilterSql}
      ORDER BY p.created_at DESC
      LIMIT $3
    )
    UNION ALL
    (
      SELECT p.uri, p.cid, p.author_did, p.text, p.reply_root, p.reply_parent,
             p.langs, p.has_media, p.created_at, p.topic_vector,
             COALESCE(pe.like_count, 0) as like_count,
             COALESCE(pe.repost_count, 0) as repost_count,
             COALESCE(pe.reply_count, 0) as reply_count
      FROM posts p
      INNER JOIN post_engagement pe ON p.uri = pe.post_uri
      INNER JOIN post_scores ps ON p.uri = ps.post_uri AND ps.epoch_id = $2
      WHERE p.deleted = FALSE
        AND p.created_at > $1
        AND pe.updated_at > ps.scored_at
        ${offsetContentFilterSql}
      ORDER BY p.created_at DESC
      LIMIT $3
    )`,
    params
  );

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
  const scored: ScoredPost[] = [];
  const authorCounts = createAuthorCountMap();

  const context: ScoringContext = {
    epoch,
    scoringWindowHours: config.SCORING_WINDOW_HOURS,
    authorCounts,
  };

  for (const post of posts) {
    try {
      // Classification is now determined at ingestion time and stored in the
      // post's topic_vector. The pipeline reads the stored vector as-is —
      // no runtime re-classification or override.
      const classificationMethod: 'keyword' | 'embedding' = 'keyword';

      const scoredPost = await scorePost(post, epoch, context);
      scored.push(scoredPost);

      // Store to database (GOLDEN RULE: all components, weights, and weighted values)
      await storeScore(scoredPost, epoch, runId, classificationMethod);
    } catch (err) {
      // Log and continue - don't fail entire pipeline for one post
      logger.error({ err, uri: post.uri }, 'Failed to score post');
    }
  }

  return scored;
}

/** Type-safe weight lookup from GovernanceEpoch by component key. */
const WEIGHT_ACCESSORS: Record<GovernanceWeightKey, (e: GovernanceEpoch) => number> = {
  recency: (e) => e.recencyWeight,
  engagement: (e) => e.engagementWeight,
  bridging: (e) => e.bridgingWeight,
  sourceDiversity: (e) => e.sourceDiversityWeight,
  relevance: (e) => e.relevanceWeight,
};

/**
 * Score a single post using all registered components.
 */
async function scorePost(
  post: PostForScoring,
  epoch: GovernanceEpoch,
  context: ScoringContext
): Promise<ScoredPost> {
  const raw = {} as ScoreComponents;
  const weights = {} as ScoreComponents;
  const weighted = {} as ScoreComponents;
  let total = 0;

  for (const component of DEFAULT_COMPONENTS) {
    const rawScore = await component.score(post, context);
    const weight = WEIGHT_ACCESSORS[component.key](epoch);
    const weightedScore = rawScore * weight;

    raw[component.key] = rawScore;
    weights[component.key] = weight;
    weighted[component.key] = weightedScore;
    total += weightedScore;
  }

  return {
    uri: post.uri,
    authorDid: post.authorDid,
    score: { raw, weights, weighted, total },
  };
}

/**
 * Store the decomposed score to the database.
 * GOLDEN RULE: Store raw, weight, AND weighted values for every component.
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
  const { uri } = scoredPost;
  const { raw, weights, weighted, total } = scoredPost.score;

  await db.query(
    `INSERT INTO post_scores (
      post_uri, epoch_id,
      recency_score, engagement_score, bridging_score,
      source_diversity_score, relevance_score,
      recency_weight, engagement_weight, bridging_weight,
      source_diversity_weight, relevance_weight,
      recency_weighted, engagement_weighted, bridging_weighted,
      source_diversity_weighted, relevance_weighted,
      total_score, component_details, classification_method
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    ON CONFLICT (post_uri, epoch_id) DO UPDATE SET
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
    ]
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
async function writeToRedisFromDb(epochId: number, runId: string): Promise<void> {
  const cutoffMs = config.SCORING_WINDOW_HOURS * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - cutoffMs);

  const result = await db.query<{ post_uri: string; total_score: number }>(
    `SELECT ps.post_uri, ps.total_score
     FROM post_scores ps
     INNER JOIN posts p ON p.uri = ps.post_uri
     WHERE ps.epoch_id = $1
       AND p.deleted = FALSE
       AND p.created_at > $3
       AND ps.relevance_score >= $4
     ORDER BY ps.total_score DESC
     LIMIT $2`,
    [epochId, config.FEED_MAX_POSTS, cutoff.toISOString(), config.FEED_MIN_RELEVANCE]
  );

  const topPosts = result.rows;

  // Use Redis pipeline for atomic batch write
  const pipeline = redis.pipeline();

  // Delete old feed
  pipeline.del('feed:current');

  // Add all posts to sorted set (score = total_score)
  for (const post of topPosts) {
    pipeline.zadd('feed:current', post.total_score, post.post_uri);
  }

  // Store metadata
  pipeline.set('feed:epoch', epochId.toString());
  pipeline.set('feed:run_id', runId);
  pipeline.set('feed:updated_at', new Date().toISOString());
  pipeline.set('feed:count', topPosts.length.toString());

  await pipeline.exec();

  if (topPosts.length === 0) {
    logger.info({ epochId }, 'Feed cleared in Redis due to empty scoring result');
    return;
  }

  logger.info({ postCount: topPosts.length, epochId }, 'Feed written to Redis');
}
