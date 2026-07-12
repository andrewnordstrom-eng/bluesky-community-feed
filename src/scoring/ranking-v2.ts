import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';
import { materializeActivePolicyVersion, hashCanonicalJson } from '../governance/policy-version.js';
import { checkContentRules } from '../governance/content-filter.js';
import { toContentRules } from '../governance/governance.types.js';
import type { ContentRules } from '../shared/api-types.js';
import {
  CANDIDATE_SOURCES,
  type JsonObject,
  type RankedSlateItem,
  type RankingReceipt,
  type RankingRunInputEnvelope,
  type RankingRunContext,
} from '../shared/ranking-contracts.js';
import {
  buildRankingReceipt,
  createCompressedRankingInput,
  createRankingRun,
  persistRankedSlate,
  persistRankingRunInput,
  transitionRankingRun,
  validateRankingRun,
} from './ranking-run-contracts.js';
import { scoreBridgingBatch } from './components/bridging.js';
import { scoreEngagement } from './components/engagement.js';
import { scoreRecencyAt } from './components/recency.js';
import { scoreTopicVectorRelevance } from './components/relevance.js';
import {
  RANKING_V2_CANDIDATE_LIMITS,
  buildCandidateUnion,
  type RankingV2CandidateInput,
} from './ranking-v2-candidates.js';
import { computeRankingV2Features, requireWeight } from './ranking-v2-features.js';
import {
  RANKING_V2_SLATE_LIMIT,
  SourceDiversitySlateReranker,
} from './ranking-v2-slate.js';
import {
  CLASSIFICATION_METHODS,
  toPostForScoring,
  type PostForScoring,
} from './score.types.js';

export const RANKING_V2_ALGORITHM_VERSION = 'corgi-ranking-v2';
export const RANKING_V2_SCORING_WINDOW_HOURS = 72;
const MAX_CANDIDATE_FETCH = RANKING_V2_CANDIDATE_LIMITS.total * 10;

const CONFIGURATION = {
  candidateLimits: {
    newest: 1500,
    engagement: 1500,
    policyRelevance: 1500,
    previousSnapshot: 500,
    total: 5000,
  },
  scoringWindowHours: RANKING_V2_SCORING_WINDOW_HOURS,
  slateLimit: RANKING_V2_SLATE_LIMIT,
  tieBreak: ['utility_desc', 'base_score_desc', 'created_at_desc', 'uri_asc'],
} as const;

const CandidateSourceSchema = z.enum(CANDIDATE_SOURCES);
const FiniteNumberSchema = z.number().finite();
const NumericRecordSchema = z.record(FiniteNumberSchema);
const ReplayCandidateSchema = z.object({
  uri: z.string().min(1),
  createdAt: z.string().datetime(),
  authorDid: z.string().min(1),
  candidateSources: z.array(CandidateSourceSchema),
  immutable: z.object({
    cid: z.string().min(1),
    text: z.string().nullable(),
    replyRoot: z.string().nullable(),
    replyParent: z.string().nullable(),
    langs: z.array(z.string()),
    hasMedia: z.boolean(),
    topicVector: NumericRecordSchema,
    classificationMethod: z.enum(CLASSIFICATION_METHODS).nullable(),
  }),
  eventTime: z.object({
    likeCount: FiniteNumberSchema,
    repostCount: FiniteNumberSchema,
    replyCount: FiniteNumberSchema,
  }),
  raw: NumericRecordSchema,
  weights: NumericRecordSchema,
  weighted: NumericRecordSchema,
  evidence: z.object({
    bridging: z.object({
      evidenceState: z.enum(['observed', 'insufficient']),
      engagerCount: z.number().int().nonnegative(),
      pairCount: z.number().int().nonnegative(),
    }),
  }),
  baseScore: FiniteNumberSchema,
});
const ReplayEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  communityId: z.string().min(1),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/),
  configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  asOf: z.string().datetime(),
  sourceDiversityWeight: z.number().finite().min(0).max(1),
  candidates: z.array(ReplayCandidateSchema),
}).strict();

