/**
 * Vote Aggregation Module
 *
 * Aggregates votes using trimmed mean to determine new epoch weights.
 * Removes top and bottom 10% of votes to prevent outlier manipulation.
 */

import { db } from '../db/client.js';
import { config } from '../config.js';
import { GOVERNANCE_WEIGHT_VOTE_FIELDS, VOTABLE_WEIGHT_PARAMS } from '../config/votable-params.js';
import { logger } from '../lib/logger.js';
import { GovernanceWeights, ContentRules, emptyContentRules } from './governance.types.js';
import { combineVoteWeights, type WeightVote } from './aggregation-core.js';

/**
 * Weight component names for iteration.
 */
const WEIGHT_COMPONENTS = GOVERNANCE_WEIGHT_VOTE_FIELDS;

/**
 * Aggregate votes for an epoch using trimmed mean.
 *
 * Algorithm:
 * 1. Get all votes for the epoch
 * 2. For each weight component:
 *    - Sort values ascending
 *    - Remove top 10% and bottom 10%
 *    - Calculate mean of remaining
 * 3. Normalize result to sum to exactly 1.0
 *
 * @param epochId - The epoch to aggregate votes for
 * @returns Aggregated weights, or null if no votes
 */
export async function aggregateVotes(epochId: number): Promise<GovernanceWeights | null> {
  const keywordOnlyVotesResult = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM governance_votes
     WHERE epoch_id = $1
       AND recency_weight IS NULL
       AND engagement_weight IS NULL
       AND bridging_weight IS NULL
       AND source_diversity_weight IS NULL
       AND relevance_weight IS NULL
       AND (
         (include_keywords IS NOT NULL AND array_length(include_keywords, 1) > 0)
         OR
         (exclude_keywords IS NOT NULL AND array_length(exclude_keywords, 1) > 0)
       )`,
    [epochId]
  );

  // Read the per-vote weight rows. Two source paths share the same downstream
  // shape (one object per vote with the 5 *_weight keys), gated by the
  // PROJ-815 read flag.
  //
  // Wide path (default): SELECT the 5 named columns from governance_votes.
  // Long path: pivot governance_vote_weights into the same shape in JS so the
  // trim/mean logic below stays unchanged. The flag flips to on in PROJ-817
  // (P4) after parity tests across every consumer pass.
  const votes = config.GOVERNANCE_LONGTABLE_READ_ENABLED
    ? await fetchWeightVotesFromLongTable(epochId)
    : await db.query(
        `SELECT recency_weight, engagement_weight, bridging_weight,
                source_diversity_weight, relevance_weight
         FROM governance_votes
         WHERE epoch_id = $1
           AND recency_weight IS NOT NULL
           AND engagement_weight IS NOT NULL
           AND bridging_weight IS NOT NULL
           AND source_diversity_weight IS NOT NULL
           AND relevance_weight IS NOT NULL
         ORDER BY voted_at`,
        [epochId]
      );

  const n = votes.rows.length;
  const keywordOnlyVoteCount = keywordOnlyVotesResult.rows[0]?.count ?? 0;

  if (keywordOnlyVoteCount > 0) {
    logger.warn(
      { epochId, keywordOnlyVoteCount, weightVoteCount: n },
      'Keyword-only votes excluded from weight aggregation'
    );
  }

  if (n === 0) {
    logger.warn({ epochId }, 'No votes to aggregate');
    return null;
  }

  logger.info({ epochId, voteCount: n }, 'Aggregating votes');

  // Trimmed-mean aggregation lives in a pure, testable core (see aggregation-core.ts).
  const weightVotes = votes.rows.map(
    (v: Record<string, number>) =>
      Object.fromEntries(WEIGHT_COMPONENTS.map((c) => [c, v[c]] as const)) as WeightVote
  );
  const normalized = combineVoteWeights(weightVotes);

  // n > 0 was checked above, so this is defensive only.
  if (normalized === null) {
    logger.warn({ epochId }, 'No votes to aggregate');
    return null;
  }

  logger.info({ epochId, aggregated: normalized }, 'Vote aggregation complete');

  return normalized;
}

/**
 * Long-table read path for aggregateVotes (PROJ-815 / P2).
 *
 * Pivots governance_vote_weights (one row per vote × component_key) into the
 * same per-vote wide-shape that the SELECT-from-governance_votes path returns,
 * so the trim/mean logic in aggregateVotes can stay component-agnostic.
 *
 * The "ALL 5 components present" filter from the wide path becomes
 * "vote has rows for every registered weight key" here; votes missing any
 * component are excluded (mirrors `recency_weight IS NOT NULL AND …` semantics).
 *
 * Gated by GOVERNANCE_LONGTABLE_READ_ENABLED. Off by default in this packet;
 * flipped to true in PROJ-817 (P4) once parity tests pass across all consumers.
 */
async function fetchWeightVotesFromLongTable(
  epochId: number
): Promise<{ rows: Array<Record<string, number>> }> {
  const result = await db.query<{
    vote_id: string;
    component_key: string;
    weight: number;
  }>(
    `SELECT gvw.vote_id, gvw.component_key, gvw.weight
     FROM governance_vote_weights gvw
     JOIN governance_votes gv ON gv.id = gvw.vote_id
     WHERE gv.epoch_id = $1
     ORDER BY gv.voted_at, gvw.component_key`,
    [epochId]
  );

  // Pivot into per-vote rows keyed by component_key. We use Map (instead of
  // an object) to preserve the voted_at insertion order from the SQL ORDER BY
  // — the trimmed-mean computation doesn't depend on it but downstream callers
  // assume "ORDER BY voted_at" is stable.
  const perVote = new Map<string, Record<string, number>>();
  for (const row of result.rows) {
    const existing = perVote.get(row.vote_id);
    if (existing) {
      existing[row.component_key] = row.weight;
    } else {
      perVote.set(row.vote_id, { [row.component_key]: row.weight });
    }
  }

  // Project to the wide-column shape consumers expect. Drop votes that don't
  // have a value for every registered component (the long-path equivalent of
  // "IS NOT NULL" on each of the 5 wide columns in the SQL above).
  const requiredKeys = VOTABLE_WEIGHT_PARAMS.map((p) => p.key);
  const rows: Array<Record<string, number>> = [];
  for (const [, partial] of perVote) {
    if (requiredKeys.some((key) => partial[key] === undefined)) {
      continue;
    }
    // Translate camelCase keys (component_key as stored) to the snake_case
    // `_weight` field names the existing trim/mean loop reads. After PROJ-816
    // (P3) makes the in-memory shape `Record<>`-based, this translation goes
    // away.
    const wideShape: Record<string, number> = {};
    for (const param of VOTABLE_WEIGHT_PARAMS) {
      wideShape[param.voteField] = partial[param.key];
    }
    rows.push(wideShape);
  }

  return { rows };
}

/**
 * Get vote statistics for an epoch without aggregating.
 * Useful for transparency reporting.
 */
export async function getVoteStatistics(epochId: number): Promise<{
  count: number;
  weightVoteCount: number;
  contentVoteCount: number;
  average: GovernanceWeights;
  median: GovernanceWeights;
  stdDev: GovernanceWeights;
} | null> {
  const result = await db.query(
    `SELECT
      COUNT(*) FILTER (
        WHERE recency_weight IS NOT NULL
          AND engagement_weight IS NOT NULL
          AND bridging_weight IS NOT NULL
          AND source_diversity_weight IS NOT NULL
          AND relevance_weight IS NOT NULL
      ) as weight_vote_count,
      COUNT(*) FILTER (
        WHERE
          (include_keywords IS NOT NULL AND array_length(include_keywords, 1) > 0)
          OR
          (exclude_keywords IS NOT NULL AND array_length(exclude_keywords, 1) > 0)
      ) as content_vote_count,
      AVG(recency_weight) FILTER (
        WHERE recency_weight IS NOT NULL
          AND engagement_weight IS NOT NULL
          AND bridging_weight IS NOT NULL
          AND source_diversity_weight IS NOT NULL
          AND relevance_weight IS NOT NULL
      ) as avg_recency,
      AVG(engagement_weight) FILTER (
        WHERE recency_weight IS NOT NULL
          AND engagement_weight IS NOT NULL
          AND bridging_weight IS NOT NULL
          AND source_diversity_weight IS NOT NULL
          AND relevance_weight IS NOT NULL
      ) as avg_engagement,
      AVG(bridging_weight) FILTER (
        WHERE recency_weight IS NOT NULL
          AND engagement_weight IS NOT NULL
          AND bridging_weight IS NOT NULL
          AND source_diversity_weight IS NOT NULL
          AND relevance_weight IS NOT NULL
      ) as avg_bridging,
      AVG(source_diversity_weight) FILTER (
        WHERE recency_weight IS NOT NULL
          AND engagement_weight IS NOT NULL
          AND bridging_weight IS NOT NULL
          AND source_diversity_weight IS NOT NULL
          AND relevance_weight IS NOT NULL
      ) as avg_source_diversity,
      AVG(relevance_weight) FILTER (
        WHERE recency_weight IS NOT NULL
          AND engagement_weight IS NOT NULL
          AND bridging_weight IS NOT NULL
          AND source_diversity_weight IS NOT NULL
          AND relevance_weight IS NOT NULL
      ) as avg_relevance,
      STDDEV(recency_weight) FILTER (
        WHERE recency_weight IS NOT NULL
          AND engagement_weight IS NOT NULL
          AND bridging_weight IS NOT NULL
          AND source_diversity_weight IS NOT NULL
          AND relevance_weight IS NOT NULL
      ) as std_recency,
      STDDEV(engagement_weight) FILTER (
        WHERE recency_weight IS NOT NULL
          AND engagement_weight IS NOT NULL
          AND bridging_weight IS NOT NULL
          AND source_diversity_weight IS NOT NULL
          AND relevance_weight IS NOT NULL
      ) as std_engagement,
      STDDEV(bridging_weight) FILTER (
        WHERE recency_weight IS NOT NULL
          AND engagement_weight IS NOT NULL
          AND bridging_weight IS NOT NULL
          AND source_diversity_weight IS NOT NULL
          AND relevance_weight IS NOT NULL
      ) as std_bridging,
      STDDEV(source_diversity_weight) FILTER (
        WHERE recency_weight IS NOT NULL
          AND engagement_weight IS NOT NULL
          AND bridging_weight IS NOT NULL
          AND source_diversity_weight IS NOT NULL
          AND relevance_weight IS NOT NULL
      ) as std_source_diversity,
      STDDEV(relevance_weight) FILTER (
        WHERE recency_weight IS NOT NULL
          AND engagement_weight IS NOT NULL
          AND bridging_weight IS NOT NULL
          AND source_diversity_weight IS NOT NULL
          AND relevance_weight IS NOT NULL
      ) as std_relevance
     FROM governance_votes
     WHERE epoch_id = $1`,
    [epochId]
  );

  const row = result.rows[0];
  const weightVoteCount = parseInt(row.weight_vote_count);
  const contentVoteCount = parseInt(row.content_vote_count);

  if (weightVoteCount === 0) {
    return null;
  }

  // For median, we need to fetch all votes
  const votes = await db.query(
    `SELECT recency_weight, engagement_weight, bridging_weight,
            source_diversity_weight, relevance_weight
     FROM governance_votes
     WHERE epoch_id = $1
       AND recency_weight IS NOT NULL
       AND engagement_weight IS NOT NULL
       AND bridging_weight IS NOT NULL
       AND source_diversity_weight IS NOT NULL
       AND relevance_weight IS NOT NULL`,
    [epochId]
  );

  const median = Object.fromEntries(
    VOTABLE_WEIGHT_PARAMS.map((param) => [
      param.key,
      calculateMedian(votes.rows.map((v: Record<string, number>) => v[param.voteField])),
    ])
  ) as unknown as GovernanceWeights;

  return {
    count: weightVoteCount,
    weightVoteCount,
    contentVoteCount,
    average: {
      recency: parseFloat(row.avg_recency) || 0,
      engagement: parseFloat(row.avg_engagement) || 0,
      bridging: parseFloat(row.avg_bridging) || 0,
      sourceDiversity: parseFloat(row.avg_source_diversity) || 0,
      relevance: parseFloat(row.avg_relevance) || 0,
    },
    median,
    stdDev: {
      recency: parseFloat(row.std_recency) || 0,
      engagement: parseFloat(row.std_engagement) || 0,
      bridging: parseFloat(row.std_bridging) || 0,
      sourceDiversity: parseFloat(row.std_source_diversity) || 0,
      relevance: parseFloat(row.std_relevance) || 0,
    },
  };
}

/**
 * Calculate the median of an array of numbers.
 */
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return sorted[mid];
}

// ============================================================================
// Topic Weight Vote Aggregation
// ============================================================================

/** Default trim percentage for topic weight aggregation. */
const TOPIC_TRIM_PERCENT = 0.1;

/**
 * Aggregate topic weight votes for an epoch using trimmed mean.
 * Same algorithm as component weight aggregation.
 *
 * For each active topic:
 *   1. Collect all votes for that topic
 *   2. Trim top and bottom 10% of values (requires >= 10 votes)
 *   3. Average the remaining values
 *   4. Topics with no votes are excluded (default to 0.5 at scoring time)
 *
 * @param epochId - The epoch to aggregate topic weight votes for
 * @param trimPercent - Percentage to trim from each end (default 0.1)
 * @returns Record of topic slug → aggregated weight. Empty = no votes cast.
 */
export async function aggregateTopicWeights(
  epochId: number,
  trimPercent: number = TOPIC_TRIM_PERCENT
): Promise<Record<string, number>> {
  // 1. Get all votes with topic_weight_votes
  const votes = await db.query(
    `SELECT topic_weight_votes FROM governance_votes
     WHERE epoch_id = $1
       AND topic_weight_votes IS NOT NULL
       AND topic_weight_votes != '{}'::jsonb`,
    [epochId]
  );

  if (votes.rows.length === 0) {
    logger.info({ epochId }, 'No topic weight votes to aggregate');
    return {};
  }

  // 2. Get active topic slugs
  const slugResult = await db.query(
    'SELECT slug FROM topic_catalog WHERE is_active = TRUE'
  );
  const activeSlugs = slugResult.rows.map((r: Record<string, unknown>) => r.slug as string);

  // 3. For each active topic, collect votes, trim, and average
  const result: Record<string, number> = {};

  for (const slug of activeSlugs) {
    const values = votes.rows
      .map((v: Record<string, unknown>) => {
        const topicVotes = v.topic_weight_votes as Record<string, number> | null;
        return topicVotes?.[slug];
      })
      .filter((v): v is number => v !== undefined && v !== null)
      .sort((a, b) => a - b);

    if (values.length === 0) continue; // Unvoted = excluded, defaults to 0.5 at scoring time

    const effectiveTrim = values.length >= 10
      ? Math.floor(values.length * trimPercent)
      : 0;

    const trimmed = effectiveTrim > 0
      ? values.slice(effectiveTrim, values.length - effectiveTrim)
      : values;

    const mean = trimmed.reduce((sum, v) => sum + v, 0) / trimmed.length;
    result[slug] = Math.round(mean * 1000) / 1000; // 3 decimal places
  }

  logger.info(
    {
      epochId,
      voterCount: votes.rows.length,
      topicsWithVotes: Object.keys(result).length,
      activeSlugs: activeSlugs.length,
    },
    'Topic weight votes aggregated'
  );

  return result;
}

// ============================================================================
// Content Vote Aggregation
// ============================================================================

/** Threshold for keyword inclusion (30% of voters must include it) */
const KEYWORD_THRESHOLD = 0.3;

/**
 * Aggregate content votes for an epoch.
 * Keywords appearing in >= 30% of votes are included in the content rules.
 *
 * @param epochId - The epoch to aggregate content votes for
 * @returns Aggregated content rules
 */
export async function aggregateContentVotes(epochId: number): Promise<ContentRules> {
  const votes = await db.query(
    `SELECT include_keywords, exclude_keywords
     FROM governance_votes
     WHERE epoch_id = $1
       AND (
         include_keywords IS NOT NULL AND array_length(include_keywords, 1) > 0
         OR exclude_keywords IS NOT NULL AND array_length(exclude_keywords, 1) > 0
       )`,
    [epochId]
  );

  const n = votes.rows.length;

  if (n === 0) {
    logger.info({ epochId }, 'No content votes to aggregate, using safety-net defaults');
    return {
      includeKeywords: [],
      excludeKeywords: ['spam', 'nsfw', 'onlyfans'],
    };
  }

  // Calculate threshold - minimum votes needed for keyword to be included
  const threshold = Math.max(1, Math.ceil(n * KEYWORD_THRESHOLD));

  // Count keyword occurrences
  const includeCounts = new Map<string, number>();
  const excludeCounts = new Map<string, number>();

  for (const row of votes.rows) {
    for (const keyword of row.include_keywords ?? []) {
      includeCounts.set(keyword, (includeCounts.get(keyword) ?? 0) + 1);
    }
    for (const keyword of row.exclude_keywords ?? []) {
      excludeCounts.set(keyword, (excludeCounts.get(keyword) ?? 0) + 1);
    }
  }

  // Filter to keywords meeting threshold and sort alphabetically
  const includeKeywords = Array.from(includeCounts.entries())
    .filter(([, count]) => count >= threshold)
    .map(([keyword]) => keyword)
    .sort();

  const excludeKeywords = Array.from(excludeCounts.entries())
    .filter(([, count]) => count >= threshold)
    .map(([keyword]) => keyword)
    .sort();

  logger.info(
    {
      epochId,
      voterCount: n,
      threshold,
      includeKeywordsCount: includeKeywords.length,
      excludeKeywordsCount: excludeKeywords.length,
      totalIncludeCandidates: includeCounts.size,
      totalExcludeCandidates: excludeCounts.size,
    },
    'Content votes aggregated'
  );

  return { includeKeywords, excludeKeywords };
}

/**
 * Get content vote statistics for transparency reporting.
 */
export async function getContentVoteStatistics(epochId: number): Promise<{
  voterCount: number;
  includeKeywordVotes: Record<string, number>;
  excludeKeywordVotes: Record<string, number>;
  threshold: number;
}> {
  const votes = await db.query(
    `SELECT include_keywords, exclude_keywords
     FROM governance_votes
     WHERE epoch_id = $1
       AND (
         include_keywords IS NOT NULL AND array_length(include_keywords, 1) > 0
         OR exclude_keywords IS NOT NULL AND array_length(exclude_keywords, 1) > 0
       )`,
    [epochId]
  );

  const includeKeywordVotes: Record<string, number> = {};
  const excludeKeywordVotes: Record<string, number> = {};

  for (const row of votes.rows) {
    for (const keyword of row.include_keywords ?? []) {
      includeKeywordVotes[keyword] = (includeKeywordVotes[keyword] ?? 0) + 1;
    }
    for (const keyword of row.exclude_keywords ?? []) {
      excludeKeywordVotes[keyword] = (excludeKeywordVotes[keyword] ?? 0) + 1;
    }
  }

  const voterCount = votes.rows.length;
  const threshold = Math.max(1, Math.ceil(voterCount * KEYWORD_THRESHOLD));

  return {
    voterCount,
    includeKeywordVotes,
    excludeKeywordVotes,
    threshold,
  };
}
