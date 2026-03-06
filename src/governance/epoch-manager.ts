/**
 * Epoch Manager
 *
 * Handles governance epoch lifecycle:
 * - Opening voting periods
 * - Closing epochs and creating new ones
 * - Transaction-wrapped epoch transitions
 */

import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';
import { aggregateVotes, aggregateContentVotes, aggregateTopicWeights } from './aggregation.js';
import { GovernanceWeights, weightsToVotePayload, ContentRules } from './governance.types.js';
import { postAnnouncementSafe } from '../bot/safe-poster.js';
import { invalidateContentRulesCache } from './content-filter.js';
import { runScoringPipeline } from '../scoring/pipeline.js';

interface SqlQueryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

interface RankedPost {
  uri: string;
  rank: number;
  totalScore: number;
}

interface RankChange {
  uri: string;
  oldRank: number | null;
  newRank: number | null;
  change: number | null;
}

interface VoteCounts {
  total: number;
  weightEligible: number;
}

const WEIGHT_VOTE_ELIGIBILITY_FILTER = `
  recency_weight IS NOT NULL
  AND engagement_weight IS NOT NULL
  AND bridging_weight IS NOT NULL
  AND source_diversity_weight IS NOT NULL
  AND relevance_weight IS NOT NULL
`;

function toFiniteNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

