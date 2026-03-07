/**
 * Embedding Classifier Unit Tests
 *
 * Tests for the embedder utility functions and the batch classifier.
 * Uses mock embeddings to verify classification logic independently
 * of the actual ONNX model.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---

const { embedTextsMock, isEmbedderReadyMock, getTopicsWithEmbeddingsMock } = vi.hoisted(() => ({
  embedTextsMock: vi.fn(),
  isEmbedderReadyMock: vi.fn(),
  getTopicsWithEmbeddingsMock: vi.fn(),
}));

vi.mock('../src/scoring/topics/embedder.js', () => ({
  embedTexts: embedTextsMock,
  cosineSimilarity: (a: Float32Array, b: Float32Array): number => {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot;
  },
  isEmbedderReady: isEmbedderReadyMock,
  EMBEDDING_DIM: 384,
}));

vi.mock('../src/scoring/topics/taxonomy.js', () => ({
  getTopicsWithEmbeddings: getTopicsWithEmbeddingsMock,
}));

vi.mock('../src/config.js', () => ({
  config: {
    TOPIC_EMBEDDING_MIN_SIMILARITY: 0.25,
    TOPIC_EMBEDDING_ENABLED: true,
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

import { cosineSimilarity } from '../src/scoring/topics/embedder.js';
import { classifyPostsBatch } from '../src/scoring/topics/embedding-classifier.js';

// --- Helpers ---

/** Create a normalized vector with a known direction. */
function makeVector(dim: number, direction: number[]): Float32Array {
  const vec = new Float32Array(dim);
  for (let i = 0; i < direction.length && i < dim; i++) {
    vec[i] = direction[i];
  }
  // L2-normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) vec[i] /= norm;
  }
  return vec;
}

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical normalized vectors', () => {
    const v = makeVector(384, [1, 0, 0]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = makeVector(384, [1, 0, 0]);
    const b = makeVector(384, [0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = makeVector(384, [1, 0, 0]);
    const b = makeVector(384, [-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('returns value between 0 and 1 for partially similar vectors', () => {
    const a = makeVector(384, [1, 1, 0]);
    const b = makeVector(384, [1, 0, 0]);
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.0);
    expect(sim).toBeLessThan(1.0);
  });
});

describe('classifyPostsBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isEmbedderReadyMock.mockReturnValue(true);
  });

  it('returns empty map when no topic embeddings are available', async () => {
    getTopicsWithEmbeddingsMock.mockReturnValue(null);

    const result = await classifyPostsBatch([
      { uri: 'at://test/post/1', text: 'hello world' },
    ]);

    expect(result.size).toBe(0);
    expect(embedTextsMock).not.toHaveBeenCalled();
  });

  it('returns empty map when topic embeddings array is empty', async () => {
    getTopicsWithEmbeddingsMock.mockReturnValue([]);

    const result = await classifyPostsBatch([
      { uri: 'at://test/post/1', text: 'hello world' },
    ]);

    expect(result.size).toBe(0);
  });

  it('assigns empty vector for posts with no text', async () => {
    getTopicsWithEmbeddingsMock.mockReturnValue([
      { slug: 'tech', embedding: makeVector(384, [1, 0, 0]) },
    ]);

    const result = await classifyPostsBatch([
      { uri: 'at://test/post/1', text: '' },
      { uri: 'at://test/post/2', text: '   ' },
    ]);

    expect(result.get('at://test/post/1')).toEqual({});
    expect(result.get('at://test/post/2')).toEqual({});
    expect(embedTextsMock).not.toHaveBeenCalled();
  });

  it('classifies post matching a topic above threshold', async () => {
    const topicEmb = makeVector(384, [1, 0, 0]);
    const postEmb = makeVector(384, [0.9, 0.1, 0]); // high similarity

    getTopicsWithEmbeddingsMock.mockReturnValue([
      {
        slug: 'tech',
        name: 'Technology',
        description: null,
        parentSlug: null,
        terms: ['tech'],
        contextTerms: [],
        antiTerms: [],
        embedding: topicEmb,
      },
    ]);

    embedTextsMock.mockResolvedValue([postEmb]);

    const result = await classifyPostsBatch([
      { uri: 'at://test/post/1', text: 'A discussion about technology' },
    ]);

    const vector = result.get('at://test/post/1');
    expect(vector).toBeDefined();
    expect(vector!['tech']).toBeGreaterThan(0.25);
  });

  it('excludes topics below threshold', async () => {
    const topicEmb = makeVector(384, [1, 0, 0]);
    const postEmb = makeVector(384, [0, 1, 0]); // orthogonal = ~0.0 similarity

    getTopicsWithEmbeddingsMock.mockReturnValue([
      {
        slug: 'tech',
        name: 'Technology',
        description: null,
        parentSlug: null,
        terms: ['tech'],
        contextTerms: [],
        antiTerms: [],
        embedding: topicEmb,
      },
    ]);

    embedTextsMock.mockResolvedValue([postEmb]);

    const result = await classifyPostsBatch([
      { uri: 'at://test/post/1', text: 'Totally unrelated content' },
    ]);

    const vector = result.get('at://test/post/1');
    expect(vector).toBeDefined();
    expect(vector!['tech']).toBeUndefined();
  });

  it('classifies multiple posts in a single batch', async () => {
    const techEmb = makeVector(384, [1, 0, 0]);
    const postEmb1 = makeVector(384, [0.95, 0.05, 0]); // similar to tech
    const postEmb2 = makeVector(384, [0, 1, 0]);        // orthogonal to tech

    getTopicsWithEmbeddingsMock.mockReturnValue([
      {
        slug: 'tech',
        name: 'Technology',
        description: null,
        parentSlug: null,
        terms: ['tech'],
        contextTerms: [],
        antiTerms: [],
        embedding: techEmb,
      },
    ]);

    embedTextsMock.mockResolvedValue([postEmb1, postEmb2]);

    const result = await classifyPostsBatch([
      { uri: 'at://test/post/1', text: 'A tech post' },
      { uri: 'at://test/post/2', text: 'A cooking post' },
    ]);

    expect(result.size).toBe(2);
    expect(result.get('at://test/post/1')!['tech']).toBeGreaterThan(0.25);
    expect(result.get('at://test/post/2')!['tech']).toBeUndefined();
  });

  it('rounds scores to 2 decimal places', async () => {
    const topicEmb = makeVector(384, [1, 0, 0]);
    // Create a post embedding that produces a non-round similarity
    const postEmb = makeVector(384, [0.87, 0.35, 0.1]);

    getTopicsWithEmbeddingsMock.mockReturnValue([
      {
        slug: 'tech',
        name: 'Technology',
        description: null,
        parentSlug: null,
        terms: ['tech'],
        contextTerms: [],
        antiTerms: [],
        embedding: topicEmb,
      },
    ]);

    embedTextsMock.mockResolvedValue([postEmb]);

    const result = await classifyPostsBatch([
      { uri: 'at://test/post/1', text: 'Some post content' },
    ]);

    const score = result.get('at://test/post/1')!['tech'];
    if (score !== undefined) {
      // Score should be rounded to 2 decimal places
      const rounded = Math.round(score * 100) / 100;
      expect(score).toBe(rounded);
    }
  });

  it('handles multiple topics per post', async () => {
    const techEmb = makeVector(384, [1, 0, 0]);
    const scienceEmb = makeVector(384, [0.9, 0.3, 0]); // similar direction to tech
    const artEmb = makeVector(384, [0, 0, 1]);          // orthogonal

    // Post embedding close to both tech and science
    const postEmb = makeVector(384, [0.95, 0.15, 0]);

    getTopicsWithEmbeddingsMock.mockReturnValue([
      { slug: 'tech', embedding: techEmb },
      { slug: 'science', embedding: scienceEmb },
      { slug: 'art', embedding: artEmb },
    ]);

    embedTextsMock.mockResolvedValue([postEmb]);

    const result = await classifyPostsBatch([
      { uri: 'at://test/post/1', text: 'Tech science post' },
    ]);

    const vector = result.get('at://test/post/1')!;
    // Should match tech and science (high similarity), not art (orthogonal)
    expect(vector['tech']).toBeGreaterThan(0.25);
    expect(vector['science']).toBeGreaterThan(0.25);
    expect(vector['art']).toBeUndefined();
  });
});
