import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { db as defaultDb } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { readPostScore, type PostScoreRecord, type ReadPostScoreOptions } from '../scoring/score-reader.js';
import { hydrateCorpusItemsWithAppView, type DemoFetchFunction } from './appview.js';
import { hiddenDisplayPost } from './public-view.js';
import {
  SHADOW_DEMO_SESSION_TTL_SECONDS,
  type ShadowDemoCommunity,
  type ShadowDemoCommunityId,
  type ShadowDemoCorpus,
  type ShadowDemoCorpusHealth,
  type ShadowDemoCorpusItem,
  type ShadowDemoRawScores,
  type ShadowDemoWarning,
  type ShadowDemoTopicIntent,
  type ShadowDemoWeights,
} from './types.js';
import { equalShadowWeights, internalRawScoresToShadow, internalWeightsToShadow } from './weights.js';
import { emptyShadowTopicIntent } from './topic-intent.js';

export const DEMO_COMMUNITIES: Record<ShadowDemoCommunityId, ShadowDemoCommunity> = {
  open_science_builders: {
    id: 'open_science_builders',
    name: 'Open Science Builders',
    status: 'live_shadow',
    description:
      'Research, reusable datasets, open-source methods, and software that moves knowledge across disciplines.',
    liveFeedReady: true,
  },
  birders_who_code: {
    id: 'birders_who_code',
    name: 'Birders Who Code',
    status: 'degraded',
    description:
      'Warbler sightings, messy CSVs, camera traps, bug reports, and deploy jokes ranked by community policy.',
    liveFeedReady: false,
  },
  crit_fumble_pickup: {
    id: 'crit_fumble_pickup',
    name: 'Crit Fumble Pickup',
    status: 'degraded',
    description:
      'A tabletop community concept for rules debates, painted minis, session logs, and dramatic dice stories.',
    liveFeedReady: false,
  },
  osint_garden_club: {
    id: 'osint_garden_club',
    name: 'OSINT Garden Club',
    status: 'degraded',
    description:
      'A community concept for satellite sleuthing, botany threads, public records, and surprisingly intense plant IDs.',
    liveFeedReady: false,
  },
};

const CANDIDATE_LIMIT = 80;
const SCORE_READ_BATCH_SIZE = 10;
const APPVIEW_TIMEOUT_MS = 8000;
const MIN_PUBLIC_SCORED_POSTS = 5;
const OPEN_SCIENCE_TOPIC_SLUGS = [
  'science-research',
  'data-science',
  'software-development',
  'open-source',
] as const;

interface ActiveEpochRow {
  id: number;
  recency_weight: number;
  engagement_weight: number;
  bridging_weight: number;
  source_diversity_weight: number;
  relevance_weight: number;
  topic_weights: Record<string, number> | null;
}

interface CandidatePostRow {
  uri: string;
  author_did: string;
  created_at: Date | string;
  topic_vector: Record<string, number> | null;
  candidate_count_72h: string | number;
  unique_authors_72h: string | number;
}

export interface LoadShadowDemoCorpusOptions {
  communityId: ShadowDemoCommunityId;
  now: Date;
  fetchFn: DemoFetchFunction;
  dbPool: Pick<Pool, 'query'>;
  readScore: (options: ReadPostScoreOptions) => Promise<PostScoreRecord | null>;
}

export async function loadShadowDemoCorpus(options: LoadShadowDemoCorpusOptions): Promise<ShadowDemoCorpus> {
  if (options.communityId !== 'open_science_builders') {
    return fallbackCorpus({
      communityId: options.communityId,
      now: options.now,
      reason: `Community ${options.communityId} is not wired to a live shadow corpus in v1`,
    });
  }

  try {
    const epoch = await readLatestActiveEpoch(options.dbPool);
    if (!epoch) {
      return fallbackCorpus({
        communityId: options.communityId,
        now: options.now,
        reason: 'No active production epoch was available for the shadow demo corpus',
      });
    }

    const candidates = await readOpenScienceCandidates({
      dbPool: options.dbPool,
      epochId: epoch.id,
    });
    const scoredItems = await buildScoredCorpusItems({
      rows: candidates,
      epochId: epoch.id,
      readScore: options.readScore,
    });
    const hydratedItems = await hydrateCorpusItemsWithAppView({
      items: scoredItems,
      fetchFn: options.fetchFn,
      timeoutMs: APPVIEW_TIMEOUT_MS,
    });
    const publicCount = hydratedItems.filter((item) => item.displayPost.kind === 'public_post').length;
    const health = buildHealth({
      now: options.now,
      rows: candidates,
      items: hydratedItems,
      source: publicCount >= MIN_PUBLIC_SCORED_POSTS ? 'production_scores_appview' : 'fixture_fallback',
    });

    if (publicCount < MIN_PUBLIC_SCORED_POSTS) {
      return fallbackCorpus({
        communityId: options.communityId,
        now: options.now,
        reason: `Only ${publicCount} public scored Open Science Builders candidates passed the scout threshold`,
        activeEpochId: epoch.id,
        baseWeights: epochWeights(epoch),
        baseTopicIntent: epochTopicIntent(epoch),
        health,
      });
    }

    return {
      corpusId: `corpus-${randomUUID()}`,
      communityId: options.communityId,
      baseProductionEpochId: epoch.id,
      baseWeights: epochWeights(epoch),
      baseTopicIntent: epochTopicIntent(epoch),
      createdAt: options.now.toISOString(),
      expiresAt: expiresAt(options.now).toISOString(),
      items: hydratedItems,
      health,
      warnings: [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err, communityId: options.communityId }, 'Shadow demo live corpus load failed');
    return fallbackCorpus({
      communityId: options.communityId,
      now: options.now,
      reason: `Live Open Science Builders corpus could not be loaded: ${message}`,
    });
  }
}

