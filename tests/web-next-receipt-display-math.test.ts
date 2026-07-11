import { describe, expect, it } from "vitest"
import type { ShadowDemoScoreComponent } from "../web-next/app/demo/shadow-demo-contract"
import {
  buildReceiptDisplayMath,
  formatReceiptScore,
  tryBuildReceiptDisplayMath,
} from "../web-next/lib/receipt-display-math"

describe("receipt display math", () => {
  it("derives every displayed contribution and total from one precision", () => {
    const components: ShadowDemoScoreComponent[] = [
      { key: "recency", label: "Recency", rawScore: 0.876543, weight: 0.133333, contribution: 0.116872 },
      { key: "engagement", label: "Engagement", rawScore: 0.765432, weight: 0.266667, contribution: 0.204115 },
      { key: "bridging", label: "Bridging", rawScore: 0.654321, weight: 0.2, contribution: 0.130864 },
      { key: "source_diversity", label: "Source diversity", rawScore: 0.543219, weight: 0.15, contribution: 0.081483 },
      { key: "relevance", label: "Relevance", rawScore: 0.932187, weight: 0.25, contribution: 0.233047 },
    ]

    const display = buildReceiptDisplayMath(components)
    for (const component of display.components) {
      expect(component.contribution).toBe(Number((component.rawScore * component.weight).toFixed(4)))
    }

    const displayedSum = display.components.reduce((total, component) => total + component.contribution, 0)
    expect(display.totalScore).toBe(Number(displayedSum.toFixed(4)))
    expect(formatReceiptScore(display.totalScore)).toBe(formatReceiptScore(displayedSum))
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("rejects non-finite receipt values: %s", (value) => {
    const components: ShadowDemoScoreComponent[] = [
      { key: "recency", label: "Recency", rawScore: value, weight: 1, contribution: value },
    ]
    expect(() => buildReceiptDisplayMath(components)).toThrow(/must be finite/i)
    expect(tryBuildReceiptDisplayMath(components)).toBeNull()
  })

  it("returns a zero total for an empty component list", () => {
    const display = buildReceiptDisplayMath([])
    expect(display.components).toEqual([])
    expect(display.totalScore).toBe(0)
  })
})
