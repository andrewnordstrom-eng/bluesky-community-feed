import type { Pool } from 'pg';
import { config } from '../config.js';
import { db as defaultDb } from '../db/client.js';
import {
  type FeedCommunity,
  type FeedCommunitySeedWeights,
} from './community-registry.js';

export interface CommunityScoutThresholds {
  candidatePostsPerDay: number;
  uniqueAuthorsPerDay: number;
  strongBridgeHighRelevancePostsPerDay: number;
}

export interface CommunityScoutReport {
  communityId: FeedCommunity['communityId'];
  name: string;
  status: 'ready' | 'thin' | 'unavailable';
  source: 'production_scores';
  activeEpochId: number | null;
  sampledAt: string;
  windowHours: number;
  candidatePosts: number;
  candidatePostsPerDay: number;
  uniqueAuthors: number;
  uniqueAuthorsPerDay: number;
  bridgePostShare: number;
  topAuthorConcentration: number;
  strongBridgeHighRelevancePosts: number;
  strongBridgeHighRelevancePostsPerDay: number;
  samplePostUris: string[];
  thresholds: CommunityScoutThresholds;
  warnings: string[];
}

export interface MaterializedCommunityFeedResult {
  communityId: FeedCommunity['communityId'];
  redisKeysWritten: string[];
  rankedCount: number;
  activeEpochId: number | null;
  report: CommunityScoutReport;
}

interface CandidateRow {
  uri: string | null;
  author_did: string | null;
  text: string | null;
  active_epoch_id: string | number | null;
  recency_score: string | number | null;
  engagement_score: string | number | null;
  bridging_score: string | number | null;
  source_diversity_score: string | number | null;
  relevance_score: string | number | null;
  community_score: string | number | null;
  candidate_count: string | number;
  unique_author_count: string | number;
  bridge_post_count: string | number;
  strong_bridge_high_relevance_count: string | number;
  top_author_post_count: string | number;
}

