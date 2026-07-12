import { describe, expect, it } from 'vitest';
import {
  aggregateShadowContentRules,
  applyShadowContentRules,
  contentRuleThreshold,
  suggestedExcludeKeywords,
  syntheticExcludeKeywords,
  validateShadowExcludeKeywords,
} from '../src/demo/content-rules.js';
import { ShadowDemoService } from '../src/demo/service.js';
import { MemoryDemoStore } from '../src/demo/store.js';
import type { ShadowDemoCorpus, ShadowDemoVote } from '../src/demo/types.js';

const NOW = new Date('2026-07-12T22:30:00.000Z');
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

// Seeds verified against the deterministic FNV echo hash for epoch
// shadow-epoch-1 / community_gov / keyword "atproto":
// ADOPTING_SEED yields 9 synthetic echoes (10/25 with the reviewer, threshold 8);
// REJECTING_SEED yields 5 synthetic echoes (6/25, below threshold).
const ADOPTING_SEED = 'seed-0';
const REJECTING_SEED = 'seed-3';

describe('shadow demo content-rule primitives', () => {
  it('normalizes exclude keywords with production semantics', () => {
    expect(validateShadowExcludeKeywords(undefined)).toEqual([]);
    expect(validateShadowExcludeKeywords(null)).toEqual([]);
    expect(validateShadowExcludeKeywords([' ATProto ', 'atproto', 'Spam'])).toEqual(['atproto', 'spam']);
    expect(() => validateShadowExcludeKeywords('atproto')).toThrow(/array/);
    expect(() => validateShadowExcludeKeywords([42])).toThrow(/strings/);
    expect(() => validateShadowExcludeKeywords(['  '])).toThrow(/empty/);
    expect(() => validateShadowExcludeKeywords(['x'.repeat(51)])).toThrow(/50/);
    expect(() => validateShadowExcludeKeywords(Array.from({ length: 11 }, (_u, i) => `k${i}`)))
      .toThrow(/at most 10/);
  });

  it('adopts keywords at the production 30% share over the full electorate', () => {
    expect(contentRuleThreshold(25)).toBe(8);
    const votesAt = (count: number): Array<Pick<ShadowDemoVote, 'excludeKeywords'>> => [
      ...Array.from({ length: count }, () => ({ excludeKeywords: ['atproto'] })),
      ...Array.from({ length: 25 - count }, () => ({})),
    ];
    const adopted = aggregateShadowContentRules(votesAt(8), 25);
    expect(adopted.threshold).toBe(8);
    expect(adopted.electorate).toBe(25);
    expect(adopted.adoptedExcludeKeywords).toEqual(['atproto']);
    expect(adopted.support).toEqual([{ keyword: 'atproto', supportCount: 8, adopted: true }]);

    const rejected = aggregateShadowContentRules(votesAt(7), 25);
    expect(rejected.adoptedExcludeKeywords).toEqual([]);
    expect(rejected.support).toEqual([{ keyword: 'atproto', supportCount: 7, adopted: false }]);
  });

  it('splits the corpus with the production matcher and passes text-less posts', () => {
    const corpusFixture = corpus();
    corpusFixture.items[0].displayPost = { kind: 'hidden_post', reason: 'blocked' };
    const application = applyShadowContentRules(corpusFixture.items, ['atproto']);
    const withheldUris = application.withheld.map((entry) => entry.item.postUri);
    expect(withheldUris).toEqual([postUri(2), postUri(3)]);
    expect(application.withheld.every((entry) => entry.keyword === 'atproto')).toBe(true);
    expect(application.eligible.length + application.withheld.length).toBe(corpusFixture.items.length);
    expect(applyShadowContentRules(corpusFixture.items, []).withheld).toEqual([]);
  });

  it('suggests deterministic corpus-grounded keywords within effect bounds', () => {
    const corpusFixture = corpus();
    const suggestions = suggestedExcludeKeywords(corpusFixture.items, 6);
    expect(suggestions).toEqual(suggestedExcludeKeywords(corpusFixture.items, 6));
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(suggestion.matchCount).toBeGreaterThanOrEqual(2);
      expect(suggestion.matchCount).toBeLessThanOrEqual(Math.floor(40 * 0.3));
      expect(suggestion.keyword.length).toBeGreaterThanOrEqual(4);
    }
    // "atproto" appears in exactly two fixture posts.
    expect(suggestions.map((entry) => entry.keyword)).toContain('atproto');
  });

  it('replays synthetic keyword ballots exactly and never invents keywords', () => {
    const options = {
      seed: ADOPTING_SEED,
      communityId: 'community_gov',
      epochId: 'shadow-epoch-1',
      actorId: 'synthetic-freshness_watcher-1',
      blocId: 'freshness_watcher' as const,
      policyInertia: 0.3,
      reviewerExcludeKeywords: ['atproto'],
      priorAdoptedExcludeKeywords: ['legacy-rule'],
    };
    const first = syntheticExcludeKeywords(options);
    expect(syntheticExcludeKeywords(options)).toEqual(first);
    for (const keyword of first) {
      expect(['atproto', 'legacy-rule']).toContain(keyword);
    }
    expect(
      syntheticExcludeKeywords({
        ...options,
        reviewerExcludeKeywords: [],
        priorAdoptedExcludeKeywords: [],
      })
    ).toEqual([]);
  });
});

