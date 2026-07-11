import { describe, expect, it } from "vitest"
import { DISCLOSURE, allDemoCopyStrings } from "../shadow-demo-copy"

const mutationAction = String.raw`\b(change|changes|changed|update|updates|updated|mutate|mutates|affect|affects|write to|writes to)\b`
const productionTarget = String.raw`\b(production|real|live)\b[^.]{0,24}\b(feed|governance)\b`

function containsMutationOverclaim(value: string): boolean {
  const negation = /\b(never|not|does not|do not|don'?t|cannot|can't)\b[^.]{0,50}\b(change|update|mutate|affect|write)/i
  const forward = new RegExp(`${mutationAction}[^.]{0,48}${productionTarget}`, "i")
  const reversed = new RegExp(`${productionTarget}[^.]{0,48}${mutationAction}`, "i")
  return value.split(/[.!?;]+/).some((claim) => !negation.test(claim) && (forward.test(claim) || reversed.test(claim)))
}

function containsNativeUiOverclaim(value: string): boolean {
  const negation = /\b(?:does not|do not|doesn['’]?t|don['’]?t|cannot|can['’]?t|never|not|will not|won['’]?t)\b/i
  const forward = /\bbluesky\b([^.?!;]{0,36})\b(show|shows|render|renders|display|displays)\b([^.?!;]{0,30})\b(rank|ranking|receipt|receipts|score|scores|badge|badges)\b/gi
  const reversed = /\b(rank|ranking|receipt|receipts|score|scores|badge|badges)\b([^.?!;]{0,36})\b(native|shown|rendered|displayed)\b([^.?!;]{0,24})\bbluesky\b/gi

  for (const claim of value.split(/[.!?;]+/)) {
    for (const match of claim.matchAll(forward)) {
      if (!negation.test(match[1] ?? "") && !negation.test(match[3] ?? "")) {
        return true
      }
    }
    for (const match of claim.matchAll(reversed)) {
      if (!negation.test(match[2] ?? "")) {
        return true
      }
    }
  }
  return false
}

describe("demo copy — honest boundaries", () => {
  it("states the shadow/production-isolation disclosure", () => {
    expect(DISCLOSURE.production).toMatch(/shadow/i)
    expect(DISCLOSURE.production).toMatch(/(never|do not|don'?t|does not)\b.*\b(production|real)\b.*\b(governance|feed)/i)
  })

  it("names the Bluesky-vs-Corgi annotation boundary", () => {
    expect(DISCLOSURE.annotations).toMatch(/not native bluesky/i)
  })

  it("never claims the demo mutates the production feed or governance", () => {
    for (const value of allDemoCopyStrings()) {
      expect(containsMutationOverclaim(value), value).toBe(false)
    }

    expect(containsMutationOverclaim("This changes the production feed."), "forward wording").toBe(true)
    expect(containsMutationOverclaim("The production feed is changed by your vote."), "reversed wording").toBe(true)
    expect(containsMutationOverclaim("We never touch production governance. This changes the production feed."), "scoped negation").toBe(true)
    expect(["This changes ranking.", "Production feed details."].some(containsMutationOverclaim)).toBe(false)
  })

  it("never claims Bluesky natively renders rank badges or receipts", () => {
    for (const value of allDemoCopyStrings()) {
      expect(containsNativeUiOverclaim(value), value).toBe(false)
    }

    expect(containsNativeUiOverclaim("Bluesky shows Corgi rank badges."), "forward wording").toBe(true)
    expect(containsNativeUiOverclaim("Rank badges are native Bluesky UI."), "reversed wording").toBe(true)
    expect(containsNativeUiOverclaim("Bluesky shows ordered posts and displays rank badges."), "mixed affirmative wording").toBe(true)
    expect(containsNativeUiOverclaim("Bluesky does not show Corgi rank badges."), "explicit negation").toBe(false)
    expect(containsNativeUiOverclaim("Bluesky doesn't render receipts."), "contracted negation").toBe(false)
    expect(containsNativeUiOverclaim("Ranking cannot be displayed in Bluesky."), "reversed negation").toBe(false)
    expect(containsNativeUiOverclaim("Bluesky: does not show rank badges."), "punctuated negation").toBe(false)
    expect(containsNativeUiOverclaim("Bluesky shows ordered posts, not rank badges."), "scoped negation").toBe(false)
    expect(["Bluesky renders ordered posts.", "Rank receipts live on Corgi."].some(containsNativeUiOverclaim)).toBe(false)
  })
})
