import { SIGNAL_LABELS } from "@/lib/signals"
import {
  SHADOW_DEMO_CONTRACT_VERSION,
  SHADOW_DEMO_ENDPOINTS,
  SHADOW_DEMO_SIGNAL_KEYS,
  type AdvanceShadowDemoEpochRequest,
  type AdvanceShadowDemoEpochResponse,
  type CastShadowDemoVoteRequest,
  type CastShadowDemoVoteResponse,
  type CreateShadowDemoSessionRequest,
  type RunShadowDemoAgentsRequest,
  type RunShadowDemoAgentsResponse,
  type ShadowDemoAgent,
  type ShadowDemoAgentId,
  type ShadowDemoAggregate,
  type ShadowDemoClient,
  type ShadowDemoCommunity,
  type ShadowDemoCommunityId,
  type ShadowDemoCounterfactual,
  type ShadowDemoEnvelope,
  type ShadowDemoEpoch,
  type ShadowDemoFeed,
  type ShadowDemoFeedItem,
  type ShadowDemoFeedRequest,
  type ShadowDemoPhase,
  type ShadowDemoReceipt,
  type ShadowDemoReceiptRequest,
  type ShadowDemoReceiptResponse,
  type ShadowDemoSession,
  type ShadowDemoSessionResponse,
  type ShadowDemoSignalKey,
  type ShadowDemoTopicIntent,
  type ShadowDemoVote,
  type ShadowDemoWarning,
  type ShadowDemoWeights,
} from "./shadow-demo-contract"

interface ApiWarning {
  readonly code: string
  readonly message: string
  readonly severity: "info" | "warning" | "degraded"
}

interface ApiEnvelope<TPayload> {
  readonly contractVersion: typeof SHADOW_DEMO_CONTRACT_VERSION
  readonly requestId: string
  readonly generatedAt: string
  readonly sessionId: string | null
  readonly payload: TPayload
  readonly warnings: readonly ApiWarning[]
}

interface ApiTopicIntent {
  readonly topicWeights: Readonly<Record<string, number>>
}

interface ApiVoteSummary {
  readonly aggregateMethod: "trimmed_mean_no_trim_under_10"
  readonly voteCount: number
  readonly trimCount: number
  readonly weights: ShadowDemoWeights
  readonly topicIntent: ApiTopicIntent
}

interface ApiEpoch {
  readonly id: string
  readonly sequence: number
  readonly label: string
  readonly status: "open" | "advanced"
  readonly createdAt: string
  readonly advancedAt: string | null
  readonly decidedByEpochId: string | null
  readonly aggregate: ApiVoteSummary
}

interface ApiVoteBase {
  readonly id: string
  readonly epochId: string
  readonly label: string
  readonly weights: ShadowDemoWeights
  readonly topicIntent: ApiTopicIntent
  readonly createdAt: string
}

interface ApiReviewerVote extends ApiVoteBase {
  readonly actorType: "reviewer"
  readonly actorId: "reviewer"
  readonly blocId?: never
}

interface ApiSyntheticVote extends ApiVoteBase {
  readonly actorType: "synthetic_voter"
  readonly actorId: `synthetic-${ShadowDemoAgentId}-${number}`
  readonly blocId: ShadowDemoAgentId
}

type ApiVote = ApiReviewerVote | ApiSyntheticVote

interface ApiCorpusHealth {
  readonly status: "live" | "degraded"
  readonly source: "production_scores_appview" | "fixture_fallback"
  readonly candidatePosts72h: number
  readonly publicScoredPosts: number
  readonly uniqueAuthors72h: number
  readonly bridgePostShare: number
  readonly topAuthorConcentration: number
  readonly sampledAt: string
}

interface ApiCommunity {
  readonly id: ShadowDemoCommunityId
  readonly name: string
  readonly status: "live_shadow" | "degraded"
  readonly description: string
  readonly liveFeedReady: boolean
}

interface ApiVoterProfile {
  readonly id: ShadowDemoAgentId
  readonly label: string
  readonly voterCount: number
  readonly baseWeights: ShadowDemoWeights
  readonly baseTopicWeights: Readonly<Record<string, number>>
  readonly reviewerBlend: number
  readonly policyInertia: number
}

