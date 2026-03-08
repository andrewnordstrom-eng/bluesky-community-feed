/**
 * Post Handler Alt Text Tests
 *
 * Tests that image alt text is extracted and included in topic classification,
 * while NOT affecting the media-without-text gate or content filter.
 * Uses the same mock pattern as governance-gate-integration.test.ts.
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
    { slug: 'software-development', name: 'Software Development', description: null, parentSlug: null, terms: ['programming', 'npm'], contextTerms: ['typescript'], antiTerms: [] },
  ]),
}));

vi.mock('../src/ingestion/governance-gate.js', () => ({
  checkGovernanceGate: checkGovernanceGateMock,
  isGovernanceGateReady: isGovernanceGateReadyMock,
  loadGovernanceGateWeights: vi.fn().mockResolvedValue(undefined),
  invalidateGovernanceGateCache: vi.fn().mockResolvedValue(undefined),
}));

import { handlePost } from '../src/ingestion/handlers/post-handler.js';

/** Count INSERT INTO posts calls in dbQueryMock. */
function countInsertCalls(): number {
  return dbQueryMock.mock.calls.filter(
    (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO posts')
  ).length;
}

describe('post handler alt text extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all DB operations succeed
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 1 });
    redisSetMock.mockResolvedValue('OK');
    // Default: no content rules (everything passes keyword filter)
    redisGetMock.mockResolvedValue(
      JSON.stringify({ includeKeywords: [], excludeKeywords: [] })
    );
    // Default: governance gate ready and passing
    isGovernanceGateReadyMock.mockReturnValue(true);
    checkGovernanceGateMock.mockResolvedValue({
      passes: true,
      relevance: 0.8,
      bestTopic: 'software-development',
    });
    // Default: classifier returns a match
    classifyPostMock.mockReturnValue({
      vector: { 'software-development': 0.8 },
      matchedTopics: ['software-development'],
      tokenCount: 10,
    });
  });

  it('includes alt text in topic classification', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/1',
      'did:plc:abc',
      'cid123',
      {
        text: 'Check out my project',
        createdAt: new Date().toISOString(),
        embed: {
          images: [{ alt: 'Screenshot of terminal running npm install', image: {} }],
        },
      }
    );

    expect(countInsertCalls()).toBe(1);
    // Verify classifier received concatenated text (post text + alt text)
    expect(classifyPostMock).toHaveBeenCalledTimes(1);
    const classifiedText = classifyPostMock.mock.calls[0][0] as string;
    expect(classifiedText).toContain('Check out my project');
    expect(classifiedText).toContain('Screenshot of terminal running npm install');
  });

  it('media gate checks original text only, not alt text', async () => {
    // Image post with NO post text but WITH alt text
    // Media gate should reject based on missing original text
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/2',
      'did:plc:abc',
      'cid456',
      {
        text: '',
        createdAt: new Date().toISOString(),
        embed: {
          images: [{ alt: 'Detailed description of a software deployment dashboard', image: {} }],
        },
      }
    );

    // Post should be rejected by media-without-text gate
    expect(countInsertCalls()).toBe(0);
    // Classifier should NOT have been called (media gate runs before classification)
    expect(classifyPostMock).not.toHaveBeenCalled();
  });

  it('handles empty alt text gracefully', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/3',
      'did:plc:abc',
      'cid789',
      {
        text: 'A post with empty alt text images',
        createdAt: new Date().toISOString(),
        embed: {
          images: [{ alt: '', image: {} }, { alt: '   ', image: {} }],
        },
      }
    );

    expect(countInsertCalls()).toBe(1);
    // Classifier should receive only the post text (empty/whitespace alts filtered out)
    const classifiedText = classifyPostMock.mock.calls[0][0] as string;
    expect(classifiedText).toBe('A post with empty alt text images');
  });

  it('concatenates alt text from multiple images', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/4',
      'did:plc:abc',
      'cidabc',
      {
        text: 'My dev setup',
        createdAt: new Date().toISOString(),
        embed: {
          images: [
            { alt: 'Terminal with TypeScript compilation', image: {} },
            { alt: 'VS Code editor showing React components', image: {} },
            { alt: 'Browser devtools network tab', image: {} },
          ],
        },
      }
    );

    expect(countInsertCalls()).toBe(1);
    const classifiedText = classifyPostMock.mock.calls[0][0] as string;
    expect(classifiedText).toContain('My dev setup');
    expect(classifiedText).toContain('Terminal with TypeScript compilation');
    expect(classifiedText).toContain('VS Code editor showing React components');
    expect(classifiedText).toContain('Browser devtools network tab');
  });

  it('handles missing alt field on image objects', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/5',
      'did:plc:abc',
      'ciddef',
      {
        text: 'Image without alt field',
        createdAt: new Date().toISOString(),
        embed: {
          images: [{ image: {} } as { alt?: string; image?: unknown }],
        },
      }
    );

    expect(countInsertCalls()).toBe(1);
    // Classifier should receive only the post text
    const classifiedText = classifyPostMock.mock.calls[0][0] as string;
    expect(classifiedText).toBe('Image without alt field');
  });

  it('alt text does not affect content keyword filter', async () => {
    // Content filter requires 'atproto' keyword — only present in alt text, not post text
    redisGetMock.mockResolvedValue(
      JSON.stringify({ includeKeywords: ['atproto'], excludeKeywords: [] })
    );

    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/6',
      'did:plc:abc',
      'cidghi',
      {
        text: 'This post has no matching keywords',
        createdAt: new Date().toISOString(),
        embed: {
          images: [{ alt: 'Screenshot of atproto documentation page', image: {} }],
        },
      }
    );

    // Post should be filtered by content filter (alt text not checked for keywords)
    expect(countInsertCalls()).toBe(0);
    // Classifier should NOT have been called (content filter runs before classification)
    expect(classifyPostMock).not.toHaveBeenCalled();
  });
});
