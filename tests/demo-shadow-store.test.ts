import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { DemoStoreCorruptionError, RedisDemoStore } from '../src/demo/store.js';
import type { ShadowDemoSessionState } from '../src/demo/types.js';

describe('Redis shadow demo store', () => {
  it('writes the frozen corpus once and stores only a corpus reference in the session', async () => {
    const exists = vi.fn().mockResolvedValue(0);
    const setex = vi.fn().mockResolvedValue('OK');
    const redis = { exists, setex } as unknown as Redis;
    const store = new RedisDemoStore(redis);
    const session = storedSession();

    await store.writeSession(session, 120);

    expect(exists).toHaveBeenCalledWith('demo:corpus:demo-store-corpus');
    expect(setex).toHaveBeenNthCalledWith(
      1,
      'demo:corpus:demo-store-corpus',
      120,
      JSON.stringify(session.corpus)
    );
    const { corpus: _corpus, ...sessionHeader } = session;
    expect(setex).toHaveBeenNthCalledWith(
      2,
      'demo:session:demo-store-session',
      120,
      JSON.stringify(sessionHeader)
    );
  });

  it('reuses an existing corpus blob without rewriting its bytes', async () => {
    const exists = vi.fn().mockResolvedValue(1);
    const expire = vi.fn().mockResolvedValue(1);
    const setex = vi.fn().mockResolvedValue('OK');
    const redis = { exists, expire, setex } as unknown as Redis;
    const store = new RedisDemoStore(redis);

    await store.writeSession(storedSession(), 120);

    expect(expire).toHaveBeenCalledWith('demo:corpus:demo-store-corpus', 120);
    expect(setex).toHaveBeenCalledTimes(1);
    expect(setex).toHaveBeenCalledWith(
      'demo:session:demo-store-session',
      120,
      expect.not.stringContaining('"items"')
    );
  });

  it('returns null only for missing records and raises explicit corruption errors', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('{not-json')
      .mockResolvedValueOnce(JSON.stringify({ sessionId: 'partial' }));
    const store = new RedisDemoStore({ get } as unknown as Redis);

    await expect(store.readSession('missing')).resolves.toBeNull();
    await expect(store.readSession('malformed')).rejects.toBeInstanceOf(DemoStoreCorruptionError);
    await expect(store.readSession('partial')).rejects.toBeInstanceOf(DemoStoreCorruptionError);
  });

  it('surfaces a failed session write without leaving a second corpus key', async () => {
    const exists = vi.fn().mockResolvedValue(1);
    const expire = vi.fn().mockResolvedValue(1);
    const setex = vi.fn().mockRejectedValue(new Error('session write failed'));
    const redis = { exists, expire, setex } as unknown as Redis;
    const store = new RedisDemoStore(redis);

    await expect(store.writeSession(storedSession(), 120)).rejects.toThrow(
      'session write failed'
    );
    expect(setex).toHaveBeenCalledTimes(1);
  });

  it('hydrates a stored session header from its frozen corpus record', async () => {
    const session = storedSession();
    const { corpus, ...sessionHeader } = session;
    const get = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(sessionHeader))
      .mockResolvedValueOnce(JSON.stringify(corpus));
    const store = new RedisDemoStore({ get } as unknown as Redis);

    await expect(store.readSession(session.sessionId)).resolves.toEqual(session);
    expect(get).toHaveBeenNthCalledWith(1, 'demo:session:demo-store-session');
    expect(get).toHaveBeenNthCalledWith(2, 'demo:corpus:demo-store-corpus');
  });

  it('raises explicit corruption when a session references a missing corpus', async () => {
    const session = storedSession();
    const { corpus: _corpus, ...sessionHeader } = session;
    const get = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(sessionHeader))
      .mockResolvedValueOnce(null);
    const store = new RedisDemoStore({ get } as unknown as Redis);

    await expect(store.readSession(session.sessionId)).rejects.toThrow(
      /referenced corpus demo-store-corpus is missing/
    );
  });

  it('rejects malformed nested epochs, votes, and corpus items', async () => {
    const session = storedSession();
    const get = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ ...session, epochs: [{}] }))
      .mockResolvedValueOnce(JSON.stringify({ ...session, votes: [{}] }))
      .mockResolvedValueOnce(JSON.stringify({
        ...session,
        corpus: { ...session.corpus, items: [{}] },
      }));
    const store = new RedisDemoStore({ get } as unknown as Redis);

    await expect(store.readSession('invalid-epoch')).rejects.toBeInstanceOf(DemoStoreCorruptionError);
    await expect(store.readSession('invalid-vote')).rejects.toBeInstanceOf(DemoStoreCorruptionError);
    await expect(store.readSession('invalid-item')).rejects.toBeInstanceOf(DemoStoreCorruptionError);
  });
});

function storedSession(): ShadowDemoSessionState {
  return {
    sessionId: 'demo-store-session',
    communityId: 'open_science_builders',
    seed: 'seed',
    phase: 'created',
    createdAt: '2026-07-10T00:00:00.000Z',
    expiresAt: '2026-07-10T01:30:00.000Z',
    corpusId: 'demo-store-corpus',
    currentEpochId: 'epoch-1',
    epochs: [],
    votes: [],
    corpus: {
      corpusId: 'demo-store-corpus',
      communityId: 'open_science_builders',
      baseProductionEpochId: 2,
      baseWeights: {
        recency: 0.2,
        engagement: 0.2,
        bridging: 0.2,
        source_diversity: 0.2,
        relevance: 0.2,
      },
      baseTopicIntent: { topicWeights: { 'science-research': 0.8 } },
      createdAt: '2026-07-10T00:00:00.000Z',
      expiresAt: '2026-07-10T01:30:00.000Z',
      items: [],
      health: {
        status: 'live',
        source: 'production_scores_appview',
        candidatePosts72h: 100,
        publicScoredPosts: 12,
        uniqueAuthors72h: 50,
        bridgePostShare: 0.2,
        topAuthorConcentration: 0.05,
        sampledAt: '2026-07-10T00:00:00.000Z',
      },
      warnings: [],
    },
    warnings: [],
  };
}
