/**
 * Embedding-Based Topic Classifier (Tier 2)
 *
 * Batch-classifies posts by computing cosine similarity between post text
 * embeddings and pre-computed topic embeddings. Runs during the scoring
 * pipeline (every 5 min), not at ingestion.
 *
 * Produces the same TopicVector shape as the winkNLP classifier, so the
 * relevance scoring component works identically with either source.
 *
 * Performance: ~20ms/post for embedding, <1ms for similarity computation.
 */

import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { embedTexts, cosineSimilarity } from './embedder.js';
import { getTopicsWithEmbeddings } from './taxonomy.js';
import type { TopicVector } from './classifier.js';

/**
 * Batch-classify posts using semantic embeddings.
 *
 * For each post:
 * 1. Embed the post text via all-MiniLM-L6-v2
 * 2. Compute cosine similarity against every topic embedding
 * 3. Include topics above TOPIC_EMBEDDING_MIN_SIMILARITY threshold
 * 4. Return sparse TopicVector (same format as winkNLP classifier)
 *
 * Posts with empty or missing text get an empty vector.
 *
 * @param posts - Array of posts with URI and text
 * @returns Map from post URI to TopicVector
 */
export async function classifyPostsBatch(
  posts: { uri: string; text: string }[]
): Promise<Map<string, TopicVector>> {
  const results = new Map<string, TopicVector>();
  const topicsWithEmbeddings = getTopicsWithEmbeddings();

  if (!topicsWithEmbeddings || topicsWithEmbeddings.length === 0) {
    logger.warn('No topic embeddings available — skipping embedding classification');
    return results;
  }

  // Separate posts with text from those without
  const postsWithText: { uri: string; text: string; index: number }[] = [];
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    if (!post.text || post.text.trim().length === 0) {
      results.set(post.uri, {});
    } else {
      postsWithText.push({ uri: post.uri, text: post.text, index: i });
    }
  }

  if (postsWithText.length === 0) {
    return results;
  }

  // Batch embed all post texts
  const startMs = Date.now();
  const texts = postsWithText.map((p) => p.text);
  const postEmbeddings = await embedTexts(texts);
  const embedMs = Date.now() - startMs;

  const minSimilarity = config.TOPIC_EMBEDDING_MIN_SIMILARITY;

  // Classify each post against all topics
  for (let i = 0; i < postsWithText.length; i++) {
    const post = postsWithText[i];
    const postEmb = postEmbeddings[i];
    const vector: TopicVector = {};

    for (const topic of topicsWithEmbeddings) {
      const similarity = cosineSimilarity(postEmb, topic.embedding);
      if (similarity >= minSimilarity) {
        vector[topic.slug] = Math.round(similarity * 100) / 100;
      }
    }

    results.set(post.uri, vector);
  }

  logger.info(
    {
      total_posts: posts.length,
      embedded: postsWithText.length,
      embed_ms: embedMs,
      classify_ms: Date.now() - startMs,
    },
    'Batch embedding classification complete'
  );

  return results;
}
