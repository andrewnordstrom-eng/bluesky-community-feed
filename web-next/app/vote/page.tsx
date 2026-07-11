"use client"

import { useCallback, useRef, useState } from "react"
import Link from "next/link"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { AppShell } from "@/components/app-shell"
import { Container } from "@/components/ui/layout"
import { SignInDialog } from "@/components/sign-in-dialog"
import { useAuth } from "@/components/auth-provider"
import { StatusChip } from "@/components/ui/status-chip"
import { PolicyBar, PolicyLegend } from "@/components/ui/policy-bar"
import { LinkedSlider, type SliderSignal } from "@/components/ui/linked-slider"
import { KeywordInput } from "@/components/ui/keyword-input"
import { TopicGroup } from "@/components/ui/topic-slider"
import { WeightsSkeleton, ErrorCard, EmptyState } from "@/components/ui/state-kit"
import { Button } from "@/components/ui/button"
import {
  voteApi,
  weightsApi,
  type EpochResponse,
  type GetVoteResponse,
  type TopicCatalogEntry,
  type ContentRulesResponse,
} from "@/lib/api/client"

/* ─── Slider signal definitions ────────────────────────────── */

const SIGNAL_META: Record<string, { label: string; description: string }> = {
  recency:          { label: "Recency",          description: "How recently a post was published" },
  engagement:       { label: "Engagement",       description: "Likes, reposts, replies relative to author reach" },
  bridging:         { label: "Bridging",         description: "Posts that connect different community clusters" },
  source_diversity: { label: "Source diversity", description: "Variety of authors and perspectives in the feed" },
  relevance:        { label: "Relevance",        description: "Match to community-selected topics" },
}

type Section = "weights" | "content" | "topics"
type SubmitState = "idle" | "submitting" | "success" | "error"

/** Map a react-query mutation's flags to the SubmitRow visual state. */
function submitStateOf(m: { isPending: boolean; isSuccess: boolean; isError: boolean }): SubmitState {
  if (m.isPending) return "submitting"
  if (m.isSuccess) return "success"
  if (m.isError) return "error"
  return "idle"
}

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
      <span className={`text-xs font-mono flex-shrink-0 ${active ? "text-primary" : "text-foreground/45"}`}>{num}</span>
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

function RoundCard({ epoch }: { epoch: EpochResponse }) {
  const phase = epoch.phase ?? epoch.status
  const { locked } = phaseLabel(phase)
  const denom = epoch.subscriber_count ?? 0
  const pct = denom > 0 ? Math.round((epoch.vote_count / denom) * 100) : 0
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
        <StatusChip phase={phase} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-foreground/50">{epoch.vote_count.toLocaleString()} of {denom.toLocaleString()} voted</span>
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
      ) : epoch.voting_ends_at ? (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-foreground/40 font-mono uppercase tracking-widest">Closes</span>
          <span className="text-xs font-mono text-primary font-semibold">{timeUntil(epoch.voting_ends_at)}</span>
        </div>
      ) : null}
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

/* ─── Loaded ballot workbench ─────────────────────────────── */

interface VoteWorkbenchProps {
  epoch: EpochResponse
  /** The signed-in user's existing vote, if any (undefined when unauthenticated). */
  myVote?: GetVoteResponse
  topics: TopicCatalogEntry[]
  /** Community content rules; undefined when unavailable (e.g. no active epoch). */
  contentRules?: ContentRulesResponse
  isAuthenticated: boolean
  onRequireAuth: () => void
}

