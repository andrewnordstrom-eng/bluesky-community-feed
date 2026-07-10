import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { redis } from '../db/redis.js';
import { logger } from '../lib/logger.js';

const SNAPSHOT_TTL_SECONDS = 300;
const FEED_CURRENT_KEY = 'feed:current';
const FEED_LAST_KNOWN_GOOD_KEY = 'feed:last_known_good';
const FEED_LAST_KNOWN_GOOD_FALLBACK_TOTAL_KEY = 'feed:last_known_good_fallback_total';
export const CURRENT_FEED_SNAPSHOT_KEY = 'feed:current_snapshot_id';
const CURRENT_FEED_GENERATION_KEY = 'feed:current_snapshot_generation';
const SNAPSHOT_KEY_PREFIX = 'snapshot:';
export const FEED_SNAPSHOT_BY_ID_MEMORY_CACHE_MAX_ENTRIES = 1_000;
const PUBLISH_CURRENT_SNAPSHOT_SCRIPT = `
local generationKey = KEYS[1]
local currentKey = KEYS[2]
local snapshotKey = KEYS[3]
local expectedGeneration = ARGV[1]
local snapshotId = ARGV[2]
local ttlSeconds = tonumber(ARGV[3])
local snapshotPayload = ARGV[4]
local actualGeneration = redis.call('GET', generationKey) or '0'
if actualGeneration ~= expectedGeneration then
  return 0
end
redis.call('SETEX', snapshotKey, ttlSeconds, snapshotPayload)
redis.call('SETEX', currentKey, ttlSeconds, snapshotId)
return 1
`;
const INVALIDATE_CURRENT_SNAPSHOT_SCRIPT = `
local generationKey = KEYS[1]
local currentKey = KEYS[2]
redis.call('INCR', generationKey)
redis.call('DEL', currentKey)
return 1
`;

export interface FeedSnapshot {
  snapshotId: string;
  uris: string[];
}

let currentSnapshotPromise: Promise<FeedSnapshot | null> | null = null;
let currentMemorySnapshotCache: { expiresAtMs: number; generation: string; snapshot: FeedSnapshot } | null = null;
const byIdMemorySnapshotCache = new Map<string, { expiresAtMs: number; snapshot: FeedSnapshot }>();

