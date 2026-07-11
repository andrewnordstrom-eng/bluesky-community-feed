import { afterEach, describe, expect, it, vi } from "vitest"
import { createHttpShadowDemoClient } from "../http-shadow-demo-client"
import { type ShadowDemoWeights } from "../shadow-demo-contract"
import { CONTRACT_VERSION } from "../shadow-demo-api-schemas"

const NOW = "2026-07-10T05:00:00.000Z"
const SESSION_ID = "demo-http-contract"
const BASE_WEIGHTS: ShadowDemoWeights = {
  recency: 0.2,
  engagement: 0.2,
  bridging: 0.2,
  source_diversity: 0.2,
  relevance: 0.2,
}
const NEXT_WEIGHTS: ShadowDemoWeights = {
  recency: 0.12,
  engagement: 0.08,
  bridging: 0.3,
  source_diversity: 0.2,
  relevance: 0.3,
}
const TOPIC_INTENT = {
  topicWeights: {
    "science-research": 0.9,
    "data-science": 0.8,
    "software-development": 0.7,
    "open-source": 0.75,
  },
}
const PRODUCTION_TOPIC_INTENT = {
  topicWeights: {
    ...TOPIC_INTENT.topicWeights,
    music: 0.1,
    "decentralized-social": 0.9,
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("HTTP shadow demo client", () => {
  it("maps a live-scored session without claiming the unpublished community is a native Bluesky feed", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = requestPath(input)
      if (path === "/api/demo/sessions") return jsonEnvelope(sessionPayload("created", "epoch-1", [epoch("epoch-1", 1, BASE_WEIGHTS, 0)]))
      if (path.startsWith(`/api/demo/sessions/${SESSION_ID}/feed`)) return jsonEnvelope(feedPayload("epoch-1", [1, 2]))
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const response = await createHttpShadowDemoClient().createSession(
      { communityId: "open_science_builders", scenarioId: "guided_default", clientNonce: "nonce", mode: "guided" },
      new AbortController().signal,
    )

    expect(response.payload.community.name).toBe("Open Science Builders")
    expect(response.payload.community.publicBlueskyFeedUrl).toBeNull()
    expect(response.payload.session.capabilities.canOpenNativeBlueskyFeed).toBe(false)
    expect(response.payload.session.capabilities.canAdvanceEpoch).toBe(false)
    expect(response.payload.feed.rankingSource).toBe("live_public_posts_shadow_weights")
    expect(response.payload.feed.corpusHealth.candidatePostCount).toBe(84_831)
    expect(response.payload.feed.corpusHealth.publicScoredPostCount).toBe(80)
    expect(response.payload.feed.corpusHealth.displayedPublicPostCount).toBe(2)
    expect(response.payload.currentEpoch.topicIntent.topicWeights).toMatchObject({
      music: 0.1,
      "decentralized-social": 0.9,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("maps the full 24-voter electorate and production-faithful trimmed aggregate", async () => {
    const votes = syntheticVotes("epoch-1")
    vi.stubGlobal("fetch", vi.fn(async () => jsonEnvelope(sessionPayload(
      "synthetic_voters_ran",
      "epoch-1",
      [epoch("epoch-1", 1, BASE_WEIGHTS, 0)],
      votes,
      aggregate(NEXT_WEIGHTS, 25, 2),
    ))))

    const response = await createHttpShadowDemoClient().runAgents(
      SESSION_ID,
      { idempotencyKey: "run-1", baseEpochId: "epoch-1" },
      new AbortController().signal,
    )

    expect(response.payload.agents).toHaveLength(5)
    expect(response.payload.agentVotes).toHaveLength(24)
    expect(response.payload.pendingAggregate.voteSummary).toMatchObject({
      reviewerVotes: 1,
      agentVotes: 24,
      totalVotes: 25,
      trimCount: 2,
    })
    expect(response.payload.agents.map((profile) => profile.name)).toEqual([
      "Research Practitioners",
      "Data Stewards",
      "Current-Awareness Readers",
      "Community Discussants",
      "Interdisciplinary Connectors",
    ])
  })

  it("fetches both sides of an epoch transition and preserves real rank movement", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input)
      if (path.includes("/feed") && path.includes("epochId=epoch-1")) return jsonEnvelope(feedPayload("epoch-1", [1, 2]))
      if (path.endsWith("/epochs/advance") && init?.method === "POST") {
        return jsonEnvelope(sessionPayload(
          "epoch_advanced",
          "epoch-2",
          [advancedEpoch("epoch-1", 1, BASE_WEIGHTS), epoch("epoch-2", 2, NEXT_WEIGHTS, 25, "epoch-1")],
          syntheticVotes("epoch-1"),
          null,
        ))
      }
      if (path.includes("/feed") && path.includes("epochId=epoch-2")) return jsonEnvelope(feedPayload("epoch-2", [2, 1]))
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const response = await createHttpShadowDemoClient().advanceEpoch(
      SESSION_ID,
      { idempotencyKey: "advance-1", fromEpochId: "epoch-1" },
      new AbortController().signal,
    )

    expect(response.payload.previousEpoch.status).toBe("closed")
    expect(response.payload.currentEpoch.sequence).toBe(2)
    expect(response.payload.feedBefore.items.map((item) => item.rank)).toEqual([1, 2])
    expect(response.payload.feedAfter.items.map((item) => item.previousRank)).toEqual([2, 1])
    expect(response.payload.feedAfter.items.map((item) => item.movement.label)).toEqual(["up", "down"])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("fails closed when the frontend and backend contract versions drift", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      contractVersion: "2026-07-09.shadow-demo.v1",
      requestId: "request-old",
      generatedAt: NOW,
      sessionId: SESSION_ID,
      payload: {},
      warnings: [],
    }), { status: 200, headers: { "content-type": "application/json" } })))

    await expect(createHttpShadowDemoClient().createSession(
      { communityId: "open_science_builders", scenarioId: "guided_default", clientNonce: "nonce", mode: "guided" },
      new AbortController().signal,
    )).rejects.toThrow("invalid response envelope")
  })

  it("sanitizes non-JSON server failures and rejects malformed success envelopes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret upstream stack", {
      status: 503,
      statusText: "Service Unavailable",
    })))

    const failedRequest = createHttpShadowDemoClient().createSession(
      { communityId: "open_science_builders", scenarioId: "guided_default", clientNonce: "nonce", mode: "guided" },
      new AbortController().signal,
    )
    await expect(failedRequest).rejects.toThrow("HTTP 503")
    await expect(failedRequest).rejects.not.toThrow("secret upstream stack")

    vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json", { status: 200 })))
    await expect(createHttpShadowDemoClient().createSession(
      { communityId: "open_science_builders", scenarioId: "guided_default", clientNonce: "nonce", mode: "guided" },
      new AbortController().signal,
    )).rejects.toThrow("invalid response envelope")
  })

  it("rejects malformed provenance timestamps before they reach receipt and corpus UI", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      contractVersion: CONTRACT_VERSION,
      requestId: "request-bad-timestamp",
      generatedAt: "not-a-timestamp",
      sessionId: SESSION_ID,
      payload: sessionPayload("created", "epoch-1", [epoch("epoch-1", 1, BASE_WEIGHTS, 0)]),
      warnings: [],
    }), { status: 200, headers: { "content-type": "application/json" } })))

    await expect(createHttpShadowDemoClient().createSession(
      { communityId: "open_science_builders", scenarioId: "guided_default", clientNonce: "nonce", mode: "guided" },
      new AbortController().signal,
    )).rejects.toThrow("invalid response envelope")
  })

  it("honors caller cancellation independently of the internal timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
      }),
    ))
    const controller = new AbortController()
    const request = createHttpShadowDemoClient().getFeed(
      SESSION_ID,
      { epochId: "epoch-1", limit: 12 },
      controller.signal,
    )

    controller.abort(new Error("stale demo request"))

    await expect(request).rejects.toThrow("stale demo request")
  })

  it("times out a backend request that never completes", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
      }),
    ))

    const request = createHttpShadowDemoClient().getFeed(
      SESSION_ID,
      { epochId: "epoch-1", limit: 12 },
      new AbortController().signal,
    )
    const rejection = expect(request).rejects.toThrow("timed out after 10000ms")
    await vi.advanceTimersByTimeAsync(10_000)

    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })

  it("allows a cold corpus session longer than ordinary demo requests", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
      }),
    ))

    const request = createHttpShadowDemoClient().createSession(
      { communityId: "open_science_builders", scenarioId: "guided_default", clientNonce: "nonce", mode: "guided" },
      new AbortController().signal,
    )
    const rejection = expect(request).rejects.toThrow("timed out after 30000ms")
    await vi.advanceTimersByTimeAsync(10_000)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(20_000)

    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })

  it("derives action capabilities from the server phase and epoch limit", async () => {
    const cases = [
      { phase: "created", expected: [true, false, false], epochCount: 1 },
      { phase: "reviewer_voted", expected: [true, true, false], epochCount: 1 },
      { phase: "synthetic_voters_ran", expected: [false, false, true], epochCount: 1 },
      { phase: "epoch_advanced", expected: [true, false, false], epochCount: 2 },
      { phase: "synthetic_voters_ran", expected: [false, false, false], epochCount: 10 },
    ] as const

    for (const testCase of cases) {
      const epochs = Array.from({ length: testCase.epochCount }, (_unused, index) =>
        epoch(`epoch-${index + 1}`, index + 1, BASE_WEIGHTS, 0),
      )
      const currentEpochId = `epoch-${testCase.epochCount}`
      let requestCount = 0
      vi.stubGlobal("fetch", vi.fn(async () => {
        requestCount += 1
        return requestCount % 2 === 1
          ? jsonEnvelope(sessionPayload(testCase.phase, currentEpochId, epochs))
          : jsonEnvelope(feedPayload(currentEpochId, [1, 2]))
      }))

      const response = await createHttpShadowDemoClient().getSession(SESSION_ID, new AbortController().signal)
      const capabilities = response.payload.session.capabilities
      expect([
        capabilities.canCastReviewerVote,
        capabilities.canRunAgents,
        capabilities.canAdvanceEpoch,
      ]).toEqual(testCase.expected)
      vi.unstubAllGlobals()
    }
  })
})

