import { normalizeWeights } from "./shadow-demo-fixtures"
import {
  SHADOW_DEMO_SIGNAL_KEYS,
  type ShadowDemoTopicCatalogEntry,
  type ShadowDemoTopicIntent,
  type ShadowDemoWeights,
} from "./shadow-demo-view-model"

function weightSum(weights: ShadowDemoWeights): number {
  return SHADOW_DEMO_SIGNAL_KEYS.reduce((total, key) => total + weights[key], 0)
}

export function getEditedTopicSlugs(
  topicIntent: ShadowDemoTopicIntent,
  presetTopicIntent: ShadowDemoTopicIntent,
  topicCatalog: readonly ShadowDemoTopicCatalogEntry[],
): readonly string[] {
  return topicCatalog
    .filter((topic) => Math.abs(
      (topicIntent.topicWeights[topic.slug] ?? topic.baselineWeight)
      - (presetTopicIntent.topicWeights[topic.slug] ?? topic.baselineWeight),
    ) >= 0.005)
    .map((topic) => topic.slug)
}

export function createDemoVoteSubmission(
  rawWeights: ShadowDemoWeights,
  topicIntent: ShadowDemoTopicIntent,
  topicCatalog: readonly ShadowDemoTopicCatalogEntry[],
): { readonly weights: ShadowDemoWeights; readonly topicIntent: ShadowDemoTopicIntent } {
  for (const key of SHADOW_DEMO_SIGNAL_KEYS) {
    const value = rawWeights[key]
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`Demo vote signal ${key} has invalid weight: ${String(value)}`)
    }
  }
  if (weightSum(rawWeights) <= 0) {
    throw new RangeError("Demo vote signal weights must include at least one positive value")
  }

  const submittedSlugs = Object.keys(topicIntent.topicWeights)
  const catalogSlugs = new Set(topicCatalog.map((topic) => topic.slug))
  if (submittedSlugs.length !== topicCatalog.length
    || submittedSlugs.some((slug) => !catalogSlugs.has(slug))) {
    throw new RangeError(
      `Demo vote topic policy must contain exactly the ${topicCatalog.length} catalog topics`,
    )
  }

  const topicWeights = Object.fromEntries(topicCatalog.map((topic) => {
    const value = topicIntent.topicWeights[topic.slug]
    if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`Demo vote topic ${topic.slug} has invalid weight: ${String(value)}`)
    }
    return [topic.slug, value]
  }))

  return {
    weights: normalizeWeights(rawWeights),
    topicIntent: { topicWeights },
  }
}
