import { describe, expect, it } from "vitest"
import { hasCompleteScoreComponents } from "../web-next/lib/post-explanation"

const complete = {
  recency: { raw_score: 0.5, weight: 0.2, weighted: 0.1 },
  engagement: { raw_score: 0.5, weight: 0.2, weighted: 0.1 },
  bridging: { raw_score: 0.5, weight: 0.2, weighted: 0.1 },
  source_diversity: { raw_score: 0.5, weight: 0.2, weighted: 0.1 },
  relevance: { raw_score: 0.5, weight: 0.2, weighted: 0.1 },
}

describe("post explanation component completeness", () => {
  it("accepts a complete five-signal decomposition", () => {
    expect(hasCompleteScoreComponents(complete)).toBe(true)
  })

  it("fails closed when a backend explanation omits a component", () => {
    const { relevance: _omitted, ...partial } = complete
    expect(hasCompleteScoreComponents(partial)).toBe(false)
  })

  it("fails closed when a component has malformed numeric fields", () => {
    expect(hasCompleteScoreComponents({
      ...complete,
      relevance: { raw_score: 0.5, weight: 0.2 },
    })).toBe(false)
  })

  it.each([null, undefined, {}, [], "components"])('fails closed for malformed component containers: %j', (value) => {
    expect(hasCompleteScoreComponents(value as never)).toBe(false)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "fails closed for non-finite component values: %s",
    (value) => {
      expect(hasCompleteScoreComponents({
        ...complete,
        relevance: { raw_score: value, weight: 0.2, weighted: 0.1 },
      })).toBe(false)
    },
  )
})