function requestPath(input: string | URL | Request): string {
  const value = input instanceof Request ? input.url : String(input)
  return value.startsWith("http") ? `${new URL(value).pathname}${new URL(value).search}` : value
}

function jsonEnvelope(payload: unknown): Response {
  return new Response(JSON.stringify({
    contractVersion: CONTRACT_VERSION,
    requestId: "request-http-contract",
    generatedAt: NOW,
    sessionId: SESSION_ID,
    payload,
    warnings: [],
  }), { status: 200, headers: { "content-type": "application/json" } })
}

function sessionPayload(
  phase: "created" | "reviewer_voted" | "synthetic_voters_ran" | "epoch_advanced",
  currentEpochId: string,
  epochs: readonly unknown[],
  votes: readonly unknown[] = [],
  pendingAggregate: unknown = null,
): unknown {
  return {
    session: {
      sessionId: SESSION_ID,
      community: {
        id: "open_science_builders",
        name: "Open Science Builders",
        status: "live_shadow",
        description: "Research, data, software, and open-source methods.",
        liveFeedReady: true,
      },
      phase,
      currentEpochId,
      expiresAt: "2026-07-10T06:30:00.000Z",
      corpusHealth: corpusHealth(),
      epochs,
      pendingAggregate,
      voteCount: votes.length,
      guidedEpochs: 5,
      maxEpochs: 10,
      syntheticVoterCount: 24,
      totalDemoVoters: 25,
      corpusProvenance: corpusProvenance(),
      voterProfiles: voterProfiles(),
      votes,
    },
  }
}

