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
    incr: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(1),
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

import { runScoringPipeline, __resetPipelineState } from '../src/scoring/pipeline.js';

function makeEpochRow() {
  return {
    id: 2,
    status: 'active',
    recency_weight: 0.2,
    engagement_weight: 0.2,
    bridging_weight: 0.2,
    source_diversity_weight: 0.2,
    relevance_weight: 0.2,
    vote_count: 10,
    created_at: new Date().toISOString(),
    closed_at: null,
    description: 'test epoch',
  };
}

function makePostRow() {
  return {
    uri: 'at://did:plc:test/post/1',
    cid: 'bafytest',
    author_did: 'did:plc:author',
    text: 'hello world',
    reply_root: null,
    reply_parent: null,
    langs: ['en'],
    has_media: false,
    created_at: new Date().toISOString(),
    like_count: 1,
    repost_count: 0,
    reply_count: 0,
  };
}

describe('scoring pipeline empty-feed Redis updates', () => {
  beforeEach(() => {
    __resetPipelineState();
    dbQueryMock.mockReset();
    redisPipelineFactoryMock.mockReset();
    pipelineDelMock.mockReset();
    pipelineZaddMock.mockReset();
    pipelineSetMock.mockReset();
    pipelineExecMock.mockReset();
    getCurrentContentRulesMock.mockReset();
    hasActiveContentRulesMock.mockReset();
    filterPostsMock.mockReset();
    updateScoringStatusMock.mockReset();

    const pipeline = {
      del: pipelineDelMock.mockReturnThis(),
      zadd: pipelineZaddMock.mockReturnThis(),
      set: pipelineSetMock.mockReturnThis(),
      exec: pipelineExecMock.mockResolvedValue([]),
    };
    redisPipelineFactoryMock.mockReturnValue(pipeline);
  });

  it('clears feed and writes metadata when all posts are filtered out', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow()] })   // getActiveEpoch
      .mockResolvedValueOnce({ rows: [makePostRow()] })     // getPostsForScoring
      .mockResolvedValueOnce({ rows: [] })                   // writeToRedisFromDb
      .mockResolvedValueOnce({ rows: [] });                  // updateCurrentRunScope

    getCurrentContentRulesMock.mockResolvedValue({
      includeKeywords: ['topic'],
      excludeKeywords: [],
    });
    hasActiveContentRulesMock.mockReturnValue(true);
    filterPostsMock.mockReturnValue({
      passed: [],
      filtered: [{ post: makePostRow(), reason: 'no_include_match' }],
    });

    await runScoringPipeline();

    expect(pipelineDelMock).toHaveBeenCalledWith('feed:current');
    expect(pipelineSetMock).toHaveBeenCalledWith('feed:epoch', '2');
    expect(pipelineSetMock).toHaveBeenCalledWith('feed:updated_at', expect.any(String));
    expect(pipelineSetMock).toHaveBeenCalledWith('feed:count', '0');
    expect(pipelineZaddMock).not.toHaveBeenCalled();
    expect(updateScoringStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        posts_scored: 0,
        posts_filtered: 1,
      })
    );
  });

  it('clears feed and writes metadata when no posts are fetched', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow()] })   // getActiveEpoch
      .mockResolvedValueOnce({ rows: [] })                   // getPostsForScoring
      .mockResolvedValueOnce({ rows: [] })                   // writeToRedisFromDb
      .mockResolvedValueOnce({ rows: [] });                  // updateCurrentRunScope

    getCurrentContentRulesMock.mockResolvedValue({
      includeKeywords: [],
      excludeKeywords: [],
    });
    hasActiveContentRulesMock.mockReturnValue(false);

    await runScoringPipeline();

    expect(pipelineDelMock).toHaveBeenCalledWith('feed:current');
    expect(pipelineSetMock).toHaveBeenCalledWith('feed:epoch', '2');
    expect(pipelineSetMock).toHaveBeenCalledWith('feed:updated_at', expect.any(String));
    expect(pipelineSetMock).toHaveBeenCalledWith('feed:count', '0');
    expect(pipelineZaddMock).not.toHaveBeenCalled();
    expect(updateScoringStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        posts_scored: 0,
        posts_filtered: 0,
      })
    );
  });

  it('builds SQL keyword prefilter so LIMIT applies to matching posts', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [makeEpochRow()] })   // getActiveEpoch
      .mockResolvedValueOnce({ rows: [] })                   // getPostsForScoring
      .mockResolvedValueOnce({ rows: [] })                   // writeToRedisFromDb
      .mockResolvedValueOnce({ rows: [] });                  // updateCurrentRunScope

    getCurrentContentRulesMock.mockResolvedValue({
      includeKeywords: ['atproto', 'foss'],
      excludeKeywords: ['nsfw', 'porn'],
    });
    hasActiveContentRulesMock.mockReturnValue(false);

    await runScoringPipeline();

    const postsQueryCall = dbQueryMock.mock.calls[1];
    const queryText = String(postsQueryCall[0]);
    const queryParams = postsQueryCall[1] as unknown[];

    expect(queryText).toContain("p.text ILIKE $");
    expect(queryText).toContain('p.text ~* $');
    expect(queryText).toContain('NOT (');
    expect(queryText).toContain('LIMIT $');
    expect(queryParams.at(-1)).toBe(5000);
  });
});
