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
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    pipeline: redisPipelineFactoryMock,
    multi: redisPipelineFactoryMock,
    incr: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock('../src/governance/content-filter.js', () => ({
  getCurrentContentRules: getCurrentContentRulesMock,
  hasActiveContentRules: hasActiveContentRulesMock,
  filterPosts: vi.fn(),
}));

vi.mock('../src/admin/status-tracker.js', () => ({
  updateScoringStatus: updateScoringStatusMock,
}));

import {
  runScoringPipeline,
  requestFullRescore,
  __resetPipelineState,
} from '../src/scoring/pipeline.js';
import { buildEpochRow } from './helpers/index.js';

function makeEpochRow(id = 2) {
  return buildEpochRow({ id });
}

function setupDefaultMocks() {
  const pipeline = {
    del: pipelineDelMock.mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
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

/** Run a pipeline cycle that returns no posts (fast, sets internal state). */
async function runEmptyCycle(epochId = 2) {
  dbQueryMock
    .mockResolvedValueOnce({ rows: [makeEpochRow(epochId)] }) // getActiveEpoch
    .mockResolvedValueOnce({ rows: [] })                       // posts query
    .mockResolvedValueOnce({ rows: [] })                       // writeToRedisFromDb
    .mockResolvedValueOnce({ rows: [] });                      // updateCurrentRunScope
  await runScoringPipeline();
}

/** Check whether the posts query used full mode (no UNION ALL) or incremental (UNION ALL). */
function getPostsQueryMode(): 'full' | 'incremental' {
  const postsQuery = String(dbQueryMock.mock.calls[1][0]);
  return postsQuery.includes('UNION ALL') ? 'incremental' : 'full';
}

describe('periodic full rescore for recency decay', () => {
  beforeEach(() => {
    __resetPipelineState();
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('first run is always full mode', async () => {
    await runEmptyCycle();
    expect(getPostsQueryMode()).toBe('full');
  });

  it('runs incremental for N-1 cycles after a full rescore', async () => {
    // First run: full (sets lastSuccessfulRunAt)
    await runEmptyCycle();

    // Runs 2-6 should be incremental (SCORING_FULL_RESCORE_INTERVAL defaults to 6)
    for (let i = 1; i <= 5; i++) {
      dbQueryMock.mockReset();
      setupDefaultMocks();
      await runEmptyCycle();
      expect(getPostsQueryMode()).toBe('incremental');
    }
  });

  it('triggers full rescore after SCORING_FULL_RESCORE_INTERVAL incremental runs', async () => {
    // Run 1: full (first run)
    await runEmptyCycle();

    // Runs 2-7: incremental (6 incremental runs, counter goes 0→5)
    for (let i = 0; i < 6; i++) {
      dbQueryMock.mockReset();
      setupDefaultMocks();
      await runEmptyCycle();
    }

    // Run 8: should be full (counter reached 6 = SCORING_FULL_RESCORE_INTERVAL)
    dbQueryMock.mockReset();
    setupDefaultMocks();
    await runEmptyCycle();
    expect(getPostsQueryMode()).toBe('full');
  });

  it('resets counter after a full rescore and starts incremental again', async () => {
    // Run 1: full (first run)
    await runEmptyCycle();

    // 6 incremental runs to trigger periodic full rescore
    for (let i = 0; i < 6; i++) {
      dbQueryMock.mockReset();
      setupDefaultMocks();
      await runEmptyCycle();
    }

    // Periodic full rescore (run 8)
    dbQueryMock.mockReset();
    setupDefaultMocks();
    await runEmptyCycle();
    expect(getPostsQueryMode()).toBe('full');

    // Run 9: counter reset, should be incremental again
    dbQueryMock.mockReset();
    setupDefaultMocks();
    await runEmptyCycle();
    expect(getPostsQueryMode()).toBe('incremental');
  });

  it('epoch change triggers full mode regardless of counter', async () => {
    // Run 1: full (epoch 2)
    await runEmptyCycle(2);

    // Run 2: incremental (same epoch)
    dbQueryMock.mockReset();
    setupDefaultMocks();
    await runEmptyCycle(2);
    expect(getPostsQueryMode()).toBe('incremental');

    // Run 3: epoch changed to 3 → full rescore regardless of counter
    dbQueryMock.mockReset();
    setupDefaultMocks();
    await runEmptyCycle(3);
    expect(getPostsQueryMode()).toBe('full');
  });

  it('epoch change resets the incremental counter', async () => {
    // Run 1: full (epoch 2)
    await runEmptyCycle(2);

    // 4 incremental runs (counter at 4)
    for (let i = 0; i < 4; i++) {
      dbQueryMock.mockReset();
      setupDefaultMocks();
      await runEmptyCycle(2);
    }

    // Epoch change → full rescore, resets counter to 0
    dbQueryMock.mockReset();
    setupDefaultMocks();
    await runEmptyCycle(3);
    expect(getPostsQueryMode()).toBe('full');

    // Next run should be incremental (counter was reset to 0)
    dbQueryMock.mockReset();
    setupDefaultMocks();
    await runEmptyCycle(3);
    expect(getPostsQueryMode()).toBe('incremental');
  });

  it('runs a full pass after policy changes within the same epoch', async () => {
    await runEmptyCycle(2);

    dbQueryMock.mockReset();
    setupDefaultMocks();
    await runEmptyCycle(2);
    expect(getPostsQueryMode()).toBe('incremental');

    requestFullRescore();

    dbQueryMock.mockReset();
    setupDefaultMocks();
    await runEmptyCycle(2);
    expect(getPostsQueryMode()).toBe('full');

    dbQueryMock.mockReset();
    setupDefaultMocks();
    await runEmptyCycle(2);
    expect(getPostsQueryMode()).toBe('incremental');
  });

  it('keeps a full-rescore request pending when the attempted run fails', async () => {
    await runEmptyCycle(2);
    requestFullRescore();

    dbQueryMock.mockReset();
    setupDefaultMocks();
    dbQueryMock.mockRejectedValueOnce(new Error('epoch read failed'));
    await expect(runScoringPipeline()).rejects.toThrow('epoch read failed');

    dbQueryMock.mockReset();
    setupDefaultMocks();
    await runEmptyCycle(2);
    expect(getPostsQueryMode()).toBe('full');
  });

  it('does not consume a policy change requested during an in-flight run', async () => {
    await runEmptyCycle(2);

    let releaseContentRules: ((value: { includeKeywords: string[]; excludeKeywords: string[] }) => void) | null = null;
    const pendingContentRules = new Promise<{ includeKeywords: string[]; excludeKeywords: string[] }>((resolve) => {
      releaseContentRules = resolve;
    });

    dbQueryMock.mockReset();
    setupDefaultMocks();
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow(2)] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    getCurrentContentRulesMock.mockReturnValueOnce(pendingContentRules);

    const inFlightRun = runScoringPipeline();
    await vi.waitFor(() => {
      expect(getCurrentContentRulesMock).toHaveBeenCalled();
    });
    requestFullRescore();
    releaseContentRules?.({ includeKeywords: [], excludeKeywords: [] });
    await inFlightRun;
    expect(getPostsQueryMode()).toBe('incremental');

    dbQueryMock.mockReset();
    setupDefaultMocks();
    await runEmptyCycle(2);
    expect(getPostsQueryMode()).toBe('full');
  });

  it('__resetPipelineState resets the incremental counter', async () => {
    // Run 1: full
    await runEmptyCycle();

    // 5 incremental runs
    for (let i = 0; i < 5; i++) {
      dbQueryMock.mockReset();
      setupDefaultMocks();
      await runEmptyCycle();
    }

    // Reset state (simulates server restart)
    __resetPipelineState();

    // Next run should be full (first run after reset)
    dbQueryMock.mockReset();
    setupDefaultMocks();
    await runEmptyCycle();
    expect(getPostsQueryMode()).toBe('full');
  });
});