async function getVoteCountsForEpoch(queryable: SqlQueryable, epochId: number): Promise<VoteCounts> {
  const result = await queryable.query<{ total: string; weight_eligible: string }>(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE ${WEIGHT_VOTE_ELIGIBILITY_FILTER})::int AS weight_eligible
     FROM governance_votes
     WHERE epoch_id = $1`,
    [epochId]
  );

  return {
    total: parseInt(result.rows[0]?.total ?? '0', 10),
    weightEligible: parseInt(result.rows[0]?.weight_eligible ?? '0', 10),
  };
}

async function fetchTopRankedPosts(
  queryable: SqlQueryable,
  epochId: number,
  limit: number
): Promise<RankedPost[]> {
  const result = await queryable.query<{ post_uri: string; total_score: number | string }>(
    `SELECT post_uri, total_score
     FROM post_scores
     WHERE epoch_id = $1
     ORDER BY total_score DESC
     LIMIT $2`,
    [epochId, limit]
  );

  return result.rows.map((row, index) => ({
    uri: row.post_uri,
    rank: index + 1,
    totalScore: toFiniteNumber(row.total_score),
  }));
}

function computeRankImpact(before: RankedPost[], after: RankedPost[]) {
  const beforeMap = new Map(before.map((post) => [post.uri, post]));
  const afterMap = new Map(after.map((post) => [post.uri, post]));

  const rankChanges: RankChange[] = before.map((beforePost) => {
    const afterPost = afterMap.get(beforePost.uri);

    if (!afterPost) {
      return {
        uri: beforePost.uri,
        oldRank: beforePost.rank,
        newRank: null,
        change: null,
      };
    }

    return {
      uri: beforePost.uri,
      oldRank: beforePost.rank,
      newRank: afterPost.rank,
      change: afterPost.rank - beforePost.rank,
    };
  });

  const changedCount = rankChanges.filter((change) => change.change === null || change.change !== 0).length;
  const numericChanges = rankChanges.filter((change): change is RankChange & { change: number } => change.change !== null);
  const avgRankChange =
    numericChanges.length > 0
      ? numericChanges.reduce((sum, change) => sum + Math.abs(change.change), 0) / numericChanges.length
      : 0;

  const topGainers = numericChanges
    .filter((change) => change.change <= -5)
    .sort((a, b) => a.change - b.change)
    .slice(0, 5);

  const topLosers = numericChanges
    .filter((change) => change.change >= 5)
    .sort((a, b) => b.change - a.change)
    .slice(0, 5);

  const droppedPosts = rankChanges
    .filter((change) => change.newRank === null)
    .slice(0, 5);

  const newEntrants = after
    .filter((post) => !beforeMap.has(post.uri))
    .slice(0, 5)
    .map<RankChange>((post) => ({
      uri: post.uri,
      oldRank: null,
      newRank: post.rank,
      change: null,
    }));

  return {
    postsAnalyzed: before.length,
    postsChangedRank: changedCount,
    avgRankChange,
    topGainers,
    topLosers,
    droppedPosts,
    newEntrants,
  };
}

async function logTransitionImpact(options: {
  oldEpochId: number;
  newEpochId: number;
  oldWeights: GovernanceWeights;
  newWeights: GovernanceWeights;
  beforeRanking: RankedPost[];
  forced?: boolean;
}): Promise<void> {
  const { oldEpochId, newEpochId, oldWeights, newWeights, beforeRanking, forced = false } = options;

  let scoringError: string | null = null;
  try {
    await runScoringPipeline();
  } catch (error) {
    scoringError = error instanceof Error ? error.message : String(error);
    logger.error({ error, oldEpochId, newEpochId }, 'Failed to run immediate scoring for transition impact audit');
  }

  const afterRanking = await fetchTopRankedPosts(db, newEpochId, 100);
  const impact = computeRankImpact(beforeRanking, afterRanking);

  await db.query(
    `INSERT INTO governance_audit_log (action, epoch_id, details)
     VALUES ('epoch_transition_impact', $1, $2)`,
    [
      newEpochId,
      JSON.stringify({
        oldEpochId,
        newEpochId,
        oldWeights,
        newWeights,
        forced,
        postsAnalyzed: impact.postsAnalyzed,
        postsChangedRank: impact.postsChangedRank,
        avgRankChange: impact.avgRankChange,
        topGainers: impact.topGainers,
        topLosers: impact.topLosers,
        droppedPosts: impact.droppedPosts,
        newEntrants: impact.newEntrants,
        beforeTopPosts: beforeRanking.map((post) => ({ uri: post.uri, rank: post.rank, totalScore: post.totalScore })),
        afterTopPosts: afterRanking.map((post) => ({ uri: post.uri, rank: post.rank, totalScore: post.totalScore })),
        scoringError,
      }),
    ]
  );

  logger.info(
    {
      oldEpochId,
      newEpochId,
      postsAnalyzed: impact.postsAnalyzed,
      postsChangedRank: impact.postsChangedRank,
      avgRankChange: impact.avgRankChange,
      forced,
      scoringError,
    },
    'Epoch transition impact audit logged'
  );
}

/**
 * Open the voting period for the current epoch.
 * Changes status from 'active' to 'voting'.
 */
export async function openVotingPeriod(): Promise<void> {
  const result = await db.query(
    `UPDATE governance_epochs
     SET status = 'voting'
     WHERE status = 'active'
     RETURNING id`
  );

  if (result.rows.length === 0) {
    throw new Error('No active epoch to open voting for');
  }

  const epochId = result.rows[0].id;

  // Audit log
  await db.query(
    `INSERT INTO governance_audit_log (action, epoch_id, details)
     VALUES ('voting_opened', $1, $2)`,
    [epochId, JSON.stringify({ opened_at: new Date().toISOString() })]
  );

  logger.info({ epochId }, 'Voting period opened');

  // Post announcement (fire-and-forget)
  postAnnouncementSafe({ type: 'voting_opened', epochId }).catch(() => {});
}

/**
 * Close the current epoch and create a new one with aggregated votes.
 * This is the main epoch transition function.
 *
 * @returns The ID of the newly created epoch
 */
export async function closeCurrentEpochAndCreateNext(): Promise<number> {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // 1. Get current active/voting epoch
    const current = await client.query(
      `SELECT * FROM governance_epochs
       WHERE status IN ('active', 'voting')
       ORDER BY id DESC LIMIT 1
       FOR UPDATE`
    );

    if (!current.rows[0]) {
      throw new Error('No active epoch to close');
    }

    const currentEpoch = current.rows[0];
    const currentEpochId = currentEpoch.id;

    // 2. Check vote count
    const voteCounts = await getVoteCountsForEpoch(client, currentEpochId);
    const voteCount = voteCounts.total;
    const weightVoteCount = voteCounts.weightEligible;

    if (weightVoteCount < config.GOVERNANCE_MIN_VOTES) {
      throw new Error(
        `Insufficient weight votes: ${weightVoteCount} < ${config.GOVERNANCE_MIN_VOTES} required`
      );
    }

    const beforeRanking = await fetchTopRankedPosts(client, currentEpochId, 100);

    // 3. Aggregate weight votes
    const newWeights = await aggregateVotes(currentEpochId);

    if (!newWeights) {
      throw new Error('Vote aggregation failed');
    }

    const newWeightsPayload = weightsToVotePayload(newWeights);

    // 3b. Aggregate content votes
    const contentRules = await aggregateContentVotes(currentEpochId);

    // 3c. Aggregate topic weight votes
    const topicWeights = await aggregateTopicWeights(currentEpochId);

    // 4. Close current epoch
    await client.query(
      `UPDATE governance_epochs
       SET status = 'closed', closed_at = NOW()
       WHERE id = $1`,
      [currentEpochId]
    );

    // 5. Create new epoch with aggregated weights, content rules, and topic weights
    const newEpoch = await client.query(
      `INSERT INTO governance_epochs (
        recency_weight, engagement_weight, bridging_weight,
        source_diversity_weight, relevance_weight,
        content_rules, topic_weights,
        vote_count, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        newWeightsPayload.recency_weight,
        newWeightsPayload.engagement_weight,
        newWeightsPayload.bridging_weight,
        newWeightsPayload.source_diversity_weight,
        newWeightsPayload.relevance_weight,
        JSON.stringify({
          include_keywords: contentRules.includeKeywords,
          exclude_keywords: contentRules.excludeKeywords,
        }),
        JSON.stringify(topicWeights),
        weightVoteCount,
        `Weights updated from epoch ${currentEpochId} based on ${weightVoteCount} weight votes (${voteCount} total votes).`,
      ]
    );

    const newEpochId = newEpoch.rows[0].id;

    // 6. Audit log - epoch closed
    const oldWeights: GovernanceWeights = {
      recency: currentEpoch.recency_weight,
      engagement: currentEpoch.engagement_weight,
      bridging: currentEpoch.bridging_weight,
      sourceDiversity: currentEpoch.source_diversity_weight,
      relevance: currentEpoch.relevance_weight,
    };

    await client.query(
      `INSERT INTO governance_audit_log (action, epoch_id, details)
       VALUES ('epoch_closed', $1, $2)`,
      [
        currentEpochId,
        JSON.stringify({
          old_weights: oldWeights,
          new_weights: newWeights,
          topic_weights: topicWeights,
          vote_count: weightVoteCount,
          total_vote_count: voteCount,
          new_epoch_id: newEpochId,
        }),
      ]
    );

    // 7. Audit log - epoch created
    await client.query(
      `INSERT INTO governance_audit_log (action, epoch_id, details)
       VALUES ('epoch_created', $1, $2)`,
      [
        newEpochId,
        JSON.stringify({
          weights: newWeights,
          content_rules: contentRules,
          topic_weights: topicWeights,
          derived_from_epoch: currentEpochId,
          vote_count: weightVoteCount,
          total_vote_count: voteCount,
        }),
      ]
    );

    await client.query('COMMIT');

    // Invalidate content rules cache so scoring pipeline picks up new rules
    await invalidateContentRulesCache();

    try {
      await logTransitionImpact({
        oldEpochId: currentEpochId,
        newEpochId,
        oldWeights,
        newWeights,
        beforeRanking,
      });
    } catch (error) {
      logger.error({ error, oldEpochId: currentEpochId, newEpochId }, 'Failed to log epoch transition impact');
    }

    logger.info(
      {
        closedEpoch: currentEpochId,
        newEpoch: newEpochId,
        voteCount: weightVoteCount,
        totalVoteCount: voteCount,
        oldWeights,
        newWeights,
        topicWeightsCount: Object.keys(topicWeights).length,
        contentRules: {
          includeKeywords: contentRules.includeKeywords.length,
          excludeKeywords: contentRules.excludeKeywords.length,
        },
      },
      'Governance epoch transition complete'
    );

    // Post announcement (fire-and-forget)
    postAnnouncementSafe({
      type: 'epoch_transition',
      oldEpochId: currentEpochId,
      newEpochId,
      voteCount,
      oldWeights,
      newWeights,
    }).catch(() => {});

    return newEpochId;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Failed to transition governance epoch');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get the current epoch status.
 */
