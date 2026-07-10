import { describe, expect, it, vi } from 'vitest';
import {
  materializeCommunityFeed,
  postMatchesBridgeTerms,
  postMatchesCommunityTerms,
  scoutCommunityFeed,
  type CommunityMaterializerRedis,
} from '../src/feed/community-materializer.js';
import {
  getFeedCommunities,
  resolveFeedCommunityByRkey,
} from '../src/feed/community-registry.js';

function birdersCommunity() {
  const community = resolveFeedCommunityByRkey('birders-who-code', getFeedCommunities());
  if (!community) {
    throw new Error('Birders community fixture missing from registry');
  }
  return community;
}

function communityGovCommunity() {
  const community = resolveFeedCommunityByRkey('community-gov', getFeedCommunities());
  if (!community) {
    throw new Error('community-gov fixture missing from registry');
  }
  return community;
}

function buildDbMock(rows: unknown[]) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  };
}

function buildRedisMock(): {
  redisClient: CommunityMaterializerRedis;
  calls: Array<{ command: string; args: unknown[] }>;
  setCommandError: (error: Error | null) => void;
} {
  const calls: Array<{ command: string; args: unknown[] }> = [];
  let commandError: Error | null = null;
  const transaction = {
    del(key: string) {
      calls.push({ command: 'del', args: [key] });
      return transaction;
    },
    zadd(key: string, score: number, member: string) {
      calls.push({ command: 'zadd', args: [key, score, member] });
      return transaction;
    },
    set(key: string, value: string) {
      calls.push({ command: 'set', args: [key, value] });
      return transaction;
    },
    incr(key: string) {
      calls.push({ command: 'incr', args: [key] });
      return transaction;
    },
    async exec() {
      const queuedCommands = calls.length;
      calls.push({ command: 'exec', args: [] });
      return Array.from({ length: queuedCommands }, (_unused, index) => [
        index === 0 ? commandError : null,
        index === 0 && commandError ? null : 'OK',
      ] as [Error | null, unknown]);
    },
  };
  return {
    redisClient: {
      multi() {
        return transaction;
      },
    },
    calls,
    setCommandError(error: Error | null) {
      commandError = error;
    },
  };
}

