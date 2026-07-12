import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RankingWorker,
  readRankingWorkerHealth,
  ScoringPipelineTimeoutError,
  type RankingWorkerLease,
  type RankingWorkerQueue,
  type RankingWorkerRedis,
} from '../src/scoring/ranking-worker.js';
import type {
  EnqueuedRankingRequest,
  RankingQueueStatus,
  RankingRequest,
} from '../src/scoring/ranking-request-queue.js';

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../src/scoring/ranking-request-queue.js', () => ({
  scheduledRequestKey: (communityId: string, at: Date, intervalMs: number) =>
    `scheduled:${communityId}:${Math.floor(at.getTime() / intervalMs)}`,
}));

class FakeQueue implements RankingWorkerQueue {
  readonly requests: RankingRequest[] = [];
  readonly completed: string[] = [];
  readonly failed: string[] = [];
  readonly deferred: string[] = [];
  staleClaimsRecovered = 0;
  private nextId = 1;

  async enqueue(input: {
    idempotencyKey: string;
    communityId: string;
    requestKind: 'scheduled' | 'manual' | 'replacement' | 'reconciliation';
    requestedBy: string | null;
    notBefore: Date;
  }): Promise<EnqueuedRankingRequest> {
    const id = `request-${this.nextId}`;
    this.nextId += 1;
    this.requests.push({
      id,
      idempotencyKey: input.idempotencyKey,
      communityId: input.communityId,
      requestKind: input.requestKind,
      state: 'pending',
      requestedBy: input.requestedBy,
      requestedAt: input.notBefore.toISOString(),
      notBefore: input.notBefore.toISOString(),
      claimedBy: null,
      claimedAt: null,
    });
    return { id, created: true, idempotencyKey: input.idempotencyKey };
  }

  async claimNext(workerId: string, communityId: string): Promise<RankingRequest | null> {
    const request = this.requests.find((candidate) => (
      candidate.state === 'pending'
      && candidate.communityId === communityId
      && new Date(candidate.notBefore).getTime() <= new Date('2026-07-12T05:00:00.000Z').getTime()
    ));
    if (!request) {
      return null;
    }
    request.state = 'claimed';
    request.claimedBy = workerId;
    request.claimedAt = '2026-07-12T05:00:00.000Z';
    return { ...request };
  }

  async complete(requestId: string, workerId: string): Promise<void> {
    const request = this.requireOwnedClaim(requestId, workerId);
    request.state = 'completed';
    this.completed.push(requestId);
  }

  async fail(requestId: string, workerId: string): Promise<void> {
    const request = this.requireOwnedClaim(requestId, workerId);
    request.state = 'failed';
    this.failed.push(requestId);
  }

  async defer(requestId: string, workerId: string, notBefore: Date): Promise<void> {
    const request = this.requireOwnedClaim(requestId, workerId);
    request.state = 'pending';
    request.claimedBy = null;
    request.claimedAt = null;
    request.notBefore = notBefore.toISOString();
    this.deferred.push(requestId);
  }

  async status(communityId: string): Promise<RankingQueueStatus> {
    const requests = this.requests.filter((request) => request.communityId === communityId);
    const pending = requests.filter((request) => request.state === 'pending');
    const claimed = requests.filter((request) => request.state === 'claimed');
    const newest = requests.at(-1) ?? null;
    return {
      pendingCount: pending.length,
      claimedCount: claimed.length,
      oldestPendingAt: pending[0]?.requestedAt ?? null,
      newestRequestId: newest?.id ?? null,
      newestRequestState: newest?.state ?? null,
    };
  }

  async requeueStaleClaims(staleBefore: Date, communityId: string): Promise<number> {
    const recovered = this.requests.filter((request) => (
      request.state === 'claimed'
      && request.communityId === communityId
      && request.claimedAt !== null
      && new Date(request.claimedAt).getTime() < staleBefore.getTime()
    ));
    for (const request of recovered) {
      request.state = 'pending';
      request.claimedBy = null;
      request.claimedAt = null;
    }
    this.staleClaimsRecovered += recovered.length;
    return recovered.length;
  }

  private requireOwnedClaim(requestId: string, workerId: string): RankingRequest {
    const request = this.requests.find((candidate) => candidate.id === requestId);
    if (!request || request.state !== 'claimed' || request.claimedBy !== workerId) {
      throw new Error(`Request ${requestId} is not claimed by ${workerId}`);
    }
    return request;
  }
}