function VoteWorkbench({ epoch, myVote, topics, contentRules, isAuthenticated, onRequireAuth }: VoteWorkbenchProps) {
  const queryClient = useQueryClient()
  const phase = epoch.phase ?? epoch.status
  const { locked } = phaseLabel(phase)

  const [activeSection, setActiveSection] = useState<Section>("weights")

  // Seed the weight sliders from the user's existing vote, falling back to the
  // current community weights. (Both shapes sum to 1.)
  const seedVote = myVote?.vote
  const initialSignalValues: Record<string, number> = seedVote
    ? {
        recency: seedVote.recency,
        engagement: seedVote.engagement,
        bridging: seedVote.bridging,
        source_diversity: seedVote.sourceDiversity,
        relevance: seedVote.relevance,
      }
    : {
        recency: epoch.weights.recency,
        engagement: epoch.weights.engagement,
        bridging: epoch.weights.bridging,
        source_diversity: epoch.weights.source_diversity,
        relevance: epoch.weights.relevance,
      }

  const [signals, setSignals] = useState<SliderSignal[]>(
    ["recency", "engagement", "bridging", "source_diversity", "relevance"].map((key) => ({
      key,
      value: initialSignalValues[key] ?? 0,
      ...SIGNAL_META[key],
    }))
  )
  const [lastMoved, setLastMoved] = useState<string | null>(null)
  const prevSignalValues = useRef<Record<string, number>>(
    Object.fromEntries(signals.map((s) => [s.key, s.value]))
  )

  // Content vote state (seeded from the user's existing content vote).
  const [includeKeywords, setIncludeKeywords] = useState<string[]>(myVote?.contentVote?.includeKeywords ?? [])
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>(myVote?.contentVote?.excludeKeywords ?? [])

  // Topic state (seeded from the user's per-topic weights, else neutral 0.5).
  const [topicValues, setTopicValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    topics.forEach((t) => { init[t.slug] = myVote?.topicWeights?.[t.slug] ?? 0.5 })
    return init
  })

  const communityWeights = epoch.weights
  const myWeights: Record<string, number> = Object.fromEntries(signals.map((s) => [s.key, s.value]))
  const rules = contentRules ?? {
    epoch_id: epoch.id,
    include_keywords: [],
    exclude_keywords: [],
    include_keyword_votes: {},
    exclude_keyword_votes: {},
    total_voters: 0,
    threshold: 0,
  }

  const invalidateVote = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["vote", "mine"] })
    queryClient.invalidateQueries({ queryKey: ["epoch", "current"] })
    queryClient.invalidateQueries({ queryKey: ["content-rules"] })
    queryClient.invalidateQueries({ queryKey: ["topics"] })
  }, [queryClient])

  const weightsMutation = useMutation({
    mutationFn: () => {
      const vals = Object.fromEntries(signals.map((s) => [s.key, s.value]))
      return voteApi.submitVote({
        recency: vals.recency,
        engagement: vals.engagement,
        bridging: vals.bridging,
        sourceDiversity: vals.source_diversity,
        relevance: vals.relevance,
      })
    },
    onSuccess: invalidateVote,
  })

  const contentMutation = useMutation({
    mutationFn: () => voteApi.submitVote(null, { includeKeywords, excludeKeywords }),
    onSuccess: invalidateVote,
  })

  const topicsMutation = useMutation({
    mutationFn: () => voteApi.submitVote(null, undefined, topicValues),
    onSuccess: invalidateVote,
  })

  const handleSignalChange = useCallback((updated: SliderSignal[]) => {
    const moved = updated.find((u, i) => Math.abs(u.value - signals[i].value) > 0.001)
    if (moved) {
      prevSignalValues.current = Object.fromEntries(signals.map((s) => [s.key, s.value]))
      setLastMoved(moved.key)
    }
    setSignals(updated)
    weightsMutation.reset()
  }, [signals, weightsMutation])

  const submitWeights = () => {
    if (!isAuthenticated) { onRequireAuth(); return }
    weightsMutation.mutate()
  }
  const submitContent = () => {
    if (!isAuthenticated) { onRequireAuth(); return }
    contentMutation.mutate()
  }
  const submitTopics = () => {
    if (!isAuthenticated) { onRequireAuth(); return }
    topicsMutation.mutate()
  }

  // Group topics by parentSlug
  const topicGroups = topics.reduce<Record<string, TopicCatalogEntry[]>>((acc, t) => {
    const key = t.parentSlug ?? "other"
    ;(acc[key] = acc[key] ?? []).push(t)
    return acc
  }, {})

  const touchedTopicCount = Object.entries(topicValues).filter(
    ([, v]) => Math.abs(v - 0.5) > 0.01
  ).length

  const participationPct = (epoch.subscriber_count ?? 0) > 0
    ? Math.round((epoch.vote_count / (epoch.subscriber_count ?? 1)) * 100)
    : 0

  return (
    <Container width="content" className="py-8 flex flex-col gap-6">

      {/* ── 3-column workbench ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_240px] gap-6 items-start">

        {/* ── LEFT RAIL ─────────────────────────────────── */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
          <RoundCard epoch={epoch} />

          {/* Section nav — flat list, no card chrome */}
          <nav className="flex flex-col gap-0.5 px-1" aria-label="Ballot sections">
            <SectionTab id="weights" active={activeSection === "weights"} label="Ranking weights"   done={weightsMutation.isSuccess} onClick={() => setActiveSection("weights")} />
            <SectionTab id="content" active={activeSection === "content"} label="Content rules"      done={contentMutation.isSuccess} onClick={() => setActiveSection("content")} />
            <SectionTab id="topics"  active={activeSection === "topics"}  label="Topic preferences"  done={topicsMutation.isSuccess}  onClick={() => setActiveSection("topics")} />
          </nav>

          {/* Back to overview */}
          <Link href="/dashboard" className="text-xs text-foreground/40 hover:text-foreground/70 transition-colors text-center">
            ← Back to overview
          </Link>
        </aside>

        {/* ── CENTER ─────────────────────────────────────── */}
        <main className="flex flex-col gap-6 min-w-0">

          {/* ── Section 01: Ranking weights ─────────────── */}
          {activeSection === "weights" && (
            <div className="rounded-xl border border-border bg-card p-6 flex flex-col gap-6">
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-mono text-foreground/45 uppercase tracking-widest">01 — Ranking weights</span>
                <h2 className="text-lg font-semibold text-foreground leading-snug">Signal weights</h2>
                <p className="text-sm text-foreground/50 leading-relaxed">
                  Drag to allocate importance across the five signals. Adjusting one redistributes the rest — they
                  always sum to 100%. The thin marker on each track is the community&rsquo;s current average.
                </p>
              </div>

              {locked ? (
                <div className="flex flex-col gap-3">
                  <PolicyBar weights={myWeights} height={12} />
                  <PolicyLegend weights={myWeights} />
                  <p className="text-xs text-foreground/40 italic pt-1">
                    {seedVote
                      ? "Ballot locked — your submitted vote for this round is shown above."
                      : "Ballot locked — no vote was submitted; the community weights are shown above."}
                  </p>
                </div>
              ) : (
                <LinkedSlider
                  signals={signals}
                  onChange={handleSignalChange}
                  lastMoved={lastMoved}
                  prevValues={prevSignalValues.current}
                  communityValues={communityWeights}
                  disabled={locked}
                />
              )}

              <SubmitRow
                label="Submit weight vote"
                state={submitStateOf(weightsMutation)}
                votedAt={myVote?.voted_at}
                onSubmit={submitWeights}
                disabled={locked}
              />
            </div>
          )}

          {/* ── Section 02: Content rules ────────────────── */}
          {activeSection === "content" && (
            <div className="rounded-xl border border-border bg-card p-6 flex flex-col gap-6">
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-mono text-foreground/45 uppercase tracking-widest">02 — Content rules</span>
                <h2 className="text-lg font-semibold text-foreground leading-snug">Keywords</h2>
                <p className="text-sm text-foreground/50 leading-relaxed">
                  Vote on which keywords to boost or suppress. Keywords reaching {Math.round(rules.threshold * 100)}% community support take effect.
                </p>
              </div>

              <div className="flex flex-col gap-5">
                <KeywordInput
                  label="Include keywords"
                  keywords={includeKeywords}
                  variant="include"
                  onChange={(next) => { setIncludeKeywords(next); contentMutation.reset() }}
                  disabled={locked}
                  communityVotes={rules.include_keyword_votes}
                  totalVoters={rules.total_voters}
                />
                <KeywordInput
                  label="Exclude keywords"
                  keywords={excludeKeywords}
                  variant="exclude"
                  onChange={(next) => { setExcludeKeywords(next); contentMutation.reset() }}
                  disabled={locked}
                  communityVotes={rules.exclude_keyword_votes}
                  totalVoters={rules.total_voters}
                />
              </div>

              {/* Community rules context */}
              <div className="rounded-lg bg-biscuit/50 border border-border/60 px-4 py-3 flex flex-col gap-1">
                <p className="text-xs font-semibold text-foreground/55 uppercase tracking-wide">Active community rules</p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {rules.include_keywords.map((w) => (
                    <span key={w} className="text-xs font-mono px-2 py-0.5 rounded-full bg-success/10 border border-success/25 text-success">+{w}</span>
                  ))}
                  {rules.exclude_keywords.map((w) => (
                    <span key={w} className="text-xs font-mono px-2 py-0.5 rounded-full bg-tongue/15 border border-tongue/30 text-tongue-foreground line-through">−{w}</span>
                  ))}
                  {rules.include_keywords.length === 0 && rules.exclude_keywords.length === 0 && (
                    <span className="text-xs text-foreground/40 italic">No active rules yet</span>
                  )}
                </div>
              </div>

              <SubmitRow
                label="Submit content vote"
                state={submitStateOf(contentMutation)}
                votedAt={myVote?.voted_at}
                onSubmit={submitContent}
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
                    <span className="text-[10px] font-mono text-foreground/45 uppercase tracking-widest">03 — Topic preferences</span>
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
                        topics.forEach((t) => { reset[t.slug] = 0.5 })
                        setTopicValues(reset)
                        topicsMutation.reset()
                      }}
                      className="text-xs text-foreground/40 hover:text-primary transition-colors underline underline-offset-2 flex-shrink-0 mt-1"
                    >
                      Reset all
                    </button>
                  )}
                </div>
              </div>

              {topics.length === 0 ? (
                <EmptyState
                  heading="No topics configured"
                  body="The community hasn't set up topic categories for this round yet."
                  showCorgi={false}
                />
              ) : (
                <div className="flex flex-col gap-5">
                  {Object.entries(topicGroups).map(([parent, groupTopics]) => (
                    <TopicGroup
                      key={parent}
                      parentSlug={parent}
                      topics={groupTopics}
                      values={topicValues}
                      onChangeAll={(slug, val) => {
                        setTopicValues((prev) => ({ ...prev, [slug]: val }))
                        topicsMutation.reset()
                      }}
                      touchedCount={groupTopics.filter((t) => Math.abs((topicValues[t.slug] ?? 0.5) - 0.5) > 0.01).length}
                      disabled={locked}
                    />
                  ))}
                </div>
              )}

              <SubmitRow
                label="Submit topic vote"
                state={submitStateOf(topicsMutation)}
                votedAt={myVote?.voted_at}
                onSubmit={submitTopics}
                disabled={locked}
              />
            </div>
          )}

        </main>

        {/* ── RIGHT RAIL ────────────────────────────────── */}
        <aside className="hidden lg:flex flex-col gap-0 lg:sticky lg:top-20 rounded-xl border border-border bg-card overflow-hidden">

          {/* Running community weights — the signature stacked bar */}
          <div className="p-5 flex flex-col gap-3">
            <p className="text-[10px] text-foreground/40 font-mono uppercase tracking-widest">Community mix · Round #{epoch.id}</p>
            <PolicyBar weights={communityWeights} height={10} />
            <PolicyLegend weights={communityWeights} />
          </div>

          <div className="h-px bg-border/60 mx-5" />

          {/* Active content filters summary */}
          <div className="p-5 flex flex-col gap-2.5">
            <p className="text-[10px] text-foreground/40 font-mono uppercase tracking-widest">Active filters</p>
            {rules.include_keywords.length === 0 && rules.exclude_keywords.length === 0 ? (
              <p className="text-xs text-foreground/45">None this round</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {rules.include_keywords.map((w) => (
                  <span key={w} className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-success/10 border border-success/25 text-success">+{w}</span>
                ))}
                {rules.exclude_keywords.map((w) => (
                  <span key={w} className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-tongue/15 border border-tongue/30 text-tongue-foreground">−{w}</span>
                ))}
              </div>
            )}
          </div>

          <div className="h-px bg-border/60 mx-5" />

          {/* Participation — quiet, not a callout */}
          <div className="p-5 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground/50">{epoch.vote_count.toLocaleString()} of {(epoch.subscriber_count ?? 0).toLocaleString()} voted</span>
              <span className="font-mono text-foreground/60">{participationPct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-biscuit overflow-hidden">
              <div
                className="h-1.5 rounded-full bg-primary/70 transition-all"
                style={{ width: `${participationPct}%` }}
              />
            </div>
            <p className="text-[10px] text-foreground/40 leading-relaxed">
              Each vote counts equally.
            </p>
          </div>

        </aside>
      </div>
    </Container>
  )
}

