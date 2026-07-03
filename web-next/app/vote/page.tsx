"use client"

import { useState, useRef, useCallback } from "react"
import Link from "next/link"
import { AppShell } from "@/components/app-shell"
import { StatusChip } from "@/components/ui/status-chip"
import { WeightBar } from "@/components/ui/weight-bar"
import { LinkedSlider, type SliderSignal } from "@/components/ui/linked-slider"
import { KeywordInput } from "@/components/ui/keyword-input"
import { TopicGroup } from "@/components/ui/topic-slider"
import { WeightsSkeleton, ErrorCard, EmptyState } from "@/components/ui/state-kit"
import { Button } from "@/components/ui/button"

/* ─── Mock data — exact seam field names from brief ──────── */

const MOCK_EPOCH = {
  id: 47,
  status: "voting",
  phase: "voting",
  vote_count: 312,
  subscriber_count: 480,
  voting_ends_at: "2026-07-01T17:00:00Z",
  weights: {
    recency: 0.35,
    engagement: 0.25,
    bridging: 0.20,
    source_diversity: 0.15,
    relevance: 0.05,
  },
}

const MOCK_MY_VOTE = {
  vote: { recency: 0.3, engagement: 0.3, bridging: 0.2, sourceDiversity: 0.1, relevance: 0.1 },
  contentVote: { includeKeywords: ["ai"], excludeKeywords: ["spam"] },
  topicWeights: { "machine-learning": 0.8 },
  voted_at: "2026-06-26T14:10:00Z",
  epoch_id: 47,
}

const MOCK_TOPICS = [
  { slug: "machine-learning", name: "Machine learning", description: null, parentSlug: "technology", currentWeight: 0.62 },
  { slug: "open-source",      name: "Open source",      description: null, parentSlug: "technology", currentWeight: 0.55 },
  { slug: "climate",          name: "Climate",          description: null, parentSlug: "science",    currentWeight: 0.44 },
  { slug: "research",         name: "Research",         description: null, parentSlug: "science",    currentWeight: 0.50 },
  { slug: "local-news",       name: "Local news",       description: null, parentSlug: "news",       currentWeight: 0.38 },
]

const MOCK_CONTENT_RULES = {
  include_keywords: ["ai"],
  exclude_keywords: ["spam"],
  include_keyword_votes: { ai: 12 },
  exclude_keyword_votes: { spam: 7 },
  total_voters: 312,
  threshold: 0.3,
}

/* ─── Slider signal definitions ────────────────────────────── */

const SIGNAL_META: Record<string, { label: string; description: string }> = {
  recency:          { label: "Recency",          description: "How recently a post was published" },
  engagement:       { label: "Engagement",       description: "Likes, reposts, replies relative to author reach" },
  bridging:         { label: "Bridging",         description: "Posts that connect different community clusters" },
  source_diversity: { label: "Source diversity", description: "Variety of authors and perspectives in the feed" },
  relevance:        { label: "Relevance",        description: "Match to community-selected topics" },
}

type Section = "weights" | "content" | "topics"
type PageState = "loading" | "loaded" | "error"
type SubmitState = "idle" | "submitting" | "success" | "error"

function phaseLabel(phase: string) {
  if (phase === "voting")  return { label: "Voting open",   locked: false }
  if (phase === "review")  return { label: "Under review — voting closed", locked: true }
  if (phase === "running") return { label: "Running — ballot locked",      locked: true }
  return { label: phase, locked: false }
}

function timeUntil(iso: string) {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return "Closed"
  const h = Math.floor(diff / 3_600_000)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h remaining`
  return `${h}h remaining`
}

/* ─── Sub-components ─────────────────────────────────────── */

function SectionTab({ id, active, label, done, onClick }: {
  id: Section; active: boolean; label: string; done: boolean; onClick: () => void
}) {
  const num = { weights: "01", content: "02", topics: "03" }[id]
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-left transition-all
        ${active
          ? "bg-primary/10 text-primary font-semibold"
          : "text-foreground/55 hover:text-foreground hover:bg-biscuit/60"
        }`}
      aria-current={active ? "true" : undefined}
    >
      <span className={`text-xs font-mono flex-shrink-0 ${active ? "text-primary" : "text-foreground/35"}`}>{num}</span>
      <span className="text-sm">{label}</span>
      {done && (
        <span className="ml-auto flex-shrink-0">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-label="Voted" aria-hidden="false">
            <path d="M2 6l3 3 5-5" stroke="hsl(var(--status-success))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </button>
  )
}

