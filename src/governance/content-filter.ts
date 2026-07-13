/**
 * Content Filter Module
 *
 * Applies epoch-specific content rules to filter posts during scoring.
 * Uses Redis caching to minimize database queries.
 */

import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { logger } from '../lib/logger.js';
import {
  ContentRules,
  ContentRulesRow,
  toContentRules,
  emptyContentRules,
} from './governance.types.js';
import { checkContentRules } from './content-rule-matcher.js';

export { checkContentRules } from './content-rule-matcher.js';

// Cache TTL for content rules (5 minutes - matches scoring interval)
const CACHE_TTL_SECONDS = 300;
const CACHE_KEY = 'content_rules:current';
/**
 * Get current epoch's content rules with Redis caching.
 */
export async function getCurrentContentRules(): Promise<ContentRules> {
  // Stage 1: cache read (best-effort)
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as Partial<ContentRules>;
        if (Array.isArray(parsed.includeKeywords) && Array.isArray(parsed.excludeKeywords)) {
          return {
            includeKeywords: parsed.includeKeywords,
            excludeKeywords: parsed.excludeKeywords,
          };
        }
        logger.warn(
          { reason: 'cache_parse_failed' },
          'Cached content rules had unexpected shape, falling back to database'
        );
      } catch (error) {
        logger.warn(
          { error, reason: 'cache_parse_failed' },
          'Failed to parse cached content rules, falling back to database'
        );
      }
    }
  } catch (error) {
    logger.warn(
      { error, reason: 'redis_read_failed' },
      'Failed to read content rules from Redis, falling back to database'
    );
  }

  // Stage 2: database load (source of truth on cache miss/failure)
  try {
    const contentRules = await loadCurrentContentRulesFromDb();
    if (!contentRules) {
      logger.warn('No active epoch found for content rules');
      return emptyContentRules();
    }

    // Cache for subsequent queries (best-effort)
    try {
      await redis.set(CACHE_KEY, JSON.stringify(contentRules), 'EX', CACHE_TTL_SECONDS);
    } catch (error) {
      logger.warn(
        { error, reason: 'redis_write_failed' },
        'Failed to cache content rules in Redis'
      );
    }

    logger.debug(
      {
        includeCount: contentRules.includeKeywords.length,
        excludeCount: contentRules.excludeKeywords.length,
      },
      'Content rules loaded from database'
    );

    return contentRules;
  } catch (error) {
    logger.error({ error }, 'Failed to load content rules from database, returning empty rules');
    return emptyContentRules();
  }
}

async function loadCurrentContentRulesFromDb(): Promise<ContentRules | null> {
  const result = await db.query<{ content_rules: ContentRulesRow | null }>(
    `SELECT content_rules FROM governance_epochs
     WHERE status IN ('active', 'voting')
     ORDER BY id DESC LIMIT 1`
  );

  if (result.rows.length === 0) {
    return null;
  }

  return toContentRules(result.rows[0].content_rules);
}

/**
 * Read the active policy directly from PostgreSQL.
 *
 * Scoring uses this strict path so a cache or database failure can never be
 * mistaken for an intentionally empty content policy.
 */
export async function getCurrentContentRulesFromDatabase(): Promise<ContentRules> {
  const contentRules = await loadCurrentContentRulesFromDb();
  if (!contentRules) {
    throw new Error('No active governance epoch found while loading content rules');
  }

  return contentRules;
}

/** Invalidate the cache and propagate failures to a durability-sensitive caller. */
export async function invalidateContentRulesCacheStrict(): Promise<void> {
  await redis.del(CACHE_KEY);
  logger.debug('Content rules cache invalidated');
}

/**
 * Invalidate the content rules cache.
 * Call this when epoch changes or content rules are updated.
 */
export async function invalidateContentRulesCache(): Promise<void> {
  try {
    await invalidateContentRulesCacheStrict();
  } catch (error) {
    logger.error({ error }, 'Failed to invalidate content rules cache');
  }
}

/**
 * Post type for filtering (minimal interface).
 */
export interface FilterablePost {
  uri: string;
  text: string | null;
}

/**
 * Filtered post with reason.
 */
export interface FilteredPost<T extends FilterablePost> {
  post: T;
  reason: string;
  matchedKeyword?: string;
}

/**
 * Filter result containing passed and filtered posts.
 */
export interface FilterResult<T extends FilterablePost> {
  passed: T[];
  filtered: FilteredPost<T>[];
}

/**
 * Filter an array of posts according to content rules.
 * Returns posts that pass the filter and details about filtered posts.
 */
export function filterPosts<T extends FilterablePost>(
  posts: T[],
  rules: ContentRules
): FilterResult<T> {
  const passed: T[] = [];
  const filtered: FilteredPost<T>[] = [];

  // No filtering if no rules
  if (rules.includeKeywords.length === 0 && rules.excludeKeywords.length === 0) {
    return { passed: posts, filtered: [] };
  }

  for (const post of posts) {
    const result = checkContentRules(post.text, rules);
    if (result.passes) {
      passed.push(post);
    } else {
      filtered.push({
        post,
        reason: result.reason ?? 'unknown',
        matchedKeyword: result.matchedKeyword,
      });
    }
  }

  logger.debug(
    {
      total: posts.length,
      passed: passed.length,
      filtered: filtered.length,
      includeKeywords: rules.includeKeywords.length,
      excludeKeywords: rules.excludeKeywords.length,
    },
    'Content filtering complete'
  );

  return { passed, filtered };
}

/**
 * Check if content rules are active (have any keywords).
 */
export function hasActiveContentRules(rules: ContentRules): boolean {
  return rules.includeKeywords.length > 0 || rules.excludeKeywords.length > 0;
}
