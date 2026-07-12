import { hostname } from 'node:os';
import { logger } from '../lib/logger.js';
import type {
  EnqueuedRankingRequest,
  RankingQueueStatus,
  RankingRequest,
} from './ranking-request-queue.js';
import { scheduledRequestKey } from './ranking-request-queue.js';

export const RANKING_WORKER_HEARTBEAT_KEY = 'corgi:ranking-worker:heartbeat';

export type RankingWorkerState = 'starting' | 'idle' | 'running' | 'stopping' | 'failed';

export interface RankingWorkerHeartbeat {
  schemaVersion: 1;
  workerId: string;
  state: RankingWorkerState;
  updatedAt: string;
  currentRequestId: string | null;
  lastCompletedAt: string | null;
  lastError: string | null;
}

export interface RankingWorkerHealth {
  healthy: boolean;
  heartbeat: RankingWorkerHeartbeat | null;
  ageMs: number | null;
  queue: RankingQueueStatus;
}

export interface RankingWorkerOptions {
  queue: RankingWorkerQueue;
  lease: RankingWorkerLease;
  redis: RankingWorkerRedis;
  workerId: string;
  communityId: string;
  scheduleIntervalMs: number;
  pollIntervalMs: number;
  leaseRenewIntervalMs: number;
  heartbeatIntervalMs: number;
  heartbeatTtlMs: number;
  claimStaleAfterMs: number;
  runRanking: () => Promise<void>;
  now: () => Date;
}

export interface RankingWorkerQueue {
  enqueue(input: {
    idempotencyKey: string;
    communityId: string;
    requestKind: 'scheduled' | 'manual' | 'replacement' | 'reconciliation';
    requestedBy: string | null;
    notBefore: Date;
  }): Promise<EnqueuedRankingRequest>;
  claimNext(workerId: string): Promise<RankingRequest | null>;
  complete(requestId: string, workerId: string): Promise<void>;
  fail(requestId: string, workerId: string, error: unknown): Promise<void>;
  defer(requestId: string, workerId: string, notBefore: Date): Promise<void>;
  status(): Promise<RankingQueueStatus>;
  requeueStaleClaims(staleBefore: Date): Promise<number>;
}

export interface RankingWorkerLease {
  createToken(): string;
  acquire(token: string): Promise<boolean>;
  renew(token: string): Promise<boolean>;
  release(token: string): Promise<boolean>;
}

