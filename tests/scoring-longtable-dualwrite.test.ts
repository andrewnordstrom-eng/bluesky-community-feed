/**
 * Scoring Pipeline — Long-Table Dual-Write Tests (PROJ-814 / P1)
 *
 * Verifies that storeScore() dual-writes the per-component decomposition into
 * post_score_components (migration 021) in addition to the existing 15-column
 * wide row in post_scores, gated by SCORE_LONGTABLE_DUALWRITE_ENABLED.
 *
 * Wide-row behavior is exhaustively covered by scoring-pipeline-rescore.test.ts;
 * this file focuses on the new long-table side.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    SCORING_CANDIDATE_LIMIT: 5000,
    SCORING_TIMEOUT_MS: 240000,
    TOPIC_EMBEDDING_ENABLED: false,
    TOPIC_EMBEDDING_MIN_SIMILARITY: 0.35,
    FEED_MIN_RELEVANCE: 0,
    FEED_DEDUP_ENABLED: false,
    FEED_DEDUP_MIN_TEXT: 100,
    SCORE_LONGTABLE_DUALWRITE_ENABLED: true,
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

/** Find a db.query call by an SQL substring; helper used by the assertions below. */
function findCall(needle: string): unknown[] | undefined {
  return dbQueryMock.mock.calls.find((c: unknown[]) =>
    String(c[0]).includes(needle)
  );
}

describe('scoring pipeline long-table dual-write (PROJ-814)', () => {
  beforeEach(() => {
    __resetPipelineState();
    vi.clearAllMocks();
    configMock.SCORE_LONGTABLE_DUALWRITE_ENABLED = true;
    setupDefaultMocks();
  });

  it('writes both wide-row post_scores and long-table post_score_components when flag is on', async () => {
    const postRow = buildPostRow({ uri: 'at://did:plc:test/post/dualwrite' });

    dbQueryMock
      .mockResolvedValueOnce({ rows: [buildEpochRow({ id: 1 })] }) // getActiveEpoch
      .mockResolvedValueOnce({ rows: [postRow] })                   // getPostsForScoring
      .mockResolvedValueOnce({ rows: [] })                          // bridging engager
      .mockResolvedValueOnce({ rows: [] })                          // INSERT INTO post_scores
      .mockResolvedValueOnce({ rows: [] })                          // INSERT INTO post_score_components
      .mockResolvedValueOnce({ rows: [] })                          // writeToRedisFromDb
      .mockResolvedValueOnce({ rows: [] });                         // updateCurrentRunScope

    await runScoringPipeline();

    const wideCall = findCall('INSERT INTO post_scores');
    const longCall = findCall('INSERT INTO post_score_components');

    expect(wideCall).toBeDefined();
    expect(longCall).toBeDefined();
  });

  it('writes one long-table row per registered scoring component (5 by default)', async () => {
    const postRow = buildPostRow({ uri: 'at://did:plc:test/post/n-components' });

    dbQueryMock
      .mockResolvedValueOnce({ rows: [buildEpochRow({ id: 1 })] })
      .mockResolvedValueOnce({ rows: [postRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await runScoringPipeline();

    const longCall = findCall('INSERT INTO post_score_components');
    expect(longCall).toBeDefined();

    // Params layout: 6 columns × N components. Default registry → 5 components → 30 params.
    const params = longCall![1] as unknown[];
    expect(params.length).toBe(5 * 6);

    // Verify the component_key column is the 3rd of each 6-tuple and matches the
    // registry order in DEFAULT_COMPONENTS.
    const componentKeys = [params[2], params[8], params[14], params[20], params[26]];
    expect(componentKeys).toEqual([
      'recency',
      'engagement',
      'bridging',
      'sourceDiversity',
      'relevance',
    ]);
  });

  it('skips the long-table write when flag is off', async () => {
    configMock.SCORE_LONGTABLE_DUALWRITE_ENABLED = false;
    const postRow = buildPostRow({ uri: 'at://did:plc:test/post/flag-off' });

    dbQueryMock
      .mockResolvedValueOnce({ rows: [buildEpochRow({ id: 1 })] })
      .mockResolvedValueOnce({ rows: [postRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await runScoringPipeline();

    expect(findCall('INSERT INTO post_scores')).toBeDefined();
    expect(findCall('INSERT INTO post_score_components')).toBeUndefined();
  });

  it('uses ON CONFLICT DO UPDATE for idempotency on rescore', async () => {
    const postRow = buildPostRow({ uri: 'at://did:plc:test/post/rescore' });

    dbQueryMock
      .mockResolvedValueOnce({ rows: [buildEpochRow({ id: 1 })] })
      .mockResolvedValueOnce({ rows: [postRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await runScoringPipeline();

    const longCall = findCall('INSERT INTO post_score_components');
    expect(longCall).toBeDefined();

    const sql = String(longCall![0]);
    expect(sql).toMatch(
      /ON CONFLICT \(post_uri, epoch_id, component_key\) DO UPDATE SET/
    );
    // Update clause must refresh all three numeric columns plus scored_at.
    expect(sql).toMatch(/raw = EXCLUDED\.raw/);
    expect(sql).toMatch(/weight = EXCLUDED\.weight/);
    expect(sql).toMatch(/weighted = EXCLUDED\.weighted/);
    expect(sql).toMatch(/scored_at = NOW\(\)/);
  });
});
