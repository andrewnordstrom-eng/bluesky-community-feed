// Deterministic mock implementation of ShadowDemoClient.
//
// This is a test-only in-memory implementation of the `/api/demo/*` contract.
// The product path uses the HTTP client. The mock writes nothing anywhere and
// remains deterministic so contract and ranking tests are replayable.
// Timestamps/ids come from an injectable monotonic clock so tests are stable.
//
// Epoch model (gives a crisp before/after "aha"): the OPEN epoch keeps the
// baseline (engagement-heavy) policy that the feed currently uses. Reviewer +
// agent votes accumulate into it but do NOT rerank the visible feed. Only
// `advanceEpoch` closes it and opens a new epoch with the aggregated policy,
// reranking the frozen corpus — so feedBefore/feedAfter is the reorder.

import {
  SHADOW_DEMO_CONTRACT_VERSION,
  type AdvanceShadowDemoEpochRequest,
  type AdvanceShadowDemoEpochResponse,
  type CastShadowDemoVoteRequest,
  type CastShadowDemoVoteResponse,
  type CreateShadowDemoSessionRequest,
  type RunShadowDemoAgentsRequest,
  type RunShadowDemoAgentsResponse,
  type ShadowDemoAction,
  type ShadowDemoClient,
  type ShadowDemoEnvelope,
  type ShadowDemoEpoch,
  type ShadowDemoFeed,
  type ShadowDemoFeedRequest,
  type ShadowDemoPhase,
  type ShadowDemoReceipt,
  type ShadowDemoReceiptRequest,
  type ShadowDemoReceiptResponse,
  type ShadowDemoSession,
  type ShadowDemoSessionResponse,
  type ShadowDemoVote,
  type ShadowDemoWarning,
  type ShadowDemoWeights,
} from "./shadow-demo-contract"
import {
  BASELINE_TOPIC_INTENT,
  BASELINE_WEIGHTS,
  buildCounterfactuals,
  CORPUS_COLLECTED_AT,
  DEMO_AGENTS,
  getCommunityFixture,
  normalizeWeights,
  rankCorpus,
  rankedIds,
  topicBreakdownFor,
  trimmedVoterAverage,
  type DemoCommunityFixture,
  type DemoCorpusEntry,
} from "./shadow-demo-fixtures"

export class ShadowDemoClientError extends Error {
  constructor(
    message: string,
    readonly kind: "not_found" | "invalid_phase" | "stale_epoch" | "invalid_request" | "unknown_post",
  ) {
    super(message)
    this.name = "ShadowDemoClientError"
  }
}

interface SessionState {
  session: ShadowDemoSession
  readonly fixture: DemoCommunityFixture
  readonly corpus: readonly DemoCorpusEntry[]
  reviewerVote: ShadowDemoVote | null
  agentVotes: readonly ShadowDemoVote[]
  /** Epoch currently accepting votes / applied to the feed. */
  openEpoch: ShadowDemoEpoch
  /** Set once the epoch is advanced. */
  publishedEpoch: ShadowDemoEpoch | null
  /** Rank map of the currently-applied feed (baseline, then aggregate after advance). */
  currentRankById: Readonly<Record<string, number>>
  baselineRankById: Readonly<Record<string, number>>
  readonly idempotency: Map<string, unknown>
}

const ISOLATION = {
  writesProductionGovernance: false,
  writesGovernanceVotes: false,
  writesGovernanceEpochs: false,
  writesResearchExports: false,
  writesProductionFeedCache: false,
  storageNamespace: "demo",
} as const

const CAPABILITIES = {
  canCastReviewerVote: true,
  canRunAgents: true,
  canAdvanceEpoch: true,
  canRefreshCorpus: true,
  canOpenNativeBlueskyFeed: false,
  canMutateNativeBlueskyFeed: false,
} as const

function nextRecommendedActionFor(phase: ShadowDemoPhase): ShadowDemoAction {
  switch (phase) {
    case "corpus_ready":
      return "cast_reviewer_vote"
    case "reviewer_vote_cast":
      return "run_agent_votes"
    case "agent_votes_cast":
      return "advance_epoch"
    case "epoch_transitioned":
    case "reranked":
      return "select_post"
    default:
      return "create_session"
  }
}

