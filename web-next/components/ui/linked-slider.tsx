"use client"

import { useCallback, useId } from "react"
import { SIGNAL_COLORS, type SignalKey } from "@/lib/signals"

export interface SliderSignal {
  key: string
  label: string
  value: number      // 0–1; always sum to 1 across all signals
  description: string
}

interface LinkedSliderProps {
  signals: SliderSignal[]
  onChange: (updated: SliderSignal[]) => void
  /** Which slider keys were touched in the last interaction (for delta badges) */
  lastMoved: string | null
  prevValues: Record<string, number>
  /** Current community-aggregated weights (0–1 per key) — drawn as a marker on
   *  each track so a voter can see how their draft compares to consensus. */
  communityValues?: Record<string, number>
  disabled?: boolean
}

const signalColor = (key: string) => SIGNAL_COLORS[key as SignalKey] ?? "hsl(var(--primary))"

/**
 * LinkedSlider — 5 signals that always sum to 100%.
 * Dragging one signal redistributes the remaining weight
 * proportionally across the untouched signals.
 */
export function LinkedSlider({
  signals,
  onChange,
  lastMoved,
  prevValues,
  communityValues,
  disabled = false,
}: LinkedSliderProps) {
  const descriptionIdPrefix = useId()
  const total = signals.reduce((s, sig) => s + sig.value, 0)
  const totalPct = Math.round(total * 100)
  const isValid = Math.abs(total - 1) < 0.001

  const rebalance = useCallback(
    (changedKey: string, newValue: number) => {
      const clamped = Math.min(1, Math.max(0, newValue))
      const others = signals.filter((s) => s.key !== changedKey)
      const otherSum = others.reduce((s, o) => s + o.value, 0)
      const remaining = 1 - clamped

      let updated: SliderSignal[]
      if (otherSum === 0) {
        // edge case: all others are 0 — split evenly
        const even = remaining / others.length
        updated = signals.map((s) =>
          s.key === changedKey ? { ...s, value: clamped } : { ...s, value: even }
        )
      } else {
        // redistribute proportionally
        updated = signals.map((s) => {
          if (s.key === changedKey) return { ...s, value: clamped }
          return { ...s, value: (s.value / otherSum) * remaining }
        })
      }
      onChange(updated)
    },
    [signals, onChange]
  )

  return (
    <div className={`flex flex-col gap-5 ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      {signals.map((sig) => {
        const pct = Math.round(sig.value * 100)
        const prev = prevValues[sig.key] ?? sig.value
        const delta = sig.key !== lastMoved ? sig.value - prev : 0
        const hasDelta = Math.abs(delta) > 0.005
        const color = signalColor(sig.key)
        const communityPct =
          communityValues?.[sig.key] != null ? Math.round(communityValues[sig.key] * 100) : null
        const communityDescriptionId = communityPct === null ? undefined : `${descriptionIdPrefix}-${sig.key}`

        return (
          <div key={sig.key} className="flex flex-col gap-2">
            {/* Label row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-0">
                <span className="text-sm font-medium text-foreground">{sig.label}</span>
                <span className="text-xs text-foreground/40 leading-tight">{sig.description}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {hasDelta && (
                  <span
                    className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded transition-all
                      ${delta > 0 ? "bg-success/10 text-success" : "bg-tongue/15 text-tongue-foreground"}`}
                  >
                    {delta > 0 ? "+" : ""}{(delta * 100).toFixed(0)}pp
                  </span>
                )}
                <span className="text-sm font-mono font-semibold text-foreground tabular-nums w-9 text-right">
                  {pct}%
                </span>
              </div>
            </div>

            {/* Track + thumb — proportionally matched, in the signal's color */}
            <div className="relative flex items-center h-5">
              <div className="absolute inset-y-0 my-auto h-[10px] w-full rounded-full bg-biscuit" />
              <div
                className="absolute inset-y-0 my-auto h-[10px] rounded-full transition-all duration-200"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
              {/* Community-average marker — vote relative to consensus */}
              {communityPct != null && (
                <div
                  className="absolute inset-y-0 my-auto flex items-center"
                  style={{ left: `calc(${communityPct}% - 1px)` }}
                  aria-hidden="true"
                >
                  <span className="pointer-events-none h-[18px] w-0.5 rounded-full bg-foreground/45" />
                </div>
              )}
              {communityDescriptionId ? (
                <span id={communityDescriptionId} className="sr-only">Community average {communityPct}%</span>
              ) : null}
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={pct}
                disabled={disabled}
                aria-label={sig.label}
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-describedby={communityDescriptionId}
                onChange={(e) => rebalance(sig.key, Number(e.target.value) / 100)}
                className="absolute inset-0 w-full opacity-0 cursor-pointer h-full disabled:cursor-not-allowed"
                style={{ zIndex: 2 }}
              />
              {/* Thumb — slightly smaller than track height so it overlaps cleanly */}
              <div
                className="absolute w-[18px] h-[18px] rounded-full bg-card border-[2.5px] shadow-sm pointer-events-none transition-all duration-200"
                style={{ left: `calc(${pct}% - 9px)`, top: "50%", transform: "translateY(-50%)", zIndex: 1, borderColor: color }}
                aria-hidden="true"
              />
            </div>
          </div>
        )
      })}

      {/* Total pill — sits at the end of the signal list, not floating above it */}
      <div className="flex items-center justify-end pt-1 border-t border-border/50">
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-semibold border transition-colors
            ${isValid
              ? "bg-success/10 text-success border-success/20"
              : "bg-tongue/15 text-tongue-foreground border-tongue/30"
            }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isValid ? "bg-success" : "bg-tongue"}`} aria-hidden="true" />
          Total {totalPct}%
        </span>
      </div>
    </div>
  )
}
