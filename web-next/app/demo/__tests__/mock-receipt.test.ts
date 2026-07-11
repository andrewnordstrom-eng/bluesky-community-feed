import { describe, expect, it } from "vitest"
import { publicOrder, driveFullFlow } from "./_flow"

const signal = () => new AbortController().signal

describe("mock receipt — frozen corpus only, honest math", () => {
  it("returns receipt math for a frozen-corpus post", async () => {
    const { client, sessionId, advanced } = await driveFullFlow()
    const epochId = advanced.payload.currentEpoch.id
    const postUri = publicOrder(advanced.payload.feedAfter)[0]

    const { payload } = await client.getReceipt(sessionId, { epochId, postUri }, signal())
    const receipt = payload.receipt

    expect(receipt.explanationKind).toBe("shadow_demo_receipt")
    expect(receipt.postUri).toBe(postUri)
    expect(receipt.components).toHaveLength(5)

    // raw × weight = contribution, and Σ contributions = total
    let sum = 0
    for (const component of receipt.components) {
      expect(component.contribution).toBeCloseTo(component.rawScore * component.weight, 6)
      sum += component.contribution
    }
    expect(sum).toBeCloseTo(receipt.totalScore, 6)

    // all three counterfactuals present
    const ids = receipt.counterfactuals.map((c) => c.id)
    expect(ids).toContain("prior_epoch")
    expect(ids).toContain("engagement_only")
    expect(ids).toContain("direct_reviewer_ballot_removed")
  })

  it("rejects a post URI outside the frozen corpus", async () => {
    const { client, sessionId, advanced } = await driveFullFlow()
    const epochId = advanced.payload.currentEpoch.id
    await expect(
      client.getReceipt(
        sessionId,
        { epochId, postUri: "at://did:plc:not-in-corpus/app.bsky.feed.post/zzz" },
        signal(),
      ),
    ).rejects.toThrow()
  })

  it("refuses a receipt for a withheld (hidden) row", async () => {
    const { client, sessionId, advanced } = await driveFullFlow()
    const epochId = advanced.payload.currentEpoch.id
    const hiddenUri = "at://did:plc:corgidemoh1/app.bsky.feed.post/H1"
    await expect(client.getReceipt(sessionId, { epochId, postUri: hiddenUri }, signal())).rejects.toThrow()
  })
})
