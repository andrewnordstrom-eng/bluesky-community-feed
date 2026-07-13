import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbQueryMock,
  dbConnectMock,
  clientQueryMock,
  clientReleaseMock,
  redisPipelineFactoryMock,
  pipelineDelMock,
  pipelineZaddMock,
  pipelineSetMock,
  pipelineExecMock,
  pipelineExpireMock,
  redisEvalMock,
  getCurrentContentRulesMock,
  hasActiveContentRulesMock,
  filterPostsMock,
  updateScoringStatusMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  dbConnectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(),
  redisPipelineFactoryMock: vi.fn(),
  pipelineDelMock: vi.fn(),
  pipelineZaddMock: vi.fn(),
  pipelineSetMock: vi.fn(),
  pipelineExecMock: vi.fn(),
  pipelineExpireMock: vi.fn(),
  redisEvalMock: vi.fn(),
  getCurrentContentRulesMock: vi.fn(),
  hasActiveContentRulesMock: vi.fn(),
  filterPostsMock: vi.fn(),
  updateScoringStatusMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
    connect: dbConnectMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    pipeline: redisPipelineFactoryMock,
    multi: redisPipelineFactoryMock,
    incr: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    eval: redisEvalMock,
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

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: loggerWarnMock,
  },
}));


import { runScoringPipeline, getLastScoringRunAt, __resetPipelineState } from '../src/scoring/pipeline.js';
import { config } from '../src/config.js';
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
    expire: pipelineExpireMock.mockReturnThis(),
    zadd: pipelineZaddMock.mockReturnThis(),
    set: pipelineSetMock.mockReturnThis(),
    exec: pipelineExecMock.mockResolvedValue([]),
  };
  redisPipelineFactoryMock.mockReturnValue(pipeline);
  redisEvalMock.mockResolvedValue(1);
  clientQueryMock.mockImplementation((sql: string) => {
    if (sql.includes('pending_rescore_generation')) {
      return Promise.resolve({ rows: [{ pending_rescore_generation: null }] });
    }
    return Promise.resolve({ rows: [] });
  });
  dbConnectMock.mockResolvedValue({ query: clientQueryMock, release: clientReleaseMock });

  getCurrentContentRulesMock.mockResolvedValue({
    includeKeywords: [],
    excludeKeywords: [],
  });
  hasActiveContentRulesMock.mockReturnValue(false);
  updateScoringStatusMock.mockResolvedValue(undefined);
}

function findEpochMetricsInsertParams(): unknown[] {
  const metricsCall = dbQueryMock.mock.calls.find(
    (call: unknown[]) => String(call[0]).includes('INSERT INTO epoch_metrics')
  );
  expect(metricsCall).toBeDefined();
  return metricsCall?.[1] as unknown[];
}

