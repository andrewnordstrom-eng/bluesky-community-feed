/**
 * Embedding-Based Ingestion Classifier
 *
 * Computes a refined topic vector for posts that pass the governance gate.
 * Uses the same all-MiniLM-L6-v2 model and topic centroid comparison as
 * the batch classifier, but operates on single posts at ingestion time.
 *
 * This REPLACES the keyword-based topic vector before storage, producing
 * more accurate classification that avoids word-sense ambiguity
 * (e.g., "fork in the road" vs "fork the repository").
 *
 * Fail-open: if the embedder is not ready or inference fails, the
 * keyword-based vector from winkNLP is used as fallback.
 */

import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { embedTexts, cosineSimilarity, isEmbedderReady } from '../scoring/topics/embedder.js';
import { getTopicsWithEmbeddings } from '../scoring/topics/taxonomy.js';
import type { TopicVector } from '../scoring/topics/classifier.js';

/** Result of single-post embedding classification. */
export interface EmbeddingClassifyResult {
  vector: TopicVector;
  method: 'embedding' | 'keyword_fallback';
}

/**
 * Classify a single post by embedding similarity against topic centroids.
 *
 * Steps:
 * 1. Embed the post text via all-MiniLM-L6-v2
 * 2. Compute cosine similarity against each topic centroid
 * 3. Include topics above TOPIC_EMBEDDING_MIN_SIMILARITY threshold
 *
 * @param text - Post text (including alt text, already joined)
 * @returns Classification result, or null if embedder is not ready (fail-open)
 */
export async function classifyPostByEmbedding(
  text: string
): Promise<EmbeddingClassifyResult | null> {
  if (!isEmbedderReady()) {
    return null;
  }

  if (!text || text.trim().length === 0) {
    return { vector: {}, method: 'keyword_fallback' };
  }

  const topicsWithEmbeddings = getTopicsWithEmbeddings();
  if (!topicsWithEmbeddings || topicsWithEmbeddings.length === 0) {
    logger.warn('No topic embeddings available — skipping embedding classification');
    return null;
  }

  const minSimilarity = config.TOPIC_EMBEDDING_MIN_SIMILARITY;

  // Embed the single post text (batch of 1)
  const [postEmbedding] = await embedTexts([text]);
  const vector: TopicVector = {};

  for (const topic of topicsWithEmbeddings) {
    const similarity = cosineSimilarity(postEmbedding, topic.embedding);
    if (similarity >= minSimilarity) {
      vector[topic.slug] = Math.round(similarity * 100) / 100;
    }
  }

  return { vector, method: 'embedding' };
}