interface ApiSessionPayload {
  readonly session: {
    readonly sessionId: string
    readonly community: ApiCommunity
    readonly phase: "created" | "reviewer_voted" | "synthetic_voters_ran" | "epoch_advanced"
    readonly currentEpochId: string
    readonly expiresAt: string
    readonly corpusHealth: ApiCorpusHealth
    readonly epochs: readonly ApiEpoch[]
    readonly pendingAggregate: ApiVoteSummary | null
    readonly voteCount: number
    readonly guidedEpochs: number
    readonly maxEpochs: number
    readonly syntheticVoterCount: number
    readonly totalDemoVoters: number
    readonly voterProfiles: readonly ApiVoterProfile[]
    readonly votes: readonly ApiVote[]
  }
}

interface ApiPublicPost {
  readonly kind: "public_post"
  readonly uri: string
  readonly cid: string
  readonly authorHandle: string
  readonly authorDisplayName: string
  readonly authorAvatar: string | null
  readonly text: string
  readonly likeCount: number
  readonly repostCount: number
  readonly replyCount: number
  readonly quoteCount: number
  readonly indexedAt: string
  readonly bskyUrl: string
}

interface ApiHiddenPost {
  readonly kind: "hidden_post"
  readonly reason: string
}

interface ApiRankedPost {
  readonly rank: number
  readonly previousRank: number | null
  readonly movement: number | null
  readonly score: number | null
  readonly weightedComponents: Readonly<Record<ShadowDemoSignalKey, number>> | null
  readonly rawScores: Readonly<Record<ShadowDemoSignalKey, number>> | null
  readonly post: ApiPublicPost | ApiHiddenPost
}

interface ApiFeedPayload {
  readonly epochId: string
  readonly corpusId: string
  readonly communityId: ShadowDemoCommunityId
  readonly corpusHealth: ApiCorpusHealth
  readonly aggregate: ApiVoteSummary
  readonly posts: readonly ApiRankedPost[]
}

interface ApiReceiptPayload {
  readonly receipt: {
    readonly type: "shadow_demo_receipt"
    readonly epochId: string
    readonly postUri: string
    readonly visibleRank: number
    readonly previousRank: number | null
    readonly score: number
    readonly aggregate: ApiVoteSummary
    readonly components: readonly {
      readonly signal: ShadowDemoSignalKey
      readonly rawScore: number
      readonly weight: number
      readonly contribution: number
    }[]
    readonly topicSignals: readonly { readonly topic: string; readonly postScore: number }[]
    readonly counterfactuals: readonly {
      readonly label: "previous_epoch" | "engagement_only" | "without_reviewer_vote"
      readonly rank: number
      readonly deltaFromVisible: number
    }[]
  }
}

const SHADOW_DEMO_REQUEST_TIMEOUT_MS = 10_000
const SHADOW_DEMO_CORPUS_REQUEST_TIMEOUT_MS = 30_000