export interface RankingWorkerRedis {
  set(key: string, value: string, expiryMode: 'PX', ttlMs: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

interface QuarantinedLease {
  token: string;
  renewalTimer: NodeJS.Timeout;
}

export class RankingWorker {
  private readonly options: RankingWorkerOptions;
  private scheduleTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private currentRun: Promise<void> | null = null;
  private quarantinedLease: QuarantinedLease | null = null;
  private quarantined = false;
  private running = false;
  private stopping = false;
  private state: RankingWorkerState = 'starting';
  private currentRequestId: string | null = null;
  private lastCompletedAt: string | null = null;
  private lastError: string | null = null;

  constructor(options: RankingWorkerOptions) {
    assertOptions(options);
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.running) {
      logger.warn({ workerId: this.options.workerId }, 'Ranking worker already running');
      return;
    }
    this.running = true;
    this.stopping = false;
    this.state = 'starting';
    await this.writeHeartbeat();
    const recoveredClaims = await this.options.queue.requeueStaleClaims(
      new Date(this.options.now().getTime() - this.options.claimStaleAfterMs)
    );
    if (recoveredClaims > 0) {
      logger.warn({ recoveredClaims }, 'Recovered stale ranking request claims');
    }
    await this.enqueueScheduledRequest(this.options.now());

    this.scheduleTimer = setInterval(() => {
      void this.enqueueScheduledAndDrain();
    }, this.options.scheduleIntervalMs);
    this.pollTimer = setInterval(() => {
      void this.drainOnce();
    }, this.options.pollIntervalMs);
    this.heartbeatTimer = setInterval(() => {
      void this.writeHeartbeat().catch((error) => {
        this.lastError = errorMessage(error);
        logger.error({ err: error }, 'Ranking worker heartbeat failed');
      });
    }, this.options.heartbeatIntervalMs);
    this.state = 'idle';
    await this.writeHeartbeat();
    logger.info({ workerId: this.options.workerId }, 'Ranking worker started');
    void this.drainOnce();
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.stopping = true;
    this.state = 'stopping';
    clearTimer(this.scheduleTimer);
    clearTimer(this.pollTimer);
    this.scheduleTimer = null;
    this.pollTimer = null;
    await this.writeHeartbeat();
    if (this.currentRun) {
      await this.currentRun;
    }
    if (this.quarantinedLease) {
      clearInterval(this.quarantinedLease.renewalTimer);
      try {
        const released = await this.options.lease.release(this.quarantinedLease.token);
        if (!released) {
          logger.warn('Quarantined ranking lease was no longer owned at process stop');
        }
      } catch (error) {
        logger.error({ err: error }, 'Quarantined ranking lease release failed');
      }
      this.quarantinedLease = null;
    }
    clearTimer(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.running = false;
    logger.info({ workerId: this.options.workerId }, 'Ranking worker stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  isRanking(): boolean {
    return this.currentRequestId !== null;
  }

  async enqueueManual(requestedBy: string, idempotencyKey: string): Promise<EnqueuedRankingRequest> {
    return this.options.queue.enqueue({
      idempotencyKey,
      communityId: this.options.communityId,
      requestKind: 'manual',
      requestedBy,
      notBefore: this.options.now(),
    });
  }

  async drainOnce(): Promise<void> {
    if (!this.running || this.stopping || this.currentRun || this.quarantined) {
      return;
    }
    const run = this.processNext();
    this.currentRun = run;
    try {
      await run;
    } finally {
      if (this.currentRun === run) {
        this.currentRun = null;
      }
    }
  }

  private async enqueueScheduledAndDrain(): Promise<void> {
    try {
      await this.enqueueScheduledRequest(this.options.now());
      await this.drainOnce();
    } catch (error) {
      this.lastError = errorMessage(error);
      logger.error({ err: error }, 'Failed to enqueue scheduled ranking request');
    }
  }

  private async enqueueScheduledRequest(at: Date): Promise<void> {
    const idempotencyKey = scheduledRequestKey(
      this.options.communityId,
      at,
      this.options.scheduleIntervalMs
    );
    await this.options.queue.enqueue({
      idempotencyKey,
      communityId: this.options.communityId,
      requestKind: 'scheduled',
      requestedBy: 'ranking-worker',
      notBefore: at,
    });
  }

  private async processNext(): Promise<void> {
    let request: RankingRequest | null = null;
    try {
      request = await this.options.queue.claimNext(this.options.workerId);
      if (!request) {
        this.state = 'idle';
        return;
      }
      this.currentRequestId = request.id;
      this.state = 'running';
      this.lastError = null;
      await this.writeHeartbeat();
      const processed = await this.processClaimedRequest(request);
      if (processed) {
        await this.options.queue.complete(request.id, this.options.workerId);
        this.lastCompletedAt = this.options.now().toISOString();
      }
    } catch (error) {
      this.lastError = errorMessage(error);
      this.state = 'failed';
      if (request) {
        try {
          await this.options.queue.fail(request.id, this.options.workerId, error);
        } catch (markFailedError) {
          logger.error(
            { err: markFailedError, requestId: request.id },
            'Failed to persist ranking request failure'
          );
        }
      }
      logger.error({ err: error, requestId: request?.id }, 'Ranking request failed');
    } finally {
      this.currentRequestId = null;
      if (!this.stopping && !this.quarantined) {
        this.state = 'idle';
      }
      await this.writeHeartbeat().catch((error) => {
        logger.error({ err: error }, 'Failed to write ranking worker completion heartbeat');
      });
    }
  }

  private async processClaimedRequest(request: RankingRequest): Promise<boolean> {
    const token = this.options.lease.createToken();
    const acquired = await this.options.lease.acquire(token);
    if (!acquired) {
      await this.options.queue.defer(
        request.id,
        this.options.workerId,
        new Date(this.options.now().getTime() + this.options.pollIntervalMs)
      );
      return false;
    }

    let leaseLost: Error | null = null;
    let renewalInProgress = false;
    const renewalTimer = setInterval(() => {
      if (renewalInProgress || leaseLost) {
        return;
      }
      renewalInProgress = true;
      void this.options.lease.renew(token)
        .then((renewed) => {
          if (!renewed) {
            leaseLost = new Error(`Ranking lease ownership lost for request ${request.id}`);
          }
        })
        .catch((error) => {
          leaseLost = error instanceof Error ? error : new Error(String(error));
        })
        .finally(() => {
          renewalInProgress = false;
        });
    }, this.options.leaseRenewIntervalMs);

    let preserveLeaseUntilStop = false;
    try {
      await this.options.runRanking();
      if (leaseLost) {
        this.quarantined = true;
        throw leaseLost;
      }
    } catch (error) {
      if (isScoringPipelineTimeout(error)) {
        this.quarantined = true;
        preserveLeaseUntilStop = true;
        this.quarantinedLease = { token, renewalTimer };
        logger.error(
          { err: error, requestId: request.id },
          'Ranking worker quarantined after pipeline timeout; lease retained until process stop'
        );
      } else if (leaseLost) {
        this.quarantined = true;
      }
      throw error;
    } finally {
      if (!preserveLeaseUntilStop) {
        clearInterval(renewalTimer);
        try {
          const released = await this.options.lease.release(token);
          if (!released && !leaseLost) {
            logger.warn({ requestId: request.id }, 'Ranking lease was no longer owned at release');
          }
        } catch (error) {
          logger.error({ err: error, requestId: request.id }, 'Ranking lease release failed');
        }
      }
    }
    return true;
  }

  private async writeHeartbeat(): Promise<void> {
    const heartbeat: RankingWorkerHeartbeat = {
      schemaVersion: 1,
      workerId: this.options.workerId,
      state: this.state,
      updatedAt: this.options.now().toISOString(),
      currentRequestId: this.currentRequestId,
      lastCompletedAt: this.lastCompletedAt,
      lastError: this.lastError,
    };
    await this.options.redis.set(
      RANKING_WORKER_HEARTBEAT_KEY,
      JSON.stringify(heartbeat),
      'PX',
      this.options.heartbeatTtlMs
    );
  }
}

export async function readRankingWorkerHealth(
  redisClient: RankingWorkerRedis,
  queue: RankingWorkerQueue,
  now: Date,
  heartbeatTtlMs: number
): Promise<RankingWorkerHealth> {
  const [raw, queueStatus] = await Promise.all([
    redisClient.get(RANKING_WORKER_HEARTBEAT_KEY),
    queue.status(),
  ]);
  if (!raw) {
    return { healthy: false, heartbeat: null, ageMs: null, queue: queueStatus };
  }
  const heartbeat = parseHeartbeat(raw);
  const ageMs = now.getTime() - new Date(heartbeat.updatedAt).getTime();
  return {
    healthy: ageMs >= 0 && ageMs <= heartbeatTtlMs && heartbeat.state !== 'failed',
    heartbeat,
    ageMs,
    queue: queueStatus,
  };
}

export function createRankingWorkerId(): string {
  return `${hostname()}:${process.pid}`;
}

function parseHeartbeat(raw: string): RankingWorkerHeartbeat {
  const parsed = JSON.parse(raw) as Partial<RankingWorkerHeartbeat>;
  if (
    parsed.schemaVersion !== 1
    || typeof parsed.workerId !== 'string'
    || !isWorkerState(parsed.state)
    || typeof parsed.updatedAt !== 'string'
    || (parsed.currentRequestId !== null && typeof parsed.currentRequestId !== 'string')
    || (parsed.lastCompletedAt !== null && typeof parsed.lastCompletedAt !== 'string')
    || (parsed.lastError !== null && typeof parsed.lastError !== 'string')
  ) {
    throw new Error('Ranking worker heartbeat payload is invalid');
  }
  if (Number.isNaN(new Date(parsed.updatedAt).getTime())) {
    throw new Error(`Ranking worker heartbeat updatedAt is invalid: ${parsed.updatedAt}`);
  }
  return parsed as RankingWorkerHeartbeat;
}

function isWorkerState(value: unknown): value is RankingWorkerState {
  return value === 'starting'
    || value === 'idle'
    || value === 'running'
    || value === 'stopping'
    || value === 'failed';
}

function assertOptions(options: RankingWorkerOptions): void {
  if (!options.workerId.trim() || !options.communityId.trim()) {
    throw new Error('Ranking workerId and communityId must be non-empty');
  }
  for (const [name, value] of Object.entries({
    scheduleIntervalMs: options.scheduleIntervalMs,
    pollIntervalMs: options.pollIntervalMs,
    leaseRenewIntervalMs: options.leaseRenewIntervalMs,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    heartbeatTtlMs: options.heartbeatTtlMs,
    claimStaleAfterMs: options.claimStaleAfterMs,
  })) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive integer, got ${value}`);
    }
  }
  if (options.heartbeatIntervalMs >= options.heartbeatTtlMs) {
    throw new Error('heartbeatIntervalMs must be less than heartbeatTtlMs');
  }
}

function clearTimer(timer: NodeJS.Timeout | null): void {
  if (timer) {
    clearInterval(timer);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isScoringPipelineTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === 'Scoring pipeline timed out';
}
