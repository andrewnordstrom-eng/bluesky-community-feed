/**
 * Feed-Space Metrics Unit Tests (PROJ-1486 / A5)
 *
 * Pure — no Postgres/Redis/Testcontainers dependency, same pattern as
 * convergence.test.ts. Every metric in feed-metrics.ts is exercised against
 * hand-computable fixtures (known permutations, known distributions) so the
 * math itself is pinned independent of any real scoring-pipeline run.
 */

import { describe, expect, it } from 'vitest';
import {
  normalizedRankDisplacement,
  kendallTauDistance,
  dominantTopic,
  minorityTopicExposure,
  buildCorpusTopicSupport,
  authorHHI,
  authorGini,
  distortionRatio,
  type FeedEntry,
  type FeedPostInfo,
} from '../../src/harness/feed-metrics.js';

function feed(uris: readonly string[]): FeedEntry[] {
  return uris.map((uri, index) => ({ uri, rank: index + 1 }));
}

describe('normalizedRankDisplacement', () => {
  it('is 0 for two identical rankings', () => {
    const a = feed(['p1', 'p2', 'p3', 'p4']);
    const b = feed(['p1', 'p2', 'p3', 'p4']);
    const result = normalizedRankDisplacement(a, b);
    expect(result.displacement).toBe(0);
    expect(result.sharedCount).toBe(4);
  });

  it('matches a hand-computed displacement on a full reversal', () => {
    // ranks: p1 1->4, p2 2->3, p3 3->2, p4 4->1. |diff| = 3,1,1,3, maxRank=4.
    // mean = (3+1+1+3)/4 / 4 = 8/4/4 = 0.5
    const a = feed(['p1', 'p2', 'p3', 'p4']);
    const b = feed(['p4', 'p3', 'p2', 'p1']);
    const result = normalizedRankDisplacement(a, b);
    expect(result.displacement).toBeCloseTo(0.5, 12);
    expect(result.sharedCount).toBe(4);
  });

  it('matches a hand-computed displacement on a single adjacent swap', () => {
    // p1<->p2 swapped, p3/p4 fixed. |diff| = 1,1,0,0, maxRank=4.
    // mean = (1+1+0+0)/4/4 = 2/16 = 0.125
    const a = feed(['p1', 'p2', 'p3', 'p4']);
    const b = feed(['p2', 'p1', 'p3', 'p4']);
    const result = normalizedRankDisplacement(a, b);
    expect(result.displacement).toBeCloseTo(0.125, 12);
  });

  it('only scores the shared post set, reporting sharedCount', () => {
    // p5 only in a, p6 only in b — excluded from the pairwise comparison.
    const a = feed(['p1', 'p2', 'p5']);
    const b = feed(['p1', 'p2', 'p6']);
    const result = normalizedRankDisplacement(a, b);
    expect(result.sharedCount).toBe(2);
    // p1: rank 1 vs 1 (diff 0), p2: rank 2 vs 2 (diff 0) -> displacement 0
    expect(result.displacement).toBe(0);
  });

  it('throws when feeds share no posts', () => {
    expect(() => normalizedRankDisplacement(feed(['p1']), feed(['p2']))).toThrow(/share no posts/);
  });

  it('throws on an empty feed', () => {
    expect(() => normalizedRankDisplacement([], feed(['p1']))).toThrow(/non-empty/);
  });
});

describe('kendallTauDistance', () => {
  it('is 0 for two identical rankings', () => {
    const a = feed(['p1', 'p2', 'p3']);
    const b = feed(['p1', 'p2', 'p3']);
    expect(kendallTauDistance(a, b)).toBe(0);
  });

  it('is 1 for a full reversal (every pair disagrees)', () => {
    const a = feed(['p1', 'p2', 'p3']);
    const b = feed(['p3', 'p2', 'p1']);
    expect(kendallTauDistance(a, b)).toBe(1);
  });

  it('matches a hand-computed distance on a single adjacent swap', () => {
    // Order a: p1,p2,p3,p4 (6 pairs total). Order b: p2,p1,p3,p4 (only the
    // p1/p2 pair is discordant) -> 1/6.
    const a = feed(['p1', 'p2', 'p3', 'p4']);
    const b = feed(['p2', 'p1', 'p3', 'p4']);
    expect(kendallTauDistance(a, b)).toBeCloseTo(1 / 6, 12);
  });

  it('restricts to the shared post set', () => {
    const a = feed(['p1', 'p2', 'p3', 'px']);
    const b = feed(['p1', 'p3', 'p2', 'py']);
    // shared: p1, p2, p3. a-order: p1,p2,p3. b-order among shared: p1,p3,p2.
    // pairs: (p1,p2) concordant, (p1,p3) concordant, (p2,p3) discordant -> 1/3
    expect(kendallTauDistance(a, b)).toBeCloseTo(1 / 3, 12);
  });

  it('throws with fewer than 2 shared posts', () => {
    expect(() => kendallTauDistance(feed(['p1']), feed(['p1']))).toThrow(/at least 2 shared/);
  });
});