/* ─── Page ───────────────────────────────────────────────── */

export default function VotePage() {
  const { isAuthenticated } = useAuth()
  const [signInOpen, setSignInOpen] = useState(false)

  const epochQuery = useQuery({
    queryKey: ["epoch", "current"],
    queryFn: weightsApi.getCurrentEpoch,
    retry: false,
  })
  const activeEpochId = epochQuery.data?.id ?? null
  const topicsQuery = useQuery({
    queryKey: ["topics"],
    queryFn: voteApi.getTopicCatalog,
    retry: false,
  })
  const contentRulesQuery = useQuery({
    queryKey: ["content-rules", activeEpochId],
    queryFn: voteApi.getContentRules,
    enabled: activeEpochId !== null,
    retry: false,
  })
  const myVoteQuery = useQuery({
    queryKey: ["vote", "mine", activeEpochId],
    queryFn: voteApi.getVote,
    enabled: isAuthenticated && activeEpochId !== null,
    retry: false,
  })

  // The ballot round is the gating resource; the supporting queries (topics,
  // rules, my vote) are seeded into the workbench once all have settled so its
  // interactive state initialises synchronously and correctly.
  const coreLoading =
    epochQuery.isLoading ||
    topicsQuery.isLoading ||
    contentRulesQuery.isLoading ||
    (isAuthenticated && myVoteQuery.isLoading)

  let content: React.ReactNode
  if (coreLoading) {
    content = (
      <Container className="py-10">
        <WeightsSkeleton />
      </Container>
    )
  } else if (epochQuery.isError || !epochQuery.data) {
    content = (
      <Container width="narrow" className="py-20">
        <ErrorCard
          heading="Ballot unavailable"
          body="We couldn't load the current voting round. Try again in a moment."
          onRetry={() => epochQuery.refetch()}
        />
      </Container>
    )
  } else if (topicsQuery.isError || contentRulesQuery.isError) {
    content = (
      <Container width="narrow" className="py-20">
        <ErrorCard
          heading="Ballot data incomplete"
          body="Part of the ballot (topics or content rules) failed to load, so the ballot can't be shown accurately."
          onRetry={() => {
            if (topicsQuery.isError) void topicsQuery.refetch()
            if (contentRulesQuery.isError) void contentRulesQuery.refetch()
          }}
        />
      </Container>
    )
  } else if (isAuthenticated && myVoteQuery.isError) {
    content = (
      <Container width="narrow" className="py-20">
        <ErrorCard
          heading="Your ballot couldn't be loaded"
          body="We couldn't retrieve your previous vote, so the ballot won't be shown pre-filled. Retry to load it."
          onRetry={() => void myVoteQuery.refetch()}
        />
      </Container>
    )
  } else {
    content = (
      <VoteWorkbench
        key={epochQuery.data.id}
        epoch={epochQuery.data}
        myVote={myVoteQuery.data}
        topics={topicsQuery.data?.topics ?? []}
        contentRules={contentRulesQuery.data}
        isAuthenticated={isAuthenticated}
        onRequireAuth={() => setSignInOpen(true)}
      />
    )
  }

  return (
    <AppShell>
      {content}
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </AppShell>
  )
}
