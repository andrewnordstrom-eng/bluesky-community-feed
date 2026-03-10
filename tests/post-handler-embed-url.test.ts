/**
 * Post Handler Embed URL Extraction Tests
 *
 * Tests that external embed URLs are correctly extracted from AT Protocol
 * post records and stored in the embed_url column for URL deduplication.
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
} = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  redisGetMock: vi.fn(),
  redisSetMock: vi.fn(),
  classifyPostMock: vi.fn(),
  checkGovernanceGateMock: vi.fn(),
  isGovernanceGateReadyMock: vi.fn(),
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

vi.mock('../src/scoring/topics/classifier.js', () => ({
  classifyPost: classifyPostMock,
}));

vi.mock('../src/scoring/topics/taxonomy.js', () => ({
  getTaxonomy: vi.fn().mockReturnValue([
    { slug: 'software-development', name: 'Software Development', description: null, parentSlug: null, terms: ['programming'], contextTerms: [], antiTerms: [] },
  ]),
}));

vi.mock('../src/ingestion/governance-gate.js', () => ({
  checkGovernanceGate: checkGovernanceGateMock,
  isGovernanceGateReady: isGovernanceGateReadyMock,
  loadGovernanceGateWeights: vi.fn().mockResolvedValue(undefined),
  invalidateGovernanceGateCache: vi.fn().mockResolvedValue(undefined),
}));

import { handlePost } from '../src/ingestion/handlers/post-handler.js';

/** Get the embed_url parameter ($11) from the INSERT INTO posts call. */
function getInsertedEmbedUrl(): string | null | undefined {
  const insertCall = dbQueryMock.mock.calls.find(
    (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO posts')
  );
  if (!insertCall) return undefined;
  // embed_url is the 11th parameter (index 10)
  return (insertCall[1] as unknown[])[10] as string | null;
}

/** Count INSERT INTO posts calls. */
function countInsertCalls(): number {
  return dbQueryMock.mock.calls.filter(
    (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO posts')
  ).length;
}

describe('embed URL extraction', () => {
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
      bestTopic: 'software-development',
    });
    classifyPostMock.mockReturnValue({
      vector: { 'software-development': 0.8 },
      matchedTopics: ['software-development'],
      tokenCount: 10,
    });
  });

  it('extracts URL from app.bsky.embed.external', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/1',
      'did:plc:abc',
      'cid123',
      {
        text: 'Check out this article about programming',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.external',
          external: {
            uri: 'https://example.com/article',
            title: 'Cool Article',
            description: 'An article about programming',
          },
        },
      }
    );

    expect(countInsertCalls()).toBe(1);
    expect(getInsertedEmbedUrl()).toBe('https://example.com/article');
  });

  it('extracts URL from app.bsky.embed.recordWithMedia nested external', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/2',
      'did:plc:abc',
      'cid456',
      {
        text: 'Quote post with a link about programming',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.recordWithMedia',
          media: {
            $type: 'app.bsky.embed.external',
            external: {
              uri: 'https://example.com/nested-article',
              title: 'Nested Article',
              description: 'A nested link',
            },
          },
        },
      }
    );

    expect(countInsertCalls()).toBe(1);
    expect(getInsertedEmbedUrl()).toBe('https://example.com/nested-article');
  });

  it('stores null when no external embed present', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/3',
      'did:plc:abc',
      'cid789',
      {
        text: 'Just a text post about programming',
        createdAt: new Date().toISOString(),
      }
    );

    expect(countInsertCalls()).toBe(1);
    expect(getInsertedEmbedUrl()).toBeNull();
  });

  it('stores null for image-only embeds', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/4',
      'did:plc:abc',
      'cidabc',
      {
        text: 'Image post about programming',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'A screenshot', image: {} }],
        },
      }
    );

    expect(countInsertCalls()).toBe(1);
    expect(getInsertedEmbedUrl()).toBeNull();
  });

  it('stores null for quote-post embeds (app.bsky.embed.record)', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/5',
      'did:plc:abc',
      'ciddef',
      {
        text: 'Quoting another post about programming',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.record',
          record: { uri: 'at://did:plc:xyz/app.bsky.feed.post/99' },
        },
      }
    );

    expect(countInsertCalls()).toBe(1);
    expect(getInsertedEmbedUrl()).toBeNull();
  });

  it('stores the URL in the posts table via $11 parameter', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/6',
      'did:plc:abc',
      'cidghi',
      {
        text: 'Post with external link about programming',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.external',
          external: {
            uri: 'https://wired.com/big-story',
            title: 'Big Story',
            description: 'Breaking news',
          },
        },
      }
    );

    expect(countInsertCalls()).toBe(1);
    // Verify the INSERT query includes embed_url column
    const insertCall = dbQueryMock.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO posts')
    );
    expect((insertCall![0] as string)).toContain('embed_url');
    expect((insertCall![0] as string)).toContain('$11');
    expect((insertCall![1] as unknown[])[10]).toBe('https://wired.com/big-story');
  });
});
