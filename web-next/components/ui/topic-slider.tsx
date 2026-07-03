"use client"

import { useState } from "react"

const NEUTRAL = 0.5   // default "no opinion" position

export interface Topic {
  slug: string
  name: string
  parentSlug: string | null
  currentWeight: number   // community current weight 0–1
}

interface TopicSliderProps {
  topic: Topic
  value: number            // 0–1, 0.5 = neutral
  onChange: (slug: string, value: number) => void
  disabled?: boolean
}

/** Single topic row with diverging tongue→biscuit→sage track. */
export function TopicSlider({ topic, value, onChange, disabled = false }: TopicSliderProps) {
  const [touched, setTouched] = useState(value !== NEUTRAL)
  const isNeutral = Math.abs(value - NEUTRAL) < 0.01

  const pct = Math.round(value * 100)
  const communityPct = Math.round(topic.currentWeight * 100)

  // Diverging semantics: 0–50% = tongue (reduce), 50% = biscuit (neutral), 50–100% = sage (boost)
  const leftPct  = value < NEUTRAL ? (NEUTRAL - value) * 100 * 2 : 0   // tongue side
  const rightPct = value > NEUTRAL ? (value - NEUTRAL) * 100 * 2 : 0   // sage side

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTouched(true)
    onChange(topic.slug, Number(e.target.value) / 100)
  }

  const handleReset = () => {
    setTouched(false)
    onChange(topic.slug, NEUTRAL)
  }

  return (
    <div
      className={`group flex flex-col gap-2.5 py-3 border-b border-border/40 last:border-b-0 transition-all duration-200
        ${disabled ? "opacity-50 pointer-events-none" : ""}`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0 min-w-0">
          <span className={`text-sm font-medium transition-colors ${touched ? "text-foreground" : "text-foreground/60 group-hover:text-foreground/85"}`}>
            {topic.name}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Reset */}
          {touched && !isNeutral && (
            <button
              type="button"
              onClick={handleReset}
              className="text-[10px] font-medium text-foreground/45 hover:text-primary transition-colors underline underline-offset-2"
              aria-label={`Reset ${topic.name} to neutral`}
            >
              Reset
            </button>
          )}
          {/* My value */}
          <span className={`text-xs font-mono font-semibold tabular-nums w-8 text-right transition-colors
            ${value < NEUTRAL - 0.05 ? "text-tongue-foreground" : value > NEUTRAL + 0.05 ? "text-success" : "text-foreground/45"}`}>
            {pct}%
          </span>
        </div>
      </div>

      {/* Diverging track */}
      <div className="relative flex items-center h-5">
        {/* Full biscuit track */}
        <div className="absolute inset-y-0 my-auto h-[10px] w-full rounded-full bg-biscuit" />
        {/* Left (tongue) fill — grows right-to-center */}
        {leftPct > 0 && (
          <div
            className="absolute inset-y-0 my-auto h-[10px] rounded-l-full bg-tongue/55 transition-all duration-200"
            style={{ left: `${50 - leftPct / 2}%`, width: `${leftPct / 2}%` }}
          />
        )}
        {/* Right (sage) fill — grows left-to-right */}
        {rightPct > 0 && (
          <div
            className="absolute inset-y-0 my-auto h-[10px] rounded-r-full bg-success/55 transition-all duration-200"
            style={{ left: "50%", width: `${rightPct / 2}%` }}
          />
        )}
        {/* Centre notch */}
        <div className="absolute inset-y-0 my-auto h-3.5 w-px bg-border/70" style={{ left: "50%" }} aria-hidden="true" />
        {/* Community average marker — thinner, less competing */}
        <div
          className="absolute w-px h-3.5 rounded-full bg-foreground/20 pointer-events-none transition-all"
          style={{ left: `${communityPct}%`, top: "50%", transform: "translateY(-50%)" }}
          title={`Community average: ${communityPct}%`}
          aria-label={`Community average ${communityPct}%`}
        />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          disabled={disabled}
          onChange={handleChange}
          aria-label={topic.name}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-full disabled:cursor-not-allowed"
          style={{ zIndex: 2 }}
        />
        {/* Visible thumb — matched to linked-slider */}
        <div
          className={`absolute w-[18px] h-[18px] rounded-full border-[2.5px] shadow-sm pointer-events-none transition-all duration-200
            ${value < NEUTRAL - 0.05 ? "bg-card border-tongue" : value > NEUTRAL + 0.05 ? "bg-card border-success" : "bg-card border-border"}`}
          style={{ left: `calc(${pct}% - 9px)`, top: "50%", transform: "translateY(-50%)", zIndex: 1 }}
          aria-hidden="true"
        />
      </div>

      {/* Labels + community marker label */}
      <div className="flex items-center justify-between text-[10px] text-foreground/35 font-mono select-none">
        <span className="text-tongue-foreground/60">Reduce</span>
        <span className="flex items-center gap-1">
          <span className="w-0.5 h-2.5 rounded-full bg-foreground/20 inline-block" />
          community avg {communityPct}%
        </span>
        <span className="text-success/70">Boost</span>
      </div>
    </div>
  )
}

/* ─── TopicGroup — renders a collapsible group of topics ── */

interface TopicGroupProps {
  parentSlug: string
  topics: Topic[]
  values: Record<string, number>
  onChangeAll: (slug: string, value: number) => void
  touchedCount: number
  disabled?: boolean
}

export function TopicGroup({ parentSlug, topics, values, onChangeAll, touchedCount, disabled }: TopicGroupProps) {
  const [open, setOpen] = useState(true)

  return (
    <div className="flex flex-col gap-1">
      {/* Group header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between px-1 py-1.5 text-left group"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground/60 uppercase tracking-widest">{parentSlug}</span>
          {touchedCount > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
              {touchedCount} adjusted
            </span>
          )}
        </div>
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none"
          className={`text-foreground/40 transition-transform ${open ? "" : "-rotate-90"}`}
          aria-hidden="true"
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="flex flex-col gap-2">
          {topics.map((topic) => (
            <TopicSlider
              key={topic.slug}
              topic={topic}
              value={values[topic.slug] ?? NEUTRAL}
              onChange={onChangeAll}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  )
}
