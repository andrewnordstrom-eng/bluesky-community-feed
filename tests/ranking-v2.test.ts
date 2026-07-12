import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { calculateBridgingEvidence } from '../src/scoring/components/bridging.js';
import { scoreRecencyAt } from '../src/scoring/components/recency.js';
import {
  buildCandidateUnion,
  type RankingV2Candidate,
  type RankingV2CandidateInput,
} from '../src/scoring/ranking-v2-candidates.js';
import type { RankingV2FeatureVector } from '../src/scoring/ranking-v2-features.js';
import {
  RANKING_V2_SLATE_LIMIT,
  SourceDiversitySlateReranker,
  diversityRaw,
} from '../src/scoring/ranking-v2-slate.js';
import { replayRankingV2Slate, runRankingV2Shadow } from '../src/scoring/ranking-v2.js';
import type { PostForScoring } from '../src/scoring/score.types.js';
import type { RankingRunInputEnvelope } from '../src/shared/ranking-contracts.js';

const AS_OF = new Date('2026-07-11T20:00:00.000Z');

describe('corgi-ranking-v2', () => {
  it('evaluates recency against the immutable asOf clock', () => {
    expect(scoreRecencyAt('2026-07-11T02:00:00.000Z', 72, AS_OF)).toBeCloseTo(0.5, 12);
    expect(scoreRecencyAt('2026-07-10T08:00:00.000Z', 72, AS_OF)).toBeCloseTo(0.25, 12);
    expect(scoreRecencyAt('2026-07-12T00:00:00.000Z', 72, AS_OF)).toBe(1);
  });

  it('handles recency boundaries and rejects invalid inputs', () => {
    expect(scoreRecencyAt('2026-07-08T20:00:00.000Z', 72, AS_OF)).toBeCloseTo(0.0625, 12);
    expect(scoreRecencyAt('2026-07-08T19:59:59.999Z', 72, AS_OF)).toBe(0.01);
    expect(() => scoreRecencyAt('2026-07-11T02:00:00.000Z', 0, AS_OF)).toThrow(RangeError);
    expect(() => scoreRecencyAt('not-a-date', 72, AS_OF)).toThrow(RangeError);
  });

  it('builds a candidate union independent of input order', () => {
    const inputs = Array.from({ length: 40 }, (_, index) => candidateInput(index));
    const forward = buildCandidateUnion(inputs);
    const reverse = buildCandidateUnion([...inputs].reverse());
    expect(forward).toEqual(reverse);
  });

  it('preserves every source that selected the same candidate', () => {
    const selected = buildCandidateUnion([candidateInput(0)]);
    expect(selected[0].candidateSources).toEqual([
      'newest',
      'engagement',
      'policy_relevance',
      'previous_snapshot',
    ]);
  });

  it('fills unused source capacity to the deterministic 5,000 candidate limit', () => {
    const inputs = Array.from({ length: 5_100 }, (_, index) => candidateInput(index));
    const selected = buildCandidateUnion(inputs);
    expect(selected).toHaveLength(5_000);
    expect(selected.some((candidate) => candidate.candidateSources.includes('preliminary_fill'))).toBe(true);
  });

  it('deduplicates identical URI and creation-time identities', () => {
    const duplicate = candidateInput(0);
    expect(buildCandidateUnion([duplicate, duplicate])).toHaveLength(1);
  });

  it('records insufficient bridging evidence explicitly', () => {
    expect(calculateBridgingEvidence(['did:plc:a'], new Map())).toEqual({
      raw: 0.3,
      evidenceState: 'insufficient',
      engagerCount: 1,
      pairCount: 0,
    });
  });

  it('computes observed bridging as average pairwise Jaccard distance', () => {
    const evidence = calculateBridgingEvidence(
      ['did:plc:a', 'did:plc:b'],
      new Map([
        ['did:plc:a', new Set(['x', 'y'])],
        ['did:plc:b', new Set(['y', 'z'])],
      ])
    );
    expect(evidence.evidenceState).toBe('observed');
    expect(evidence.raw).toBeCloseTo(2 / 3, 12);
    expect(evidence.pairCount).toBe(1);
  });

  it('uses the governed diversity schedule', () => {
    expect([0, 1, 2, 3, 10].map(diversityRaw)).toEqual([1, 0.7, 0.5, 0.3, 0.3]);
  });

  it('rejects invalid diversity weights and slate limits', () => {
    expect(() => new SourceDiversitySlateReranker(-0.1)).toThrow(RangeError);
    expect(() => new SourceDiversitySlateReranker(1.1)).toThrow(RangeError);
    const reranker = new SourceDiversitySlateReranker(0.2);
    expect(() => reranker.rerank([], -1)).toThrow(RangeError);
    expect(() => reranker.rerank([], 1.5)).toThrow(RangeError);
    expect(() => reranker.rerank([], RANKING_V2_SLATE_LIMIT + 1)).toThrow(RangeError);
    expect(reranker.rerank([feature(0, 'did:plc:a', 0.9)], 0)).toEqual([]);
  });

  it('reduces to base-score ordering when diversity weight is zero', () => {
    const items = [
      feature(0, 'did:plc:a', 0.9),
      feature(1, 'did:plc:b', 0.8),
      feature(2, 'did:plc:a', 0.85),
    ];
    const slate = new SourceDiversitySlateReranker(0).rerank(items, 3);
    expect(slate.map((item) => item.postUri)).toEqual([
      'at://did:plc:a/app.bsky.feed.post/0',
      'at://did:plc:a/app.bsky.feed.post/2',
      'at://did:plc:b/app.bsky.feed.post/1',
    ]);
  });

  it('lets diversity affect the selected slate at the current objective weight', () => {
    const items = [
      feature(0, 'did:plc:a', 0.9),
      feature(1, 'did:plc:a', 0.89),
      feature(2, 'did:plc:b', 0.85),
    ];
    const slate = new SourceDiversitySlateReranker(0.2).rerank(items, 3);
    expect(slate.map((item) => item.authorDid)).toEqual([
      'did:plc:a',
      'did:plc:b',
      'did:plc:a',
    ]);
    expect(slate[1].diversityContext).toMatchObject({
      authorCountBeforeSelection: 0,
      raw: 1,
      weightedContribution: 0.2,
    });
  });

  it('strongly favors a new author when diversity weight is one', () => {
    const items = [
      feature(0, 'did:plc:a', 0.9),
      feature(1, 'did:plc:a', 0.89),
      feature(2, 'did:plc:b', 0.7),
    ];
    const slate = new SourceDiversitySlateReranker(1).rerank(items, 3);
    expect(slate.map((item) => item.authorDid)).toEqual([
      'did:plc:a',
      'did:plc:b',
      'did:plc:a',
    ]);
  });

  it('uses deterministic creation-time and URI tie breaks', () => {
    const first = feature(1, 'did:plc:a', 0.5);
    const second = feature(2, 'did:plc:b', 0.5);
    first.candidate.post.createdAt = new Date('2026-07-11T19:00:00.000Z');
    second.candidate.post.createdAt = new Date('2026-07-11T19:00:00.000Z');
    const slate = new SourceDiversitySlateReranker(0).rerank([second, first], 2);
    expect(slate.map((item) => item.postUri)).toEqual([
      'at://did:plc:a/app.bsky.feed.post/1',
      'at://did:plc:b/app.bsky.feed.post/2',
    ]);
  });

  it('destroys a database client when rollback leaves its state unknown', async () => {
    const release = vi.fn();
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('policy read failed'))
      .mockRejectedValueOnce(new Error('rollback failed'));
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as unknown as Pool;

    await expect(runRankingV2Shadow(pool, {
      communityId: 'community-gov',
      asOf: AS_OF,
      codeSha: 'c'.repeat(40),
      previousSnapshotPositions: new Map(),
    })).rejects.toThrow(AggregateError);
    expect(release).toHaveBeenCalledWith(expect.any(Error));
  });

  it('reports structured replay validation failures', () => {
    const malformed = {
      schemaVersion: 1,
      runId: 'run',
      communityId: 'community-gov',
      policyHash: 'a'.repeat(64),
      configurationHash: 'b'.repeat(64),
      asOf: AS_OF.toISOString(),
      sourceDiversityWeight: 2,
      candidates: [{ uri: '', createdAt: 'not-a-date' }],
    } as unknown as RankingRunInputEnvelope;

    try {
      replayRankingV2Slate(malformed);
      throw new Error('Expected replay validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).issues.length).toBeGreaterThan(2);
    }
  });
});

