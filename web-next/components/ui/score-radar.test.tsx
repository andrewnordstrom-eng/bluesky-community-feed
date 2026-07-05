import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { GingerDot } from "./score-radar"

describe("GingerDot", () => {
  it("does not render when Recharts omits coordinates", () => {
    expect(renderToStaticMarkup(createElement(GingerDot, { cx: null, cy: 12 }))).toBe("")
    expect(renderToStaticMarkup(createElement(GingerDot, { cx: 12, cy: null }))).toBe("")
  })

  it("renders a dot when coordinates are present", () => {
    const markup = renderToStaticMarkup(createElement(GingerDot, { cx: 12, cy: 34 }))

    expect(markup).toContain("<circle")
    expect(markup).toContain('cx="12"')
    expect(markup).toContain('cy="34"')
  })
})
