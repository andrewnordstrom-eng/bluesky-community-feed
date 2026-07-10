import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { redis } from '../db/redis.js';
import { COMMUNITY_GOV_REDIS_KEYS, type FeedCommunity } from './community-registry.js';

const SNAPSHOT_TTL_SECONDS = 300;
export const CURRENT_FEED_SNAPSHOT_KEY = COMMUNITY_GOV_REDIS_KEYS.currentSnapshot;
const CURRENT_FEED_GENERATION_KEY = COMMUNITY_GOV_REDIS_KEYS.snapshotGeneration;
const SNAPSHOT_KEY_PREFIX = COMMUNITY_GOV_REDIS_KEYS.snapshotPrefix;
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

interface FeedSnapshotSpec {
  sortedSetKey: string;
  currentSnapshotKey: string;
  generationKey: string;
  snapshotKeyPrefix: string;
  maxPosts: number;
}

const CURRENT_FEED_SNAPSHOT_SPEC: FeedSnapshotSpec = {
  sortedSetKey: COMMUNITY_GOV_REDIS_KEYS.current,
  currentSnapshotKey: CURRENT_FEED_SNAPSHOT_KEY,
  generationKey: CURRENT_FEED_GENERATION_KEY,
  snapshotKeyPrefix: SNAPSHOT_KEY_PREFIX,
  maxPosts: config.FEED_MAX_POSTS,
};

let currentSnapshotPromises = new Map<string, Promise<FeedSnapshot | null>>();
let currentMemorySnapshotCache = new Map<string, { expiresAtMs: number; generation: string; snapshot: FeedSnapshot }>();
const byIdMemorySnapshotCache = new Map<string, { expiresAtMs: number; snapshot: FeedSnapshot }>();

function specCacheKey(spec: FeedSnapshotSpec): string {
  return spec.currentSnapshotKey;
}

function snapshotMemoryKey(spec: FeedSnapshotSpec, snapshotId: string): string {
  return `${spec.snapshotKeyPrefix}${snapshotId}`;
}

