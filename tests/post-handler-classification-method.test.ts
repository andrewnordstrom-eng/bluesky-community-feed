/**
 * Post Handler Classification Method Tests
 *
 * Verifies that the post handler correctly stores classification_method
 * in the posts table based on whether keyword or embedding classification
 * produced the final topic_vector.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (vi.hoisted runs before imports) ---
const {
  dbQueryMock,
  redisGetMock,
  redisSetMock,
  classifyPostMock,
  checkGovernanceGateMock,
  isGovernanceGateReadyMock,
  classifyPostByEmbeddingMock,
  isEmbedderReadyMock,
  configMock,
} = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  redisGetMock: vi.fn(),
  redisSetMock: vi.fn(),
  classifyPostMock: vi.fn(),
  checkGovernanceGateMock: vi.fn(),
  isGovernanceGateReadyMock: vi.fn(),
  classifyPostByEmbeddingMock: vi.fn(),
  isEmbedderReadyMock: vi.fn(),
  configMock: {
    TOPIC_EMBEDDING_ENABLED: false,
    TOPIC_EMBEDDING_MIN_SIMILARITY: 0.35,
    INGESTION_GATE_ENABLED: true,
  },
}));

vi.mock('../src/db/client.js', () => ({
  db: { query: dbQueryMock },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    get: redisGetMock,
    set: redisSetMock,
    del: vi.fn(),
  },
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../src/config.js', () => ({
  config: configMock,
}));

vi.mock('../src/scoring/topics/classifier.js', () => ({
  classifyPost: classifyPostMock,
}));

vi.mock('../src/scoring/topics/taxonomy.js', () => ({
  getTaxonomy: vi.fn().mockReturnValue([
    { slug: 'ai-machine-learning', name: 'AI & Machine Learning', description: null, parentSlug: null, terms: ['neural network'], contextTerms: [], antiTerms: [] },
  ]),
}));

vi.mock('../src/ingestion/governance-gate.js', () => ({
  checkGovernanceGate: checkGovernanceGateMock,
  isGovernanceGateReady: isGovernanceGateReadyMock,
  loadGovernanceGateWeights: vi.fn().mockResolvedValue(undefined),
  invalidateGovernanceGateCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/ingestion/embedding-gate.js', () => ({
  classifyPostByEmbedding: classifyPostByEmbeddingMock,
}));

vi.mock('../src/scoring/topics/embedder.js', () => ({
  isEmbedderReady: isEmbedderReadyMock,
  initEmbedder: vi.fn().mockResolvedValue(undefined),
}));

import { handlePost } from '../src/ingestion/handlers/post-handler.js';

/** Get the classification_method parameter ($12) from INSERT INTO posts. */
function getInsertedClassificationMethod(): string | undefined {
  const insertCall = dbQueryMock.mock.calls.find(
    (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO posts')
  );
  if (!insertCall) return undefined;
  // classification_method is the 12th parameter (index 11)
  return (insertCall[1] as unknown[])[11] as string;
}

describe('classification_method tracking in post handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 1 });
    redisSetMock.mockResolvedValue('OK');
    redisGetMock.mockResolvedValue(
      JSON.stringify({ includeKeywords: [], excludeKeywords: [] })
    );
    isGovernanceGateReadyMock.mockReturnValue(true);
    checkGovernanceGateMock.mockResolvedValue({
      passes: true,
      relevance: 0.8,
      bestTopic: 'ai-machine-learning',
    });
    classifyPostMock.mockReturnValue({
      vector: { 'ai-machine-learning': 0.8 },
      matchedTopics: ['ai-machine-learning'],
      tokenCount: 10,
    });

    // Default: embedding disabled
    configMock.TOPIC_EMBEDDING_ENABLED = false;
    isEmbedderReadyMock.mockReturnValue(false);
    classifyPostByEmbeddingMock.mockResolvedValue(null);
  });

  it('stores keyword when embedding is disabled', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/1',
      'did:plc:abc',
      'cid123',
      {
        text: 'Training a neural network model for classification',
        createdAt: new Date().toISOString(),
      }
    );

    expect(getInsertedClassificationMethod()).toBe('keyword');
  });

  it('stores embedding when embedding classifier produces non-empty vector', async () => {
    configMock.TOPIC_EMBEDDING_ENABLED = true;
    isEmbedderReadyMock.mockReturnValue(true);
    classifyPostByEmbeddingMock.mockResolvedValue({
      vector: { 'ai-machine-learning': 0.52 },
      method: 'embedding',
    });

    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/2',
      'did:plc:abc',
      'cid456',
      {
        text: 'Training a neural network model for classification',
        createdAt: new Date().toISOString(),
      }
    );

    expect(getInsertedClassificationMethod()).toBe('embedding');
  });

  it('stores keyword when embedding returns empty vector (fallback)', async () => {
    configMock.TOPIC_EMBEDDING_ENABLED = true;
    isEmbedderReadyMock.mockReturnValue(true);
    classifyPostByEmbeddingMock.mockResolvedValue({
      vector: {},
      method: 'keyword_fallback',
    });

    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/3',
      'did:plc:abc',
      'cid789',
      {
        text: 'Walking my dog through the neighborhood today',
        createdAt: new Date().toISOString(),
      }
    );

    expect(getInsertedClassificationMethod()).toBe('keyword');
  });

  it('stores keyword when embedder is not ready', async () => {
    configMock.TOPIC_EMBEDDING_ENABLED = true;
    isEmbedderReadyMock.mockReturnValue(false);

    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/4',
      'did:plc:abc',
      'cidabc',
      {
        text: 'Deep learning frameworks for neural networks',
        createdAt: new Date().toISOString(),
      }
    );

    expect(getInsertedClassificationMethod()).toBe('keyword');
  });

  it('stores keyword when embedding classification throws', async () => {
    configMock.TOPIC_EMBEDDING_ENABLED = true;
    isEmbedderReadyMock.mockReturnValue(true);
    classifyPostByEmbeddingMock.mockRejectedValue(new Error('ONNX runtime error'));

    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/5',
      'did:plc:abc',
      'ciddef',
      {
        text: 'Machine learning pipeline for neural network training',
        createdAt: new Date().toISOString(),
      }
    );

    // Should fall back to keyword on error
    expect(getInsertedClassificationMethod()).toBe('keyword');
  });

  it('INSERT query includes classification_method column', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/6',
      'did:plc:abc',
      'cidghi',
      {
        text: 'Building a neural network for classification tasks',
        createdAt: new Date().toISOString(),
      }
    );

    const insertCall = dbQueryMock.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO posts')
    );
    expect(insertCall).toBeDefined();
    expect((insertCall![0] as string)).toContain('classification_method');
    expect((insertCall![0] as string)).toContain('$12');
  });
});