export function createHttpShadowDemoClient(): ShadowDemoClient {
  return {
    async createSession(request, signal) {
      const sessionEnvelope = await requestApi<ApiSessionPayload>(
        SHADOW_DEMO_ENDPOINTS.createSession,
        { method: "POST", body: JSON.stringify({ communityId: request.communityId, refreshCorpus: false }) },
        signal,
        SHADOW_DEMO_CORPUS_REQUEST_TIMEOUT_MS,
      )
      return sessionResponseEnvelope(sessionEnvelope, request.scenarioId, signal)
    },

    async getSession(sessionId, signal) {
      const sessionEnvelope = await requestApi<ApiSessionPayload>(
        SHADOW_DEMO_ENDPOINTS.session(sessionId),
        { method: "GET" },
        signal,
        SHADOW_DEMO_REQUEST_TIMEOUT_MS,
      )
      return sessionResponseEnvelope(sessionEnvelope, "guided_default", signal)
    },

    async refreshCorpus(request, signal) {
      const sessionEnvelope = await requestApi<ApiSessionPayload>(
        SHADOW_DEMO_ENDPOINTS.refreshCorpus,
        { method: "POST", body: JSON.stringify({ communityId: request.communityId, refreshCorpus: true }) },
        signal,
        SHADOW_DEMO_CORPUS_REQUEST_TIMEOUT_MS,
      )
      return sessionResponseEnvelope(sessionEnvelope, request.scenarioId, signal)
    },

    async castVote(sessionId, request, signal) {
      const envelope = await requestApi<ApiSessionPayload>(
        SHADOW_DEMO_ENDPOINTS.castVote(sessionId),
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: request.idempotencyKey,
            baseEpochId: request.baseEpochId,
            weights: request.weights,
            topicIntent: { topicWeights: request.topicIntent.topicWeights },
          }),
        },
        signal,
        SHADOW_DEMO_REQUEST_TIMEOUT_MS,
      )
      const apiSession = envelope.payload.session
      const reviewerVote = [...apiSession.votes]
        .reverse()
        .find((vote) => vote.epochId === request.baseEpochId && vote.actorType === "reviewer")
      if (reviewerVote === undefined) {
        throw new Error("The shadow demo accepted the vote but did not return the reviewer vote.")
      }
      return mapEnvelope(envelope, {
        session: mapSession(apiSession, "guided_default"),
        reviewerVote: mapVote(reviewerVote),
        currentEpoch: mapEpoch(requiredEpoch(apiSession, request.baseEpochId)),
        nextRecommendedAction: "run_agent_votes",
      } satisfies CastShadowDemoVoteResponse)
    },

    async runAgents(sessionId, request, signal) {
      const envelope = await requestApi<ApiSessionPayload>(
        SHADOW_DEMO_ENDPOINTS.runAgents(sessionId),
        {
          method: "POST",
          body: JSON.stringify({ idempotencyKey: request.idempotencyKey, baseEpochId: request.baseEpochId }),
        },
        signal,
        SHADOW_DEMO_REQUEST_TIMEOUT_MS,
      )
      const apiSession = envelope.payload.session
      if (apiSession.pendingAggregate === null) {
        throw new Error("Synthetic voters ran without returning a pending aggregate policy.")
      }
      return mapEnvelope(envelope, {
        session: mapSession(apiSession, "guided_default"),
        agents: apiSession.voterProfiles.map(mapAgent),
        agentVotes: apiSession.votes
          .filter((vote) => vote.epochId === request.baseEpochId && vote.actorType === "synthetic_voter")
          .map(mapVote),
        currentEpoch: mapEpoch(requiredEpoch(apiSession, request.baseEpochId)),
        pendingAggregate: mapAggregate(apiSession.pendingAggregate),
        nextRecommendedAction: "advance_epoch",
      } satisfies RunShadowDemoAgentsResponse)
    },

    async advanceEpoch(sessionId, request, signal) {
      const feedBeforeEnvelope = await requestApi<ApiFeedPayload>(
        feedPath(sessionId, request.fromEpochId, 12),
        { method: "GET" },
        signal,
        SHADOW_DEMO_REQUEST_TIMEOUT_MS,
      )
      const envelope = await requestApi<ApiSessionPayload>(
        SHADOW_DEMO_ENDPOINTS.advanceEpoch(sessionId),
        {
          method: "POST",
          body: JSON.stringify({ idempotencyKey: request.idempotencyKey, fromEpochId: request.fromEpochId }),
        },
        signal,
        SHADOW_DEMO_REQUEST_TIMEOUT_MS,
      )
      const apiSession = envelope.payload.session
      const feedAfterEnvelope = await requestApi<ApiFeedPayload>(
        feedPath(sessionId, apiSession.currentEpochId, 12),
        { method: "GET" },
        signal,
        SHADOW_DEMO_REQUEST_TIMEOUT_MS,
      )
      return mapEnvelope(envelope, {
        session: mapSession(apiSession, "guided_default"),
        previousEpoch: mapEpoch(requiredEpoch(apiSession, request.fromEpochId)),
        currentEpoch: mapEpoch(requiredEpoch(apiSession, apiSession.currentEpochId)),
        feedBefore: mapFeed(feedBeforeEnvelope.payload, feedBeforeEnvelope.generatedAt),
        feedAfter: mapFeed(feedAfterEnvelope.payload, feedAfterEnvelope.generatedAt),
        nextRecommendedAction: "select_post",
      } satisfies AdvanceShadowDemoEpochResponse)
    },

    async getFeed(sessionId, request, signal) {
      const envelope = await requestApi<ApiFeedPayload>(
        feedPath(sessionId, request.epochId, request.limit),
        { method: "GET" },
        signal,
        SHADOW_DEMO_REQUEST_TIMEOUT_MS,
      )
      return mapEnvelope(envelope, mapFeed(envelope.payload, envelope.generatedAt))
    },

    async getReceipt(sessionId, request, signal) {
      const [receiptEnvelope, sessionEnvelope] = await Promise.all([
        requestApi<ApiReceiptPayload>(
          receiptPath(sessionId, request),
          { method: "GET" },
          signal,
          SHADOW_DEMO_REQUEST_TIMEOUT_MS,
        ),
        requestApi<ApiSessionPayload>(
          SHADOW_DEMO_ENDPOINTS.session(sessionId),
          { method: "GET" },
          signal,
          SHADOW_DEMO_REQUEST_TIMEOUT_MS,
        ),
      ])
      return mapEnvelope(receiptEnvelope, {
        session: mapSession(sessionEnvelope.payload.session, "guided_default"),
        receipt: mapReceipt(receiptEnvelope.payload.receipt, receiptEnvelope.generatedAt),
      } satisfies ShadowDemoReceiptResponse)
    },
  }
}

