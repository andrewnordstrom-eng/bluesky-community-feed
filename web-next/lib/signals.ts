/**
 * Canonical governance/demo signal palette.
 *
 * Keys are snake_case to match the governance API (`EpochResponse.weights`) and
 * the demo contract (`SHADOW_DEMO_SIGNAL_KEYS`). Colors are the warm-harmonized
 * set — earthy hues that live in Corgi's cream/ginger world, NOT a generic
 * blue/purple/emerald set.
 *
 * This is the single source for every governance + demo surface (dashboard,
 * vote, proposals, the demo). The replay surfaces (teaser, how-it-works) use the
 * camelCase mirror in `lib/replay-model.ts` (`signals[].barColor`) because they
 * key on camelCase; keep the two hex sets identical. See docs/design-system.md.
 */

export type SignalKey = "recency" | "engagement" | "bridging" | "source_diversity" | "relevance"

/** Canonical render order — used by every stacked bar and legend. */
export const SIGNAL_KEYS: readonly SignalKey[] = [
  "recency",
  "engagement",
  "bridging",
  "source_diversity",
  "relevance",
]

export const SIGNAL_LABELS: Record<SignalKey, string> = {
  recency: "Recency",
  engagement: "Engagement",
  bridging: "Bridging",
  source_diversity: "Source diversity",
  relevance: "Relevance",
}

/** Terse labels for tight surfaces (native feed rails, chips). */
export const SIGNAL_SHORT_LABELS: Record<SignalKey, string> = {
  recency: "Fresh",
  engagement: "Likes",
  bridging: "Bridge",
  source_diversity: "Diverse",
  relevance: "Match",
}

export const SIGNAL_COLORS: Record<SignalKey, string> = {
  recency: "#6E93B8", // dusty slate-blue
  engagement: "#BC4B3E", // brick-red
  bridging: "#9B6F94", // muted plum
  source_diversity: "#7A9A5E", // sage-olive
  relevance: "#C8612C", // ginger (= --primary)
}
