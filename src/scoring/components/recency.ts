/**
 * Recency Scoring Component
 *
 * Scores posts based on how recently they were created.
 * Uses exponential decay with half-life at 1/4 of the scoring window.
 *
 * Formula: e^(-λ × age) where λ = ln(2) / halfLife
 *
 * Examples (for 72-hour window, 18-hour half-life):
 * - 0 hours old: 1.0
 * - 18 hours old: 0.5
 * - 36 hours old: 0.25
 * - 72 hours old: 0.0625
 */

import type { ScoringComponent } from '../component.interface.js';

/**
 * Calculate recency score for a post.
 *
 * @param createdAt - When the post was created
 * @param windowHours - The scoring window in hours (posts older than this get minimal score)
 * @returns Score between 0.0 and 1.0 (newer = higher)
 */
export function scoreRecency(createdAt: Date | string, windowHours: number): number {
  return scoreRecencyAt(createdAt, windowHours, new Date());
}

export function scoreRecencyAt(
  createdAt: Date | string,
  windowHours: number,
  asOf: Date | string
): number {
  const postTime = new Date(createdAt).getTime();
  const now = new Date(asOf).getTime();
  if (!Number.isFinite(postTime) || !Number.isFinite(now)) {
    throw new RangeError(`Invalid recency timestamp: createdAt=${String(createdAt)}, asOf=${String(asOf)}`);
  }
  if (!Number.isFinite(windowHours) || windowHours <= 0) {
    throw new RangeError(`windowHours must be positive, got ${windowHours}`);
  }
  const ageHours = (now - postTime) / (1000 * 60 * 60);

  // Handle edge cases
  if (ageHours < 0) {
    // Future posts (clock skew) get max score
    return 1.0;
  }

  if (ageHours > windowHours) {
    // Posts outside the window get minimal score (but not zero for tie-breaking)
    return 0.01;
  }

  // Exponential decay
  // Half-life at 1/4 of the window (e.g., 18 hours for a 72-hour window)
  const halfLife = windowHours / 4;
  const lambda = Math.LN2 / halfLife;

  return Math.exp(-lambda * ageHours);
}

/** ScoringComponent wrapper for the recency scorer. */
export const recencyComponent: ScoringComponent = {
  key: 'recency',
  name: 'Recency',
  async score(post, context) {
    return scoreRecencyAt(
      post.createdAt,
      context.scoringWindowHours,
      context.asOf ?? new Date()
    );
  },
};