export function createDefaultCorpusLoader(): (options: {
  communityId: ShadowDemoCommunityId;
  now: Date;
}) => Promise<ShadowDemoCorpus> {
  return async (options) => loadShadowDemoCorpus({
    communityId: options.communityId,
    now: options.now,
    fetchFn: defaultFetch,
    dbPool: defaultDb,
    readScore: readPostScore,
  });
}

async function readLatestActiveEpoch(dbPool: Pick<Pool, 'query'>): Promise<ActiveEpochRow | null> {
  const result = await dbPool.query<ActiveEpochRow>(
    `SELECT id, recency_weight, engagement_weight, bridging_weight, source_diversity_weight, relevance_weight,
            topic_weights
     FROM governance_epochs
     WHERE status = 'active'
     ORDER BY id DESC
     LIMIT 1`
  );
  return result.rows[0] ?? null;
}

async function readOpenScienceCandidates(options: {
  dbPool: Pick<Pool, 'query'>;
  epochId: number;
}): Promise<CandidatePostRow[]> {
  const result = await options.dbPool.query<CandidatePostRow>(
    `WITH scored_candidates AS (
       SELECT DISTINCT ON (p.uri)
              p.uri, p.author_did, p.created_at, p.topic_vector, ps.total_score
       FROM posts p
       JOIN post_scores ps ON ps.post_uri = p.uri
       WHERE ps.epoch_id = $1
         AND p.deleted = FALSE
         AND p.created_at >= NOW() - INTERVAL '72 hours'
         AND COALESCE(p.topic_vector, '{}'::jsonb) ?| $2::text[]
       ORDER BY p.uri, ps.total_score DESC, p.created_at DESC
     ),
     candidates AS (
       SELECT uri, author_did, created_at, topic_vector
       FROM scored_candidates
       ORDER BY total_score DESC, created_at DESC
       LIMIT ${CANDIDATE_LIMIT}
     ),
     metrics AS (
       SELECT COUNT(*) AS candidate_count_72h,
              COUNT(DISTINCT author_did) AS unique_authors_72h
       FROM scored_candidates
     )
     SELECT c.uri, c.author_did, c.created_at, c.topic_vector,
            m.candidate_count_72h, m.unique_authors_72h
     FROM candidates c
     CROSS JOIN metrics m`,
    [options.epochId, [...OPEN_SCIENCE_TOPIC_SLUGS]]
  );
  return result.rows;
}

async function buildScoredCorpusItems(options: {
  rows: CandidatePostRow[];
  epochId: number;
  readScore: (options: ReadPostScoreOptions) => Promise<PostScoreRecord | null>;
}): Promise<ShadowDemoCorpusItem[]> {
  const items: ShadowDemoCorpusItem[] = [];
  for (let start = 0; start < options.rows.length; start += SCORE_READ_BATCH_SIZE) {
    const batch = options.rows.slice(start, start + SCORE_READ_BATCH_SIZE);
    const scoredBatch = await Promise.all(batch.map(async (row) => {
      const score = await options.readScore({
        postUri: row.uri,
        epochId: options.epochId,
      });
      if (!score) {
        return null;
      }
      const rawScores = internalRawScoresToShadow(score.components);
      if (!hasAllFiniteRawScores(rawScores)) {
        return null;
      }
      return {
        postUri: row.uri,
        authorDid: row.author_did,
        createdAt: dateToIso(row.created_at),
        topicVector: row.topic_vector ?? {},
        rawScores,
        productionScore: score.totalScore,
        productionEpochId: score.epochId,
        scoredAt: score.scoredAt.toISOString(),
        componentDetails: score.componentDetails,
        displayPost: hiddenDisplayPost('Post has not been hydrated from Bluesky public AppView yet'),
      } satisfies ShadowDemoCorpusItem;
    }));
    items.push(...scoredBatch.filter((item): item is NonNullable<typeof item> => item !== null));
  }
  return items;
}

