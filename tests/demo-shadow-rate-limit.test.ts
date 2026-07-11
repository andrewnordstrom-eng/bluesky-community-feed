import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import {
  DemoRateLimitError,
  RedisDemoRateLimitGuard,
  type DemoRateLimitPolicies,
} from '../src/demo/rate-limit.js';
import { DemoStoreUnavailableError } from '../src/demo/store.js';

const POLICIES: DemoRateLimitPolicies = {
  session_create: { max: 2, windowMs: 60_000 },
  mutation: { max: 4, windowMs: 60_000 },
  read: { max: 10, windowMs: 60_000 },
};

describe('isolated shadow demo rate limiter', () => {
  it('uses only hashed identifiers in the demo Redis namespace', async () => {
    const { guard, evalMock } = createGuard([1, 60_000], 'test-secret', 'ready');

    await guard.check('session_create', '203.0.113.42');

    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.stringMatching(/^demo:rate-limit:session_create:[a-f0-9]{64}$/),
      60_000
    );
    expect(JSON.stringify(evalMock.mock.calls)).not.toContain('203.0.113.42');
  });

  it('keys the same identifier differently under a different server secret', async () => {
    const first = createGuard([1, 60_000], 'first-secret', 'ready');
    const second = createGuard([1, 60_000], 'second-secret', 'ready');

    await first.guard.check('read', '203.0.113.42');
    await second.guard.check('read', '203.0.113.42');

    expect(first.evalMock.mock.calls[0][2]).not.toBe(second.evalMock.mock.calls[0][2]);
  });

  it('allows the configured maximum and rejects the next request with a retry time', async () => {
    const { guard, evalMock } = createGuard([2, 60_000], 'test-secret', 'ready');
    await expect(guard.check('session_create', 'reviewer')).resolves.toBeUndefined();

    evalMock.mockResolvedValueOnce([3, 1_201]);
    await expect(guard.check('session_create', 'reviewer')).rejects.toMatchObject({
      name: 'DemoRateLimitError',
      retryAfterSeconds: 2,
    } satisfies Partial<DemoRateLimitError>);
  });

  it('fails only the demo when its Redis counter is unavailable or malformed', async () => {
    const unavailable = createGuard(new Error('connection refused'), 'test-secret', 'ready').guard;
    await expect(unavailable.check('read', 'reviewer')).rejects.toBeInstanceOf(DemoStoreUnavailableError);

    const malformed = createGuard(['not-a-count', -1], 'test-secret', 'ready').guard;
    await expect(malformed.check('read', 'reviewer')).rejects.toBeInstanceOf(DemoStoreUnavailableError);

    const wrongShape = createGuard([1], 'test-secret', 'ready').guard;
    await expect(wrongShape.check('read', 'reviewer')).rejects.toBeInstanceOf(DemoStoreUnavailableError);
  });

  it.each([
    ['mutation', 4] as const,
    ['read', 10] as const,
  ])('enforces the inclusive %s policy boundary', async (kind, maximum) => {
    const { guard, evalMock } = createGuard([maximum, 60_000], 'test-secret', 'ready');
    await expect(guard.check(kind, '')).resolves.toBeUndefined();
    expect(evalMock.mock.calls[0][2]).toMatch(new RegExp(`^demo:rate-limit:${kind}:[a-f0-9]{64}$`));

    evalMock.mockResolvedValueOnce([maximum + 1, 60_000]);
    await expect(guard.check(kind, '')).rejects.toBeInstanceOf(DemoRateLimitError);
  });

  it('disconnects an active dedicated Redis client without issuing a network command', async () => {
    const { guard, disconnectMock } = createGuard([1, 60_000], 'test-secret', 'ready');

    await guard.close();

    expect(disconnectMock).toHaveBeenCalledWith(false);
  });

  it.each(['wait', 'end'])('does not disconnect a Redis client in %s state', async (status) => {
    const { guard, disconnectMock } = createGuard([1, 60_000], 'test-secret', status);

    await guard.close();

    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it('connects a cold lazy client before issuing its first counter command', async () => {
    const { guard, connectMock, evalMock } = createGuard([1, 60_000], 'test-secret', 'wait');

    await guard.check('read', 'reviewer');

    expect(connectMock).toHaveBeenCalledOnce();
    expect(evalMock).toHaveBeenCalledOnce();
  });

  it('deduplicates concurrent cold-client connection attempts', async () => {
    const { guard, connectMock, evalMock } = createGuard([1, 60_000], 'test-secret', 'wait');

    await Promise.all([
      guard.check('read', 'reviewer-a'),
      guard.check('read', 'reviewer-b'),
    ]);

    expect(connectMock).toHaveBeenCalledOnce();
    expect(evalMock).toHaveBeenCalledTimes(2);
  });

  it('wraps a cold-client connection failure as demo-only unavailability', async () => {
    const { guard, connectMock, evalMock } = createGuard([1, 60_000], 'test-secret', 'wait');
    connectMock.mockRejectedValueOnce(new Error('Redis authentication failed'));

    await expect(guard.check('read', 'reviewer')).rejects.toBeInstanceOf(DemoStoreUnavailableError);
    expect(evalMock).not.toHaveBeenCalled();
  });
});

function createGuard(result: unknown, secret: string, status: string): {
  guard: RedisDemoRateLimitGuard;
  evalMock: ReturnType<typeof vi.fn>;
  disconnectMock: ReturnType<typeof vi.fn>;
  connectMock: ReturnType<typeof vi.fn>;
} {
  const evalMock = vi.fn();
  if (result instanceof Error) {
    evalMock.mockRejectedValue(result);
  } else {
    evalMock.mockResolvedValue(result);
  }
  const disconnectMock = vi.fn();
  let redisStatus = status;
  const connectMock = vi.fn(async () => {
    redisStatus = 'ready';
  });
  const redisState = {
    get status(): string {
      return redisStatus;
    },
    eval: evalMock,
    disconnect: disconnectMock,
    connect: connectMock,
  };
  const redis = redisState as unknown as Redis;
  return {
    guard: new RedisDemoRateLimitGuard(redis, POLICIES, secret),
    evalMock,
    disconnectMock,
    connectMock,
  };
}
