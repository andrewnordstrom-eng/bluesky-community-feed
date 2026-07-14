/**
 * Jetstream WebSocket Client
 *
 * Connects to Bluesky's Jetstream service to receive real-time events.
 *
 * Key features:
 * - Cursor persistence every ~1000 events (not every event)
 * - Reconnection WITH cursor to avoid data gaps
 * - Exponential backoff: 1s → 2s → 4s → ... → 60s max
 * - Fallback to secondary instance after 5 consecutive failures
 */

import WebSocket from 'ws';
import { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { processEvent } from './event-processor.js';
import { db } from '../db/client.js';
import { COLLECTIONS, type JetstreamEvent } from './jetstream.types.js';
import type { IngestionEventOutcome } from './outcomes.js';
import { JETSTREAM_FRESHNESS_LIMIT_MS } from './jetstream-health.js';

// Collections we want to receive events for
const WANTED_COLLECTIONS = [
  COLLECTIONS.POST,
  COLLECTIONS.LIKE,
  COLLECTIONS.REPOST,
  COLLECTIONS.FOLLOW,
];

// Configuration
const CURSOR_SAVE_INTERVAL = 1000; // Save cursor every N events
const MAX_RECONNECT_DELAY = 60_000; // 60 seconds max backoff
const FALLBACK_THRESHOLD = 5; // Switch to fallback after N consecutive failures
const MAX_CONCURRENT_EVENTS = config.JETSTREAM_MAX_CONCURRENT;
const MAX_PENDING_EVENTS = config.JETSTREAM_MAX_PENDING;
const PAUSE_RESERVED_HEADROOM = Math.min(
  MAX_PENDING_EVENTS - 1,
  Math.max(MAX_CONCURRENT_EVENTS * 2, 100)
);
const PAUSE_QUEUE_THRESHOLD = Math.max(
  1,
  Math.min(
    MAX_PENDING_EVENTS - PAUSE_RESERVED_HEADROOM,
    Math.max(MAX_CONCURRENT_EVENTS * 5, 100)
  )
);
const RESUME_QUEUE_THRESHOLD = Math.max(0, Math.floor(PAUSE_QUEUE_THRESHOLD / 4));
const FAILED_CURSOR_PIN_RETRY_LIMIT = 3;
const FAILED_CURSOR_PIN_MAX_COUNT = 1000;
const FAILED_CURSOR_PIN_MAX_AGE_MS = 5 * 60_000;
const FAILED_CURSOR_PIN_WARNING_INTERVAL_MS = 60_000;

const JetstreamCommitSchema = z.object({
  rev: z.string().min(1),
  operation: z.enum(['create', 'update', 'delete']),
  collection: z.string().min(1),
  rkey: z.string().min(1),
  record: z.record(z.string(), z.unknown()).optional(),
  cid: z.string().min(1).optional(),
});

const JetstreamEventSchema = z.discriminatedUnion('kind', [
  z.object({
    did: z.string().min(1),
    time_us: z.number().int().positive().safe(),
    kind: z.literal('commit'),
    commit: JetstreamCommitSchema,
  }),
  z.object({
    did: z.string().min(1),
    time_us: z.number().int().positive().safe(),
    kind: z.literal('identity'),
    commit: JetstreamCommitSchema.optional(),
  }),
  z.object({
    did: z.string().min(1),
    time_us: z.number().int().positive().safe(),
    kind: z.literal('account'),
    commit: JetstreamCommitSchema.optional(),
  }),
]);

// Concurrency control — prevents ingestion from starving the DB pool
let activeEventCount = 0;
type SlotAcquireResult = 'acquired' | 'queue-full' | 'cancelled';
const eventQueue: Array<(result: SlotAcquireResult) => void> = [];
const activeDrainWaiters: Array<() => void> = [];
let queueOverflowReconnectInProgress = false;

/** Acquire a slot before processing an event (blocks if at limit). */
function acquireSlot(): Promise<SlotAcquireResult> {
  if (isShuttingDown) {
    return Promise.resolve('cancelled');
  }

  if (activeEventCount < MAX_CONCURRENT_EVENTS) {
    activeEventCount++;
    return Promise.resolve('acquired');
  }

  if (eventQueue.length >= MAX_PENDING_EVENTS) {
    return Promise.resolve('queue-full');
  }

  return new Promise<SlotAcquireResult>((resolve) => {
    eventQueue.push(resolve);
    applyCurrentInboundBackpressure();
  });
}

/** Release a slot after processing, unblocking the next queued event. */
function releaseSlot(): void {
  if (activeEventCount > 0) {
    activeEventCount--;
  }

  const next = eventQueue.shift();
  if (next) {
    activeEventCount++;
    next('acquired');
  }

  if (activeEventCount === 0) {
    while (activeDrainWaiters.length > 0) {
      activeDrainWaiters.shift()?.();
    }
  }

  resumeInboundIfReady();
}

function waitForActiveEventsToDrain(): Promise<void> {
  if (activeEventCount === 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    activeDrainWaiters.push(resolve);
  });
}

function drainQueuedSlots(result: 'acquired' | 'cancelled'): void {
  while (eventQueue.length > 0) {
    const resolve = eventQueue.shift();
    resolve?.(result);
  }
}

// Queue saturation metrics
let droppedEventCount = 0;
let totalDroppedEventCount = 0;
let metricsIntervalId: NodeJS.Timeout | null = null;
let reconnectTimerId: NodeJS.Timeout | null = null;

// State
let ws: WebSocket | null = null;
type InboundFlowControlSocket = Pick<WebSocket, 'readyState' | 'pause' | 'resume' | 'close'>;
let inboundFlowControlSocket: InboundFlowControlSocket | null = null;
let inboundFlowControlGeneration: number | null = null;
let inboundPaused = false;
let inboundPauseCount = 0;
let inboundResumeCount = 0;
let overloadReconnectCount = 0;
let flowControlFailureReconnectCount = 0;
let eventCounter = 0;
let lastCursorUs: bigint | undefined;
let maxCompletedCursorUs: bigint | undefined;
let connectionGeneration = 0;

const HANDLER_ERROR_OUTCOMES = new Set<IngestionEventOutcome>([
  'post-handler-error',
  'like-handler-error',
  'repost-handler-error',
  'follow-handler-error',
  'delete-handler-error',
]);

class JetstreamCursorPersistenceError extends Error {
  constructor(cursorUs: bigint) {
    super(`Failed to persist final Jetstream cursor ${cursorUs.toString()}`);
    this.name = 'JetstreamCursorPersistenceError';
  }
}

