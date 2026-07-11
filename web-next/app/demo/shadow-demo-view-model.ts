import {
  SHADOW_DEMO_COMMUNITY_IDS,
  SHADOW_DEMO_CONTRACT_VERSION,
  SHADOW_DEMO_GUIDED_EPOCHS,
  SHADOW_DEMO_MAX_EPOCHS_PER_SESSION,
  SHADOW_DEMO_SIGNAL_KEYS,
  SHADOW_DEMO_VOTER_BLOC_IDS,
  type ShadowDemoCommunityId,
  type ShadowDemoSignalKey,
  type ShadowDemoTopicIntent,
  type ShadowDemoWeights,
  type ShadowDemoVoterBlocId,
} from "./shadow-demo-contract"

export {
  SHADOW_DEMO_COMMUNITY_IDS,
  SHADOW_DEMO_CONTRACT_VERSION,
  SHADOW_DEMO_GUIDED_EPOCHS,
  SHADOW_DEMO_MAX_EPOCHS_PER_SESSION,
  SHADOW_DEMO_SIGNAL_KEYS,
  SHADOW_DEMO_VOTER_BLOC_IDS,
}
export type {
  ShadowDemoCommunityId,
  ShadowDemoSignalKey,
  ShadowDemoTopicIntent,
  ShadowDemoWeights,
  ShadowDemoVoterBlocId,
}

export const SHADOW_DEMO_PHASES = [
  "created",
  "corpus_ready",
  "reviewer_vote_cast",
  "agent_votes_cast",
  "epoch_transitioned",
  "reranked",
  "degraded",
] as const

export const SHADOW_DEMO_ACTIONS = [
  "create_session",
  "cast_reviewer_vote",
  "run_agent_votes",
  "advance_epoch",
  "select_post",
] as const

export const SHADOW_DEMO_AGENT_IDS = SHADOW_DEMO_VOTER_BLOC_IDS

export type ShadowDemoPhase = (typeof SHADOW_DEMO_PHASES)[number]
export type ShadowDemoAction = (typeof SHADOW_DEMO_ACTIONS)[number]
export type ShadowDemoAgentId = (typeof SHADOW_DEMO_AGENT_IDS)[number]

export interface ShadowDemoEnvelope<TPayload> {
  readonly contractVersion: "2026-07-10.shadow-demo.v3"
  readonly requestId: string
  readonly generatedAt: string
  readonly sessionId: string | null
  readonly payload: TPayload
  readonly warnings: readonly ShadowDemoWarning[]
}

export interface ShadowDemoWarning {
  readonly code: string
  readonly message: string
  readonly recoverable: boolean
}

export interface CreateShadowDemoSessionRequest {
  readonly communityId: ShadowDemoCommunityId
  readonly scenarioId: string
  readonly clientNonce: string
  readonly mode: "guided" | "free_play"
}

export interface ShadowDemoSessionResponse {
  readonly session: ShadowDemoSession
  readonly community: ShadowDemoCommunity
  readonly currentEpoch: ShadowDemoEpoch
  readonly previousEpoch: ShadowDemoEpoch | null
  readonly feed: ShadowDemoFeed
  readonly nextRecommendedAction: ShadowDemoAction
}

export interface ShadowDemoSession {
  readonly id: string
  readonly phase: ShadowDemoPhase
  readonly communityId: ShadowDemoCommunityId
  readonly scenarioId: string
  readonly mode: "guided" | "free_play"
  readonly seed: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly sequence: number
  readonly guidedEpochs: typeof SHADOW_DEMO_GUIDED_EPOCHS
  readonly maxEpochs: typeof SHADOW_DEMO_MAX_EPOCHS_PER_SESSION
  readonly isolation: ShadowDemoIsolation
  readonly capabilities: ShadowDemoCapabilities
  readonly corpusProvenance: ShadowDemoCorpusProvenance
}

export interface ShadowDemoIsolation {
  readonly writesProductionGovernance: false
  readonly writesGovernanceVotes: false
  readonly writesGovernanceEpochs: false
  readonly writesResearchExports: false
  readonly writesProductionFeedCache: false
  readonly storageNamespace: "demo"
}

export interface ShadowDemoCapabilities {
  readonly canCastReviewerVote: boolean
  readonly canRunAgents: boolean
  readonly canAdvanceEpoch: boolean
  readonly canOpenNativeBlueskyFeed: boolean
  readonly canMutateNativeBlueskyFeed: false
}

export interface ShadowDemoCommunity {
  readonly id: ShadowDemoCommunityId
  readonly name: string
  readonly tagline: string
  readonly corpusStrategy: "live_appview_search" | "fixture_fallback"
  readonly candidateTerms: readonly string[]
  readonly bridgeTerms: readonly string[]
  readonly publicBlueskyFeedUrl: string | null
}

export interface CastShadowDemoVoteRequest {
  readonly idempotencyKey: string
  readonly baseEpochId: string
  readonly voterLabel: string
  readonly weights: ShadowDemoWeights
  readonly topicIntent: ShadowDemoTopicIntent
}

