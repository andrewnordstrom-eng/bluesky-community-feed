/**
 * Topic Voting API Tests
 *
 * Tests for topic weight voting via POST /api/governance/vote
 * and the public topic catalog endpoint GET /api/governance/topics.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (vi.hoisted runs before imports) ---
const { dbQueryMock, getAuthenticatedDidMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  getAuthenticatedDidMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/governance/auth.js', () => ({
  getAuthenticatedDid: getAuthenticatedDidMock,
  SessionStoreUnavailableError: class extends Error {
    constructor() {
      super('Session store unavailable');
    }
  },
}));

vi.mock('../src/feed/access-control.js', () => ({
  isParticipantApproved: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { registerVoteRoute } from '../src/governance/routes/vote.js';
import { registerTopicRoutes } from '../src/governance/routes/topics.js';
import {
  parseStoredProposedTopicWeights,
  parseStoredTopicWeights,
} from '../src/governance/topic-weights.js';

interface TopicVoteEpoch {
  id: number;
  status: string;
  phase: string;
  voting_ends_at: string | null;
  topic_weights: Record<string, number>;
}

const DATABASE_NOW = '2026-07-12T12:00:00.000Z';

const ACTIVE_EPOCH: TopicVoteEpoch = {
  id: 5,
  status: 'voting',
  phase: 'voting',
  voting_ends_at: '2099-01-01T00:00:00.000Z',
  topic_weights: { 'software-development': 0.7, 'dogs-pets': 0.4 },
};

const ACTIVE_TOPICS = [
  { slug: 'software-development', name: 'Software Development', description: 'Programming', parent_slug: null },
  { slug: 'dogs-pets', name: 'Dogs & Pets', description: 'Dog content', parent_slug: null },
  { slug: 'politics', name: 'Politics', description: 'Political content', parent_slug: null },
];

/**
 * Setup db.query mock for common flows.
 * Dispatches based on SQL content.
 */
