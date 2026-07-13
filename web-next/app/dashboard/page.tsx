"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { AppShell } from "@/components/app-shell"
import { Container } from "@/components/ui/layout"
import { PolicyBar, PolicyLegend } from "@/components/ui/policy-bar"
import { StatusChip } from "@/components/ui/status-chip"
import { WeightsSkeleton, EmptyState, ErrorCard, Skeleton } from "@/components/ui/state-kit"
import { Button } from "@/components/ui/button"
import { SIGNAL_KEYS, SIGNAL_LABELS, type SignalKey } from "@/lib/signals"
import { transparencyApi, weightsApi, type EpochResponse } from "@/lib/api/client"

/* ─── Round-diff derivation ────────────────────────────────
 * The API has no dedicated round-diff endpoint, so we derive it from the two
 * most recent epochs. Needs ≥2 epochs; otherwise the section renders empty. */

interface RoundDiff {
  current_round: number
  previous_round: number
  voter_count: number
  current_weights: EpochResponse["weights"]
  previous_weights: EpochResponse["weights"]
  weight_changes: { key: SignalKey; before: number; after: number; delta: number }[]
  keywords_added: { include: string[]; exclude: string[] }
  keywords_removed: { include: string[]; exclude: string[] }
}

function deriveRoundDiff(epochs?: EpochResponse[]): RoundDiff | null {
  if (!epochs || epochs.length < 2) return null
  const sorted = [...epochs].sort((a, b) => b.id - a.id)
  const curr = sorted[0]
  const prev = sorted[1]
  const weight_changes = SIGNAL_KEYS
    .map((key) => {
      const before = prev.weights[key]
      const after = curr.weights[key]
      return { key, before, after, delta: after - before }
    })
    .filter((wc) => Math.abs(Math.round(wc.delta * 100)) >= 1)

  const currInc = curr.content_rules?.include_keywords ?? []
  const prevInc = prev.content_rules?.include_keywords ?? []
  const currExc = curr.content_rules?.exclude_keywords ?? []
  const prevExc = prev.content_rules?.exclude_keywords ?? []

  return {
    current_round: curr.id,
    previous_round: prev.id,
    voter_count: curr.vote_count,
    current_weights: curr.weights,
    previous_weights: prev.weights,
    weight_changes,
    keywords_added: {
      include: currInc.filter((w) => !prevInc.includes(w)),
      exclude: currExc.filter((w) => !prevExc.includes(w)),
    },
    keywords_removed: {
      include: prevInc.filter((w) => !currInc.includes(w)),
      exclude: prevExc.filter((w) => !currExc.includes(w)),
    },
  }
}

/* ─── Small pieces ─────────────────────────────────────── */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/55">{children}</p>
}

function DeltaChip({ delta }: { delta: number }) {
  const isPos = delta > 0
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
        isPos ? "bg-success/10 text-success" : "bg-tongue/15 text-tongue-foreground"
      }`}
    >
      {isPos ? "+" : "−"}
      {Math.abs(Math.round(delta * 100))} pts
    </span>
  )
}

/** A content-rule change. Color encodes the rule TYPE (boost vs hide), not the
 *  direction — a newly *excluded* keyword must never read as a green "+". A
 *  rule that was dropped shows struck-through and neutral. */
function KeywordChip({ word, rule, removed }: { word: string; rule: "include" | "exclude"; removed: boolean }) {
  if (removed) {
    return (
      <span
        className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-0.5 font-mono text-xs text-foreground/55 line-through"
        title={`No longer ${rule === "include" ? "boosting" : "hiding"} “${word}”`}
      >
        {word}
      </span>
    )
  }
  const isInclude = rule === "include"
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-xs ${
        isInclude ? "border-success/25 bg-success/10 text-success" : "border-tongue/25 bg-tongue/15 text-tongue-foreground"
      }`}
      title={`Now ${isInclude ? "boosting" : "hiding"} “${word}”`}
    >
      {isInclude ? "+" : "−"}
      {word}
    </span>
  )
}

/** One number in the governance strip — quality/effect, never raw volume. */
function MetricCell({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-display text-xl font-extrabold text-foreground tabular-nums">{value}</span>
      <span className="text-[12px] text-foreground/55">{label}</span>
      {sub && <span className="mt-0.5 text-[11px] text-foreground/55">{sub}</span>}
    </div>
  )
}

/* ─── Page ─────────────────────────────────────────────── */

