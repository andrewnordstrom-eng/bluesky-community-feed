/**
 * Relevance Scoring Component
 *
 * MVP: Returns 0.5 for all posts (neutral).
 * This means the relevance weight effectively gets distributed evenly.
 *
 * Upgrade path:
 * 1. MVP: Return 0.5 for all posts (implemented here)
 * 2. V2: Keyword/topic matching based on subscriber interests
 * 3. V3: Sentence transformer embeddings + cosine similarity
 * 4. V4: Fine-tuned classifier
 *
 * The interface is designed to support future implementations that take
 * post content and subscriber context into account.
 */

import type { PostForScoring } from '../score.types.js';
import type { ScoringComponent } from '../component.interface.js';

/** Default relevance score for MVP (neutral) */
const DEFAULT_RELEVANCE_SCORE = 0.5;

/**
 * Calculate relevance score for a post.
 *
 * @param _post - The post to score (unused in MVP)
 * @returns Score between 0.0 and 1.0 (higher = more relevant)
 */
export function scoreRelevance(_post: PostForScoring): number {
  // MVP: All posts equally relevant
  // Future: Implement content-based relevance scoring
  return DEFAULT_RELEVANCE_SCORE;
}

/**
 * Future interface for personalized relevance scoring.
 * This will be implemented when we add subscriber interest tracking.
 *
 * @param _post - The post to score
 * @param _subscriberDid - The subscriber requesting the feed
 * @returns Score between 0.0 and 1.0 (higher = more relevant to this subscriber)
 */
export async function scorePersonalizedRelevance(
  _post: PostForScoring,
  _subscriberDid: string
): Promise<number> {
  // Placeholder for future implementation
  // Will use subscriber interests, followed topics, etc.
  return DEFAULT_RELEVANCE_SCORE;
}

/** ScoringComponent wrapper for the relevance scorer. */
export const relevanceComponent: ScoringComponent = {
  key: 'relevance',
  name: 'Relevance',
  async score(post) {
    return scoreRelevance(post);
  },
};