async function sessionResponseEnvelope(
  envelope: ApiEnvelope<ApiSessionPayload>,
  scenarioId: string,
  signal: AbortSignal,
): Promise<ShadowDemoEnvelope<ShadowDemoSessionResponse>> {
  const apiSession = envelope.payload.session
  const feedEnvelope = await requestApi<ApiFeedPayload>(
    feedPath(apiSession.sessionId, apiSession.currentEpochId, 12),
    { method: "GET" },
    signal,
    SHADOW_DEMO_REQUEST_TIMEOUT_MS,
  )
  const currentEpochIndex = apiSession.epochs.findIndex((epoch) => epoch.id === apiSession.currentEpochId)
  const previousEpoch = currentEpochIndex > 0 ? apiSession.epochs[currentEpochIndex - 1] : null
  return mapEnvelope(envelope, {
    session: mapSession(apiSession, scenarioId),
    community: mapCommunity(apiSession.community, apiSession.corpusHealth),
    currentEpoch: mapEpoch(requiredEpoch(apiSession, apiSession.currentEpochId)),
    previousEpoch: previousEpoch === null ? null : mapEpoch(previousEpoch),
    feed: mapFeed(feedEnvelope.payload, feedEnvelope.generatedAt),
    nextRecommendedAction: apiSession.phase === "created" ? "cast_reviewer_vote" : "select_post",
  })
}

async function requestApi<TPayload>(
  path: string,
  init: RequestInit,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<ApiEnvelope<TPayload>> {
  const controller = new AbortController()
  let timedOut = false
  const abortFromParent = (): void => controller.abort(signal.reason)
  if (signal.aborted) abortFromParent()
  else signal.addEventListener("abort", abortFromParent, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(new Error(`Shadow demo request timed out after ${timeoutMs}ms`))
  }, timeoutMs)

  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: { "content-type": "application/json", ...init.headers },
    })
    const body = await response.json().catch(() => null) as unknown
    if (!response.ok) {
      const message = body !== null && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : `Shadow demo request failed with HTTP ${response.status}`
      throw new Error(message)
    }
    if (body === null || typeof body !== "object" || !("contractVersion" in body)) {
      throw new Error("Shadow demo API returned an invalid response envelope.")
    }
    const envelope = body as ApiEnvelope<TPayload>
    if (envelope.contractVersion !== SHADOW_DEMO_CONTRACT_VERSION) {
      throw new Error(
        `Shadow demo contract mismatch: expected ${SHADOW_DEMO_CONTRACT_VERSION}, received ${String(envelope.contractVersion)}`,
      )
    }
    return envelope
  } catch (error) {
    if (timedOut) {
      throw new Error(`Shadow demo request timed out after ${timeoutMs}ms`)
    }
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("Shadow demo request was cancelled")
    }
    throw error
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener("abort", abortFromParent)
  }
}