export default function DashboardPage() {
  const [lastUpdated] = useState(() => new Date())

  const statsQuery = useQuery({
    queryKey: ["transparency", "stats"],
    queryFn: transparencyApi.getStats,
    retry: false,
  })
  const auditQuery = useQuery({
    queryKey: ["transparency", "audit", 6],
    queryFn: () => transparencyApi.getAuditLog({ limit: 6 }),
    retry: false,
  })
  const epochQuery = useQuery({
    queryKey: ["epoch", "current"],
    queryFn: weightsApi.getCurrentEpoch,
    retry: false,
  })
  const epochsQuery = useQuery({
    queryKey: ["epochs", 2],
    queryFn: () => transparencyApi.getEpochHistory(2),
    retry: false,
  })

  const stats = statsQuery.data
  const currentEpoch = epochQuery.data
  const diff = deriveRoundDiff(epochsQuery.data?.epochs)
  const entries = auditQuery.data?.entries ?? []

  // Header identity — prefer the stats epoch, fall back to the current epoch.
  const roundId = stats?.epoch.id ?? currentEpoch?.id
  const roundPhase = stats?.epoch.status ?? currentEpoch?.phase ?? currentEpoch?.status
  const voteCount = stats?.governance.votes_this_epoch ?? currentEpoch?.vote_count
  const subscriberCount = currentEpoch?.subscriber_count
  const participation =
    voteCount != null && subscriberCount && subscriberCount > 0
      ? Math.min(100, Math.round((voteCount / subscriberCount) * 100))
      : null

  const metrics = stats?.metrics
  const feed = stats?.feed_stats

  return (
    <AppShell>
      <Container as="main" width="stage" className="flex flex-col gap-10 py-10 md:py-12">
        {/* ── Hero: the community weight mix, focal ──────────── */}
        <section aria-label="Active community policy" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground md:text-3xl">
                Transparency overview
              </h1>
              {roundPhase && <StatusChip phase={roundPhase} />}
            </div>
            <p className="text-sm text-foreground/55">
              {roundId != null ? `Round #${roundId}` : "Round —"} · {voteCount ?? 0} community votes ·{" "}
              <span className="font-mono text-xs">
                Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </p>

            <div className="mt-1">
              {epochQuery.isLoading ? (
                <WeightsSkeleton />
              ) : epochQuery.isError || !currentEpoch ? (
                <div className="rounded-2xl border border-dashed border-border bg-card/60 px-5 py-6 text-sm text-foreground/55">
                  The active weight mix isn&rsquo;t available right now. It appears here once a governance round is live.
                </div>
              ) : (
                <>
                  <p className="mb-2.5 max-w-xl text-[15px] leading-relaxed text-foreground/60">
                    Five signals decide the feed order. This is the mix the community&rsquo;s votes have settled on.
                  </p>
                  <PolicyBar weights={currentEpoch.weights} height={14} />
                  <PolicyLegend weights={currentEpoch.weights} className="mt-3" />
                </>
              )}
            </div>
          </div>

          {/* Get-involved card — mirrors the hero card on the public overview */}
          <div className="flex flex-col justify-between gap-5 rounded-2xl border border-primary/20 bg-primary/[0.04] p-5">
            <div>
              <Eyebrow>Get involved</Eyebrow>
              <p className="mt-2 text-sm leading-relaxed text-foreground/65">
                The weights are set entirely by community votes. Cast or change yours before the round closes.
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              <Button
                asChild
                className="rounded-full bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(200,97,44,0.25)] hover:bg-primary-dark"
              >
                <Link href="/vote">Vote now</Link>
              </Button>
              <a
                href="https://bsky.app"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md text-center text-[13px] font-semibold text-primary hover:text-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                See the live feed ↗
              </a>
            </div>
          </div>
        </section>

        {/* ── Governance-forward numbers strip ───────────────
             Quality + effect, not raw volume: participation, feed quality, and
             how far the ranked feed diverges from naive baselines. */}
        {statsQuery.isLoading ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-4">
            <Skeleton className="h-16 w-full" />
          </div>
        ) : statsQuery.isError ? (
          <ErrorCard
            heading="Feed health unavailable"
            body="We couldn't load the current feed and governance metrics."
            onRetry={() => void statsQuery.refetch()}
          />
        ) : stats && (participation != null || feed || metrics) ? (
          <section
            aria-label="Feed health"
            className="flex flex-col gap-4 rounded-2xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:gap-8"
          >
            {participation != null && (
              <div className="min-w-[200px] flex-shrink-0">
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-2xl font-extrabold tabular-nums text-foreground">
                    {voteCount}
                    <span className="text-base font-semibold text-foreground/50"> / {subscriberCount}</span>
                  </span>
                  <span className="font-mono text-sm font-semibold text-primary">{participation}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-biscuit">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${participation}%` }} />
                </div>
                <p className="mt-1.5 text-[11px] text-foreground/55">members voted · each vote counts equally</p>
              </div>
            )}
            {participation != null && <div className="hidden w-px self-stretch bg-border/60 sm:block" />}
            <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              {feed && (
                <MetricCell value={feed.median_total_score.toFixed(2)} label="Median feed score" sub="quality of ranked posts" />
              )}
              {metrics?.vs_chronological_overlap != null && (
                <MetricCell
                  value={`${Math.round(metrics.vs_chronological_overlap * 100)}%`}
                  label="vs Chronological"
                  sub="overlap with a time-only feed"
                />
              )}
              {metrics?.author_gini != null && (
                <MetricCell value={metrics.author_gini.toFixed(2)} label="Author spread" sub="Gini · lower = more voices" />
              )}
            </div>
          </section>
        ) : null}

        {/* ── Two light reads: what changed · recent ledger ─── */}
        <section aria-label="Round changes and ledger" className="grid gap-8 lg:grid-cols-2">
          {/* What changed this round */}
          <div>
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <Eyebrow>What changed this round</Eyebrow>
              {diff && <span className="font-mono text-[11px] text-foreground/50">{diff.voter_count} voters</span>}
            </div>
            {epochsQuery.isLoading ? (
              <WeightsSkeleton />
            ) : epochsQuery.isError ? (
              <ErrorCard
                heading="Round history unavailable"
                body="We couldn't load the rounds needed for this comparison."
                onRetry={() => void epochsQuery.refetch()}
              />
            ) : !diff ? (
              <EmptyState
                heading="Nothing to compare yet"
                body="Two governance rounds are needed to show what moved between them."
                showCorgi={false}
              />
            ) : diff.weight_changes.length === 0 &&
              diff.keywords_added.include.length === 0 &&
              diff.keywords_added.exclude.length === 0 &&
              diff.keywords_removed.include.length === 0 &&
              diff.keywords_removed.exclude.length === 0 ? (
              <EmptyState
                heading="Held steady"
                body={`Weights and content rules were unchanged from round #${diff.previous_round}.`}
                showCorgi={false}
              />
            ) : (
              <div className="flex flex-col gap-4">
                {/* before / after policy, as the same signature bar */}
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-3">
                    <span className="w-16 flex-shrink-0 font-mono text-[11px] text-foreground/55">Round {diff.previous_round}</span>
                    <PolicyBar weights={diff.previous_weights} height={8} className="opacity-70" />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-16 flex-shrink-0 font-mono text-[11px] font-semibold text-foreground/70">Round {diff.current_round}</span>
                    <PolicyBar weights={diff.current_weights} height={8} />
                  </div>
                </div>
                {diff.weight_changes.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {diff.weight_changes.map((wc) => (
                      <span key={wc.key} className="inline-flex items-center gap-1.5 text-[12px]">
                        <span className="text-foreground/60">{SIGNAL_LABELS[wc.key]}</span>
                        <DeltaChip delta={wc.delta} />
                      </span>
                    ))}
                  </div>
                )}
                {(diff.keywords_added.include.length > 0 ||
                  diff.keywords_added.exclude.length > 0 ||
                  diff.keywords_removed.include.length > 0 ||
                  diff.keywords_removed.exclude.length > 0) && (
                  <div className="flex flex-wrap gap-2 border-t border-border/50 pt-3">
                    {diff.keywords_added.include.map((w) => <KeywordChip key={`ai-${w}`} word={w} rule="include" removed={false} />)}
                    {diff.keywords_added.exclude.map((w) => <KeywordChip key={`ae-${w}`} word={w} rule="exclude" removed={false} />)}
                    {diff.keywords_removed.include.map((w) => <KeywordChip key={`ri-${w}`} word={w} rule="include" removed={true} />)}
                    {diff.keywords_removed.exclude.map((w) => <KeywordChip key={`re-${w}`} word={w} rule="exclude" removed={true} />)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Recent ledger */}
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <Eyebrow>Recent ledger</Eyebrow>
              <Link
                href="/history"
                className="rounded text-[12px] font-semibold text-primary hover:text-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Full ledger →
              </Link>
            </div>
            {auditQuery.isLoading ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between gap-4 py-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                ))}
              </div>
            ) : auditQuery.isError ? (
              <ErrorCard heading="Ledger unavailable" body="We couldn't load recent audit activity." onRetry={() => void auditQuery.refetch()} />
            ) : entries.length === 0 ? (
              <EmptyState heading="No ledger entries yet" body="Audit events appear here once governance activity begins." showCorgi={false} />
            ) : (
              <div className="divide-y divide-border/50">
                {entries.map((entry) => {
                  const date = new Date(entry.created_at)
                  return (
                    <div key={entry.id} className="flex items-center justify-between gap-4 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary/50" aria-hidden="true" />
                        <span className="truncate font-mono text-[13px] text-foreground/70">{entry.action}</span>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-3">
                        <span className="hidden font-mono text-[11px] text-foreground/50 sm:block">Round #{entry.epoch_id}</span>
                        <time
                          dateTime={entry.created_at}
                          className="font-mono text-[11px] text-foreground/55"
                          title={date.toLocaleString()}
                        >
                          {date.toLocaleDateString([], { month: "short", day: "numeric" })}
                        </time>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {/* ── Check a specific post (quiet link to the explain tool) ── */}
        <Link
          href="/post"
          className="group flex items-center justify-between gap-4 rounded-2xl border border-border bg-card/60 px-5 py-4 transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="text-[13px] text-foreground/60">
            Wondering why a specific post ranked where it did?{" "}
            <span className="text-foreground/80">Look up its receipt — every signal, weighted.</span>
          </span>
          <span className="flex-shrink-0 text-[13px] font-semibold text-primary">Explain a ranking →</span>
        </Link>
      </Container>
    </AppShell>
  )
}