describe('shadow demo content rules disabled (v4 parity)', () => {
  it('keeps payloads contract-identical and rejects keyword ballots', async () => {
    const service = buildService({ contentRulesEnabled: false, seed: ADOPTING_SEED });
    const created = await service.createSession({ communityId: 'community_gov', clientNonce: 'rules-off' });
    const session = created.payload.session;
    expect('contentRulesEnabled' in session).toBe(false);
    expect('suggestedExcludeKeywords' in session).toBe(false);
    expect('contentRules' in session.epochs[0].aggregate).toBe(false);

    await expect(
      service.castVote({
        sessionId: session.sessionId,
        baseEpochId: session.currentEpochId,
        weights: equalWeights(),
        topicIntent: fullTopicIntent(),
        excludeKeywords: ['atproto'],
        idempotencyKey: 'rules-off-vote',
      })
    ).rejects.toThrow(/not enabled/);

    const advanced = await runFullEpoch(service, session.sessionId, session.currentEpochId, undefined, 'off');
    const epoch = advanced.payload.session.epochs.find(
      (candidate) => candidate.id === advanced.payload.session.currentEpochId
    );
    expect(epoch && 'contentRules' in epoch.aggregate).toBe(false);

    const feed = await service.getFeed({
      sessionId: session.sessionId,
      epochId: advanced.payload.session.currentEpochId,
      limit: 12,
    });
    expect('withheldPosts' in feed.payload).toBe(false);
  });
});

describe('shadow demo content rules enabled', () => {
  it('adopts a supported reviewer keyword, withholds matching posts, and explains it', async () => {
    const service = buildService({ contentRulesEnabled: true, seed: ADOPTING_SEED });
    const created = await service.createSession({ communityId: 'community_gov', clientNonce: 'rules-adopt' });
    const session = created.payload.session;
    expect(session.contentRulesEnabled).toBe(true);
    expect(session.suggestedExcludeKeywords?.length).toBeGreaterThan(0);
    expect(session.epochs[0].aggregate.contentRules).toMatchObject({
      threshold: 8,
      electorate: 25,
      adoptedExcludeKeywords: [],
    });

    const advanced = await runFullEpoch(service, session.sessionId, session.currentEpochId, ['ATProto'], 'adopt');
    const shadowEpochId = advanced.payload.session.currentEpochId;
    const epoch = advanced.payload.session.epochs.find((candidate) => candidate.id === shadowEpochId);
    expect(epoch?.aggregate.contentRules).toMatchObject({
      threshold: 8,
      electorate: 25,
      adoptedExcludeKeywords: ['atproto'],
    });
    expect(epoch?.aggregate.contentRules?.support).toEqual([
      { keyword: 'atproto', supportCount: 10, adopted: true },
    ]);

    const feed = await service.getFeed({ sessionId: session.sessionId, epochId: shadowEpochId, limit: 12 });
    expect(feed.payload.withheldPosts?.map((entry) => [
      entry.keyword,
      entry.post.kind === 'public_post' ? entry.post.uri : null,
      entry.supportCount,
    ])).toEqual([
      ['atproto', postUri(2), 10],
      ['atproto', postUri(3), 10],
    ]);
    const rankedUris = feed.payload.posts
      .filter((post) => post.post.kind === 'public_post')
      .map((post) => (post.post.kind === 'public_post' ? post.post.uri : ''));
    expect(rankedUris).not.toContain(postUri(2));
    expect(rankedUris).not.toContain(postUri(3));

    await expect(
      service.getReceipt({ sessionId: session.sessionId, epochId: shadowEpochId, postUri: postUri(2) })
    ).rejects.toThrow(/withheld by adopted community rule "-atproto" \(10\/25 support, threshold 8\)/);

    const visibleReceipt = await service.getReceipt({
      sessionId: session.sessionId,
      epochId: shadowEpochId,
      postUri: postUri(5),
    });
    expect(visibleReceipt.payload.receipt.contentRules).toEqual({
      adoptedExcludeKeywords: ['atproto'],
      threshold: 8,
      electorate: 25,
      matchedKeyword: null,
    });
  });

  it('visibly rejects a keyword that falls short of the threshold', async () => {
    const service = buildService({ contentRulesEnabled: true, seed: REJECTING_SEED });
    const created = await service.createSession({ communityId: 'community_gov', clientNonce: 'rules-reject' });
    const session = created.payload.session;
    const advanced = await runFullEpoch(service, session.sessionId, session.currentEpochId, ['atproto'], 'reject');
    const shadowEpochId = advanced.payload.session.currentEpochId;
    const epoch = advanced.payload.session.epochs.find((candidate) => candidate.id === shadowEpochId);
    expect(epoch?.aggregate.contentRules).toMatchObject({ adoptedExcludeKeywords: [] });
    expect(epoch?.aggregate.contentRules?.support).toEqual([
      { keyword: 'atproto', supportCount: 6, adopted: false },
    ]);

    const feed = await service.getFeed({ sessionId: session.sessionId, epochId: shadowEpochId, limit: 12 });
    expect(feed.payload.withheldPosts).toEqual([]);
    // The rejected keyword must not withhold the matching post: its receipt
    // resolves normally instead of the withheld-rule error.
    const receipt = await service.getReceipt({
      sessionId: session.sessionId,
      epochId: shadowEpochId,
      postUri: postUri(2),
    });
    expect(receipt.payload.receipt.contentRules).toMatchObject({ adoptedExcludeKeywords: [] });
  });

  it('replays an identical session byte-for-byte with keyword ballots present', async () => {
    const runs = await Promise.all(['left', 'right'].map(async (nonce) => {
      const service = buildService({ contentRulesEnabled: true, seed: ADOPTING_SEED });
      const created = await service.createSession({ communityId: 'community_gov', clientNonce: nonce });
      const session = created.payload.session;
      const advanced = await runFullEpoch(service, session.sessionId, session.currentEpochId, ['atproto'], nonce);
      const feed = await service.getFeed({
        sessionId: session.sessionId,
        epochId: advanced.payload.session.currentEpochId,
        limit: 12,
      });
      const epochs = advanced.payload.session.epochs.map((epoch) => epoch.aggregate);
      return JSON.stringify({ epochs, posts: feed.payload.posts, withheld: feed.payload.withheldPosts });
    }));
    expect(runs[0]).toEqual(runs[1]);
  });
});

