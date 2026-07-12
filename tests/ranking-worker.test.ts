import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RankingWorker,
  readRankingWorkerHealth,
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

  async claimNext(workerId: string): Promise<RankingRequest | null> {
    const request = this.requests.shift();
    return request ? { ...request, state: 'claimed', claimedBy: workerId } : null;
  }

  async complete(requestId: string): Promise<void> {
    this.completed.push(requestId);
  }

  async fail(requestId: string): Promise<void> {
    this.failed.push(requestId);
  }

  async defer(requestId: string): Promise<void> {
    this.deferred.push(requestId);
  }

  async status(): Promise<RankingQueueStatus> {
    return {
      pendingCount: this.requests.length,
      claimedCount: 0,
      oldestPendingAt: this.requests[0]?.requestedAt ?? null,
      newestRequestId: this.requests.at(-1)?.id ?? null,
      newestRequestState: this.requests.length > 0 ? 'pending' : null,
    };
  }

  async requeueStaleClaims(): Promise<number> {
    return 0;
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

function workerOptions(input: {
  queue: FakeQueue;
  redis: FakeRedis;
  ownedLease: RankingWorkerLease;
  runRanking: () => Promise<void>;
}) {
  const now = new Date('2026-07-12T05:00:00.000Z');
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
    now: () => new Date(now),
  };
}

describe('ranking worker isolation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists, claims, leases, and completes scheduled work', async () => {
    const queue = new FakeQueue();
    const redis = new FakeRedis();
    const runRanking = vi.fn().mockResolvedValue(undefined);
    const ownedLease = lease({});
    const worker = new RankingWorker(workerOptions({ queue, redis, ownedLease, runRanking }));

    await worker.start();
    await worker.stop();

    expect(runRanking).toHaveBeenCalledTimes(1);
    expect(queue.completed).toEqual(['request-1']);
    expect(queue.failed).toEqual([]);
  });

  it('never starts ranking without the distributed lease', async () => {
    const queue = new FakeQueue();
    const redis = new FakeRedis();
    const runRanking = vi.fn().mockResolvedValue(undefined);
    const worker = new RankingWorker(workerOptions({
      queue,
      redis,
      ownedLease: lease({ acquire: async () => false }),
      runRanking,
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
    let finishRanking: (() => void) | undefined;
    const runRanking = vi.fn(() => new Promise<void>((resolve) => {
      finishRanking = resolve;
    }));
    const worker = new RankingWorker(workerOptions({
      queue,
      redis,
      ownedLease: lease({ renew: async () => false, release: async () => false }),
      runRanking,
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
    let finishRanking: (() => void) | undefined;
    const runRanking = vi.fn(() => new Promise<void>((resolve) => {
      finishRanking = resolve;
    }));
    const worker = new RankingWorker(workerOptions({
      queue,
      redis,
      ownedLease: lease({}),
      runRanking,
    }));

    await worker.start();
    await vi.advanceTimersByTimeAsync(40_000);
    const health = await readRankingWorkerHealth(
      redis,
      queue,
      new Date('2026-07-12T05:00:00.000Z'),
      30_000
    );

    expect(health.healthy).toBe(true);
    expect(health.heartbeat?.state).toBe('running');
    expect(redis.writeCount).toBeGreaterThanOrEqual(7);
    finishRanking?.();
    await worker.stop();
  });

  it('quarantines a timed-out publisher and retains its lease until process stop', async () => {
    const queue = new FakeQueue();
    const redis = new FakeRedis();
    const release = vi.fn().mockResolvedValue(true);
    const runRanking = vi.fn().mockRejectedValue(new Error('Scoring pipeline timed out'));
    const worker = new RankingWorker(workerOptions({
      queue,
      redis,
      ownedLease: lease({ release }),
      runRanking,
    }));

    await worker.start();
    await vi.waitFor(() => {
      expect(queue.failed).toEqual(['request-1']);
    });
    await worker.drainOnce();

    expect(runRanking).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(JSON.parse(redis.values.get('corgi:ranking-worker:heartbeat') ?? '{}'))
      .toEqual(expect.objectContaining({ state: 'failed' }));

    await worker.stop();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('reports heartbeat age and queue state independently', async () => {
    const queue = new FakeQueue();
    const redis = new FakeRedis();
    const worker = new RankingWorker(workerOptions({
      queue,
      redis,
      ownedLease: lease({}),
      runRanking: async () => undefined,
    }));
    await worker.start();

    const health = await readRankingWorkerHealth(
      redis,
      queue,
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
    await redis.set('corgi:ranking-worker:heartbeat', JSON.stringify({
      schemaVersion: 1,
      workerId: 'worker-1',
      state: 'idle',
      updatedAt: '2026-07-12T05:01:00.000Z',
      currentRequestId: null,
      lastCompletedAt: null,
      lastError: null,
    }));

    const health = await readRankingWorkerHealth(
      redis,
      queue,
      new Date('2026-07-12T05:00:00.000Z'),
      30_000
    );

    expect(health.healthy).toBe(false);
    expect(health.ageMs).toBe(-60_000);
  });
});
