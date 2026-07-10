export const SHADOW_DEMO_CONTRACT_VERSION = '2026-07-10.shadow-demo.v2' as const;

export const SHADOW_DEMO_SIGNAL_KEYS = [
  'recency',
  'engagement',
  'bridging',
  'source_diversity',
  'relevance',
] as const;

export type ShadowDemoSignalKey = (typeof SHADOW_DEMO_SIGNAL_KEYS)[number];

export type ShadowDemoWeights = Record<ShadowDemoSignalKey, number>;

export interface ShadowDemoTopicIntent {
  topicWeights: Record<string, number>;
}

export type ShadowDemoRawScores = Record<ShadowDemoSignalKey, number>;

export const SHADOW_DEMO_COMMUNITY_IDS = [
  'open_science_builders',
  'birders_who_code',
  'crit_fumble_pickup',
  'osint_garden_club',
] as const;

export type ShadowDemoCommunityId = (typeof SHADOW_DEMO_COMMUNITY_IDS)[number];

export const SHADOW_DEMO_VOTER_BLOC_IDS = [
  'research_practitioner',
  'dataset_steward',
  'current_awareness',
  'community_discussant',
  'interdisciplinary_connector',
] as const;

export type ShadowDemoVoterBlocId = (typeof SHADOW_DEMO_VOTER_BLOC_IDS)[number];
export type ShadowDemoSyntheticVoterId = `synthetic-${ShadowDemoVoterBlocId}-${number}`;

export const SHADOW_DEMO_ENDPOINTS = {
  createSession: '/api/demo/sessions',
  readSession: '/api/demo/sessions/:sessionId',
  castVote: '/api/demo/sessions/:sessionId/votes',
  runSyntheticVoters: '/api/demo/sessions/:sessionId/agents/run',
  advanceEpoch: '/api/demo/sessions/:sessionId/epochs/advance',
  readFeed: '/api/demo/sessions/:sessionId/feed?epochId=&limit=',
  readReceipt: '/api/demo/sessions/:sessionId/receipts?epochId=&postUri=',
} as const;

export const SHADOW_DEMO_AGGREGATION_METHOD = 'trimmed_mean_no_trim_under_10' as const;

export const SHADOW_DEMO_MAX_EPOCHS_PER_SESSION = 10;

export const SHADOW_DEMO_GUIDED_EPOCHS = 5;

export const SHADOW_DEMO_SYNTHETIC_VOTER_COUNT = 24;

export const SHADOW_DEMO_TOTAL_DEMO_VOTERS = 25;

export const SHADOW_DEMO_CORPUS_PROVENANCE = {
  mode: 'production_sourced_session_frozen',
  label: 'Live-scored snapshot',
  description:
    'Live-scored snapshot, frozen for this demo run so rank movement is attributable to policy changes.',
} as const;

export const SHADOW_DEMO_ISOLATION_CONTRACT = {
  productionGovernanceMutates: false,
  productionFeedMutates: false,
  productionAuditLogMutates: false,
  researchExportsMutate: false,
  stateBackend: 'redis_only_demo_namespace',
  redisPrefixes: ['demo:session:', 'demo:corpus:', 'demo:corpus:current:', 'demo:idempotency:', 'demo:lock:'],
  liveShadowCommunities: ['open_science_builders'],
} as const;

export interface ShadowDemoWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'degraded';
}

export interface ShadowDemoEnvelope<TPayload> {
  contractVersion: typeof SHADOW_DEMO_CONTRACT_VERSION;
  requestId: string;
  generatedAt: string;
  sessionId: string | null;
  payload: TPayload;
  warnings: ShadowDemoWarning[];
}

export interface ShadowDemoCommunity {
  id: ShadowDemoCommunityId;
  name: string;
  status: 'live_shadow' | 'degraded';
  description: string;
  liveFeedReady: boolean;
}

export interface ShadowDemoCorpusHealth {
  status: 'live' | 'degraded';
  source: 'production_scores_appview' | 'fixture_fallback';
  candidatePosts72h: number;
  publicScoredPosts: number;
  uniqueAuthors72h: number;
  bridgePostShare: number;
  topAuthorConcentration: number;
  sampledAt: string;
}