function mapEnvelope<TApiPayload, TViewPayload>(
  envelope: ApiEnvelope<TApiPayload>,
  payload: TViewPayload,
): ShadowDemoEnvelope<TViewPayload> {
  return {
    contractVersion: SHADOW_DEMO_CONTRACT_VERSION,
    requestId: envelope.requestId,
    generatedAt: envelope.generatedAt,
    sessionId: envelope.sessionId,
    payload,
    warnings: envelope.warnings.map(mapWarning),
  }
}

function mapWarning(warning: ApiWarning): ShadowDemoWarning {
  return {
    code: warning.code,
    message: warning.message,
    recoverable: warning.severity !== "degraded",
  }
}

function mapSession(api: ApiSessionPayload["session"], scenarioId: string): ShadowDemoSession {
  const firstEpoch = api.epochs[0]
  return {
    id: api.sessionId,
    phase: mapPhase(api.phase),
    communityId: api.community.id,
    scenarioId,
    seed: "server-seeded-replayable-electorate",
    createdAt: firstEpoch?.createdAt ?? api.expiresAt,
    expiresAt: api.expiresAt,
    sequence: api.epochs.length,
    guidedEpochs: api.guidedEpochs,
    maxEpochs: api.maxEpochs,
    isolation: {
      writesProductionGovernance: false,
      writesGovernanceVotes: false,
      writesGovernanceEpochs: false,
      writesResearchExports: false,
      writesProductionFeedCache: false,
      storageNamespace: "demo",
    },
    capabilities: {
      canCastReviewerVote: api.phase === "created" || api.phase === "reviewer_voted" || api.phase === "epoch_advanced",
      canRunAgents: api.phase === "reviewer_voted",
      canAdvanceEpoch: api.phase === "synthetic_voters_ran" && api.epochs.length < api.maxEpochs,
      canRefreshCorpus: true,
      canOpenNativeBlueskyFeed: false,
      canMutateNativeBlueskyFeed: false,
    },
  }
}

function mapPhase(phase: ApiSessionPayload["session"]["phase"]): ShadowDemoPhase {
  switch (phase) {
    case "created": return "corpus_ready"
    case "reviewer_voted": return "reviewer_vote_cast"
    case "synthetic_voters_ran": return "agent_votes_cast"
    case "epoch_advanced": return "reranked"
  }
}

function mapCommunity(community: ApiCommunity, health: ApiCorpusHealth): ShadowDemoCommunity {
  return {
    id: community.id,
    name: community.name,
    tagline: community.description,
    corpusStrategy: health.source === "production_scores_appview" ? "live_appview_search" : "fixture_fallback",
    candidateTerms: [],
    bridgeTerms: [],
    publicBlueskyFeedUrl: null,
  }
}

function mapEpoch(epoch: ApiEpoch): ShadowDemoEpoch {
  const totalVotes = epoch.aggregate.voteCount
  return {
    id: epoch.id,
    sequence: epoch.sequence,
    status: epoch.status === "open" ? "open" : "closed",
    label: epoch.label,
    weights: epoch.aggregate.weights,
    voteSummary: {
      reviewerVotes: totalVotes > 0 ? 1 : 0,
      agentVotes: Math.max(0, totalVotes - 1),
      totalVotes,
      aggregateMethod: "trimmed_mean_no_trim_under_10",
      trimCount: epoch.aggregate.trimCount,
      reviewerInfluenceShare: totalVotes > 0 ? 1 / totalVotes : 0,
    },
    startedAt: epoch.createdAt,
    closedAt: epoch.advancedAt,
  }
}

