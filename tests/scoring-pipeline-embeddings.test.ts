/**
 * Scoring Pipeline Embedding Integration Tests
 *
 * Verifies that the scoring pipeline correctly integrates the embedding
 * classifier when TOPIC_EMBEDDING_ENABLED=true, falls back gracefully
 * when disabled or on failure, and stores classification_method.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks ---

const {
  dbQueryMock,
  redisPipelineFactoryMock,
  pipelineDelMock,
  pipelineZaddMock,
  pipelineSetMock,
  pipelineExecMock,
  getCurrentContentRulesMock,
  hasActiveContentRulesMock,
  updateScoringStatusMock,
  classifyPostsBatchMock,
  isEmbedderReadyMock,
  configMock,
} = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  redisPipelineFactoryMock: vi.fn(),
  pipelineDelMock: vi.fn(),
  pipelineZaddMock: vi.fn(),
  pipelineSetMock: vi.fn(),
  pipelineExecMock: vi.fn(),
  getCurrentContentRulesMock: vi.fn(),
  hasActiveContentRulesMock: vi.fn(),
  updateScoringStatusMock: vi.fn(),
  classifyPostsBatchMock: vi.fn(),
  isEmbedderReadyMock: vi.fn(),
  configMock: {
    SCORING_WINDOW_HOURS: 48,
    FEED_MAX_POSTS: 300,
    SCORING_FULL_RESCORE_INTERVAL: 6,
    TOPIC_EMBEDDING_ENABLED: false,
    TOPIC_EMBEDDING_MIN_SIMILARITY: 0.25,
  },
}));

vi.mock('../src/db/client.js', () => ({
  db: { query: dbQueryMock },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: { pipeline: redisPipelineFactoryMock },
}));

vi.mock('../src/governance/content-filter.js', () => ({
  getCurrentContentRules: getCurrentContentRulesMock,
  hasActiveContentRules: hasActiveContentRulesMock,
  filterPosts: vi.fn(),
}));

vi.mock('../src/admin/status-tracker.js', () => ({
  updateScoringStatus: updateScoringStatusMock,
}));

vi.mock('../src/scoring/topics/embedding-classifier.js', () => ({
  classifyPostsBatch: classifyPostsBatchMock,
}));

vi.mock('../src/scoring/topics/embedder.js', () => ({
  isEmbedderReady: isEmbedderReadyMock,
}));

vi.mock('../src/config.js', () => ({
  config: configMock,
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { runScoringPipeline, __resetPipelineState } from '../src/scoring/pipeline.js';
import { buildEpochRow, buildPostRow } from './helpers/index.js';

// --- Helpers ---

function setupDefaultMocks() {
  const pipeline = {
    del: pipelineDelMock.mockReturnThis(),
    zadd: pipelineZaddMock.mockReturnThis(),
    set: pipelineSetMock.mockReturnThis(),
    exec: pipelineExecMock.mockResolvedValue([]),
  };
  redisPipelineFactoryMock.mockReturnValue(pipeline);

  getCurrentContentRulesMock.mockResolvedValue({
    includeKeywords: [],
    excludeKeywords: [],
  });
  hasActiveContentRulesMock.mockReturnValue(false);
  updateScoringStatusMock.mockResolvedValue(undefined);
  isEmbedderReadyMock.mockReturnValue(false);
}

function makeEpochRow(id = 1) {
  return buildEpochRow({ id });
}

function makePostRow(uri: string, text = 'hello world') {
  return buildPostRow({
    uri,
    text,
    topic_vector: { general: 0.5 },
    like_count: 1,
    repost_count: 0,
    reply_count: 0,
  });
}

/**
 * Set up mocks for a pipeline run that processes one post.
 * Returns helpers to inspect the storeScore call.
 */
function setupSinglePostRun(epochId = 1) {
  const postRow = makePostRow('at://did:plc:test/app.bsky.feed.post/1', 'test post about technology');
  const epochRow = makeEpochRow(epochId);

  dbQueryMock
    .mockResolvedValueOnce({ rows: [epochRow] })   // getActiveEpoch
    .mockResolvedValueOnce({ rows: [postRow] })     // getPostsForScoring
    .mockResolvedValueOnce({ rows: [] })             // storeScore INSERT
    .mockResolvedValueOnce({ rows: [] })             // writeToRedisFromDb
    .mockResolvedValueOnce({ rows: [] });            // updateCurrentRunScope
}

/** Extract the classification_method from the storeScore INSERT call ($20). */
function getStoredClassificationMethod(): string | undefined {
  // The storeScore call is the 3rd db.query call (index 2)
  for (const call of dbQueryMock.mock.calls) {
    const sql = String(call[0]);
    if (sql.includes('INSERT INTO post_scores')) {
      const params = call[1] as unknown[];
      // classification_method is $20 (index 19)
      return params[19] as string;
    }
  }
  return undefined;
}