function queryWasCalledWith(fragment: string): boolean {
  return dbQueryMock.mock.calls.some((call: unknown[]) => String(call[0]).includes(fragment));
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

  it('keeps the scoring run successful when snapshot invalidation fails after Redis write', async () => {
    redisEvalMock
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('redis eval unavailable'));
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          post_uri: 'at://did:plc:test/post/1',
          total_score: 0.5,
          author_did: 'did:plc:author',
          bridging_score: 0.3,
          engagement_score: 0.4,
          embed_url: null,
          text_length: 20,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    await runScoringPipeline();

    expect(pipelineExecMock).toHaveBeenCalledTimes(1);
    expect(updateScoringStatusMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        epochId: 2,
        err: expect.any(Error),
        runId: expect.any(String),
      }),
      'Failed to invalidate current feed snapshot cache after feed write'
    );
  });

  it('skips overlapping triggers until a timed-out scoring run actually settles', async () => {
    vi.useFakeTimers();
    try {
      let resolveEpoch: ((value: { rows: ReturnType<typeof makeEpochRow>[] }) => void) | null = null;
      const pendingEpoch = new Promise<{ rows: ReturnType<typeof makeEpochRow>[] }>((resolve) => {
        resolveEpoch = resolve;
      });
      dbQueryMock.mockImplementationOnce(() => pendingEpoch);
      dbQueryMock.mockResolvedValue({ rows: [] });

      const timedOutRun = runScoringPipeline();
      const timedOutResult = timedOutRun.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(0);
      expect(dbQueryMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(240_000);
      expect(await timedOutResult).toEqual(expect.objectContaining({ message: 'Scoring pipeline timed out' }));

      await runScoringPipeline();
      expect(loggerWarnMock).toHaveBeenCalledWith('Scoring pipeline already running; skipping overlapping trigger');
      expect(dbQueryMock).toHaveBeenCalledTimes(1);

      resolveEpoch?.({ rows: [makeEpochRow()] });
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();

      const callCountBeforeFreshRun = dbQueryMock.mock.calls.length;
      await runScoringPipeline();
      expect(dbQueryMock.mock.calls.length).toBeGreaterThan(callCountBeforeFreshRun);
    } finally {
      vi.useRealTimers();
    }
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
      // storeScore: wide-row upsert into post_scores
      .mockResolvedValueOnce({ rows: [] })
      // storeScore: long-table dual-write into post_score_components (PROJ-814)
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

    const currentZaddCall = pipelineZaddMock.mock.calls.find(
      (call: unknown[]) => String(call[0]).startsWith('feed:staging:current:')
    );
    expect(currentZaddCall).toBeDefined();
    const stagedCurrentKey = String(currentZaddCall?.[0]);
    const runId = stagedCurrentKey.slice('feed:staging:current:'.length);
    expect(runId).not.toBe('');
    const stagedLastKnownGoodKey = `feed:staging:last_known_good:${runId}`;
    const stagedMetadataKeys = Array.from(
      { length: 7 },
      (_value, index) => `feed:staging:metadata:${runId}:${index}`
    );
    const stagedKeys = [stagedCurrentKey, stagedLastKnownGoodKey, ...stagedMetadataKeys];

    // Redis should have the post from DB, not just from the in-memory scored array.
    expect(pipelineZaddMock).toHaveBeenCalledWith(stagedCurrentKey, 0.5, postRow.uri);
    expect(pipelineZaddMock).toHaveBeenCalledWith(stagedLastKnownGoodKey, 0.5, postRow.uri);
    expect(pipelineExpireMock).toHaveBeenCalledTimes(9);
    const expectedStagingTtlSeconds = Math.ceil((config.SCORING_TIMEOUT_MS * 2) / 1000);
    expect(pipelineExpireMock.mock.calls).toEqual(
      stagedKeys.map((key) => [key, expectedStagingTtlSeconds])
    );
    expect(redisEvalMock).toHaveBeenCalledWith(
      expect.any(String),
      18,
      ...stagedKeys,
      'feed:current',
      'feed:last_known_good',
      'feed:epoch',
      'feed:run_id',
      'feed:updated_at',
      'feed:count',
      'feed:last_known_good_epoch',
      'feed:last_known_good_run_id',
      'feed:last_known_good_count',
      '9'
    );
  });

  it('materializes current feed stats after writing Redis feed', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            post_uri: 'at://did:plc:test/post/1',
            total_score: '0.9',
            author_did: 'did:plc:author-a',
            bridging_score: '0.8',
            engagement_score: '0.4',
            embed_url: null,
            text_length: '120',
          },
          {
            post_uri: 'at://did:plc:test/post/2',
            total_score: '0.5',
            author_did: 'did:plc:author-b',
            bridging_score: '0.2',
            engagement_score: '0.6',
            embed_url: null,
            text_length: '100',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await runScoringPipeline();

    const [
      epochId,
      authorGini,
      avgBridging,
      medianBridging,
      avgEngagement,
      medianTotal,
      totalPostsScored,
      uniqueAuthors,
      runId,
    ] = findEpochMetricsInsertParams();
    expect(epochId).toBe(2);
    expect(authorGini).toBe(0);
    expect(avgBridging).toBe(0.5);
    expect(medianBridging).toBe(0.5);
    expect(avgEngagement).toBe(0.5);
    expect(medianTotal).toBe(0.7);
    expect(totalPostsScored).toBe(2);
    expect(uniqueAuthors).toBe(2);
    expect(typeof runId).toBe('string');
    expect(queryWasCalledWith('DELETE FROM epoch_metrics')).toBe(true);
    expect(queryWasCalledWith("metrics_source = 'current_feed'")).toBe(true);
  });

  it('materializes non-zero author concentration for skewed current feed authors', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            post_uri: 'at://did:plc:test/post/1',
            total_score: '0.9',
            author_did: 'did:plc:author-a',
            bridging_score: '0.8',
            engagement_score: '0.4',
            embed_url: null,
            text_length: '120',
          },
          {
            post_uri: 'at://did:plc:test/post/2',
            total_score: '0.7',
            author_did: 'did:plc:author-a',
            bridging_score: '0.6',
            engagement_score: '0.5',
            embed_url: null,
            text_length: '110',
          },
          {
            post_uri: 'at://did:plc:test/post/3',
            total_score: '0.5',
            author_did: 'did:plc:author-b',
            bridging_score: '0.2',
            engagement_score: '0.6',
            embed_url: null,
            text_length: '100',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await runScoringPipeline();

    const [
      epochId,
      authorGini,
      avgBridging,
      medianBridging,
      avgEngagement,
      medianTotal,
      totalPostsScored,
      uniqueAuthors,
    ] = findEpochMetricsInsertParams();
    expect(epochId).toBe(2);
    expect(Number(authorGini)).toBeGreaterThan(0);
    expect(avgBridging).toBeCloseTo(0.533333, 5);
    expect(medianBridging).toBe(0.6);
    expect(avgEngagement).toBe(0.5);
    expect(medianTotal).toBe(0.7);
    expect(totalPostsScored).toBe(3);
    expect(uniqueAuthors).toBe(2);
  });

  it('skips the current-feed metrics write when publication is skipped', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await runScoringPipeline();

    expect(queryWasCalledWith('INSERT INTO epoch_metrics')).toBe(false);
    expect(queryWasCalledWith('current_scoring_run')).toBe(true);
    expect(redisPipelineFactoryMock).not.toHaveBeenCalled();
    expect(redisEvalMock).not.toHaveBeenCalled();
  });

  it('keeps scoring successful when current feed metrics materialization fails', async () => {
    const metricsError = new Error('epoch_metrics insert failed');
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          post_uri: 'at://did:plc:test/post/metrics',
          total_score: 0.5,
          author_did: 'did:plc:author',
          bridging_score: 0.3,
          engagement_score: 0.4,
          embed_url: null,
          text_length: 20,
        }],
      })
      .mockRejectedValueOnce(metricsError)
      .mockResolvedValueOnce({ rows: [] });

    await runScoringPipeline();

    expect(updateScoringStatusMock).toHaveBeenCalledTimes(1);
    expect(queryWasCalledWith('current_scoring_run')).toBe(true);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        err: metricsError,
        epochId: 2,
        runId: expect.any(String),
      }),
      'Failed to update epoch transparency metrics'
    );
  });

  it('falls back to zero when materializing malformed current feed numeric fields', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            post_uri: 'at://did:plc:test/post/malformed',
            total_score: 'not-a-number',
            author_did: 'did:plc:author-a',
            bridging_score: 'also-not-a-number',
            engagement_score: '0.6',
            embed_url: null,
            text_length: 'still-not-a-number',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await runScoringPipeline();

    const [
      epochId,
      authorGini,
      avgBridging,
      medianBridging,
      avgEngagement,
      medianTotal,
      totalPostsScored,
      uniqueAuthors,
    ] = findEpochMetricsInsertParams();
    expect(epochId).toBe(2);
    expect(authorGini).toBe(0);
    expect(avgBridging).toBe(0);
    expect(medianBridging).toBe(0);
    expect(avgEngagement).toBe(0.6);
    expect(medianTotal).toBe(0);
    expect(totalPostsScored).toBe(1);
    expect(uniqueAuthors).toBe(1);
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
