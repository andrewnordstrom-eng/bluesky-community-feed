import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbQueryMock,
  tryTriggerManualScoringRunMock,
  getScoringStatusMock,
  isJetstreamConnectedMock,
  getLastEventReceivedAtMock,
  getJetstreamEventsLast5MinMock,
  getJetstreamRuntimeStateMock,
  getJetstreamDisconnectedAtMock,
  triggerJetstreamReconnectMock,
  redisGetMock,
  redisZCardMock,
} = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  tryTriggerManualScoringRunMock: vi.fn(),
  getScoringStatusMock: vi.fn(),
  isJetstreamConnectedMock: vi.fn(),
  getLastEventReceivedAtMock: vi.fn(),
  getJetstreamEventsLast5MinMock: vi.fn(),
  getJetstreamRuntimeStateMock: vi.fn(),
  getJetstreamDisconnectedAtMock: vi.fn(),
  triggerJetstreamReconnectMock: vi.fn(),
  redisGetMock: vi.fn(),
  redisZCardMock: vi.fn(),
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
  tryTriggerManualScoringRun: tryTriggerManualScoringRunMock,
}));

vi.mock('../src/ingestion/jetstream.js', () => ({
  isJetstreamConnected: isJetstreamConnectedMock,
  getLastEventReceivedAt: getLastEventReceivedAtMock,
  getJetstreamEventsLast5Min: getJetstreamEventsLast5MinMock,
  getJetstreamRuntimeState: getJetstreamRuntimeStateMock,
  getJetstreamDisconnectedAt: getJetstreamDisconnectedAtMock,
  triggerJetstreamReconnect: triggerJetstreamReconnectMock,
}));

import { registerFeedHealthRoutes } from '../src/admin/routes/feed-health.js';

describe('admin manual rescore overlap guard', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
    tryTriggerManualScoringRunMock.mockReset();
    getScoringStatusMock.mockReset();
    isJetstreamConnectedMock.mockReset();
    getLastEventReceivedAtMock.mockReset();
    getJetstreamEventsLast5MinMock.mockReset();
    getJetstreamRuntimeStateMock.mockReset();
    getJetstreamDisconnectedAtMock.mockReset();
    triggerJetstreamReconnectMock.mockReset();
    redisGetMock.mockReset();
    redisZCardMock.mockReset();
  });

  it('returns 409 when scoring is already in progress', async () => {
    tryTriggerManualScoringRunMock.mockReturnValue(false);

    const app = Fastify();
    registerFeedHealthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/feed/rescore',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: 'Conflict',
    });
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('starts manual scoring and writes audit log when idle', async () => {
    tryTriggerManualScoringRunMock.mockReturnValue(true);
    dbQueryMock.mockResolvedValue({ rows: [] });

    const app = Fastify();
    registerFeedHealthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/feed/rescore',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
    });
    expect(tryTriggerManualScoringRunMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0]?.[0]).toContain('INSERT INTO governance_audit_log');

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
    getJetstreamRuntimeStateMock.mockReturnValue({
      activeEvents: 20,
      pendingEvents: 40,
      maxConcurrentEvents: 20,
      maxPendingEvents: 10000,
      pauseQueueThreshold: 100,
      resumeQueueThreshold: 25,
      inboundPaused: true,
      pauseCount: 7,
      resumeCount: 6,
      overloadReconnectCount: 0,
      totalDroppedEvents: 0,
      cursorUs: '1770590709000000',
      cursorLagMs: 3000,
    });
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
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/feed-health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        jetstream: {
          connected: true,
          eventsLast5min: 12345,
          cursorUs: '1770590709000000',
          cursorLagMs: 3000,
          activeEvents: 20,
          pendingEvents: 40,
          inboundPaused: true,
          pauseCount: 7,
          resumeCount: 6,
          overloadReconnectCount: 0,
          totalDroppedEvents: 0,
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
    } finally {
      await app.close();
    }
  });

  it('reports null cursor telemetry before Jetstream establishes a cursor', async () => {
    getScoringStatusMock.mockResolvedValue({
      timestamp: null,
      duration_ms: 0,
      posts_scored: 0,
      posts_filtered: 0,
    });
    isJetstreamConnectedMock.mockReturnValue(false);
    getLastEventReceivedAtMock.mockReturnValue(null);
    getJetstreamEventsLast5MinMock.mockReturnValue(0);
    getJetstreamRuntimeStateMock.mockReturnValue({
      activeEvents: 0,
      pendingEvents: 0,
      maxConcurrentEvents: 20,
      maxPendingEvents: 10_000,
      pauseQueueThreshold: 100,
      resumeQueueThreshold: 25,
      inboundPaused: false,
      pauseCount: 0,
      resumeCount: 0,
      overloadReconnectCount: 0,
      totalDroppedEvents: 0,
      cursorUs: null,
      cursorLagMs: null,
    });
    getJetstreamDisconnectedAtMock.mockReturnValue(null);
    redisZCardMock.mockResolvedValue(0);
    dbQueryMock
      .mockResolvedValueOnce({
        rows: [{
          total_posts: '0',
          posts_24h: '0',
          posts_7d: '0',
          oldest_post: null,
          newest_post: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ total: '0', with_votes: '0', active_last_week: '0' }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const app = Fastify();
    registerFeedHealthRoutes(app);
    try {
      const response = await app.inject({ method: 'GET', url: '/feed-health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        jetstream: {
          connected: false,
          cursorUs: null,
          cursorLagMs: null,
          activeEvents: 0,
          pendingEvents: 0,
          pauseCount: 0,
          resumeCount: 0,
          overloadReconnectCount: 0,
          totalDroppedEvents: 0,
        },
      });
    } finally {
      await app.close();
    }
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