function isHandlerErrorOutcome(outcome: IngestionEventOutcome): boolean {
  return HANDLER_ERROR_OUTCOMES.has(outcome);
}

interface CursorGenerationCount {
  generation: number;
  count: number;
}

interface FailedCursorPin {
  cursorUs: bigint;
  generation: number;
  failureCount: number;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
}

type FailedCursorDeadLetterReason = 'retry_limit' | 'pin_limit' | 'age_limit';

const activeCursorUs = new Map<bigint, CursorGenerationCount>();
const failedCursorPins = new Map<string, FailedCursorPin>();
let failedCursorPinMutationLock: Promise<void> = Promise.resolve();
let lastFailedCursorPinWarningAtMs = 0;
let failedCursorDeadLetterCount = 0;
let failedCursorPersistenceFloor: { cursorUs: bigint; generation: number } | null = null;
let reconnectAttempts = 0;
let consecutiveFailures = 0;
let useFallback = false;
let isShuttingDown = false;
let ingestionStartedAt: Date | null = null;
let lastEventReceivedAt: Date | null = null;
let lastDisconnectedAt: Date | null = null;
const eventCountByMinute = new Map<number, number>();
const recordProcessingTails = new Map<string, Promise<void>>();

export interface JetstreamRuntimeState {
  activeEvents: number;
  pendingEvents: number;
  maxConcurrentEvents: number;
  maxPendingEvents: number;
  pauseQueueThreshold: number;
  resumeQueueThreshold: number;
  inboundPaused: boolean;
  pauseCount: number;
  resumeCount: number;
  overloadReconnectCount: number;
  flowControlFailureReconnectCount: number;
  totalDroppedEvents: number;
  failedCursorPersistenceFloorUs: string | null;
  cursorUs: string | null;
  cursorLagMs: number | null;
}

function detachInboundFlowControl(socket: InboundFlowControlSocket | null): void {
  if (socket !== null && inboundFlowControlSocket !== socket) {
    return;
  }
  inboundFlowControlSocket = null;
  inboundFlowControlGeneration = null;
  inboundPaused = false;
}

