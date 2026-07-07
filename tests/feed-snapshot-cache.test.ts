import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { redisMock } = vi.hoisted(() => ({
  redisMock: {
    get: vi.fn(),
    zrevrange: vi.fn(),
    eval: vi.fn(),
    del: vi.fn(),
    pttl: vi.fn(),
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: redisMock,
}));

import {
  FEED_SNAPSHOT_BY_ID_MEMORY_CACHE_MAX_ENTRIES,
  __snapshotCacheKeysForTests,
  clearCurrentFeedSnapshotMemoryCache,
  getCurrentFeedSnapshot,
  getFeedSnapshotById,
  invalidateCurrentFeedSnapshot,
} from '../src/feed/snapshot-cache.js';

function installStatefulRedisSnapshotMock(initialGeneration: string): {
  setGeneration: (generation: string) => void;
  setCurrentSnapshot: (snapshotId: string, uris: string[]) => void;
} {
  let generation = initialGeneration;
  let currentSnapshotId: string | null = null;
  const snapshots = new Map<string, string>();

  redisMock.get.mockImplementation((key: string) => {
    if (key === __snapshotCacheKeysForTests.currentGenerationKey) {
      return Promise.resolve(generation);
    }
    if (key === __snapshotCacheKeysForTests.currentSnapshotKey) {
      return Promise.resolve(currentSnapshotId);
    }
    if (key.startsWith(__snapshotCacheKeysForTests.snapshotKeyPrefix)) {
      return Promise.resolve(snapshots.get(key) ?? null);
    }
    return Promise.resolve(null);
  });
  redisMock.eval.mockImplementation(
    (
      _script: string,
      keyCount: number,
      _generationKey: string,
      _currentKey: string,
      snapshotKeyArg?: string,
      expectedGeneration?: string,
      snapshotId?: string,
      _ttlSeconds?: string,
      snapshotPayload?: string
    ) => {
      if (keyCount === 2) {
        generation = String(Number(generation) + 1);
        currentSnapshotId = null;
        return Promise.resolve(1);
      }
      if (expectedGeneration !== generation || snapshotKeyArg === undefined || snapshotId === undefined || snapshotPayload === undefined) {
        return Promise.resolve(0);
      }
      snapshots.set(snapshotKeyArg, snapshotPayload);
      currentSnapshotId = snapshotId;
      return Promise.resolve(1);
    }
  );

  return {
    setGeneration: (nextGeneration: string) => {
      generation = nextGeneration;
    },
    setCurrentSnapshot: (snapshotId: string, uris: string[]) => {
      currentSnapshotId = snapshotId;
      snapshots.set(`${__snapshotCacheKeysForTests.snapshotKeyPrefix}${snapshotId}`, JSON.stringify(uris));
    },
  };
}

describe('feed snapshot cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCurrentFeedSnapshotMemoryCache();
    redisMock.pttl.mockResolvedValue(300_000);
  });

  afterEach(() => {
    clearCurrentFeedSnapshotMemoryCache();
  });

  it('retries snapshot creation when a generation conflict leaves no current snapshot', async () => {
    redisMock.get.mockResolvedValue(null);
    redisMock.zrevrange.mockResolvedValue(['at://did:plc:test/app.bsky.feed.post/1']);
    redisMock.eval.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const snapshot = await getCurrentFeedSnapshot();

    expect(snapshot?.uris).toEqual(['at://did:plc:test/app.bsky.feed.post/1']);
    expect(redisMock.zrevrange).toHaveBeenCalledTimes(2);
    expect(redisMock.eval).toHaveBeenCalledTimes(2);
  });

  it('serves a current memory-cache hit only while the generation matches', async () => {
    installStatefulRedisSnapshotMock('1');
    redisMock.zrevrange.mockResolvedValue(['at://did:plc:test/app.bsky.feed.post/1']);

    const firstSnapshot = await getCurrentFeedSnapshot();
    const secondSnapshot = await getCurrentFeedSnapshot();

    expect(firstSnapshot?.snapshotId).toBe(secondSnapshot?.snapshotId);
    expect(secondSnapshot?.uris).toEqual(['at://did:plc:test/app.bsky.feed.post/1']);
    expect(redisMock.zrevrange).toHaveBeenCalledTimes(1);
  });

  it('returns null when current memory cache is invalidated during generation read', async () => {
    const state = installStatefulRedisSnapshotMock('1');
    redisMock.zrevrange.mockResolvedValue([]);
    state.setCurrentSnapshot('snapshot-a', ['at://did:plc:test/app.bsky.feed.post/1']);

    const firstSnapshot = await getCurrentFeedSnapshot();
    expect(firstSnapshot?.snapshotId).toBe('snapshot-a');

    let generationReads = 0;
    let resolveGeneration: ((generation: string) => void) | null = null;
    const pendingGeneration = new Promise<string>((resolve) => {
      resolveGeneration = resolve;
    });
    redisMock.get.mockImplementation((key: string) => {
      if (key === __snapshotCacheKeysForTests.currentGenerationKey) {
        generationReads += 1;
        return generationReads === 1 ? pendingGeneration : Promise.resolve('2');
      }
      if (key === __snapshotCacheKeysForTests.currentSnapshotKey) {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    const staleRead = getCurrentFeedSnapshot();
    await vi.waitFor(() => {
      expect(resolveGeneration).not.toBeNull();
    });
    await invalidateCurrentFeedSnapshot();
    resolveGeneration?.('1');

    await expect(staleRead).resolves.toBeNull();
  });

  it.each([-2, -1])('does not memory-cache current snapshots when Redis PTTL is %i', async (pttlMs) => {
    const state = installStatefulRedisSnapshotMock('1');
    redisMock.pttl.mockResolvedValue(pttlMs);
    state.setCurrentSnapshot('snapshot-a', ['at://did:plc:test/app.bsky.feed.post/1']);

    const firstSnapshot = await getCurrentFeedSnapshot();
    state.setCurrentSnapshot('snapshot-b', ['at://did:plc:test/app.bsky.feed.post/2']);
    const secondSnapshot = await getCurrentFeedSnapshot();

    expect(firstSnapshot).toEqual({
      snapshotId: 'snapshot-a',
      uris: ['at://did:plc:test/app.bsky.feed.post/1'],
    });
    expect(secondSnapshot).toEqual({
      snapshotId: 'snapshot-b',
      uris: ['at://did:plc:test/app.bsky.feed.post/2'],
    });
  });

  it('rejects a stale current memory snapshot after another process bumps generation', async () => {
    const state = installStatefulRedisSnapshotMock('1');
    redisMock.zrevrange.mockResolvedValue(['at://did:plc:test/app.bsky.feed.post/1']);

    const firstSnapshot = await getCurrentFeedSnapshot();
    expect(firstSnapshot?.uris).toEqual(['at://did:plc:test/app.bsky.feed.post/1']);

    state.setGeneration('2');
    state.setCurrentSnapshot('external-snapshot', ['at://did:plc:test/app.bsky.feed.post/2']);

    const secondSnapshot = await getCurrentFeedSnapshot();

    expect(secondSnapshot).toEqual({
      snapshotId: 'external-snapshot',
      uris: ['at://did:plc:test/app.bsky.feed.post/2'],
    });
    expect(redisMock.zrevrange).toHaveBeenCalledTimes(1);
  });

  it('deletes corrupt snapshots and clears the current snapshot pointer when it matches', async () => {
    redisMock.get.mockImplementation((key: string) => {
      if (key === `${__snapshotCacheKeysForTests.snapshotKeyPrefix}bad-snapshot`) {
        return Promise.resolve('{"not":"an array"}');
      }
      if (key === __snapshotCacheKeysForTests.currentSnapshotKey) {
        return Promise.resolve('bad-snapshot');
      }
      return Promise.resolve(null);
    });

    const snapshot = await getFeedSnapshotById('bad-snapshot');

    expect(snapshot).toBeNull();
    expect(redisMock.del).toHaveBeenCalledWith(`${__snapshotCacheKeysForTests.snapshotKeyPrefix}bad-snapshot`);
    expect(redisMock.del).toHaveBeenCalledWith(__snapshotCacheKeysForTests.currentSnapshotKey);
  });

  it('deletes corrupt snapshots without clearing an unrelated current snapshot pointer', async () => {
    redisMock.get.mockImplementation((key: string) => {
      if (key === `${__snapshotCacheKeysForTests.snapshotKeyPrefix}bad-snapshot`) {
        return Promise.resolve('{"not":"an array"}');
      }
      if (key === __snapshotCacheKeysForTests.currentSnapshotKey) {
        return Promise.resolve('current-snapshot');
      }
      return Promise.resolve(null);
    });

    const snapshot = await getFeedSnapshotById('bad-snapshot');

    expect(snapshot).toBeNull();
    expect(redisMock.del).toHaveBeenCalledTimes(1);
    expect(redisMock.del).toHaveBeenCalledWith(`${__snapshotCacheKeysForTests.snapshotKeyPrefix}bad-snapshot`);
  });

  it('serves snapshot-by-id memory hits without re-reading Redis payloads', async () => {
    redisMock.get.mockImplementation((key: string) => {
      if (key === `${__snapshotCacheKeysForTests.snapshotKeyPrefix}target-snapshot`) {
        return Promise.resolve(JSON.stringify(['at://did:plc:test/app.bsky.feed.post/1']));
      }
      return Promise.resolve(null);
    });

    const firstSnapshot = await getFeedSnapshotById('target-snapshot');
    const secondSnapshot = await getFeedSnapshotById('target-snapshot');

    expect(firstSnapshot).toEqual({
      snapshotId: 'target-snapshot',
      uris: ['at://did:plc:test/app.bsky.feed.post/1'],
    });
    expect(secondSnapshot).toEqual(firstSnapshot);
    expect(
      redisMock.get.mock.calls.filter(
        ([key]) => key === `${__snapshotCacheKeysForTests.snapshotKeyPrefix}target-snapshot`
      )
    ).toHaveLength(1);
  });

  it('evicts the oldest by-id memory snapshot when the cache exceeds its cap', async () => {
    redisMock.get.mockImplementation((key: string) => {
      if (key.startsWith(__snapshotCacheKeysForTests.snapshotKeyPrefix)) {
        const snapshotId = key.slice(__snapshotCacheKeysForTests.snapshotKeyPrefix.length);
        return Promise.resolve(JSON.stringify([`at://did:plc:test/app.bsky.feed.post/${snapshotId}`]));
      }
      return Promise.resolve(null);
    });

    for (let index = 0; index <= FEED_SNAPSHOT_BY_ID_MEMORY_CACHE_MAX_ENTRIES; index += 1) {
      const snapshot = await getFeedSnapshotById(`snapshot-${index}`);
      expect(snapshot?.snapshotId).toBe(`snapshot-${index}`);
    }

    redisMock.get.mockClear();
    const evictedSnapshot = await getFeedSnapshotById('snapshot-0');
    const retainedSnapshot = await getFeedSnapshotById(
      `snapshot-${FEED_SNAPSHOT_BY_ID_MEMORY_CACHE_MAX_ENTRIES}`
    );

    expect(evictedSnapshot?.uris).toEqual(['at://did:plc:test/app.bsky.feed.post/snapshot-0']);
    expect(retainedSnapshot?.uris).toEqual([
      `at://did:plc:test/app.bsky.feed.post/snapshot-${FEED_SNAPSHOT_BY_ID_MEMORY_CACHE_MAX_ENTRIES}`,
    ]);
    expect(redisMock.get).toHaveBeenCalledTimes(1);
    expect(redisMock.get).toHaveBeenCalledWith(`${__snapshotCacheKeysForTests.snapshotKeyPrefix}snapshot-0`);
  });

  it('propagates Redis get failures when reading the current snapshot', async () => {
    redisMock.get.mockRejectedValueOnce(new Error('redis generation read failed'));

    await expect(getCurrentFeedSnapshot()).rejects.toThrow('redis generation read failed');
  });

  it('propagates Redis get failures when reading a snapshot by id', async () => {
    redisMock.get.mockRejectedValueOnce(new Error('redis snapshot read failed'));

    await expect(getFeedSnapshotById('target-snapshot')).rejects.toThrow('redis snapshot read failed');
  });

  it('invalidates current snapshot through a single Redis script before clearing memory', async () => {
    redisMock.eval.mockResolvedValueOnce(1);

    await invalidateCurrentFeedSnapshot();

    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call'),
      2,
      __snapshotCacheKeysForTests.currentGenerationKey,
      __snapshotCacheKeysForTests.currentSnapshotKey
    );
    expect(redisMock.del).not.toHaveBeenCalled();
  });

  it('keeps by-id memory snapshots when invalidating only the current pointer', async () => {
    redisMock.get.mockImplementation((key: string) => {
      if (key === `${__snapshotCacheKeysForTests.snapshotKeyPrefix}target-snapshot`) {
        return Promise.resolve(JSON.stringify(['at://did:plc:test/app.bsky.feed.post/1']));
      }
      return Promise.resolve(null);
    });

    const firstSnapshot = await getFeedSnapshotById('target-snapshot');
    redisMock.eval.mockResolvedValueOnce(1);
    await invalidateCurrentFeedSnapshot();
    const secondSnapshot = await getFeedSnapshotById('target-snapshot');

    expect(secondSnapshot).toEqual(firstSnapshot);
    expect(
      redisMock.get.mock.calls.filter(
        ([key]) => key === `${__snapshotCacheKeysForTests.snapshotKeyPrefix}target-snapshot`
      )
    ).toHaveLength(1);
  });

  it('clears memory cache when invalidate script returns zero', async () => {
    const state = installStatefulRedisSnapshotMock('1');
    state.setCurrentSnapshot('snapshot-a', ['at://did:plc:test/app.bsky.feed.post/1']);
    const firstSnapshot = await getCurrentFeedSnapshot();
    expect(firstSnapshot?.snapshotId).toBe('snapshot-a');

    redisMock.eval.mockResolvedValueOnce(0);
    await invalidateCurrentFeedSnapshot();

    state.setCurrentSnapshot('snapshot-b', ['at://did:plc:test/app.bsky.feed.post/2']);
    const secondSnapshot = await getCurrentFeedSnapshot();
    expect(secondSnapshot).toEqual({
      snapshotId: 'snapshot-b',
      uris: ['at://did:plc:test/app.bsky.feed.post/2'],
    });
  });

  it('clears memory cache even when invalidate script rejects', async () => {
    const state = installStatefulRedisSnapshotMock('1');
    state.setCurrentSnapshot('snapshot-a', ['at://did:plc:test/app.bsky.feed.post/1']);
    const firstSnapshot = await getCurrentFeedSnapshot();
    expect(firstSnapshot?.snapshotId).toBe('snapshot-a');

    redisMock.eval.mockRejectedValueOnce(new Error('redis invalidate failed'));
    await expect(invalidateCurrentFeedSnapshot()).rejects.toThrow('redis invalidate failed');

    state.setCurrentSnapshot('snapshot-b', ['at://did:plc:test/app.bsky.feed.post/2']);
    const secondSnapshot = await getCurrentFeedSnapshot();
    expect(secondSnapshot).toEqual({
      snapshotId: 'snapshot-b',
      uris: ['at://did:plc:test/app.bsky.feed.post/2'],
    });
  });
});
