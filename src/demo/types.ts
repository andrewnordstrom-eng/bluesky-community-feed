export const SHADOW_DEMO_CONTRACT_VERSION = '2026-07-10.shadow-demo.v3' as const;
export const SHADOW_DEMO_V4_CONTRACT_VERSION = '2026-07-11.shadow-demo.v4' as const;

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

export const SHADOW_DEMO_TOPIC_KEYS = [
  'science-research',
  'data-science',
  'software-development',
  'open-source',
] as const;

export type ShadowDemoTopicKey = (typeof SHADOW_DEMO_TOPIC_KEYS)[number];

export const SHADOW_DEMO_INTERNAL_SIGNAL_KEYS = [
  'recency',
  'engagement',
  'bridging',
  'sourceDiversity',
  'relevance',
] as const;

export type ShadowDemoInternalSignalKey = (typeof SHADOW_DEMO_INTERNAL_SIGNAL_KEYS)[number];

export type ShadowDemoInternalWeights = Record<ShadowDemoInternalSignalKey, number>;

export const SHADOW_DEMO_COMMUNITY_IDS = [
  'community_gov',
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
  'freshness_watcher',
  'conversation_follower',
  'bridge_builder',
  'source_diversifier',
  'relevance_steward',
] as const;

export type ShadowDemoVoterBlocId = (typeof SHADOW_DEMO_VOTER_BLOC_IDS)[number];

export type ShadowDemoSyntheticVoterId = `synthetic-${ShadowDemoVoterBlocId}-${number}`;

export const SHADOW_DEMO_SYNTHETIC_VOTER_COUNT = 24;

export const SHADOW_DEMO_TOTAL_DEMO_VOTERS = 25;

export const SHADOW_DEMO_GUIDED_EPOCHS = 5;

export const SHADOW_DEMO_CORPUS_PROVENANCE = {
  mode: 'production_sourced_session_frozen',
  label: 'Live-scored snapshot',
  description:
    'Live-scored snapshot, frozen for this demo run so rank movement is attributable to policy changes.',
  windowHours: 72,
  topicScoreThreshold: 0.5,
} as const;

export const SHADOW_DEMO_MAX_EXCLUDE_KEYWORDS = 10;

export const SHADOW_DEMO_MAX_EXCLUDE_KEYWORD_LENGTH = 50;

/** Mirrors production KEYWORD_THRESHOLD in src/governance/aggregation.ts. */
export const SHADOW_DEMO_CONTENT_RULE_SUPPORT_THRESHOLD = 0.3;

export interface ShadowDemoContentRuleSupport {
  keyword: string;
  supportCount: number;
  adopted: boolean;
}

export interface ShadowDemoContentRulesSummary {
  enabled: true;
  /** Votes needed to adopt a keyword: ceil(threshold share x electorate), min 1. */
  threshold: number;
  /** Every demo ballot is complete, so the denominator is the full electorate. */
  electorate: number;
  adoptedExcludeKeywords: string[];
  support: ShadowDemoContentRuleSupport[];
}

export interface ShadowDemoSuggestedExcludeKeyword {
  keyword: string;
  matchCount: number;
}

export interface ShadowDemoWithheldPost {
  keyword: string;
  supportCount: number;
  previousRank: number | null;
  post: ShadowDemoDisplayPost;
}

export const SHADOW_DEMO_PHASES = [
  'created',
  'reviewer_voted',
  'synthetic_voters_ran',
  'epoch_advanced',
] as const;

export type ShadowDemoPhase = (typeof SHADOW_DEMO_PHASES)[number];

export interface ShadowDemoWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'degraded';
}

export interface ShadowDemoEnvelope<TPayload> {
  contractVersion: typeof SHADOW_DEMO_CONTRACT_VERSION | typeof SHADOW_DEMO_V4_CONTRACT_VERSION;
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
  source: 'production_scores_appview' | 'production_feed_snapshot' | 'fixture_fallback';
  candidatePosts72h: number;
  publicScoredPosts: number;
  uniqueAuthors72h: number;
  bridgePostShare: number;
  topAuthorConcentration: number;
  sampledAt: string;
  sourcePostCount?: number;
  eligiblePostCount?: number;
  englishTaggedShare?: number;
  richMediaShare?: number;
}

export interface ShadowDemoTopicCatalogEntry {
  slug: string;
  name: string;
  description: string | null;
  baselineWeight: number;
}

interface ShadowDemoCorpusProvenanceBase {
  description: string;
  corpusId: string;
  productionEpochId: number;
  sampledAt: string;
  windowHours: number;
  topicScoreThreshold: number;
  eligiblePostCount: number;
}

