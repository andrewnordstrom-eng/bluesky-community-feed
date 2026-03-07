/**
 * Topic Relevance Scoring Tests
 *
 * Tests for the topic-weighted relevance component.
 * Pure function tests — no DB mocking needed.
 */

import { describe, expect, it } from 'vitest';

import { scoreRelevance } from '../src/scoring/components/relevance.js';
import type { PostForScoring, GovernanceEpoch } from '../src/scoring/score.types.js';
import type { ScoringContext } from '../src/scoring/component.interface.js';

/** Helper: build a minimal PostForScoring with optional topicVector. */
function makePost(topicVector?: Record<string, number>): PostForScoring {
  return {
    uri: 'at://did:plc:test/app.bsky.feed.post/abc',
    cid: 'bafytest',
    authorDid: 'did:plc:test',
    text: 'test post',
    replyRoot: null,
    replyParent: null,
    langs: ['en'],
    hasMedia: false,
    createdAt: new Date(),
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
    topicVector,
  };
}

/** Helper: build a minimal ScoringContext with optional topicWeights. */
function makeContext(topicWeights?: Record<string, number>): ScoringContext {
  const epoch: GovernanceEpoch = {
    id: 1,
    status: 'active',
    recencyWeight: 0.3,
    engagementWeight: 0.2,
    bridgingWeight: 0.2,
    sourceDiversityWeight: 0.2,
    relevanceWeight: 0.1,
    voteCount: 5,
    createdAt: new Date(),
    closedAt: null,
    description: null,
    topicWeights,
  };
  return {
    epoch,
    scoringWindowHours: 72,
    authorCounts: new Map(),
  };
}

describe('scoreRelevance', () => {
  it('returns default score when post has no topicVector', () => {
    const post = makePost(undefined);
    const context = makeContext({ 'software-development': 0.9 });
    expect(scoreRelevance(post, context)).toBe(0.2);
  });

  it('returns default score when post has empty topicVector', () => {
    const post = makePost({});
    const context = makeContext({ 'software-development': 0.9 });
    expect(scoreRelevance(post, context)).toBe(0.2);
  });

  it('returns default score when epoch has no topicWeights', () => {
    const post = makePost({ 'software-development': 0.8 });
    const context = makeContext(undefined);
    expect(scoreRelevance(post, context)).toBe(0.2);
  });

  it('returns default score when epoch has empty topicWeights', () => {
    const post = makePost({ 'software-development': 0.8 });
    const context = makeContext({});
    expect(scoreRelevance(post, context)).toBe(0.2);
  });

  it('returns > 0.5 for post matching a boosted topic', () => {
    const post = makePost({ 'software-development': 0.9 });
    const context = makeContext({ 'software-development': 0.9 });
    const score = scoreRelevance(post, context);
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBe(0.9); // single topic: communityWeight is the result
  });

  it('returns < 0.5 for post matching a penalized topic', () => {
    const post = makePost({ 'politics': 0.8 });
    const context = makeContext({ 'politics': 0.1 });
    const score = scoreRelevance(post, context);
    expect(score).toBeLessThan(0.5);
    expect(score).toBeCloseTo(0.1, 6);
  });

  it('computes correct weighted average with multiple topics and mixed weights', () => {
    const post = makePost({
      'software-development': 0.8,
      'politics': 0.2,
    });
    const context = makeContext({
      'software-development': 0.9,
      'politics': 0.1,
    });

    // Expected: (0.8*0.9 + 0.2*0.1) / (0.8+0.2) = (0.72+0.02)/1.0 = 0.74
    const score = scoreRelevance(post, context);
    expect(score).toBeCloseTo(0.74, 6);
  });

  it('uses default 0.2 for topics not in community weights', () => {
    const post = makePost({
      'software-development': 0.6,
      'unknown-topic': 0.4,
    });
    const context = makeContext({ 'software-development': 1.0 });

    // Expected: (0.6*1.0 + 0.4*0.2) / (0.6+0.4) = (0.6+0.08)/1.0 = 0.68
    const score = scoreRelevance(post, context);
    expect(score).toBeCloseTo(0.68, 6);
  });

  it('returns default score when all post topic scores are zero', () => {
    const post = makePost({
      'software-development': 0,
      'politics': 0,
    });
    const context = makeContext({ 'software-development': 0.9 });
    expect(scoreRelevance(post, context)).toBe(0.2);
  });

  it('clamps result to 0.0-1.0 range', () => {
    // Since community weights are 0.0-1.0 and post scores are 0.0-1.0,
    // the weighted average should naturally be in range, but verify clamping works.
    const post = makePost({ 'software-development': 1.0 });
    const context = makeContext({ 'software-development': 1.0 });
    expect(scoreRelevance(post, context)).toBeLessThanOrEqual(1.0);
    expect(scoreRelevance(post, context)).toBeGreaterThanOrEqual(0.0);
  });

  it('handles post matching only topics that have no community votes', () => {
    const post = makePost({
      'obscure-topic-a': 0.5,
      'obscure-topic-b': 0.3,
    });
    const context = makeContext({ 'software-development': 0.9 });

    // Both topics default to 0.2: (0.5*0.2 + 0.3*0.2) / (0.5+0.3) = 0.16/0.8 = 0.2
    expect(scoreRelevance(post, context)).toBeCloseTo(0.2, 6);
  });
});