describe('dominantTopic', () => {
  it('returns the highest-weight topic', () => {
    expect(dominantTopic({ sports: 0.2, music: 0.8 })).toBe('music');
  });

  it('breaks ties by ascending slug name for determinism', () => {
    expect(dominantTopic({ sports: 0.5, music: 0.5 })).toBe('music');
    expect(dominantTopic({ zzz: 0.5, aaa: 0.5 })).toBe('aaa');
  });

  it('returns null for an empty topic vector', () => {
    expect(dominantTopic({})).toBeNull();
  });
});

describe('minorityTopicExposure', () => {
  function post(uri: string, topicVector: Record<string, number>): FeedPostInfo {
    return { uri, authorDid: `author-${uri}`, topicVector };
  }

  it('matches a hand-computed exposure on a known feed and corpus support', () => {
    // Corpus: sports 90%, music 10% -> music is tail at threshold 0.15.
    const corpusSupport = { sports: 90, music: 10 };
    const feedPosts: FeedPostInfo[] = [
      post('p1', { sports: 1 }),
      post('p2', { sports: 1 }),
      post('p3', { music: 1 }),
      post('p4', { sports: 1 }),
    ];
    const result = minorityTopicExposure(feedPosts, corpusSupport, 0.15);
    expect(result.classifiedCount).toBe(4);
    expect(result.exposure).toBeCloseTo(0.25, 12); // 1 of 4 posts is music (tail)
  });

  it('excludes unclassified posts from both numerator and denominator', () => {
    const corpusSupport = { sports: 90, music: 10 };
    const feedPosts: FeedPostInfo[] = [
      post('p1', { music: 1 }),
      post('p2', {}), // unclassified
      post('p3', { sports: 1 }),
    ];
    const result = minorityTopicExposure(feedPosts, corpusSupport, 0.15);
    expect(result.classifiedCount).toBe(2);
    expect(result.totalCount).toBe(3);
    expect(result.exposure).toBeCloseTo(0.5, 12); // 1 of 2 classified posts is music
  });

  it('a threshold of 0 marks no topic as tail (exposure 0)', () => {
    const corpusSupport = { sports: 99, music: 1 };
    const feedPosts: FeedPostInfo[] = [post('p1', { music: 1 })];
    expect(minorityTopicExposure(feedPosts, corpusSupport, 0).exposure).toBe(0);
  });

  it('throws for an out-of-range threshold', () => {
    expect(() => minorityTopicExposure([], {}, 1.5)).toThrow(/tailThreshold/);
  });
});

describe('buildCorpusTopicSupport', () => {
  it('counts posts by dominant topic, ignoring unclassified posts', () => {
    const posts: FeedPostInfo[] = [
      { uri: 'p1', authorDid: 'a', topicVector: { sports: 1 } },
      { uri: 'p2', authorDid: 'a', topicVector: { sports: 0.6, music: 0.4 } },
      { uri: 'p3', authorDid: 'a', topicVector: {} },
      { uri: 'p4', authorDid: 'a', topicVector: { music: 1 } },
    ];
    expect(buildCorpusTopicSupport(posts)).toEqual({ sports: 2, music: 1 });
  });
});

describe('authorHHI', () => {
  function feedOf(authorDids: readonly string[]): FeedPostInfo[] {
    return authorDids.map((authorDid, i) => ({ uri: `p${i}`, authorDid, topicVector: {} }));
  }

  it('matches a hand-computed HHI on a known distribution', () => {
    // 4 posts: author A has 2 (share 0.5), B has 1 (0.25), C has 1 (0.25).
    // HHI = 0.5^2 + 0.25^2 + 0.25^2 = 0.25 + 0.0625 + 0.0625 = 0.375
    const feedPosts = feedOf(['A', 'A', 'B', 'C']);
    expect(authorHHI(feedPosts)).toBeCloseTo(0.375, 12);
  });

  it('is 1 when a single author dominates the entire feed', () => {
    expect(authorHHI(feedOf(['A', 'A', 'A']))).toBe(1);
  });

  it('is 1/N for N distinct authors with one post each (minimum concentration)', () => {
    const feedPosts = feedOf(['A', 'B', 'C', 'D']);
    expect(authorHHI(feedPosts)).toBeCloseTo(0.25, 12);
  });

  it('throws on an empty feed', () => {
    expect(() => authorHHI([])).toThrow(/non-empty/);
  });
});