function pauseInboundIfNeeded(socket: InboundFlowControlSocket, generation: number): void {
  // Socket identity and generation checks prevent stale callbacks from
  // pausing a newer connection after reconnect or future call-site changes.
  if (
    isShuttingDown ||
    inboundPaused ||
    eventQueue.length < PAUSE_QUEUE_THRESHOLD ||
    inboundFlowControlSocket !== socket ||
    inboundFlowControlGeneration !== generation ||
    socket.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  try {
    socket.pause();
    inboundPaused = true;
    inboundPauseCount += 1;
    logger.debug(
      {
        activeEventCount,
        queuedEvents: eventQueue.length,
        pauseQueueThreshold: PAUSE_QUEUE_THRESHOLD,
      },
      'Paused Jetstream inbound delivery for queue backpressure'
    );
  } catch (err) {
    logger.error({ err, queuedEvents: eventQueue.length }, 'Failed to pause Jetstream inbound delivery');
    handleFlowControlFailure(socket, 'backpressure_pause_failed');
  }
}

function applyCurrentInboundBackpressure(): void {
  const socket = inboundFlowControlSocket;
  const generation = inboundFlowControlGeneration;
  if (socket !== null && generation !== null) {
    pauseInboundIfNeeded(socket, generation);
  }
}

function resumeInboundIfReady(): void {
  if (isShuttingDown || !inboundPaused || eventQueue.length > RESUME_QUEUE_THRESHOLD) {
    return;
  }

  const socket = inboundFlowControlSocket;
  if (
    socket === null ||
    inboundFlowControlGeneration !== connectionGeneration ||
    socket.readyState !== WebSocket.OPEN
  ) {
    detachInboundFlowControl(socket);
    return;
  }

  try {
    socket.resume();
    inboundPaused = false;
    inboundResumeCount += 1;
    logger.debug(
      {
        activeEventCount,
        queuedEvents: eventQueue.length,
        resumeQueueThreshold: RESUME_QUEUE_THRESHOLD,
      },
      'Resumed Jetstream inbound delivery after queue drainage'
    );
  } catch (err) {
    logger.error({ err, queuedEvents: eventQueue.length }, 'Failed to resume Jetstream inbound delivery');
    handleFlowControlFailure(socket, 'backpressure_resume_failed');
  }
}

function calculateCursorLagMs(cursorUs: bigint | undefined, nowMs: number): number | null {
  if (cursorUs === undefined) {
    return null;
  }

  const nowUs = BigInt(nowMs) * 1000n;
  if (cursorUs >= nowUs) {
    return 0;
  }

  const lagMs = (nowUs - cursorUs) / 1000n;
  return lagMs > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(lagMs);
}

export interface JetstreamMessageProcessResult {
  acquired: boolean;
  dropped: boolean;
  parsed: boolean;
  processed: boolean;
  ingestionOutcome: IngestionEventOutcome | null;
  cursorUs: string | null;
  cursorSaved: boolean;
  errorMessage: string | null;
  eventCounter: number;
  queueState: {
    active: number;
    queued: number;
  };
}

function currentMinuteBucket(nowMs: number): number {
  return Math.floor(nowMs / 60_000);
}

function pruneOldEventBuckets(latestBucket: number): void {
  for (const bucket of eventCountByMinute.keys()) {
    if (bucket < latestBucket - 10) {
      eventCountByMinute.delete(bucket);
    }
  }
}

function recordEventAt(nowMs: number): void {
  const bucket = currentMinuteBucket(nowMs);
  eventCountByMinute.set(bucket, (eventCountByMinute.get(bucket) || 0) + 1);
  pruneOldEventBuckets(bucket);
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function sanitizeProcessError(error: unknown): { logContext: Record<string, unknown>; errorMessage: string } {
  if (error instanceof SyntaxError) {
    return {
      logContext: { errName: error.name },
      errorMessage: 'invalid Jetstream JSON payload',
    };
  }
  return {
    logContext: { err: error },
    errorMessage: formatErrorMessage(error),
  };
}

function parseJetstreamEvent(data: Buffer): JetstreamEvent {
  const decoded = JSON.parse(data.toString()) as unknown;
  const parsed = JetstreamEventSchema.safeParse(decoded);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid Jetstream event payload: ${detail}`);
  }
  return parsed.data;
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const sortedEntries = Object.entries(value as Record<string, unknown>).sort(([leftKey], [rightKey]) =>
      leftKey.localeCompare(rightKey)
    );
    return `{${sortedEntries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJsonStringify(entryValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function failedCursorPinKey(event: JetstreamEvent): string {
  return stableJsonStringify([
    event.time_us,
    event.kind,
    event.did,
    event.commit?.operation ?? null,
    event.commit?.collection ?? null,
    event.commit?.rkey ?? null,
    event.commit?.rev ?? null,
    event.commit?.cid ?? null,
  ]);
}

function eventOrderingKey(event: JetstreamEvent): string | null {
  if (event.kind !== 'commit' || event.commit === undefined) {
    return null;
  }
  return `${event.did}/${event.commit.collection}/${event.commit.rkey}`;
}

async function processEventInArrivalOrder(event: JetstreamEvent): Promise<IngestionEventOutcome> {
  const orderingKey = eventOrderingKey(event);
  if (orderingKey === null) {
    return processEvent(event);
  }

  const previousTail = recordProcessingTails.get(orderingKey) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const currentTail = previousTail.then(() => current);
  recordProcessingTails.set(orderingKey, currentTail);

  await previousTail;
  try {
    return await processEvent(event);
  } finally {
    releaseCurrent();
    if (recordProcessingTails.get(orderingKey) === currentTail) {
      recordProcessingTails.delete(orderingKey);
    }
  }
}

async function withFailedCursorPinLock<T>(operation: () => Promise<T>): Promise<T> {
  const previousLock = failedCursorPinMutationLock;
  let releaseLock!: () => void;
  failedCursorPinMutationLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  await previousLock;
  try {
    return await operation();
  } finally {
    releaseLock();
  }
}

function deleteFailedCursorPinIfCurrent(eventKey: string, expectedPin: FailedCursorPin): void {
  if (failedCursorPins.get(eventKey) === expectedPin) {
    failedCursorPins.delete(eventKey);
  }
}

function resetFailedCursorPinState(): void {
  failedCursorPins.clear();
  failedCursorPersistenceFloor = null;
  lastFailedCursorPinWarningAtMs = 0;
  failedCursorDeadLetterCount = 0;
}

function preserveFailedCursorSafetyFloor(failedCursorPin: FailedCursorPin): void {
  if (failedCursorPin.generation !== connectionGeneration) {
    return;
  }
  if (
    failedCursorPersistenceFloor === null ||
    failedCursorPersistenceFloor.generation !== failedCursorPin.generation ||
    failedCursorPin.cursorUs < failedCursorPersistenceFloor.cursorUs
  ) {
    failedCursorPersistenceFloor = {
      cursorUs: failedCursorPin.cursorUs,
      generation: failedCursorPin.generation,
    };
  }
}

function beginConnectionGeneration(): number {
  connectionGeneration += 1;
  activeCursorUs.clear();
  resetFailedCursorPinState();
  return connectionGeneration;
}

function invalidateConnectionGeneration(): void {
  connectionGeneration += 1;
  activeCursorUs.clear();
  resetFailedCursorPinState();
}

function incrementCursorCount(
  cursorCounts: Map<bigint, CursorGenerationCount>,
  cursorUs: bigint,
  generation: number
): void {
  const existing = cursorCounts.get(cursorUs);
  if (existing && existing.generation === generation) {
    existing.count += 1;
    return;
  }
  cursorCounts.set(cursorUs, { generation, count: 1 });
}

function registerActiveCursor(cursorUs: bigint, generation: number): void {
  incrementCursorCount(activeCursorUs, cursorUs, generation);
  if (
    generation === connectionGeneration &&
    lastCursorUs !== undefined &&
    cursorUs <= lastCursorUs
  ) {
    lastCursorUs = cursorUs > 1n ? cursorUs - 1n : undefined;
  }
}

function decrementCursorCount(
  cursorCounts: Map<bigint, CursorGenerationCount>,
  cursorUs: bigint,
  generation: number
): void {
  const existing = cursorCounts.get(cursorUs);
  if (!existing || existing.generation !== generation) {
    return;
  }
  if (existing.count <= 1) {
    cursorCounts.delete(cursorUs);
    return;
  }
  existing.count -= 1;
}

function oldestFailedCursorPinAgeMs(nowMs: number): number {
  let oldestSeenAtMs: number | undefined;
  for (const failedCursorPin of failedCursorPins.values()) {
    if (failedCursorPin.generation !== connectionGeneration) {
      continue;
    }
    if (oldestSeenAtMs === undefined || failedCursorPin.firstSeenAtMs < oldestSeenAtMs) {
      oldestSeenAtMs = failedCursorPin.firstSeenAtMs;
    }
  }
  return oldestSeenAtMs === undefined ? 0 : Math.max(nowMs - oldestSeenAtMs, 0);
}

function warnOnFailedCursorPins(reason: string, nowMs: number): void {
  if (nowMs - lastFailedCursorPinWarningAtMs < FAILED_CURSOR_PIN_WARNING_INTERVAL_MS) {
    return;
  }
  lastFailedCursorPinWarningAtMs = nowMs;
  logger.warn(
    {
      reason,
      failedCursorPins: failedCursorPins.size,
      oldestFailedCursorPinAgeMs: oldestFailedCursorPinAgeMs(nowMs),
    },
    'Jetstream failed cursor pins require operator attention'
  );
}

async function recordFailedCursorDeadLetter(
  eventKey: string,
  failedCursorPin: FailedCursorPin,
  reason: FailedCursorDeadLetterReason,
  nowMs: number,
  metadata: Record<string, unknown>
): Promise<boolean> {
  try {
    await db.query(
      `INSERT INTO jetstream_failed_cursor_dead_letters
         (event_key, cursor_us, generation, reason, failure_count, first_seen_at, last_seen_at, metadata)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0), $8::jsonb)`,
      [
        eventKey,
        failedCursorPin.cursorUs.toString(),
        failedCursorPin.generation,
        reason,
        failedCursorPin.failureCount,
        failedCursorPin.firstSeenAtMs,
        failedCursorPin.lastSeenAtMs,
        JSON.stringify({
          ...metadata,
          recordedAtMs: nowMs,
        }),
      ]
    );
    failedCursorDeadLetterCount += 1;
    return true;
  } catch (err) {
    logger.error({ err, reason, cursorUs: failedCursorPin.cursorUs.toString() }, 'Failed to persist Jetstream dead-letter event');
    return false;
  }
}

async function evictOldestFailedCursorPinUnlocked(nowMs: number): Promise<void> {
  let oldestEventKey: string | undefined;
  let oldestPin: FailedCursorPin | undefined;
  for (const [eventKey, failedCursorPin] of failedCursorPins.entries()) {
    if (
      oldestPin === undefined ||
      failedCursorPin.firstSeenAtMs < oldestPin.firstSeenAtMs
    ) {
      oldestEventKey = eventKey;
      oldestPin = failedCursorPin;
    }
  }
  if (oldestEventKey === undefined || oldestPin === undefined) {
    return;
  }
  const recorded = await recordFailedCursorDeadLetter(oldestEventKey, oldestPin, 'pin_limit', nowMs, {
    maxFailedCursorPins: FAILED_CURSOR_PIN_MAX_COUNT,
  });
  if (recorded) {
    deleteFailedCursorPinIfCurrent(oldestEventKey, oldestPin);
  } else {
    preserveFailedCursorSafetyFloor(oldestPin);
    deleteFailedCursorPinIfCurrent(oldestEventKey, oldestPin);
  }
  logger.warn(
    {
      cursorUs: oldestPin.cursorUs.toString(),
      failedCursorPins: failedCursorPins.size,
      maxFailedCursorPins: FAILED_CURSOR_PIN_MAX_COUNT,
      oldestFailedCursorPinAgeMs: oldestFailedCursorPinAgeMs(nowMs),
      durableRecordWritten: recorded,
    },
    'Attempted to dead-letter oldest Jetstream failed cursor pin after pin limit'
  );
}

async function pruneExpiredFailedCursorPins(nowMs: number): Promise<void> {
  await withFailedCursorPinLock(async () => {
    let expiredCount = 0;
    let durableRecordsWritten = 0;
    let oldestExpiredCursorUs: string | undefined;
    for (const [eventKey, failedCursorPin] of failedCursorPins.entries()) {
      if (failedCursorPin.generation !== connectionGeneration) {
        failedCursorPins.delete(eventKey);
        continue;
      }
      if (nowMs - failedCursorPin.firstSeenAtMs < FAILED_CURSOR_PIN_MAX_AGE_MS) {
        continue;
      }
      const recorded = await recordFailedCursorDeadLetter(eventKey, failedCursorPin, 'age_limit', nowMs, {
        maxAgeMs: FAILED_CURSOR_PIN_MAX_AGE_MS,
      });
      if (recorded) {
        durableRecordsWritten += 1;
        deleteFailedCursorPinIfCurrent(eventKey, failedCursorPin);
      } else {
        preserveFailedCursorSafetyFloor(failedCursorPin);
        deleteFailedCursorPinIfCurrent(eventKey, failedCursorPin);
      }
      expiredCount += 1;
      oldestExpiredCursorUs ??= failedCursorPin.cursorUs.toString();
    }
    if (expiredCount === 0) {
      return;
    }
    logger.warn(
      {
        expiredCount,
        failedCursorPins: failedCursorPins.size,
        maxAgeMs: FAILED_CURSOR_PIN_MAX_AGE_MS,
        oldestExpiredCursorUs,
        durableRecordsAttempted: expiredCount,
        durableRecordsWritten,
      },
      'Expired Jetstream failed cursor pins after age limit'
    );
  });
}

async function addFailedCursorPin(eventKey: string, cursorUs: bigint, generation: number): Promise<void> {
  await withFailedCursorPinLock(async () => {
    if (generation !== connectionGeneration) {
      return;
    }
    const nowMs = Date.now();
    const existing = failedCursorPins.get(eventKey);
    if (existing && existing.generation === generation) {
      const failureCount = existing.failureCount + 1;
      if (failureCount >= FAILED_CURSOR_PIN_RETRY_LIMIT) {
        const deadLetterPin = {
          ...existing,
          cursorUs,
          failureCount,
          lastSeenAtMs: nowMs,
        };
        failedCursorPins.set(eventKey, deadLetterPin);
        const recorded = await recordFailedCursorDeadLetter(eventKey, deadLetterPin, 'retry_limit', nowMs, {
          retryLimit: FAILED_CURSOR_PIN_RETRY_LIMIT,
        });
        if (!recorded) {
          return;
        }
        deleteFailedCursorPinIfCurrent(eventKey, deadLetterPin);
        logger.warn(
          {
            cursorUs: cursorUs.toString(),
            failureCount,
            retryLimit: FAILED_CURSOR_PIN_RETRY_LIMIT,
            failedCursorPins: failedCursorPins.size,
            oldestFailedCursorPinAgeMs: oldestFailedCursorPinAgeMs(nowMs),
          },
          'Dead-lettered Jetstream event after repeated handler failures'
        );
        return;
      }
      failedCursorPins.set(eventKey, {
        ...existing,
        cursorUs,
        failureCount,
        lastSeenAtMs: nowMs,
      });
      warnOnFailedCursorPins('repeated_failure', nowMs);
      return;
    }

    failedCursorPins.set(eventKey, {
      cursorUs,
      generation,
      failureCount: 1,
      firstSeenAtMs: nowMs,
      lastSeenAtMs: nowMs,
    });
    while (failedCursorPins.size > FAILED_CURSOR_PIN_MAX_COUNT) {
      const pinCountBeforeEviction = failedCursorPins.size;
      await evictOldestFailedCursorPinUnlocked(nowMs);
      if (failedCursorPins.size === pinCountBeforeEviction) {
        break;
      }
    }
    warnOnFailedCursorPins('pin_added', nowMs);
  });
}

async function removeFailedCursorPin(eventKey: string, generation: number): Promise<void> {
  await withFailedCursorPinLock(async () => {
    if (generation !== connectionGeneration) {
      return;
    }
    const existing = failedCursorPins.get(eventKey);
    if (!existing || existing.generation !== generation) {
      return;
    }
    failedCursorPins.delete(eventKey);
  });
}

async function minimumUnsafeCursorUs(): Promise<bigint | undefined> {
  await pruneExpiredFailedCursorPins(Date.now());
  let minimum: bigint | undefined;
  if (
    failedCursorPersistenceFloor !== null &&
    failedCursorPersistenceFloor.generation === connectionGeneration
  ) {
    minimum = failedCursorPersistenceFloor.cursorUs;
  }
  for (const [cursorUs, cursorCount] of activeCursorUs.entries()) {
    if (cursorCount.generation !== connectionGeneration || cursorCount.count < 1) {
      continue;
    }
    if (minimum === undefined || cursorUs < minimum) {
      minimum = cursorUs;
    }
  }
  for (const failedCursorPin of failedCursorPins.values()) {
    if (failedCursorPin.generation !== connectionGeneration) {
      continue;
    }
    if (minimum === undefined || failedCursorPin.cursorUs < minimum) {
      minimum = failedCursorPin.cursorUs;
    }
  }
  return minimum;
}

async function markCursorCompleted(cursorUs: bigint): Promise<bigint | undefined> {
  if (maxCompletedCursorUs === undefined || cursorUs > maxCompletedCursorUs) {
    maxCompletedCursorUs = cursorUs;
  }

  const minimumUnsafe = await minimumUnsafeCursorUs();
  if (minimumUnsafe !== undefined && maxCompletedCursorUs >= minimumUnsafe) {
    const safeCursorUs = minimumUnsafe - 1n;
    return safeCursorUs > 0n ? safeCursorUs : undefined;
  }
  return maxCompletedCursorUs;
}

async function processJetstreamMessageData(
  data: Buffer,
  onQueueOverflow: () => void,
  messageGeneration: number | null
): Promise<JetstreamMessageProcessResult> {
  const effectiveGeneration = messageGeneration ?? connectionGeneration;
  let parsedEvent: JetstreamEvent | null = null;
  let parseError: unknown = null;
  let parsed = false;
  let eventCursorUs: bigint | null = null;
  try {
    parsedEvent = parseJetstreamEvent(data);
    parsed = true;
    eventCursorUs = BigInt(parsedEvent.time_us);
    registerActiveCursor(eventCursorUs, effectiveGeneration);
  } catch (err) {
    parseError = err;
  }

  const slotResult = await acquireSlot();
  if (slotResult !== 'acquired') {
    if (slotResult === 'cancelled') {
      if (eventCursorUs !== null) {
        decrementCursorCount(activeCursorUs, eventCursorUs, effectiveGeneration);
      }
      return {
        acquired: false,
        dropped: false,
        parsed,
        processed: false,
        ingestionOutcome: null,
        cursorUs: null,
        cursorSaved: false,
        errorMessage: isShuttingDown
          ? 'jetstream shutting down'
          : 'jetstream message cancelled for reconnect',
        eventCounter,
        queueState: { active: activeEventCount, queued: eventQueue.length },
      };
    }
    droppedEventCount++;
    totalDroppedEventCount++;
    onQueueOverflow();
    if (eventCursorUs !== null) {
      decrementCursorCount(activeCursorUs, eventCursorUs, effectiveGeneration);
    }
    return {
      acquired: false,
      dropped: true,
      parsed,
      processed: false,
      ingestionOutcome: null,
      cursorUs: null,
      cursorSaved: false,
      errorMessage: 'jetstream queue full',
      eventCounter,
      queueState: { active: activeEventCount, queued: eventQueue.length },
    };
  }

  if (messageGeneration !== null && effectiveGeneration !== connectionGeneration) {
    if (eventCursorUs !== null) {
      decrementCursorCount(activeCursorUs, eventCursorUs, effectiveGeneration);
    }
    releaseSlot();
    return {
      acquired: true,
      dropped: false,
      parsed,
      processed: false,
      ingestionOutcome: null,
      cursorUs: null,
      cursorSaved: false,
      errorMessage: 'stale jetstream connection',
      eventCounter,
      queueState: { active: activeEventCount, queued: eventQueue.length },
    };
  }

  let cursorUs: string | null = null;
  let cursorSaved = false;
  let ingestionOutcome: IngestionEventOutcome | null = null;
  let eventFailedCursorPinKey: string | null = null;

  function resolveEventFailedCursorPinKey(): string | null {
    if (parsedEvent === null) {
      return null;
    }
    eventFailedCursorPinKey ??= failedCursorPinKey(parsedEvent);
    return eventFailedCursorPinKey;
  }

  try {
    if (parseError !== null) {
      throw parseError;
    }
    if (parsedEvent === null) {
      throw new TypeError('Jetstream event parser returned no event');
    }
    try {
      ingestionOutcome = await processEventInArrivalOrder(parsedEvent);
      if (
        eventCursorUs !== null &&
        effectiveGeneration === connectionGeneration
      ) {
        if (isHandlerErrorOutcome(ingestionOutcome)) {
          const eventKey = resolveEventFailedCursorPinKey();
          if (eventKey !== null) {
            await addFailedCursorPin(eventKey, eventCursorUs, effectiveGeneration);
          }
        } else if (failedCursorPins.size > 0) {
          const eventKey = resolveEventFailedCursorPinKey();
          if (eventKey !== null) {
            await removeFailedCursorPin(eventKey, effectiveGeneration);
          }
        }
      }
    } finally {
      if (eventCursorUs !== null) {
        decrementCursorCount(activeCursorUs, eventCursorUs, effectiveGeneration);
      }
    }

    // Track last event time for health checks
    if (effectiveGeneration === connectionGeneration) {
      const nowMs = Date.now();
      lastEventReceivedAt = new Date(nowMs);
      recordEventAt(nowMs);
    }

    // Track cursor for persistence
    const processedSuccessfully = ingestionOutcome !== null && !isHandlerErrorOutcome(ingestionOutcome);
    if (eventCursorUs !== null && effectiveGeneration === connectionGeneration && processedSuccessfully) {
      lastCursorUs = await markCursorCompleted(eventCursorUs);
      cursorUs = lastCursorUs === undefined ? null : lastCursorUs.toString();
      eventCounter++;

      // Persist cursor every CURSOR_SAVE_INTERVAL events
      if (eventCounter >= CURSOR_SAVE_INTERVAL && lastCursorUs !== undefined) {
        const cursorToSave = lastCursorUs;
        eventCounter = 0;
        cursorSaved = await saveCursor(cursorToSave);
        if (cursorSaved) {
          logger.debug({ cursor: cursorToSave.toString() }, 'Cursor saved');
        } else {
          logger.warn({ cursor: cursorToSave.toString() }, 'Cursor save failed; continuing with interval backoff');
        }
      }
    }

    return {
      acquired: true,
      dropped: false,
      parsed: true,
      processed: processedSuccessfully,
      ingestionOutcome,
      cursorUs,
      cursorSaved,
      errorMessage: processedSuccessfully ? null : ingestionOutcome,
      eventCounter,
      queueState: { active: activeEventCount, queued: eventQueue.length },
    };
  } catch (err) {
    // DO NOT crash on individual event errors. Log and continue.
    if (eventCursorUs !== null) {
      const eventKey = resolveEventFailedCursorPinKey();
      if (eventKey !== null && effectiveGeneration === connectionGeneration) {
        await addFailedCursorPin(eventKey, eventCursorUs, effectiveGeneration);
      }
      cursorUs = lastCursorUs === undefined ? null : lastCursorUs.toString();
    }
    const sanitizedError = sanitizeProcessError(err);
    logger.error(
      { ...sanitizedError.logContext, payloadBytes: data.byteLength },
      'Failed to process Jetstream event'
    );
    return {
      acquired: true,
      dropped: false,
      parsed,
      processed: false,
      ingestionOutcome,
      cursorUs,
      cursorSaved,
      errorMessage: sanitizedError.errorMessage,
      eventCounter,
      queueState: { active: activeEventCount, queued: eventQueue.length },
    };
  } finally {
    releaseSlot();
  }
}

/**
 * Start the Jetstream connection.
 * Loads the last cursor from the database and connects.
 */
export async function startJetstream(): Promise<void> {
  isShuttingDown = false;
  ingestionStartedAt = new Date();
  queueOverflowReconnectInProgress = false;
  clearReconnectTimer();

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    logger.warn('Jetstream start requested while connection already active');
    return;
  }

  if (metricsIntervalId) {
    clearInterval(metricsIntervalId);
    metricsIntervalId = null;
  }

  const cursor = await getLastCursor();
  if (cursor) {
    logger.info({ cursor: cursor.toString() }, 'Resuming from cursor');
  } else {
    logger.info('Starting fresh (no cursor)');
  }
  connect(cursor);

  // Start periodic queue health reporting (every 60s)
  metricsIntervalId = setInterval(() => {
    const runtimeState = getJetstreamRuntimeState();
    if (droppedEventCount > 0) {
      logger.warn(
        { droppedEvents: droppedEventCount, ...runtimeState },
        `Dropped ${droppedEventCount} events in last 60s (queue full)`
      );
      droppedEventCount = 0;
    } else if (
      runtimeState.inboundPaused ||
      (runtimeState.cursorLagMs !== null && runtimeState.cursorLagMs > JETSTREAM_FRESHNESS_LIMIT_MS)
    ) {
      logger.warn(runtimeState, 'Jetstream ingestion is applying backpressure or catching up');
    } else {
      logger.debug(runtimeState, 'Ingestion queue health');
    }
  }, 60_000);
}

/**
 * Stop the Jetstream connection gracefully.
 * Saves the current cursor before closing.
 */
export async function stopJetstream(): Promise<void> {
  isShuttingDown = true;
  queueOverflowReconnectInProgress = false;
  clearReconnectTimer();

  const socket = ws;
  ws = null;
  detachInboundFlowControl(socket);
  if (socket) {
    socket.close();
  }
  drainQueuedSlots('cancelled');

  // Stop metrics reporting
  if (metricsIntervalId) {
    clearInterval(metricsIntervalId);
    metricsIntervalId = null;
  }

  // In-flight handlers may advance the safely completed cursor. Persist only
  // after they finish so shutdown cannot leave acknowledged work behind.
  await waitForActiveEventsToDrain();

  try {
    // Save final cursor
    if (lastCursorUs) {
      const saved = await saveCursor(lastCursorUs);
      if (!saved) {
        throw new JetstreamCursorPersistenceError(lastCursorUs);
      }
      logger.info({ cursor: lastCursorUs.toString() }, 'Final cursor saved');
    }
  } finally {
    ingestionStartedAt = null;
  }
}

/**
 * Build the Jetstream WebSocket URL with collection filters and optional cursor.
 */
function buildUrl(cursor?: bigint): string {
  const base = useFallback ? config.JETSTREAM_FALLBACK_URL : config.JETSTREAM_URL;
  const params = new URLSearchParams();

  // Add collection filters
  for (const col of WANTED_COLLECTIONS) {
    params.append('wantedCollections', col);
  }

  // CRITICAL: If we have a cursor, resume from there to avoid gaps
  if (cursor) {
    params.set('cursor', cursor.toString());
  }

  return `${base}?${params.toString()}`;
}

/**
 * Connect to Jetstream with the given cursor.
 */
function connect(cursor?: bigint): void {
  if (isShuttingDown) return;

  // Reconnects resume from the durable cursor, not any newer in-memory cursor
  // that may not have been persisted before the previous socket closed.
  lastCursorUs = cursor;
  maxCompletedCursorUs = cursor;
  eventCounter = 0;

  const url = buildUrl(cursor);
  const instanceType = useFallback ? 'fallback' : 'primary';
  const sessionGeneration = beginConnectionGeneration();
  logger.info({ url: url.substring(0, 80) + '...', instanceType }, 'Connecting to Jetstream');

  const socket = new WebSocket(url);
  ws = socket;
  inboundFlowControlSocket = socket;
  inboundFlowControlGeneration = sessionGeneration;
  inboundPaused = false;

  socket.on('open', () => {
    logger.info({ instanceType }, 'Jetstream connection established');
    reconnectAttempts = 0;
    consecutiveFailures = 0;
    queueOverflowReconnectInProgress = false;
    lastDisconnectedAt = null;
  });

  socket.on('message', (data: Buffer) => {
    if (isShuttingDown || ws !== socket || sessionGeneration !== connectionGeneration) {
      logger.debug('Ignoring message from stale Jetstream connection');
      return;
    }
    const processingPromise = processJetstreamMessageData(data, () => {
      if (!isShuttingDown && ws === socket && socket.readyState === WebSocket.OPEN) {
        handleQueueOverload(socket, sessionGeneration);
      }
    }, sessionGeneration);
    void processingPromise.catch((err: unknown) => {
      logger.error(
        { errName: err instanceof Error ? err.name : 'unknown' },
        'Unhandled Jetstream message error'
      );
    });
  });

  socket.on('close', (code, reason) => {
    if (ws !== socket) {
      logger.debug(
        { code, reason: reason.toString() },
        'Ignoring close event from stale Jetstream connection'
      );
      return;
    }

    ws = null;
    detachInboundFlowControl(socket);
    lastDisconnectedAt = new Date();
    queueOverflowReconnectInProgress = false;
    if (sessionGeneration === connectionGeneration) {
      invalidateConnectionGeneration();
    }
    drainQueuedSlots('cancelled');
    logger.warn({ code, reason: reason.toString() }, 'Jetstream connection closed');
    if (!isShuttingDown) {
      consecutiveFailures++;
      scheduleReconnect();
    }
  });

  socket.on('error', (err) => {
    logger.error({ err }, 'Jetstream WebSocket error');
    // 'close' event will fire after this, triggering reconnect
  });
}

function handleQueueOverload(overloadedSocket: WebSocket, overloadedGeneration: number): void {
  if (queueOverflowReconnectInProgress || isShuttingDown) {
    return;
  }
  queueOverflowReconnectInProgress = true;
  overloadReconnectCount += 1;

  const queuedEvents = eventQueue.length;
  logger.error(
    {
      queuedEvents,
      maxPendingEvents: MAX_PENDING_EVENTS,
      activeEventCount,
      maxConcurrentEvents: MAX_CONCURRENT_EVENTS,
    },
    'Jetstream ingestion queue saturated; forcing reconnect for recovery'
  );

  // Drop queued-but-not-started handlers; active handlers continue and release naturally.
  drainQueuedSlots('cancelled');

  void (async () => {
    if (lastCursorUs) {
      const saved = await saveCursor(lastCursorUs);
      if (saved) {
        logger.warn({ cursor: lastCursorUs.toString() }, 'Saved cursor before overload reconnect');
      } else {
        logger.error(
          { cursor: lastCursorUs.toString() },
          'Failed to save cursor before overload reconnect; durable cursor replay is required'
        );
      }
    }

    if (
      ws === overloadedSocket &&
      connectionGeneration === overloadedGeneration &&
      (overloadedSocket.readyState === WebSocket.OPEN || overloadedSocket.readyState === WebSocket.CONNECTING)
    ) {
      overloadedSocket.close(1013, 'event_queue_overflow');
    }
  })();
}

function handleFlowControlFailure(
  socket: InboundFlowControlSocket,
  closeReason: 'backpressure_pause_failed' | 'backpressure_resume_failed'
): void {
  if (queueOverflowReconnectInProgress || isShuttingDown) {
    return;
  }
  queueOverflowReconnectInProgress = true;
  flowControlFailureReconnectCount += 1;
  logger.error(
    {
      closeReason,
      queuedEvents: eventQueue.length,
      activeEventCount,
      maxConcurrentEvents: MAX_CONCURRENT_EVENTS,
    },
    'Jetstream flow-control operation failed; forcing reconnect for recovery'
  );
  drainQueuedSlots('cancelled');

  void (async () => {
    if (lastCursorUs) {
      const saved = await saveCursor(lastCursorUs);
      if (!saved) {
        logger.error(
          { cursor: lastCursorUs.toString(), closeReason },
          'Failed to save cursor before flow-control recovery reconnect'
        );
      }
    }
    detachInboundFlowControl(socket);
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(1011, closeReason);
    }
  })();
}

/**
 * Schedule a reconnection with exponential backoff.
 * Switches to fallback instance after FALLBACK_THRESHOLD consecutive failures.
 */
function scheduleReconnect(): void {
  if (isShuttingDown) return;
  if (reconnectTimerId !== null) {
    logger.debug('Jetstream reconnect already scheduled');
    return;
  }

  // Check if we should switch to fallback
  if (consecutiveFailures >= FALLBACK_THRESHOLD && !useFallback) {
    logger.warn(
      { failures: consecutiveFailures },
      'Switching to fallback Jetstream instance'
    );
    useFallback = true;
    consecutiveFailures = 0; // Reset counter for fallback
  }

  // Calculate delay with exponential backoff
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  reconnectAttempts++;

  logger.info({ delay, attempt: reconnectAttempts, useFallback }, 'Scheduling Jetstream reconnect');

  const timerId = setTimeout(async () => {
    if (reconnectTimerId === timerId) {
      reconnectTimerId = null;
    }
    if (isShuttingDown) return;
    const cursor = await getLastCursor();
    if (isShuttingDown || ws !== null) {
      logger.debug('Skipping stale Jetstream reconnect because a connection is already active');
      return;
    }
    connect(cursor);
  }, delay);
  reconnectTimerId = timerId;
}

function clearReconnectTimer(): void {
  if (reconnectTimerId === null) {
    return;
  }
  clearTimeout(reconnectTimerId);
  reconnectTimerId = null;
}

/**
 * Get the last saved cursor from the database.
 */
async function getLastCursor(): Promise<bigint | undefined> {
  try {
    const result = await db.query('SELECT cursor_us FROM jetstream_cursor WHERE id = 1');
    if (result.rows[0]?.cursor_us) {
      return BigInt(result.rows[0].cursor_us);
    }
    if (lastCursorUs !== undefined) {
      logger.warn(
        { cursor: lastCursorUs.toString() },
        'Jetstream cursor row missing; using safely completed in-memory cursor'
      );
    }
  } catch (err) {
    logger.error({ err }, 'Failed to get last cursor');
    if (lastCursorUs !== undefined) {
      logger.warn(
        { cursor: lastCursorUs.toString() },
        'Using safely completed in-memory cursor after cursor read failure'
      );
    }
  }
  return lastCursorUs;
}

/**
 * Save the cursor to the database.
 */
async function saveCursor(cursorUs: bigint): Promise<boolean> {
  try {
    await db.query(
      `INSERT INTO jetstream_cursor (id, cursor_us, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET
         cursor_us = GREATEST(jetstream_cursor.cursor_us, EXCLUDED.cursor_us),
         updated_at = CASE
           WHEN jetstream_cursor.cursor_us < EXCLUDED.cursor_us THEN NOW()
           ELSE jetstream_cursor.updated_at
         END`,
      [cursorUs.toString()]
    );
    await withFailedCursorPinLock(async () => {
      for (const [eventKey, failedCursorPin] of failedCursorPins.entries()) {
        if (failedCursorPin.generation !== connectionGeneration) {
          failedCursorPins.delete(eventKey);
          continue;
        }
        if (failedCursorPin.cursorUs <= cursorUs) {
          failedCursorPins.delete(eventKey);
        }
      }
    });
    return true;
  } catch (err) {
    logger.error({ err }, 'Failed to save cursor');
    return false;
  }
}

/**
 * Check if Jetstream WebSocket is connected.
 */
export function isJetstreamConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

/**
 * Get the timestamp of the last received event.
 */
export function getLastEventReceivedAt(): Date | null {
  return lastEventReceivedAt;
}

/** Get the time ingestion most recently started for bounded freshness checks. */
export function getJetstreamStartedAt(): Date | null {
  return ingestionStartedAt;
}

/**
 * Get bounded-queue, flow-control, and cursor-freshness state for health surfaces.
 */
export function getJetstreamRuntimeState(): JetstreamRuntimeState {
  return {
    activeEvents: activeEventCount,
    pendingEvents: eventQueue.length,
    maxConcurrentEvents: MAX_CONCURRENT_EVENTS,
    maxPendingEvents: MAX_PENDING_EVENTS,
    pauseQueueThreshold: PAUSE_QUEUE_THRESHOLD,
    resumeQueueThreshold: RESUME_QUEUE_THRESHOLD,
    inboundPaused,
    pauseCount: inboundPauseCount,
    resumeCount: inboundResumeCount,
    overloadReconnectCount,
    flowControlFailureReconnectCount,
    totalDroppedEvents: totalDroppedEventCount,
    failedCursorPersistenceFloorUs:
      failedCursorPersistenceFloor?.generation === connectionGeneration
        ? failedCursorPersistenceFloor.cursorUs.toString()
        : null,
    cursorUs: lastCursorUs === undefined ? null : lastCursorUs.toString(),
    cursorLagMs: calculateCursorLagMs(lastCursorUs, Date.now()),
  };
}

/**
 * Get number of events processed in the last 5 minutes.
 */
export function getJetstreamEventsLast5Min(): number {
  const nowBucket = currentMinuteBucket(Date.now());
  pruneOldEventBuckets(nowBucket);

  let total = 0;
  for (let i = 0; i < 5; i++) {
    total += eventCountByMinute.get(nowBucket - i) || 0;
  }
  return total;
}

/**
 * Get timestamp of the most recent disconnect event.
 */
export function getJetstreamDisconnectedAt(): Date | null {
  return lastDisconnectedAt;
}

/**
 * Trigger a reconnect cycle for the Jetstream websocket.
 * Reuses existing reconnect flow so cursor resume and backoff behavior stay consistent.
 */
export function triggerJetstreamReconnect(): void {
  reconnectAttempts = 0;
  consecutiveFailures = 0;
  queueOverflowReconnectInProgress = false;
  clearReconnectTimer();
  drainQueuedSlots('cancelled');

  if (ws) {
    ws.close(1012, 'admin reconnect');
    return;
  }

  void (async () => {
    const cursor = await getLastCursor();
    if (isShuttingDown || ws !== null) {
      return;
    }
    connect(cursor);
  })();
}

/**
 * Operator escape hatch for a known-bad parsed event that keeps pinning cursor persistence.
 * Use only after preserving the failing payload/cursor in external incident evidence.
 */
export function clearJetstreamFailedCursorPins(reason: string): number {
  if (reason.trim().length === 0) {
    throw new RangeError('reason must be a non-empty string when clearing Jetstream failed cursor pins');
  }

  const clearedCount = failedCursorPins.size + (failedCursorPersistenceFloor === null ? 0 : 1);
  failedCursorPins.clear();
  failedCursorPersistenceFloor = null;
  logger.warn({ clearedCount, reason }, 'Cleared Jetstream failed cursor pins by operator request');
  return clearedCount;
}

/**
 * Test-only helpers for queue/backpressure behavior.
 */
export const __testJetstreamQueue = {
  maxConcurrentEvents: MAX_CONCURRENT_EVENTS,
  maxPendingEvents: MAX_PENDING_EVENTS,
  pauseReservedHeadroom: PAUSE_RESERVED_HEADROOM,
  pauseQueueThreshold: PAUSE_QUEUE_THRESHOLD,
  resumeQueueThreshold: RESUME_QUEUE_THRESHOLD,
  cursorSaveInterval: CURSOR_SAVE_INTERVAL,
  failedCursorPinRetryLimit: FAILED_CURSOR_PIN_RETRY_LIMIT,
  failedCursorPinMaxCount: FAILED_CURSOR_PIN_MAX_COUNT,
  failedCursorPinMaxAgeMs: FAILED_CURSOR_PIN_MAX_AGE_MS,
  async acquireSlot(): Promise<boolean> {
    return (await acquireSlot()) === 'acquired';
  },
  releaseSlot,
  drainQueuedSlots(acquired: boolean): void {
    drainQueuedSlots(acquired ? 'acquired' : 'cancelled');
  },
  reset(): void {
    isShuttingDown = true;
    queueOverflowReconnectInProgress = false;
    clearReconnectTimer();
    if (metricsIntervalId) {
      clearInterval(metricsIntervalId);
      metricsIntervalId = null;
    }
    const socket = ws;
    ws = null;
    detachInboundFlowControl(socket);
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close(1000, 'test reset');
    }
    drainQueuedSlots('cancelled');
    activeEventCount = 0;
    while (activeDrainWaiters.length > 0) {
      activeDrainWaiters.shift()?.();
    }
    eventQueue.length = 0;
    droppedEventCount = 0;
    totalDroppedEventCount = 0;
    inboundPauseCount = 0;
    inboundResumeCount = 0;
    overloadReconnectCount = 0;
    flowControlFailureReconnectCount = 0;
    recordProcessingTails.clear();
    detachInboundFlowControl(null);
    eventCounter = 0;
    lastCursorUs = undefined;
    maxCompletedCursorUs = undefined;
    reconnectAttempts = 0;
    consecutiveFailures = 0;
    useFallback = false;
    connectionGeneration = 0;
    activeCursorUs.clear();
    resetFailedCursorPinState();
    ingestionStartedAt = null;
    lastEventReceivedAt = null;
    lastDisconnectedAt = null;
    eventCountByMinute.clear();
    isShuttingDown = false;
  },
  getState(): { active: number; queued: number } {
    return { active: activeEventCount, queued: eventQueue.length };
  },
  getDroppedCount(): number {
    return droppedEventCount;
  },
  resetDroppedCount(): void {
    droppedEventCount = 0;
  },
  setFlowControlSocket(socket: InboundFlowControlSocket | null): void {
    inboundFlowControlSocket = socket;
    inboundFlowControlGeneration = socket === null ? null : connectionGeneration;
    inboundPaused = false;
  },
  applyInboundBackpressure(): void {
    applyCurrentInboundBackpressure();
  },
  setCursorForTests(cursorUs: string | null): void {
    lastCursorUs = cursorUs === null ? undefined : BigInt(cursorUs);
    maxCompletedCursorUs = lastCursorUs;
  },
  getRuntimeState(): JetstreamRuntimeState {
    return getJetstreamRuntimeState();
  },
  getFailedCursorPinCount(): number {
    return failedCursorPins.size;
  },
  getFailedCursorDeadLetterCount(): number {
    return failedCursorDeadLetterCount;
  },
  getFailedCursorPersistenceFloor(): string | null {
    return failedCursorPersistenceFloor?.cursorUs.toString() ?? null;
  },
  triggerQueueOverload(): void {
    if (ws === null) {
      throw new Error('Cannot trigger test queue overload without an active Jetstream socket');
    }
    handleQueueOverload(ws, connectionGeneration);
  },
  processMessage(data: Buffer): Promise<JetstreamMessageProcessResult> {
    return processJetstreamMessageData(data, () => undefined, null);
  },
  processMessageForGeneration(data: Buffer, messageGeneration: number): Promise<JetstreamMessageProcessResult> {
    return processJetstreamMessageData(data, () => undefined, messageGeneration);
  },
  invalidateConnectionForTests(): void {
    invalidateConnectionGeneration();
  },
  getCursorState(): { eventCounter: number; lastCursorUs: string | null } {
    return {
      eventCounter,
      lastCursorUs: lastCursorUs === undefined ? null : lastCursorUs.toString(),
    };
  },
};