function epoch(
  id: string,
  sequence: number,
  weights: ShadowDemoWeights,
  voteCount: number,
  decidedByEpochId: string | null = null,
): Record<string, unknown> {
  return {
    id,
    sequence,
    label: sequence === 1 ? "Baseline policy" : `Shadow epoch ${sequence}`,
    status: "open",
    createdAt: NOW,
    advancedAt: null,
    decidedByEpochId,
    aggregate: aggregate(weights, voteCount, voteCount >= 10 ? 2 : 0),
  }
}

function advancedEpoch(id: string, sequence: number, weights: ShadowDemoWeights): Record<string, unknown> {
  return {
    ...epoch(id, sequence, weights, 0),
    status: "advanced",
    advancedAt: NOW,
  }
}

function aggregate(weights: ShadowDemoWeights, voteCount: number, trimCount: number): unknown {
  return {
    aggregateMethod: "trimmed_mean_no_trim_under_10",
    voteCount,
    trimCount,
    weights,
    topicIntent: PRODUCTION_TOPIC_INTENT,
  }
}

function corpusHealth(): unknown {
  return {
    status: "live",
    source: "production_scores_appview",
    candidatePosts72h: 84_831,
    publicScoredPosts: 80,
    uniqueAuthors72h: 46_652,
    bridgePostShare: 0.027,
    topAuthorConcentration: 0.017,
    sampledAt: NOW,
  }
}