export type ShadowDemoCorpusProvenance =
  | ShadowDemoCorpusProvenanceBase & {
      mode: 'production_feed_snapshot_session_frozen';
      label: 'Reviewer-safe snapshot of the live Community Governed Feed';
      sourceFeedUri: string;
      sourceFeedName: string;
      sourceSnapshotDigest: string;
      sourceRunId: string;
      sourceUpdatedAt: string;
      sourceReviewedAt?: string;
      sourcePostCount: number;
      selectionPolicyVersion: string;
      baselineOrderDigest: string;
    }
  | ShadowDemoCorpusProvenanceBase & {
      mode: typeof SHADOW_DEMO_CORPUS_PROVENANCE.mode;
      label: typeof SHADOW_DEMO_CORPUS_PROVENANCE.label;
    }
  | ShadowDemoCorpusProvenanceBase & {
      mode: 'illustrative_fixture_session_frozen';
      label: 'Illustrative mechanics fixture';
    };

export interface ShadowDemoCorpusInclusionReason {
  matchedTopics: Array<{
    topic: ShadowDemoTopicKey;
    score: number;
  }>;
  matchedTerms: string[];
  sourceRank?: number;
  reason?: 'published_feed_snapshot';
}

export interface ShadowDemoImageMedia {
  thumb: string;
  fullsize: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface ShadowDemoExternalMedia {
  uri: string;
  title: string;
  description: string;
  thumb: string | null;
}

export interface ShadowDemoQuoteMedia {
  uri: string;
  authorHandle: string;
  authorDisplayName: string;
  text: string;
}

export interface ShadowDemoVideoMedia {
  thumbnail: string | null;
  width: number | null;
  height: number | null;
}

export interface ShadowDemoPostMedia {
  images: ShadowDemoImageMedia[];
  external: ShadowDemoExternalMedia | null;
  quote: ShadowDemoQuoteMedia | null;
  video: ShadowDemoVideoMedia | null;
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
  languages?: string[];
  media?: ShadowDemoPostMedia | null;
}

export interface ShadowDemoHiddenPost {
  kind: 'hidden_post';
  reason: string;
}

export type ShadowDemoDisplayPost = ShadowDemoPublicPost | ShadowDemoHiddenPost;

export interface ShadowDemoRawScores {
  recency: number;
  engagement: number;
  bridging: number;
  source_diversity: number;
  relevance: number;
}

export interface ShadowDemoCorpusItem {
  postUri: string;
  reviewedCid?: string | null;
  authorDid: string | null;
  createdAt: string;
  topicVector: Record<string, number>;
  rawScores: ShadowDemoRawScores;
  productionScore: number;
  productionEpochId: number;
  scoredAt: string;
  componentDetails: Record<string, unknown> | null;
  inclusionReasons: ShadowDemoCorpusInclusionReason;
  displayPost: ShadowDemoDisplayPost;
  publishedRank?: number;
  publishedScore?: number;
  publicationAdjustment?: number;
  embedUrl?: string | null;
  textLength?: number;
}

export interface ShadowDemoPublicationPolicy {
  urlDedupEnabled: boolean;
  minimumOriginalTextLength: number;
  minimumRelevance: number;
  decay: number[];
}

export interface ShadowDemoCorpus {
  corpusId: string;
  communityId: ShadowDemoCommunityId;
  baseProductionEpochId: number;
  baseWeights: ShadowDemoWeights;
  baseTopicIntent: ShadowDemoTopicIntent;
  createdAt: string;
  expiresAt: string;
  items: ShadowDemoCorpusItem[];
  health: ShadowDemoCorpusHealth;
  warnings: ShadowDemoWarning[];
  topicCatalog?: ShadowDemoTopicCatalogEntry[];
  sourceFeedUri?: string;
  sourceSnapshot?: {
    feedName: string;
    digest: string;
    runId: string;
    updatedAt: string;
    capturedAt: string;
    reviewedAt: string | null;
    sourcePostCount: number;
    selectionPolicyVersion: string;
    baselineOrderDigest: string;
    publicationPolicy: ShadowDemoPublicationPolicy;
  };
}

interface ShadowDemoVoteBase {
  id: string;
  epochId: string;
  label: string;
  weights: ShadowDemoWeights;
  topicIntent: ShadowDemoTopicIntent;
  /** Present only when DEMO_CONTENT_RULES_ENABLED; normalized exclude keywords. */
  excludeKeywords?: string[];
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

export interface ShadowDemoVoteSummary {
  aggregateMethod: 'trimmed_mean_no_trim_under_10';
  voteCount: number;
  trimCount: number;
  weights: ShadowDemoWeights;
  topicIntent: ShadowDemoTopicIntent;
  /** Present only when DEMO_CONTENT_RULES_ENABLED. Threshold rule, not trimmed mean. */
  contentRules?: ShadowDemoContentRulesSummary;
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

export interface ShadowDemoSessionState {
  sessionId: string;
  communityId: ShadowDemoCommunityId;
  seed: string;
  phase: ShadowDemoPhase;
  createdAt: string;
  expiresAt: string;
  corpusId: string;
  currentEpochId: string;
  epochs: ShadowDemoEpoch[];
  votes: ShadowDemoVote[];
  corpus: ShadowDemoCorpus;
  warnings: ShadowDemoWarning[];
}

export interface ShadowDemoSessionPayload {
  session: {
    sessionId: string;
    community: ShadowDemoCommunity;
    phase: ShadowDemoPhase;
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
    corpusProvenance: ShadowDemoCorpusProvenance;
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
    topicCatalog?: ShadowDemoTopicCatalogEntry[];
    sourceFeedUri?: string;
    /** Present only when DEMO_CONTENT_RULES_ENABLED. */
    contentRulesEnabled?: boolean;
    suggestedExcludeKeywords?: ShadowDemoSuggestedExcludeKeyword[];
  };
}

export interface ShadowDemoRankedPost {
  rank: number;
  previousRank: number | null;
  movement: number | null;
  score: number | null;
  weightedComponents: Record<ShadowDemoSignalKey, number> | null;
  rawScores: ShadowDemoRawScores | null;
  post: ShadowDemoDisplayPost;
  publishedRank?: number;
  publishedScore?: number;
  componentScore?: number | null;
  publicationAdjustment?: number | null;
}

export interface ShadowDemoFeedPayload {
  epochId: string;
  corpusId: string;
  communityId: ShadowDemoCommunityId;
  corpusHealth: ShadowDemoCorpusHealth;
  corpusProvenance: ShadowDemoCorpusProvenance;
  aggregate: ShadowDemoVoteSummary;
  posts: ShadowDemoRankedPost[];
  /** Present only when content rules are enabled for the epoch; may be an empty array. */
  withheldPosts?: ShadowDemoWithheldPost[];
}

export interface ShadowDemoReceiptContribution {
  signal: ShadowDemoSignalKey;
  rawScore: number;
  weight: number;
  contribution: number;
}

export interface ShadowDemoCounterfactual {
  label: 'previous_epoch' | 'engagement_only' | 'direct_reviewer_ballot_removed';
  description: string;
  rank: number | null;
  deltaFromVisible: number | null;
}

export interface ShadowDemoTopicRelevanceTerm {
  topic: string;
  postScore: number;
  communityWeight: number;
  weightedTerm: number;
  usedDefaultWeight: boolean;
}

export interface ShadowDemoTopicRelevanceFormula {
  formulaApplied: boolean;
  defaultTopicWeight: number;
  confidenceThreshold: number;
  weightedSum: number | null;
  signalSum: number | null;
  baseRelevance: number;
  confidenceMultiplier: number;
  effectiveRelevance: number;
  usedDefaultWeight: boolean;
  terms: ShadowDemoTopicRelevanceTerm[];
}

export interface ShadowDemoReceiptPayload {
  receipt: {
    type: 'shadow_demo_receipt';
    epochId: string;
    postUri: string;
    visibleRank: number;
    previousRank: number | null;
    score: number;
    componentScore?: number;
    publicationAdjustment?: number;
    publishedRank?: number;
    publishedScore?: number;
    scoredAt: string;
    aggregate: ShadowDemoVoteSummary;
    reviewerBallotShare: number;
    components: ShadowDemoReceiptContribution[];
    topicRelevanceFormula: ShadowDemoTopicRelevanceFormula;
    provenance: ShadowDemoCorpusProvenance & {
      shadowEpochId: string;
      postInclusionReasons: ShadowDemoCorpusInclusionReason;
    };
    counterfactuals: ShadowDemoCounterfactual[];
    /** Present only when DEMO_CONTENT_RULES_ENABLED. */
    contentRules?: {
      adoptedExcludeKeywords: string[];
      threshold: number;
      electorate: number;
      /** Always null on a rank receipt; withheld posts have no rank receipt. */
      matchedKeyword: null;
    };
  };
}

export const SHADOW_DEMO_SESSION_TTL_SECONDS = 90 * 60;

export const SHADOW_DEMO_MAX_EPOCHS_PER_SESSION = 10;

export const SHADOW_DEMO_SHARED_CORPUS_TTL_SECONDS = 60 * 60;
