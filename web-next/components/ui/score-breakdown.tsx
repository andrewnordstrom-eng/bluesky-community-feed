"use client"

import { WeightBar } from "./weight-bar"
import { SIGNAL_COLORS, SIGNAL_LABELS, type SignalKey } from "@/lib/signals"

export interface ScoreComponent {
  key: SignalKey
  label: string
  raw_score: number    // 0–1
  weight: number       // 0–1
  weighted: number     // raw_score × weight
}

interface ScoreBreakdownProps {
  components: readonly ScoreComponent[]
  total_score: number
  /** Context label shown in footer */
  epochLabel?: string
  className?: string
}

export function ScoreBreakdown({ components, total_score, epochLabel, className }: ScoreBreakdownProps) {
  // Clamp total to guard against the total_score===0 edge-case noted in the brief
  const displayTotal = Math.max(0, total_score)

  return (
    <div className={`flex flex-col ${className ?? ""}`}>
      {/* Column headers */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border">
        <span className="flex-1 text-xs font-semibold text-foreground/45 uppercase tracking-wide">Signal</span>
        <span className="w-24 text-right text-xs font-semibold text-foreground/45 uppercase tracking-wide hidden sm:block">Raw</span>
        <span className="w-16 text-right text-xs font-semibold text-foreground/45 uppercase tracking-wide hidden sm:block">Weight</span>
        <span className="w-20 text-right text-xs font-semibold text-foreground/45 uppercase tracking-wide">Score</span>
      </div>

      {/* Component rows */}
      {components.map((c) => {
        const isNegative = c.weighted < 0
        const label = SIGNAL_LABELS[c.key]
        // bar width = weighted contribution as a fraction of total (clamped)
        const barValue = displayTotal > 0 ? Math.max(0, c.weighted) / displayTotal : 0

        return (
          <div key={c.key} className="flex items-center gap-3 px-4 py-3 border-b border-border/60 last:border-b-0">
            <div className="flex-1 flex flex-col gap-1 min-w-0">
              <span className="text-sm font-medium text-foreground">{label}</span>
              <WeightBar
                label=""
                value={barValue}
                negative={isNegative}
                color={SIGNAL_COLORS[c.key]}
                size="sm"
              />
            </div>
            <span className="w-24 text-right text-xs font-mono text-foreground/55 hidden sm:block tabular-nums">
              {(c.raw_score * 100).toFixed(0)}%
            </span>
            <span className="w-16 text-right text-xs font-mono text-foreground/55 hidden sm:block tabular-nums">
              ×{(c.weight * 100).toFixed(0)}%
            </span>
            <span className={`w-20 text-right text-sm font-mono font-semibold tabular-nums ${isNegative ? "text-tongue" : "text-foreground"}`}>
              {isNegative ? "" : "+"}{c.weighted.toFixed(3)}
            </span>
          </div>
        )
      })}

      {/* Footer: total + attribution */}
      <div className="flex items-center justify-between px-4 py-3 bg-biscuit/40 rounded-b-xl mt-px">
        <span className="text-xs text-foreground/50 italic">
          {epochLabel ?? "Weighted by community vote"}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground/60">Total</span>
          <span className="text-base font-bold font-mono text-foreground tabular-nums">
            {displayTotal.toFixed(3)}
          </span>
        </div>
      </div>
    </div>
  )
}
