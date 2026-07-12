import { describe, expect, it } from 'vitest';
import { ShadowDemoService } from '../src/demo/service.js';
import { MemoryDemoStore } from '../src/demo/store.js';
import { registerShadowDemoRoutes, registerShadowDemoV4Routes } from '../src/demo/routes.js';
import type { ShadowDemoCorpus } from '../src/demo/types.js';
import { buildTestApp } from './helpers/index.js';
import { scoreFromRawWeights } from '../src/demo/weights.js';

const NOW = new Date('2026-07-11T22:30:00.000Z');
const TOPIC_SLUGS = [
  'adult-content', 'ai-machine-learning', 'art-creative', 'books-reading', 'climate-environment',
  'cooking-food', 'cybersecurity', 'data-science', 'decentralized-social', 'design-ux',
  'devops-infrastructure', 'dogs-pets', 'education', 'gaming', 'health-fitness',
  'mobile-development', 'music', 'news-journalism', 'open-source', 'politics-governance',
  'science-research', 'software-development', 'space-astronomy', 'startups-business',
  'systems-programming', 'web-development',
] as const;
const TOPICS = TOPIC_SLUGS.map((slug, index) => ({
  slug,
  name: slug.split('-').map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join(' '),
  description: null,
  baselineWeight: Number((0.2 + (index % 7) * 0.1).toFixed(1)),
}));

