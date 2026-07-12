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
import {
  createDemoVoteSubmission,
  getEditedTopicSlugs,
} from "@/app/demo/shadow-demo-vote-policy"
import { Slider } from "@/components/ui/slider"
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

function singleSliderValue(values: readonly number[], label: string): number {
  const value = values[0]
  if (values.length !== 1 || value === undefined || !Number.isFinite(value)) {
    throw new RangeError(`${label} slider produced an invalid value: ${JSON.stringify(values)}`)
  }
  return value
}

function formatPointDelta(value: number): string {
  const points = Math.round(value * 100)
  return `${points > 0 ? "+" : ""}${points} pp`
}

function PolicySlider({
  label,
  ariaLabel,
  value,
  displayValue,
  accentColor,
  detail,
  changed,
  onChange,
}: {
  readonly label: string
  readonly ariaLabel: string
  readonly value: number
  readonly displayValue: number
  readonly accentColor: string
  readonly detail: string | null
  readonly changed: boolean
  readonly onChange: (value: number) => void
}) {
  const percent = formatPercent(displayValue)
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_58px] items-center gap-x-3 rounded-lg px-2 py-1 transition-colors sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)_58px] ${changed ? "bg-primary/[0.07]" : "bg-transparent"}`}>
      <span className="col-start-1 row-start-1 min-w-0 text-xs font-semibold leading-tight text-foreground/70">{label}</span>
      <Slider
        min={0}
        max={1}
        step={0.01}
        value={[value]}
        onValueChange={(values) => onChange(singleSliderValue(values, ariaLabel))}
        accentColor={accentColor}
        ariaLabel={ariaLabel}
        ariaValueText={`${percent}${detail === null ? "" : `, ${detail}`}`}
        className="col-span-2 col-start-1 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1"
      />
      <span className="col-start-2 row-start-1 text-right font-mono text-xs font-semibold leading-tight text-foreground/60 sm:col-start-3">
        <span className="block">{percent}</span>
        {detail === null ? null : (
          <span className="mt-0.5 block text-[9px] font-medium text-primary">{detail}</span>
        )}
      </span>
    </div>
  )
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
  const presetTopicIntent = useMemo(
    () => mergeTopicPolicy(baselineTopicIntent, preset.topicIntent),
    [baselineTopicIntent, preset.topicIntent],
  )
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
  const editedTopicSlugs = useMemo(
    () => getEditedTopicSlugs(topicIntent, presetTopicIntent, topicCatalog),
    [presetTopicIntent, topicCatalog, topicIntent],
  )
  const editedTopicSlugSet = useMemo(() => new Set(editedTopicSlugs), [editedTopicSlugs])
  const editedSignalKeys = SHADOW_DEMO_SIGNAL_KEYS.filter(
    (key) => Math.abs(rawWeights[key] - preset.weights[key]) >= 0.005,
  )
  const customPolicy = editedSignalKeys.length > 0 || editedTopicSlugs.length > 0
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
            const active = entry.id === presetId && !customPolicy
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
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-foreground/45">{customPolicy ? "Your custom policy" : "Preset policy"}</p>
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
                <div className="mt-4 flex flex-col gap-1">
                  {SHADOW_DEMO_SIGNAL_KEYS.map((key) => (
                    <PolicySlider
                      key={key}
                      label={SIGNAL_LABELS[key]}
                      ariaLabel={`${SIGNAL_LABELS[key]} weight`}
                      value={rawWeights[key]}
                      displayValue={previewWeights[key]}
                      accentColor={SIGNAL_COLORS[key]}
                      detail={null}
                      changed={editedSignalKeys.includes(key)}
                      onChange={(value) => setSignal(key, value)}
                    />
                  ))}
                  {sum <= 0 ? <p className="text-xs font-medium text-primary">Give at least one signal some weight to cast a vote.</p> : null}
                </div>
              ) : (
                <div className="mt-4">
                  <div className="mb-3 flex items-start justify-between gap-4 text-xs leading-relaxed text-foreground/55">
                    <p>Topic weights shape the relevance signal. Every ballot carries all {topicCatalog.length} values.</p>
                    <p className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
                      {editedTopicSlugs.length === 0 ? "Preset unchanged" : `${editedTopicSlugs.length} fine-tuned`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="relative min-w-[180px] flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/40" aria-hidden="true" />
                      <input value={topicQuery} onChange={(event) => setTopicQuery(event.target.value)} placeholder="Search topics" aria-label="Search topics" className={`h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-xs ${FOCUS}`} />
                    </label>
                    <select value={topicSort} onChange={(event) => setTopicSort(event.target.value as "alphabetical" | "weight")} className={`h-10 rounded-lg border border-border bg-background px-3 text-xs ${FOCUS}`} aria-label="Sort topics">
                      <option value="weight">Current weight</option><option value="alphabetical">Alphabetical</option>
                    </select>
                    <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground/70">
                      <input type="checkbox" checked={changedOnly} onChange={(event) => setChangedOnly(event.target.checked)} aria-label="Show topics different from live policy" />Different from live
                    </label>
                    <button type="button" onClick={resetTopics} className={`inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground/70 ${FOCUS}`}>
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Reset preset
                    </button>
                  </div>
                  <div className="mt-3 grid gap-y-1">
                    {visibleTopics.map((topic) => {
                      const value = topicIntent.topicWeights[topic.slug] ?? topic.baselineWeight
                      const presetValue = presetTopicIntent.topicWeights[topic.slug] ?? topic.baselineWeight
                      const edited = editedTopicSlugSet.has(topic.slug)
                      return (
                        <PolicySlider
                          key={topic.slug}
                          label={topicLabel(topic.slug, topicCatalog)}
                          ariaLabel={`${topic.name} topic weight`}
                          value={value}
                          displayValue={value}
                          accentColor="hsl(var(--primary))"
                          detail={edited ? formatPointDelta(value - presetValue) : null}
                          changed={edited}
                          onChange={(nextValue) => setTopic(topic.slug, nextValue)}
                        />
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
        <button type="button" onClick={() => {
          const submission = createDemoVoteSubmission(rawWeights, topicIntent, topicCatalog)
          onSubmit(submission.weights, submission.topicIntent)
        }} disabled={!canSubmit}
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
