"use client"

import { useEffect, useId, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ArrowDown, ArrowUp, ChevronDown, Minus } from "lucide-react"

export interface RankSignal {
  readonly key: string
  readonly label: string
  readonly color: string
  readonly rawScore: number
  readonly weight: number
  readonly contribution: number
}

export type RankMovementDir = "up" | "down" | "new" | "held"

export interface CorgiRankBadgeProps {
  readonly rank: number
  readonly score: number
  readonly movement: { readonly dir: RankMovementDir; readonly delta: number }
  /** Rank in the previous epoch — used to spell out "was #3" in the receipt. */
  readonly previousRank?: number
  readonly signals: readonly RankSignal[]
  /** Short plain-language note on *why* it moved (not the rank math). */
  readonly epochNote?: string
  readonly fullReceiptHref?: string
  /** Hide the movement pill + line when there's no prior epoch to compare against. */
  readonly showMovement?: boolean
  /** Hide the "Why" popover when the surface already shows a full receipt panel (the demo). */
  readonly showWhy?: boolean
  /** For static/mockup screenshots — start expanded. */
  readonly defaultOpen?: boolean
}

/** "Up 2 spots · was #3" — the movement spelled out in words for the receipt + tooltip. */
function movementSummary(
  movement: { readonly dir: RankMovementDir; readonly delta: number },
  previousRank?: number,
): { readonly text: string; readonly tone: string } {
  const spots = movement.delta === 1 ? "spot" : "spots"
  const was = previousRank !== undefined ? ` · was #${previousRank}` : ""
  switch (movement.dir) {
    case "up":
      return { text: `Up ${movement.delta} ${spots}${was}`, tone: "text-success" }
    case "down":
      return { text: `Down ${movement.delta} ${spots}${was}`, tone: "text-[#A5563B]" }
    case "new":
      return { text: "New to the feed this epoch", tone: "text-foreground/55" }
    default:
      return { text: "Held its spot", tone: "text-foreground/55" }
  }
}

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-1 focus-visible:ring-offset-card"

function fmtScore(value: number): string {
  return value.toFixed(3)
}
function fmtPct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function MovementPill({ dir, delta, title }: { readonly dir: RankMovementDir; readonly delta: number; readonly title: string }) {
  const config = {
    up: { cls: "bg-success-bg text-success", icon: <ArrowUp className="h-3 w-3" aria-hidden="true" />, label: `${delta}` },
    down: { cls: "bg-[#F3E3DC] text-[#A5563B]", icon: <ArrowDown className="h-3 w-3" aria-hidden="true" />, label: `${delta}` },
    new: { cls: "bg-biscuit/60 text-foreground/60", icon: null, label: "new" },
    held: { cls: "bg-biscuit/45 text-foreground/55", icon: <Minus className="h-3 w-3" aria-hidden="true" />, label: "held" },
  }[dir]
  return (
    <span
      title={title}
      aria-label={title}
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold leading-none tabular-nums ${config.cls}`}
    >
      {config.icon}
      {config.label}
    </span>
  )
}

export function CorgiRankBadge({
  rank,
  score,
  movement,
  previousRank,
  signals,
  epochNote,
  fullReceiptHref = "/demo",
  showMovement = true,
  showWhy = true,
  defaultOpen = false,
}: CorgiRankBadgeProps) {
  const summary = movementSummary(movement, previousRank)
  const [open, setOpen] = useState(defaultOpen)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const reduce = useReducedMotion() ?? false
  const panelId = useId()

  useEffect(() => {
    if (!open) {
      return
    }
    function onDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const top = [...signals].sort((a, b) => b.contribution - a.contribution).slice(0, 3)

  return (
    <div ref={rootRef} className="relative flex flex-col items-center text-center">
      <span className="font-display text-[32px] font-extrabold leading-[0.8] tracking-tight text-primary sm:text-[42px]">{rank}</span>
      {showMovement ? (
        <span className="mt-1">
          <MovementPill dir={movement.dir} delta={movement.delta} title={summary.text} />
        </span>
      ) : null}
      {showWhy ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className={`group mt-2 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/50 transition-colors hover:text-primary ${FOCUS}`}
        >
          Why
          <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      ) : null}

      <AnimatePresence>
        {open && showWhy ? (
          <motion.div
            id={panelId}
            role="group"
            aria-label={`Why this post ranked #${rank}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: reduce ? 0 : 0.16, ease: "easeOut" }}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-full z-40 mt-2 w-[min(300px,calc(100vw-2rem))] rounded-2xl border border-primary/20 bg-card p-4 text-left shadow-[0_18px_50px_rgba(46,38,32,0.16)]"
          >
            <span className="absolute -top-[7px] right-6 h-3.5 w-3.5 rotate-45 border-l border-t border-primary/20 bg-card" aria-hidden="true" />
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-display text-sm font-bold text-foreground">Why it ranked #{rank}</p>
              <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-primary">
                {fmtScore(score)}
              </span>
            </div>
            {showMovement ? (
              <p className={`mt-1.5 flex items-center gap-1 text-[11px] font-semibold ${summary.tone}`}>
                {movement.dir === "up" ? (
                  <ArrowUp className="h-3 w-3" aria-hidden="true" />
                ) : movement.dir === "down" ? (
                  <ArrowDown className="h-3 w-3" aria-hidden="true" />
                ) : movement.dir === "held" ? (
                  <Minus className="h-3 w-3" aria-hidden="true" />
                ) : null}
                {summary.text}
              </p>
            ) : null}
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/55">raw &times; weight = contribution</p>
            <div className="mt-2.5 flex flex-col gap-1.5">
              {top.map((signal) => (
                <div key={signal.key} className="flex items-center gap-2 text-[12px]">
                  <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: signal.color }} aria-hidden="true" />
                  <span className="whitespace-nowrap text-foreground/75">{signal.label}</span>
                  <span className="ml-auto whitespace-nowrap font-mono text-[11px] tabular-nums text-foreground/55">
                    {signal.rawScore.toFixed(2)} &times; {fmtPct(signal.weight)}
                    <span className="ml-1.5 font-semibold text-primary">= {signal.contribution.toFixed(3)}</span>
                  </span>
                </div>
              ))}
            </div>
            {epochNote ? (
              <p className="mt-2.5 border-t border-border/60 pt-2.5 text-[11px] leading-relaxed text-foreground/55">{epochNote}</p>
            ) : null}
            <a
              href={fullReceiptHref}
              className={`mt-2 inline-flex rounded-md text-[12px] font-semibold text-primary hover:underline ${FOCUS}`}
            >
              See the full receipt &rarr;
            </a>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
