import { describe, expect, it } from "vitest"
import {
  BASELINE_WEIGHTS,
  buildCounterfactuals,
  getCommunityFixture,
  getPresetById,
  rankedIds,
} from "../shadow-demo-fixtures"
import { driveFullFlow, publicOrder } from "./_flow"

describe("mock ranking — votes change the order, deterministically", () => {
  it("reorders the frozen corpus after vote + agents + epoch advance", async () => {
    const { advanced } = await driveFullFlow("field_notes")
    const before = publicOrder(advanced.payload.feedBefore)
    const after = publicOrder(advanced.payload.feedAfter)

    expect(after).not.toEqual(before)
    // same corpus — same set of posts, just reordered
    expect([...after].sort()).toEqual([...before].sort())
  })

  it("is deterministic: same preset → identical agent votes + identical final order", async () => {
    const a = await driveFullFlow("field_notes")
    const b = await driveFullFlow("field_notes")

    expect(a.agentsRun.payload.agentVotes.map((v) => v.weights)).toEqual(
      b.agentsRun.payload.agentVotes.map((v) => v.weights),
    )
    expect(publicOrder(a.advanced.payload.feedAfter)).toEqual(publicOrder(b.advanced.payload.feedAfter))
  })

  it("engine: the viral joke wins under engagement baseline but sinks under field-notes", () => {
    const corpus = getCommunityFixture("open_science_builders").corpus
    const viralUri = "P4" // Eli Moreno, the viral joke

    const baselineOrder = rankedIds(corpus, BASELINE_WEIGHTS)
    const fieldOrder = rankedIds(corpus, getPresetById("field_notes")!.weights)

    const baselineRank = baselineOrder.indexOf(viralUri)
    const fieldRank = fieldOrder.indexOf(viralUri)

    expect(baselineRank).toBeGreaterThanOrEqual(0)
    // it drops (higher index = lower position) under a field-notes policy
    expect(fieldRank).toBeGreaterThan(baselineRank)
  })

  it("agent votes are all normalized to sum ~1.0", async () => {
    const { agentsRun } = await driveFullFlow()
    for (const vote of agentsRun.payload.agentVotes) {
      const sum = Object.values(vote.weights).reduce((total, value) => total + value, 0)
      expect(sum).toBeCloseTo(1, 5)
    }
  })

  it("rejects counterfactual requests for posts outside the frozen corpus", () => {
    const corpus = getCommunityFixture("open_science_builders").corpus
    expect(() => buildCounterfactuals({
      corpus,
      postId: "missing-post",
      visibleRank: 1,
      currentWeights: BASELINE_WEIGHTS,
      priorWeights: BASELINE_WEIGHTS,
      agentsOnlyWeights: BASELINE_WEIGHTS,
    })).toThrow("Corpus entry not found for ranking: missing-post")
  })
})
