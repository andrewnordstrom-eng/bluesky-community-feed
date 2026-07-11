import { SIGNAL_KEYS } from "./signals"

export function hasCompleteScoreComponents(components: unknown): boolean {
  if (typeof components !== "object" || components === null || Array.isArray(components)) return false
  const componentRecord = components as Record<string, unknown>
  return SIGNAL_KEYS.every((key) => {
    const component = componentRecord[key]
    if (typeof component !== "object" || component === null) return false
    const values = component as Record<string, unknown>
    return typeof values.raw_score === "number" && Number.isFinite(values.raw_score)
      && typeof values.weight === "number" && Number.isFinite(values.weight)
      && typeof values.weighted === "number" && Number.isFinite(values.weighted)
  })
}
