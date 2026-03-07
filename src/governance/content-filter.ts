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
  ContentFilterResult,
  ContentRulesRow,
  toContentRules,
  emptyContentRules,
} from './governance.types.js';

// Cache TTL for content rules (5 minutes - matches scoring interval)
const CACHE_TTL_SECONDS = 300;
const CACHE_KEY = 'content_rules:current';
const ASCII_KEYWORD_PATTERN = /^[a-z0-9][a-z0-9\s-]*$/;
const UNICODE_WORD_CLASS = '\\p{L}\\p{N}';
const keywordMatcherCache = new Map<string, (text: string) => boolean>();

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a cached keyword matcher function.
 *
 * @param keyword - Keyword to match (will be normalized)
 * @param prefixMatch - When true, drops the trailing word boundary so "kink" matches "kinks"/"kinky".
 *                      Used for exclude keywords where catching variants is more important than precision.
 *                      Include keywords always use strict boundaries (prefixMatch=false).
 * @returns Matcher function that tests a lowercased text string
 */
function getKeywordMatcher(keyword: string, prefixMatch?: boolean): (text: string) => boolean {
  const normalizedKeyword = keyword.trim().toLowerCase();
  const cacheKey = `${normalizedKeyword}:${prefixMatch ? 'prefix' : 'strict'}`;
  const cached = keywordMatcherCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Keep substring matching for non-ASCII keywords/symbol-heavy values.
  // Most governance keywords are normalized ASCII terms and use strict boundaries.
  if (!ASCII_KEYWORD_PATTERN.test(normalizedKeyword)) {
    const matcher = (text: string) => text.includes(normalizedKeyword);
    keywordMatcherCache.set(cacheKey, matcher);
    return matcher;
  }

  const phrasePattern = normalizedKeyword
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map(escapeRegex)
    .join('[\\s_-]+');

  // Prefix mode: match "kink" → "kinks", "kinky", "kinkier".
  // Strict mode: exact word boundaries on both sides.
  const trailingBoundary = prefixMatch ? '' : `(?=$|[^${UNICODE_WORD_CLASS}])`;
  const regex = new RegExp(
    `(^|[^${UNICODE_WORD_CLASS}])${phrasePattern}${trailingBoundary}`,
    'u'
  );
  const matcher = (text: string) => regex.test(text);
  keywordMatcherCache.set(cacheKey, matcher);
  return matcher;
}

/**
 * Test whether lowercased text contains a keyword.
 *
 * @param text - Lowercased post text
 * @param keyword - Keyword to search for
 * @param prefixMatch - When true, uses prefix matching (e.g., "porn" matches "pornographic").
 *                      Default false (strict word boundaries).
 * @returns True if keyword is found in text
 */
function matchesKeyword(text: string, keyword: string, prefixMatch?: boolean): boolean {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (normalizedKeyword.length === 0) {
    return false;
  }

  return getKeywordMatcher(normalizedKeyword, prefixMatch)(text);
}

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
 * Invalidate the content rules cache.
 * Call this when epoch changes or content rules are updated.
 */
export async function invalidateContentRulesCache(): Promise<void> {
  try {
    await redis.del(CACHE_KEY);
    logger.debug('Content rules cache invalidated');
  } catch (error) {
    logger.error({ error }, 'Failed to invalidate content rules cache');
  }
}

/**
 * Check if a post's text matches the content rules.
 *
 * Logic:
 * 1. If excludeKeywords is non-empty and post contains ANY exclude keyword -> filtered out
 * 2. If includeKeywords is non-empty and post contains NO include keywords -> filtered out
 * 3. Otherwise -> post passes
 *
 * Exclude takes precedence over include.
 *
 * @param text - The post text to check (case-insensitive matching)
 * @param rules - Content rules to apply
 * @returns Result with pass/fail, reason, and matched keyword
 */
export function checkContentRules(
  text: string | null,
  rules: ContentRules
): ContentFilterResult {
  // No rules = everything passes
  if (rules.includeKeywords.length === 0 && rules.excludeKeywords.length === 0) {
    return { passes: true };
  }

  // Posts without text (image-only)
  if (!text) {
    // If include rules exist, text-less posts fail
    if (rules.includeKeywords.length > 0) {
      return { passes: false, reason: 'no_text_with_include_filter' };
    }
    // No include rules and no text to check against exclude = passes
    return { passes: true };
  }

  const lowerText = text.toLowerCase();

  // Check excludes first (exclude takes precedence).
  // Prefix matching: "kink" catches "kinks"/"kinky", "porn" catches "pornographic".
  for (const keyword of rules.excludeKeywords) {
    if (matchesKeyword(lowerText, keyword, true)) {
      return {
        passes: false,
        reason: 'excluded_keyword',
        matchedKeyword: keyword,
      };
    }
  }

  // Check includes (if any are specified, post must match at least one).
  // Strict word boundaries: include keywords require exact matches for precision.
  if (rules.includeKeywords.length > 0) {
    for (const keyword of rules.includeKeywords) {
      if (matchesKeyword(lowerText, keyword, false)) {
        return { passes: true, matchedKeyword: keyword };
      }
    }
    // No include keyword matched
    return { passes: false, reason: 'no_include_match' };
  }

  // No include filter specified, post passes
  return { passes: true };
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
