/**
 * Relevance Scoring Component
 *
 * Computes topic-weighted relevance using the community's governance preferences.
 *
 * Formula: relevance = Σ(post_topic_score[t] × community_weight[t]) / Σ(post_topic_score[t])
 *
 * This is a weighted average where the post's topic scores are weights and the
 * community preferences are values. If a post matches "software-development" at 0.8
 * and the community boosted it to 0.9, that contributes heavily. If it also matches
 * "politics" at 0.2 and the community penalized it to 0.1, that contributes little.
 *
 * Backward compatibility:
 * - Posts without topic vectors → 0.2 (below midpoint)
 * - Epochs without topic weights → 0.2 (below midpoint)
 * - Topics in post but not in community weights → default 0.2
 */

import type { PostForScoring } from '../score.types.js';
import type { ScoringComponent, ScoringContext } from '../component.interface.js';

/** Default relevance score when no topic data is available.
 * Set below midpoint so classified posts outrank unclassified ones
 * when the community has expressed topic preferences. */
const DEFAULT_RELEVANCE_SCORE = 0.2;

/** Minimum total topic signal (scoreSum) for full confidence.
 * Below this, relevance is scaled down proportionally.
 * Prevents single weak keyword matches from getting high relevance.
 * Set to 0 to disable confidence scaling (original behavior). */
export const CONFIDENCE_THRESHOLD = 0.5;

/**
 * Calculate topic-weighted relevance score.
 *
 * @param post - Post with optional topicVector
 * @param context - Scoring context with epoch containing optional topicWeights
 * @returns Score between 0.0 and 1.0 (higher = more relevant to community preferences)
 */
export function scoreRelevance(post: PostForScoring, context: ScoringContext): number {
  const topicVector = post.topicVector;
  const topicWeights = context.epoch.topicWeights;

  // No topic data on post = neutral
  if (!topicVector || Object.keys(topicVector).length === 0) {
    return DEFAULT_RELEVANCE_SCORE;
  }

  // No community preferences set = neutral
  if (!topicWeights || Object.keys(topicWeights).length === 0) {
    return DEFAULT_RELEVANCE_SCORE;
  }

  // Weighted dot product: Σ(post_topic × community_weight) / Σ(post_topic)
  let weightedSum = 0;
  let scoreSum = 0;

  for (const [topic, postScore] of Object.entries(topicVector)) {
    const communityWeight = topicWeights[topic] ?? DEFAULT_RELEVANCE_SCORE; // Unvoted = neutral
    weightedSum += postScore * communityWeight;
    scoreSum += postScore;
  }

  if (scoreSum === 0) return DEFAULT_RELEVANCE_SCORE;

  // Base relevance: weighted average of community preferences
  const baseRelevance = weightedSum / scoreSum;

  // Confidence multiplier: dampen weak classifications.
  // scoreSum reflects total topic signal strength from the classifier.
  // A single weak match (scoreSum ≈ 0.2) gets low confidence.
  // Multiple strong matches (scoreSum > threshold) get full confidence.
  const confidence = CONFIDENCE_THRESHOLD > 0
    ? Math.min(1.0, scoreSum / CONFIDENCE_THRESHOLD)
    : 1.0; // Disabled when threshold = 0

  return Math.max(0, Math.min(1, baseRelevance * confidence));
}

/** ScoringComponent wrapper for the relevance scorer. */
export const relevanceComponent: ScoringComponent = {
  key: 'relevance',
  name: 'Topic Relevance',
  async score(post, context) {
    return scoreRelevance(post, context);
  },
};
