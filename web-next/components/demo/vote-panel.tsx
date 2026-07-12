"use client"

import { useMemo, useState } from "react"
import { RotateCcw, Search, SlidersHorizontal } from "lucide-react"
import {
  SHADOW_DEMO_SIGNAL_KEYS,
  type ShadowDemoTopicCatalogEntry,
  type ShadowDemoTopicIntent,
  type ShadowDemoWeights,
} from "@/app/demo/shadow-demo-view-model"
import {
  DEMO_VOTE_PRESETS,
  SIGNAL_COLORS,
  SIGNAL_LABELS,
  formatPercent,
  normalizeWeights,
} from "@/app/demo/shadow-demo-fixtures"
import { STEP_PANELS } from "@/app/demo/shadow-demo-copy"
import { TopicPolicy, topicLabel } from "./topic-policy"
import { WeightBars } from "./weight-bars"

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"

function weightSum(weights: ShadowDemoWeights): number {
  return SHADOW_DEMO_SIGNAL_KEYS.reduce((total, key) => total + weights[key], 0)
}

function mergeTopicPolicy(
  baseline: ShadowDemoTopicIntent,
  overrides: ShadowDemoTopicIntent,
): ShadowDemoTopicIntent {
  return { topicWeights: { ...baseline.topicWeights, ...overrides.topicWeights } }
}

