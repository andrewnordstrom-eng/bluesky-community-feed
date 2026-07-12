import { formatPercent, normalizeWeights } from "./shadow-demo-fixtures"
import {
  SHADOW_DEMO_SIGNAL_KEYS,
  type ShadowDemoTopicCatalogEntry,
  type ShadowDemoTopicIntent,
  type ShadowDemoWeights,
} from "./shadow-demo-view-model"

export const POLICY_EDIT_THRESHOLD = 0.005

export type DemoVoteSubmission = {
  readonly weights: ShadowDemoWeights
  readonly topicIntent: ShadowDemoTopicIntent
}

export type DemoVoteSubmissionValidation =
  | { readonly valid: true; readonly submission: DemoVoteSubmission }
  | { readonly valid: false; readonly reason: string }

function weightSum(weights: ShadowDemoWeights): number {
  return SHADOW_DEMO_SIGNAL_KEYS.reduce((total, key) => total + weights[key], 0)
}

export function formatPolicySliderValue(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Policy slider has invalid value: ${String(value)}`)
  }
  return formatPercent(value)
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
    ) >= POLICY_EDIT_THRESHOLD)
    .map((topic) => topic.slug)
}

export function validateDemoVoteSubmission(
  rawWeights: ShadowDemoWeights,
  topicIntent: ShadowDemoTopicIntent,
  topicCatalog: readonly ShadowDemoTopicCatalogEntry[],
): DemoVoteSubmissionValidation {
  for (const key of SHADOW_DEMO_SIGNAL_KEYS) {
    const value = rawWeights[key]
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      return { valid: false, reason: `Demo vote signal ${key} has invalid weight: ${String(value)}` }
    }
  }
  if (weightSum(rawWeights) <= 0) {
    return { valid: false, reason: "Demo vote signal weights must include at least one positive value" }
  }

  const submittedSlugs = Object.keys(topicIntent.topicWeights)
  const catalogSlugs = new Set(topicCatalog.map((topic) => topic.slug))
  if (submittedSlugs.length !== topicCatalog.length
    || submittedSlugs.some((slug) => !catalogSlugs.has(slug))) {
    return {
      valid: false,
      reason: `Demo vote topic policy must contain exactly the ${topicCatalog.length} catalog topics`,
    }
  }

  const topicWeights: Record<string, number> = {}
  for (const topic of topicCatalog) {
    const value = topicIntent.topicWeights[topic.slug]
    if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) {
      return {
        valid: false,
        reason: `Demo vote topic ${topic.slug} has invalid weight: ${String(value)}`,
      }
    }
    topicWeights[topic.slug] = value
  }

  return {
    valid: true,
    submission: {
      weights: normalizeWeights(rawWeights),
      topicIntent: { topicWeights },
    },
  }
}

export function createDemoVoteSubmission(
  rawWeights: ShadowDemoWeights,
  topicIntent: ShadowDemoTopicIntent,
  topicCatalog: readonly ShadowDemoTopicCatalogEntry[],
): DemoVoteSubmission {
  const validation = validateDemoVoteSubmission(rawWeights, topicIntent, topicCatalog)
  if (!validation.valid) {
    throw new RangeError(validation.reason)
  }
  return validation.submission
}
