import { describe, expect, it } from "vitest"
import { SHADOW_DEMO_CONTRACT_VERSION } from "../shadow-demo-contract"
import { createMockShadowDemoClient } from "../mock-shadow-demo-client"
import { getPresetById } from "../shadow-demo-fixtures"
import { driveFullFlow } from "./_flow"

const signal = () => new AbortController().signal
const preset = getPresetById("field_notes")!

describe("mock client — phase order + nextRecommendedAction", () => {
  it("walks created→corpus_ready→reviewer_vote_cast→agent_votes_cast→reranked", async () => {
    const { created, voted, agentsRun, advanced } = await driveFullFlow()

    expect(created.contractVersion).toBe(SHADOW_DEMO_CONTRACT_VERSION)
    expect(created.payload.session.phase).toBe("corpus_ready")
    expect(created.payload.nextRecommendedAction).toBe("cast_reviewer_vote")

    expect(voted.payload.session.phase).toBe("reviewer_vote_cast")
    expect(voted.payload.nextRecommendedAction).toBe("run_agent_votes")

    expect(agentsRun.payload.session.phase).toBe("agent_votes_cast")
    expect(agentsRun.payload.nextRecommendedAction).toBe("advance_epoch")
    expect(agentsRun.payload.agents).toHaveLength(5)
    expect(agentsRun.payload.agentVotes).toHaveLength(24)
    expect(agentsRun.payload.pendingAggregate.voteSummary).toMatchObject({
      totalVotes: 25,
      trimCount: 2,
    })

    expect(advanced.payload.session.phase).toBe("reranked")
    expect(advanced.payload.nextRecommendedAction).toBe("select_post")
    expect(advanced.payload.previousEpoch.status).toBe("closed")
    expect(advanced.payload.currentEpoch.status).toBe("published")
  })

  it("advertises production isolation on the session", async () => {
    const { created } = await driveFullFlow()
    const { isolation, capabilities } = created.payload.session
    expect(isolation.writesProductionGovernance).toBe(false)
    expect(isolation.writesGovernanceVotes).toBe(false)
    expect(isolation.writesGovernanceEpochs).toBe(false)
    expect(isolation.writesResearchExports).toBe(false)
    expect(isolation.writesProductionFeedCache).toBe(false)
    expect(isolation.storageNamespace).toBe("demo")
    expect(capabilities.canMutateNativeBlueskyFeed).toBe(false)
  })

  it("rejects out-of-order actions", async () => {
    const client = createMockShadowDemoClient()
    const created = await client.createSession(
      { communityId: "open_science_builders", scenarioId: "s", clientNonce: "n", mode: "guided" },
      signal(),
    )
    const sessionId = created.payload.session.id
    const openEpochId = created.payload.currentEpoch.id

    // running agents before a reviewer vote is invalid
    await expect(
      client.runAgents(
        sessionId,
        { idempotencyKey: "a", baseEpochId: openEpochId },
        signal(),
      ),
    ).rejects.toThrow()

    // advancing before agents is invalid
    await expect(
      client.advanceEpoch(sessionId, { idempotencyKey: "b", fromEpochId: openEpochId }, signal()),
    ).rejects.toThrow()
  })

  it("rejects a stale baseEpochId", async () => {
    const client = createMockShadowDemoClient()
    const created = await client.createSession(
      { communityId: "open_science_builders", scenarioId: "s", clientNonce: "n", mode: "guided" },
      signal(),
    )
    await expect(
      client.castVote(
        created.payload.session.id,
        {
          idempotencyKey: "v",
          baseEpochId: "demo_epoch_does_not_exist",
          voterLabel: "You",
          weights: preset.weights,
          topicIntent: preset.topicIntent,
        },
        signal(),
      ),
    ).rejects.toThrow()
  })

  it("replays idempotently without double-advancing", async () => {
    const client = createMockShadowDemoClient()
    const created = await client.createSession(
      { communityId: "open_science_builders", scenarioId: "s", clientNonce: "n", mode: "guided" },
      signal(),
    )
    const sessionId = created.payload.session.id
    const openEpochId = created.payload.currentEpoch.id
    const request = {
      idempotencyKey: "same-key",
      baseEpochId: openEpochId,
      voterLabel: "You",
      weights: preset.weights,
      topicIntent: preset.topicIntent,
    }
    const first = await client.castVote(sessionId, request, signal())
    const second = await client.castVote(sessionId, request, signal())

    expect(second.warnings.map((w) => w.code)).toContain("demo_state_replayed")
    // sequence did not advance twice
    expect(second.payload.session.sequence).toBe(first.payload.session.sequence)
    expect(second.payload.session.phase).toBe("reviewer_vote_cast")
  })

  it("namespaces idempotency keys by operation", async () => {
    const client = createMockShadowDemoClient()
    const created = await client.createSession(
      { communityId: "open_science_builders", scenarioId: "s", clientNonce: "n", mode: "guided" },
      signal(),
    )
    const sessionId = created.payload.session.id
    const openEpochId = created.payload.currentEpoch.id
    const sharedKey = "shared-across-actions"

    await client.castVote(
      sessionId,
      {
        idempotencyKey: sharedKey,
        baseEpochId: openEpochId,
        voterLabel: "You",
        weights: preset.weights,
        topicIntent: preset.topicIntent,
      },
      signal(),
    )
    const voters = await client.runAgents(
      sessionId,
      { idempotencyKey: sharedKey, baseEpochId: openEpochId },
      signal(),
    )

    expect(voters.payload.agentVotes).toHaveLength(24)
    expect(voters.payload.session.phase).toBe("agent_votes_cast")
  })

  it("enforces and applies the backend feed limit contract", async () => {
    const client = createMockShadowDemoClient()
    const created = await client.createSession(
      { communityId: "open_science_builders", scenarioId: "s", clientNonce: "n", mode: "guided" },
      signal(),
    )
    const sessionId = created.payload.session.id
    const epochId = created.payload.currentEpoch.id
    const corpusSize = created.payload.feed.corpusHealth.candidatePostCount
    const publicScoredPostCount = created.payload.feed.corpusHealth.publicScoredPostCount

    const first = await client.getFeed(sessionId, { epochId, limit: 1 }, signal())
    const all = await client.getFeed(sessionId, { epochId, limit: corpusSize }, signal())
    const larger = await client.getFeed(sessionId, { epochId, limit: 100 }, signal())

    expect(first.payload.items).toHaveLength(1)
    expect(first.payload.corpusHealth.displayedPublicPostCount + first.payload.corpusHealth.displayedHiddenPostCount).toBe(1)
    expect(first.payload.corpusHealth.publicScoredPostCount).toBe(publicScoredPostCount)
    expect(all.payload.items).toHaveLength(corpusSize)
    expect(larger.payload.items).toHaveLength(corpusSize)
    await expect(client.getFeed(sessionId, { epochId, limit: 0 }, signal())).rejects.toMatchObject({ kind: "invalid_request" })
    await expect(client.getFeed(sessionId, { epochId, limit: 101 }, signal())).rejects.toMatchObject({ kind: "invalid_request" })
  })

  it("rejects unknown epochs and preserves requested epoch identities", async () => {
    const flow = await driveFullFlow()
    const previousEpochId = flow.advanced.payload.previousEpoch.id
    const currentEpochId = flow.advanced.payload.currentEpoch.id

    const previous = await flow.client.getFeed(flow.sessionId, { epochId: previousEpochId, limit: 100 }, flow.signal)
    const current = await flow.client.getFeed(flow.sessionId, { epochId: currentEpochId, limit: 100 }, flow.signal)

    expect(previous.payload.epochId).toBe(previousEpochId)
    expect(current.payload.epochId).toBe(currentEpochId)
    await expect(
      flow.client.getFeed(flow.sessionId, { epochId: "demo_epoch_unknown", limit: 10 }, flow.signal),
    ).rejects.toMatchObject({ kind: "stale_epoch" })
  })

  it("honors pre-aborted signals before reading or mutating mock state", async () => {
    const client = createMockShadowDemoClient()
    const cancelled = new Error("reviewer left the demo")
    const controller = new AbortController()
    controller.abort(cancelled)
    const aborted = controller.signal
    const createRequest = {
      communityId: "open_science_builders" as const,
      scenarioId: "s",
      clientNonce: "n",
      mode: "guided" as const,
    }

    await expect(client.createSession(createRequest, aborted)).rejects.toBe(cancelled)

    const created = await client.createSession(createRequest, signal())
    const sessionId = created.payload.session.id
    const epochId = created.payload.currentEpoch.id
    const before = await client.getSession(sessionId, signal())
    const post = created.payload.feed.items.find((item) => item.visibility === "public")
    expect(post?.visibility).toBe("public")
    if (post?.visibility !== "public") throw new Error("Expected a public fixture post")

    const cancelledCalls = [
      client.getSession(sessionId, aborted),
      client.refreshCorpus(createRequest, aborted),
      client.castVote(sessionId, {
        idempotencyKey: "cancelled-vote",
        baseEpochId: epochId,
        voterLabel: "You",
        weights: preset.weights,
        topicIntent: preset.topicIntent,
      }, aborted),
      client.runAgents(sessionId, { idempotencyKey: "cancelled-agents", baseEpochId: epochId }, aborted),
      client.advanceEpoch(sessionId, { idempotencyKey: "cancelled-advance", fromEpochId: epochId }, aborted),
      client.getFeed(sessionId, { epochId, limit: 10 }, aborted),
      client.getReceipt(sessionId, { epochId, postUri: post.post.uri }, aborted),
    ]

    for (const call of cancelledCalls) await expect(call).rejects.toBe(cancelled)
    const after = await client.getSession(sessionId, signal())
    expect(after.payload.session.sequence).toBe(before.payload.session.sequence)
    expect(after.payload.session.phase).toBe(before.payload.session.phase)
  })

  it("accepts a new vote cycle from the policy published by the prior epoch", async () => {
    const firstRound = await driveFullFlow("field_notes")
    const nextEpochId = firstRound.advanced.payload.currentEpoch.id
    const nextPreset = getPresetById("engagement")
    expect(nextPreset).toBeDefined()
    if (nextPreset === undefined) {
      throw new Error("Missing engagement-heavy demo preset")
    }

    const secondVote = await firstRound.client.castVote(
      firstRound.sessionId,
      {
        idempotencyKey: "vote-epoch-2",
        baseEpochId: nextEpochId,
        voterLabel: "You (reviewer)",
        weights: nextPreset.weights,
        topicIntent: nextPreset.topicIntent,
      },
      firstRound.signal,
    )
    const secondAgents = await firstRound.client.runAgents(
      firstRound.sessionId,
      { idempotencyKey: "agents-epoch-2", baseEpochId: nextEpochId },
      firstRound.signal,
    )
    const secondAdvance = await firstRound.client.advanceEpoch(
      firstRound.sessionId,
      { idempotencyKey: "advance-epoch-2", fromEpochId: nextEpochId },
      firstRound.signal,
    )

    expect(secondVote.payload.session.phase).toBe("reviewer_vote_cast")
    expect(secondAgents.payload.agentVotes).toHaveLength(24)
    expect(secondAdvance.payload.currentEpoch.sequence).toBe(3)
    expect(secondAdvance.payload.currentEpoch.weights.engagement).toBeGreaterThan(
      firstRound.advanced.payload.currentEpoch.weights.engagement,
    )
  })
})
