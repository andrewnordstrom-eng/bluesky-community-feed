import { describe, expect, it } from "vitest"
import { formatTopicWeightDelta, topicLabel } from "@/components/demo/topic-policy"
import { languageLabel, safeWebUrl } from "@/components/feed/bluesky-feed"
import { formatDemoTimestamp } from "../demo-format"
import { completeDemoTopicIntent, DEMO_AGENTS, DEMO_VOTE_PRESETS, getCommunityFixture } from "../shadow-demo-fixtures"
import { createMockShadowDemoClient } from "../mock-shadow-demo-client"

const RELEASE_TOPIC_SLUGS = new Set([
  "adult-content", "ai-machine-learning", "art-creative", "books-reading", "climate-environment",
  "cooking-food", "cybersecurity", "data-science", "decentralized-social", "design-ux",
  "devops-infrastructure", "dogs-pets", "education", "gaming", "health-fitness",
  "mobile-development", "music", "news-journalism", "open-source", "politics-governance",
  "science-research", "software-development", "space-astronomy", "startups-business",
  "systems-programming", "web-development",
])

describe("demo topic policy presentation", () => {
  it("uses the frozen production catalog name and a readable fallback", () => {
    expect(topicLabel("science-research", [{ slug: "science-research", name: "Research", description: null, baselineWeight: 0.5 }])).toBe("Research")
    expect(topicLabel("decentralized-social", [])).toBe("Decentralized Social")
    expect(topicLabel("decentralized-social", [{ slug: "science-research", name: "Research", description: null, baselineWeight: 0.5 }])).toBe("Decentralized Social")
  })

  it("labels topic changes as percentage points", () => {
    expect(formatTopicWeightDelta(0.7, 0.1)).toBe("70% +10 pp")
    expect(formatTopicWeightDelta(0.3, -0.1)).toBe("30% -10 pp")
    expect(formatTopicWeightDelta(0.3, 0.0049)).toBe("30%")
    expect(formatTopicWeightDelta(0.3, 0.005)).toBe("30% +1 pp")
    expect(formatTopicWeightDelta(0.3, -0.005)).toBe("30% -1 pp")
  })

  it("keeps every preset override inside the frozen production catalog", () => {
    for (const preset of DEMO_VOTE_PRESETS) {
      expect(Object.keys(preset.topicIntent.topicWeights).every((slug) => RELEASE_TOPIC_SLUGS.has(slug))).toBe(true)
    }
  })

  it("keeps the mechanics fallback v4-sized and aligned with the 24-voter contract", () => {
    const fixture = getCommunityFixture("community_gov")
    expect(fixture.topics).toHaveLength(26)
    expect(new Set(fixture.topics.map((topic) => topic.slug)).size).toBe(26)
    expect(fixture.corpus.filter((entry) => entry.hidden === undefined).length).toBeGreaterThanOrEqual(12)
    expect(DEMO_AGENTS.reduce((sum, entry) => sum + entry.agent.voterCount, 0)).toBe(24)
  })

  it("requires the complete 26-topic policy in the mechanics client", async () => {
    const client = createMockShadowDemoClient()
    const signal = new AbortController().signal
    const created = await client.createSession(
      { communityId: "community_gov", scenarioId: "topic-validation", clientNonce: "topic-validation", mode: "guided" },
      signal,
    )
    const request = {
      idempotencyKey: "topic-vote",
      baseEpochId: created.payload.currentEpoch.id,
      voterLabel: "You",
      weights: DEMO_VOTE_PRESETS[0].weights,
    }

    await expect(client.castVote(created.payload.session.id, {
      ...request,
      topicIntent: { topicWeights: {} },
    }, signal)).rejects.toMatchObject({ kind: "invalid_request" })
    await expect(client.castVote(created.payload.session.id, {
      ...request,
      topicIntent: { topicWeights: { "science-research": 0.8 } },
    }, signal)).rejects.toMatchObject({ kind: "invalid_request" })
    await expect(client.castVote(created.payload.session.id, {
      ...request,
      topicIntent: completeDemoTopicIntent(DEMO_VOTE_PRESETS[0].topicIntent),
    }, signal)).resolves.toMatchObject({ payload: { session: { phase: "reviewer_vote_cast" } } })
  })

  it("formats snapshot timestamps deterministically and omits invalid values", () => {
    expect(formatDemoTimestamp("2026-07-11T22:26:40.669Z")).toContain("UTC")
    expect(formatDemoTimestamp("not-a-date")).toBeNull()
    expect(formatDemoTimestamp(null)).toBeNull()
  })

  it("preserves known non-English tags when undetermined is also present", () => {
    expect(languageLabel([])).toBeNull()
    expect(languageLabel(["und", "fr"])).toBe("Language: fr")
    expect(languageLabel(["und"])).toBe("Language not tagged")
    expect(languageLabel(["en", "fr"])).toBeNull()
  })

  it("allows web media links while rejecting executable and inline-data schemes", () => {
    expect(safeWebUrl("https://bsky.app/profile/did:plc:test/post/one")).toContain("https://bsky.app/")
    expect(safeWebUrl("http://example.com/image.jpg")).toBe("http://example.com/image.jpg")
    expect(safeWebUrl("javascript:alert(1)")).toBeNull()
    expect(safeWebUrl("data:image/png;base64,abc")).toBeNull()
    expect(safeWebUrl(null)).toBeNull()
    expect(safeWebUrl(undefined)).toBeNull()
    expect(safeWebUrl("")).toBeNull()
    expect(safeWebUrl("not a URL")).toBeNull()
  })
})