export interface CastShadowDemoVoteResponse {
  readonly session: ShadowDemoSession
  readonly reviewerVote: ShadowDemoViewVote
  readonly currentEpoch: ShadowDemoEpoch
  readonly nextRecommendedAction: "run_agent_votes"
}

export interface RunShadowDemoAgentsRequest {
  readonly idempotencyKey: string
  readonly baseEpochId: string
}

export interface RunShadowDemoAgentsResponse {
  readonly session: ShadowDemoSession
  readonly agents: readonly ShadowDemoAgent[]
  readonly agentVotes: readonly ShadowDemoViewVote[]
  readonly currentEpoch: ShadowDemoEpoch
  readonly pendingAggregate: ShadowDemoAggregate
  readonly nextRecommendedAction: "advance_epoch"
}

export interface AdvanceShadowDemoEpochRequest {
  readonly idempotencyKey: string
  readonly fromEpochId: string
}

export interface AdvanceShadowDemoEpochResponse {
  readonly session: ShadowDemoSession
  readonly previousEpoch: ShadowDemoEpoch
  readonly currentEpoch: ShadowDemoEpoch
  readonly feedBefore: ShadowDemoFeed
  readonly feedAfter: ShadowDemoFeed
  readonly nextRecommendedAction: "select_post"
}

export interface ShadowDemoAgent {
  readonly id: ShadowDemoAgentId
  readonly name: string
  readonly role: string
  readonly deterministicSeed: string
  readonly voteRationale: string
  readonly voterCount: number
  readonly baseWeights: ShadowDemoWeights
  readonly reviewerBlend: number
  readonly policyInertia: number
}

export interface ShadowDemoViewVote {
  readonly id: string
  readonly epochId: string
  readonly voterKind: "reviewer" | "agent"
  readonly voterId: string
  readonly voterLabel: string
  readonly weights: ShadowDemoWeights
  readonly topicIntent: ShadowDemoTopicIntent
  readonly rationale: string
  readonly castAt: string
}

export type ShadowDemoVote = ShadowDemoViewVote

export interface ShadowDemoEpoch {
  readonly id: string
  readonly sequence: number
  readonly status: "open" | "agent_voting" | "closing" | "closed" | "published"
  readonly label: string
  readonly weights: ShadowDemoWeights
  readonly topicIntent: ShadowDemoTopicIntent
  readonly voteSummary: ShadowDemoVoteSummary
  readonly startedAt: string
  readonly closedAt: string | null
}

export interface ShadowDemoVoteSummary {
  readonly reviewerVotes: number
  readonly agentVotes: number
  readonly totalVotes: number
  readonly aggregateMethod: "trimmed_mean_no_trim_under_10"
  readonly trimCount: number
  readonly reviewerBallotShare: number
}

export interface ShadowDemoAggregate {
  readonly weights: ShadowDemoWeights
  readonly topicIntent: ShadowDemoTopicIntent
  readonly voteSummary: ShadowDemoVoteSummary
}

export interface ShadowDemoFeedRequest {
  readonly epochId: string
  readonly limit: number
}

export interface ShadowDemoFeed {
  readonly epochId: string
  readonly corpusId: string
  readonly rankingSource: "live_public_posts_shadow_weights" | "fixture_posts_shadow_weights"
  readonly generatedAt: string
  readonly items: readonly ShadowDemoFeedItem[]
  readonly corpusHealth: ShadowDemoCorpusHealth
  readonly corpusProvenance: ShadowDemoCorpusProvenance
  readonly aggregate: ShadowDemoAggregate
}

export type ShadowDemoFeedItem = ShadowDemoPublicFeedItem | ShadowDemoHiddenFeedItem

export interface ShadowDemoPublicFeedItem {
  readonly visibility: "public"
  readonly rank: number
  readonly previousRank: number | null
  readonly movement: ShadowDemoRankMovement
  readonly post: ShadowDemoPublicPost
  readonly score: ShadowDemoScore
}

export interface ShadowDemoHiddenFeedItem {
  readonly visibility: "hidden"
  readonly rank: number
  readonly previousRank: number | null
  readonly movement: ShadowDemoRankMovement
  readonly post: null
  readonly score: null
  readonly hiddenReason: "no_unauthenticated" | "hide_label" | "adult_label" | "deleted_or_unavailable" | "missing_text"
  readonly labels: readonly string[]
}

export interface ShadowDemoPublicPost {
  readonly uri: string
  readonly cid: string
  readonly bskyUrl: string
  readonly authorDid: string
  readonly authorHandle: string
  readonly authorDisplayName: string
  readonly authorAvatar: string | null
  readonly text: string
  readonly indexedAt: string
  readonly createdAt: string
  readonly likeCount: number
  readonly repostCount: number
  readonly replyCount: number
  readonly quoteCount: number
  readonly labels: readonly string[]
}

export interface ShadowDemoRankMovement {
  readonly delta: number
  readonly label: "new" | "same" | "up" | "down"
}