describe('shadow demo v4 route contract', () => {
  it('preserves published baseline order and requires the complete frozen topic catalog', async () => {
    const app = buildTestApp();
    try {
      const service = new ShadowDemoService({
        store: new MemoryDemoStore(),
        loadCorpus: async () => corpus(),
        now: () => NOW,
      });
      registerShadowDemoRoutes(app, service, null);
      registerShadowDemoV4Routes(app, service, null);

    const wrongContract = await app.inject({
      method: 'POST',
      url: '/api/demo/sessions',
      payload: { communityId: 'community_gov', clientNonce: 'v3-community-gov' },
    });
    expect(wrongContract.statusCode).toBe(400);
    expect(wrongContract.json().message).toContain('only on the v4');

    const created = await app.inject({
      method: 'POST',
      url: '/api/demo/v4/sessions',
      payload: { communityId: 'community_gov', clientNonce: 'v4-baseline' },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().contractVersion).toBe('2026-07-11.shadow-demo.v4');
    const session = created.json().payload.session;
    expect(session.topicCatalog).toEqual(TOPICS);

    const baseline = await app.inject({
      method: 'GET',
      url: `/api/demo/v4/sessions/${session.sessionId}/feed?epochId=${session.currentEpochId}&limit=3`,
    });
    expect(baseline.statusCode).toBe(200);
    expect(baseline.json().payload.posts.map((post: { publishedRank: number; post: { uri: string } }) => [post.publishedRank, post.post.uri])).toEqual([
      [1, postUri(1)], [2, postUri(2)], [3, postUri(3)],
    ]);

    const incomplete = await app.inject({
      method: 'POST',
      url: `/api/demo/v4/sessions/${session.sessionId}/votes`,
      payload: votePayload(session.currentEpochId, { 'science-research': 1 }),
    });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().message).toContain('complete frozen topic catalog');

    const unknown = await app.inject({
      method: 'POST',
      url: `/api/demo/v4/sessions/${session.sessionId}/votes`,
      payload: votePayload(session.currentEpochId, {
        ...Object.fromEntries(TOPICS.map((topic) => [topic.slug, topic.baselineWeight])),
        unknown: 0.5,
      }),
    });
    expect(unknown.statusCode).toBe(400);

    const acceptedPayload = votePayload(session.currentEpochId, Object.fromEntries(TOPICS.map((topic) => [topic.slug, topic.baselineWeight])));
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/demo/v4/sessions/${session.sessionId}/votes`,
      payload: acceptedPayload,
    });
    expect(accepted.statusCode).toBe(200);
    const acceptedReplay = await app.inject({
      method: 'POST',
      url: `/api/demo/v4/sessions/${session.sessionId}/votes`,
      payload: acceptedPayload,
    });
    expect(acceptedReplay.statusCode).toBe(200);
    expect(acceptedReplay.json().payload).toEqual(accepted.json().payload);

    const voterPayload = { baseEpochId: session.currentEpochId, idempotencyKey: 'v4-voters' };
    const voters = await app.inject({
      method: 'POST',
      url: `/api/demo/v4/sessions/${session.sessionId}/agents/run`,
      payload: voterPayload,
    });
    expect(voters.statusCode).toBe(200);
    expect(voters.json().payload.session.pendingAggregate).toMatchObject({ voteCount: 25, trimCount: 2 });
    expect(voters.json().payload.session.voterProfiles.map((profile: { id: string }) => profile.id)).toEqual([
      'freshness_watcher', 'conversation_follower', 'bridge_builder', 'source_diversifier', 'relevance_steward',
    ]);
    const votersReplay = await app.inject({
      method: 'POST',
      url: `/api/demo/v4/sessions/${session.sessionId}/agents/run`,
      payload: voterPayload,
    });
    expect(votersReplay.statusCode).toBe(200);
    expect(votersReplay.json().payload).toEqual(voters.json().payload);

    const advancePayload = { fromEpochId: session.currentEpochId, idempotencyKey: 'v4-advance' };
    const advanced = await app.inject({
      method: 'POST',
      url: `/api/demo/v4/sessions/${session.sessionId}/epochs/advance`,
      payload: advancePayload,
    });
    expect(advanced.statusCode).toBe(200);
    const advancedReplay = await app.inject({
      method: 'POST',
      url: `/api/demo/v4/sessions/${session.sessionId}/epochs/advance`,
      payload: advancePayload,
    });
    expect(advancedReplay.statusCode).toBe(200);
    expect(advancedReplay.json().payload).toEqual(advanced.json().payload);
    const shadowEpochId = advanced.json().payload.session.currentEpochId;
    const reranked = await app.inject({
      method: 'GET',
      url: `/api/demo/v4/sessions/${session.sessionId}/feed?epochId=${shadowEpochId}&limit=3`,
    });
    expect(reranked.statusCode).toBe(200);
    expect(reranked.json().payload.posts.every((post: { publishedRank: number }) => post.publishedRank > 0)).toBe(true);
    for (const limit of [0, -1, 13, 1000]) {
      const invalidFeed = await app.inject({
        method: 'GET',
        url: `/api/demo/v4/sessions/${session.sessionId}/feed?epochId=${shadowEpochId}&limit=${limit}`,
      });
      expect(invalidFeed.statusCode).toBe(400);
    }
    const selected = reranked.json().payload.posts[0];
    const receipt = await app.inject({
      method: 'GET',
      url: `/api/demo/v4/sessions/${session.sessionId}/receipts?epochId=${shadowEpochId}&postUri=${encodeURIComponent(selected.post.uri)}`,
    });
    expect(receipt.statusCode).toBe(200);
    expect(receipt.json().payload.receipt).toMatchObject({
      epochId: shadowEpochId,
      postUri: selected.post.uri,
      aggregate: { voteCount: 25, trimCount: 2 },
      publishedRank: selected.publishedRank,
      publicationAdjustment: expect.any(Number),
      componentScore: expect.any(Number),
      provenance: {
        sourceFeedName: 'Community Governed Feed',
        sourceRunId: 'run-1',
        sourceSnapshotDigest: 'a'.repeat(64),
      },
    });
    const outsideReceipt = await app.inject({
      method: 'GET',
      url: `/api/demo/v4/sessions/${session.sessionId}/receipts?epochId=${shadowEpochId}&postUri=${encodeURIComponent('at://did:plc:outside/app.bsky.feed.post/outside')}`,
    });
    expect(outsideReceipt.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('rejects a duplicate frozen topic catalog before accepting a vote', async () => {
    const app = buildTestApp();
    try {
      const duplicateCatalogCorpus = corpus();
      duplicateCatalogCorpus.topicCatalog = [...TOPICS];
      duplicateCatalogCorpus.topicCatalog[25] = { ...TOPICS[0] };
      const service = new ShadowDemoService({
        store: new MemoryDemoStore(),
        loadCorpus: async () => duplicateCatalogCorpus,
        now: () => NOW,
      });
      registerShadowDemoV4Routes(app, service, null);
      const created = await app.inject({
        method: 'POST',
        url: '/api/demo/v4/sessions',
        payload: { communityId: 'community_gov', clientNonce: 'v4-duplicate-topics' },
      });
      expect(created.statusCode).toBe(200);
      const session = created.json().payload.session;
      const vote = await app.inject({
        method: 'POST',
        url: `/api/demo/v4/sessions/${session.sessionId}/votes`,
        payload: votePayload(
          session.currentEpochId,
          Object.fromEntries(TOPICS.map((topic) => [topic.slug, topic.baselineWeight]))
        ),
      });
      expect(vote.statusCode).toBe(400);
      expect(vote.json().message).toContain('unique topic slugs');
    } finally {
      await app.close();
    }
  });

  it('preserves the baseline adjustment and recomputes URL dedup once in shadow epochs', async () => {
    const adjustedCorpus = corpus();
    const adjustments = [0.8, 0.6] as const;
    for (const [index, adjustment] of adjustments.entries()) {
      const target = adjustedCorpus.items[index];
      target.publicationAdjustment = adjustment;
      target.embedUrl = 'https://example.com/shared-report';
      target.textLength = 20;
      target.publishedScore = scoreFromRawWeights(
        target.rawScores,
        adjustedCorpus.baseWeights,
        target.topicVector,
        adjustedCorpus.baseTopicIntent
      ).score * adjustment;
    }
    const service = new ShadowDemoService({
      store: new MemoryDemoStore(),
      loadCorpus: async () => adjustedCorpus,
      now: () => NOW,
    });
    const created = await service.createSession({ communityId: 'community_gov', clientNonce: 'adjustment-chain' });
    const session = created.payload.session;
    const baselineReceipt = await service.getReceipt({
      sessionId: session.sessionId,
      epochId: session.currentEpochId,
      postUri: adjustedCorpus.items[0].postUri,
    });
    expect(baselineReceipt.payload.receipt.publicationAdjustment).toBeCloseTo(adjustments[0], 12);
    expect(baselineReceipt.payload.receipt.score).toBeCloseTo(
      baselineReceipt.payload.receipt.componentScore * adjustments[0],
      12
    );

    await service.castVote({
      sessionId: session.sessionId,
      baseEpochId: session.currentEpochId,
      weights: adjustedCorpus.baseWeights,
      topicIntent: adjustedCorpus.baseTopicIntent,
      idempotencyKey: 'adjustment-vote',
    });
    await service.runSyntheticVoters({
      sessionId: session.sessionId,
      baseEpochId: session.currentEpochId,
      idempotencyKey: 'adjustment-voters',
    });
    const advanced = await service.advanceEpoch({
      sessionId: session.sessionId,
      fromEpochId: session.currentEpochId,
      idempotencyKey: 'adjustment-advance',
    });
    const shadowEpochId = advanced.payload.session.currentEpochId;
    const shadowReceipts = await Promise.all(adjustedCorpus.items.slice(0, 2).map((target) => service.getReceipt({
      sessionId: session.sessionId,
      epochId: shadowEpochId,
      postUri: target.postUri,
    })));
    const ordered = shadowReceipts
      .map((result) => result.payload.receipt)
      .sort((left, right) => left.visibleRank - right.visibleRank);
    expect(ordered[0].publicationAdjustment).toBeCloseTo(1, 12);
    expect(ordered[1].publicationAdjustment).toBeCloseTo(0.7, 12);
    for (const receipt of ordered) {
      expect(receipt.score).toBeCloseTo(
        receipt.componentScore * receipt.publicationAdjustment,
        12
      );
    }
  });

  it('applies the frozen production relevance floor to shadow epochs', async () => {
    const floorCorpus = corpus();
    floorCorpus.sourceSnapshot!.publicationPolicy.minimumRelevance = 0.9;
    for (const target of floorCorpus.items) {
      target.topicVector = { 'science-research': 0.1 };
    }
    const service = new ShadowDemoService({
      store: new MemoryDemoStore(),
      loadCorpus: async () => floorCorpus,
      now: () => NOW,
    });
    const created = await service.createSession({
      communityId: 'community_gov',
      clientNonce: 'relevance-floor',
    });
    const session = created.payload.session;
    await service.castVote({
      sessionId: session.sessionId,
      baseEpochId: session.currentEpochId,
      weights: floorCorpus.baseWeights,
      topicIntent: floorCorpus.baseTopicIntent,
      idempotencyKey: 'floor-vote',
    });
    await service.runSyntheticVoters({
      sessionId: session.sessionId,
      baseEpochId: session.currentEpochId,
      idempotencyKey: 'floor-voters',
    });
    const advanced = await service.advanceEpoch({
      sessionId: session.sessionId,
      fromEpochId: session.currentEpochId,
      idempotencyKey: 'floor-advance',
    });
    const shadowFeed = await service.getFeed({
      sessionId: session.sessionId,
      epochId: advanced.payload.session.currentEpochId,
      limit: 12,
    });

    expect(shadowFeed.payload.posts).toEqual([]);
  });
});

function votePayload(baseEpochId: string, topicWeights: Record<string, number>): object {
  return {
    baseEpochId,
    idempotencyKey: `vote-${Object.keys(topicWeights).length}`,
    weights: { recency: 0.2, engagement: 0.2, bridging: 0.2, source_diversity: 0.2, relevance: 0.2 },
    topicIntent: { topicWeights },
  };
}

function corpus(): ShadowDemoCorpus {
  const items = Array.from({ length: 40 }, (_unused, index) => item(index + 1));
  return {
    corpusId: 'approved-community-gov-corpus',
    communityId: 'community_gov',
    baseProductionEpochId: 2,
    baseWeights: { recency: 0.05, engagement: 0.65, bridging: 0.05, source_diversity: 0.05, relevance: 0.2 },
    baseTopicIntent: { topicWeights: Object.fromEntries(TOPICS.map((topic) => [topic.slug, topic.baselineWeight])) },
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 90 * 60_000).toISOString(),
    items,
    health: {
      status: 'live', source: 'production_feed_snapshot', candidatePosts72h: 100, publicScoredPosts: 40,
      uniqueAuthors72h: 40, bridgePostShare: 0.33, topAuthorConcentration: 0.025, sampledAt: NOW.toISOString(),
      sourcePostCount: 100, eligiblePostCount: 40, englishTaggedShare: 1, richMediaShare: 0.2,
    },
    warnings: [],
    topicCatalog: [...TOPICS],
    sourceFeedUri: 'at://did:plc:amzyknmm4auxijvykyfgznw2/app.bsky.feed.generator/community-gov',
    sourceSnapshot: {
      feedName: 'Community Governed Feed', digest: 'a'.repeat(64), runId: 'run-1', updatedAt: NOW.toISOString(), capturedAt: NOW.toISOString(), reviewedAt: NOW.toISOString(),
      sourcePostCount: 100, selectionPolicyVersion: 'community-gov-reviewer-safe-v1', baselineOrderDigest: 'a'.repeat(64),
      publicationPolicy: { urlDedupEnabled: true, minimumOriginalTextLength: 200, minimumRelevance: 0, decay: [1, 0.7, 0.5, 0.3] },
    },
  };
}

function postUri(index: number): string {
  return `at://did:plc:demo${index}/app.bsky.feed.post/post${index}`;
}

function item(index: number): ShadowDemoCorpus['items'][number] {
  const uri = postUri(index);
  return {
    postUri: uri, authorDid: `did:plc:demo${index}`, createdAt: NOW.toISOString(),
    topicVector: { 'science-research': 0.8 },
    rawScores: { recency: (index % 10) / 10, engagement: 1 - (index % 10) / 10, bridging: (index % 5) / 5, source_diversity: 0.2, relevance: 0.8 },
    productionScore: 101 - index, productionEpochId: 2, scoredAt: NOW.toISOString(), componentDetails: null,
    inclusionReasons: { matchedTopics: [], matchedTerms: [], sourceRank: index, reason: 'published_feed_snapshot' },
    publishedRank: index, publishedScore: 101 - index, publicationAdjustment: 1,
    displayPost: {
      kind: 'public_post', uri, cid: `cid-${index}`, authorDid: `did:plc:demo${index}`,
      authorHandle: `user${index}.bsky.social`, authorDisplayName: `User ${index}`, authorAvatar: null,
      text: `Published feed post ${index}`, likeCount: index, repostCount: index, replyCount: index, quoteCount: 0,
      indexedAt: NOW.toISOString(), createdAt: NOW.toISOString(), bskyUrl: `https://bsky.app/profile/did:plc:demo${index}/post/post${index}`,
      languages: ['en'], media: null,
    },
  };
}