function candidateInput(index: number): RankingV2CandidateInput {
  return {
    post: post(index, `did:plc:${index % 8}`),
    policyRelevance: (index % 10) / 10,
    previousSnapshotPosition: index < 5 ? index + 1 : null,
    preliminaryScore: (index % 13) / 13,
  };
}

function post(index: number, authorDid: string): PostForScoring {
  return {
    uri: `at://${authorDid}/app.bsky.feed.post/${index}`,
    cid: `cid-${index}`,
    authorDid,
    text: `post ${index}`,
    replyRoot: null,
    replyParent: null,
    langs: ['en'],
    hasMedia: false,
    createdAt: new Date(AS_OF.getTime() - (index * 60_000)),
    likeCount: index,
    repostCount: index % 3,
    replyCount: index % 2,
    topicVector: { corgi: 0.8 },
    classificationMethod: 'keyword',
  };
}

function feature(index: number, authorDid: string, baseScore: number): RankingV2FeatureVector {
  const candidate: RankingV2Candidate = {
    ...candidateInput(index),
    post: post(index, authorDid),
    candidateSources: ['newest'],
  };
  return {
    candidate,
    raw: { recency: 1, engagement: baseScore, bridging: 0.3, relevance: 0.5 },
    weights: { recency: 0, engagement: 1, bridging: 0, relevance: 0 },
    weighted: { recency: 0, engagement: baseScore, bridging: 0, relevance: 0 },
    evidence: { bridging: { evidenceState: 'insufficient', engagerCount: 0, pairCount: 0 } },
    baseScore,
  };
}