function mapAggregate(summary: ApiVoteSummary): ShadowDemoAggregate {
  return {
    weights: summary.weights,
    topicIntent: mapTopicIntent(summary.topicIntent),
    voteSummary: {
      reviewerVotes: summary.voteCount > 0 ? 1 : 0,
      agentVotes: Math.max(0, summary.voteCount - 1),
      totalVotes: summary.voteCount,
      aggregateMethod: summary.aggregateMethod,
      trimCount: summary.trimCount,
      reviewerInfluenceShare: summary.voteCount > 0 ? 1 / summary.voteCount : 0,
    },
  }
}

function mapAgent(profile: ApiVoterProfile): ShadowDemoAgent {
  return {
    id: profile.id,
    name: profile.label,
    role: `${profile.voterCount} persistent synthetic voters in this community bloc.`,
    deterministicSeed: `server:${profile.id}`,
    voteRationale: `Stable bloc preferences, ${Math.round(profile.policyInertia * 100)}% prior-policy inertia, and ${Math.round(profile.reviewerBlend * 100)}% bounded response to your proposal.`,
    voterCount: profile.voterCount,
    baseWeights: profile.baseWeights,
    reviewerBlend: profile.reviewerBlend,
    policyInertia: profile.policyInertia,
  }
}

function mapVote(vote: ApiVote): ShadowDemoVote {
  return {
    id: vote.id,
    epochId: vote.epochId,
    voterKind: vote.actorType === "reviewer" ? "reviewer" : "agent",
    voterId: vote.actorId,
    voterLabel: vote.label,
    weights: vote.weights,
    topicIntent: mapTopicIntent(vote.topicIntent),
    rationale: vote.blocId === undefined ? "Your demo-only policy proposal." : `Deterministic ${vote.blocId} voter.`,
    castAt: vote.createdAt,
  }
}

function mapTopicIntent(intent: ApiTopicIntent): ShadowDemoTopicIntent {
  return { topicWeights: intent.topicWeights }
}

function mapFeed(payload: ApiFeedPayload, generatedAt: string): ShadowDemoFeed {
  const items = payload.posts.map((post) => mapFeedItem(post, payload.aggregate.weights))
  const publicItems = items.filter((item) => item.visibility === "public").length
  return {
    epochId: payload.epochId,
    corpusId: payload.corpusId,
    rankingSource: payload.corpusHealth.source === "production_scores_appview"
      ? "live_public_posts_shadow_weights"
      : "fixture_posts_shadow_weights",
    generatedAt,
    items,
    corpusHealth: {
      status: payload.corpusHealth.status === "live" ? "live" : "fallback",
      candidatePostCount: payload.corpusHealth.candidatePosts72h,
      publicScoredPostCount: payload.corpusHealth.publicScoredPosts,
      displayedPublicPostCount: publicItems,
      displayedHiddenPostCount: items.filter((item) => item.visibility === "hidden").length,
      uniqueAuthorCount: payload.corpusHealth.uniqueAuthors72h,
      collectedAt: payload.corpusHealth.sampledAt,
      frozenForSession: true,
    },
  }
}

function mapFeedItem(post: ApiRankedPost, weights: ShadowDemoWeights): ShadowDemoFeedItem {
  const movement = movementFor(post.movement)
  if (post.post.kind === "hidden_post") {
    return {
      visibility: "hidden",
      rank: post.rank,
      previousRank: post.previousRank,
      movement,
      post: null,
      score: null,
      hiddenReason: hiddenReason(post.post.reason),
      labels: [],
    }
  }
  if (post.score === null || post.rawScores === null || post.weightedComponents === null) {
    return {
      visibility: "hidden",
      rank: post.rank,
      previousRank: post.previousRank,
      movement,
      post: null,
      score: null,
      hiddenReason: "missing_text",
      labels: [],
    }
  }
  return {
    visibility: "public",
    rank: post.rank,
    previousRank: post.previousRank,
    movement,
    post: {
      uri: post.post.uri,
      cid: post.post.cid,
      bskyUrl: post.post.bskyUrl,
      authorHandle: post.post.authorHandle,
      authorDisplayName: post.post.authorDisplayName,
      authorAvatar: post.post.authorAvatar,
      text: post.post.text,
      indexedAt: post.post.indexedAt,
      likeCount: post.post.likeCount,
      repostCount: post.post.repostCount,
      replyCount: post.post.replyCount,
      quoteCount: post.post.quoteCount,
      labels: [],
    },
    score: {
      total: post.score,
      components: SHADOW_DEMO_SIGNAL_KEYS.map((key) => ({
        key,
        label: SIGNAL_LABELS[key],
        rawScore: post.rawScores?.[key] ?? 0,
        weight: weights[key],
        contribution: post.weightedComponents?.[key] ?? 0,
      })),
    },
  }
}

