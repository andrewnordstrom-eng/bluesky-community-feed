import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { materializeActivePolicyVersion, hashCanonicalJson } from '../governance/policy-version.js';
import { checkContentRules } from '../governance/content-filter.js';
import { toContentRules } from '../governance/governance.types.js';
import type { ContentRules } from '../shared/api-types.js';
import type {
  CandidateSource,
  JsonObject,
  JsonValue,
  RankedSlateItem,
  RankingReceipt,
  RankingRunInputEnvelope,
  RankingRunContext,
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
  buildCandidateUnion,
  type RankingV2CandidateInput,
} from './ranking-v2-candidates.js';
import { computeRankingV2Features } from './ranking-v2-features.js';
import { SourceDiversitySlateReranker } from './ranking-v2-slate.js';
import { toPostForScoring, type PostForScoring } from './score.types.js';

export const RANKING_V2_ALGORITHM_VERSION = 'corgi-ranking-v2';
export const RANKING_V2_SCORING_WINDOW_HOURS = 72;
export const RANKING_V2_SLATE_LIMIT = 1000;

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

export function replayRankingV2Slate(
  envelope: RankingRunInputEnvelope,
  sourceDiversityWeight: number
): readonly RankedSlateItem[] {
  const features = envelope.candidates.map((candidate, index) => replayFeature(candidate, index));
  return new SourceDiversitySlateReranker(sourceDiversityWeight).rerank(
    features,
    Math.min(RANKING_V2_SLATE_LIMIT, features.length)
  );
}

interface CandidateRow extends Record<string, unknown> {
  uri: string;
  created_at: Date | string;
}

export async function runRankingV2Shadow(
  pool: Pool,
  options: RankingV2ShadowOptions
): Promise<RankingV2ShadowResult> {
  assertOptions(options);
  const client = await pool.connect();
  const startedAt = Date.now();
  let context: RankingRunContext | null = null;
  let transactionOpen = false;
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
    const sourceDiversityWeight = requiredWeight(context.policy.weights, 'sourceDiversity');
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
      throw new AggregateError(
        [error, ...cleanupErrors],
        `Ranking v2 failed and cleanup was incomplete: ${messageFromError(error)}`
      );
    }
    throw error;
  } finally {
    client.release();
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
      ORDER BY p.created_at DESC, p.uri ASC`,
    [cutoff.toISOString(), asOf.toISOString()]
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
        * requiredWeight(weights, 'recency')
    ) + (
      scoreEngagement(post.likeCount, post.repostCount, post.replyCount)
        * requiredWeight(weights, 'engagement')
    ) + (relevance * requiredWeight(weights, 'relevance'));
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
      topicVector: feature.candidate.post.topicVector ?? {},
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

function requiredWeight(weights: Readonly<Record<string, number>>, key: string): number {
  const value = weights[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Pinned policy is missing weight in [0, 1] for ${key}`);
  }
  return value;
}

function replayFeature(candidate: JsonObject, index: number): ReturnType<typeof computeRankingV2Features>[number] {
  const uri = requiredString(candidate.uri, `candidates[${index}].uri`);
  const createdAt = requiredDate(candidate.createdAt, `candidates[${index}].createdAt`);
  const authorDid = requiredString(candidate.authorDid, `candidates[${index}].authorDid`);
  const immutable = requiredObject(candidate.immutable, `candidates[${index}].immutable`);
  const eventTime = requiredObject(candidate.eventTime, `candidates[${index}].eventTime`);
  const raw = numericRecord(candidate.raw, `candidates[${index}].raw`);
  const weights = numericRecord(candidate.weights, `candidates[${index}].weights`);
  const weighted = numericRecord(candidate.weighted, `candidates[${index}].weighted`);
  const baseScore = requiredNumber(candidate.baseScore, `candidates[${index}].baseScore`);
  const candidateSources = requiredCandidateSources(
    candidate.candidateSources,
    `candidates[${index}].candidateSources`
  );
  return {
    candidate: {
      post: {
        uri,
        cid: requiredString(immutable.cid, `candidates[${index}].immutable.cid`),
        authorDid,
        text: optionalString(immutable.text, `candidates[${index}].immutable.text`),
        replyRoot: null,
        replyParent: null,
        langs: [],
        hasMedia: false,
        createdAt,
        likeCount: requiredNumber(eventTime.likeCount, `candidates[${index}].eventTime.likeCount`),
        repostCount: requiredNumber(eventTime.repostCount, `candidates[${index}].eventTime.repostCount`),
        replyCount: requiredNumber(eventTime.replyCount, `candidates[${index}].eventTime.replyCount`),
        topicVector: numericRecord(
          immutable.topicVector,
          `candidates[${index}].immutable.topicVector`
        ),
        classificationMethod: 'keyword',
      },
      policyRelevance: raw.relevance ?? 0,
      previousSnapshotPosition: null,
      preliminaryScore: baseScore,
      candidateSources,
    },
    raw,
    weights,
    weighted,
    evidence: requiredObject(candidate.evidence, `candidates[${index}].evidence`),
    baseScore,
  };
}

function requiredObject(value: JsonValue | undefined, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: JsonValue | undefined, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string or null`);
  }
  return value;
}

function requiredNumber(value: JsonValue | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function requiredDate(value: JsonValue | undefined, label: string): Date {
  const date = new Date(requiredString(value, label));
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  return date;
}

function numericRecord(value: JsonValue | undefined, label: string): Record<string, number> {
  const object = requiredObject(value, label);
  const output: Record<string, number> = {};
  for (const [key, member] of Object.entries(object)) {
    output[key] = requiredNumber(member, `${label}.${key}`);
  }
  return output;
}

function requiredCandidateSources(
  value: JsonValue | undefined,
  label: string
): readonly CandidateSource[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  const allowed = new Set<CandidateSource>([
    'newest',
    'engagement',
    'policy_relevance',
    'previous_snapshot',
    'preliminary_fill',
  ]);
  return value.map((member, index) => {
    if (typeof member !== 'string' || !allowed.has(member as CandidateSource)) {
      throw new Error(`${label}[${index}] is not a valid candidate source`);
    }
    return member as CandidateSource;
  });
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