export interface ShadowDemoScore {
  readonly total: number
  readonly components: readonly ShadowDemoScoreComponent[]
}

export interface ShadowDemoScoreComponent {
  readonly key: ShadowDemoSignalKey
  readonly label: string
  readonly rawScore: number
  readonly weight: number
  readonly contribution: number
}

export interface ShadowDemoCorpusHealth {
  readonly status: "live" | "fallback"
  readonly candidatePostCount: number
  readonly publicScoredPostCount: number
  readonly displayedPublicPostCount: number
  readonly displayedHiddenPostCount: number
  readonly uniqueAuthorCount: number
  readonly collectedAt: string
  readonly frozenForSession: true
}

export interface ShadowDemoCorpusProvenance {
  readonly mode: "production_sourced_session_frozen"
  readonly label: "Live-scored snapshot"
  readonly description: string
  readonly corpusId: string
  readonly productionEpochId: number
  readonly sampledAt: string
  readonly windowHours: 72
  readonly topicScoreThreshold: 0.5
  readonly eligiblePostCount: number
}

export interface ShadowDemoReceiptRequest {
  readonly epochId: string
  readonly postUri: string
}

export interface ShadowDemoReceiptResponse {
  readonly session: ShadowDemoSession
  readonly receipt: ShadowDemoReceipt
}

export interface ShadowDemoReceipt {
  readonly postUri: string
  readonly epochId: string
  readonly visibleRank: number
  readonly previousRank: number | null
  readonly totalScore: number
  readonly scoredAt: string
  readonly aggregate: ShadowDemoAggregate
  readonly reviewerBallotShare: number
  readonly components: readonly ShadowDemoScoreComponent[]
  readonly topicBreakdown: readonly ShadowDemoTopicContribution[]
  readonly topicRelevanceFormula: ShadowDemoTopicRelevanceFormula
  readonly provenance: ShadowDemoReceiptProvenance
  readonly counterfactuals: readonly ShadowDemoCounterfactual[]
  readonly generatedAt: string
  readonly explanationKind: "shadow_demo_receipt"
}

export interface ShadowDemoTopicRelevanceFormula {
  readonly formulaApplied: boolean
  readonly defaultTopicWeight: number
  readonly confidenceThreshold: number
  readonly weightedSum: number | null
  readonly signalSum: number | null
  readonly baseRelevance: number
  readonly confidenceMultiplier: number
  readonly effectiveRelevance: number
  readonly usedDefaultWeight: boolean
  readonly terms: readonly ShadowDemoTopicTerm[]
}

export interface ShadowDemoTopicTerm {
  readonly topic: string
  readonly postScore: number
  readonly communityWeight: number
  readonly weightedTerm: number
  readonly usedDefaultWeight: boolean
}

export interface ShadowDemoTopicContribution {
  readonly slug: string
  readonly label: string
  readonly postScore: number
  readonly communityWeight: number
  readonly contribution: number
}

export interface ShadowDemoReceiptProvenance extends ShadowDemoCorpusProvenance {
  readonly shadowEpochId: string
  readonly postInclusionReasons: {
    readonly matchedTopics: readonly { readonly topic: string; readonly score: number }[]
    readonly matchedTerms: readonly string[]
  }
}

export interface ShadowDemoCounterfactual {
  readonly id: "prior_epoch" | "engagement_only" | "direct_reviewer_ballot_removed"
  readonly label: string
  readonly description: string
  readonly rank: number
  readonly deltaFromVisibleRank: number
}

export interface ShadowDemoClient {
  readonly createSession: (
    request: CreateShadowDemoSessionRequest,
    signal: AbortSignal,
  ) => Promise<ShadowDemoEnvelope<ShadowDemoSessionResponse>>
  readonly getSession: (
    sessionId: string,
    signal: AbortSignal,
  ) => Promise<ShadowDemoEnvelope<ShadowDemoSessionResponse>>
  readonly castVote: (
    sessionId: string,
    request: CastShadowDemoVoteRequest,
    signal: AbortSignal,
  ) => Promise<ShadowDemoEnvelope<CastShadowDemoVoteResponse>>
  readonly runAgents: (
    sessionId: string,
    request: RunShadowDemoAgentsRequest,
    signal: AbortSignal,
  ) => Promise<ShadowDemoEnvelope<RunShadowDemoAgentsResponse>>
  readonly advanceEpoch: (
    sessionId: string,
    request: AdvanceShadowDemoEpochRequest,
    signal: AbortSignal,
  ) => Promise<ShadowDemoEnvelope<AdvanceShadowDemoEpochResponse>>
  readonly getFeed: (
    sessionId: string,
    request: ShadowDemoFeedRequest,
    signal: AbortSignal,
  ) => Promise<ShadowDemoEnvelope<ShadowDemoFeed>>
  readonly getReceipt: (
    sessionId: string,
    request: ShadowDemoReceiptRequest,
    signal: AbortSignal,
  ) => Promise<ShadowDemoEnvelope<ShadowDemoReceiptResponse>>
}