function snapshotKey(spec: FeedSnapshotSpec, snapshotId: string): string {
  return snapshotMemoryKey(spec, snapshotId);
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

async function readCurrentGeneration(spec: FeedSnapshotSpec): Promise<string> {
  return (await redis.get(spec.generationKey)) ?? '0';
}

async function readCurrentMemorySnapshot(spec: FeedSnapshotSpec): Promise<FeedSnapshot | null> {
  const key = specCacheKey(spec);
  const cached = currentMemorySnapshotCache.get(key);
  if (cached === undefined) {
    return null;
  }
  if (cached.expiresAtMs <= Date.now()) {
    if (currentMemorySnapshotCache.get(key) === cached) {
      currentMemorySnapshotCache.delete(key);
    }
    return null;
  }
  const generation = await readCurrentGeneration(spec);
  if (currentMemorySnapshotCache.get(key) !== cached) {
    return null;
  }
  if (cached.generation !== generation) {
    if (currentMemorySnapshotCache.get(key) === cached) {
      currentMemorySnapshotCache.delete(key);
    }
    return null;
  }
  return cached.snapshot;
}

function readMemorySnapshotById(spec: FeedSnapshotSpec, snapshotId: string): FeedSnapshot | null {
  const memoryKey = snapshotMemoryKey(spec, snapshotId);
  const cached = byIdMemorySnapshotCache.get(memoryKey);
  if (cached === undefined) {
    return null;
  }
  if (cached.expiresAtMs <= Date.now()) {
    byIdMemorySnapshotCache.delete(memoryKey);
    return null;
  }
  byIdMemorySnapshotCache.delete(memoryKey);
  byIdMemorySnapshotCache.set(memoryKey, cached);
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

async function readSnapshotMemoryTtlMs(spec: FeedSnapshotSpec, snapshotId: string): Promise<number | null> {
  const ttlMs = await redis.pttl(snapshotKey(spec, snapshotId));
  if (ttlMs <= 0) {
    return null;
  }
  return Math.min(ttlMs, SNAPSHOT_TTL_SECONDS * 1000);
}

async function writeCurrentMemorySnapshot(
  spec: FeedSnapshotSpec,
  snapshot: FeedSnapshot,
  generation: string
): Promise<FeedSnapshot> {
  const key = specCacheKey(spec);
  const ttlMs = await readSnapshotMemoryTtlMs(spec, snapshot.snapshotId);
  if (ttlMs === null) {
    currentMemorySnapshotCache.delete(key);
    byIdMemorySnapshotCache.delete(snapshotMemoryKey(spec, snapshot.snapshotId));
    return snapshot;
  }
  const nowMs = Date.now();
  currentMemorySnapshotCache.set(key, {
    expiresAtMs: nowMs + ttlMs,
    generation,
    snapshot,
  });
  await writeByIdMemorySnapshot(spec, snapshot, ttlMs);
  return snapshot;
}

async function writeByIdMemorySnapshot(
  spec: FeedSnapshotSpec,
  snapshot: FeedSnapshot,
  knownTtlMs?: number | null
): Promise<FeedSnapshot> {
  const ttlMs = knownTtlMs === undefined ? await readSnapshotMemoryTtlMs(spec, snapshot.snapshotId) : knownTtlMs;
  const memoryKey = snapshotMemoryKey(spec, snapshot.snapshotId);
  const nowMs = Date.now();
  sweepExpiredByIdMemorySnapshots(nowMs);
  if (ttlMs === null) {
    byIdMemorySnapshotCache.delete(memoryKey);
    return snapshot;
  }
  byIdMemorySnapshotCache.delete(memoryKey);
  byIdMemorySnapshotCache.set(memoryKey, {
    expiresAtMs: nowMs + ttlMs,
    snapshot,
  });
  evictOldestByIdMemorySnapshots();
  return snapshot;
}

async function deleteCorruptSnapshot(spec: FeedSnapshotSpec, snapshotId: string): Promise<void> {
  byIdMemorySnapshotCache.delete(snapshotMemoryKey(spec, snapshotId));
  await redis.del(snapshotKey(spec, snapshotId));
  const currentSnapshotId = await redis.get(spec.currentSnapshotKey);
  if (currentSnapshotId === snapshotId) {
    await redis.del(spec.currentSnapshotKey);
    currentMemorySnapshotCache.delete(specCacheKey(spec));
  }
}

async function readCurrentSnapshotFromRedis(spec: FeedSnapshotSpec): Promise<FeedSnapshot | null> {
  const generation = await readCurrentGeneration(spec);
  const snapshotId = await redis.get(spec.currentSnapshotKey);
  if (!snapshotId) {
    return null;
  }

  const snapshotData = await redis.get(snapshotKey(spec, snapshotId));
  if (!snapshotData) {
    await redis.del(spec.currentSnapshotKey);
    return null;
  }

  const snapshot = parseSnapshot(snapshotId, snapshotData);
  if (snapshot === null) {
    await deleteCorruptSnapshot(spec, snapshotId);
    return null;
  }
  return await writeCurrentMemorySnapshot(spec, snapshot, generation);
}

async function createCurrentSnapshot(spec: FeedSnapshotSpec): Promise<FeedSnapshot | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const generation = await readCurrentGeneration(spec);
    const rankedUris = await redis.zrevrange(spec.sortedSetKey, 0, spec.maxPosts - 1);
    if (rankedUris.length === 0) {
      return null;
    }

    const snapshot: FeedSnapshot = {
      snapshotId: randomUUID(),
      uris: rankedUris,
    };
    const serializedSnapshot = JSON.stringify(snapshot.uris);
    const published = await redis.eval(
      PUBLISH_CURRENT_SNAPSHOT_SCRIPT,
      3,
      spec.generationKey,
      spec.currentSnapshotKey,
      snapshotKey(spec, snapshot.snapshotId),
      generation,
      snapshot.snapshotId,
      String(SNAPSHOT_TTL_SECONDS),
      serializedSnapshot
    );
    if (published === 1) {
      return await writeCurrentMemorySnapshot(spec, snapshot, generation);
    }

    const currentSnapshot = await readCurrentSnapshotFromRedis(spec);
    if (currentSnapshot !== null) {
      return currentSnapshot;
    }
  }

  return null;
}

