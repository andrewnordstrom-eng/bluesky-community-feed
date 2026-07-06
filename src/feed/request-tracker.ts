import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const MAX_IN_FLIGHT_LIMIT = 64;
const DB_POOL_HEADROOM = 5;
export const FEED_REQUEST_TRACKER_MAX_IN_FLIGHT = Math.max(
  1,
  Math.min(MAX_IN_FLIGHT_LIMIT, config.DB_POOL_MAX - DB_POOL_HEADROOM)
);
const MAX_QUEUED = 20_000;
const SCHEDULE_DELAY_MS = 0;
const DROP_WARNING_INTERVAL_MS = 60_000;
const TASK_WARNING_INTERVAL_MS = 60_000;
export const FEED_REQUEST_TRACKER_TASK_TIMEOUT_MS = 30_000;
let taskTimeoutMs = FEED_REQUEST_TRACKER_TASK_TIMEOUT_MS;

type TrackingTask = (signal: AbortSignal) => Promise<void>;

class FeedRequestTrackingTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Feed request tracking task timed out after ${timeoutMs}ms`);
    this.name = 'FeedRequestTrackingTimeoutError';
  }
}

export interface FeedRequestTrackerStats {
  queued: number;
  inFlight: number;
  enqueued: number;
  completed: number;
  failed: number;
  timedOut: number;
  dropped: number;
  maxQueuedObserved: number;
  maxInFlightObserved: number;
}

interface DrainWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

const queue: TrackingTask[] = [];
let queueHead = 0;
const drainWaiters: DrainWaiter[] = [];
const stats: FeedRequestTrackerStats = {
  queued: 0,
  inFlight: 0,
  enqueued: 0,
  completed: 0,
  failed: 0,
  timedOut: 0,
  dropped: 0,
  maxQueuedObserved: 0,
  maxInFlightObserved: 0,
};

let scheduled = false;
let dropWarningArmed = true;
let lastDropWarningAtMs = 0;
let timeoutWarningArmed = true;
let lastTimeoutWarningAtMs = 0;
let failureWarningArmed = true;
let lastFailureWarningAtMs = 0;

function queuedLength(): number {
  return queue.length - queueHead;
}

function compactQueueIfNeeded(): void {
  if (queueHead === 0) {
    return;
  }

  if (queueHead === queue.length) {
    queue.length = 0;
    queueHead = 0;
    return;
  }

  if (queueHead < 1024 || queueHead * 2 < queue.length) {
    return;
  }

  queue.splice(0, queueHead);
  queueHead = 0;
}

function snapshotStats(): FeedRequestTrackerStats {
  return {
    queued: stats.queued,
    inFlight: stats.inFlight,
    enqueued: stats.enqueued,
    completed: stats.completed,
    failed: stats.failed,
    timedOut: stats.timedOut,
    dropped: stats.dropped,
    maxQueuedObserved: stats.maxQueuedObserved,
    maxInFlightObserved: stats.maxInFlightObserved,
  };
}

function updateDepthStats(): void {
  stats.queued = queuedLength();
  stats.maxQueuedObserved = Math.max(stats.maxQueuedObserved, stats.queued);
  stats.maxInFlightObserved = Math.max(stats.maxInFlightObserved, stats.inFlight);
}

function resolveDrainWaitersIfIdle(): void {
  if (queuedLength() > 0 || stats.inFlight > 0) {
    return;
  }

  const waiters = drainWaiters.splice(0, drainWaiters.length);
  for (const waiter of waiters) {
    clearTimeout(waiter.timeout);
    waiter.resolve();
  }
}

function runTask(task: TrackingTask): void {
  stats.inFlight += 1;
  updateDepthStats();
  const abortController = new AbortController();
  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new FeedRequestTrackingTimeoutError(taskTimeoutMs);
      reject(error);
      abortController.abort(error);
    }, taskTimeoutMs);
  });

  void Promise.resolve()
    .then(() => Promise.race([task(abortController.signal), timeoutPromise]))
    .then(() => {
      stats.completed += 1;
      timeoutWarningArmed = true;
      failureWarningArmed = true;
    })
    .catch((error: unknown) => {
      if (error instanceof FeedRequestTrackingTimeoutError) {
        stats.timedOut += 1;
        maybeWarnOnTaskError(error, 'timeout');
      } else {
        stats.failed += 1;
        maybeWarnOnTaskError(error, 'failure');
      }
    })
    .finally(() => {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
      stats.inFlight -= 1;
      updateDepthStats();
      drainQueue();
      resolveDrainWaitersIfIdle();
    });
}

function drainQueue(): void {
  scheduled = false;

  while (stats.inFlight < FEED_REQUEST_TRACKER_MAX_IN_FLIGHT && queuedLength() > 0) {
    const task = queue[queueHead];
    queueHead += 1;
    compactQueueIfNeeded();
    if (task === undefined) {
      break;
    }
    updateDepthStats();
    runTask(task);
  }

  resolveDrainWaitersIfIdle();
}

function scheduleDrain(): void {
  if (scheduled) {
    return;
  }

  scheduled = true;
  setTimeout(drainQueue, SCHEDULE_DELAY_MS);
}

function maybeWarnOnDrop(): void {
  const nowMs = Date.now();
  if (!dropWarningArmed && nowMs - lastDropWarningAtMs < DROP_WARNING_INTERVAL_MS) {
    return;
  }

  dropWarningArmed = false;
  lastDropWarningAtMs = nowMs;
  logger.warn(
    {
      queued: queuedLength(),
      dropped: stats.dropped,
    },
    'Feed request tracking queue is saturated; dropping tracking task'
  );
}

function maybeWarnOnTaskError(error: unknown, warningKind: 'timeout' | 'failure'): void {
  const nowMs = Date.now();
  if (warningKind === 'timeout') {
    if (!timeoutWarningArmed && nowMs - lastTimeoutWarningAtMs < TASK_WARNING_INTERVAL_MS) {
      return;
    }
    timeoutWarningArmed = false;
    lastTimeoutWarningAtMs = nowMs;
    logger.warn({ err: error, timedOut: stats.timedOut }, 'Feed request tracking task timed out');
    return;
  }

  if (!failureWarningArmed && nowMs - lastFailureWarningAtMs < TASK_WARNING_INTERVAL_MS) {
    return;
  }
  failureWarningArmed = false;
  lastFailureWarningAtMs = nowMs;
  logger.warn({ err: error, failed: stats.failed }, 'Feed request tracking task failed');
}

export function enqueueFeedRequestTracking(task: TrackingTask): boolean {
  if (queuedLength() >= MAX_QUEUED) {
    stats.dropped += 1;
    updateDepthStats();
    maybeWarnOnDrop();
    return false;
  }

  queue.push(task);
  stats.enqueued += 1;
  updateDepthStats();
  scheduleDrain();
  return true;
}

export function getFeedRequestTrackerStats(): FeedRequestTrackerStats {
  return snapshotStats();
}

export async function drainFeedRequestTracker(timeoutMs: number): Promise<FeedRequestTrackerStats> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError(`timeoutMs must be a positive integer; received ${timeoutMs}`);
  }

  if (queuedLength() === 0 && stats.inFlight === 0) {
    return snapshotStats();
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const waiterIndex = drainWaiters.findIndex((waiter) => waiter.timeout === timeout);
      if (waiterIndex !== -1) {
        drainWaiters.splice(waiterIndex, 1);
      }
      reject(new Error(`feed request tracker did not drain within ${timeoutMs}ms: ${JSON.stringify(snapshotStats())}`));
    }, timeoutMs);
    drainWaiters.push({ resolve, reject, timeout });
    scheduleDrain();
  });

  return snapshotStats();
}

export function __resetFeedRequestTrackerForTests(): void {
  if (queuedLength() > 0 || stats.inFlight > 0) {
    throw new Error(`cannot reset active feed request tracker: ${JSON.stringify(snapshotStats())}`);
  }

  queue.length = 0;
  queueHead = 0;
  stats.queued = 0;
  stats.inFlight = 0;
  stats.enqueued = 0;
  stats.completed = 0;
  stats.failed = 0;
  stats.timedOut = 0;
  stats.dropped = 0;
  stats.maxQueuedObserved = 0;
  stats.maxInFlightObserved = 0;
  taskTimeoutMs = FEED_REQUEST_TRACKER_TASK_TIMEOUT_MS;
  scheduled = false;
  dropWarningArmed = true;
  lastDropWarningAtMs = 0;
  timeoutWarningArmed = true;
  lastTimeoutWarningAtMs = 0;
  failureWarningArmed = true;
  lastFailureWarningAtMs = 0;
}

export function __setFeedRequestTrackerTaskTimeoutForTests(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError(`timeoutMs must be a positive integer; received ${timeoutMs}`);
  }
  taskTimeoutMs = timeoutMs;
}
