/**
 * Topic Taxonomy Module
 *
 * Loads and caches the topic catalog from the database.
 * Topics are the foundation for community-steerable topic scoring.
 * Phase 1 provides the data layer; Phase 2 adds the classifier.
 *
 * The module also manages topic embeddings for the Tier 2 semantic classifier.
 * When TOPIC_EMBEDDING_ENABLED=true, each topic gets a 384-dim embedding
 * computed from anchor sentences (cached in topic_catalog.topic_embedding).
 */

import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { embedTexts, EMBEDDING_DIM, isEmbedderReady } from './embedder.js';

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

/** A topic with its pre-computed 384-dim embedding for the semantic classifier. */
export interface TopicWithEmbedding extends Topic {
  embedding: Float32Array;
}

/** Cache TTL in milliseconds (5 minutes). */
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedTopics: Topic[] | null = null;
let cacheLoadedAt: number | null = null;

/** Cached topic embeddings (loaded/computed separately from taxonomy). */
let cachedTopicEmbeddings: TopicWithEmbedding[] | null = null;

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
 * Also clears the embedding cache so it's recomputed on next load.
 */
export function invalidateTaxonomyCache(): void {
  cachedTopics = null;
  cacheLoadedAt = null;
  cachedTopicEmbeddings = null;
  logger.debug('Topic taxonomy cache invalidated (including embeddings)');
}

/**
 * Generate anchor sentences for a topic.
 *
 * Anchor sentences provide richer semantic signal than a bare topic name.
 * The embeddings of these sentences are averaged into a single topic embedding.
 * Using 3+ anchors improves accuracy ~30% vs single-label embedding.
 *
 * @param topic - Topic to generate anchors for
 * @returns Array of 3 anchor sentences
 */
export function generateAnchors(topic: Topic): string[] {
  const descriptionAnchor = topic.description ?? topic.name;
  const nameAnchor = `This post is about ${topic.name.toLowerCase()}`;
  const termsAnchor = `A discussion about ${topic.terms.slice(0, 5).join(', ')}`;

  return [descriptionAnchor, nameAnchor, termsAnchor];
}

/**
 * Average multiple Float32Arrays element-wise.
 *
 * @param vectors - Arrays to average (must all be the same length)
 * @returns Single averaged vector
 */
function averageVectors(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) return new Float32Array(EMBEDDING_DIM);
  if (vectors.length === 1) return vectors[0];

  const result = new Float32Array(vectors[0].length);
  for (const vec of vectors) {
    for (let i = 0; i < vec.length; i++) {
      result[i] += vec[i];
    }
  }

  const n = vectors.length;
  for (let i = 0; i < result.length; i++) {
    result[i] /= n;
  }

  // L2-normalize the averaged vector
  let norm = 0;
  for (let i = 0; i < result.length; i++) {
    norm += result[i] * result[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < result.length; i++) {
      result[i] /= norm;
    }
  }

  return result;
}

/**
 * Load topic embeddings from DB cache or compute fresh.
 *
 * For each active topic:
 * 1. Check if topic_catalog.topic_embedding already has a cached vector
 * 2. If not, generate anchor sentences, embed them, average into one vector
 * 3. Store computed embeddings back to topic_catalog for persistence across restarts
 *
 * Requires the embedding model to be initialized first (initEmbedder()).
 *
 * @returns Array of topics with their embeddings
 * @throws If embedder is not ready or taxonomy is not loaded
 */
export async function loadTopicEmbeddings(): Promise<TopicWithEmbedding[]> {
  if (!isEmbedderReady()) {
    throw new Error('Embedding model not ready. Call initEmbedder() first.');
  }

  const topics = getTaxonomy();

  // Load any existing embeddings from DB
  const dbResult = await db.query(
    `SELECT slug, topic_embedding FROM topic_catalog WHERE is_active = TRUE`
  );
  const dbEmbeddings = new Map<string, number[] | null>();
  for (const row of dbResult.rows) {
    dbEmbeddings.set(row.slug as string, row.topic_embedding as number[] | null);
  }

  const topicsWithEmbeddings: TopicWithEmbedding[] = [];
  const topicsNeedingEmbedding: { index: number; topic: Topic; anchors: string[] }[] = [];

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const cached = dbEmbeddings.get(topic.slug);

    if (cached && cached.length === EMBEDDING_DIM) {
      // Use cached embedding from DB
      topicsWithEmbeddings.push({
        ...topic,
        embedding: new Float32Array(cached),
      });
    } else {
      // Queue for embedding computation
      const anchors = generateAnchors(topic);
      topicsNeedingEmbedding.push({ index: i, topic, anchors });
      // Placeholder — will be filled after batch embedding
      topicsWithEmbeddings.push({
        ...topic,
        embedding: new Float32Array(EMBEDDING_DIM),
      });
    }
  }

  if (topicsNeedingEmbedding.length > 0) {
    logger.info(
      { count: topicsNeedingEmbedding.length },
      'Computing embeddings for topics without cached vectors'
    );

    // Collect all anchor sentences for batch embedding
    const allAnchors: string[] = [];
    const anchorCounts: number[] = [];
    for (const item of topicsNeedingEmbedding) {
      allAnchors.push(...item.anchors);
      anchorCounts.push(item.anchors.length);
    }

    // Batch embed all anchors at once
    const allEmbeddings = await embedTexts(allAnchors);

    // Average anchors per topic and store back
    let embIdx = 0;
    for (let t = 0; t < topicsNeedingEmbedding.length; t++) {
      const { topic } = topicsNeedingEmbedding[t];
      const count = anchorCounts[t];
      const anchorEmbeddings = allEmbeddings.slice(embIdx, embIdx + count);
      embIdx += count;

      const averaged = averageVectors(anchorEmbeddings);

      // Find the placeholder position and update
      const topicIdx = topics.indexOf(topic);
      topicsWithEmbeddings[topicIdx] = { ...topic, embedding: averaged };

      // Persist to DB for future startup speed
      const embArray = Array.from(averaged);
      await db.query(
        `UPDATE topic_catalog SET topic_embedding = $1 WHERE slug = $2`,
        [embArray, topic.slug]
      );
    }

    logger.info(
      { computed: topicsNeedingEmbedding.length },
      'Topic embeddings computed and cached to DB'
    );
  }

  cachedTopicEmbeddings = topicsWithEmbeddings;
  logger.info({ topicCount: topicsWithEmbeddings.length }, 'Topic embeddings loaded');

  return topicsWithEmbeddings;
}

/**
 * Get the cached topic embeddings.
 *
 * @returns Array of topics with their embeddings, or null if not loaded
 */
export function getTopicsWithEmbeddings(): TopicWithEmbedding[] | null {
  return cachedTopicEmbeddings;
}
