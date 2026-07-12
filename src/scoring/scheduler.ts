/**
 * Durable scoring scheduler and ranking-worker facade.
 *
 * Scheduled and manual work is first persisted in ranking_run_requests. Only
 * the ranking-worker process consumes requests, and every execution requires
 * a token-owned renewable Redis lease.
 */

import { config } from '../config.js';
import { redis } from '../db/redis.js';
import { logger } from '../lib/logger.js';
import { createOwnedScoringLease } from './owned-lease.js';
import {
  manualRequestKey,
  rankingRequestQueue,
  type EnqueuedRankingRequest,
} from './ranking-request-queue.js';
import {
  createRankingWorkerId,
  RankingWorker,
} from './ranking-worker.js';
import { runScoringPipeline } from './pipeline.js';

let worker: RankingWorker | null = null;
let isShuttingDown = false;

export async function startScoring(): Promise<void> {
  if (worker?.isRunning()) {
    logger.warn('Scoring scheduler already running');
    return;
  }
  isShuttingDown = false;
  worker = new RankingWorker({
    queue: rankingRequestQueue,
    lease: createOwnedScoringLease(
      redis,
      config.RANKING_COMMUNITY_ID,
      config.RANKING_LEASE_TTL_MS
    ),
    redis,
    workerId: createRankingWorkerId(),
    communityId: config.RANKING_COMMUNITY_ID,
    scheduleIntervalMs: config.SCORING_INTERVAL_MS,
    pollIntervalMs: config.RANKING_WORKER_POLL_MS,
    leaseRenewIntervalMs: config.RANKING_LEASE_RENEW_INTERVAL_MS,
    heartbeatIntervalMs: config.RANKING_WORKER_HEARTBEAT_INTERVAL_MS,
    heartbeatTtlMs: config.RANKING_WORKER_HEARTBEAT_TTL_MS,
    claimStaleAfterMs: config.RANKING_CLAIM_STALE_MS,
    runRanking: runScoringPipeline,
    now: () => new Date(),
  });
  await worker.start();
}

export async function stopScoring(): Promise<void> {
  isShuttingDown = true;
  if (!worker) {
    return;
  }
  await worker.stop();
  worker = null;
}

export async function enqueueManualScoringRun(
  requestedBy: string,
  requestedAt: Date
): Promise<EnqueuedRankingRequest> {
  if (isShuttingDown) {
    throw new Error('Manual scoring request rejected because ranking is shutting down');
  }
  const idempotencyKey = manualRequestKey(
    config.RANKING_COMMUNITY_ID,
    requestedBy,
    requestedAt
  );
  const request = await rankingRequestQueue.enqueue({
    idempotencyKey,
    communityId: config.RANKING_COMMUNITY_ID,
    requestKind: 'manual',
    requestedBy,
    notBefore: requestedAt,
  });
  logger.info(
    { requestId: request.id, created: request.created, requestedBy },
    'Manual scoring request queued'
  );
  return request;
}

/** Backward-compatible adapter used by governance mutation routes. */
export async function tryTriggerManualScoringRun(): Promise<boolean> {
  try {
    const request = await enqueueManualScoringRun('governance', new Date());
    return request.id.length > 0;
  } catch (error) {
    logger.error({ err: error }, 'Failed to queue governance scoring request');
    return false;
  }
}

export async function triggerManualRun(): Promise<void> {
  await enqueueManualScoringRun('internal', new Date());
}

export function isSchedulerRunning(): boolean {
  return worker?.isRunning() ?? false;
}

export function isScoringInProgress(): boolean {
  return worker?.isRanking() ?? false;
}
