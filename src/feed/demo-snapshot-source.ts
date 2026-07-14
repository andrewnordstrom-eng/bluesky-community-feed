import { createHash } from 'node:crypto';
import { z } from 'zod';
import { COMMUNITY_GOV_REDIS_KEYS } from './community-registry.js';
import approvedManifestJson from '../demo/community-gov-release-snapshot.json' with { type: 'json' };

export const COMMUNITY_GOV_FEED_URI =
  'at://did:plc:amzyknmm4auxijvykyfgznw2/app.bsky.feed.generator/community-gov';
export const COMMUNITY_GOV_FEED_NAME = 'Corgi Commons';
const LEGACY_COMMUNITY_GOV_FEED_NAME = 'Community Governed Feed';
export const DEMO_SOURCE_SNAPSHOT_LIMIT = 100;
export const COMMUNITY_GOV_ACTIVE_TOPIC_COUNT = 26;

export interface PublishedFeedEntry {
  uri: string;
  publishedRank: number;
  publishedScore: number;
  frozen?: FrozenPublishedFeedInputs;
}

export interface FrozenPublishedFeedInputs {
  reviewedCid?: string | null;
  authorDid: string;
  createdAt: string;
  topicVector: Record<string, number>;
  embedUrl: string | null;
  textLength: number;
  scoreRunId: string;
  scoreEpochId: number;
  componentScore: number;
  scoredAt: string;
  rawScores: {
    recency: number;
    engagement: number;
    bridging: number;
    source_diversity: number;
    relevance: number;
  };
}

export interface PublishedFeedSnapshot {
  feedUri: typeof COMMUNITY_GOV_FEED_URI;
  feedName: typeof COMMUNITY_GOV_FEED_NAME;
  productionEpochId: number;
  sourceRunId: string;
  sourceUpdatedAt: string;
  capturedAt: string;
  reviewedAt: string | null;
  selectionPolicyVersion: string;
  snapshotDigest: string;
  baselineOrderDigest: string;
  entries: PublishedFeedEntry[];
}

const ApprovedSignalWeightsSchema = z.object({
  recency: z.number().finite().min(0).max(1),
  engagement: z.number().finite().min(0).max(1),
  bridging: z.number().finite().min(0).max(1),
  source_diversity: z.number().finite().min(0).max(1),
  relevance: z.number().finite().min(0).max(1),
}).strict();
const ApprovedTopicCatalogSchema = z.array(z.object({
  slug: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1),
  description: z.string().nullable(),
  baselineWeight: z.number().finite().min(0).max(1),
}).strict()).length(COMMUNITY_GOV_ACTIVE_TOPIC_COUNT);
const ApprovedPublicationPolicySchema = z.object({
  urlDedupEnabled: z.boolean(),
  minimumOriginalTextLength: z.number().finite().nonnegative(),
  minimumRelevance: z.number().finite().min(0).max(1),
  decay: z.array(z.number().finite().positive().max(1)).min(1),
}).strict();
const FrozenRawScoresSchema = z.object({
  recency: z.number().finite(),
  engagement: z.number().finite(),
  bridging: z.number().finite(),
  source_diversity: z.number().finite(),
  relevance: z.number().finite(),
}).strict();
const FrozenPublishedFeedInputsSchema = z.object({
  reviewedCid: z.string().trim().min(1).nullable(),
  authorDid: z.string().startsWith('did:'),
  createdAt: z.string().datetime({ offset: true }),
  topicVector: z.record(z.string().trim().min(1).max(64), z.number().finite().min(0).max(1)),
  embedUrl: z.string().url().nullable(),
  textLength: z.number().int().nonnegative(),
  scoreRunId: z.string().trim().min(1),
  scoreEpochId: z.number().int().positive(),
  componentScore: z.number().finite().nonnegative(),
  scoredAt: z.string().datetime({ offset: true }),
  rawScores: FrozenRawScoresSchema,
}).strict();
const ApprovedPolicySchema = z.object({
  signalWeights: ApprovedSignalWeightsSchema,
  topicCatalog: ApprovedTopicCatalogSchema,
  publicationPolicy: ApprovedPublicationPolicySchema,
}).passthrough();
const ApprovedSnapshotManifestSchema = z.object({
  schemaVersion: z.literal('2026-07-11.community-gov-snapshot.v3'),
  feedUri: z.literal(COMMUNITY_GOV_FEED_URI),
  // Accept the previously approved manifest until the mechanically captured
  // Corgi Commons manifest lands. Runtime presentation always uses the current
  // canonical name returned by readApprovedCommunityGovSnapshot().
  feedName: z.union([
    z.literal(COMMUNITY_GOV_FEED_NAME),
    z.literal(LEGACY_COMMUNITY_GOV_FEED_NAME),
  ]),
  productionEpochId: z.number().int().positive(),
  sourceRunId: z.string().trim().min(1),
  sourceUpdatedAt: z.string().datetime({ offset: true }),
  capturedAt: z.string().datetime({ offset: true }),
  reviewedAt: z.string().datetime({ offset: true }),
  selectionPolicyVersion: z.string().trim().min(1),
  snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
  baselineOrderDigest: z.string().regex(/^[a-f0-9]{64}$/),
  signalWeights: ApprovedSignalWeightsSchema,
  topicCatalog: ApprovedTopicCatalogSchema,
  publicationPolicy: ApprovedPublicationPolicySchema,
  entries: z.array(z.object({
    uri: z.string().startsWith('at://'),
    publishedRank: z.number().int().positive(),
    publishedScore: z.number().finite().nonnegative(),
    frozen: FrozenPublishedFeedInputsSchema,
  }).strict()).length(DEMO_SOURCE_SNAPSHOT_LIMIT),
}).strict();

