"use client"

import { useMemo, useState } from "react"
import { SlidersHorizontal } from "lucide-react"
import {
  SHADOW_DEMO_SIGNAL_KEYS,
  type ShadowDemoTopicIntent,
  type ShadowDemoWeights,
} from "@/app/demo/shadow-demo-contract"
import {
  DEMO_VOTE_PRESETS,
  SIGNAL_COLORS,
  SIGNAL_LABELS,
  formatPercent,
  normalizeWeights,
} from "@/app/demo/shadow-demo-fixtures"
import { STEP_PANELS } from "@/app/demo/shadow-demo-copy"
import { WeightBars } from "./weight-bars"

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"

function weightSum(weights: ShadowDemoWeights): number {
  return SHADOW_DEMO_SIGNAL_KEYS.reduce((total, key) => total + weights[key], 0)
}

export function VotePanel({
  onSubmit,
  busy,
}: {
  readonly onSubmit: (weights: ShadowDemoWeights, topicIntent: ShadowDemoTopicIntent) => void
  readonly busy: boolean
}) {
  const [presetId, setPresetId] = useState<string>(DEMO_VOTE_PRESETS[0].id)
  const [custom, setCustom] = useState<ShadowDemoWeights | null>(null)
  const [showSliders, setShowSliders] = useState(false)

  const preset = DEMO_VOTE_PRESETS.find((entry) => entry.id === presetId) ?? DEMO_VOTE_PRESETS[0]
  const rawWeights = custom ?? preset.weights
  const sum = weightSum(rawWeights)
  const canSubmit = sum > 0 && !busy
  const previewWeights = useMemo(() => (sum > 0 ? normalizeWeights(rawWeights) : rawWeights), [rawWeights, sum])

  function selectPreset(id: string): void {
    setPresetId(id)
    setCustom(null)
  }

  function setSignal(key: (typeof SHADOW_DEMO_SIGNAL_KEYS)[number], value: number): void {
    setCustom({ ...rawWeights, [key]: value })
  }

  return (
    <div>
      <h2 className="font-display text-2xl font-bold leading-tight text-foreground">{STEP_PANELS.vote.heading}</h2>
      <p className="mt-2 text-sm leading-relaxed text-foreground/60">{STEP_PANELS.vote.body}</p>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {DEMO_VOTE_PRESETS.map((entry) => {
          const active = entry.id === presetId && custom === null
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => selectPreset(entry.id)}
              aria-pressed={active}
              className={`rounded-2xl border px-4 py-3 text-left transition-colors ${FOCUS} ${
                active
                  ? "border-primary/40 bg-primary/[0.075] text-foreground"
                  : "border-border bg-background text-foreground/75 hover:border-primary/25 hover:text-foreground"
              }`}
            >
              <span className="block text-sm font-bold">{entry.label}</span>
              <span className="mt-1 block text-xs leading-relaxed text-foreground/55">{entry.summary}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-5 rounded-2xl border border-border bg-biscuit/30 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-foreground/45">
            {custom === null ? "Preset policy" : "Your custom policy"}
          </p>
          <button
            type="button"
            onClick={() => setShowSliders((value) => !value)}
            aria-expanded={showSliders}
            className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-foreground/70 transition-colors hover:text-foreground ${FOCUS}`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            {showSliders ? "Hide sliders" : "Fine-tune"}
          </button>
        </div>
        <div className="mt-3">
          <WeightBars weights={previewWeights} />
        </div>

        {showSliders ? (
          <div className="mt-4 flex flex-col gap-3 border-t border-border/60 pt-4">
            {SHADOW_DEMO_SIGNAL_KEYS.map((key) => (
              <label key={key} className="grid grid-cols-[104px_minmax(0,1fr)_44px] items-center gap-3">
                <span className="truncate text-xs font-semibold text-foreground/70">{SIGNAL_LABELS[key]}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={rawWeights[key]}
                  onChange={(event) => setSignal(key, Number(event.target.value))}
                  style={{ accentColor: SIGNAL_COLORS[key] }}
                  className={`w-full ${FOCUS}`}
                  aria-label={`${SIGNAL_LABELS[key]} weight`}
                />
                <span className="text-right font-mono text-xs font-semibold text-foreground/55">
                  {formatPercent(previewWeights[key])}
                </span>
              </label>
            ))}
            {sum <= 0 ? (
              <p className="text-xs font-medium text-primary">Give at least one signal some weight to cast a vote.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => onSubmit(normalizeWeights(rawWeights), preset.topicIntent)}
        disabled={!canSubmit}
        className={`mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_rgba(200,97,44,0.25)] transition-colors hover:bg-primary-dark disabled:opacity-60 ${FOCUS}`}
      >
        {busy ? "Casting…" : STEP_PANELS.vote.cta}
      </button>
    </div>
  )
}
