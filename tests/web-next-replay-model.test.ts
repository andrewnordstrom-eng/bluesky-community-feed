import { describe, expect, it } from 'vitest';
import {
  aggregatePersonaWeights,
  defaultPersonaIds,
  demoPersonas,
  normalizeWeights,
  rankPostsForWeights,
  signals,
  type PersonaId,
} from '../web-next/lib/replay-model';
import { badgeMovementFor } from '../web-next/components/feed/replay-adapter';

function sumWeights(personaIds: readonly PersonaId[]): number {
  const weights = aggregatePersonaWeights(personaIds);

  return signals.reduce((sum, signal) => sum + weights[signal.key], 0);
}

describe('web-next replay model', () => {
  it('aggregates persona votes into a normalized deterministic weight vector', () => {
    const first = aggregatePersonaWeights(defaultPersonaIds);
    const second = aggregatePersonaWeights(defaultPersonaIds);

    expect(sumWeights(defaultPersonaIds)).toBeCloseTo(1, 10);
    expect(second).toEqual(first);
  });

  it('keeps each persona vote vector normalized', () => {
    for (const persona of demoPersonas) {
      const total = signals.reduce((sum, signal) => sum + persona.weights[signal.key], 0);

      expect(total, `${persona.id} weights should sum to 1`).toBeCloseTo(1, 10);
    }
  });

  it('changes the top ranked post when the stakeholder coalition changes', () => {
    const communityRanking = rankPostsForWeights(aggregatePersonaWeights(defaultPersonaIds));
    const engagementRanking = rankPostsForWeights(aggregatePersonaWeights(['joke-enjoyer']));

    expect(communityRanking[0]?.post.id).not.toBe('P4');
    expect(engagementRanking[0]?.post.id).toBe('P4');
  });

  it('computes receipt score as raw score times aggregate weight contributions', () => {
    const weights = aggregatePersonaWeights(defaultPersonaIds);
    const rankedPost = rankPostsForWeights(weights)[0];

    if (rankedPost === undefined) {
      throw new Error('Expected at least one ranked post');
    }

    const contributionSum = signals.reduce((sum, signal) => {
      return sum + rankedPost.post.scores[signal.key] * weights[signal.key];
    }, 0);

    expect(contributionSum).toBeCloseTo(rankedPost.score, 10);
  });

  it('rejects non-finite, negative, and all-zero replay weights', () => {
    const valid = { recency: 0.2, engagement: 0.2, bridging: 0.2, sourceDiversity: 0.2, relevance: 0.2 };

    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.01]) {
      expect(() => normalizeWeights({ ...valid, recency: invalid })).toThrow(/Invalid weight for recency/);
    }
    expect(() => normalizeWeights({ recency: 0, engagement: 0, bridging: 0, sourceDiversity: 0, relevance: 0 }))
      .toThrow(/Cannot normalize empty signal weights/);
  });

  it('distinguishes a new rank from a held position', () => {
    expect(badgeMovementFor(2, undefined)).toEqual({ dir: 'new', delta: 0 });
    expect(badgeMovementFor(2, 2)).toEqual({ dir: 'held', delta: 0 });
    expect(badgeMovementFor(2, 5)).toEqual({ dir: 'up', delta: 3 });
    expect(badgeMovementFor(5, 2)).toEqual({ dir: 'down', delta: 3 });
  });
});