function buildService(options: { contentRulesEnabled: boolean; seed: string }): ShadowDemoService {
  return new ShadowDemoService({
    store: new MemoryDemoStore(),
    loadCorpus: async () => corpus(),
    now: () => NOW,
    contentRulesEnabled: options.contentRulesEnabled,
    seed: () => options.seed,
  });
}

async function runFullEpoch(
  service: ShadowDemoService,
  sessionId: string,
  baseEpochId: string,
  excludeKeywords: string[] | undefined,
  keyPrefix: string
): Promise<Awaited<ReturnType<ShadowDemoService['advanceEpoch']>>> {
  await service.castVote({
    sessionId,
    baseEpochId,
    weights: equalWeights(),
    topicIntent: fullTopicIntent(),
    ...(excludeKeywords ? { excludeKeywords } : {}),
    idempotencyKey: `${keyPrefix}-vote`,
  });
  await service.runSyntheticVoters({
    sessionId,
    baseEpochId,
    idempotencyKey: `${keyPrefix}-voters`,
  });
  return service.advanceEpoch({
    sessionId,
    fromEpochId: baseEpochId,
    idempotencyKey: `${keyPrefix}-advance`,
  });
}

function equalWeights(): Record<string, number> {
  return { recency: 0.2, engagement: 0.2, bridging: 0.2, source_diversity: 0.2, relevance: 0.2 };
}

function fullTopicIntent(): { topicWeights: Record<string, number> } {
  return { topicWeights: Object.fromEntries(TOPICS.map((topic) => [topic.slug, topic.baselineWeight])) };
}

function postUri(index: number): string {
  return `at://did:plc:demo${index}/app.bsky.feed.post/post${index}`;
}

function corpus(): ShadowDemoCorpus {
  const items = Array.from({ length: 40 }, (_unused, index) => item(index + 1));
  return {
    corpusId: 'approved-community-gov-corpus',
    communityId: 'community_gov',
    baseProductionEpochId: 2,
    baseWeights: { recency: 0.25, engagement: 0.2, bridging: 0.1, source_diversity: 0.1, relevance: 0.35 },
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

function item(index: number): ShadowDemoCorpus['items'][number] {
  const uri = postUri(index);
  // Posts 2 and 3 mention "atproto" so an adopted "-atproto" rule has a
  // deterministic visible effect; posts 4 and 7 mention "headscale" so the
  // suggestion floor of two matches is exercised by a second term.
  const text = index === 2 || index === 3
    ? `Deep dive ${index}: why ATProto relays matter for federation health`
    : index === 4 || index === 7
      ? `Self-hosting notes ${index}: headscale, reverse proxies, and identity`
      : `Published feed post ${index} about community governance mechanics`;
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
      text, likeCount: index, repostCount: index, replyCount: index, quoteCount: 0,
      indexedAt: NOW.toISOString(), createdAt: NOW.toISOString(), bskyUrl: `https://bsky.app/profile/did:plc:demo${index}/post/post${index}`,
      languages: ['en'], media: null,
    },
  };
}
