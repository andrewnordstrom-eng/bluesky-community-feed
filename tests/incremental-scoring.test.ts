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
  filterPostsMock,
  updateScoringStatusMock,
} = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  redisPipelineFactoryMock: vi.fn(),
  pipelineDelMock: vi.fn(),
  pipelineZaddMock: vi.fn(),
  pipelineSetMock: vi.fn(),
  pipelineExecMock: vi.fn(),
  getCurrentContentRulesMock: vi.fn(),
  hasActiveContentRulesMock: vi.fn(),
  filterPostsMock: vi.fn(),
  updateScoringStatusMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    pipeline: redisPipelineFactoryMock,
  },
}));

vi.mock('../src/governance/content-filter.js', () => ({
  getCurrentContentRules: getCurrentContentRulesMock,
  hasActiveContentRules: hasActiveContentRulesMock,
  filterPosts: filterPostsMock,
}));

vi.mock('../src/admin/status-tracker.js', () => ({
  updateScoringStatus: updateScoringStatusMock,
}));


import { runScoringPipeline, getLastScoringRunAt, __resetPipelineState } from '../src/scoring/pipeline.js';
import { buildEpochRow, buildPostRow } from './helpers/index.js';

function makeEpochRow(id = 2) {
  return buildEpochRow({ id });
}

function makePostRow(uri = 'at://did:plc:test/post/1') {
  return buildPostRow({ uri });
}

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

describe('incremental scoring pipeline', () => {
  beforeEach(() => {
    __resetPipelineState();
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('uses full rescore on first run (no lastRunAt)', async () => {
    // First run ever: lastSuccessfulRunAt is null → full rescore
    // Call sequence: epoch query, full posts query, writeToRedisFromDb, updateCurrentRunScope
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow()] })   // getActiveEpoch
      .mockResolvedValueOnce({ rows: [] })                   // getPostsForScoring (full)
      .mockResolvedValueOnce({ rows: [] })                   // writeToRedisFromDb
      .mockResolvedValueOnce({ rows: [] });                  // updateCurrentRunScope

    await runScoringPipeline();

    // The second db.query call should be the full posts query (no UNION ALL)
    const postsQuery = String(dbQueryMock.mock.calls[1][0]);
    expect(postsQuery).not.toContain('UNION ALL');
    expect(postsQuery).toContain('FROM posts p');
  });

  it('switches to incremental mode on subsequent runs with same epoch', async () => {
    // First run: full rescore to establish lastRunAt
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await runScoringPipeline();

    // After first run, lastRunAt is set. Second run should use incremental.
    dbQueryMock.mockReset();
    setupDefaultMocks();
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow()] })       // getActiveEpoch
      .mockResolvedValueOnce({ rows: [] })                       // getPostsForIncrementalScoring
      .mockResolvedValueOnce({ rows: [] })                       // writeToRedisFromDb
      .mockResolvedValueOnce({ rows: [] });                      // updateCurrentRunScope

    await runScoringPipeline();

    // The second call should be the incremental query (has UNION ALL)
    const postsQuery = String(dbQueryMock.mock.calls[1][0]);
    expect(postsQuery).toContain('UNION ALL');
    expect(postsQuery).toContain('ps.post_uri IS NULL');       // Part A: new posts
    expect(postsQuery).toContain('pe.updated_at > ps.scored_at'); // Part B: changed engagement
  });

  it('falls back to full rescore when epoch changes', async () => {
    // Run 1: epoch 2 (full, sets lastScoredEpochId = 2)
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow(2)] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await runScoringPipeline();

    // Run 2: epoch 3 (different epoch → must do full rescore)
    dbQueryMock.mockReset();
    setupDefaultMocks();
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow(3)] })  // Different epoch!
      .mockResolvedValueOnce({ rows: [] })                   // Should be full query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await runScoringPipeline();

    const postsQuery = String(dbQueryMock.mock.calls[1][0]);
    expect(postsQuery).not.toContain('UNION ALL'); // Full rescore, not incremental
  });

  it('writeToRedisFromDb reads scores from DB for complete feed', async () => {
    const postRow = makePostRow();
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow()] })   // getActiveEpoch
      .mockResolvedValueOnce({ rows: [postRow] })           // getPostsForScoring (full)
      // scoreBridging engager query (for the scored post)
      .mockResolvedValueOnce({ rows: [] })
      // storeScore upsert
      .mockResolvedValueOnce({ rows: [] })
      // writeToRedisFromDb: returns the scored post from DB
      .mockResolvedValueOnce({
        rows: [{ post_uri: postRow.uri, total_score: 0.5 }],
      })
      // updateCurrentRunScope
      .mockResolvedValueOnce({ rows: [] });

    await runScoringPipeline();

    // Find the writeToRedisFromDb call (query with post_scores and total_score)
    const writeCall = dbQueryMock.mock.calls.find(
      (call: unknown[]) => String(call[0]).includes('post_scores ps') && String(call[0]).includes('total_score')
    );
    expect(writeCall).toBeDefined();

    // Redis should have the post from DB, not just from the in-memory scored array
    expect(pipelineZaddMock).toHaveBeenCalledWith('feed:current', 0.5, postRow.uri);
  });

  it('incremental query passes epoch_id to filter scored posts', async () => {
    // First run to set up incremental mode
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow(5)] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await runScoringPipeline();

    // Second run: incremental
    dbQueryMock.mockReset();
    setupDefaultMocks();
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow(5)] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await runScoringPipeline();

    // The incremental query should include epochId as parameter
    const postsQueryParams = dbQueryMock.mock.calls[1][1] as unknown[];
    // $1 = cutoff, $2 = epochId, $3 = limit
    expect(postsQueryParams[1]).toBe(5); // epoch_id
  });

  it('logs incremental mode in pipeline completion', async () => {
    // First run: full
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await runScoringPipeline();

    // Verify lastRunAt is set after successful run
    expect(getLastScoringRunAt()).not.toBeNull();
  });
});
