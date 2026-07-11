import { describe, expect, it } from "vitest"
import { normalizePolicyWeight } from "../policy-bar"

describe("normalizePolicyWeight", () => {
  it.each([
    [-0.2, 0],
    [0, 0],
    [0.45, 0.45],
    [1, 1],
    [1.2, 1],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])("normalizes %s to %s", (value, expected) => {
    expect(normalizePolicyWeight(value)).toBe(expected)
  })
})