export interface ShadowDemoVoteSummary {
  aggregateMethod: typeof SHADOW_DEMO_AGGREGATION_METHOD;
  voteCount: number;
  trimCount: number;
  weights: ShadowDemoWeights;
  topicIntent: ShadowDemoTopicIntent;
}

export interface ShadowDemoEpoch {
  id: string;
  sequence: number;
  label: string;
  status: 'open' | 'advanced';
  createdAt: string;
  advancedAt: string | null;
  decidedByEpochId: string | null;
  aggregate: ShadowDemoVoteSummary;
}

interface ShadowDemoVoteBase {
  id: string;
  epochId: string;
  label: string;
  weights: ShadowDemoWeights;
  topicIntent: ShadowDemoTopicIntent;
  createdAt: string;
}

export interface ShadowDemoReviewerVote extends ShadowDemoVoteBase {
  actorType: 'reviewer';
  actorId: 'reviewer';
  blocId?: never;
}

export interface ShadowDemoSyntheticVote extends ShadowDemoVoteBase {
  actorType: 'synthetic_voter';
  actorId: ShadowDemoSyntheticVoterId;
  blocId: ShadowDemoVoterBlocId;
}

export type ShadowDemoVote = ShadowDemoReviewerVote | ShadowDemoSyntheticVote;

export interface ShadowDemoSessionPayload {
  session: {
    sessionId: string;
    community: ShadowDemoCommunity;
    phase: 'created' | 'reviewer_voted' | 'synthetic_voters_ran' | 'epoch_advanced';
    currentEpochId: string;
    expiresAt: string;
    corpusHealth: ShadowDemoCorpusHealth;
    epochs: ShadowDemoEpoch[];
    pendingAggregate: ShadowDemoVoteSummary | null;
    voteCount: number;
    guidedEpochs: typeof SHADOW_DEMO_GUIDED_EPOCHS;
    maxEpochs: typeof SHADOW_DEMO_MAX_EPOCHS_PER_SESSION;
    syntheticVoterCount: typeof SHADOW_DEMO_SYNTHETIC_VOTER_COUNT;
    totalDemoVoters: typeof SHADOW_DEMO_TOTAL_DEMO_VOTERS;
    corpusProvenance: typeof SHADOW_DEMO_CORPUS_PROVENANCE;
    voterProfiles: Array<{
      id: ShadowDemoVoterBlocId;
      label: string;
      voterCount: number;
      baseWeights: ShadowDemoWeights;
      baseTopicWeights: Record<string, number>;
      reviewerBlend: number;
      policyInertia: number;
    }>;
    votes: ShadowDemoVote[];
  };
}

export interface ShadowDemoPublicPost {
  kind: 'public_post';
  uri: string;
  cid: string;
  authorDid: string;
  authorHandle: string;
  authorDisplayName: string;
  authorAvatar: string | null;
  text: string;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  indexedAt: string;
  createdAt: string;
  bskyUrl: string;
}

export interface ShadowDemoHiddenPost {
  kind: 'hidden_post';
  reason: string;
}

export type ShadowDemoDisplayPost = ShadowDemoPublicPost | ShadowDemoHiddenPost;

export interface ShadowDemoRankedPost {
  rank: number;
  previousRank: number | null;
  movement: number | null;
  score: number | null;
  weightedComponents: Record<ShadowDemoSignalKey, number> | null;
  rawScores: ShadowDemoRawScores | null;
  post: ShadowDemoDisplayPost;
}

export interface ShadowDemoFeedPayload {
  epochId: string;
  corpusId: string;
  communityId: ShadowDemoCommunityId;
  corpusHealth: ShadowDemoCorpusHealth;
  aggregate: ShadowDemoVoteSummary;
  posts: ShadowDemoRankedPost[];
}

export interface ShadowDemoReceiptPayload {
  receipt: {
    type: 'shadow_demo_receipt';
    epochId: string;
    postUri: string;
    visibleRank: number;
    previousRank: number | null;
    score: number;
    scoredAt: string;
    aggregate: ShadowDemoVoteSummary;
    components: Array<{
      signal: ShadowDemoSignalKey;
      rawScore: number;
      weight: number;
      contribution: number;
    }>;
    topicSignals: Array<{
      topic: string;
      postScore: number;
    }>;
    counterfactuals: Array<{
      label: 'previous_epoch' | 'engagement_only' | 'without_reviewer_vote';
      rank: number;
      deltaFromVisible: number;
    }>;
  };
}
