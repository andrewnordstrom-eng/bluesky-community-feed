/**
 * Test Fixture Factories
 *
 * Reusable builders for common test data structures.
 * Each factory returns valid defaults that can be overridden.
 *
 * NOTE: These are for use in test bodies, NOT inside vi.hoisted() callbacks.
 * vi.mock() declarations must remain inline in each test file.
 */

import type { GovernanceEpoch, PostForScoring } from '../../src/scoring/score.types.js';

/**
 * Build a PostForScoring with sensible defaults.
 * All fields can be overridden via the overrides parameter.
 */
export function buildPost(overrides?: Partial<PostForScoring>): PostForScoring {
  return {
    uri: 'at://did:plc:testauthor/app.bsky.feed.post/1',
    cid: 'bafytest123',
    authorDid: 'did:plc:testauthor',
    text: 'hello world',
    replyRoot: null,
    replyParent: null,
    langs: ['en'],
    hasMedia: false,
    createdAt: new Date(),
    likeCount: 1,
    repostCount: 0,
    replyCount: 0,
    ...overrides,
  };
}

/**
 * Build a GovernanceEpoch with equal weights (0.2 each).
 * All fields can be overridden via the overrides parameter.
 */
export function buildEpoch(overrides?: Partial<GovernanceEpoch>): GovernanceEpoch {
  return {
    id: 1,
    status: 'active',
    recencyWeight: 0.2,
    engagementWeight: 0.2,
    bridgingWeight: 0.2,
    sourceDiversityWeight: 0.2,
    relevanceWeight: 0.2,
    voteCount: 10,
    createdAt: new Date(),
    closedAt: null,
    description: 'test epoch',
    ...overrides,
  };
}

/**
 * Build a snake_case epoch row as returned from the database.
 * Useful for mocking db.query() responses.
 */
export function buildEpochRow(overrides?: Record<string, unknown>) {
  return {
    id: 1,
    status: 'active',
    recency_weight: 0.2,
    engagement_weight: 0.2,
    bridging_weight: 0.2,
    source_diversity_weight: 0.2,
    relevance_weight: 0.2,
    vote_count: 10,
    created_at: new Date().toISOString(),
    closed_at: null,
    description: 'test epoch',
    ...overrides,
  };
}

/**
 * Build a snake_case post row as returned from the database.
 * Useful for mocking db.query() responses.
 */
export function buildPostRow(overrides?: Record<string, unknown>) {
  return {
    uri: 'at://did:plc:testauthor/app.bsky.feed.post/1',
    cid: 'bafytest123',
    author_did: 'did:plc:testauthor',
    text: 'hello world',
    reply_root: null,
    reply_parent: null,
    langs: ['en'],
    has_media: false,
    created_at: new Date().toISOString(),
    like_count: 1,
    repost_count: 0,
    reply_count: 0,
    classification_method: 'keyword',
    ...overrides,
  };
}
