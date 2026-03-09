/**
 * Scoring Pipeline — No Embedding Override Tests
 *
 * Verifies that the scoring pipeline does NOT re-classify posts at
 * scoring time. Topic vectors are determined at ingestion time and
 * the pipeline uses them as-is.
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
  configMock: {
    SCORING_WINDOW_HOURS: 48,
    FEED_MAX_POSTS: 300,
    SCORING_FULL_RESCORE_INTERVAL: 6,
    TOPIC_EMBEDDING_ENABLED: false,
    TOPIC_EMBEDDING_MIN_SIMILARITY: 0.35,
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
}

function makeEpochRow(id = 1) {
  return buildEpochRow({ id });
}

function makePostRow(uri: string, text = 'hello world', topicVector: Record<string, number> = { general: 0.5 }) {
  return buildPostRow({
    uri,
    text,
    topic_vector: topicVector,
    like_count: 1,
    repost_count: 0,
    reply_count: 0,
  });
}

/**
 * Set up mocks for a pipeline run that processes one post.
 */
function setupSinglePostRun(epochId = 1, topicVector: Record<string, number> = { general: 0.5 }) {
  const postRow = makePostRow('at://did:plc:test/app.bsky.feed.post/1', 'test post about technology', topicVector);
  const epochRow = makeEpochRow(epochId);

  dbQueryMock
    .mockResolvedValueOnce({ rows: [epochRow] })   // getActiveEpoch
    .mockResolvedValueOnce({ rows: [postRow] })     // getPostsForScoring
    .mockResolvedValueOnce({ rows: [] })             // storeScore INSERT
    .mockResolvedValueOnce({ rows: [] })             // writeToRedisFromDb
    .mockResolvedValueOnce({ rows: [] });            // updateCurrentRunScope
}

/** Extract the topic_vector passed to storeScore via the scored post. */
function getStoredClassificationMethod(): string | undefined {
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

describe('scoring pipeline does not override topic vectors', () => {
  beforeEach(() => {
    __resetPipelineState();
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('uses stored topic vector without modification', async () => {
    const originalVector = { 'software-development': 0.85, 'open-source': 0.4 };
    setupSinglePostRun(1, originalVector);

    await runScoringPipeline();

    // The pipeline should store classification_method as 'keyword'
    // since it no longer re-classifies at scoring time
    const method = getStoredClassificationMethod();
    expect(method).toBe('keyword');
  });

  it('TOPIC_EMBEDDING_ENABLED has no effect on scoring behavior', async () => {
    configMock.TOPIC_EMBEDDING_ENABLED = true;
    setupSinglePostRun();

    // Pipeline should complete without calling any embedding functions
    await expect(runScoringPipeline()).resolves.not.toThrow();

    const method = getStoredClassificationMethod();
    expect(method).toBe('keyword');
  });

  it('posts with keyword vectors score correctly', async () => {
    setupSinglePostRun(1, { 'ai-machine-learning': 0.7 });

    await runScoringPipeline();

    // Should have stored a score
    const storeCall = dbQueryMock.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes('INSERT INTO post_scores')
    );
    expect(storeCall).toBeDefined();
  });

  it('posts with embedding-style vectors score correctly', async () => {
    // Embedding vectors look the same as keyword vectors (both are TopicVector)
    // Just different values — embeddings tend to have cosine similarity values
    setupSinglePostRun(1, { 'software-development': 0.62, 'devops-infrastructure': 0.38 });

    await runScoringPipeline();

    const storeCall = dbQueryMock.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes('INSERT INTO post_scores')
    );
    expect(storeCall).toBeDefined();
  });

  it('classification_method is always keyword at scoring time', async () => {
    configMock.TOPIC_EMBEDDING_ENABLED = true;
    setupSinglePostRun(1, { 'cybersecurity': 0.9 });

    await runScoringPipeline();

    // Even with embedding enabled, the pipeline never re-classifies
    const method = getStoredClassificationMethod();
    expect(method).toBe('keyword');
  });

  it('completes scoring run when no posts to score', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow()] }) // getActiveEpoch
      .mockResolvedValueOnce({ rows: [] })                // getPostsForScoring (empty)
      .mockResolvedValueOnce({ rows: [] })                // writeToRedisFromDb
      .mockResolvedValueOnce({ rows: [] });               // updateCurrentRunScope

    await expect(runScoringPipeline()).resolves.not.toThrow();
  });
});