export interface MockShadowDemoClientOptions {
  /** Monotonic epoch-millis source; defaults to a deterministic counter. */
  readonly now?: () => number
}

export function createMockShadowDemoClient(options: MockShadowDemoClientOptions = {}): ShadowDemoClient {
  const sessions = new Map<string, SessionState>()
  let counter = 0
  const baseMs = Date.parse(CORPUS_COLLECTED_AT)
  const now = options.now ?? (() => baseMs + counter * 1000)
  const nextId = (prefix: string): string => {
    counter += 1
    return `${prefix}_${counter}`
  }
  const iso = (): string => new Date(now()).toISOString()

  function envelope<T>(sessionId: string | null, payload: T, warnings: readonly ShadowDemoWarning[] = []): ShadowDemoEnvelope<T> {
    return {
      contractVersion: SHADOW_DEMO_CONTRACT_VERSION,
      requestId: nextId("req"),
      generatedAt: iso(),
      sessionId,
      payload,
      warnings,
    }
  }

  function requireSession(sessionId: string): SessionState {
    const state = sessions.get(sessionId)
    if (state === undefined) {
      throw new ShadowDemoClientError(`Unknown demo session: ${sessionId}`, "not_found")
    }
    return state
  }

  function buildFeed(state: SessionState, weights: ShadowDemoWeights, previousRankById: Readonly<Record<string, number>> | null): ShadowDemoFeed {
    const { items } = rankCorpus(state.corpus, weights, previousRankById)
    const publicEntries = state.corpus.filter((entry) => entry.hidden === undefined)
    const hiddenEntries = state.corpus.filter((entry) => entry.hidden !== undefined)
    const uniqueAuthors = new Set(publicEntries.map((entry) => entry.post.authorHandle))
    return {
      epochId: state.publishedEpoch?.id ?? state.openEpoch.id,
      corpusId: `demo_corpus_${state.session.id}`,
      rankingSource: "fixture_posts_shadow_weights",
      generatedAt: iso(),
      items,
      corpusHealth: {
        status: "fallback",
        candidatePostCount: state.corpus.length,
        publicScoredPostCount: publicEntries.length,
        displayedPublicPostCount: publicEntries.length,
        displayedHiddenPostCount: hiddenEntries.length,
        uniqueAuthorCount: uniqueAuthors.size,
        collectedAt: CORPUS_COLLECTED_AT,
        frozenForSession: true,
      },
    }
  }

  function appliedWeights(state: SessionState): ShadowDemoWeights {
    return state.publishedEpoch ? state.publishedEpoch.weights : state.openEpoch.weights
  }

  function currentFeed(state: SessionState): ShadowDemoFeed {
    if (state.publishedEpoch) {
      return buildFeed(state, state.publishedEpoch.weights, state.baselineRankById)
    }
    return buildFeed(state, state.openEpoch.weights, null)
  }

  function sessionResponse(state: SessionState): ShadowDemoSessionResponse {
    return {
      session: state.session,
      community: state.fixture.community,
      currentEpoch: state.publishedEpoch ?? state.openEpoch,
      previousEpoch: state.publishedEpoch ? state.openEpoch : null,
      feed: currentFeed(state),
      nextRecommendedAction: nextRecommendedActionFor(state.session.phase),
    }
  }

  function advanceSequence(state: SessionState, phase: ShadowDemoPhase): void {
    state.session = { ...state.session, phase, sequence: state.session.sequence + 1 }
  }

  /** Return a cached idempotent response if this key was already applied. */
  function replay<T>(state: SessionState, key: string): ShadowDemoEnvelope<T> | null {
    const cached = state.idempotency.get(key)
    if (cached === undefined) {
      return null
    }
    const envelopeCopy = cached as ShadowDemoEnvelope<T>
    return {
      ...envelopeCopy,
      warnings: [
        { code: "demo_state_replayed", message: "This action was already applied; returning the same demo state.", recoverable: true },
      ],
    }
  }

  const client: ShadowDemoClient = {
    async createSession(request: CreateShadowDemoSessionRequest, _signal: AbortSignal) {
      const fixture = getCommunityFixture(request.communityId)
      if (fixture.isPreview || fixture.corpus.length === 0) {
        throw new ShadowDemoClientError(`Community not available in this demo pass: ${request.communityId}`, "invalid_request")
      }
      const sessionId = nextId("demo_sess")
      const openEpoch: ShadowDemoEpoch = {
        id: nextId("demo_epoch"),
        sequence: 1,
        status: "open",
        label: "Baseline policy",
        weights: BASELINE_WEIGHTS,
        voteSummary: {
          reviewerVotes: 0,
          agentVotes: 0,
          totalVotes: 0,
          aggregateMethod: "trimmed_mean_no_trim_under_10",
          trimCount: 0,
          reviewerInfluenceShare: 0,
        },
        startedAt: iso(),
        closedAt: null,
      }
      const baselineRankById: Record<string, number> = {}
      rankedIds(fixture.corpus, BASELINE_WEIGHTS).forEach((id, index) => {
        baselineRankById[id] = index + 1
      })
      const session: ShadowDemoSession = {
        id: sessionId,
        phase: "corpus_ready",
        communityId: request.communityId,
        scenarioId: request.scenarioId,
        seed: `seed_${request.communityId}_${request.scenarioId}_${request.clientNonce}`,
        createdAt: iso(),
        expiresAt: new Date(now() + 30 * 60_000).toISOString(),
        sequence: 1,
        guidedEpochs: 5,
        maxEpochs: 10,
        isolation: ISOLATION,
        capabilities: CAPABILITIES,
      }
      const state: SessionState = {
        session,
        fixture,
        corpus: fixture.corpus,
        reviewerVote: null,
        agentVotes: [],
        openEpoch,
        publishedEpoch: null,
        currentRankById: baselineRankById,
        baselineRankById,
        idempotency: new Map(),
      }
      sessions.set(sessionId, state)
      return envelope(sessionId, sessionResponse(state))
    },

    async getSession(sessionId: string, _signal: AbortSignal) {
      const state = requireSession(sessionId)
      return envelope(sessionId, sessionResponse(state))
    },

    async castVote(sessionId: string, request: CastShadowDemoVoteRequest, _signal: AbortSignal) {
      const state = requireSession(sessionId)
      const replayed = replay<CastShadowDemoVoteResponse>(state, request.idempotencyKey)
      if (replayed) {
        return replayed
      }
      if (
        state.session.phase === "reranked" &&
        state.publishedEpoch !== null &&
        request.baseEpochId === state.publishedEpoch.id
      ) {
        state.openEpoch = {
          ...state.publishedEpoch,
          status: "open",
          closedAt: null,
        }
        state.publishedEpoch = null
        state.baselineRankById = { ...state.currentRankById }
        state.reviewerVote = null
        state.agentVotes = []
        state.session = { ...state.session, phase: "corpus_ready" }
      }
      if (state.session.phase !== "corpus_ready" && state.session.phase !== "reviewer_vote_cast") {
        throw new ShadowDemoClientError(`Cannot cast a vote from phase "${state.session.phase}"`, "invalid_phase")
      }
      if (request.baseEpochId !== state.openEpoch.id) {
        throw new ShadowDemoClientError("Stale epoch: the demo has moved on. Reset to try again.", "stale_epoch")
      }
      const weights = normalizeWeights(request.weights)
      const reviewerVote: ShadowDemoVote = {
        id: nextId("vote"),
        epochId: state.openEpoch.id,
        voterKind: "reviewer",
        voterId: "reviewer",
        voterLabel: request.voterLabel,
        weights,
        topicIntent: request.topicIntent,
        rationale: "Reviewer's demo-only policy choice.",
        castAt: iso(),
      }
      state.reviewerVote = reviewerVote
      state.openEpoch = {
        ...state.openEpoch,
        voteSummary: {
          ...state.openEpoch.voteSummary,
          reviewerVotes: 1,
          totalVotes: 1 + state.agentVotes.length,
          reviewerInfluenceShare: 1 / (1 + state.agentVotes.length),
        },
      }
      advanceSequence(state, "reviewer_vote_cast")
      const payload: CastShadowDemoVoteResponse = {
        session: state.session,
        reviewerVote,
        currentEpoch: state.openEpoch,
        nextRecommendedAction: "run_agent_votes",
      }
      const result = envelope(sessionId, payload)
      state.idempotency.set(request.idempotencyKey, result)
      return result
    },

    async runAgents(sessionId: string, request: RunShadowDemoAgentsRequest, _signal: AbortSignal) {
      const state = requireSession(sessionId)
      const replayed = replay<RunShadowDemoAgentsResponse>(state, request.idempotencyKey)
      if (replayed) {
        return replayed
      }
      if (state.session.phase !== "reviewer_vote_cast") {
        throw new ShadowDemoClientError("Cast the reviewer vote before running agents.", "invalid_phase")
      }
      if (request.baseEpochId !== state.openEpoch.id) {
        throw new ShadowDemoClientError("Stale epoch: the demo has moved on. Reset to try again.", "stale_epoch")
      }
      const selected = DEMO_AGENTS
      const agents = selected.map((entry) => entry.agent)
      const agentVotes: ShadowDemoVote[] = selected.flatMap((entry) =>
        Array.from({ length: entry.agent.voterCount }, (_unused, voterIndex) => ({
          id: nextId("vote"),
          epochId: state.openEpoch.id,
          voterKind: "agent" as const,
          voterId: `synthetic-${entry.agent.id}-${voterIndex + 1}`,
          voterLabel: `${entry.agent.name} voter ${voterIndex + 1}`,
          weights: normalizeWeights(entry.weights),
          topicIntent: BASELINE_TOPIC_INTENT,
          rationale: entry.agent.voteRationale,
          castAt: iso(),
        })),
      )
      state.agentVotes = agentVotes
      state.openEpoch = {
        ...state.openEpoch,
        status: "agent_voting",
        voteSummary: {
          reviewerVotes: 1,
          agentVotes: agentVotes.length,
          totalVotes: 1 + agentVotes.length,
          aggregateMethod: "trimmed_mean_no_trim_under_10",
          trimCount: 2,
          reviewerInfluenceShare: 1 / (1 + agentVotes.length),
        },
      }
      advanceSequence(state, "agent_votes_cast")
      const payload: RunShadowDemoAgentsResponse = {
        session: state.session,
        agents,
        agentVotes,
        currentEpoch: state.openEpoch,
        pendingAggregate: {
          weights: trimmedVoterAverage([
            state.reviewerVote?.weights ?? state.openEpoch.weights,
            ...agentVotes.map((vote) => vote.weights),
          ]),
          topicIntent: BASELINE_TOPIC_INTENT,
          voteSummary: state.openEpoch.voteSummary,
        },
        nextRecommendedAction: "advance_epoch",
      }
      const result = envelope(sessionId, payload)
      state.idempotency.set(request.idempotencyKey, result)
      return result
    },

    async advanceEpoch(sessionId: string, request: AdvanceShadowDemoEpochRequest, _signal: AbortSignal) {
      const state = requireSession(sessionId)
      const replayed = replay<AdvanceShadowDemoEpochResponse>(state, request.idempotencyKey)
      if (replayed) {
        return replayed
      }
      if (state.session.phase !== "agent_votes_cast") {
        throw new ShadowDemoClientError("Run the agent votes before advancing the epoch.", "invalid_phase")
      }
      if (request.fromEpochId !== state.openEpoch.id) {
        throw new ShadowDemoClientError("Stale epoch: the demo has moved on. Reset to try again.", "stale_epoch")
      }
      if (state.reviewerVote === null) {
        throw new ShadowDemoClientError("No reviewer vote recorded.", "invalid_request")
      }
      const feedBefore = buildFeed(state, state.openEpoch.weights, null)
      const aggregate = trimmedVoterAverage([
        state.reviewerVote.weights,
        ...state.agentVotes.map((vote) => vote.weights),
      ])
      const closedEpoch: ShadowDemoEpoch = {
        ...state.openEpoch,
        status: "closed",
        closedAt: iso(),
      }
      const publishedEpoch: ShadowDemoEpoch = {
        id: nextId("demo_epoch"),
        sequence: state.openEpoch.sequence + 1,
        status: "published",
        label: "Community-aggregated policy",
        weights: aggregate,
        voteSummary: {
          reviewerVotes: 1,
          agentVotes: state.agentVotes.length,
          totalVotes: 1 + state.agentVotes.length,
          aggregateMethod: "trimmed_mean_no_trim_under_10",
          trimCount: 2,
          reviewerInfluenceShare: 1 / (1 + state.agentVotes.length),
        },
        startedAt: iso(),
        closedAt: null,
      }
      state.openEpoch = closedEpoch
      state.publishedEpoch = publishedEpoch
      const feedAfter = buildFeed(state, publishedEpoch.weights, state.baselineRankById)
      const aggregateRankById: Record<string, number> = {}
      rankedIds(state.corpus, publishedEpoch.weights).forEach((id, index) => {
        aggregateRankById[id] = index + 1
      })
      state.currentRankById = aggregateRankById
      advanceSequence(state, "reranked")
      const payload: AdvanceShadowDemoEpochResponse = {
        session: state.session,
        previousEpoch: closedEpoch,
        currentEpoch: publishedEpoch,
        feedBefore,
        feedAfter,
        nextRecommendedAction: "select_post",
      }
      const result = envelope(sessionId, payload)
      state.idempotency.set(request.idempotencyKey, result)
      return result
    },

    async getFeed(sessionId: string, request: ShadowDemoFeedRequest, _signal: AbortSignal) {
      const state = requireSession(sessionId)
      const isPublished = state.publishedEpoch?.id === request.epochId
      const weights = isPublished ? state.publishedEpoch!.weights : state.openEpoch.weights
      const previous = isPublished ? state.baselineRankById : null
      return envelope(sessionId, buildFeed(state, weights, previous))
    },

    async getReceipt(sessionId: string, request: ShadowDemoReceiptRequest, _signal: AbortSignal) {
      const state = requireSession(sessionId)
      const entry = state.corpus.find((candidate) => candidate.post.uri === request.postUri)
      if (entry === undefined) {
        throw new ShadowDemoClientError("That post is not part of this demo session's frozen corpus.", "unknown_post")
      }
      if (entry.hidden) {
        throw new ShadowDemoClientError("This row is withheld from the public view and has no public receipt.", "unknown_post")
      }
      const weights = appliedWeights(state)
      const order = rankedIds(state.corpus, weights)
      const visibleRank = order.indexOf(entry.id) + 1
      const previousRank = state.publishedEpoch ? (state.baselineRankById[entry.id] ?? null) : null
      const { items } = rankCorpus(state.corpus, weights, state.publishedEpoch ? state.baselineRankById : null)
      const feedItem = items.find((item) => item.visibility === "public" && item.post.uri === request.postUri)
      const score = feedItem && feedItem.visibility === "public" ? feedItem.score : null
      if (score === null) {
        throw new ShadowDemoClientError("No score available for that post.", "unknown_post")
      }

      const topicIntent = state.reviewerVote?.topicIntent ?? BASELINE_TOPIC_INTENT
      const agentsOnlyWeights = state.agentVotes.length > 0
        ? trimmedVoterAverage(state.agentVotes.map((vote) => vote.weights))
        : BASELINE_WEIGHTS

      const receipt: ShadowDemoReceipt = {
        postUri: entry.post.uri,
        epochId: request.epochId,
        visibleRank,
        previousRank,
        totalScore: score.total,
        components: score.components,
        topicBreakdown: topicBreakdownFor(entry, state.fixture.topics, topicIntent),
        counterfactuals: buildCounterfactuals({
          corpus: state.corpus,
          postId: entry.id,
          visibleRank,
          currentWeights: weights,
          priorWeights: BASELINE_WEIGHTS,
          agentsOnlyWeights,
        }),
        generatedAt: iso(),
        explanationKind: "shadow_demo_receipt",
      }
      const payload: ShadowDemoReceiptResponse = { session: state.session, receipt }
      return envelope(sessionId, payload)
    },
  }

  return client
}