function buildHealth(options: {
  now: Date;
  rows: CandidatePostRow[];
  items: ShadowDemoCorpusItem[];
  source: ShadowDemoCorpusHealth['source'];
}): ShadowDemoCorpusHealth {
  const first = options.rows[0];
  const candidateCount = first ? Number(first.candidate_count_72h) : options.rows.length;
  const uniqueAuthors = first ? Number(first.unique_authors_72h) : uniqueAuthorCount(options.items);
  return {
    status: options.source === 'production_scores_appview' ? 'live' : 'degraded',
    source: options.source,
    candidatePosts72h: finiteNumber(candidateCount),
    publicScoredPosts: options.items.filter((item) => item.displayPost.kind === 'public_post').length,
    uniqueAuthors72h: finiteNumber(uniqueAuthors),
    bridgePostShare: bridgePostShare(options.items),
    topAuthorConcentration: topAuthorConcentration(options.items),
    sampledAt: options.now.toISOString(),
  };
}

function fallbackCorpus(options: {
  communityId: ShadowDemoCommunityId;
  now: Date;
  reason: string;
  activeEpochId?: number;
  baseWeights?: ShadowDemoWeights;
  baseTopicIntent?: ShadowDemoTopicIntent;
  health?: ShadowDemoCorpusHealth;
}): ShadowDemoCorpus {
  const warning: ShadowDemoWarning = {
    code: 'shadow_demo_corpus_degraded',
    message: options.reason,
    severity: 'degraded',
  };
  const items = fixtureCorpusItems(options.now, options.activeEpochId ?? 0);
  return {
    corpusId: `corpus-${randomUUID()}`,
    communityId: options.communityId,
    baseProductionEpochId: options.activeEpochId ?? 0,
    baseWeights: options.baseWeights ?? equalShadowWeights(),
    baseTopicIntent: options.baseTopicIntent ?? emptyShadowTopicIntent(),
    createdAt: options.now.toISOString(),
    expiresAt: expiresAt(options.now).toISOString(),
    items,
    health:
      options.health ?? {
        status: 'degraded',
        source: 'fixture_fallback',
        candidatePosts72h: 0,
        publicScoredPosts: items.length,
        uniqueAuthors72h: uniqueAuthorCount(items),
        bridgePostShare: bridgePostShare(items),
        topAuthorConcentration: topAuthorConcentration(items),
        sampledAt: options.now.toISOString(),
      },
    warnings: [warning],
  };
}

function fixtureCorpusItems(now: Date, epochId: number): ShadowDemoCorpusItem[] {
  const scoredAt = now.toISOString();
  return [
    fixtureItem({
      index: 1,
      epochId,
      scoredAt,
      authorHandle: 'maya-keene.bsky.social',
      authorDisplayName: 'Maya Keene',
      text: 'Published a notebook that reproduces our urban heat analysis from raw sensor data.',
      rawScores: { recency: 0.74, engagement: 0.32, bridging: 0.81, source_diversity: 0.66, relevance: 0.91 },
      topicVector: { 'science-research': 0.92, 'software-development': 0.76 },
    }),
    fixtureItem({
      index: 2,
      epochId,
      scoredAt,
      authorHandle: 'benadler.bsky.social',
      authorDisplayName: 'Ben Adler',
      text: 'New preprint maps how wildfire smoke changes neighborhood-scale air quality.',
      rawScores: { recency: 0.95, engagement: 0.5, bridging: 0.28, source_diversity: 0.42, relevance: 0.87 },
      topicVector: { 'science-research': 0.95 },
    }),
    fixtureItem({
      index: 3,
      epochId,
      scoredAt,
      authorHandle: 'eli-overthinking.bsky.social',
      authorDisplayName: 'Eli Moreno',
      text: 'Researchers will do anything except document the environment that produced the result.',
      rawScores: { recency: 0.67, engagement: 0.96, bridging: 0.35, source_diversity: 0.26, relevance: 0.43 },
      topicVector: { 'software-development': 0.78 },
    }),
    fixtureItem({
      index: 4,
      epochId,
      scoredAt,
      authorHandle: 'arjunmehta.dev',
      authorDisplayName: 'Arjun Mehta',
      text: 'Open-source image classifier benchmark and training dataset just dropped.',
      rawScores: { recency: 0.82, engagement: 0.58, bridging: 0.88, source_diversity: 0.74, relevance: 0.93 },
      topicVector: { 'science-research': 0.86, 'ai-machine-learning': 0.8, 'open-source': 0.72 },
    }),
    fixtureItem({
      index: 5,
      epochId,
      scoredAt,
      authorHandle: 'toastwindow.bsky.social',
      authorDisplayName: 'Claire Rowan',
      text: 'Field notes from a rainy biodiversity survey, plus the messy CSV and cleaning script.',
      rawScores: { recency: 0.7, engagement: 0.44, bridging: 0.77, source_diversity: 0.82, relevance: 0.89 },
      topicVector: { 'science-research': 0.88, 'data-science': 0.71 },
    }),
    fixtureItem({
      index: 6,
      epochId,
      scoredAt,
      authorHandle: 'thocknotes.bsky.social',
      authorDisplayName: 'Theo Kim',
      text: 'Half my lab notebook is error messages, but the replication package finally runs end to end.',
      rawScores: { recency: 0.6, engagement: 0.84, bridging: 0.65, source_diversity: 0.48, relevance: 0.64 },
      topicVector: { 'science-research': 0.7, 'software-development': 0.66 },
    }),
  ];
}