async function getCurrentFeedSnapshotForSpec(spec: FeedSnapshotSpec): Promise<FeedSnapshot | null> {
  const memorySnapshot = await readCurrentMemorySnapshot(spec);
  if (memorySnapshot !== null) {
    return memorySnapshot;
  }

  const redisSnapshot = await readCurrentSnapshotFromRedis(spec);
  if (redisSnapshot !== null) {
    return redisSnapshot;
  }

  const key = specCacheKey(spec);
  const pending = currentSnapshotPromises.get(key);
  if (pending !== undefined) {
    return pending;
  }

  const currentSnapshotPromise = createCurrentSnapshot(spec);
  currentSnapshotPromises.set(key, currentSnapshotPromise);
  try {
    return await currentSnapshotPromise;
  } finally {
    if (currentSnapshotPromises.get(key) === currentSnapshotPromise) {
      currentSnapshotPromises.delete(key);
    }
  }
}

async function getFeedSnapshotByIdForSpec(
  spec: FeedSnapshotSpec,
  snapshotId: string
): Promise<FeedSnapshot | null> {
  const memorySnapshot = readMemorySnapshotById(spec, snapshotId);
  if (memorySnapshot !== null) {
    return memorySnapshot;
  }

  const snapshotData = await redis.get(snapshotKey(spec, snapshotId));
  if (!snapshotData) {
    return null;
  }

  const snapshot = parseSnapshot(snapshotId, snapshotData);
  if (snapshot === null) {
    await deleteCorruptSnapshot(spec, snapshotId);
    return null;
  }
  return await writeByIdMemorySnapshot(spec, snapshot);
}

function feedSnapshotSpecForCommunity(community: FeedCommunity): FeedSnapshotSpec {
  return {
    sortedSetKey: community.redis.current,
    currentSnapshotKey: community.redis.currentSnapshot,
    generationKey: community.redis.snapshotGeneration,
    snapshotKeyPrefix: community.redis.snapshotPrefix,
    maxPosts: config.FEED_MAX_POSTS,
  };
}

export async function getCurrentFeedSnapshot(): Promise<FeedSnapshot | null> {
  return getCurrentFeedSnapshotForSpec(CURRENT_FEED_SNAPSHOT_SPEC);
}

export async function getFeedSnapshotById(snapshotId: string): Promise<FeedSnapshot | null> {
  return getFeedSnapshotByIdForSpec(CURRENT_FEED_SNAPSHOT_SPEC, snapshotId);
}

export async function getCommunityFeedSnapshot(community: FeedCommunity): Promise<FeedSnapshot | null> {
  return getCurrentFeedSnapshotForSpec(feedSnapshotSpecForCommunity(community));
}

export async function getCommunityFeedSnapshotById(
  community: FeedCommunity,
  snapshotId: string
): Promise<FeedSnapshot | null> {
  return getFeedSnapshotByIdForSpec(feedSnapshotSpecForCommunity(community), snapshotId);
}

export function clearCurrentFeedSnapshotMemoryCache(): void {
  currentMemorySnapshotCache.clear();
  byIdMemorySnapshotCache.clear();
  currentSnapshotPromises.clear();
}

function clearCurrentSnapshotPointerMemoryCache(spec: FeedSnapshotSpec): void {
  currentMemorySnapshotCache.delete(specCacheKey(spec));
  currentSnapshotPromises.delete(specCacheKey(spec));
}

async function invalidateFeedSnapshotForSpec(spec: FeedSnapshotSpec): Promise<void> {
  try {
    await redis.eval(
      INVALIDATE_CURRENT_SNAPSHOT_SCRIPT,
      2,
      spec.generationKey,
      spec.currentSnapshotKey
    );
  } finally {
    clearCurrentSnapshotPointerMemoryCache(spec);
  }
}

export async function invalidateCurrentFeedSnapshot(): Promise<void> {
  await invalidateFeedSnapshotForSpec(CURRENT_FEED_SNAPSHOT_SPEC);
}

export async function invalidateCommunityFeedSnapshot(community: FeedCommunity): Promise<void> {
  await invalidateFeedSnapshotForSpec(feedSnapshotSpecForCommunity(community));
}

export const __snapshotCacheKeysForTests = {
  currentSnapshotKey: CURRENT_FEED_SNAPSHOT_KEY,
  currentGenerationKey: CURRENT_FEED_GENERATION_KEY,
  snapshotKeyPrefix: SNAPSHOT_KEY_PREFIX,
};