type ApprovedSnapshotManifest = z.infer<typeof ApprovedSnapshotManifestSchema>;

export interface DemoSnapshotRedisReader {
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export async function readPublishedCommunityGovSnapshot(
  reader: DemoSnapshotRedisReader,
  limit: number
): Promise<PublishedFeedSnapshot> {
  if (limit !== DEMO_SOURCE_SNAPSHOT_LIMIT) {
    throw new Error(`Corgi Commons release snapshot limit must equal ${DEMO_SOURCE_SNAPSHOT_LIMIT}: ${limit}`);
  }
  const snapshotRead = await reader.eval(
    `local ranked = redis.call('ZREVRANGE', KEYS[1], 0, tonumber(ARGV[1]), 'WITHSCORES')
     local metadata = redis.call('MGET', KEYS[2], KEYS[3], KEYS[4])
     return {ranked, metadata}`,
    4,
    COMMUNITY_GOV_REDIS_KEYS.current,
    COMMUNITY_GOV_REDIS_KEYS.epoch,
    'feed:run_id',
    'feed:updated_at',
    limit - 1
  );
  if (!Array.isArray(snapshotRead) || !Array.isArray(snapshotRead[0]) || !Array.isArray(snapshotRead[1])) {
    throw new Error('Corgi Commons atomic snapshot read returned an invalid response');
  }
  const ranked = snapshotRead[0].map(String);
  const metadata = snapshotRead[1].map((value) => value === null ? null : String(value));
  if (ranked.length !== limit * 2) {
    throw new Error(`Corgi Commons snapshot returned ${ranked.length} ranked values; expected ${limit * 2}`);
  }
  const productionEpochId = Number(metadata[0]);
  const sourceRunId = metadata[1];
  const sourceUpdatedAt = metadata[2];
  if (
    !Number.isInteger(productionEpochId)
    || productionEpochId < 1
    || !sourceRunId?.trim()
    || !sourceUpdatedAt
    || Number.isNaN(Date.parse(sourceUpdatedAt))
  ) {
    throw new Error('Corgi Commons snapshot metadata is incomplete or invalid');
  }
  const entries: PublishedFeedEntry[] = [];
  for (let index = 0; index < ranked.length; index += 2) {
    const uri = ranked[index];
    const publishedScore = Number(ranked[index + 1]);
    if (!uri.startsWith('at://') || !Number.isFinite(publishedScore) || publishedScore < 0) {
      throw new Error(`Corgi Commons snapshot contains an invalid entry at rank ${index / 2 + 1}`);
    }
    entries.push({ uri, publishedRank: index / 2 + 1, publishedScore });
  }
  if (new Set(entries.map((entry) => entry.uri)).size !== entries.length) {
    throw new Error('Corgi Commons snapshot contains duplicate post URIs');
  }
  return {
    feedUri: COMMUNITY_GOV_FEED_URI,
    feedName: COMMUNITY_GOV_FEED_NAME,
    productionEpochId,
    sourceRunId,
    sourceUpdatedAt,
    capturedAt: new Date().toISOString(),
    reviewedAt: null,
    selectionPolicyVersion: 'community-gov-reviewer-safe-v1',
    snapshotDigest: snapshotDigest(entries),
    baselineOrderDigest: baselineOrderDigest(entries),
    entries,
  };
}

export function createDefaultPublishedFeedSnapshotReader(): (limit: number) => Promise<PublishedFeedSnapshot> {
  return async (limit) => readApprovedCommunityGovSnapshot(limit);
}

export function createLivePublishedFeedSnapshotReader(): (limit: number) => Promise<PublishedFeedSnapshot> {
  return async (limit) => {
    const { redis } = await import('../db/redis.js');
    return readPublishedCommunityGovSnapshot(redis, limit);
  };
}

export function readApprovedCommunityGovSnapshot(limit: number): PublishedFeedSnapshot {
  if (limit !== DEMO_SOURCE_SNAPSHOT_LIMIT) {
    throw new Error(`Approved Corgi Commons snapshot must be read at its full ${DEMO_SOURCE_SNAPSHOT_LIMIT}-entry size`);
  }
  const manifest = parseApprovedSnapshotManifest(approvedManifestJson);
  const entries = manifest.entries.map((entry, index) => {
    if (
      entry.publishedRank !== index + 1
      || !entry.uri.startsWith('at://')
      || !Number.isFinite(entry.publishedScore)
    ) {
      throw new Error(`Approved Corgi Commons snapshot contains an invalid entry at rank ${index + 1}`);
    }
    return {
      ...entry,
      frozen: {
        ...entry.frozen,
        topicVector: { ...entry.frozen.topicVector },
        rawScores: { ...entry.frozen.rawScores },
      },
    };
  });
  if (new Set(entries.map((entry) => entry.uri)).size !== entries.length) {
    throw new Error('Approved Corgi Commons snapshot contains duplicate post URIs');
  }
  const digest = communityGovManifestDigest(manifest);
  if (digest !== manifest.snapshotDigest) {
    throw new Error(`Approved Corgi Commons snapshot digest mismatch: expected ${manifest.snapshotDigest}, computed ${digest}`);
  }
  return {
    feedUri: COMMUNITY_GOV_FEED_URI,
    feedName: COMMUNITY_GOV_FEED_NAME,
    productionEpochId: manifest.productionEpochId,
    sourceRunId: manifest.sourceRunId,
    sourceUpdatedAt: manifest.sourceUpdatedAt,
    capturedAt: manifest.capturedAt,
    reviewedAt: manifest.reviewedAt,
    selectionPolicyVersion: manifest.selectionPolicyVersion,
    snapshotDigest: digest,
    baselineOrderDigest: manifest.baselineOrderDigest,
    entries,
  };
}

export function readApprovedCommunityGovPolicy(): {
  signalWeights: ApprovedSnapshotManifest['signalWeights'];
  topicCatalog: ApprovedSnapshotManifest['topicCatalog'];
  publicationPolicy: ApprovedSnapshotManifest['publicationPolicy'];
} {
  return parseApprovedCommunityGovPolicy(approvedManifestJson);
}

export function parseApprovedCommunityGovPolicy(input: unknown): {
  signalWeights: ApprovedSnapshotManifest['signalWeights'];
  topicCatalog: ApprovedSnapshotManifest['topicCatalog'];
  publicationPolicy: ApprovedSnapshotManifest['publicationPolicy'];
} {
  const parsed = ApprovedPolicySchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Approved Corgi Commons policy manifest is invalid: ${detail}`);
  }
  const policy = parsed.data;
  const topicSlugs = policy.topicCatalog.map((topic) => topic.slug);
  if (
    policy.topicCatalog.length !== COMMUNITY_GOV_ACTIVE_TOPIC_COUNT
    || new Set(topicSlugs).size !== policy.topicCatalog.length
    || policy.topicCatalog.some((topic) => !topic.slug || !topic.name || !Number.isFinite(topic.baselineWeight) || topic.baselineWeight < 0 || topic.baselineWeight > 1)
    || Object.values(policy.signalWeights).some((weight) => !Number.isFinite(weight) || weight < 0 || weight > 1)
  ) {
    throw new Error('Approved Corgi Commons policy manifest is invalid');
  }
  const signalSum = Object.values(policy.signalWeights).reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(signalSum - 1) > 1e-9) {
    throw new Error(`Approved Corgi Commons signal weights must sum to 1; received ${signalSum}`);
  }
  return {
    signalWeights: { ...policy.signalWeights },
    topicCatalog: policy.topicCatalog.map((topic) => ({ ...topic })),
    publicationPolicy: {
      ...policy.publicationPolicy,
      decay: [...policy.publicationPolicy.decay],
    },
  };
}

export function parseApprovedSnapshotManifest(input: unknown): ApprovedSnapshotManifest {
  const parsed = ApprovedSnapshotManifestSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Approved Corgi Commons snapshot manifest is invalid: ${detail}`);
  }
  return parsed.data;
}

function snapshotDigest(entries: readonly PublishedFeedEntry[]): string {
  const digestInput = entries.map((entry) => `${entry.publishedRank}:${entry.uri}:${entry.publishedScore}`).join('\n');
  return createHash('sha256').update(digestInput).digest('hex');
}

function baselineOrderDigest(entries: readonly PublishedFeedEntry[]): string {
  const digestInput = entries.map((entry) => `${entry.publishedRank}:${entry.uri}`).join('\n');
  return createHash('sha256').update(digestInput).digest('hex');
}

export function communityGovManifestDigest(input: Record<string, unknown>): string {
  const { snapshotDigest: _ignored, ...payload } = input;
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
