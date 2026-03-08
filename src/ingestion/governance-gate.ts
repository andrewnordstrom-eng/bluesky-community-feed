/**
 * Governance-Driven Ingestion Gate
 *
 * Applies community topic weights as a binary gate at ingestion time.
 * Posts must achieve a minimum relevance score (weighted average of
 * topic matches × community weights) to be stored.
 *
 * Uses the SAME formula as relevance.ts but applied as a pass/reject gate
 * rather than a scoring component. Key difference: empty topic vectors
 * are rejected (no classification = no community topic match).
 *
 * Caching pattern mirrors content-filter.ts: Redis → DB → fail-open.
 */

import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';
import type { TopicVector } from '../scoring/topics/classifier.js';

/** Redis cache key for topic weights. */
const CACHE_KEY = 'governance_gate:topic_weights';

/** Cache TTL in seconds (5 minutes — matches scoring interval). */
const CACHE_TTL_SECONDS = 300;

/**
 * Default weight for topics not in community preferences.
 * Matches relevance.ts DEFAULT_RELEVANCE_SCORE for consistency.
 */
const DEFAULT_TOPIC_WEIGHT = 0.2;

/** In-memory ready flag — false until first successful load. */
let gateReady = false;

/** Result of the governance gate check. */
export interface GateResult {
  passes: boolean;
  relevance: number;
  bestTopic?: string;
}

/**
 * Load community topic weights from cache or database.
 *
 * Flow: Redis cache → DB fallback → empty map (fail-open).
 * Same pattern as content-filter.ts getCurrentContentRules().
 *
 * @returns Topic weights map (slug → weight 0.0-1.0), or null on failure
 */
async function loadTopicWeights(): Promise<Record<string, number> | null> {
  // Stage 1: Redis cache (best-effort)
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as Record<string, unknown>;
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return parsed as Record<string, number>;
        }
        logger.warn(
          { reason: 'cache_parse_failed' },
          'Cached topic weights had unexpected shape, falling back to database'
        );
      } catch (error) {
        logger.warn(
          { error, reason: 'cache_parse_failed' },
          'Failed to parse cached topic weights, falling back to database'
        );
      }
    }
  } catch (error) {
    logger.warn(
      { error, reason: 'redis_read_failed' },
      'Failed to read topic weights from Redis, falling back to database'
    );
  }

  // Stage 2: Database load (source of truth on cache miss/failure)
  try {
    const result = await db.query<{ topic_weights: Record<string, number> | null }>(
      `SELECT topic_weights FROM governance_epochs
       WHERE status IN ('active', 'voting')
       ORDER BY id DESC LIMIT 1`
    );

    if (result.rows.length === 0 || !result.rows[0].topic_weights) {
      logger.warn('No active epoch with topic weights found for governance gate');
      return null;
    }

    const weights = result.rows[0].topic_weights;

    // Cache for subsequent queries (best-effort)
    try {
      await redis.set(CACHE_KEY, JSON.stringify(weights), 'EX', CACHE_TTL_SECONDS);
    } catch (error) {
      logger.warn(
        { error, reason: 'redis_write_failed' },
        'Failed to cache topic weights in Redis'
      );
    }

    logger.debug(
      { topicCount: Object.keys(weights).length },
      'Topic weights loaded from database for governance gate'
    );

    return weights;
  } catch (error) {
    logger.error(
      { error },
      'Failed to load topic weights from database, gate will fail-open'
    );
    return null;
  }
}

/**
 * Load governance gate weights at startup.
 * Sets the ready flag on first successful load.
 */
export async function loadGovernanceGateWeights(): Promise<void> {
  const weights = await loadTopicWeights();
  if (weights !== null) {
    gateReady = true;
    logger.info(
      { topicCount: Object.keys(weights).length },
      'Governance gate initialized with topic weights'
    );
  }
}

/**
 * Check if governance gate weights have been loaded at least once.
 * Gate is fail-open until ready (all posts pass).
 */
export function isGovernanceGateReady(): boolean {
  return gateReady;
}

/**
 * Check whether a post's topic vector passes the governance relevance gate.
 *
 * Uses the SAME weighted-average formula as relevance.ts:
 *   relevance = Σ(post_topic_score × community_weight) / Σ(post_topic_score)
 *
 * Key differences from relevance.ts:
 * - Empty topic vector → REJECT (not default 0.2). No classification = no match.
 * - Empty/unavailable weights → PASS (fail-open for safety).
 *
 * @param topicVector - Post's topic classification vector from winkNLP
 * @returns Gate result with pass/fail, relevance score, and best matching topic
 */
export async function checkGovernanceGate(topicVector: TopicVector): Promise<GateResult> {
  // No topic classification = post matched zero community topics → reject
  if (!topicVector || Object.keys(topicVector).length === 0) {
    return { passes: false, relevance: 0 };
  }

  // Load topic weights (cached)
  const topicWeights = await loadTopicWeights();

  // No community preferences available → fail-open (pass all)
  if (!topicWeights || Object.keys(topicWeights).length === 0) {
    return { passes: true, relevance: DEFAULT_TOPIC_WEIGHT };
  }

  // Weighted dot product: same formula as relevance.ts
  let weightedSum = 0;
  let scoreSum = 0;
  let bestTopic: string | undefined;
  let bestContribution = -1;

  for (const [topic, postScore] of Object.entries(topicVector)) {
    const communityWeight = topicWeights[topic] ?? DEFAULT_TOPIC_WEIGHT;
    const contribution = postScore * communityWeight;

    weightedSum += contribution;
    scoreSum += postScore;

    if (contribution > bestContribution) {
      bestContribution = contribution;
      bestTopic = topic;
    }
  }

  if (scoreSum === 0) {
    return { passes: false, relevance: 0 };
  }

  const relevance = Math.max(0, Math.min(1, weightedSum / scoreSum));

  return {
    passes: relevance >= config.INGESTION_MIN_RELEVANCE,
    relevance,
    bestTopic,
  };
}

/**
 * Invalidate the governance gate topic weights cache.
 * Call when epoch changes or topic weights are updated.
 */
export async function invalidateGovernanceGateCache(): Promise<void> {
  try {
    await redis.del(CACHE_KEY);
    logger.debug('Governance gate topic weights cache invalidated');
  } catch (error) {
    logger.error({ error }, 'Failed to invalidate governance gate cache');
  }
}
