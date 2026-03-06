/**
 * Topic Taxonomy Module
 *
 * Loads and caches the topic catalog from the database.
 * Topics are the foundation for community-steerable topic scoring.
 * Phase 1 provides the data layer; Phase 2 adds the classifier.
 */

import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

/** A single topic from the catalog. */
export interface Topic {
  slug: string;
  name: string;
  description: string | null;
  parentSlug: string | null;
  terms: string[];
  contextTerms: string[];
  antiTerms: string[];
}

/** Cache TTL in milliseconds (5 minutes). */
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedTopics: Topic[] | null = null;
let cacheLoadedAt: number | null = null;

/**
 * Load active topics from the database and cache them in memory.
 *
 * @returns Array of active topics
 */
export async function loadTaxonomy(): Promise<Topic[]> {
  const result = await db.query(
    `SELECT slug, name, description, parent_slug, terms, context_terms, anti_terms
     FROM topic_catalog
     WHERE is_active = TRUE
     ORDER BY slug`
  );

  const topics: Topic[] = result.rows.map((row: Record<string, unknown>) => ({
    slug: row.slug as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    parentSlug: (row.parent_slug as string) ?? null,
    terms: (row.terms as string[]) ?? [],
    contextTerms: (row.context_terms as string[]) ?? [],
    antiTerms: (row.anti_terms as string[]) ?? [],
  }));

  cachedTopics = topics;
  cacheLoadedAt = Date.now();

  logger.info({ topicCount: topics.length }, 'Topic taxonomy loaded');

  return topics;
}

/**
 * Get the cached topic taxonomy.
 * Throws if loadTaxonomy() has not been called yet.
 * Returns stale cache if TTL has expired (caller should refresh).
 *
 * @returns Cached array of active topics
 */
export function getTaxonomy(): Topic[] {
  if (cachedTopics === null) {
    throw new Error('Topic taxonomy not loaded. Call loadTaxonomy() first.');
  }

  return cachedTopics;
}

/**
 * Check if the taxonomy cache has expired.
 *
 * @returns True if cache is stale or not loaded
 */
export function isTaxonomyCacheStale(): boolean {
  if (cachedTopics === null || cacheLoadedAt === null) return true;
  return Date.now() - cacheLoadedAt > CACHE_TTL_MS;
}

/**
 * Invalidate the taxonomy cache.
 * Call after admin changes to topics (add/remove/update).
 */
export function invalidateTaxonomyCache(): void {
  cachedTopics = null;
  cacheLoadedAt = null;
  logger.debug('Topic taxonomy cache invalidated');
}