describe('authorGini', () => {
  function feedOf(authorDids: readonly string[]): FeedPostInfo[] {
    return authorDids.map((authorDid, i) => ({ uri: `p${i}`, authorDid, topicVector: {} }));
  }

  it('is 0 when every author has an identical post count (perfect equality)', () => {
    const feedPosts = feedOf(['A', 'A', 'B', 'B', 'C', 'C']);
    expect(authorGini(feedPosts)).toBeCloseTo(0, 12);
  });

  it('is 0 for a single distinct author (degenerate case, not NaN)', () => {
    const feedPosts = feedOf(['A', 'A', 'A']);
    expect(authorGini(feedPosts)).toBe(0);
  });

  it('matches a hand-computed Gini on a known 2-author distribution', () => {
    // A has 3 posts (share 0.75), B has 1 (0.25).
    // shares = [0.75, 0.25]; mean = 0.5
    // sumAbsDiff over all i,j pairs (n=2): |0.75-0.75|+|0.75-0.25|+|0.25-0.75|+|0.25-0.25| = 0+0.5+0.5+0 = 1.0
    // meanAbsDiff = 1.0 / 4 = 0.25; gini = 0.25 / (2*0.5) = 0.25
    const feedPosts = feedOf(['A', 'A', 'A', 'B']);
    expect(authorGini(feedPosts)).toBeCloseTo(0.25, 12);
  });

  it('increases as concentration increases', () => {
    const equal = feedOf(['A', 'B', 'C', 'D']);
    const concentrated = feedOf(['A', 'A', 'A', 'B']);
    expect(authorGini(concentrated)).toBeGreaterThan(authorGini(equal));
  });

  it('throws on an empty feed', () => {
    expect(() => authorGini([])).toThrow(/non-empty/);
  });
});

describe('distortionRatio', () => {
  it('is 1.0 when treatment and reference are the same feed', () => {
    const reference = feed(['p1', 'p2', 'p3']);
    const scoreByUri = new Map([
      ['p1', 10],
      ['p2', 5],
      ['p3', 2],
    ]);
    expect(distortionRatio(reference, reference, scoreByUri)).toBe(1);
  });

  it('matches a hand-computed ratio when treatment picks a different, lower-scoring post set', () => {
    // reference feed: p1(10) + p2(5) = 15 (its own top-K quality mass)
    // treatment feed swaps in p4 (score 3 by the reference's own yardstick) for p2
    const reference = feed(['p1', 'p2']);
    const treatment = feed(['p1', 'p4']);
    const scoreByUri = new Map([
      ['p1', 10],
      ['p2', 5],
      ['p4', 3],
    ]);
    // treatment mass by reference yardstick = 10 + 3 = 13; ratio = 13/15
    expect(distortionRatio(treatment, reference, scoreByUri)).toBeCloseTo(13 / 15, 12);
  });

  it('treats a post missing from referenceScoreByUri as contributing 0, not an error', () => {
    const reference = feed(['p1', 'p2']);
    const treatment = feed(['p1', 'unknown']);
    const scoreByUri = new Map([
      ['p1', 10],
      ['p2', 5],
    ]);
    // treatment mass = 10 (p1) + 0 (unknown, missing) = 10; ratio = 10/15
    expect(distortionRatio(treatment, reference, scoreByUri)).toBeCloseTo(10 / 15, 12);
  });

  it('throws when the reference feed carries zero quality mass', () => {
    const reference = feed(['p1']);
    const treatment = feed(['p1']);
    const scoreByUri = new Map([['p1', 0]]);
    expect(() => distortionRatio(treatment, reference, scoreByUri)).toThrow(/division by zero/);
  });
});

describe('determinism', () => {
  it('every metric is a pure function: same inputs always produce the same outputs', () => {
    const a = feed(['p1', 'p2', 'p3', 'p4']);
    const b = feed(['p2', 'p4', 'p1', 'p3']);
    const posts: FeedPostInfo[] = [
      { uri: 'p1', authorDid: 'A', topicVector: { sports: 0.9 } },
      { uri: 'p2', authorDid: 'A', topicVector: { music: 0.8 } },
      { uri: 'p3', authorDid: 'B', topicVector: { sports: 0.5 } },
      { uri: 'p4', authorDid: 'C', topicVector: { music: 0.3 } },
    ];
    const corpusSupport = buildCorpusTopicSupport(posts);

    const run = () => ({
      displacement: normalizedRankDisplacement(a, b),
      tau: kendallTauDistance(a, b),
      exposure: minorityTopicExposure(posts, corpusSupport, 0.4),
      hhi: authorHHI(posts),
      gini: authorGini(posts),
    });

    expect(run()).toEqual(run());
  });
});