export function VotePanel({
  onSubmit,
  busy,
  topicCatalog,
  baselineTopicIntent,
}: {
  readonly onSubmit: (weights: ShadowDemoWeights, topicIntent: ShadowDemoTopicIntent) => void
  readonly busy: boolean
  readonly topicCatalog: readonly ShadowDemoTopicCatalogEntry[]
  readonly baselineTopicIntent: ShadowDemoTopicIntent
}) {
  const [presetId, setPresetId] = useState<string>(DEMO_VOTE_PRESETS[0].id)
  const [custom, setCustom] = useState<ShadowDemoWeights | null>(null)
  const [topicIntent, setTopicIntent] = useState<ShadowDemoTopicIntent>(() =>
    mergeTopicPolicy(baselineTopicIntent, DEMO_VOTE_PRESETS[0].topicIntent))
  const [showFineTune, setShowFineTune] = useState(false)
  const [fineTuneTab, setFineTuneTab] = useState<"signals" | "topics">("signals")
  const [topicQuery, setTopicQuery] = useState("")
  const [topicSort, setTopicSort] = useState<"alphabetical" | "weight">("weight")
  const [changedOnly, setChangedOnly] = useState(false)

  const preset = DEMO_VOTE_PRESETS.find((entry) => entry.id === presetId) ?? DEMO_VOTE_PRESETS[0]
  const rawWeights = custom ?? preset.weights
  const sum = weightSum(rawWeights)
  const topicSlugs = new Set(topicCatalog.map((topic) => topic.slug))
  const submittedTopicSlugs = Object.keys(topicIntent.topicWeights)
  const topicMismatch = submittedTopicSlugs.length !== topicCatalog.length
    || submittedTopicSlugs.some((slug) => !topicSlugs.has(slug))
  const canSubmit = sum > 0
    && !busy
    && !topicMismatch
  const previewWeights = useMemo(() => (sum > 0 ? normalizeWeights(rawWeights) : rawWeights), [rawWeights, sum])
  const visibleTopics = useMemo(() => topicCatalog
    .filter((topic) => topic.name.toLowerCase().includes(topicQuery.toLowerCase()) || topic.slug.includes(topicQuery.toLowerCase()))
    .filter((topic) => !changedOnly || Math.abs((topicIntent.topicWeights[topic.slug] ?? topic.baselineWeight) - topic.baselineWeight) >= 0.005)
    .sort((left, right) => topicSort === "alphabetical"
      ? left.name.localeCompare(right.name)
      : (topicIntent.topicWeights[right.slug] ?? right.baselineWeight) - (topicIntent.topicWeights[left.slug] ?? left.baselineWeight)),
  [changedOnly, topicCatalog, topicIntent.topicWeights, topicQuery, topicSort])

  function selectPreset(id: string): void {
    const next = DEMO_VOTE_PRESETS.find((entry) => entry.id === id)
    if (next === undefined) return
    setPresetId(id)
    setCustom(null)
    setTopicIntent(mergeTopicPolicy(baselineTopicIntent, next.topicIntent))
  }

  function setSignal(key: (typeof SHADOW_DEMO_SIGNAL_KEYS)[number], value: number): void {
    setCustom({ ...rawWeights, [key]: value })
  }

  function setTopic(slug: string, value: number): void {
    setTopicIntent({ topicWeights: { ...topicIntent.topicWeights, [slug]: value } })
  }

  function resetTopics(): void {
    setTopicIntent(mergeTopicPolicy(baselineTopicIntent, preset.topicIntent))
  }

  return (
    <div className="xl:flex xl:max-h-[calc(100dvh-7rem)] xl:min-h-0 xl:flex-col">
      <div
        role="region"
        aria-label="Demo policy controls"
        className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain xl:pr-2 xl:[scrollbar-gutter:stable]"
      >
        <h2 className="font-display text-2xl font-bold leading-tight text-foreground">{STEP_PANELS.vote.heading}</h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/60">{STEP_PANELS.vote.body}</p>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {DEMO_VOTE_PRESETS.map((entry) => {
            const active = entry.id === presetId && custom === null
            return (
              <button key={entry.id} type="button" onClick={() => selectPreset(entry.id)} aria-pressed={active}
                className={`rounded-2xl border px-4 py-3 text-left transition-colors ${FOCUS} ${active ? "border-primary/40 bg-primary/[0.075] text-foreground" : "border-border bg-background text-foreground/75 hover:border-primary/25 hover:text-foreground"}`}>
                <span className="block text-sm font-bold">{entry.label}</span>
                <span className="mt-1 block text-xs leading-relaxed text-foreground/55">{entry.summary}</span>
              </button>
            )
          })}
        </div>

        <div className="mt-5 rounded-2xl border border-border bg-biscuit/30 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-foreground/55">{custom === null ? "Preset policy" : "Your custom policy"}</p>
            <button type="button" onClick={() => setShowFineTune((value) => !value)} aria-expanded={showFineTune}
              className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-foreground/70 transition-colors hover:text-foreground ${FOCUS}`}>
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              {showFineTune ? "Close fine-tune" : "Fine-tune"}
            </button>
          </div>
          <div className="mt-3"><WeightBars weights={previewWeights} /></div>
          <div className="mt-4 border-t border-border/60 pt-4">
            <TopicPolicy topicIntent={topicIntent} baselineTopicIntent={baselineTopicIntent} catalog={topicCatalog} label={`Topic priorities · ${topicCatalog.length} available`} />
          </div>

          {showFineTune ? (
            <div className="mt-4 border-t border-border/60 pt-4">
              <div className="grid grid-cols-2 rounded-lg border border-border bg-background p-1">
                <button type="button" onClick={() => setFineTuneTab("signals")} aria-pressed={fineTuneTab === "signals"}
                  className={`min-h-10 rounded-md px-3 text-xs font-semibold ${FOCUS} ${fineTuneTab === "signals" ? "bg-biscuit/60 text-foreground" : "text-foreground/60"}`}>Signals (5)</button>
                <button type="button" onClick={() => setFineTuneTab("topics")} aria-pressed={fineTuneTab === "topics"}
                  className={`min-h-10 rounded-md px-3 text-xs font-semibold ${FOCUS} ${fineTuneTab === "topics" ? "bg-biscuit/60 text-foreground" : "text-foreground/60"}`}>Topics ({topicCatalog.length})</button>
              </div>

              {fineTuneTab === "signals" ? (
                <div className="mt-4 flex flex-col gap-3">
                  {SHADOW_DEMO_SIGNAL_KEYS.map((key) => (
                    <label key={key} className="grid grid-cols-[104px_minmax(0,1fr)_44px] items-center gap-3">
                      <span className="truncate text-xs font-semibold text-foreground/70">{SIGNAL_LABELS[key]}</span>
                      <input type="range" min={0} max={1} step={0.01} value={rawWeights[key]} onChange={(event) => setSignal(key, Number(event.target.value))}
                        style={{ accentColor: SIGNAL_COLORS[key] }} className={`w-full ${FOCUS}`} aria-label={`${SIGNAL_LABELS[key]} weight`} />
                      <span className="text-right font-mono text-xs font-semibold text-foreground/55">{formatPercent(previewWeights[key])}</span>
                    </label>
                  ))}
                  {sum <= 0 ? <p className="text-xs font-medium text-primary">Give at least one signal some weight to cast a vote.</p> : null}
                </div>
              ) : (
                <div className="mt-4">
                  <div className="flex flex-wrap gap-2">
                    <label className="relative min-w-[180px] flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/50" aria-hidden="true" />
                      <input value={topicQuery} onChange={(event) => setTopicQuery(event.target.value)} placeholder="Search topics" aria-label="Search topics" className={`h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-xs ${FOCUS}`} />
                    </label>
                    <select value={topicSort} onChange={(event) => setTopicSort(event.target.value as "alphabetical" | "weight")} className={`h-10 rounded-lg border border-border bg-background px-3 text-xs ${FOCUS}`} aria-label="Sort topics">
                      <option value="weight">Current weight</option><option value="alphabetical">Alphabetical</option>
                    </select>
                    <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground/70">
                      <input type="checkbox" checked={changedOnly} onChange={(event) => setChangedOnly(event.target.checked)} />Changed only
                    </label>
                    <button type="button" onClick={resetTopics} className={`inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground/70 ${FOCUS}`}>
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Reset
                    </button>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {visibleTopics.map((topic) => {
                      const value = topicIntent.topicWeights[topic.slug] ?? topic.baselineWeight
                      return (
                        <label key={topic.slug} className="rounded-lg border border-border/70 bg-background px-3 py-2.5">
                          <span className="flex items-center justify-between gap-2 text-xs"><span className="font-semibold text-foreground/75">{topicLabel(topic.slug, topicCatalog)}</span><span className="font-mono text-foreground/55">{formatPercent(value)}</span></span>
                          <input type="range" min={0} max={1} step={0.01} value={value} onChange={(event) => setTopic(topic.slug, Number(event.target.value))} className={`mt-2 w-full ${FOCUS}`} aria-label={`${topic.name} topic weight`} />
                        </label>
                      )
                    })}
                  </div>
                  {visibleTopics.length === 0 ? <p className="mt-4 text-xs text-foreground/55">No topics match these filters.</p> : null}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-5 xl:mt-3 xl:shrink-0 xl:border-t xl:border-border/70 xl:bg-background xl:pt-3">
        <button type="button" onClick={() => onSubmit(normalizeWeights(rawWeights), topicIntent)} disabled={!canSubmit}
          className={`inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_rgba(200,97,44,0.25)] transition-colors hover:bg-primary-dark disabled:opacity-60 ${FOCUS}`}>
          {busy ? "Casting…" : STEP_PANELS.vote.cta}
        </button>
        {topicMismatch ? (
          <p className="mt-2 text-xs font-medium text-primary" role="alert">
            This snapshot&apos;s complete topic policy is unavailable. Start a new demo session to continue.
          </p>
        ) : null}
      </div>
    </div>
  )
}
