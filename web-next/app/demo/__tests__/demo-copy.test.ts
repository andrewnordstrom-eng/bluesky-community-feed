import { describe, expect, it } from "vitest"
import { DISCLOSURE, allDemoCopyStrings } from "../shadow-demo-copy"

const blob = allDemoCopyStrings().join("  ||  ")

describe("demo copy — honest boundaries", () => {
  it("states the shadow/production-isolation disclosure", () => {
    expect(DISCLOSURE.production).toMatch(/shadow/i)
    expect(DISCLOSURE.production).toMatch(/(never|do not|don'?t|does not)\b.*\b(production|real)\b.*\b(governance|feed)/i)
  })

  it("names the Bluesky-vs-Corgi annotation boundary", () => {
    expect(DISCLOSURE.annotations).toMatch(/not native bluesky/i)
  })

  it("never claims the demo mutates the production feed or governance", () => {
    // positive mutation claims about production/real/live feed or governance
    const mutationOverclaim =
      /\b(change|changes|changed|update|updates|updated|mutate|mutates|affect|affects|write to|writes to)\b[^.]{0,40}\b(production|real|live)\b[^.]{0,20}\b(feed|governance)\b/i
    expect(blob).not.toMatch(mutationOverclaim)
  })

  it("never claims Bluesky natively renders rank badges or receipts", () => {
    const nativeOverclaim =
      /\bbluesky\b[^.]{0,30}\b(show|shows|render|renders|display|displays)\b[^.]{0,25}\b(rank|ranking|receipt|receipts|score|scores|badge|badges)\b/i
    expect(blob).not.toMatch(nativeOverclaim)
  })
})
