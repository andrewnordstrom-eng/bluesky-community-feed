import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  COMMUNITY_GOV_FEED_URL,
  getDegradedCorpusWarning,
  getDemoCorpusPresentation,
  getLiveProofPresentation,
  getReceiptSelectionAnnouncement,
} from "@/components/demo/live-proof-panel"
import type { ShadowDemoCorpusProvenance, ShadowDemoFeed } from "../shadow-demo-view-model"
import {
  createDemoVoteSubmission,
  getEditedTopicSlugs,
} from "../shadow-demo-vote-policy"

const snapshotProvenance: ShadowDemoCorpusProvenance = {
  mode: "production_feed_snapshot_session_frozen",
  label: "Reviewer-safe snapshot of the live Community Governed Feed",
  description: "Frozen comparison corpus.",
  corpusId: "corpus-release",
  productionEpochId: 8,
  sampledAt: "2026-07-11T01:00:00.000Z",
  windowHours: 72,
  topicScoreThreshold: 0.5,
  eligiblePostCount: 42,
  sourceFeedUri: "at://did:plc:test/app.bsky.feed.generator/community-gov",
  sourceFeedName: "Contract-backed feed name",
  sourceSnapshotDigest: "a".repeat(64),
  sourceRunId: "run-8",
  sourceUpdatedAt: "2026-07-11T00:55:00.000Z",
  sourceReviewedAt: "2026-07-11T01:05:00.000Z",
  sourcePostCount: 100,
  selectionPolicyVersion: "v4",
  baselineOrderDigest: "b".repeat(64),
}

const demoPageSource = readFileSync(new URL("../page.tsx", import.meta.url), "utf8")
const votePanelSource = readFileSync(
  new URL("../../../components/demo/vote-panel.tsx", import.meta.url),
  "utf8",
)

function makeFeed(overrides: Partial<ShadowDemoFeed>): ShadowDemoFeed {
  return {
    epochId: "epoch-1",
    corpusId: "corpus-release",
    rankingSource: "live_public_posts_shadow_weights",
    generatedAt: "2026-07-11T01:10:00.000Z",
    items: [],
    corpusProvenance: snapshotProvenance,
    aggregate: {
      weights: { recency: 0.2, engagement: 0.2, bridging: 0.2, source_diversity: 0.2, relevance: 0.2 },
      topicIntent: { topicWeights: {} },
      voteSummary: {
        reviewerVotes: 0,
        agentVotes: 0,
        totalVotes: 0,
        aggregateMethod: "trimmed_mean_no_trim_under_10",
        trimCount: 0,
        reviewerBallotShare: 0,
      },
    },
    corpusHealth: {
      status: "live",
      candidatePostCount: 100,
      publicScoredPostCount: 42,
      displayedPublicPostCount: 12,
      displayedHiddenPostCount: 0,
      uniqueAuthorCount: 38,
      collectedAt: "2026-07-11T01:00:00.000Z",
      frozenForSession: true,
      sourcePostCount: 100,
      eligiblePostCount: 42,
    },
    ...overrides,
  }
}