export async function getCurrentEpochStatus(): Promise<{
  epochId: number;
  status: string;
  voteCount: number;
  totalVoteCount: number;
  minVotesRequired: number;
  canTransition: boolean;
} | null> {
  const result = await db.query(
    `SELECT * FROM governance_epochs
     WHERE status IN ('active', 'voting')
     ORDER BY id DESC LIMIT 1`
  );

  if (result.rows.length === 0) {
    return null;
  }

  const epoch = result.rows[0];

  const voteCounts = await getVoteCountsForEpoch(db, epoch.id);
  const voteCount = voteCounts.weightEligible;

  return {
    epochId: epoch.id,
    status: epoch.status,
    voteCount,
    totalVoteCount: voteCounts.total,
    minVotesRequired: config.GOVERNANCE_MIN_VOTES,
    canTransition: voteCount >= config.GOVERNANCE_MIN_VOTES,
  };
}

/**
 * Manually trigger epoch transition (admin function).
 * Only works if minimum votes met.
 */
export async function triggerEpochTransition(): Promise<{ success: boolean; newEpochId?: number; error?: string }> {
  try {
    const status = await getCurrentEpochStatus();

    if (!status) {
      return { success: false, error: 'No active epoch' };
    }

    if (!status.canTransition) {
      return {
        success: false,
        error: `Insufficient votes: ${status.voteCount}/${status.minVotesRequired}`,
      };
    }

    const newEpochId = await closeCurrentEpochAndCreateNext();
    return { success: true, newEpochId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Force epoch transition (admin only).
 * Skips vote count check - for testing and emergency use.
 *
 * @returns The ID of the newly created epoch
 */
export async function forceEpochTransition(): Promise<number> {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // 1. Get current active/voting epoch
    const current = await client.query(
      `SELECT * FROM governance_epochs
       WHERE status IN ('active', 'voting')
       ORDER BY id DESC LIMIT 1
       FOR UPDATE`
    );

    if (!current.rows[0]) {
      throw new Error('No active epoch to close');
    }

    const currentEpoch = current.rows[0];
    const currentEpochId = currentEpoch.id;

    const beforeRanking = await fetchTopRankedPosts(client, currentEpochId, 100);

    // Get vote count (for logging, not validation)
    const voteCounts = await getVoteCountsForEpoch(client, currentEpochId);
    const voteCount = voteCounts.total;
    const weightVoteCount = voteCounts.weightEligible;

    // NOTE: Skipping vote count check - this is a forced transition

    // 2. Aggregate weight votes (use current epoch weights if no votes)
    let newWeights = await aggregateVotes(currentEpochId);

    if (!newWeights) {
      // Use current epoch weights if aggregation fails
      newWeights = {
        recency: currentEpoch.recency_weight,
        engagement: currentEpoch.engagement_weight,
        bridging: currentEpoch.bridging_weight,
        sourceDiversity: currentEpoch.source_diversity_weight,
        relevance: currentEpoch.relevance_weight,
      };
    }

    const newWeightsPayload = weightsToVotePayload(newWeights);

    // 3. Aggregate content votes
    const contentRules = await aggregateContentVotes(currentEpochId);

    // 3b. Aggregate topic weight votes
    const topicWeights = await aggregateTopicWeights(currentEpochId);

    // 4. Close current epoch
    await client.query(
      `UPDATE governance_epochs
       SET status = 'closed', closed_at = NOW()
       WHERE id = $1`,
      [currentEpochId]
    );

    // 5. Create new epoch with aggregated weights, content rules, and topic weights
    const newEpoch = await client.query(
      `INSERT INTO governance_epochs (
        recency_weight, engagement_weight, bridging_weight,
        source_diversity_weight, relevance_weight,
        content_rules, topic_weights,
        vote_count, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        newWeightsPayload.recency_weight,
        newWeightsPayload.engagement_weight,
        newWeightsPayload.bridging_weight,
        newWeightsPayload.source_diversity_weight,
        newWeightsPayload.relevance_weight,
        JSON.stringify({
          include_keywords: contentRules.includeKeywords,
          exclude_keywords: contentRules.excludeKeywords,
        }),
        JSON.stringify(topicWeights),
        weightVoteCount,
        `FORCED transition from epoch ${currentEpochId} with ${weightVoteCount} weight votes (${voteCount} total votes).`,
      ]
    );

    const newEpochId = newEpoch.rows[0].id;

    // 6. Audit log - epoch closed
    const oldWeights: GovernanceWeights = {
      recency: currentEpoch.recency_weight,
      engagement: currentEpoch.engagement_weight,
      bridging: currentEpoch.bridging_weight,
      sourceDiversity: currentEpoch.source_diversity_weight,
      relevance: currentEpoch.relevance_weight,
    };

    await client.query(
      `INSERT INTO governance_audit_log (action, epoch_id, details)
       VALUES ('epoch_closed', $1, $2)`,
      [
        currentEpochId,
        JSON.stringify({
          old_weights: oldWeights,
          new_weights: newWeights,
          topic_weights: topicWeights,
          vote_count: weightVoteCount,
          total_vote_count: voteCount,
          new_epoch_id: newEpochId,
          forced: true,
        }),
      ]
    );

    // 7. Audit log - epoch created
    await client.query(
      `INSERT INTO governance_audit_log (action, epoch_id, details)
       VALUES ('epoch_created', $1, $2)`,
      [
        newEpochId,
        JSON.stringify({
          weights: newWeights,
          content_rules: contentRules,
          topic_weights: topicWeights,
          derived_from_epoch: currentEpochId,
          vote_count: weightVoteCount,
          total_vote_count: voteCount,
          forced: true,
        }),
      ]
    );

    await client.query('COMMIT');

    // Invalidate content rules cache so scoring pipeline picks up new rules
    await invalidateContentRulesCache();

    try {
      await logTransitionImpact({
        oldEpochId: currentEpochId,
        newEpochId,
        oldWeights,
        newWeights,
        beforeRanking,
        forced: true,
      });
    } catch (error) {
      logger.error(
        { error, oldEpochId: currentEpochId, newEpochId },
        'Failed to log forced epoch transition impact'
      );
    }

    logger.warn(
      {
        closedEpoch: currentEpochId,
        newEpoch: newEpochId,
        voteCount: weightVoteCount,
        totalVoteCount: voteCount,
        oldWeights,
        newWeights,
        topicWeightsCount: Object.keys(topicWeights).length,
        contentRules: {
          includeKeywords: contentRules.includeKeywords,
          excludeKeywords: contentRules.excludeKeywords,
        },
      },
      'FORCED governance epoch transition complete'
    );

    return newEpochId;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Failed to force transition governance epoch');
    throw err;
  } finally {
    client.release();
  }
}