type ReplayCandidate = z.infer<typeof ReplayCandidateSchema>;

export interface RankingV2ShadowOptions {
  communityId: string;
  asOf: Date;
  codeSha: string;
  previousSnapshotPositions: ReadonlyMap<string, number>;
}

export interface RankingV2ShadowResult {
  context: RankingRunContext;
  receipt: RankingReceipt;
  candidateCount: number;
  selectedCount: number;
  exclusionCount: number;
}

/** Reconstruct the exact v2 slate from one validated immutable replay envelope. */
export function replayRankingV2Slate(
  envelope: RankingRunInputEnvelope,
  expectedSourceDiversityWeight?: number
): readonly RankedSlateItem[] {
  const parsed = ReplayEnvelopeSchema.parse(envelope);
  if (
    expectedSourceDiversityWeight !== undefined
    && expectedSourceDiversityWeight !== parsed.sourceDiversityWeight
  ) {
    throw new Error(
      `Replay sourceDiversityWeight mismatch: stored ${parsed.sourceDiversityWeight}, supplied ${expectedSourceDiversityWeight}`
    );
  }
  const features = parsed.candidates.map(replayFeature);
  return new SourceDiversitySlateReranker(parsed.sourceDiversityWeight).rerank(
    features,
    Math.min(RANKING_V2_SLATE_LIMIT, features.length)
  );
}

interface CandidateRow extends QueryResultRow {
  uri: string;
  cid: string;
  author_did: string;
  text: string | null;
  reply_root: string | null;
  reply_parent: string | null;
  langs: string[] | null;
  has_media: boolean;
  created_at: Date | string;
  topic_vector: Record<string, number> | null;
  classification_method: string | null;
  like_count: number;
  repost_count: number;
  reply_count: number;
}

