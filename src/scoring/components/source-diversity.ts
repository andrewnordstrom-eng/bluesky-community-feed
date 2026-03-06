/**
 * Source Diversity Scoring Component
 *
 * Penalizes feeds dominated by a single author.
 * Posts from authors who already have many posts in the current scoring
 * batch get lower scores, promoting variety.
 *
 * Algorithm:
 * - First post from an author in the batch: 1.0
 * - Second post: 0.7
 * - Third post: 0.5
 * - Fourth+ posts: 0.3
 *
 * This is calculated per-batch (in-memory) during the scoring pipeline run.
 * The pipeline maintains an author count map and passes it to this function.
 */

/**
 * Author counts tracked during a single scoring pipeline run.
 * Key: author DID, Value: number of posts already scored from this author
 */
export type AuthorCountMap = Map<string, number>;

/**
 * Create a new author count tracker for a scoring run.
 */
export function createAuthorCountMap(): AuthorCountMap {
  return new Map();
}

/**
 * Score penalties for repeated author posts.
 * Index = number of previous posts from same author in this batch.
 */
const DIVERSITY_PENALTIES: number[] = [
  1.0,  // First post: full score
  0.7,  // Second post
  0.5,  // Third post
  0.3,  // Fourth+ posts
];

/**
 * Calculate source diversity score for a post.
 *
 * This function also updates the author count map (side effect by design).
 *
 * @param authorDid - The post author's DID
 * @param authorCounts - In-memory map tracking how many posts per author have been scored
 * @returns Score between 0.0 and 1.0 (higher = author is underrepresented)
 */
export function scoreSourceDiversity(
  authorDid: string,
  authorCounts: AuthorCountMap
): number {
  // Get current count for this author
  const currentCount = authorCounts.get(authorDid) ?? 0;

  // Increment count for next time
  authorCounts.set(authorDid, currentCount + 1);

  // Look up penalty based on how many posts we've already seen from this author
  const penaltyIndex = Math.min(currentCount, DIVERSITY_PENALTIES.length - 1);
  return DIVERSITY_PENALTIES[penaltyIndex];
}

/**
 * Get diversity score WITHOUT updating the count map.
 * Use this for "what-if" calculations or transparency explanations.
 *
 * @param authorDid - The post author's DID
 * @param authorCounts - In-memory map tracking how many posts per author have been scored
 * @returns Score between 0.0 and 1.0 (higher = author is underrepresented)
 */
export function peekSourceDiversity(
  authorDid: string,
  authorCounts: AuthorCountMap
): number {
  const currentCount = authorCounts.get(authorDid) ?? 0;
  const penaltyIndex = Math.min(currentCount, DIVERSITY_PENALTIES.length - 1);
  return DIVERSITY_PENALTIES[penaltyIndex];
}

import type { ScoringComponent } from '../component.interface.js';

/** ScoringComponent wrapper for the source diversity scorer. */
export const sourceDiversityComponent: ScoringComponent = {
  key: 'sourceDiversity',
  name: 'Source Diversity',
  async score(post, context) {
    return scoreSourceDiversity(post.authorDid, context.authorCounts);
  },
};
