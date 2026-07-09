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
const eventQueue: Array<(acquired: boolean) => void> = [];
let queueOverflowReconnectInProgress = false;

/** Acquire a slot before processing an event (blocks if at limit). */
function acquireSlot(): Promise<boolean> {
  if (activeEventCount < MAX_CONCURRENT_EVENTS) {
    activeEventCount++;
    return Promise.resolve(true);
  }

  if (eventQueue.length >= MAX_PENDING_EVENTS) {
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    eventQueue.push(resolve);
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
    next(true);
  }
}

function drainQueuedSlots(acquired: boolean): void {
  while (eventQueue.length > 0) {
    const resolve = eventQueue.shift();
    resolve?.(acquired);
  }
}

// Queue saturation metrics
let droppedEventCount = 0;
let metricsIntervalId: NodeJS.Timeout | null = null;

// State
let ws: WebSocket | null = null;
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
let reconnectAttempts = 0;
let consecutiveFailures = 0;
let useFallback = false;
let isShuttingDown = false;
let lastEventReceivedAt: Date | null = null;
let lastDisconnectedAt: Date | null = null;
const eventCountByMinute = new Map<number, number>();

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
  failedCursorPinMutationLock = Promise.resolve();
  lastFailedCursorPinWarningAtMs = 0;
  failedCursorDeadLetterCount = 0;
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
  deleteFailedCursorPinIfCurrent(oldestEventKey, oldestPin);
  logger.warn(
    {
      cursorUs: oldestPin.cursorUs.toString(),
      failedCursorPins: failedCursorPins.size,
      maxFailedCursorPins: FAILED_CURSOR_PIN_MAX_COUNT,
      oldestFailedCursorPinAgeMs: oldestFailedCursorPinAgeMs(nowMs),
      durableRecordWritten: recorded,
    },
    'Dead-lettered oldest Jetstream failed cursor pin after pin limit'
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
      }
      expiredCount += 1;
      oldestExpiredCursorUs ??= failedCursorPin.cursorUs.toString();
      deleteFailedCursorPinIfCurrent(eventKey, failedCursorPin);
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
  const acquired = await acquireSlot();
  if (!acquired) {
    droppedEventCount++;
    onQueueOverflow();
    return {
      acquired: false,
      dropped: true,
      parsed: false,
      processed: false,
      ingestionOutcome: null,
      cursorUs: null,
      cursorSaved: false,
      errorMessage: 'jetstream queue full',
      eventCounter,
      queueState: { active: activeEventCount, queued: eventQueue.length },
    };
  }

  let cursorUs: string | null = null;
  let cursorSaved = false;
  let parsed = false;
  let ingestionOutcome: IngestionEventOutcome | null = null;
  let eventCursorUs: bigint | null = null;
  let eventForFailedCursorPin: JetstreamEvent | null = null;
  let eventFailedCursorPinKey: string | null = null;

  function resolveEventFailedCursorPinKey(): string | null {
    if (eventForFailedCursorPin === null) {
      return null;
    }
    eventFailedCursorPinKey ??= failedCursorPinKey(eventForFailedCursorPin);
    return eventFailedCursorPinKey;
  }

  try {
    const event = parseJetstreamEvent(data);
    parsed = true;
    if (event.time_us) {
      eventCursorUs = BigInt(event.time_us);
      eventForFailedCursorPin = event;
      incrementCursorCount(activeCursorUs, eventCursorUs, effectiveGeneration);
    }
    try {
      ingestionOutcome = await processEvent(event);
      if (
        eventCursorUs !== null &&
        eventForFailedCursorPin !== null &&
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
    const nowMs = Date.now();
    lastEventReceivedAt = new Date(nowMs);
    recordEventAt(nowMs);

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
  queueOverflowReconnectInProgress = false;

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
    const state = { active: activeEventCount, queued: eventQueue.length };
    if (droppedEventCount > 0) {
      logger.warn(
        { droppedEvents: droppedEventCount, ...state },
        `Dropped ${droppedEventCount} events in last 60s (queue full)`
      );
      droppedEventCount = 0;
    } else {
      logger.debug(state, 'Ingestion queue health');
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
  drainQueuedSlots(false);

  // Stop metrics reporting
  if (metricsIntervalId) {
    clearInterval(metricsIntervalId);
    metricsIntervalId = null;
  }

  // Save final cursor
  if (lastCursorUs) {
    await saveCursor(lastCursorUs);
    logger.info({ cursor: lastCursorUs.toString() }, 'Final cursor saved');
  }

  if (ws) {
    ws.close();
    ws = null;
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

  const url = buildUrl(cursor);
  const instanceType = useFallback ? 'fallback' : 'primary';
  const sessionGeneration = beginConnectionGeneration();
  logger.info({ url: url.substring(0, 80) + '...', instanceType }, 'Connecting to Jetstream');

  const socket = new WebSocket(url);
  ws = socket;

  socket.on('open', () => {
    logger.info({ instanceType }, 'Jetstream connection established');
    reconnectAttempts = 0;
    consecutiveFailures = 0;
    queueOverflowReconnectInProgress = false;
    lastDisconnectedAt = null;
  });

  socket.on('message', (data: Buffer) => {
    void processJetstreamMessageData(data, () => {
      if (!isShuttingDown && ws === socket && socket.readyState === WebSocket.OPEN) {
        handleQueueOverload();
      }
    }, sessionGeneration).catch((err: unknown) => {
      logger.error(
        { errName: err instanceof Error ? err.name : 'unknown' },
        'Unhandled Jetstream message error'
      );
    });
  });

  socket.on('close', (code, reason) => {
    if (ws === socket) {
      ws = null;
    }
    lastDisconnectedAt = new Date();
    queueOverflowReconnectInProgress = false;
    if (sessionGeneration === connectionGeneration) {
      invalidateConnectionGeneration();
    }
    drainQueuedSlots(false);
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

function handleQueueOverload(): void {
  if (queueOverflowReconnectInProgress || isShuttingDown) {
    return;
  }
  queueOverflowReconnectInProgress = true;

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
  drainQueuedSlots(false);

  void (async () => {
    if (lastCursorUs) {
      await saveCursor(lastCursorUs);
      logger.warn({ cursor: lastCursorUs.toString() }, 'Saved cursor before overload reconnect');
    }

    if (ws) {
      ws.close(1013, 'event_queue_overflow');
    }
  })();
}

/**
 * Schedule a reconnection with exponential backoff.
 * Switches to fallback instance after FALLBACK_THRESHOLD consecutive failures.
 */
function scheduleReconnect(): void {
  if (isShuttingDown) return;

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

  setTimeout(async () => {
    if (isShuttingDown) return;
    const cursor = await getLastCursor();
    connect(cursor);
  }, delay);
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
  } catch (err) {
    logger.error({ err }, 'Failed to get last cursor');
  }
  return undefined;
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
  drainQueuedSlots(false);

  if (ws) {
    ws.close(1012, 'admin reconnect');
    return;
  }

  void (async () => {
    const cursor = await getLastCursor();
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

  const clearedCount = failedCursorPins.size;
  failedCursorPins.clear();
  logger.warn({ clearedCount, reason }, 'Cleared Jetstream failed cursor pins by operator request');
  return clearedCount;
}

/**
 * Test-only helpers for queue/backpressure behavior.
 */
export const __testJetstreamQueue = {
  maxConcurrentEvents: MAX_CONCURRENT_EVENTS,
  maxPendingEvents: MAX_PENDING_EVENTS,
  cursorSaveInterval: CURSOR_SAVE_INTERVAL,
  failedCursorPinRetryLimit: FAILED_CURSOR_PIN_RETRY_LIMIT,
  failedCursorPinMaxCount: FAILED_CURSOR_PIN_MAX_COUNT,
  failedCursorPinMaxAgeMs: FAILED_CURSOR_PIN_MAX_AGE_MS,
  acquireSlot,
  releaseSlot,
  drainQueuedSlots,
  reset(): void {
    activeEventCount = 0;
    eventQueue.length = 0;
    queueOverflowReconnectInProgress = false;
    droppedEventCount = 0;
    eventCounter = 0;
    lastCursorUs = undefined;
    maxCompletedCursorUs = undefined;
    connectionGeneration = 0;
    activeCursorUs.clear();
    resetFailedCursorPinState();
    lastEventReceivedAt = null;
    lastDisconnectedAt = null;
    eventCountByMinute.clear();
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
  getFailedCursorPinCount(): number {
    return failedCursorPins.size;
  },
  getFailedCursorDeadLetterCount(): number {
    return failedCursorDeadLetterCount;
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
