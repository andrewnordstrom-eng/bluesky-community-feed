/**
 * Engagement Scoring Component
 *
 * Scores posts based on engagement (likes, reposts, replies).
 * Uses logarithmic scaling for diminishing returns - viral posts don't completely dominate.
 *
 * Weights:
 * - Likes: 1.0
 * - Reposts: 2.0
 * - Replies: 3.0
 *
 * Formula: log10(rawEngagement + 1) / log10(1001)
 * This normalizes to 0.0-1.0 range where 1000 engagement ≈ 1.0
 *
 * Examples:
 * - 0 engagement: 0.0
 * - 1 engagement: ~0.10
 * - 10 engagement: ~0.35
 * - 100 engagement: ~0.67
 * - 1000 engagement: 1.0
 */

/**
 * Calculate engagement score for a post.
 *
 * @param likes - Number of likes
 * @param reposts - Number of reposts
 * @param replies - Number of replies
 * @returns Score between 0.0 and 1.0 (more engagement = higher)
 */
export function scoreEngagement(
  likes: number,
  reposts: number,
  replies: number
): number {
  // Weight different engagement types (replies show deeper engagement)
  const raw = (likes * 1.0) + (reposts * 2.0) + (replies * 3.0);

  // Handle zero engagement
  if (raw === 0) {
    return 0;
  }

  // Logarithmic scaling with diminishing returns
  // Normalized so 1000 weighted engagement = 1.0
  const maxEngagement = 1001; // log10(1001) = ~3
  return Math.min(1.0, Math.log10(raw + 1) / Math.log10(maxEngagement));
}

import type { ScoringComponent } from '../component.interface.js';

/** ScoringComponent wrapper for the engagement scorer. */
export const engagementComponent: ScoringComponent = {
  key: 'engagement',
  name: 'Engagement',
  async score(post) {
    return scoreEngagement(post.likeCount, post.repostCount, post.replyCount);
  },
};
