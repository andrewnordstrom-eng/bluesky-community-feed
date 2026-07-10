"use client"

import { motion, useReducedMotion } from "framer-motion"
import { SHADOW_DEMO_SIGNAL_KEYS, type ShadowDemoWeights } from "@/app/demo/shadow-demo-contract"
import { SIGNAL_COLORS, SIGNAL_LABELS, formatPercent } from "@/app/demo/shadow-demo-fixtures"

/** The five-signal weight display used across the demo (aggregate policy, votes). */
export function WeightBars({
  weights,
  className,
}: {
  readonly weights: ShadowDemoWeights
  readonly className?: string
}) {
  const shouldReduce = useReducedMotion() ?? false

  return (
    <div className={`flex flex-col gap-2.5 ${className ?? ""}`}>
      {SHADOW_DEMO_SIGNAL_KEYS.map((key) => (
        <div key={key} className="grid grid-cols-[104px_minmax(0,1fr)_44px] items-center gap-3">
          <span className="truncate text-xs font-semibold text-foreground/70">{SIGNAL_LABELS[key]}</span>
          <div className="h-2 overflow-hidden rounded-full bg-border/60">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: SIGNAL_COLORS[key] }}
              initial={false}
              animate={{ width: formatPercent(weights[key]) }}
              transition={shouldReduce ? { duration: 0 } : { duration: 0.3, ease: "easeOut" }}
            />
          </div>
          <span className="text-right font-mono text-xs font-semibold text-foreground/55">
            {formatPercent(weights[key])}
          </span>
        </div>
      ))}
    </div>
  )
}
