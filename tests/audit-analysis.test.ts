import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock, redisZRevRangeMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  redisZRevRangeMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    zrevrange: redisZRevRangeMock,
  },
}));

import { registerAuditAnalysisRoutes } from '../src/admin/routes/audit-analysis.js';

describe('admin weight impact audit endpoint', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
    redisZRevRangeMock.mockReset();
  });

  it('returns 404 when no active/voting epoch exists', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] });
    redisZRevRangeMock.mockResolvedValue([]);

    const app = Fastify();
    registerAuditAnalysisRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/audit/weight-impact',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: 'NoActiveEpoch',
    });

    await app.close();
  });

  it('returns ranked decomposition and sensitivity metrics', async () => {
    redisZRevRangeMock.mockResolvedValue([
      'at://did:plc:b/post/2',
      '0.901',
      'at://did:plc:a/post/1',
      '0.899',
      'at://did:plc:c/post/3',
      '0.700',
    ]);

    dbQueryMock
      // 1. epoch query (post-PROJ-817: no weight columns — those come from readEpochWeights)
      .mockResolvedValueOnce({
        rows: [{ id: 2 }],
      })
      // 2. readEpochWeights long-path: governance epoch + weights in one LEFT JOIN
      .mockResolvedValueOnce({
        rows: [
          { epoch_id: 2, component_key: 'recency', weight: '0.22' },
          { epoch_id: 2, component_key: 'engagement', weight: '0.2' },
          { epoch_id: 2, component_key: 'bridging', weight: '0.32' },
          { epoch_id: 2, component_key: 'sourceDiversity', weight: '0.16' },
          { epoch_id: 2, component_key: 'relevance', weight: '0.1' },
        ],
      })
      // 3. run-scope query
      .mockResolvedValueOnce({
        rows: [
          {
            value: {
              run_id: 'run-123',
              epoch_id: 2,
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            post_uri: 'at://did:plc:a/post/1',
            text: 'first post',
            total_score: 0.82,
            recency_score: 0.95,
            engagement_score: 0.7,
            bridging_score: 0.9,
            source_diversity_score: 0.6,
            relevance_score: 0.5,
          },
          {
            post_uri: 'at://did:plc:b/post/2',
            text: 'second post',
            total_score: 0.79,
            recency_score: 0.9,
            engagement_score: 0.85,
            bridging_score: 0.7,
            source_diversity_score: 0.7,
            relevance_score: 0.5,
          },
          {
            post_uri: 'at://did:plc:c/post/3',
            text: 'third post',
            total_score: 0.7,
            recency_score: 0.8,
            engagement_score: 0.4,
            bridging_score: 0.8,
            source_diversity_score: 0.8,
            relevance_score: 0.5,
          },
        ],
      });

    const app = Fastify();
    registerAuditAnalysisRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/audit/weight-impact?limit=2',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.currentEpochId).toBe(2);
    expect(body.topPosts).toHaveLength(2);
    expect(body.topPosts[0]).toMatchObject({
      rank: 1,
      uri: 'at://did:plc:b/post/2',
    });
    expect(body.topPosts[1]).toMatchObject({
      rank: 2,
      uri: 'at://did:plc:a/post/1',
    });
    expect(body.weightSensitivity).toHaveProperty('recency');
    expect(body.weightSensitivity).toHaveProperty('engagement');
    expect(body.analyzedPosts).toBe(3);
    expect(redisZRevRangeMock).toHaveBeenCalledWith('feed:current', 0, 99, 'WITHSCORES');
    expect(dbQueryMock).toHaveBeenCalledTimes(4);
    expect(String(dbQueryMock.mock.calls[3]?.[0])).toContain("component_details->>'run_id'");

    await app.close();
  });
});
