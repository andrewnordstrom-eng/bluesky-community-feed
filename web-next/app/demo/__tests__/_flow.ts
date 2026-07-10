// Shared helper: drive the mock client through the full guided flow.
// Not a *.test.* file, so Vitest does not collect it as a suite.

import type { ShadowDemoFeed, ShadowDemoPublicFeedItem } from "../shadow-demo-contract"
import { createMockShadowDemoClient } from "../mock-shadow-demo-client"
import { getPresetById } from "../shadow-demo-fixtures"

export function publicOrder(feed: ShadowDemoFeed): readonly string[] {
  return feed.items
    .filter((item): item is ShadowDemoPublicFeedItem => item.visibility === "public")
    .map((item) => item.post.uri)
}

export async function driveFullFlow(presetId = "field_notes") {
  const client = createMockShadowDemoClient()
  const signal = new AbortController().signal
  const created = await client.createSession(
    { communityId: "open_science_builders", scenarioId: "default", clientNonce: "nonce-1", mode: "guided" },
    signal,
  )
  const sessionId = created.payload.session.id
  const openEpochId = created.payload.currentEpoch.id
  const preset = getPresetById(presetId)
  if (preset === undefined) {
    throw new Error(`Unknown preset: ${presetId}`)
  }

  const voted = await client.castVote(
    sessionId,
    {
      idempotencyKey: "vote-1",
      baseEpochId: openEpochId,
      voterLabel: "You (reviewer)",
      weights: preset.weights,
      topicIntent: preset.topicIntent,
    },
    signal,
  )
  const agentsRun = await client.runAgents(
    sessionId,
    { idempotencyKey: "agents-1", baseEpochId: openEpochId },
    signal,
  )
  const advanced = await client.advanceEpoch(
    sessionId,
    { idempotencyKey: "advance-1", fromEpochId: openEpochId },
    signal,
  )

  return { client, signal, sessionId, openEpochId, created, voted, agentsRun, advanced }
}