function setupDbMock(opts?: {
  hasSubscriber?: boolean;
  hasExistingVote?: boolean;
  guardedVotingEndsAt?: string | null;
  initialEpoch?: TopicVoteEpoch;
}): void {
  const {
    hasSubscriber = true,
    hasExistingVote = false,
    guardedVotingEndsAt,
    initialEpoch = ACTIVE_EPOCH,
  } = opts ?? {};
  const effectiveGuardedDeadline = opts && 'guardedVotingEndsAt' in opts
    ? guardedVotingEndsAt ?? null
    : initialEpoch.voting_ends_at;
  const guardedEpochOpen = effectiveGuardedDeadline === null
    || Date.parse(effectiveGuardedDeadline) > Date.parse(DATABASE_NOW);

  dbQueryMock.mockImplementation((sql: string, _params?: unknown[]) => {
    // Subscriber check
    if (sql.includes('subscribers') && sql.includes('is_active')) {
      return Promise.resolve({
        rows: hasSubscriber ? [{ did: 'did:plc:voter' }] : [],
      });
    }
    // Atomic vote insert locks the still-open epoch in the same statement.
    if (sql.includes('WITH open_epoch')) {
      expect(sql).toContain("AND status IN ('active', 'voting')");
      expect(sql).toContain("AND phase = 'voting'");
      expect(sql).toContain('AND (voting_ends_at IS NULL OR voting_ends_at > NOW())');
      expect(sql).toContain('FOR SHARE');
      return Promise.resolve({ rows: guardedEpochOpen ? [{ id: 1, is_new_vote: true }] : [] });
    }
    // Active epoch for voting
    if (sql.includes('governance_epochs') && sql.includes('status')) {
      return Promise.resolve({ rows: [initialEpoch] });
    }
    // Topic catalog slug validation
    if (sql.includes('topic_catalog') && sql.includes('is_active')) {
      return Promise.resolve({ rows: ACTIVE_TOPICS });
    }
    // Existing vote check
    if (sql.includes('governance_votes') && sql.includes('SELECT')) {
      return Promise.resolve({
        rows: hasExistingVote
          ? [{ id: 1, voter_did: 'did:plc:voter', epoch_id: 5, topic_weight_votes: { 'dogs-pets': 0.3 } }]
          : [],
      });
    }
    // Vote count
    if (sql.includes('COUNT')) {
      return Promise.resolve({ rows: [{ count: 3 }] });
    }
    // UPSERT (INSERT ... ON CONFLICT)
    if (sql.includes('INSERT') || sql.includes('UPSERT')) {
      return Promise.resolve({ rows: [{ id: 1 }] });
    }
    // Audit log insert
    if (sql.includes('governance_audit_log')) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe('GET /api/governance/topics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns active topics with current weights from epoch', async () => {
    dbQueryMock.mockImplementation((sql: string) => {
      if (sql.includes('governance_epochs')) {
        return Promise.resolve({ rows: [ACTIVE_EPOCH] });
      }
      if (sql.includes('topic_catalog')) {
        return Promise.resolve({ rows: ACTIVE_TOPICS });
      }
      if (sql.includes('COUNT')) {
        return Promise.resolve({ rows: [{ count: 3 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = Fastify();
    registerTopicRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/governance/topics',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.epochId).toBe(5);
    expect(body.voteCount).toBe(3);
    expect(body.topics).toHaveLength(3);

    // software-development has epoch weight 0.7
    const swTopic = body.topics.find((t: { slug: string }) => t.slug === 'software-development');
    expect(swTopic.currentWeight).toBe(0.7);

    // politics has no epoch weight → defaults to 0.5
    const polTopic = body.topics.find((t: { slug: string }) => t.slug === 'politics');
    expect(polTopic.currentWeight).toBe(0.5);

    await app.close();
  });

  it('returns 0.5 defaults when no active epoch exists', async () => {
    dbQueryMock.mockImplementation((sql: string) => {
      if (sql.includes('governance_epochs')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('topic_catalog')) {
        return Promise.resolve({ rows: ACTIVE_TOPICS });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = Fastify();
    registerTopicRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/governance/topics',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.epochId).toBeNull();
    expect(body.voteCount).toBe(0);
    body.topics.forEach((t: { currentWeight: number }) => {
      expect(t.currentWeight).toBe(0.5);
    });

    await app.close();
  });
});

describe('stored topic-weight policy parsing', () => {
  it('returns a validated copy for a well-formed policy', () => {
    const raw = { 'science-research': 0.5 };

    const parsed = parseStoredTopicWeights(raw, 'test epoch');

    expect(parsed).toEqual(raw);
    expect(parsed).not.toBe(raw);
  });

  it('returns an empty active policy for null and undefined', () => {
    expect(parseStoredTopicWeights(null, 'test epoch')).toEqual({});
    expect(parseStoredTopicWeights(undefined, 'test epoch')).toEqual({});
  });

  it('preserves the null sentinel for a missing proposed policy', () => {
    expect(parseStoredProposedTopicWeights(null, 'test epoch')).toBeNull();
    expect(parseStoredProposedTopicWeights(undefined, 'test epoch')).toBeNull();
  });

  it('validates proposed policies with the same strict schema', () => {
    expect(() => parseStoredProposedTopicWeights([0.5], 'test epoch')).toThrow(
      'Invalid stored topic weights for test epoch'
    );
  });

  it.each([
    ['primitive', 'science'],
    ['array', [0.5]],
    ['out-of-range value', { 'science-research': 1.1 }],
    ['mixed valid and invalid values', { 'science-research': 0.8, 'software-development': 'high' }],
  ])('rejects a malformed %s policy without keeping partial values', (_label, raw) => {
    expect(() => parseStoredTopicWeights(raw, 'test epoch')).toThrow(
      'Invalid stored topic weights for test epoch'
    );
  });
});

describe('POST /api/governance/vote (topic_weights)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without authentication', async () => {
    getAuthenticatedDidMock.mockResolvedValue(null);

    const app = Fastify();
    registerVoteRoute(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/governance/vote',
      payload: {
        topic_weights: { 'software-development': 0.9 },
      },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('accepts valid topic-only vote', async () => {
    getAuthenticatedDidMock.mockResolvedValue('did:plc:voter');
    setupDbMock();

    const app = Fastify();
    registerVoteRoute(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/governance/vote',
      payload: {
        topic_weights: { 'software-development': 0.9, 'dogs-pets': 0.4 },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.topicWeights).toEqual({ 'software-development': 0.9, 'dogs-pets': 0.4 });

    await app.close();
  });

  it('rejects a ballot when voting closes between the initial check and atomic insert', async () => {
    getAuthenticatedDidMock.mockResolvedValue('did:plc:voter');
    setupDbMock({ guardedVotingEndsAt: DATABASE_NOW });

    const app = Fastify();
    registerVoteRoute(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/governance/vote',
      payload: {
        topic_weights: { 'software-development': 0.9 },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'VotingClosed' });

    await app.close();
  });

  it('uses the database deadline when an expired voting window reaches the guarded insert', async () => {
    getAuthenticatedDidMock.mockResolvedValue('did:plc:voter');
    setupDbMock({
      initialEpoch: {
        ...ACTIVE_EPOCH,
        voting_ends_at: '2020-01-01T00:00:00.000Z',
      },
    });

    const app = Fastify();
    registerVoteRoute(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/governance/vote',
      payload: {
        topic_weights: { 'software-development': 0.9 },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'VotingClosed' });
    expect(dbQueryMock.mock.calls.some(([sql]) => String(sql).includes('WITH open_epoch'))).toBe(true);

    await app.close();
  });

  it('accepts a vote when the guarded voting deadline is open-ended', async () => {
    getAuthenticatedDidMock.mockResolvedValue('did:plc:voter');
    setupDbMock({
      initialEpoch: {
        ...ACTIVE_EPOCH,
        voting_ends_at: null,
      },
    });

    const app = Fastify();
    registerVoteRoute(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/governance/vote',
      payload: {
        topic_weights: { 'software-development': 0.9 },
      },
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('rejects a vote at the exact database deadline boundary', async () => {
    getAuthenticatedDidMock.mockResolvedValue('did:plc:voter');
    setupDbMock({
      initialEpoch: {
        ...ACTIVE_EPOCH,
        voting_ends_at: DATABASE_NOW,
      },
    });

    const app = Fastify();
    registerVoteRoute(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/governance/vote',
      payload: {
        topic_weights: { 'software-development': 0.9 },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'VotingClosed' });
    await app.close();
  });

  it('rejects vote with invalid topic slug', async () => {
    getAuthenticatedDidMock.mockResolvedValue('did:plc:voter');
    setupDbMock();

    const app = Fastify();
    registerVoteRoute(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/governance/vote',
      payload: {
        topic_weights: { 'nonexistent-topic': 0.5 },
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe('InvalidTopicSlug');

    await app.close();
  });

  it('rejects vote with out-of-range topic weight (1.5)', async () => {
    getAuthenticatedDidMock.mockResolvedValue('did:plc:voter');
    setupDbMock();

    const app = Fastify();
    registerVoteRoute(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/governance/vote',
      payload: {
        topic_weights: { 'software-development': 1.5 },
      },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejects vote with negative topic weight', async () => {
    getAuthenticatedDidMock.mockResolvedValue('did:plc:voter');
    setupDbMock();

    const app = Fastify();
    registerVoteRoute(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/governance/vote',
      payload: {
        topic_weights: { 'software-development': -0.1 },
      },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejects empty body (no weights, keywords, or topic weights)', async () => {
    getAuthenticatedDidMock.mockResolvedValue('did:plc:voter');
    setupDbMock();

    const app = Fastify();
    registerVoteRoute(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/governance/vote',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