function snapshotKey(snapshotId: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${snapshotId}`;
}

function parseSnapshot(snapshotId: string, snapshotData: string): FeedSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshotData) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
    return null;
  }
  return {
    snapshotId,
    uris: parsed,
  };
}

async function readCurrentGeneration(): Promise<string> {
  return (await redis.get(CURRENT_FEED_GENERATION_KEY)) ?? '0';
}

async function readCurrentMemorySnapshot(): Promise<FeedSnapshot | null> {
  const cached = currentMemorySnapshotCache;
  if (cached === null) {
    return null;
  }
  if (cached.expiresAtMs <= Date.now()) {
    if (currentMemorySnapshotCache === cached) {
      currentMemorySnapshotCache = null;
    }
    return null;
  }
  const generation = await readCurrentGeneration();
  if (currentMemorySnapshotCache !== cached) {
    return null;
  }
  if (cached.generation !== generation) {
    if (currentMemorySnapshotCache === cached) {
      currentMemorySnapshotCache = null;
    }
    return null;
  }
  return cached.snapshot;
}

function readMemorySnapshotById(snapshotId: string): FeedSnapshot | null {
  const cached = byIdMemorySnapshotCache.get(snapshotId);
  if (cached === undefined) {
    return null;
  }
  if (cached.expiresAtMs <= Date.now()) {
    byIdMemorySnapshotCache.delete(snapshotId);
    return null;
  }
  byIdMemorySnapshotCache.delete(snapshotId);
  byIdMemorySnapshotCache.set(snapshotId, cached);
  return cached.snapshot;
}

function sweepExpiredByIdMemorySnapshots(nowMs: number): void {
  for (const [snapshotId, cached] of byIdMemorySnapshotCache.entries()) {
    if (cached.expiresAtMs <= nowMs) {
      byIdMemorySnapshotCache.delete(snapshotId);
    }
  }
}

function evictOldestByIdMemorySnapshots(): void {
  while (byIdMemorySnapshotCache.size > FEED_SNAPSHOT_BY_ID_MEMORY_CACHE_MAX_ENTRIES) {
    const oldestSnapshotId = byIdMemorySnapshotCache.keys().next().value;
    if (oldestSnapshotId === undefined) {
      return;
    }
    byIdMemorySnapshotCache.delete(oldestSnapshotId);
  }
}

async function readSnapshotMemoryTtlMs(snapshotId: string): Promise<number | null> {
  const ttlMs = await redis.pttl(snapshotKey(snapshotId));
  if (ttlMs <= 0) {
    return null;
  }
  return Math.min(ttlMs, SNAPSHOT_TTL_SECONDS * 1000);
}

async function writeCurrentMemorySnapshot(snapshot: FeedSnapshot, generation: string): Promise<FeedSnapshot> {
  const ttlMs = await readSnapshotMemoryTtlMs(snapshot.snapshotId);
  if (ttlMs === null) {
    currentMemorySnapshotCache = null;
    byIdMemorySnapshotCache.delete(snapshot.snapshotId);
    return snapshot;
  }
  const nowMs = Date.now();
  currentMemorySnapshotCache = {
    expiresAtMs: nowMs + ttlMs,
    generation,
    snapshot,
  };
  await writeByIdMemorySnapshot(snapshot, ttlMs);
  return snapshot;
}

async function writeByIdMemorySnapshot(snapshot: FeedSnapshot, knownTtlMs?: number | null): Promise<FeedSnapshot> {
  const ttlMs = knownTtlMs === undefined ? await readSnapshotMemoryTtlMs(snapshot.snapshotId) : knownTtlMs;
  const nowMs = Date.now();
  sweepExpiredByIdMemorySnapshots(nowMs);
  if (ttlMs === null) {
    byIdMemorySnapshotCache.delete(snapshot.snapshotId);
    return snapshot;
  }
  byIdMemorySnapshotCache.delete(snapshot.snapshotId);
  byIdMemorySnapshotCache.set(snapshot.snapshotId, {
    expiresAtMs: nowMs + ttlMs,
    snapshot,
  });
  evictOldestByIdMemorySnapshots();
  return snapshot;
}

async function deleteCorruptSnapshot(snapshotId: string): Promise<void> {
  byIdMemorySnapshotCache.delete(snapshotId);
  await redis.del(snapshotKey(snapshotId));
  const currentSnapshotId = await redis.get(CURRENT_FEED_SNAPSHOT_KEY);
  if (currentSnapshotId === snapshotId) {
    await redis.del(CURRENT_FEED_SNAPSHOT_KEY);
    currentMemorySnapshotCache = null;
  }
}

async function readCurrentSnapshotFromRedis(): Promise<FeedSnapshot | null> {
  const generation = await readCurrentGeneration();
  const snapshotId = await redis.get(CURRENT_FEED_SNAPSHOT_KEY);
  if (!snapshotId) {
    return null;
  }

  const snapshotData = await redis.get(snapshotKey(snapshotId));
  if (!snapshotData) {
    await redis.del(CURRENT_FEED_SNAPSHOT_KEY);
    return null;
  }

  const snapshot = parseSnapshot(snapshotId, snapshotData);
  if (snapshot === null) {
    await deleteCorruptSnapshot(snapshotId);
    return null;
  }
  return await writeCurrentMemorySnapshot(snapshot, generation);
}

async function createCurrentSnapshot(): Promise<FeedSnapshot | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const generation = await readCurrentGeneration();
    let usedLastKnownGood = false;
    let rankedUris = await redis.zrevrange(FEED_CURRENT_KEY, 0, config.FEED_MAX_POSTS - 1);
    if (rankedUris.length === 0) {
      rankedUris = await redis.zrevrange(
        FEED_LAST_KNOWN_GOOD_KEY,
        0,
        config.FEED_MAX_POSTS - 1
      );
      if (rankedUris.length === 0) {
        return null;
      }
      usedLastKnownGood = true;

      logger.warn(
        { fallbackCount: rankedUris.length },
        'Current feed is empty; creating snapshot from last-known-good feed'
      );
    }

    const snapshot: FeedSnapshot = {
      snapshotId: randomUUID(),
      uris: rankedUris,
    };
    const serializedSnapshot = JSON.stringify(snapshot.uris);
    const published = await redis.eval(
      PUBLISH_CURRENT_SNAPSHOT_SCRIPT,
      3,
      CURRENT_FEED_GENERATION_KEY,
      CURRENT_FEED_SNAPSHOT_KEY,
      snapshotKey(snapshot.snapshotId),
      generation,
      snapshot.snapshotId,
      String(SNAPSHOT_TTL_SECONDS),
      serializedSnapshot
    );
    if (published === 1) {
      if (usedLastKnownGood) {
        void redis.incr(FEED_LAST_KNOWN_GOOD_FALLBACK_TOTAL_KEY).catch((error) => {
          logger.warn({ error }, 'Failed to record last-known-good feed fallback metric');
        });
      }
      return await writeCurrentMemorySnapshot(snapshot, generation);
    }

    const currentSnapshot = await readCurrentSnapshotFromRedis();
    if (currentSnapshot !== null) {
      return currentSnapshot;
    }
  }

  return null;
}

async function loadCurrentFeedSnapshot(): Promise<FeedSnapshot | null> {
  const memorySnapshot = await readCurrentMemorySnapshot();
  if (memorySnapshot !== null) {
    return memorySnapshot;
  }

  const redisSnapshot = await readCurrentSnapshotFromRedis();
  if (redisSnapshot !== null) {
    return redisSnapshot;
  }

  return await createCurrentSnapshot();
}

export async function getCurrentFeedSnapshot(): Promise<FeedSnapshot | null> {
  if (currentSnapshotPromise !== null) {
    return currentSnapshotPromise;
  }

  const snapshotPromise = loadCurrentFeedSnapshot();
  currentSnapshotPromise = snapshotPromise;
  try {
    return await snapshotPromise;
  } finally {
    if (currentSnapshotPromise === snapshotPromise) {
      currentSnapshotPromise = null;
    }
  }
}

export async function getFeedSnapshotById(snapshotId: string): Promise<FeedSnapshot | null> {
  const memorySnapshot = readMemorySnapshotById(snapshotId);
  if (memorySnapshot !== null) {
    return memorySnapshot;
  }

  const snapshotData = await redis.get(snapshotKey(snapshotId));
  if (!snapshotData) {
    return null;
  }

  const snapshot = parseSnapshot(snapshotId, snapshotData);
  if (snapshot === null) {
    await deleteCorruptSnapshot(snapshotId);
    return null;
  }
  return await writeByIdMemorySnapshot(snapshot);
}

export function clearCurrentFeedSnapshotMemoryCache(): void {
  currentMemorySnapshotCache = null;
  byIdMemorySnapshotCache.clear();
  currentSnapshotPromise = null;
}

function clearCurrentSnapshotPointerMemoryCache(): void {
  currentMemorySnapshotCache = null;
  currentSnapshotPromise = null;
}

export async function invalidateCurrentFeedSnapshot(): Promise<void> {
  try {
    await redis.eval(
      INVALIDATE_CURRENT_SNAPSHOT_SCRIPT,
      2,
      CURRENT_FEED_GENERATION_KEY,
      CURRENT_FEED_SNAPSHOT_KEY
    );
  } finally {
    clearCurrentSnapshotPointerMemoryCache();
  }
}

export const __snapshotCacheKeysForTests = {
  currentFeedKey: FEED_CURRENT_KEY,
  lastKnownGoodFeedKey: FEED_LAST_KNOWN_GOOD_KEY,
  lastKnownGoodFallbackTotalKey: FEED_LAST_KNOWN_GOOD_FALLBACK_TOTAL_KEY,
  currentSnapshotKey: CURRENT_FEED_SNAPSHOT_KEY,
  currentGenerationKey: CURRENT_FEED_GENERATION_KEY,
  snapshotKeyPrefix: SNAPSHOT_KEY_PREFIX,
};