function RoundCard({ epoch }: { epoch: typeof MOCK_EPOCH }) {
  const { locked } = phaseLabel(epoch.phase)
  const pct = Math.round((epoch.vote_count / epoch.subscriber_count) * 100)
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-5">
      {/* Page identity lives here, not floating above the grid */}
      <div className="flex flex-col gap-0.5">
        <h1 className="font-display text-xl font-bold text-foreground tracking-normal leading-tight">
          Community ballot
        </h1>
        <p className="text-xs text-foreground/45 leading-relaxed">
          Your votes shape how the feed ranks posts.
        </p>
      </div>

      <div className="h-px bg-border/60" />

      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-foreground/40 font-mono uppercase tracking-widest">Round</span>
          <span className="text-2xl font-mono font-bold text-foreground leading-none">#{epoch.id}</span>
        </div>
        <StatusChip phase={epoch.phase} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-foreground/50">{epoch.vote_count.toLocaleString()} of {epoch.subscriber_count.toLocaleString()} voted</span>
          <span className="font-mono text-foreground/60">{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-biscuit overflow-hidden">
          <div className="h-1.5 rounded-full bg-primary/70 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {locked ? (
        <div className="rounded-lg bg-biscuit px-3 py-2.5 text-xs text-foreground/55 leading-relaxed">
          Voting is closed for this round. Results are being tallied.
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-foreground/40 font-mono uppercase tracking-widest">Closes</span>
          <span className="text-xs font-mono text-primary font-semibold">{timeUntil(epoch.voting_ends_at)}</span>
        </div>
      )}
    </div>
  )
}

