import type { JsonObject } from '../shared/ranking-contracts.js';
import { scoreEngagement } from './components/engagement.js';
import { scoreRecencyAt } from './components/recency.js';
import { scoreTopicVectorRelevance } from './components/relevance.js';
import type { RankingV2Candidate } from './ranking-v2-candidates.js';

export interface BridgingEvidence {
  raw: number;
  evidenceState: 'observed' | 'insufficient';
  engagerCount: number;
  pairCount: number;
}

export interface RankingV2FeatureVector {
  candidate: RankingV2Candidate;
  raw: Readonly<Record<string, number>>;
  weights: Readonly<Record<string, number>>;
  weighted: Readonly<Record<string, number>>;
  evidence: JsonObject;
  baseScore: number;
}

export function computeRankingV2Features(
  candidates: readonly RankingV2Candidate[],
  asOf: Date,
  scoringWindowHours: number,
  weights: Readonly<Record<string, number>>,
  topicWeights: Readonly<Record<string, number>>,
  bridgingByIdentity: ReadonlyMap<string, BridgingEvidence>
): readonly RankingV2FeatureVector[] {
  return candidates.map((candidate) => {
    const identity = candidateIdentity(candidate);
    const bridging = bridgingByIdentity.get(identity);
    if (!bridging) {
      throw new Error(`Missing bridging evidence for candidate ${identity}`);
    }
    const raw: Record<string, number> = {
      recency: scoreRecencyAt(candidate.post.createdAt, scoringWindowHours, asOf),
      engagement: scoreEngagement(
        candidate.post.likeCount,
        candidate.post.repostCount,
        candidate.post.replyCount
      ),
      bridging: bridging.raw,
      relevance: scoreTopicVectorRelevance(candidate.post.topicVector, { ...topicWeights }),
    };
    for (const [key, value] of Object.entries(raw)) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError(`Component ${key} returned out-of-range score ${value}`);
      }
    }
    const weighted: Record<string, number> = {};
    const appliedWeights: Record<string, number> = {};
    let baseScore = 0;
    for (const [key, rawValue] of Object.entries(raw)) {
      const weight = requireWeight(weights, key);
      appliedWeights[key] = weight;
      weighted[key] = rawValue * weight;
      baseScore += weighted[key];
    }
    return {
      candidate,
      raw,
      weights: appliedWeights,
      weighted,
      evidence: {
        bridging: {
          evidenceState: bridging.evidenceState,
          engagerCount: bridging.engagerCount,
          pairCount: bridging.pairCount,
        },
      },
      baseScore,
    };
  });
}

export function candidateIdentity(candidate: RankingV2Candidate): string {
  return `${candidate.post.uri}\u0000${candidate.post.createdAt.toISOString()}`;
}

function requireWeight(weights: Readonly<Record<string, number>>, key: string): number {
  const value = weights[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Pinned policy is missing weight in [0, 1] for ${key}`);
  }
  return value;
}