function fixtureItem(options: {
  index: number;
  epochId: number;
  scoredAt: string;
  authorHandle: string;
  authorDisplayName: string;
  text: string;
  rawScores: ShadowDemoRawScores;
  topicVector: Record<string, number>;
}): ShadowDemoCorpusItem {
  const uri = `at://did:plc:shadowdemo${options.index}/app.bsky.feed.post/bird${options.index}`;
  return {
    postUri: uri,
    authorDid: `did:plc:shadowdemo${options.index}`,
    createdAt: options.scoredAt,
    topicVector: options.topicVector,
    rawScores: options.rawScores,
    productionScore: 0,
    productionEpochId: options.epochId,
    scoredAt: options.scoredAt,
    componentDetails: null,
    displayPost: {
      kind: 'public_post',
      uri,
      cid: `bafyshadowdemo${options.index}`,
      authorDid: `did:plc:shadowdemo${options.index}`,
      authorHandle: options.authorHandle,
      authorDisplayName: options.authorDisplayName,
      authorAvatar: null,
      text: options.text,
      likeCount: 12 * options.index,
      repostCount: 4 * options.index,
      replyCount: 3 * options.index,
      quoteCount: options.index,
      indexedAt: options.scoredAt,
      createdAt: options.scoredAt,
      bskyUrl: `https://bsky.app/profile/${options.authorHandle}/post/bird${options.index}`,
    },
  };
}

function epochWeights(row: ActiveEpochRow): ShadowDemoWeights {
  return internalWeightsToShadow({
    recency: Number(row.recency_weight),
    engagement: Number(row.engagement_weight),
    bridging: Number(row.bridging_weight),
    sourceDiversity: Number(row.source_diversity_weight),
    relevance: Number(row.relevance_weight),
  });
}

function epochTopicIntent(row: ActiveEpochRow): ShadowDemoTopicIntent {
  return { topicWeights: { ...(row.topic_weights ?? {}) } };
}

function hasAllFiniteRawScores(rawScores: ShadowDemoRawScores): boolean {
  return Object.values(rawScores).every((value) => Number.isFinite(value));
}

function expiresAt(now: Date): Date {
  return new Date(now.getTime() + SHADOW_DEMO_SESSION_TTL_SECONDS * 1000);
}

function bridgePostShare(items: ShadowDemoCorpusItem[]): number {
  if (items.length === 0) {
    return 0;
  }
  const bridgeCount = items.filter((item) => item.rawScores.bridging >= 0.5).length;
  return Number((bridgeCount / items.length).toFixed(3));
}

function topAuthorConcentration(items: ShadowDemoCorpusItem[]): number {
  if (items.length === 0) {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item.authorDid ?? 'unknown';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const max = Math.max(...counts.values());
  return Number((max / items.length).toFixed(3));
}

function uniqueAuthorCount(items: ShadowDemoCorpusItem[]): number {
  return new Set(items.map((item) => item.authorDid ?? item.postUri)).size;
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function dateToIso(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid corpus date value: ${value}`);
  }
  return parsed.toISOString();
}

async function defaultFetch(input: string, init: { method: 'GET'; signal: AbortSignal }): Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}> {
  return globalThis.fetch(input, init);
}
