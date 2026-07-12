import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbQueryMock,
  enqueueManualScoringRunMock,
  getScoringStatusMock,
  isJetstreamConnectedMock,
  getLastEventReceivedAtMock,
  getJetstreamEventsLast5MinMock,
  getJetstreamDisconnectedAtMock,
  triggerJetstreamReconnectMock,
  redisGetMock,
  redisZCardMock,
  readRankingWorkerHealthMock,
} = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  enqueueManualScoringRunMock: vi.fn(),
  getScoringStatusMock: vi.fn(),
  isJetstreamConnectedMock: vi.fn(),
  getLastEventReceivedAtMock: vi.fn(),
  getJetstreamEventsLast5MinMock: vi.fn(),
  getJetstreamDisconnectedAtMock: vi.fn(),
  triggerJetstreamReconnectMock: vi.fn(),
  redisGetMock: vi.fn(),
  redisZCardMock: vi.fn(),
  readRankingWorkerHealthMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    get: redisGetMock,
    zcard: redisZCardMock,
  },
}));

vi.mock('../src/admin/status-tracker.js', () => ({
  getScoringStatus: getScoringStatusMock,
}));

vi.mock('../src/auth/admin.js', () => ({
  getAdminDid: () => 'did:plc:admin',
}));

vi.mock('../src/scoring/scheduler.js', () => ({
  enqueueManualScoringRun: enqueueManualScoringRunMock,
}));

vi.mock('../src/scoring/ranking-request-queue.js', () => ({
  rankingRequestQueue: {},
}));

vi.mock('../src/scoring/ranking-worker.js', () => ({
  readRankingWorkerHealth: readRankingWorkerHealthMock,
}));

vi.mock('../src/config.js', () => ({
  config: { RANKING_WORKER_HEARTBEAT_TTL_MS: 30_000 },
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../src/ingestion/jetstream.js', () => ({
  isJetstreamConnected: isJetstreamConnectedMock,
  getLastEventReceivedAt: getLastEventReceivedAtMock,
  getJetstreamEventsLast5Min: getJetstreamEventsLast5MinMock,
  getJetstreamDisconnectedAt: getJetstreamDisconnectedAtMock,
  triggerJetstreamReconnect: triggerJetstreamReconnectMock,
}));

import { registerFeedHealthRoutes } from '../src/admin/routes/feed-health.js';

describe('admin manual rescore overlap guard', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
    enqueueManualScoringRunMock.mockReset();
    getScoringStatusMock.mockReset();
    isJetstreamConnectedMock.mockReset();
    getLastEventReceivedAtMock.mockReset();
    getJetstreamEventsLast5MinMock.mockReset();
    getJetstreamDisconnectedAtMock.mockReset();
    triggerJetstreamReconnectMock.mockReset();
    redisGetMock.mockReset();
    redisZCardMock.mockReset();
    readRankingWorkerHealthMock.mockReset();
    readRankingWorkerHealthMock.mockResolvedValue({
      healthy: true,
      heartbeat: {
        schemaVersion: 1,
        workerId: 'worker-1',
        communityId: 'community-gov',
        state: 'idle',
        updatedAt: '2026-07-12T05:00:00.000Z',
        currentRequestId: null,
        lastCompletedAt: '2026-07-12T04:59:00.000Z',
        lastError: null,
      },
      ageMs: 1_000,
      queue: {
        pendingCount: 0,
        claimedCount: 0,
        oldestPendingAt: null,
        newestRequestId: null,
        newestRequestState: null,
      },
    });
  });

  it('returns 503 and starts nothing when the durable queue is unavailable', async () => {
    enqueueManualScoringRunMock.mockRejectedValue(new Error('database unavailable'));

    const app = Fastify();
    registerFeedHealthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/feed/rescore',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: 'RankingQueueUnavailable',
    });
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('starts manual scoring and writes audit log when idle', async () => {
    enqueueManualScoringRunMock.mockResolvedValue({
      id: 'request-1',
      created: true,
      idempotencyKey: 'manual:community-gov:did:plc:admin:1',
    });
    dbQueryMock.mockResolvedValue({ rows: [] });

    const app = Fastify();
    registerFeedHealthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/feed/rescore',
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      success: true,
      queued: true,
      requestId: 'request-1',
    });
    expect(enqueueManualScoringRunMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0]?.[0]).toContain('INSERT INTO governance_audit_log');

    await app.close();
  });

  it('returns the queued receipt when auxiliary audit persistence fails', async () => {
    enqueueManualScoringRunMock.mockResolvedValue({
      id: 'request-2',
      created: true,
      idempotencyKey: 'manual:community-gov:did:plc:admin:2',
    });
    dbQueryMock.mockRejectedValue(new Error('audit database unavailable'));

    const app = Fastify();
    registerFeedHealthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/feed/rescore',
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      success: true,
      queued: true,
      requestId: 'request-2',
    });
    expect(enqueueManualScoringRunMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('reports jetstream health from ingestion runtime state', async () => {
    getScoringStatusMock.mockResolvedValue({
      timestamp: '2026-02-08T22:45:00.000Z',
      duration_ms: 512,
      posts_scored: 33,
      posts_filtered: 9967,
    });
    isJetstreamConnectedMock.mockReturnValue(true);
    getLastEventReceivedAtMock.mockReturnValue(new Date('2026-02-08T22:45:09.000Z'));
    getJetstreamEventsLast5MinMock.mockReturnValue(12345);
    getJetstreamDisconnectedAtMock.mockReturnValue(null);
    redisZCardMock.mockResolvedValue(51);

    dbQueryMock
      .mockResolvedValueOnce({
        rows: [{
          total_posts: '1000',
          posts_24h: '500',
          posts_7d: '900',
          oldest_post: '2026-02-01T00:00:00.000Z',
          newest_post: '2026-02-08T22:45:09.000Z',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          total: '120',
          with_votes: '14',
          active_last_week: '95',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          content_rules: {
            include_keywords: ['bluesky'],
            exclude_keywords: ['spam'],
          },
          rules_updated: '2026-02-08T22:00:00.000Z',
        }],
      });

    const app = Fastify();
    registerFeedHealthRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/feed-health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      jetstream: {
        connected: true,
        eventsLast5min: 12345,
      },
      subscribers: {
        total: 120,
        withVotes: 14,
        activeLastWeek: 95,
      },
      database: {
        newestPost: '2026-02-08T22:45:09.000Z',
      },
      feedSize: 51,
    });
    expect(redisGetMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('triggers manual jetstream reconnect and writes audit log', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });

    const app = Fastify();
    registerFeedHealthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/jetstream/reconnect',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
    });
    expect(triggerJetstreamReconnectMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0]?.[0]).toContain('INSERT INTO governance_audit_log');

    await app.close();
  });
});
