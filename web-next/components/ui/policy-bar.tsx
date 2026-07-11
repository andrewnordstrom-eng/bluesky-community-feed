/**
 * PolicyBar — the five ranking signals rendered as one horizontal stacked bar.
 * This is the signature governance visual: the whole community policy read at a
 * glance, in the warm signal palette. Pair with `PolicyLegend` for the numbers.
 *
 * Colors + order come from `lib/signals` so every governance surface (dashboard,
 * vote, proposals) speaks the same language. Do not hardcode signal colors.
 */

import { SIGNAL_COLORS, SIGNAL_KEYS, SIGNAL_LABELS, type SignalKey } from "@/lib/signals"

type Weights = Partial<Record<SignalKey, number>>

export function normalizePolicyWeight(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

const pct = (value: number) => `${Math.round(normalizePolicyWeight(value) * 100)}%`
const widthPct = (value: number) => `${normalizePolicyWeight(value) * 100}%`

export function PolicyBar({
  weights,
  height = 12,
  className = "",
}: {
  readonly weights: Weights
  readonly height?: number
  readonly className?: string
}) {
  return (
    <div
      className={`flex w-full overflow-hidden rounded-full ${className}`}
      style={{ height }}
      role="img"
      aria-label="Community signal weight mix"
    >
      {SIGNAL_KEYS.map((k) => {
        const w = normalizePolicyWeight(weights[k] ?? 0)
        if (w <= 0) return null
        return (
          <div
            key={k}
            style={{ width: widthPct(w), backgroundColor: SIGNAL_COLORS[k] }}
            title={`${SIGNAL_LABELS[k]} ${pct(w)}`}
          />
        )
      })}
    </div>
  )
}

export function PolicyLegend({
  weights,
  className = "",
}: {
  readonly weights: Weights
  readonly className?: string
}) {
  return (
    <div className={`flex flex-wrap gap-x-4 gap-y-1.5 ${className}`}>
      {SIGNAL_KEYS.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5 text-[12px]">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SIGNAL_COLORS[k] }} aria-hidden="true" />
          <span className="text-foreground/60">{SIGNAL_LABELS[k]}</span>
          <span className="font-mono font-semibold tabular-nums text-foreground/80">{pct(weights[k] ?? 0)}</span>
        </span>
      ))}
    </div>
  )
}