interface CommunityMaterializerRedisTransaction {
  del(key: string): CommunityMaterializerRedisTransaction;
  zadd(key: string, score: number, member: string): CommunityMaterializerRedisTransaction;
  set(key: string, value: string): CommunityMaterializerRedisTransaction;
  incr(key: string): CommunityMaterializerRedisTransaction;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

export interface CommunityMaterializerRedis {
  multi(): CommunityMaterializerRedisTransaction;
}

export interface CommunityScoutOptions {
  community: FeedCommunity;
  dbPool: Pick<Pool, 'query'>;
  now: Date;
  windowHours: number;
  limit: number;
}

export interface MaterializeCommunityFeedOptions extends CommunityScoutOptions {
  redisClient: CommunityMaterializerRedis;
}

export const COMMUNITY_SCOUT_THRESHOLDS: CommunityScoutThresholds = {
  candidatePostsPerDay: 100,
  uniqueAuthorsPerDay: 30,
  strongBridgeHighRelevancePostsPerDay: 10,
};

export async function scoutCommunityFeed(options: CommunityScoutOptions): Promise<CommunityScoutReport> {
  assertBirdersCommunity(options.community);
  const snapshot = await readCommunitySnapshot(options);
  return buildScoutReport({
    community: options.community,
    now: options.now,
    windowHours: options.windowHours,
    snapshot,
  });
}

export async function materializeCommunityFeed(
  options: MaterializeCommunityFeedOptions
): Promise<MaterializedCommunityFeedResult> {
  assertBirdersCommunity(options.community);
  const snapshot = await readCommunitySnapshot(options);
  const report = buildScoutReport({
    community: options.community,
    now: options.now,
    windowHours: options.windowHours,
    snapshot,
  });
  const rankedCandidates = snapshot.candidates
    .slice()
    .sort((left, right) => right.communityScore - left.communityScore)
    .slice(0, config.FEED_MAX_POSTS);

  const transaction = options.redisClient.multi();
  transaction.del(options.community.redis.current);
  for (const candidate of rankedCandidates) {
    transaction.zadd(options.community.redis.current, candidate.communityScore, candidate.uri);
  }
  transaction.set(options.community.redis.epoch, String(report.activeEpochId ?? 0));
  transaction.set(options.community.redis.health, JSON.stringify(report));
  transaction.incr(options.community.redis.snapshotGeneration);
  transaction.del(options.community.redis.currentSnapshot);
  const results = await transaction.exec();
  if (results === null) {
    throw new Error(`Birders Redis transaction aborted for ${options.community.communityId}`);
  }
  const failedCommand = results.find(([error]) => error !== null);
  if (failedCommand) {
    throw new Error(
      `Birders Redis transaction failed for ${options.community.communityId}: ${failedCommand[0]?.message ?? 'unknown command error'}`
    );
  }

  return {
    communityId: options.community.communityId,
    redisKeysWritten: [
      options.community.redis.current,
      options.community.redis.epoch,
      options.community.redis.health,
      options.community.redis.snapshotGeneration,
      options.community.redis.currentSnapshot,
    ],
    rankedCount: rankedCandidates.length,
    activeEpochId: report.activeEpochId,
    report,
  };
}

export async function scoutDefaultBirdersFeed(options: {
  community: FeedCommunity;
  now: Date;
  windowHours: number;
  limit: number;
}): Promise<CommunityScoutReport> {
  return scoutCommunityFeed({
    community: options.community,
    dbPool: defaultDb,
    now: options.now,
    windowHours: options.windowHours,
    limit: options.limit,
  });
}

export function postMatchesCommunityTerms(text: string, community: FeedCommunity): boolean {
  const lowered = text.toLowerCase();
  return [...community.terms.candidateTerms, ...community.terms.bridgeTerms].some((term) =>
    lowered.includes(term.toLowerCase())
  );
}

export function postMatchesBridgeTerms(text: string, community: FeedCommunity): boolean {
  const lowered = text.toLowerCase();
  return community.terms.bridgeTerms.some((term) => lowered.includes(term.toLowerCase()));
}

function assertBirdersCommunity(community: FeedCommunity): void {
  if (community.communityId !== 'birders_who_code') {
    throw new Error(`Community materializer only supports birders_who_code in v1; received ${community.communityId}`);
  }
}

async function readCommunitySnapshot(options: CommunityScoutOptions): Promise<{
  activeEpochId: number | null;
  metrics: CandidateMetrics;
  candidates: MaterializedCandidate[];
}> {
  const termPatterns = [...options.community.terms.candidateTerms, ...options.community.terms.bridgeTerms].map((term) =>
    sqlLikePatternForTerm(term)
  );
  const bridgePatterns = options.community.terms.bridgeTerms.map((term) => sqlLikePatternForTerm(term));
  if (termPatterns.length === 0) {
    return {
      activeEpochId: null,
      metrics: emptyCandidateMetrics(),
      candidates: [],
    };
  }
  const weights = options.community.seedWeights;
  const result = await options.dbPool.query<CandidateRow>(
    `WITH active_epoch AS (
       SELECT id
       FROM governance_epochs
       WHERE status = 'active'
       ORDER BY id DESC
       LIMIT 1
     ),
     matching_posts AS (
       SELECT p.uri,
              p.author_did,
              p.text,
              LOWER(COALESCE(p.text, '')) AS normalized_text
       FROM posts p
       WHERE p.deleted = FALSE
         AND p.created_at >= NOW() - ($1::int * INTERVAL '1 hour')
         AND p.text ILIKE ANY($2::text[])
     ),
     scored_candidates AS (
       SELECT DISTINCT ON (mp.uri)
              mp.uri,
              mp.author_did,
              mp.text,
              mp.normalized_text,
              ae.id AS epoch_id,
              ps.recency_score,
              ps.engagement_score,
              ps.bridging_score,
              ps.source_diversity_score,
              ps.relevance_score,
              (
                ps.recency_score * $3::float8 +
                ps.engagement_score * $4::float8 +
                ps.bridging_score * $5::float8 +
                ps.source_diversity_score * $6::float8 +
                ps.relevance_score * $7::float8
              ) AS community_score
       FROM active_epoch ae
       JOIN matching_posts mp ON TRUE
       JOIN post_scores ps ON ps.post_uri = mp.uri AND ps.epoch_id = ae.id
       ORDER BY mp.uri, ps.scored_at DESC
     ),
     author_counts AS (
       SELECT author_did, COUNT(*) AS author_post_count
       FROM scored_candidates
       GROUP BY author_did
     ),
     metrics AS (
       SELECT
         ae.id AS active_epoch_id,
         COUNT(sc.uri) AS candidate_count,
         COUNT(DISTINCT sc.author_did) AS unique_author_count,
         COUNT(sc.uri) FILTER (WHERE sc.normalized_text LIKE ANY($8::text[])) AS bridge_post_count,
         COUNT(sc.uri) FILTER (
           WHERE sc.normalized_text LIKE ANY($8::text[])
             AND sc.relevance_score >= 0.65
         ) AS strong_bridge_high_relevance_count,
         COALESCE(MAX(ac.author_post_count), 0) AS top_author_post_count
       FROM (SELECT 1) seed
       LEFT JOIN active_epoch ae ON TRUE
       LEFT JOIN scored_candidates sc ON TRUE
       LEFT JOIN author_counts ac ON ac.author_did = sc.author_did
       GROUP BY ae.id
     ),
     sampled_candidates AS (
       SELECT *
       FROM scored_candidates
       ORDER BY community_score DESC, uri ASC
       LIMIT $9::int
     )
     SELECT sc.*, m.active_epoch_id, m.candidate_count, m.unique_author_count, m.bridge_post_count,
            m.strong_bridge_high_relevance_count, m.top_author_post_count
     FROM metrics m
     LEFT JOIN sampled_candidates sc ON TRUE
     ORDER BY sc.community_score DESC NULLS LAST, sc.uri ASC NULLS LAST`,
    [
      options.windowHours,
      termPatterns,
      weights.recency,
      weights.engagement,
      weights.bridging,
      weights.sourceDiversity,
      weights.relevance,
      bridgePatterns,
      options.limit,
    ]
  );
  const firstRow = result.rows[0];
  return {
    activeEpochId: firstRow ? nullableFiniteInteger(firstRow.active_epoch_id) : null,
    metrics: firstRow ? candidateMetricsFromRow(firstRow) : emptyCandidateMetrics(),
    candidates: result.rows
      .map((row) => materializedCandidateFromRow(row, weights, options.community))
      .filter((candidate) => candidate !== null),
  };
}

interface MaterializedCandidate {
  uri: string;
  authorDid: string;
  text: string;
  epochId: number;
  communityScore: number;
  relevanceScore: number;
  bridgeMatch: boolean;
  metrics: CandidateMetrics;
}

interface CandidateMetrics {
  candidateCount: number;
  uniqueAuthorCount: number;
  bridgePostCount: number;
  strongBridgeHighRelevanceCount: number;
  topAuthorPostCount: number;
}

function materializedCandidateFromRow(
  row: CandidateRow,
  weights: FeedCommunitySeedWeights,
  community: FeedCommunity
): MaterializedCandidate | null {
  const activeEpochId = nullableFiniteInteger(row.active_epoch_id);
  if (row.uri === null || row.author_did === null || activeEpochId === null) {
    return null;
  }
  const recency = finiteNumber(row.recency_score);
  const engagement = finiteNumber(row.engagement_score);
  const bridging = finiteNumber(row.bridging_score);
  const sourceDiversity = finiteNumber(row.source_diversity_score);
  const relevance = finiteNumber(row.relevance_score);
  const reportedScore = finiteNumber(row.community_score);
  const computedScore =
    recency * weights.recency +
    engagement * weights.engagement +
    bridging * weights.bridging +
    sourceDiversity * weights.sourceDiversity +
    relevance * weights.relevance;
  const score = Number.isFinite(reportedScore) ? reportedScore : computedScore;
  const text = row.text ?? '';
  if (!Number.isFinite(score) || !Number.isFinite(relevance) || text.trim().length === 0) {
    return null;
  }
  return {
    uri: row.uri,
    authorDid: row.author_did,
    text,
    epochId: activeEpochId,
    communityScore: score,
    relevanceScore: relevance,
    bridgeMatch: postMatchesBridgeTerms(text, community),
    metrics: candidateMetricsFromRow(row),
  };
}

function candidateMetricsFromRow(row: CandidateRow): CandidateMetrics {
  return {
    candidateCount: finiteNumber(row.candidate_count),
    uniqueAuthorCount: finiteNumber(row.unique_author_count),
    bridgePostCount: finiteNumber(row.bridge_post_count),
    strongBridgeHighRelevanceCount: finiteNumber(row.strong_bridge_high_relevance_count),
    topAuthorPostCount: finiteNumber(row.top_author_post_count),
  };
}

function emptyCandidateMetrics(): CandidateMetrics {
  return {
    candidateCount: 0,
    uniqueAuthorCount: 0,
    bridgePostCount: 0,
    strongBridgeHighRelevanceCount: 0,
    topAuthorPostCount: 0,
  };
}

function buildScoutReport(options: {
  community: FeedCommunity;
  now: Date;
  windowHours: number;
  snapshot: {
    activeEpochId: number | null;
    metrics: CandidateMetrics;
    candidates: MaterializedCandidate[];
  };
}): CommunityScoutReport {
  const activeEpochId = options.snapshot.activeEpochId;
  const metrics = options.snapshot.metrics;
  const candidatePosts = metrics.candidateCount;
  const uniqueAuthors = metrics.uniqueAuthorCount;
  const bridgePosts = metrics.bridgePostCount;
  const strongBridgeHighRelevancePosts = metrics.strongBridgeHighRelevanceCount;
  const candidatePostsPerDay = perDay(candidatePosts, options.windowHours);
  const uniqueAuthorsPerDay = perDay(uniqueAuthors, options.windowHours);
  const strongBridgeHighRelevancePostsPerDay = perDay(strongBridgeHighRelevancePosts, options.windowHours);
  const status = reportStatus({
    activeEpochId,
    candidatePostsPerDay,
    uniqueAuthorsPerDay,
    strongBridgeHighRelevancePostsPerDay,
  });
  const warnings = reportWarnings({
    activeEpochId,
    status,
    candidatePostsPerDay,
    uniqueAuthorsPerDay,
    strongBridgeHighRelevancePostsPerDay,
  });

  return {
    communityId: options.community.communityId,
    name: options.community.name,
    status,
    source: 'production_scores',
    activeEpochId,
    sampledAt: options.now.toISOString(),
    windowHours: options.windowHours,
    candidatePosts,
    candidatePostsPerDay,
    uniqueAuthors,
    uniqueAuthorsPerDay,
    bridgePostShare: candidatePosts === 0 ? 0 : bridgePosts / candidatePosts,
    topAuthorConcentration: candidatePosts === 0 ? 0 : metrics.topAuthorPostCount / candidatePosts,
    strongBridgeHighRelevancePosts,
    strongBridgeHighRelevancePostsPerDay,
    samplePostUris: options.snapshot.candidates.slice(0, 10).map((candidate) => candidate.uri),
    thresholds: COMMUNITY_SCOUT_THRESHOLDS,
    warnings,
  };
}

function reportStatus(options: {
  activeEpochId: number | null;
  candidatePostsPerDay: number;
  uniqueAuthorsPerDay: number;
  strongBridgeHighRelevancePostsPerDay: number;
}): CommunityScoutReport['status'] {
  if (options.activeEpochId === null) {
    return 'unavailable';
  }
  if (
    options.candidatePostsPerDay >= COMMUNITY_SCOUT_THRESHOLDS.candidatePostsPerDay &&
    options.uniqueAuthorsPerDay >= COMMUNITY_SCOUT_THRESHOLDS.uniqueAuthorsPerDay &&
    options.strongBridgeHighRelevancePostsPerDay >= COMMUNITY_SCOUT_THRESHOLDS.strongBridgeHighRelevancePostsPerDay
  ) {
    return 'ready';
  }
  return 'thin';
}

function reportWarnings(options: {
  activeEpochId: number | null;
  status: CommunityScoutReport['status'];
  candidatePostsPerDay: number;
  uniqueAuthorsPerDay: number;
  strongBridgeHighRelevancePostsPerDay: number;
}): string[] {
  const warnings: string[] = [];
  if (options.activeEpochId === null) {
    warnings.push('No active production epoch was available for Birders materialization.');
    return warnings;
  }
  if (options.status !== 'ready') {
    warnings.push('Birders supply is below the readiness threshold; keep the feed disabled.');
  }
  if (options.candidatePostsPerDay < COMMUNITY_SCOUT_THRESHOLDS.candidatePostsPerDay) {
    warnings.push(`Candidate volume ${options.candidatePostsPerDay.toFixed(1)}/day is below 100/day.`);
  }
  if (options.uniqueAuthorsPerDay < COMMUNITY_SCOUT_THRESHOLDS.uniqueAuthorsPerDay) {
    warnings.push(`Unique authors ${options.uniqueAuthorsPerDay.toFixed(1)}/day is below 30/day.`);
  }
  if (
    options.strongBridgeHighRelevancePostsPerDay <
    COMMUNITY_SCOUT_THRESHOLDS.strongBridgeHighRelevancePostsPerDay
  ) {
    warnings.push(
      `Strong bridge/high-relevance supply ${options.strongBridgeHighRelevancePostsPerDay.toFixed(1)}/day is below 10/day.`
    );
  }
  return warnings;
}

function perDay(count: number, windowHours: number): number {
  if (windowHours <= 0) {
    throw new Error(`windowHours must be positive; received ${windowHours}`);
  }
  return (count / windowHours) * 24;
}

function finiteNumber(value: string | number | null): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return Number.NaN;
  }
  return parsed;
}

function nullableFiniteInteger(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = finiteNumber(value);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  return parsed;
}

function sqlLikePatternForTerm(term: string): string {
  return `%${term.toLowerCase()}%`;
}