function movementFor(delta: number | null): { delta: number; label: "new" | "same" | "up" | "down" } {
  if (delta === null) return { delta: 0, label: "new" }
  if (delta === 0) return { delta: 0, label: "same" }
  return { delta, label: delta > 0 ? "up" : "down" }
}

function hiddenReason(reason: string): "no_unauthenticated" | "hide_label" | "adult_label" | "deleted_or_unavailable" | "missing_text" {
  const normalized = reason.toLowerCase()
  if (normalized.includes("no-unauthenticated")) return "no_unauthenticated"
  if (normalized.includes("!hide") || normalized.includes("hide label")) return "hide_label"
  if (normalized.includes("adult")) return "adult_label"
  if (normalized.includes("text")) return "missing_text"
  return "deleted_or_unavailable"
}

function mapReceipt(receipt: ApiReceiptPayload["receipt"], generatedAt: string): ShadowDemoReceipt {
  return {
    postUri: receipt.postUri,
    epochId: receipt.epochId,
    visibleRank: receipt.visibleRank,
    previousRank: receipt.previousRank,
    totalScore: receipt.score,
    components: receipt.components.map((component) => ({
      key: component.signal,
      label: SIGNAL_LABELS[component.signal],
      rawScore: component.rawScore,
      weight: component.weight,
      contribution: component.contribution,
    })),
    topicBreakdown: receipt.topicSignals.map((topic) => {
      const communityWeight = receipt.aggregate.topicIntent.topicWeights[topic.topic]
      if (communityWeight === undefined) {
        throw new Error(`Shadow demo receipt omitted topic weight ${topic.topic}.`)
      }
      return {
        slug: topic.topic,
        label: topicLabel(topic.topic),
        postScore: topic.postScore,
        communityWeight,
        contribution: topic.postScore * communityWeight,
      }
    }),
    counterfactuals: receipt.counterfactuals.map(mapCounterfactual),
    generatedAt,
    explanationKind: "shadow_demo_receipt",
  }
}

function mapCounterfactual(item: ApiReceiptPayload["receipt"]["counterfactuals"][number]): ShadowDemoCounterfactual {
  const id = item.label === "previous_epoch" ? "prior_epoch" : item.label
  const label = item.label === "previous_epoch"
    ? "Prior epoch"
    : item.label === "engagement_only"
      ? "Engagement-only ranking"
      : "Without your vote"
  return { id, label, rank: item.rank, deltaFromVisibleRank: item.deltaFromVisible }
}

function topicLabel(slug: string): string {
  return slug.split("-").map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ")
}

function requiredEpoch(session: ApiSessionPayload["session"], epochId: string): ApiEpoch {
  const epoch = session.epochs.find((candidate) => candidate.id === epochId)
  if (epoch === undefined) throw new Error(`Shadow demo response omitted epoch ${epochId}.`)
  return epoch
}

function feedPath(sessionId: string, epochId: string, limit: number): string {
  const query = new URLSearchParams({ epochId, limit: String(limit) })
  return `${SHADOW_DEMO_ENDPOINTS.feed(sessionId)}?${query.toString()}`
}

function receiptPath(sessionId: string, request: ShadowDemoReceiptRequest): string {
  const query = new URLSearchParams({ epochId: request.epochId, postUri: request.postUri })
  return `${SHADOW_DEMO_ENDPOINTS.receipt(sessionId)}?${query.toString()}`
}

function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_CORGI_API_BASE_URL?.replace(/\/$/, "") ?? ""
  return `${base}${path}`
}
