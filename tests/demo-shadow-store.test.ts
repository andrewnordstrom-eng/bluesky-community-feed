import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { DemoStoreCorruptionError, RedisDemoStore } from '../src/demo/store.js';
import type { ShadowDemoSessionState } from '../src/demo/types.js';

describe('Redis shadow demo store', () => {
  it('writes session and frozen corpus in one Redis transaction', async () => {
    const transaction = {
      setex: vi.fn(),
      exec: vi.fn(async () => [[null, 'OK'], [null, 'OK']]),
    };
    transaction.setex.mockReturnValue(transaction);
    const redis = { multi: vi.fn(() => transaction) } as unknown as Redis;
    const store = new RedisDemoStore(redis);
    const session = storedSession();

    await store.writeSession(session, 120);

    expect(redis.multi).toHaveBeenCalledTimes(1);
    expect(transaction.setex).toHaveBeenCalledTimes(2);
    expect(transaction.setex.mock.calls.map((call) => call[0])).toEqual([
      'demo:session:demo-store-session',
      'demo:corpus:demo-store-corpus',
    ]);
    expect(transaction.exec).toHaveBeenCalledTimes(1);
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

  it('raises when a Redis transaction command fails', async () => {
    const transaction = {
      setex: vi.fn(),
      exec: vi.fn(async () => [[null, 'OK'], [new Error('corpus write failed'), null]]),
    };
    transaction.setex.mockReturnValue(transaction);
    const redis = { multi: vi.fn(() => transaction) } as unknown as Redis;
    const store = new RedisDemoStore(redis);

    await expect(store.writeSession(storedSession(), 120)).rejects.toThrow(
      /Redis transaction failed.*corpus write failed/
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
