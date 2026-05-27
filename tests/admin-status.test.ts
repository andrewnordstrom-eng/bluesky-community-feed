import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock, redisZCardMock, getCurrentContentRulesMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  redisZCardMock: vi.fn(),
  getCurrentContentRulesMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    zcard: redisZCardMock,
  },
}));

vi.mock('../src/governance/content-filter.js', () => ({
  getCurrentContentRules: getCurrentContentRulesMock,
}));

import { registerStatusRoutes } from '../src/admin/routes/status.js';

describe('admin status route', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
    redisZCardMock.mockReset();
    getCurrentContentRulesMock.mockReset();
  });

  it('uses feed:current for scored post count', async () => {
    dbQueryMock
      // 1. epoch query (post-PROJ-817: no weight columns selected; those come from readEpochWeights)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            status: 'active',
            phase: 'running',
            voting_ends_at: null,
            auto_transition: false,
            content_rules: { include_keywords: [], exclude_keywords: [] },
            created_at: '2026-02-09T00:00:00.000Z',
          },
        ],
      })
      // 2. readEpochWeights wide-path query (GOVERNANCE_LONGTABLE_READ_ENABLED defaults false)
      .mockResolvedValueOnce({
        rows: [
          {
            recency_weight: '0.2',
            engagement_weight: '0.2',
            bridging_weight: '0.2',
            source_diversity_weight: '0.2',
            relevance_weight: '0.2',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ count: '4' }] })
      .mockResolvedValueOnce({ rows: [{ total_posts: '100', posts_24h: '20' }] })
      .mockResolvedValueOnce({ rows: [{ count: '7' }] })
      .mockResolvedValueOnce({
        rows: [{ value: { timestamp: '2026-02-09T01:00:00.000Z', duration_ms: 1200, posts_scored: 8 } }],
      });

    redisZCardMock.mockResolvedValue(12);
    getCurrentContentRulesMock.mockResolvedValue({ includeKeywords: ['atproto'], excludeKeywords: [] });

    const app = Fastify();
    registerStatusRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/status',
    });

    expect(response.statusCode).toBe(200);
    expect(redisZCardMock).toHaveBeenCalledWith('feed:current');
    expect(response.json()).toMatchObject({
      system: {
        feed: {
          scoredPosts: 12,
        },
      },
    });

    await app.close();
  });
});
