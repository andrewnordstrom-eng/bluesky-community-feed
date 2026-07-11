"use client"

import { Check } from "lucide-react"
import { FLOW_STEPS, type FlowStepCopy } from "@/app/demo/shadow-demo-copy"

/** Horizontal stepper. `currentIndex` is the active step; earlier steps are done. */
export function FlowProgress({ currentIndex }: { readonly currentIndex: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-3" aria-label="Demo progress">
      {FLOW_STEPS.map((step: FlowStepCopy, index) => {
        const done = index < currentIndex
        const active = index === currentIndex
        const status = done ? "completed" : active ? "current" : "upcoming"
        return (
          <li
            key={step.key}
            className="flex items-center gap-2"
            aria-label={`${step.label}: ${status}`}
            aria-current={active ? "step" : undefined}
          >
            <span
              className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border text-[11px] font-mono font-bold transition-colors ${
                done
                  ? "border-primary bg-primary text-primary-foreground"
                  : active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-foreground/40"
              }`}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
            </span>
            <span className="flex flex-col leading-none">
              <span className={`text-xs font-semibold ${active || done ? "text-foreground" : "text-foreground/45"}`}>
                {step.label}
              </span>
              <span className="mt-0.5 hidden text-[10px] text-foreground/45 sm:block">{step.hint}</span>
            </span>
            {index < FLOW_STEPS.length - 1 ? (
              <span
                className={`mx-1 hidden h-px w-6 sm:block ${done ? "bg-primary/50" : "bg-border"}`}
                aria-hidden="true"
              />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
