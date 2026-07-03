"use client"

/** WeightBar — labeled horizontal % bar.
 *  Ginger fill on biscuit track. Width is clamped 0–100% per brief.
 */
interface WeightBarProps {
  label: string
  value: number          // 0–1 (will be displayed as %)
  /** If true, fill uses tongue-pink (penalty signal) */
  negative?: boolean
  /** Size of the label text and bar height */
  size?: "sm" | "md"
  className?: string
}

export function WeightBar({ label, value, negative = false, size = "md", className }: WeightBarProps) {
  // Clamp 0–1 per brief ("data can produce out-of-range values; never let a bar overflow")
  const pct = Math.min(100, Math.max(0, value * 100))

  const barHeight = size === "sm" ? "h-1.5" : "h-2"
  const labelSize = size === "sm" ? "text-xs" : "text-sm"
  const valueSize = size === "sm" ? "text-xs" : "text-sm"

  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-3">
        <span className={`${labelSize} font-medium text-foreground/80`}>{label}</span>
        <span className={`${valueSize} font-mono text-foreground tabular-nums`}>
          {pct.toFixed(0)}%
        </span>
      </div>
      {/* Track */}
      <div className={`w-full ${barHeight} rounded-full bg-biscuit overflow-hidden`}>
        <div
          className={`${barHeight} rounded-full transition-all duration-500 ${negative ? "bg-tongue" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        />
      </div>
    </div>
  )
}