function corpusProvenance(): unknown {
  return {
    mode: "production_sourced_session_frozen",
    label: "Live-scored snapshot",
    description: "Live-scored snapshot, frozen for this demo run so rank movement is attributable to policy changes.",
    corpusId: "corpus-open-science",
    productionEpochId: 7,
    sampledAt: NOW,
    windowHours: 72,
    topicScoreThreshold: 0.5,
    eligiblePostCount: 80,
  }
}

function voterProfiles(): readonly unknown[] {
  const profiles = [
    ["research_practitioner", "Research Practitioners", 5],
    ["dataset_steward", "Data Stewards", 5],
    ["current_awareness", "Current-Awareness Readers", 5],
    ["community_discussant", "Community Discussants", 4],
    ["interdisciplinary_connector", "Interdisciplinary Connectors", 5],
  ] as const
  return profiles.map(([id, label, voterCount]) => ({
    id,
    label,
    voterCount,
    baseWeights: BASE_WEIGHTS,
    baseTopicWeights: TOPIC_INTENT.topicWeights,
    reviewerBlend: 0.2,
    policyInertia: 0.3,
  }))
}

function syntheticVotes(epochId: string): readonly unknown[] {
  return voterProfiles().flatMap((profile) => {
    const typed = profile as { readonly id: string; readonly label: string; readonly voterCount: number }
    return Array.from({ length: typed.voterCount }, (_unused, index) => ({
      id: `vote-${typed.id}-${index + 1}`,
      epochId,
      actorType: "synthetic_voter",
      actorId: `synthetic-${typed.id}-${index + 1}`,
      blocId: typed.id,
      label: `${typed.label} voter ${index + 1}`,
      weights: NEXT_WEIGHTS,
      topicIntent: TOPIC_INTENT,
      createdAt: NOW,
    }))
  })
}

function feedPayload(epochId: string, previousRanks: readonly number[]): unknown {
  return {
    epochId,
    corpusId: "corpus-open-science",
    communityId: "open_science_builders",
    corpusHealth: corpusHealth(),
    corpusProvenance: corpusProvenance(),
    aggregate: aggregate(epochId === "epoch-1" ? BASE_WEIGHTS : NEXT_WEIGHTS, epochId === "epoch-1" ? 0 : 25, epochId === "epoch-1" ? 0 : 2),
    posts: previousRanks.map((previousRank, index) => ({
      rank: index + 1,
      previousRank: epochId === "epoch-1" ? null : previousRank,
      movement: epochId === "epoch-1" ? null : previousRank - (index + 1),
      score: 0.7 - index * 0.1,
      weightedComponents: {
        recency: 0.1,
        engagement: 0.1,
        bridging: 0.15,
        source_diversity: 0.15,
        relevance: 0.2,
      },
      rawScores: {
        recency: 0.5,
        engagement: 0.5,
        bridging: 0.5,
        source_diversity: 0.5,
        relevance: 0.5,
      },
      post: {
        kind: "public_post",
        uri: `at://did:plc:test/app.bsky.feed.post/${index + 1}`,
        cid: `cid-${index + 1}`,
        authorDid: `did:plc:researcher${index + 1}`,
        authorHandle: `researcher${index + 1}.bsky.social`,
        authorDisplayName: `Researcher ${index + 1}`,
        authorAvatar: null,
        text: `Open-science post ${index + 1}`,
        likeCount: 10,
        repostCount: 2,
        replyCount: 1,
        quoteCount: 0,
        indexedAt: NOW,
        createdAt: NOW,
        bskyUrl: `https://bsky.app/profile/researcher${index + 1}.bsky.social/post/${index + 1}`,
      },
    })),
  }
}
