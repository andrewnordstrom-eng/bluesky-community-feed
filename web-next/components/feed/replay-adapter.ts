// Adapts the shared replay model (lib/replay-model.ts, camelCase signals) to the
// CorgiRankBadge's props — so the landing teaser and how-it-works replay render the
// exact same rank badge as the demo, from their own data.

import { signals as SIGNAL_META, type Epoch, type RankedPost } from "@/lib/replay-model"
import type { RankMovementDir, RankSignal } from "./corgi-rank-badge"

/** Per-signal `raw × weight = contribution` breakdown for the badge's "why" receipt. */
export function rankSignalsFor(rankedPost: RankedPost, epoch: Epoch): RankSignal[] {
  return SIGNAL_META.map((signal) => {
    const rawScore = rankedPost.post.scores[signal.key]
    const weight = epoch.weights[signal.key]
    return {
      key: signal.key,
      label: signal.label,
      color: signal.barColor,
      rawScore,
      weight,
      contribution: rawScore * weight,
    }
  })
}

export function badgeMovementFor(
  currentRank: number,
  previousRank: number | undefined,
): { dir: RankMovementDir; delta: number } {
  if (previousRank === undefined) {
    return { dir: "new", delta: 0 }
  }
  if (previousRank === currentRank) {
    return { dir: "held", delta: 0 }
  }
  const delta = previousRank - currentRank
  return { dir: delta > 0 ? "up" : "down", delta: Math.abs(delta) }
}