describe('Birders feed readiness materializer', () => {
  it('matches Birders and bridge terms without requiring Bluesky-specific fake data', () => {
    const community = birdersCommunity();

    expect(postMatchesCommunityTerms('Warbler field notes exported to a tiny CSV script.', community)).toBe(true);
    expect(postMatchesBridgeTerms('Warbler field notes exported to a tiny CSV script.', community)).toBe(true);
    expect(postMatchesCommunityTerms('A general product launch thread with no relevant terms.', community)).toBe(false);
  });

  it('builds a scout report from production-scored Birders candidates', async () => {
    const community = birdersCommunity();
    const dbPool = buildDbMock([
      {
        uri: 'at://did:plc:a/app.bsky.feed.post/1',
        author_did: 'did:plc:a',
        text: 'Warbler migration notes with a messy CSV export.',
        active_epoch_id: 12,
        recency_score: 0.5,
        engagement_score: 0.2,
        bridging_score: 0.9,
        source_diversity_score: 0.7,
        relevance_score: 0.95,
        community_score: 0.73,
        candidate_count: 150,
        unique_author_count: 60,
        bridge_post_count: 45,
        strong_bridge_high_relevance_count: 33,
        top_author_post_count: 12,
      },
      {
        uri: 'at://did:plc:b/app.bsky.feed.post/2',
        author_did: 'did:plc:b',
        text: 'Finch sighting and binocular notes from the park.',
        active_epoch_id: 12,
        recency_score: 0.7,
        engagement_score: 0.1,
        bridging_score: 0.3,
        source_diversity_score: 0.6,
        relevance_score: 0.9,
        community_score: 0.592,
        candidate_count: 150,
        unique_author_count: 60,
        bridge_post_count: 45,
        strong_bridge_high_relevance_count: 33,
        top_author_post_count: 12,
      },
    ]);

    const report = await scoutCommunityFeed({
      community,
      dbPool,
      now: new Date('2026-07-09T20:00:00.000Z'),
      windowHours: 72,
      limit: 50,
    });

    expect(report).toMatchObject({
      communityId: 'birders_who_code',
      activeEpochId: 12,
      candidatePosts: 150,
      candidatePostsPerDay: 50,
      uniqueAuthors: 60,
      uniqueAuthorsPerDay: 20,
      bridgePostShare: 0.3,
      topAuthorConcentration: 0.08,
      strongBridgeHighRelevancePosts: 33,
      strongBridgeHighRelevancePostsPerDay: 11,
      status: 'thin',
    });
    expect(report.samplePostUris).toEqual([
      'at://did:plc:a/app.bsky.feed.post/1',
      'at://did:plc:b/app.bsky.feed.post/2',
    ]);
    expect(dbPool.query).toHaveBeenCalledWith(
      expect.stringContaining('JOIN post_scores ps ON ps.post_uri = mp.uri AND ps.epoch_id = ae.id'),
      expect.arrayContaining([72, expect.arrayContaining(['%birding%', '%python%'])])
    );
  });

  it('reports a thin active epoch instead of unavailable when Birders has zero matching candidates', async () => {
    const community = birdersCommunity();
    const dbPool = buildDbMock([
      {
        uri: null,
        author_did: null,
        text: null,
        active_epoch_id: 12,
        recency_score: null,
        engagement_score: null,
        bridging_score: null,
        source_diversity_score: null,
        relevance_score: null,
        community_score: null,
        candidate_count: 0,
        unique_author_count: 0,
        bridge_post_count: 0,
        strong_bridge_high_relevance_count: 0,
        top_author_post_count: 0,
      },
    ]);

    const report = await scoutCommunityFeed({
      community,
      dbPool,
      now: new Date('2026-07-09T20:00:00.000Z'),
      windowHours: 72,
      limit: 50,
    });

    expect(report).toMatchObject({
      activeEpochId: 12,
      candidatePosts: 0,
      uniqueAuthors: 0,
      status: 'thin',
    });
    expect(report.samplePostUris).toEqual([]);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        'Birders supply is below the readiness threshold; keep the feed disabled.',
        'Candidate volume 0.0/day is below 100/day.',
      ])
    );
  });

  it('reports unavailable when there is no active production epoch', async () => {
    const community = birdersCommunity();
    const dbPool = buildDbMock([
      {
        uri: null,
        author_did: null,
        text: null,
        active_epoch_id: null,
        recency_score: null,
        engagement_score: null,
        bridging_score: null,
        source_diversity_score: null,
        relevance_score: null,
        community_score: null,
        candidate_count: 0,
        unique_author_count: 0,
        bridge_post_count: 0,
        strong_bridge_high_relevance_count: 0,
        top_author_post_count: 0,
      },
    ]);

    const report = await scoutCommunityFeed({
      community,
      dbPool,
      now: new Date('2026-07-09T20:00:00.000Z'),
      windowHours: 72,
      limit: 50,
    });

    expect(report).toMatchObject({
      activeEpochId: null,
      status: 'unavailable',
    });
    expect(report.warnings).toContain(
      'No active production epoch was available for Birders materialization.'
    );
  });

  it('materializes only namespaced Birders Redis keys and leaves production feed keys untouched', async () => {
    const community = birdersCommunity();
    const dbPool = buildDbMock([
      {
        uri: 'at://did:plc:b/app.bsky.feed.post/2',
        author_did: 'did:plc:b',
        text: 'Finch sighting and binocular notes from the park.',
        active_epoch_id: 12,
        recency_score: 0.7,
        engagement_score: 0.1,
        bridging_score: 0.3,
        source_diversity_score: 0.6,
        relevance_score: 0.9,
        community_score: 0.592,
        candidate_count: 2,
        unique_author_count: 2,
        bridge_post_count: 1,
        strong_bridge_high_relevance_count: 1,
        top_author_post_count: 1,
      },
      {
        uri: 'at://did:plc:a/app.bsky.feed.post/1',
        author_did: 'did:plc:a',
        text: 'Warbler migration notes with a messy CSV export.',
        active_epoch_id: 12,
        recency_score: 0.5,
        engagement_score: 0.2,
        bridging_score: 0.9,
        source_diversity_score: 0.7,
        relevance_score: 0.95,
        community_score: 0.73,
        candidate_count: 2,
        unique_author_count: 2,
        bridge_post_count: 1,
        strong_bridge_high_relevance_count: 1,
        top_author_post_count: 1,
      },
    ]);
    const { redisClient, calls } = buildRedisMock();

    const result = await materializeCommunityFeed({
      community,
      dbPool,
      redisClient,
      now: new Date('2026-07-09T20:00:00.000Z'),
      windowHours: 72,
      limit: 50,
    });

    expect(result.rankedCount).toBe(2);
    expect(calls.filter((call) => call.command === 'zadd')).toEqual([
      {
        command: 'zadd',
        args: ['feed:community:birders_who_code:current', 0.73, 'at://did:plc:a/app.bsky.feed.post/1'],
      },
      {
        command: 'zadd',
        args: ['feed:community:birders_who_code:current', 0.592, 'at://did:plc:b/app.bsky.feed.post/2'],
      },
    ]);
    expect(calls.map((call) => call.args[0]).filter((key): key is string => typeof key === 'string')).toEqual(
      expect.arrayContaining([
        'feed:community:birders_who_code:current',
        'feed:community:birders_who_code:epoch',
        'feed:community:birders_who_code:health',
        'feed:community:birders_who_code:snapshot_generation',
        'feed:community:birders_who_code:current_snapshot_id',
      ])
    );
    expect(calls.map((call) => call.args[0])).not.toContain('feed:current');
    expect(calls.map((call) => call.args[0])).not.toContain('feed:epoch');
    expect(calls.map((call) => call.command)).toContain('exec');
  });

  it('rejects community-gov so the readiness materializer cannot overwrite production feed keys', async () => {
    const dbPool = buildDbMock([]);
    const { redisClient, calls } = buildRedisMock();

    await expect(
      materializeCommunityFeed({
        community: communityGovCommunity(),
        dbPool,
        redisClient,
        now: new Date('2026-07-09T20:00:00.000Z'),
        windowHours: 72,
        limit: 50,
      })
    ).rejects.toThrow('only supports birders_who_code');
    expect(dbPool.query).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('surfaces Redis transaction command failures instead of reporting a successful feed write', async () => {
    const community = birdersCommunity();
    const dbPool = buildDbMock([
      {
        uri: 'at://did:plc:a/app.bsky.feed.post/1',
        author_did: 'did:plc:a',
        text: 'Open bird-call dataset and classifier notes.',
        active_epoch_id: 12,
        recency_score: 0.5,
        engagement_score: 0.2,
        bridging_score: 0.9,
        source_diversity_score: 0.7,
        relevance_score: 0.95,
        community_score: 0.73,
        candidate_count: 1,
        unique_author_count: 1,
        bridge_post_count: 1,
        strong_bridge_high_relevance_count: 1,
        top_author_post_count: 1,
      },
    ]);
    const { redisClient, setCommandError } = buildRedisMock();
    setCommandError(new Error('simulated Redis command failure'));

    await expect(materializeCommunityFeed({
      community,
      dbPool,
      redisClient,
      now: new Date('2026-07-09T20:00:00.000Z'),
      windowHours: 72,
      limit: 50,
    })).rejects.toThrow('simulated Redis command failure');
  });
});
