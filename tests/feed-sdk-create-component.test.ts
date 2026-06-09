import { describe, expect, it } from 'vitest';
import {
  createComponent,
  type GovernanceWeights,
  type PostForScoring,
  type ScoringContext,
} from '../packages/feed-sdk/src/index.js';

function buildPost(): PostForScoring {
  return {
    uri: 'at://did:plc:example/app.bsky.feed.post/test',
    cid: 'bafyreibuildpostexample',
    authorDid: 'did:plc:example',
    text: 'hello from an external component',
    replyRoot: null,
    replyParent: null,
    langs: ['en'],
    hasMedia: false,
    createdAt: new Date('2026-06-04T00:00:00.000Z'),
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
  };
}

function buildContext(weights: GovernanceWeights): ScoringContext {
  return {
    epoch: {
      id: 1,
      status: 'active',
      weights,
      voteCount: 0,
      createdAt: new Date('2026-06-04T00:00:00.000Z'),
      closedAt: null,
      description: null,
    },
    scoringWindowHours: 72,
    authorCounts: new Map(),
  };
}

describe('createComponent', () => {
  it('wraps sync score functions and returns valid scores', async () => {
    const component = createComponent({
      key: 'civility',
      name: 'Civility',
      score(_post: PostForScoring, _context: ScoringContext): number {
        return 0.5;
      },
    });

    await expect(
      component.score(buildPost(), buildContext({ civility: 1 }))
    ).resolves.toBe(0.5);
  });

  it('rejects out-of-range scores with the component key', async () => {
    const component = createComponent({
      key: 'toxicityRisk',
      name: 'Toxicity Risk',
      score(_post: PostForScoring, _context: ScoringContext): number {
        return 1.25;
      },
    });

    await expect(
      component.score(buildPost(), buildContext({ toxicityRisk: 1 }))
    ).rejects.toThrow(RangeError);
    await expect(
      component.score(buildPost(), buildContext({ toxicityRisk: 1 }))
    ).rejects.toThrow(
      'Scoring component "toxicityRisk" returned out-of-range score 1.25'
    );
  });

  it('adds component context when score functions throw', async () => {
    const component = createComponent({
      key: 'sourceDiversity',
      name: 'Source Diversity',
      score(_post: PostForScoring, _context: ScoringContext): number {
        throw new Error('classifier unavailable');
      },
    });

    await expect(
      component.score(buildPost(), buildContext({ sourceDiversity: 1 }))
    ).rejects.toThrow(
      'Scoring component "sourceDiversity" failed: classifier unavailable'
    );
  });

  it('adds component context when async score functions reject', async () => {
    const component = createComponent({
      key: 'relevance',
      name: 'Relevance',
      async score(
        _post: PostForScoring,
        _context: ScoringContext
      ): Promise<number> {
        throw new Error('embedding model unavailable');
      },
    });

    await expect(
      component.score(buildPost(), buildContext({ relevance: 1 }))
    ).rejects.toThrow(
      'Scoring component "relevance" failed: embedding model unavailable'
    );
  });
});