class FakeRedis implements RankingWorkerRedis {
  readonly values = new Map<string, string>();
  writeCount = 0;

  async set(key: string, value: string): Promise<'OK'> {
    this.writeCount += 1;
    this.values.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
}

function lease(overrides: Partial<RankingWorkerLease>): RankingWorkerLease {
  return {
    createToken: () => 'owner-token',
    acquire: async () => true,
    renew: async () => true,
    release: async () => true,
    ...overrides,
  };
}

interface TestClock {
  now: () => Date;
  advance: (milliseconds: number) => void;
}

function createClock(): TestClock {
  let currentMs = new Date('2026-07-12T05:00:00.000Z').getTime();
  return {
    now: () => new Date(currentMs),
    advance: (milliseconds: number) => {
      currentMs += milliseconds;
    },
  };
}

function workerOptions(input: {
  queue: FakeQueue;
  redis: FakeRedis;
  ownedLease: RankingWorkerLease;
  runRanking: () => Promise<void>;
  clock: TestClock;
}) {
  return {
    queue: input.queue,
    redis: input.redis,
    lease: input.ownedLease,
    workerId: 'worker-1',
    communityId: 'community-gov',
    scheduleIntervalMs: 300_000,
    pollIntervalMs: 1_000,
    leaseRenewIntervalMs: 20_000,
    heartbeatIntervalMs: 10_000,
    heartbeatTtlMs: 30_000,
    claimStaleAfterMs: 300_000,
    runRanking: input.runRanking,
    now: input.clock.now,
  };
}

describe('ranking worker isolation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists, claims, leases, and completes scheduled work', async () => {
    const queue = new FakeQueue();
    const redis = new FakeRedis();
    const clock = createClock();
    const runRanking = vi.fn().mockResolvedValue(undefined);
    const ownedLease = lease({});
    const worker = new RankingWorker(workerOptions({ queue, redis, ownedLease, runRanking, clock }));

    await worker.start();
    await worker.stop();

    expect(runRanking).toHaveBeenCalledTimes(1);
    expect(queue.completed).toEqual(['request-1']);
    expect(queue.failed).toEqual([]);
  });

  it('never starts ranking without the distributed lease', async () => {
    const queue = new FakeQueue();
    const redis = new FakeRedis();
    const clock = createClock();
    const runRanking = vi.fn().mockResolvedValue(undefined);
    const worker = new RankingWorker(workerOptions({
      queue,
      redis,
      ownedLease: lease({ acquire: async () => false }),
      runRanking,
      clock,
    }));

    await worker.start();
    await worker.stop();

    expect(runRanking).not.toHaveBeenCalled();
    expect(queue.deferred).toEqual(['request-1']);
    expect(queue.completed).toEqual([]);
  });

  it('fails the durable request when ownership is lost during ranking', async () => {
    vi.useFakeTimers();
    const queue = new FakeQueue();
    const redis = new FakeRedis();
    const clock = createClock();
    let finishRanking: (() => void) | undefined;
    const runRanking = vi.fn(() => new Promise<void>((resolve) => {
      finishRanking = resolve;
    }));
    const worker = new RankingWorker(workerOptions({
      queue,
      redis,
      ownedLease: lease({ renew: async () => false, release: async () => false }),
      runRanking,
      clock,
    }));

    const starting = worker.start();
    await vi.advanceTimersByTimeAsync(20_000);
    finishRanking?.();
    await starting;
    await worker.stop();

    expect(queue.failed).toEqual(['request-1']);
    expect(queue.completed).toEqual([]);
  });

  it('keeps heartbeating while the first ranking run is still active', async () => {
    vi.useFakeTimers();
    const queue = new FakeQueue();
    const redis = new FakeRedis();
    const clock = createClock();
    let finishRanking: (() => void) | undefined;
    const runRanking = vi.fn(() => new Promise<void>((resolve) => {
      finishRanking = resolve;
    }));
    const worker = new RankingWorker(workerOptions({
      queue,
      redis,
      ownedLease: lease({}),
      runRanking,
      clock,
    }));

    await worker.start();
    clock.advance(40_000);
    await vi.advanceTimersByTimeAsync(40_000);
    const health = await readRankingWorkerHealth(
      redis,
      queue,
      'community-gov',
      clock.now(),
      30_000
    );

    expect(health.healthy).toBe(true);
    expect(health.heartbeat?.state).toBe('running');
    expect(health.heartbeat?.updatedAt).toBe('2026-07-12T05:00:40.000Z');
    expect(health.ageMs).toBe(0);
    finishRanking?.();
    await worker.stop();
  });