describe("demo v4 frontend release blockers", () => {
  it("labels fixture corpus counts and provenance without live-snapshot or publication claims", () => {
    const presentation = getDemoCorpusPresentation(makeFeed({
      rankingSource: "fixture_posts_shadow_weights",
      corpusHealth: {
        status: "fallback",
        candidatePostCount: 13,
        publicScoredPostCount: 12,
        displayedPublicPostCount: 12,
        displayedHiddenPostCount: 1,
        uniqueAuthorCount: 10,
        collectedAt: "2026-07-11T01:00:00.000Z",
        frozenForSession: true,
      },
    }))

    expect(presentation.usesMechanicsFixture).toBe(true)
    expect(`${presentation.provenanceLine} ${presentation.metricsLine}`).toMatch(/mechanics fixture/i)
    expect(presentation.metricsLine).toMatch(/13 fixture items.*12 rankable/i)
    expect(`${presentation.provenanceLine} ${presentation.metricsLine}`).not.toMatch(/published entries|reviewed snapshot|live snapshot|captured/i)
  })

  it("keeps the fixture live-proof panel separate and omits the fixture timestamp", () => {
    const presentation = getLiveProofPresentation(snapshotProvenance, true)

    expect(presentation.feedName).toBe("Contract-backed feed name")
    expect(presentation.sourceTimestamp).toBeNull()
    expect(presentation.description).toContain("mechanics fixture")
    expect(COMMUNITY_GOV_FEED_URL).toBe("https://bsky.app/profile/corgi-network.bsky.social/feed/community-gov")
    expect(`${presentation.eyebrow} ${presentation.description}`).not.toMatch(/reviewed snapshot|live snapshot|snapshot captured|Jul 11, 2026/i)
  })

  it("derives snapshot live-proof labels and source time from contract provenance", () => {
    const presentation = getLiveProofPresentation(snapshotProvenance, false)

    expect(presentation.eyebrow).toBe("Snapshot source live on Bluesky")
    expect(presentation.feedName).toBe("Contract-backed feed name")
    expect(presentation.description).toMatch(/published-feed comparison corpus/i)
    expect(presentation.sourceTimestamp).toMatch(/Jul 11, 2026.*UTC/i)
    expect(presentation.description).not.toMatch(/reviewed snapshot/i)
  })

  it("shows a concise degraded warning and bounds unsafe diagnostic detail", () => {
    expect(getDegradedCorpusWarning([
      { code: "snapshot_unavailable", message: "The approved snapshot could not be loaded. Using the mechanics fixture.", recoverable: false },
    ])).toMatch(/approved snapshot could not be loaded/i)
    expect(getDegradedCorpusWarning([
      { code: "raw_failure", message: "x".repeat(181), recoverable: false },
    ])).toBe("The published-feed snapshot is unavailable, so this session is using a mechanics fixture.")
  })

  it("creates distinct receipt announcements for same-epoch post selections", () => {
    const first = getReceiptSelectionAnnouncement(1, false)
    const second = getReceiptSelectionAnnouncement(7, false)

    expect(first).toBe("Receipt view opened for rank 1. Loading ranking details.")
    expect(second).toBe("Receipt view opened for rank 7. Loading ranking details.")
    expect(first).not.toBe(second)
    expect(getReceiptSelectionAnnouncement(7, true)).toBe("Ranking receipt ready for rank 7.")
  })

  it("moves focus and announces every receipt selection, including within one epoch", () => {
    expect(demoPageSource).toMatch(/setReceiptFocusRequest\(\(current\) => current \+ 1\)/)
    expect(demoPageSource).toMatch(/panel\.focus\(\{ preventScroll: true \}\)/)
    expect(demoPageSource).toMatch(
      /\[mobileView, receiptFocusRequest, reduceMotion, reranked, selectedUri\]/,
    )
    expect(demoPageSource).toMatch(/aria-live="polite" aria-atomic="true"[\s\S]*?\{receiptAnnouncement\}/)
  })

  it("keeps expanded desktop voting controls independently scrollable with the action visible", () => {
    expect(votePanelSource).toMatch(/xl:max-h-\[calc\(100dvh-7rem\)\]/)
    expect(votePanelSource).toMatch(/xl:overflow-y-auto/)
    expect(votePanelSource).toMatch(/xl:overscroll-contain/)
    expect(votePanelSource).toMatch(/xl:\[scrollbar-gutter:stable\]/)
    expect(votePanelSource).toMatch(/xl:shrink-0[\s\S]*?STEP_PANELS\.vote\.cta/)
  })

  it("submits a complete 26-topic policy and preserves a fine-tuned value", () => {
    const topicCatalog = Array.from({ length: 26 }, (_, index) => ({
      slug: `topic-${index}`,
      name: `Topic ${index}`,
      description: null,
      baselineWeight: 0.5,
    }))
    const presetTopicIntent = {
      topicWeights: Object.fromEntries(topicCatalog.map((topic) => [topic.slug, 0.5])),
    }
    const editedTopicIntent = {
      topicWeights: { ...presetTopicIntent.topicWeights, "topic-7": 0.83 },
    }

    expect(getEditedTopicSlugs(editedTopicIntent, presetTopicIntent, topicCatalog)).toEqual(["topic-7"])
    expect(getEditedTopicSlugs(presetTopicIntent, presetTopicIntent, topicCatalog)).toEqual([])

    const submission = createDemoVoteSubmission(
      { recency: 0.4, engagement: 0.4, bridging: 0.4, source_diversity: 0.4, relevance: 0.4 },
      editedTopicIntent,
      topicCatalog,
    )

    expect(Object.keys(submission.topicIntent.topicWeights)).toHaveLength(26)
    expect(submission.topicIntent.topicWeights["topic-7"]).toBe(0.83)
    expect(Object.values(submission.weights).reduce((total, value) => total + value, 0)).toBeCloseTo(1)
  })

  it("fails closed when a demo ballot omits a topic", () => {
    const topicCatalog = Array.from({ length: 26 }, (_, index) => ({
      slug: `topic-${index}`,
      name: `Topic ${index}`,
      description: null,
      baselineWeight: 0.5,
    }))
    const incompleteTopicIntent = {
      topicWeights: Object.fromEntries(topicCatalog.slice(0, 25).map((topic) => [topic.slug, 0.5])),
    }

    expect(() => createDemoVoteSubmission(
      { recency: 0.2, engagement: 0.2, bridging: 0.2, source_diversity: 0.2, relevance: 0.2 },
      incompleteTopicIntent,
      topicCatalog,
    )).toThrow(/exactly the 26 catalog topics/i)
  })

  it("fails closed when a demo signal weight is outside the slider contract", () => {
    const topicCatalog = Array.from({ length: 26 }, (_, index) => ({
      slug: `topic-${index}`,
      name: `Topic ${index}`,
      description: null,
      baselineWeight: 0.5,
    }))
    const topicIntent = {
      topicWeights: Object.fromEntries(topicCatalog.map((topic) => [topic.slug, 0.5])),
    }

    expect(() => createDemoVoteSubmission(
      { recency: -0.1, engagement: 0.2, bridging: 0.3, source_diversity: 0.3, relevance: 0.3 },
      topicIntent,
      topicCatalog,
    )).toThrow(/signal recency has invalid weight/i)
  })

  it("uses one accessible slider system for signals and topics", () => {
    expect(votePanelSource).toMatch(/import \{ Slider \} from "@\/components\/ui\/slider"/)
    expect(votePanelSource).not.toMatch(/<input type="range"/)
    expect(votePanelSource).toMatch(/Your custom policy/)
    expect(votePanelSource).toMatch(/Every ballot carries all/)
  })
})