/** Extract classification_method from component_details JSON ($19). */
function getStoredComponentDetails(): Record<string, unknown> | undefined {
  for (const call of dbQueryMock.mock.calls) {
    const sql = String(call[0]);
    if (sql.includes('INSERT INTO post_scores')) {
      const params = call[1] as unknown[];
      // component_details is $19 (index 18)
      return JSON.parse(params[18] as string);
    }
  }
  return undefined;
}

describe('scoring pipeline embedding integration', () => {
  beforeEach(() => {
    __resetPipelineState();
    vi.clearAllMocks();
    setupDefaultMocks();
    // Reset config to defaults
    configMock.TOPIC_EMBEDDING_ENABLED = false;
  });

  it('uses keyword classification when TOPIC_EMBEDDING_ENABLED=false', async () => {
    configMock.TOPIC_EMBEDDING_ENABLED = false;
    setupSinglePostRun();

    await runScoringPipeline();

    // Should NOT call the embedding classifier
    expect(classifyPostsBatchMock).not.toHaveBeenCalled();

    // classification_method should be "keyword"
    const method = getStoredClassificationMethod();
    expect(method).toBe('keyword');
  });

  it('uses keyword classification when embedder is not ready', async () => {
    configMock.TOPIC_EMBEDDING_ENABLED = true;
    isEmbedderReadyMock.mockReturnValue(false);
    setupSinglePostRun();

    await runScoringPipeline();

    // Should NOT call the embedding classifier (embedder not ready)
    expect(classifyPostsBatchMock).not.toHaveBeenCalled();

    const method = getStoredClassificationMethod();
    expect(method).toBe('keyword');
  });

  it('uses embedding classification when enabled and ready', async () => {
    configMock.TOPIC_EMBEDDING_ENABLED = true;
    isEmbedderReadyMock.mockReturnValue(true);

    const embeddingResult = new Map([
      ['at://did:plc:test/app.bsky.feed.post/1', { technology: 0.85 }],
    ]);
    classifyPostsBatchMock.mockResolvedValue(embeddingResult);
    setupSinglePostRun();

    await runScoringPipeline();

    // Should call the embedding classifier
    expect(classifyPostsBatchMock).toHaveBeenCalledTimes(1);

    // classification_method should be "embedding"
    const method = getStoredClassificationMethod();
    expect(method).toBe('embedding');

    // component_details should include classification_method
    const details = getStoredComponentDetails();
    expect(details?.classification_method).toBe('embedding');
  });

  it('falls back to keyword on embedding failure', async () => {
    configMock.TOPIC_EMBEDDING_ENABLED = true;
    isEmbedderReadyMock.mockReturnValue(true);

    classifyPostsBatchMock.mockRejectedValue(new Error('ONNX runtime error'));
    setupSinglePostRun();

    // Should NOT throw — graceful degradation
    await expect(runScoringPipeline()).resolves.not.toThrow();

    // classification_method should be "keyword" (fallback)
    const method = getStoredClassificationMethod();
    expect(method).toBe('keyword');
  });

  it('falls back to keyword when embedding returns empty vector for post', async () => {
    configMock.TOPIC_EMBEDDING_ENABLED = true;
    isEmbedderReadyMock.mockReturnValue(true);

    // Embedding returns empty vector (no topics matched)
    const embeddingResult = new Map([
      ['at://did:plc:test/app.bsky.feed.post/1', {}],
    ]);
    classifyPostsBatchMock.mockResolvedValue(embeddingResult);
    setupSinglePostRun();

    await runScoringPipeline();

    // Empty embedding vector means fallback to keyword
    const method = getStoredClassificationMethod();
    expect(method).toBe('keyword');
  });

  it('stores classification_method in component_details JSON', async () => {
    configMock.TOPIC_EMBEDDING_ENABLED = false;
    setupSinglePostRun();

    await runScoringPipeline();

    const details = getStoredComponentDetails();
    expect(details).toBeDefined();
    expect(details?.classification_method).toBe('keyword');
    expect(details?.run_id).toBeDefined();
  });

  it('still completes scoring run when no posts to score', async () => {
    configMock.TOPIC_EMBEDDING_ENABLED = true;
    isEmbedderReadyMock.mockReturnValue(true);

    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow()] }) // getActiveEpoch
      .mockResolvedValueOnce({ rows: [] })                // getPostsForScoring (empty)
      .mockResolvedValueOnce({ rows: [] })                // writeToRedisFromDb
      .mockResolvedValueOnce({ rows: [] });               // updateCurrentRunScope

    await expect(runScoringPipeline()).resolves.not.toThrow();

    // Should NOT call embedding classifier with empty post list
    // (the classifier IS called with empty array, but returns empty map)
    // OR it's not called at all because posts array is empty
    // Either way, pipeline should complete successfully
  });
});