  it('quarantines a timed-out publisher and retains its lease until process stop', async () => {
    const queue = new FakeQueue();
    const redis = new FakeRedis();
    const clock = createClock();
    const release = vi.fn().mockResolvedValue(true);
    const runRanking = vi.fn().mockRejectedValue(
      new ScoringPipelineTimeoutError(new Error('legacy timeout'))
    );
    const worker = new RankingWorker(workerOptions({
      queue,
      redis,
      ownedLease: lease({ release }),
      runRanking,
      clock,
    }));

    await worker.start();
    await vi.waitFor(() => {
      expect(queue.failed).toEqual(['request-1']);
    });
    await worker.drainOnce();

    expect(runRanking).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(JSON.parse(redis.values.get('corgi:ranking-worker:heartbeat:community-gov') ?? '{}'))
      .toEqual(expect.objectContaining({ state: 'failed' }));

    await worker.stop();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('reports heartbeat age and queue state independently', async () => {
    const queue = new FakeQueue();
    const redis = new FakeRedis();
    const clock = createClock();
    const worker = new RankingWorker(workerOptions({
      queue,
      redis,
      ownedLease: lease({}),
      runRanking: async () => undefined,
      clock,
    }));
    await worker.start();

    const health = await readRankingWorkerHealth(
      redis,
      queue,
      'community-gov',
      new Date('2026-07-12T05:00:05.000Z'),
      30_000
    );

    expect(health.healthy).toBe(true);
    expect(health.ageMs).toBe(5_000);
    expect(health.heartbeat?.workerId).toBe('worker-1');
    await worker.stop();
  });

  it('rejects a heartbeat timestamp from the future', async () => {
    const queue = new FakeQueue();
    const redis = new FakeRedis();
    await redis.set('corgi:ranking-worker:heartbeat:community-gov', JSON.stringify({
      schemaVersion: 1,
      workerId: 'worker-1',
      communityId: 'community-gov',
      state: 'idle',
      updatedAt: '2026-07-12T05:01:00.000Z',
      currentRequestId: null,
      lastCompletedAt: null,
      lastError: null,
    }));

    const health = await readRankingWorkerHealth(
      redis,
      queue,
      'community-gov',
      new Date('2026-07-12T05:00:00.000Z'),
      30_000
    );

    expect(health.healthy).toBe(false);
    expect(health.ageMs).toBe(-60_000);
  });

  it('treats the exact heartbeat TTL as healthy and one millisecond beyond as stale', async () => {
    const queue = new FakeQueue();
    const redis = new FakeRedis();
    await redis.set('corgi:ranking-worker:heartbeat:community-gov', JSON.stringify({
      schemaVersion: 1,
      workerId: 'worker-1',
      communityId: 'community-gov',
      state: 'idle',
      updatedAt: '2026-07-12T05:00:00.000Z',
      currentRequestId: null,
      lastCompletedAt: null,
      lastError: null,
    }));

    const atBoundary = await readRankingWorkerHealth(
      redis,
      queue,
      'community-gov',
      new Date('2026-07-12T05:00:30.000Z'),
      30_000
    );
    const beyondBoundary = await readRankingWorkerHealth(
      redis,
      queue,
      'community-gov',
      new Date('2026-07-12T05:00:30.001Z'),
      30_000
    );

    expect(atBoundary.healthy).toBe(true);
    expect(beyondBoundary.healthy).toBe(false);
  });

  it('rejects malformed and cross-community heartbeat payloads', async () => {
    const queue = new FakeQueue();
    const redis = new FakeRedis();
    await redis.set('corgi:ranking-worker:heartbeat:community-gov', '{invalid-json');
    await expect(readRankingWorkerHealth(
      redis,
      queue,
      'community-gov',
      new Date('2026-07-12T05:00:00.000Z'),
      30_000
    )).rejects.toBeInstanceOf(SyntaxError);

    await redis.set('corgi:ranking-worker:heartbeat:community-gov', JSON.stringify({
      schemaVersion: 1,
      workerId: 'worker-2',
      communityId: 'future-feed',
      state: 'idle',
      updatedAt: '2026-07-12T05:00:00.000Z',
      currentRequestId: null,
      lastCompletedAt: null,
      lastError: null,
    }));
    await expect(readRankingWorkerHealth(
      redis,
      queue,
      'community-gov',
      new Date('2026-07-12T05:00:00.000Z'),
      30_000
    )).rejects.toThrow('community mismatch');
  });

  it('fails startup cleanly when Redis or stale-claim recovery is unavailable', async () => {
    const redisFailureQueue = new FakeQueue();
    const redisFailure = new FakeRedis();
    vi.spyOn(redisFailure, 'set').mockRejectedValue(new Error('redis unavailable'));
    const redisFailureWorker = new RankingWorker(workerOptions({
      queue: redisFailureQueue,
      redis: redisFailure,
      ownedLease: lease({}),
      runRanking: async () => undefined,
      clock: createClock(),
    }));
    await expect(redisFailureWorker.start()).rejects.toThrow('redis unavailable');
    expect(redisFailureWorker.isRunning()).toBe(false);

    const queueFailure = new FakeQueue();
    vi.spyOn(queueFailure, 'requeueStaleClaims').mockRejectedValue(
      new Error('queue unavailable')
    );
    const queueFailureRedis = new FakeRedis();
    const queueFailureWorker = new RankingWorker(workerOptions({
      queue: queueFailure,
      redis: queueFailureRedis,
      ownedLease: lease({}),
      runRanking: async () => undefined,
      clock: createClock(),
    }));
    await expect(queueFailureWorker.start()).rejects.toThrow('queue unavailable');
    expect(queueFailureWorker.isRunning()).toBe(false);
    expect(JSON.parse(
      queueFailureRedis.values.get('corgi:ranking-worker:heartbeat:community-gov') ?? '{}'
    )).toEqual(expect.objectContaining({ state: 'failed', lastError: 'queue unavailable' }));
  });

  it('recovers stale work only for its configured community', async () => {
    const queue = new FakeQueue();
    queue.requests.push({
      id: 'stale-community-request',
      idempotencyKey: 'scheduled:community-gov:stale',
      communityId: 'community-gov',
      requestKind: 'scheduled',
      state: 'claimed',
      requestedBy: 'ranking-worker',
      requestedAt: '2026-07-12T04:00:00.000Z',
      notBefore: '2026-07-12T04:00:00.000Z',
      claimedBy: 'dead-worker',
      claimedAt: '2026-07-12T04:00:00.000Z',
    }, {
      id: 'stale-future-feed-request',
      idempotencyKey: 'scheduled:future-feed:stale',
      communityId: 'future-feed',
      requestKind: 'scheduled',
      state: 'claimed',
      requestedBy: 'ranking-worker',
      requestedAt: '2026-07-12T04:00:00.000Z',
      notBefore: '2026-07-12T04:00:00.000Z',
      claimedBy: 'dead-worker',
      claimedAt: '2026-07-12T04:00:00.000Z',
    });
    const worker = new RankingWorker(workerOptions({
      queue,
      redis: new FakeRedis(),
      ownedLease: lease({}),
      runRanking: async () => undefined,
      clock: createClock(),
    }));

    await worker.start();
    await worker.stop();

    expect(queue.staleClaimsRecovered).toBe(1);
    expect(queue.completed).toContain('stale-community-request');
    expect(queue.requests.find((request) => request.id === 'stale-future-feed-request'))
      .toEqual(expect.objectContaining({ state: 'claimed', claimedBy: 'dead-worker' }));
  });

  it('serializes concurrent start and stop calls', async () => {
    const queue = new FakeQueue();
    const runRanking = vi.fn().mockResolvedValue(undefined);
    const worker = new RankingWorker(workerOptions({
      queue,
      redis: new FakeRedis(),
      ownedLease: lease({}),
      runRanking,
      clock: createClock(),
    }));

    await Promise.all([worker.start(), worker.start()]);
    await Promise.all([worker.stop(), worker.stop()]);

    expect(runRanking).toHaveBeenCalledTimes(1);
    expect(worker.isRunning()).toBe(false);
  });

  it('waits for an active ranking run before stop completes', async () => {
    const queue = new FakeQueue();
    let finishRanking: (() => void) | undefined;
    const runRanking = vi.fn(() => new Promise<void>((resolve) => {
      finishRanking = resolve;
    }));
    const worker = new RankingWorker(workerOptions({
      queue,
      redis: new FakeRedis(),
      ownedLease: lease({}),
      runRanking,
      clock: createClock(),
    }));
    await worker.start();
    await vi.waitFor(() => {
      expect(finishRanking).toBeTypeOf('function');
    });

    let stopped = false;
    const stopping = worker.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finishRanking?.();
    await stopping;

    expect(stopped).toBe(true);
    expect(worker.isRunning()).toBe(false);
  });
});
