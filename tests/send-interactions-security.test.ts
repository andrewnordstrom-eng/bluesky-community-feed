import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { dbQueryMock, redisGetMock, verifyFeedRequesterDidMock, isParticipantApprovedMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  redisGetMock: vi.fn(),
  verifyFeedRequesterDidMock: vi.fn(),
  isParticipantApprovedMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    get: redisGetMock,
  },
}));

vi.mock('../src/feed/jwt-verifier.js', () => ({
  verifyFeedRequesterDid: verifyFeedRequesterDidMock,
}));

vi.mock('../src/feed/access-control.js', () => ({
  isParticipantApproved: isParticipantApprovedMock,
}));

import { config } from '../src/config.js';
import { isAppError } from '../src/lib/errors.js';
import { registerSendInteractions } from '../src/feed/routes/send-interactions.js';
import { buildTestApp } from './helpers/index.js';

function buildApp(): FastifyInstance {
  const app = buildTestApp();
  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      return reply.code(error.statusCode).send(error.toResponse());
    }
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Unexpected error' });
  });
  return app;
}

describe('sendInteractions security controls', () => {
  const originalPrivateMode = config.FEED_PRIVATE_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    config.FEED_PRIVATE_MODE = false;
    verifyFeedRequesterDidMock.mockResolvedValue('did:plc:alice');
    isParticipantApprovedMock.mockResolvedValue(true);
    redisGetMock.mockResolvedValue('42');
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  afterEach(() => {
    config.FEED_PRIVATE_MODE = originalPrivateMode;
  });

  it('rejects interactions with invalid event format', async () => {
    const app = buildApp();
    registerSendInteractions(app);

    const response = await app.inject({
      method: 'POST',
      url: '/xrpc/app.bsky.feed.sendInteractions',
      headers: {
        authorization: 'Bearer valid-token',
      },
      payload: {
        interactions: [
          {
            item: 'at://did:plc:alice/app.bsky.feed.post/123',
            event: 'requestMore',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'VALIDATION_ERROR',
    });

    await app.close();
  });

  it('rejects oversized interaction item values', async () => {
    const app = buildApp();
    registerSendInteractions(app);

    const response = await app.inject({
      method: 'POST',
      url: '/xrpc/app.bsky.feed.sendInteractions',
      headers: {
        authorization: 'Bearer valid-token',
      },
      payload: {
        interactions: [
          {
            item: `at://${'x'.repeat(700)}`,
            event: 'app.bsky.feed.defs#requestMore',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'VALIDATION_ERROR',
    });

    await app.close();
  });

  it('requires approved participants in private mode', async () => {
    config.FEED_PRIVATE_MODE = true;
    isParticipantApprovedMock.mockResolvedValue(false);

    const app = buildApp();
    registerSendInteractions(app);

    const response = await app.inject({
      method: 'POST',
      url: '/xrpc/app.bsky.feed.sendInteractions',
      headers: {
        authorization: 'Bearer valid-token',
      },
      payload: {
        interactions: [
          {
            item: 'at://did:plc:alice/app.bsky.feed.post/123',
            event: 'app.bsky.feed.defs#requestMore',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: 'FORBIDDEN',
    });
    expect(isParticipantApprovedMock).toHaveBeenCalledWith('did:plc:alice');
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('stores valid interaction payloads', async () => {
    const app = buildApp();
    registerSendInteractions(app);

    const response = await app.inject({
      method: 'POST',
      url: '/xrpc/app.bsky.feed.sendInteractions',
      headers: {
        authorization: 'Bearer valid-token',
      },
      payload: {
        interactions: [
          {
            item: 'at://did:plc:alice/app.bsky.feed.post/123',
            event: 'app.bsky.feed.defs#requestMore',
            feedContext: 'timeline:community-gov',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({});
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0][0]).toContain('INSERT INTO feed_interactions');

    await app.close();
  });
});