/** Execute and persist one non-publishing v2 ranking run against a pinned policy. */
export async function runRankingV2Shadow(
  pool: Pool,
  options: RankingV2ShadowOptions
): Promise<RankingV2ShadowResult> {
  assertOptions(options);
  const client = await pool.connect();
  const startedAt = Date.now();
  let context: RankingRunContext | null = null;
  let transactionOpen = false;
  let releaseError: Error | undefined;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const policyResult = await materializeActivePolicyVersion(client, {
      communityId: options.communityId,
      algorithmVersion: RANKING_V2_ALGORITHM_VERSION,
      effectiveAt: options.asOf.toISOString(),
      provenanceReferences: [],
    });
    context = {
      runId: randomUUID(),
      communityId: options.communityId,
      asOf: options.asOf.toISOString(),
      policy: policyResult.bundle,
      algorithmVersion: RANKING_V2_ALGORITHM_VERSION,
      configurationHash: hashCanonicalJson(CONFIGURATION),
      codeSha: options.codeSha,
    };
    await createRankingRun(client, {
      runId: context.runId,
      communityId: context.communityId,
      policyVersionId: context.policy.policyVersionId,
      policyHash: context.policy.policyHash,
      algorithmVersion: context.algorithmVersion,
      configurationHash: context.configurationHash,
      codeSha: context.codeSha,
      asOf: context.asOf,
    });
    await client.query('COMMIT');
    transactionOpen = false;

    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    transactionOpen = true;
    await transitionRankingRun(client, context.runId, 'running', null);

    const contentRules = policyContentRules(context.policy.contentRules);
    const loaded = await loadEligibleCandidates(
      client,
      options.asOf,
      contentRules,
      options.previousSnapshotPositions,
      context.policy.weights,
      context.policy.topicWeights
    );
    const candidates = buildCandidateUnion(loaded.inputs);
    if (candidates.length === 0) {
      throw new Error(`Ranking run ${context.runId} has no eligible candidates`);
    }
    const bridging = await scoreBridgingBatch(client, candidates.map((candidate) => candidate.post));
    const features = computeRankingV2Features(
      candidates,
      options.asOf,
      RANKING_V2_SCORING_WINDOW_HOURS,
      context.policy.weights,
      context.policy.topicWeights,
      bridging
    );
    const sourceDiversityWeight = requireWeight(context.policy.weights, 'sourceDiversity');
    const slate = new SourceDiversitySlateReranker(sourceDiversityWeight).rerank(
      features,
      Math.min(RANKING_V2_SLATE_LIMIT, features.length)
    );
    const envelope = {
      schemaVersion: 1 as const,
      runId: context.runId,
      communityId: context.communityId,
      policyHash: context.policy.policyHash,
      configurationHash: context.configurationHash,
      asOf: context.asOf,
      sourceDiversityWeight,
      candidates: features.map(toReplayCandidate),
    };
    const compressed = createCompressedRankingInput(envelope);
    await persistRankingRunInput(client, context.runId, compressed);
    await persistRankedSlate(client, context.runId, slate);
    const receipt = buildRankingReceipt({
      runId: context.runId,
      communityId: context.communityId,
      policyVersionId: context.policy.policyVersionId,
      policyHash: context.policy.policyHash,
      algorithmVersion: context.algorithmVersion,
      configurationHash: context.configurationHash,
      codeSha: context.codeSha,
      asOf: context.asOf,
      inputChecksum: compressed.checksum,
      items: slate,
    });
    await validateRankingRun(client, {
      runId: context.runId,
      receipt,
      candidateCount: candidates.length,
      exclusionCount: loaded.exclusionCount,
      timings: { totalMs: Date.now() - startedAt },
      metrics: rankingMetrics(slate),
    });
    await client.query('COMMIT');
    transactionOpen = false;
    return {
      context,
      receipt,
      candidateCount: candidates.length,
      selectedCount: slate.length,
      exclusionCount: loaded.exclusionCount,
    };
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
        transactionOpen = false;
      } catch (rollbackError) {
        cleanupErrors.push(rollbackError);
      }
    }
    if (context !== null) {
      try {
        await client.query('BEGIN');
        await transitionRankingRun(client, context.runId, 'failed', failureDetails(error));
        await client.query('COMMIT');
      } catch (failurePersistenceError) {
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          cleanupErrors.push(rollbackError);
        });
        cleanupErrors.push(failurePersistenceError);
      }
    }
    if (cleanupErrors.length > 0) {
      releaseError = new AggregateError(
        [error, ...cleanupErrors],
        `Ranking v2 failed and cleanup was incomplete: ${messageFromError(error)}`
      );
      throw releaseError;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

async function loadEligibleCandidates(
  client: PoolClient,
  asOf: Date,
  contentRules: ContentRules,
  previousSnapshotPositions: ReadonlyMap<string, number>,
  weights: Readonly<Record<string, number>>,
  topicWeights: Readonly<Record<string, number>>
): Promise<{ inputs: readonly RankingV2CandidateInput[]; exclusionCount: number }> {
  const cutoff = new Date(asOf.getTime() - (RANKING_V2_SCORING_WINDOW_HOURS * 60 * 60 * 1000));
  const result = await client.query<CandidateRow>(
    `SELECT p.uri, p.cid, p.author_did, p.text, p.reply_root, p.reply_parent,
            p.langs, p.has_media, p.created_at, p.topic_vector, p.classification_method,
            COALESCE(pe.like_count, 0)::int AS like_count,
            COALESCE(pe.repost_count, 0)::int AS repost_count,
            COALESCE(pe.reply_count, 0)::int AS reply_count
       FROM posts p
       LEFT JOIN post_engagement pe ON pe.post_uri = p.uri
      WHERE p.deleted = FALSE
        AND p.created_at > $1
        AND p.created_at <= $2
      ORDER BY p.created_at DESC, p.uri ASC
      LIMIT $3`,
    [cutoff.toISOString(), asOf.toISOString(), MAX_CANDIDATE_FETCH]
  );
  const inputs: RankingV2CandidateInput[] = [];
  let exclusionCount = 0;
  for (const row of result.rows) {
    const post = toPostForScoring(row);
    if (!checkContentRules(post.text, contentRules).passes) {
      exclusionCount += 1;
      continue;
    }
    const relevance = scoreTopicVectorRelevance(post.topicVector, { ...topicWeights });
    const preliminaryScore = (
      scoreRecencyAt(post.createdAt, RANKING_V2_SCORING_WINDOW_HOURS, asOf)
        * requireWeight(weights, 'recency')
    ) + (
      scoreEngagement(post.likeCount, post.repostCount, post.replyCount)
        * requireWeight(weights, 'engagement')
    ) + (relevance * requireWeight(weights, 'relevance'));
    inputs.push({
      post,
      policyRelevance: relevance,
      previousSnapshotPosition: previousSnapshotPositions.get(post.uri) ?? null,
      preliminaryScore,
    });
  }
  return { inputs, exclusionCount };
}

function toReplayCandidate(feature: ReturnType<typeof computeRankingV2Features>[number]): JsonObject {
  return {
    uri: feature.candidate.post.uri,
    createdAt: feature.candidate.post.createdAt.toISOString(),
    authorDid: feature.candidate.post.authorDid,
    candidateSources: [...feature.candidate.candidateSources],
    immutable: {
      cid: feature.candidate.post.cid,
      text: feature.candidate.post.text,
      replyRoot: feature.candidate.post.replyRoot,
      replyParent: feature.candidate.post.replyParent,
      langs: [...feature.candidate.post.langs],
      hasMedia: feature.candidate.post.hasMedia,
      topicVector: feature.candidate.post.topicVector ?? {},
      classificationMethod: feature.candidate.post.classificationMethod ?? null,
    },
    eventTime: {
      likeCount: feature.candidate.post.likeCount,
      repostCount: feature.candidate.post.repostCount,
      replyCount: feature.candidate.post.replyCount,
    },
    raw: { ...feature.raw },
    weights: { ...feature.weights },
    weighted: { ...feature.weighted },
    evidence: feature.evidence,
    baseScore: feature.baseScore,
  };
}

function rankingMetrics(items: readonly { authorDid: string }[]): JsonObject {
  const top100 = items.slice(0, 100);
  return {
    uniqueAuthors: new Set(items.map((item) => item.authorDid)).size,
    top100UniqueAuthors: new Set(top100.map((item) => item.authorDid)).size,
  };
}

function policyContentRules(contentRules: JsonObject): ContentRules {
  return toContentRules(contentRules);
}

function replayFeature(candidate: ReplayCandidate): ReturnType<typeof computeRankingV2Features>[number] {
  const immutable = candidate.immutable;
  const eventTime = candidate.eventTime;
  return {
    candidate: {
      post: {
        uri: candidate.uri,
        cid: immutable.cid,
        authorDid: candidate.authorDid,
        text: immutable.text,
        replyRoot: immutable.replyRoot,
        replyParent: immutable.replyParent,
        langs: immutable.langs,
        hasMedia: immutable.hasMedia,
        createdAt: new Date(candidate.createdAt),
        likeCount: eventTime.likeCount,
        repostCount: eventTime.repostCount,
        replyCount: eventTime.replyCount,
        topicVector: immutable.topicVector,
        classificationMethod: immutable.classificationMethod ?? undefined,
      },
      policyRelevance: candidate.raw.relevance ?? 0,
      previousSnapshotPosition: null,
      preliminaryScore: candidate.baseScore,
      candidateSources: candidate.candidateSources,
    },
    raw: candidate.raw,
    weights: candidate.weights,
    weighted: candidate.weighted,
    evidence: candidate.evidence,
    baseScore: candidate.baseScore,
  };
}

function assertOptions(options: RankingV2ShadowOptions): void {
  if (!options.communityId.trim()) {
    throw new Error('communityId must be non-empty');
  }
  if (!Number.isFinite(options.asOf.getTime())) {
    throw new RangeError('asOf must be a valid timestamp');
  }
  if (!/^[0-9a-f]{40,64}$/.test(options.codeSha)) {
    throw new Error('codeSha must be a lowercase 40-64 character hexadecimal digest');
  }
}

function failureDetails(error: unknown): JsonObject {
  return {
    name: error instanceof Error ? error.name : 'UnknownError',
    message: messageFromError(error),
  };
}

function messageFromError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
