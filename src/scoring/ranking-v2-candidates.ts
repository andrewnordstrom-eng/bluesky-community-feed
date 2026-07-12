import type { CandidateSource } from '../shared/ranking-contracts.js';
import type { PostForScoring } from './score.types.js';

export const RANKING_V2_CANDIDATE_LIMITS = {
  newest: 1500,
  engagement: 1500,
  policyRelevance: 1500,
  previousSnapshot: 500,
  total: 5000,
} as const;

if (
  RANKING_V2_CANDIDATE_LIMITS.newest
    + RANKING_V2_CANDIDATE_LIMITS.engagement
    + RANKING_V2_CANDIDATE_LIMITS.policyRelevance
    + RANKING_V2_CANDIDATE_LIMITS.previousSnapshot
  !== RANKING_V2_CANDIDATE_LIMITS.total
) {
  throw new Error('RANKING_V2_CANDIDATE_LIMITS category limits must sum to total');
}

const SOURCE_ORDER: readonly CandidateSource[] = [
  'newest',
  'engagement',
  'policy_relevance',
  'previous_snapshot',
  'preliminary_fill',
];

export interface RankingV2CandidateInput {
  post: PostForScoring;
  policyRelevance: number;
  previousSnapshotPosition: number | null;
  preliminaryScore: number;
}

export interface RankingV2Candidate extends RankingV2CandidateInput {
  candidateSources: readonly CandidateSource[];
}

/** Build the deterministic governed candidate union and retain source provenance. */
export function buildCandidateUnion(
  inputs: readonly RankingV2CandidateInput[]
): readonly RankingV2Candidate[] {
  for (const input of inputs) {
    validateInput(input);
  }
  const deduplicated = deduplicateInputs(inputs);
  const selected = new Map<string, MutableCandidate>();

  addRanked(selected, deduplicated, 'newest', RANKING_V2_CANDIDATE_LIMITS.newest, compareNewest);
  addRanked(
    selected,
    deduplicated,
    'engagement',
    RANKING_V2_CANDIDATE_LIMITS.engagement,
    compareEngagement
  );
  addRanked(
    selected,
    deduplicated,
    'policy_relevance',
    RANKING_V2_CANDIDATE_LIMITS.policyRelevance,
    comparePolicyRelevance
  );
  addRanked(
    selected,
    deduplicated.filter((input) => input.previousSnapshotPosition !== null),
    'previous_snapshot',
    RANKING_V2_CANDIDATE_LIMITS.previousSnapshot,
    comparePreviousSnapshot
  );

  const remaining = RANKING_V2_CANDIDATE_LIMITS.total - selected.size;
  if (remaining > 0) {
    addFill(selected, deduplicated, remaining);
  }

  return [...selected.values()]
    .sort((left, right) => comparePreliminary(left.input, right.input))
    .map(({ input, sources }) => ({
      ...input,
      candidateSources: SOURCE_ORDER.filter((source) => sources.has(source)),
    }));
}

function addFill(
  selected: Map<string, MutableCandidate>,
  inputs: readonly RankingV2CandidateInput[],
  limit: number
): void {
  let added = 0;
  for (const input of [...inputs].sort(comparePreliminary)) {
    const key = postIdentity(input.post);
    if (selected.has(key)) {
      continue;
    }
    selected.set(key, { input, sources: new Set(['preliminary_fill']) });
    added += 1;
    if (added === limit) {
      return;
    }
  }
}

interface MutableCandidate {
  input: RankingV2CandidateInput;
  sources: Set<CandidateSource>;
}

function addRanked(
  selected: Map<string, MutableCandidate>,
  inputs: readonly RankingV2CandidateInput[],
  source: CandidateSource,
  limit: number,
  compare: (left: RankingV2CandidateInput, right: RankingV2CandidateInput) => number
): void {
  for (const input of [...inputs].sort(compare).slice(0, limit)) {
    const key = postIdentity(input.post);
    const existing = selected.get(key);
    if (existing) {
      existing.sources.add(source);
    } else {
      selected.set(key, { input, sources: new Set([source]) });
    }
  }
}

function compareNewest(left: RankingV2CandidateInput, right: RankingV2CandidateInput): number {
  return compareDateDesc(left, right) || compareUri(left, right);
}

function compareEngagement(left: RankingV2CandidateInput, right: RankingV2CandidateInput): number {
  return weightedEngagement(right.post) - weightedEngagement(left.post)
    || compareDateDesc(left, right)
    || compareUri(left, right);
}

function comparePolicyRelevance(
  left: RankingV2CandidateInput,
  right: RankingV2CandidateInput
): number {
  return right.policyRelevance - left.policyRelevance
    || compareDateDesc(left, right)
    || compareUri(left, right);
}

function comparePreviousSnapshot(
  left: RankingV2CandidateInput,
  right: RankingV2CandidateInput
): number {
  const leftPosition = left.previousSnapshotPosition;
  const rightPosition = right.previousSnapshotPosition;
  if (leftPosition === null || rightPosition === null) {
    throw new Error('Previous-snapshot comparison requires non-null positions');
  }
  return leftPosition - rightPosition || compareDateDesc(left, right) || compareUri(left, right);
}

function comparePreliminary(left: RankingV2CandidateInput, right: RankingV2CandidateInput): number {
  return right.preliminaryScore - left.preliminaryScore
    || compareDateDesc(left, right)
    || compareUri(left, right);
}

function weightedEngagement(post: PostForScoring): number {
  return post.likeCount + (2 * post.repostCount) + (3 * post.replyCount);
}

function compareDateDesc(left: RankingV2CandidateInput, right: RankingV2CandidateInput): number {
  return right.post.createdAt.getTime() - left.post.createdAt.getTime();
}

function compareUri(left: RankingV2CandidateInput, right: RankingV2CandidateInput): number {
  return compareStrings(left.post.uri, right.post.uri);
}

function postIdentity(post: PostForScoring): string {
  return `${post.uri}\u0000${post.createdAt.toISOString()}`;
}

function deduplicateInputs(
  inputs: readonly RankingV2CandidateInput[]
): readonly RankingV2CandidateInput[] {
  const identities = new Map<string, RankingV2CandidateInput>();
  for (const input of inputs) {
    const identity = postIdentity(input.post);
    const existing = identities.get(identity);
    if (existing && !equivalentInput(existing, input)) {
      throw new Error(`Conflicting duplicate ranking candidate identity: ${identity}`);
    }
    identities.set(identity, input);
  }
  return [...identities.values()];
}

function equivalentInput(left: RankingV2CandidateInput, right: RankingV2CandidateInput): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validateInput(input: RankingV2CandidateInput): void {
  if (!input.post.uri || !Number.isFinite(input.post.createdAt.getTime())) {
    throw new Error(`Invalid ranking candidate identity: ${input.post.uri}`);
  }
  if (!Number.isFinite(input.policyRelevance) || input.policyRelevance < 0 || input.policyRelevance > 1) {
    throw new RangeError(`policyRelevance must be in [0, 1], got ${input.policyRelevance}`);
  }
  if (!Number.isFinite(input.preliminaryScore)) {
    throw new RangeError(`preliminaryScore must be finite, got ${input.preliminaryScore}`);
  }
  if (
    input.previousSnapshotPosition !== null
    && (!Number.isInteger(input.previousSnapshotPosition) || input.previousSnapshotPosition < 1)
  ) {
    throw new RangeError(
      `previousSnapshotPosition must be a positive integer or null, got ${input.previousSnapshotPosition}`
    );
  }
}