function SubmitRow({
  label,
  state,
  votedAt,
  onSubmit,
  disabled,
}: {
  label: string
  state: SubmitState
  votedAt?: string | null
  onSubmit: () => void
  disabled: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 pt-4 border-t border-border/60">
      <div className="flex flex-col gap-0.5">
        {votedAt && state !== "success" && (
          <span className="text-xs text-foreground/40 font-mono">
            Last voted {new Date(votedAt).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        {state === "success" && (
          <span className="text-xs text-success font-semibold flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Saved
          </span>
        )}
        {state === "error" && (
          <span className="text-xs text-status-error font-semibold">Failed to save — try again</span>
        )}
      </div>
      <Button
        onClick={onSubmit}
        disabled={disabled || state === "submitting"}
        className="bg-primary text-primary-foreground hover:bg-primary-dark rounded-full px-5 text-sm shadow-[0_2px_8px_rgba(200,97,44,0.3)] hover:shadow-[0_4px_14px_rgba(200,97,44,0.4)] transition-all disabled:opacity-40"
      >
        {state === "submitting" ? (
          <span className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground animate-spin" />
            Saving…
          </span>
        ) : (
          label
        )}
      </Button>
    </div>
  )
}

/* ─── Page ───────────────────────────────────────────────── */

export default function VotePage() {
  const [pageState] = useState<PageState>("loaded")
  const [activeSection, setActiveSection] = useState<Section>("weights")

  // Weight signals state
  const epoch = MOCK_EPOCH
  const { locked } = phaseLabel(epoch.phase)

  const [signals, setSignals] = useState<SliderSignal[]>([
    { key: "recency",          value: MOCK_MY_VOTE.vote.recency,         ...SIGNAL_META["recency"] },
    { key: "engagement",       value: MOCK_MY_VOTE.vote.engagement,      ...SIGNAL_META["engagement"] },
    { key: "bridging",         value: MOCK_MY_VOTE.vote.bridging,        ...SIGNAL_META["bridging"] },
    { key: "source_diversity", value: MOCK_MY_VOTE.vote.sourceDiversity, ...SIGNAL_META["source_diversity"] },
    { key: "relevance",        value: MOCK_MY_VOTE.vote.relevance,       ...SIGNAL_META["relevance"] },
  ])
  const [lastMoved, setLastMoved] = useState<string | null>(null)
  const prevSignalValues = useRef<Record<string, number>>(
    Object.fromEntries(signals.map((s) => [s.key, s.value]))
  )
  const [weightSubmit, setWeightSubmit] = useState<SubmitState>("idle")

  // Content vote state
  const [includeKeywords, setIncludeKeywords] = useState<string[]>(MOCK_MY_VOTE.contentVote.includeKeywords)
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>(MOCK_MY_VOTE.contentVote.excludeKeywords)
  const [contentSubmit, setContentSubmit] = useState<SubmitState>("idle")

  // Topic state
  const [topicValues, setTopicValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    MOCK_TOPICS.forEach((t) => { init[t.slug] = MOCK_MY_VOTE.topicWeights[t.slug as keyof typeof MOCK_MY_VOTE.topicWeights] ?? 0.5 })
    return init
  })
  const [topicSubmit, setTopicSubmit] = useState<SubmitState>("idle")

  // Running weights for the right rail (community weights from epoch)
  const communityWeights = epoch.weights

  const handleSignalChange = useCallback((updated: SliderSignal[]) => {
    const moved = updated.find((u, i) => Math.abs(u.value - signals[i].value) > 0.001)
    if (moved) {
      prevSignalValues.current = Object.fromEntries(signals.map((s) => [s.key, s.value]))
      setLastMoved(moved.key)
    }
    setSignals(updated)
    setWeightSubmit("idle")
  }, [signals])

  const mockSubmit = (setter: (s: SubmitState) => void) => {
    setter("submitting")
    setTimeout(() => setter("success"), 1200)
  }

  // Group topics by parentSlug
  const topicGroups = MOCK_TOPICS.reduce<Record<string, typeof MOCK_TOPICS>>((acc, t) => {
    const key = t.parentSlug ?? "other"
    ;(acc[key] = acc[key] ?? []).push(t)
    return acc
  }, {})

  const touchedTopicCount = Object.entries(topicValues).filter(
    ([, v]) => Math.abs(v - 0.5) > 0.01
  ).length

  if (pageState === "loading") {
    return (
      <AppShell user={null}>
        <div className="max-w-6xl mx-auto px-5 py-10">
          <WeightsSkeleton />
        </div>
      </AppShell>
    )
  }

  if (pageState === "error") {
    return (
      <AppShell user={null}>
        <div className="max-w-xl mx-auto px-5 py-20">
          <ErrorCard heading="Ballot unavailable" body="We couldn't load the current voting round. Try again in a moment." />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell user={{ handle: "maya.bsky.social", did: "did:plc:abc123" }}>
      <div className="max-w-6xl mx-auto px-5 py-8 flex flex-col gap-6">

        {/* ── 3-column workbench ───────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_240px] gap-6 items-start">

          {/* ── LEFT RAIL ─────────────────────────────────── */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
            <RoundCard epoch={epoch} />

            {/* Section nav — flat list, no card chrome */}
            <nav className="flex flex-col gap-0.5 px-1" aria-label="Ballot sections">
              <SectionTab id="weights" active={activeSection === "weights"} label="Ranking weights"   done={weightSubmit === "success"} onClick={() => setActiveSection("weights")} />
              <SectionTab id="content" active={activeSection === "content"} label="Content rules"      done={contentSubmit === "success"} onClick={() => setActiveSection("content")} />
              <SectionTab id="topics"  active={activeSection === "topics"}  label="Topic preferences"  done={topicSubmit === "success"}  onClick={() => setActiveSection("topics")} />
            </nav>

            {/* Back to overview */}
            <Link href="/dashboard" className="text-xs text-foreground/40 hover:text-foreground/70 transition-colors text-center">
              ← Back to overview
            </Link>
          </aside>

          {/* ── CENTER ───────────────────────────���────────── */}
          <main className="flex flex-col gap-6 min-w-0">

            {/* ── Section 01: Ranking weights ─────────────── */}
            {activeSection === "weights" && (
              <div className="rounded-xl border border-border bg-card p-6 flex flex-col gap-6">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-mono text-foreground/35 uppercase tracking-widest">01 — Ranking weights</span>
                  <h2 className="text-lg font-semibold text-foreground leading-snug">Signal weights</h2>
                  <p className="text-sm text-foreground/50 leading-relaxed">
                    Drag to allocate importance across the five signals. Adjusting one redistributes the rest — they always sum to 100%.
                  </p>
                </div>

                {locked ? (
                  <div className="flex flex-col gap-4">
                    {signals.map((sig) => (
                      <WeightBar key={sig.key} label={sig.label} value={sig.value} />
                    ))}
                    <p className="text-xs text-foreground/40 italic">Ballot locked — your vote from this round is shown above.</p>
                  </div>
                ) : (
                  <LinkedSlider
                    signals={signals}
                    onChange={handleSignalChange}
                    lastMoved={lastMoved}
                    prevValues={prevSignalValues.current}
                    disabled={locked}
                  />
                )}

                <SubmitRow
                  label="Submit weight vote"
                  state={weightSubmit}
                  votedAt={MOCK_MY_VOTE.voted_at}
                  onSubmit={() => mockSubmit(setWeightSubmit)}
                  disabled={locked}
                />
              </div>
            )}

            {/* ── Section 02: Content rules ────────────────── */}
            {activeSection === "content" && (
              <div className="rounded-xl border border-border bg-card p-6 flex flex-col gap-6">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-mono text-foreground/35 uppercase tracking-widest">02 — Content rules</span>
                  <h2 className="text-lg font-semibold text-foreground leading-snug">Keywords</h2>
                  <p className="text-sm text-foreground/50 leading-relaxed">
                    Vote on which keywords to boost or suppress. Keywords reaching {Math.round(MOCK_CONTENT_RULES.threshold * 100)}% community support take effect.
                  </p>
                </div>

                <div className="flex flex-col gap-5">
                  <KeywordInput
                    label="Include keywords"
                    keywords={includeKeywords}
                    variant="include"
                    onChange={setIncludeKeywords}
                    disabled={locked}
                    communityVotes={MOCK_CONTENT_RULES.include_keyword_votes}
                    totalVoters={MOCK_CONTENT_RULES.total_voters}
                  />
                  <KeywordInput
                    label="Exclude keywords"
                    keywords={excludeKeywords}
                    variant="exclude"
                    onChange={setExcludeKeywords}
                    disabled={locked}
                    communityVotes={MOCK_CONTENT_RULES.exclude_keyword_votes}
                    totalVoters={MOCK_CONTENT_RULES.total_voters}
                  />
                </div>

                {/* Community rules context */}
                <div className="rounded-lg bg-biscuit/50 border border-border/60 px-4 py-3 flex flex-col gap-1">
                  <p className="text-xs font-semibold text-foreground/55 uppercase tracking-wide">Active community rules</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {MOCK_CONTENT_RULES.include_keywords.map((w) => (
                      <span key={w} className="text-xs font-mono px-2 py-0.5 rounded-full bg-success/10 border border-success/25 text-success">+{w}</span>
                    ))}
                    {MOCK_CONTENT_RULES.exclude_keywords.map((w) => (
                      <span key={w} className="text-xs font-mono px-2 py-0.5 rounded-full bg-tongue/15 border border-tongue/30 text-tongue-foreground line-through">−{w}</span>
                    ))}
                    {MOCK_CONTENT_RULES.include_keywords.length === 0 && MOCK_CONTENT_RULES.exclude_keywords.length === 0 && (
                      <span className="text-xs text-foreground/40 italic">No active rules yet</span>
                    )}
                  </div>
                </div>

                <SubmitRow
                  label="Submit content vote"
                  state={contentSubmit}
                  votedAt={MOCK_MY_VOTE.voted_at}
                  onSubmit={() => mockSubmit(setContentSubmit)}
                  disabled={locked}
                />
              </div>
            )}

            {/* ── Section 03: Topic preferences ───────────── */}
            {activeSection === "topics" && (
              <div className="rounded-xl border border-border bg-card p-6 flex flex-col gap-6">
                <div className="flex flex-col gap-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-mono text-foreground/35 uppercase tracking-widest">03 — Topic preferences</span>
                      <h2 className="text-lg font-semibold text-foreground leading-snug">Topics</h2>
                      <p className="text-sm text-foreground/50 leading-relaxed">
                        Slide right to boost a topic, left to reduce it. The vertical marker shows the community average.
                      </p>
                    </div>
                    {touchedTopicCount > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const reset: Record<string, number> = {}
                          MOCK_TOPICS.forEach((t) => { reset[t.slug] = 0.5 })
                          setTopicValues(reset)
                        }}
                        className="text-xs text-foreground/40 hover:text-primary transition-colors underline underline-offset-2 flex-shrink-0 mt-1"
                      >
                        Reset all
                      </button>
                    )}
                  </div>
                </div>

                {MOCK_TOPICS.length === 0 ? (
                  <EmptyState
                    heading="No topics configured"
                    body="The community hasn't set up topic categories for this round yet."
                    showCorgi={false}
                  />
                ) : (
                  <div className="flex flex-col gap-5">
                    {Object.entries(topicGroups).map(([parent, topics]) => (
                      <TopicGroup
                        key={parent}
                        parentSlug={parent}
                        topics={topics}
                        values={topicValues}
                        onChangeAll={(slug, val) => {
                          setTopicValues((prev) => ({ ...prev, [slug]: val }))
                          setTopicSubmit("idle")
                        }}
                        touchedCount={topics.filter((t) => Math.abs((topicValues[t.slug] ?? 0.5) - 0.5) > 0.01).length}
                        disabled={locked}
                      />
                    ))}
                  </div>
                )}

                <SubmitRow
                  label="Submit topic vote"
                  state={topicSubmit}
                  votedAt={MOCK_MY_VOTE.voted_at}
                  onSubmit={() => mockSubmit(setTopicSubmit)}
                  disabled={locked}
                />
              </div>
            )}

          </main>

          {/* ── RIGHT RAIL ────────────────────────────────── */}
          <aside className="hidden lg:flex flex-col gap-0 lg:sticky lg:top-20 rounded-xl border border-border bg-card overflow-hidden">

            {/* Running community weights */}
            <div className="p-5 flex flex-col gap-3">
              <p className="text-[10px] text-foreground/40 font-mono uppercase tracking-widest">Live weights · Round #{epoch.id}</p>
              <div className="flex flex-col gap-3">
                {Object.entries(communityWeights).map(([key, val]) => (
                  <WeightBar key={key} label={SIGNAL_META[key]?.label ?? key} value={val} size="sm" />
                ))}
              </div>
            </div>

            <div className="h-px bg-border/60 mx-5" />

            {/* Active content filters summary */}
            <div className="p-5 flex flex-col gap-2.5">
              <p className="text-[10px] text-foreground/40 font-mono uppercase tracking-widest">Active filters</p>
              {MOCK_CONTENT_RULES.include_keywords.length === 0 && MOCK_CONTENT_RULES.exclude_keywords.length === 0 ? (
                <p className="text-xs text-foreground/35">None this round</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {MOCK_CONTENT_RULES.include_keywords.map((w) => (
                    <span key={w} className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-success/10 border border-success/25 text-success">+{w}</span>
                  ))}
                  {MOCK_CONTENT_RULES.exclude_keywords.map((w) => (
                    <span key={w} className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-tongue/15 border border-tongue/30 text-tongue-foreground">−{w}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="h-px bg-border/60 mx-5" />

            {/* Participation — quiet, not a callout */}
            <div className="p-5 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground/50">{epoch.vote_count.toLocaleString()} of {epoch.subscriber_count.toLocaleString()} voted</span>
                <span className="font-mono text-foreground/60">{Math.round((epoch.vote_count / epoch.subscriber_count) * 100)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-biscuit overflow-hidden">
                <div
                  className="h-1.5 rounded-full bg-primary/70 transition-all"
                  style={{ width: `${Math.round((epoch.vote_count / epoch.subscriber_count) * 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-foreground/40 leading-relaxed">
                Each vote counts equally.
              </p>
            </div>

          </aside>
        </div>
      </div>
    </AppShell>
  )
}
