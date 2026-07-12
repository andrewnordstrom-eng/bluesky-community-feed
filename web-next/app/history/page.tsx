"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { AppShell } from "@/components/app-shell"
import { Container } from "@/components/ui/layout"
import { PolicyBar, PolicyLegend } from "@/components/ui/policy-bar"
import { StatusChip } from "@/components/ui/status-chip"
import { WeightsSkeleton, EmptyState, ErrorCard, Skeleton } from "@/components/ui/state-kit"
import { SIGNAL_COLORS, SIGNAL_LABELS, type SignalKey } from "@/lib/signals"
import { transparencyApi, type EpochResponse, type AuditLogEntry } from "@/lib/api/client"
import { policyIsActive, showParticipationRatio, ballotCountText } from "@/lib/governance-status"

/* ─── Constants ────────────────────────────────────────── */

const AUDIT_PAGE_SIZE = 25

/* ─── Derived view model ────────────────────────────────────
 * The API has no per-round diff endpoint, so — like the dashboard's
 * deriveRoundDiff — we compute prev-weights and keyword deltas from the
 * adjacent (next-older) epoch in the fetched history. */

interface EpochView {
  id: number
  status: string
  /** True when this round's weights are the policy currently applied to the feed. */
  policyActive: boolean
  vote_count: number
  subscriber_count: number
  created_at: string
  closed_at: string | null
  weights: Record<string, number>
  prev_weights?: Record<string, number>
  keywords_added: { include: string[]; exclude: string[] }
  keywords_removed: { include: string[]; exclude: string[] }
}

function deriveEpochViews(epochs: EpochResponse[]): EpochView[] {
  const sorted = [...epochs].sort((a, b) => b.id - a.id)
  return sorted.map((epoch, i) => {
    const prev = sorted[i + 1]
    const prevLoaded = i + 1 < sorted.length // next-older round, or undefined for the oldest
    const currInc = epoch.content_rules?.include_keywords ?? []
    const prevInc = prev?.content_rules?.include_keywords ?? []
    const currExc = epoch.content_rules?.exclude_keywords ?? []
    const prevExc = prev?.content_rules?.exclude_keywords ?? []
    return {
      id: epoch.id,
      status: epoch.status,
      // The backend's `phase` field is only meaningful for the current voting
      // cycle (historical epochs keep whatever phase they last had), so the
      // ledger derives its label from the policy lifecycle instead.
      policyActive: policyIsActive(epoch),
      vote_count: epoch.vote_count,
      subscriber_count: epoch.subscriber_count ?? 0,
      created_at: epoch.created_at,
      closed_at: epoch.closed_at ?? null,
      weights: epoch.weights as Record<string, number>,
      prev_weights: prev ? (prev.weights as Record<string, number>) : undefined,
      // For the oldest loaded round the previous round isn't in the window —
      // report no diffs rather than fabricating "added everything".
      keywords_added: prevLoaded ? {
        include: currInc.filter((w) => !prevInc.includes(w)),
        exclude: currExc.filter((w) => !prevExc.includes(w)),
      } : { include: [], exclude: [] },
      keywords_removed: prevLoaded ? {
        include: prevInc.filter((w) => !currInc.includes(w)),
        exclude: prevExc.filter((w) => !currExc.includes(w)),
      } : { include: [], exclude: [] },
    }
  })
}

/* ─── Helpers ──────────────────────────────────────────── */

function fmtDate(iso: string, style: "short" | "long" = "short") {
  const d = new Date(iso)
  if (style === "long") return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function weightDiff(epoch: EpochView) {
  if (!epoch.prev_weights) return []
  const EPSILON = 0.005
  return Object.keys(epoch.weights)
    .map((k) => ({
      key: k,
      before: epoch.prev_weights![k] ?? 0,
      after:  epoch.weights[k],
      delta:  (epoch.weights[k]) - (epoch.prev_weights![k] ?? 0),
    }))
    .filter((d) => Math.abs(d.delta) > EPSILON)
}

/* ─── Sub-components ───────────────────────────────────── */

function EpochCard({
  epoch,
  selected,
  onClick,
}: {
  epoch: EpochView
  selected: boolean
  onClick: () => void
}) {
  // Participation math is only shown once the member count is meaningful.
  const showRatio = showParticipationRatio(epoch.subscriber_count)
  const participation = epoch.subscriber_count > 0 ? Math.round((epoch.vote_count / epoch.subscriber_count) * 100) : 0

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`Round ${epoch.id}, ${epoch.vote_count} votes`}
      className={`w-full text-left rounded-xl border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1
        ${selected
          ? "border-primary/40 bg-card shadow-sm ring-1 ring-primary/15"
          : "border-border bg-card/60 hover:bg-card hover:border-border hover:shadow-sm"
        }`}
    >
      {/* Ginger left accent bar on selected */}
      <div className={`flex gap-0 overflow-hidden rounded-xl`}>
        <div className={`w-1 flex-shrink-0 rounded-l-xl transition-colors ${selected ? "bg-primary" : "bg-transparent"}`} aria-hidden="true" />
        <div className="flex-1 p-4 flex flex-col gap-3">
          {/* Top row: round number + policy-state chip */}
          <div className="flex items-center justify-between gap-2">
            <span className={`text-xl font-mono font-bold leading-none ${selected ? "text-foreground" : "text-foreground/70"}`}>
              #{epoch.id}
            </span>
            <StatusChip phase={epoch.policyActive ? "active" : "archived"} />
          </div>
          {/* Stats row */}
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono text-foreground/50 tabular-nums">
              {epoch.vote_count.toLocaleString()} votes
            </span>
            {showRatio && (
              <span className="font-mono text-foreground/50">
                {participation}%
              </span>
            )}
          </div>
          {/* Participation bar */}
          {showRatio && (
            <div className="h-1 rounded-full bg-biscuit overflow-hidden">
              <div
                className={`h-1 rounded-full transition-all ${selected ? "bg-primary" : "bg-primary/40"}`}
                style={{ width: `${participation}%` }}
              />
            </div>
          )}
          {/* Date */}
          <time dateTime={epoch.created_at} className="text-[10px] font-mono text-foreground/55">
            {epoch.closed_at
              ? `${fmtDate(epoch.created_at)} – ${fmtDate(epoch.closed_at)}`
              : `since ${fmtDate(epoch.created_at)}`}
          </time>
        </div>
      </div>
    </button>
  )
}

function WeightDiffRow({
  label,
  before,
  after,
  delta,
  color,
}: {
  label: string
  before: number
  after: number
  delta: number
  color?: string
}) {
  const isPos = delta > 0
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <span className="text-sm font-medium text-foreground w-24 sm:w-32 flex-shrink-0">{label}</span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-xs font-mono text-foreground/50 w-7 text-right tabular-nums flex-shrink-0">
          {(before * 100).toFixed(0)}%
        </span>
        {/* Before track (muted) with the new weight in the signal's color */}
        <div className="flex-1 h-2 rounded-full bg-biscuit overflow-hidden relative">
          <div
            className="absolute inset-y-0 left-0 h-2 rounded-full bg-foreground/20 transition-all"
            style={{ width: `${before * 100}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 h-2 rounded-full transition-all"
            style={{ width: `${after * 100}%`, backgroundColor: color ?? "hsl(var(--primary))" }}
          />
        </div>
        <span className="text-xs font-mono text-foreground w-7 tabular-nums flex-shrink-0">
          {(after * 100).toFixed(0)}%
        </span>
      </div>
      {/* Delta chip */}
      <span
        className={`flex-shrink-0 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded
          ${isPos
            ? "bg-success/10 text-success"
            : "bg-tongue/15 text-tongue-foreground"
          }`}
      >
        {isPos ? "+" : ""}{(delta * 100).toFixed(0)}pp
      </span>
    </div>
  )
}

/** Above this many additions, keyword chips collapse behind a one-line summary.
 *  A long suppression list (e.g. an adult-content filter) is still fully
 *  inspectable, but doesn't dominate the round detail by default. */
const KEYWORD_COLLAPSE_THRESHOLD = 6

function CollapsibleKeywordGroup({
  words,
  variant,
  summaryLabel,
}: {
  words: string[]
  variant: "add-include" | "add-exclude"
  summaryLabel: string
}) {
  const [expanded, setExpanded] = useState(false)
  if (words.length === 0) return null
  if (words.length <= KEYWORD_COLLAPSE_THRESHOLD || expanded) {
    return (
      <>
        {words.map((w) => (
          <KeywordDiffRow key={`${variant}-${w}`} word={w} variant={variant} />
        ))}
        {words.length > KEYWORD_COLLAPSE_THRESHOLD && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-xs text-primary/80 hover:text-primary transition-colors underline underline-offset-2"
          >
            Collapse
          </button>
        )}
      </>
    )
  }
  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      aria-expanded={false}
      className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-full border bg-tongue/10 border-tongue/25 text-tongue-foreground hover:bg-tongue/20 transition-colors"
    >
      {summaryLabel} · {words.length} keywords
      <span aria-hidden="true">▸</span>
    </button>
  )
}

function KeywordDiffRow({ word, variant }: { word: string; variant: "add-include" | "add-exclude" | "remove-include" | "remove-exclude" }) {
  const cfg = {
    "add-include":    { prefix: "+", label: "boost",    cls: "bg-success/10 border-success/25 text-success" },
    "add-exclude":    { prefix: "−", label: "suppress", cls: "bg-tongue/15 border-tongue/25 text-tongue-foreground" },
    "remove-include": { prefix: "+", label: "removed",  cls: "bg-foreground/8 border-border text-foreground/55 line-through" },
    "remove-exclude": { prefix: "−", label: "removed",  cls: "bg-foreground/8 border-border text-foreground/55 line-through" },
  }[variant]
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-mono px-2.5 py-1 rounded-full border ${cfg.cls}`}>
      {cfg.prefix}{word}
      <span className="text-[9px] opacity-60 ml-0.5">{cfg.label}</span>
    </span>
  )
}

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  const hasDetails = Object.keys(entry.details).length > 0
  const [expanded, setExpanded] = useState(false)
  const handle = typeof entry.details.handle === "string" ? entry.details.handle : entry.actor_did

  return (
    <div className="group">
      <div className="flex items-start gap-4 px-5 py-3 hover:bg-biscuit/25 transition-colors">
        {/* Action dot */}
        <div className="flex flex-col items-center gap-1 pt-1 flex-shrink-0">
          <div className="w-2 h-2 rounded-full bg-primary/50" aria-hidden="true" />
        </div>
        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground font-mono">{entry.action}</span>
            {handle && (
              <span className="text-xs font-mono text-foreground/55 truncate max-w-[200px]">
                {handle}
              </span>
            )}
          </div>
          {hasDetails && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[10px] text-primary/70 hover:text-primary transition-colors self-start underline underline-offset-2"
            >
              {expanded ? "Hide details" : "Show details"}
            </button>
          )}
          {expanded && (
            <pre className="mt-1.5 text-[10px] font-mono text-foreground/50 bg-biscuit/60 rounded-md px-2.5 py-2 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(entry.details, null, 2)}
            </pre>
          )}
        </div>
        {/* Right: epoch + timestamp */}
        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
          <span className="text-xs font-mono text-foreground/50" title={`Round ${entry.epoch_id ?? "—"}`}>
            #{entry.epoch_id ?? "—"}
          </span>
          <time
            dateTime={entry.created_at}
            className="text-[10px] font-mono text-foreground/55"
            title={fmtDate(entry.created_at, "long")}
          >
            {fmtRelative(entry.created_at)}
          </time>
        </div>
      </div>
    </div>
  )
}

/* ─── Detail panel ─────────────────────────────────────── */

function DetailPanel({ epoch, epochAudit, auditWindowNote }: { epoch: EpochView; epochAudit: AuditLogEntry[]; auditWindowNote?: string }) {
  const diffs = weightDiff(epoch)
  const hasKeywordChanges =
    epoch.keywords_added.include.length +
    epoch.keywords_added.exclude.length +
    epoch.keywords_removed.include.length +
    epoch.keywords_removed.exclude.length > 0

  const showRatio = showParticipationRatio(epoch.subscriber_count)
  const participation = epoch.subscriber_count > 0 ? Math.round((epoch.vote_count / epoch.subscriber_count) * 100) : 0

  return (
    <div className="flex flex-col gap-8">

      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className="whitespace-nowrap font-display text-2xl font-bold text-foreground tracking-normal">
              Round #{epoch.id}
            </h2>
            <StatusChip phase={epoch.policyActive ? "active" : "archived"} />
          </div>
          <p className="text-sm text-foreground/55">
            {showRatio
              ? `${epoch.vote_count.toLocaleString()} votes of ${epoch.subscriber_count.toLocaleString()} members · ${participation}% participation`
              : ballotCountText(epoch.vote_count)}
          </p>
          <p className="text-xs font-mono text-foreground/55 mt-0.5">
            {epoch.closed_at
              ? `In effect ${fmtDate(epoch.created_at, "long")} — ${fmtDate(epoch.closed_at, "long")}`
              : `Policy in effect since ${fmtDate(epoch.created_at, "long")}`}
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-xs font-medium text-primary hover:text-primary-dark transition-colors underline underline-offset-2 flex-shrink-0 mt-1"
        >
          Explain a post →
        </Link>
      </div>

      {/* ── Applied weights — the signature stacked bar ────── */}
      <section aria-label="Applied weights">
        <p className="text-[10px] font-mono text-foreground/50 uppercase tracking-widest mb-4">
          Applied weights
        </p>
        <PolicyBar weights={epoch.weights} height={14} />
        <PolicyLegend weights={epoch.weights} className="mt-3" />
      </section>

      {/* ── Weight diff vs previous ───────────────────────── */}
      <section aria-label="Weight changes vs previous round">
        <p className="text-[10px] font-mono text-foreground/50 uppercase tracking-widest mb-4">
          {epoch.prev_weights
            ? `Changes vs round #${epoch.id - 1}`
            : `No previous round to compare`}
        </p>
        {!epoch.prev_weights ? (
          <p className="text-sm text-foreground/55 italic">
            This is the oldest round in the ledger — no prior round to diff against.
          </p>
        ) : diffs.length === 0 ? (
          <p className="text-sm text-foreground/55 italic">
            No weight changes from the previous round.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {diffs.map((d) => (
              <WeightDiffRow
                key={d.key}
                label={SIGNAL_LABELS[d.key as SignalKey] ?? d.key}
                before={d.before}
                after={d.after}
                delta={d.delta}
                color={SIGNAL_COLORS[d.key as SignalKey]}
              />
            ))}
          </div>
        )}
      </section>

      {/* Divider */}
      <div className="h-px bg-border/60" />

      {/* ── Keyword diff ─────────────────────────────────── */}
      <section aria-label="Keyword rule changes">
        <p className="text-[10px] font-mono text-foreground/50 uppercase tracking-widest mb-4">
          Content rule changes
        </p>
        {!hasKeywordChanges ? (
          <p className="text-sm text-foreground/55 italic">
            No keyword changes this round.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <CollapsibleKeywordGroup
              words={epoch.keywords_added.include}
              variant="add-include"
              summaryLabel="+ boosted-keyword list"
            />
            <CollapsibleKeywordGroup
              words={epoch.keywords_added.exclude}
              variant="add-exclude"
              summaryLabel="− suppressed-keyword filter"
            />
            {epoch.keywords_removed.include.map((w) => (
              <KeywordDiffRow key={`ri-${w}`} word={w} variant="remove-include" />
            ))}
            {epoch.keywords_removed.exclude.map((w) => (
              <KeywordDiffRow key={`re-${w}`} word={w} variant="remove-exclude" />
            ))}
          </div>
        )}
      </section>

      {/* Divider */}
      <div className="h-px bg-border/60" />

      {/* ── Per-round audit events ────────────────────────── */}
      <section aria-label={`Audit events for round ${epoch.id}`}>
        <p className="text-[10px] font-mono text-foreground/50 uppercase tracking-widest mb-2">
          Audit events · Round #{epoch.id}{auditWindowNote ? ` (${auditWindowNote})` : ""}
        </p>
        {epochAudit.length === 0 ? (
          <EmptyState
            heading="No audit events"
            body="No recent audit events recorded for this round."
            showCorgi={false}
          />
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border/60">
            {epochAudit.map((entry) => (
              <AuditRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>

    </div>
  )
}

/* ─── Loading skeleton for the detail panel ────────────── */
function DetailPanelSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-3 w-48" />
      </div>
      <WeightsSkeleton />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-2 flex-1 rounded-full" />
            <Skeleton className="h-4 w-10" />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Page ─────────────────────────────────────────────── */

export default function HistoryPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [auditLimit, setAuditLimit] = useState(AUDIT_PAGE_SIZE)

  const epochsQuery = useQuery({
    queryKey: ["epochs", 20],
    queryFn: () => transparencyApi.getEpochHistory(20),
    retry: false,
  })
  const auditQuery = useQuery({
    queryKey: ["transparency", "audit", auditLimit],
    queryFn: () => transparencyApi.getAuditLog({ limit: auditLimit }),
    retry: false,
    placeholderData: (prev) => prev,
  })

  const epochViews = useMemo(
    () => deriveEpochViews(epochsQuery.data?.epochs ?? []),
    [epochsQuery.data]
  )
  const selectedEpoch = epochViews.find((e) => e.id === selectedId) ?? epochViews[0]

  const auditEntries = auditQuery.data?.entries ?? []
  const auditTotal = auditQuery.data?.pagination.total ?? 0
  const auditHasMore = auditQuery.data?.pagination.has_more ?? false

  return (
    <AppShell>
      <Container width="content" className="flex flex-col gap-8 py-10">

        {/* ── Page header ──────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-2xl font-bold text-foreground tracking-normal">
              Governance ledger
            </h1>
            <p className="text-sm text-foreground/50 leading-relaxed max-w-lg">
              Every weight change, keyword rule, and governance event — in full, forever. Select a round to inspect it.
            </p>
            <p className="text-xs text-foreground/50 leading-relaxed max-w-lg">
              Corgi is in its pilot phase: the early rounds below were run with a small group of voters to
              prove the loop end-to-end, and they are kept here unedited.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="text-xs font-medium text-foreground/50 hover:text-foreground transition-colors flex-shrink-0 mt-1 flex items-center gap-1"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Overview
          </Link>
        </div>

        {/* ── Rounds region (driven by the epochs query) ───── */}
        {epochsQuery.isLoading ? (
          <div className="flex flex-col lg:flex-row gap-6 items-start">
            <aside className="w-full lg:w-56 lg:flex-shrink-0 flex flex-col gap-2" aria-label="Loading rounds">
              <p className="text-[10px] font-mono text-foreground/50 uppercase tracking-widest px-1 mb-1">
                Rounds · newest first
              </p>
              <div className="flex flex-col gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
                    <div className="flex justify-between">
                      <Skeleton className="h-6 w-10" />
                      <Skeleton className="h-5 w-16" />
                    </div>
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-1 w-full rounded-full" />
                  </div>
                ))}
              </div>
            </aside>
            <main className="w-full lg:flex-1 min-w-0 rounded-xl border border-border bg-card p-4 sm:p-6 lg:p-7">
              <DetailPanelSkeleton />
            </main>
          </div>
        ) : epochsQuery.isError ? (
          <ErrorCard
            heading="Ledger unavailable"
            body="We couldn't load governance history. The transparency record is still intact — try again shortly."
            onRetry={() => void epochsQuery.refetch()}
          />
        ) : epochViews.length === 0 ? (
          <EmptyState
            heading="No rounds yet"
            body="Governance history will appear here once the first round is complete."
            showCorgi={false}
          />
        ) : (
          <div className="flex flex-col lg:flex-row gap-6 items-start">
            {/* ── LEFT: epoch timeline ─────────────────────── */}
            <aside
              className="w-full lg:w-56 lg:flex-shrink-0 flex flex-col gap-2 lg:sticky lg:top-20"
              aria-label="Epoch timeline"
            >
              <p className="text-[10px] font-mono text-foreground/50 uppercase tracking-widest px-1 mb-1">
                Rounds · newest first
              </p>
              <nav
                className="flex flex-row lg:flex-col gap-2 overflow-x-auto pb-2 lg:pb-0 snap-x snap-mandatory lg:snap-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                aria-label="Select a round"
              >
                {epochViews.map((epoch) => (
                  <div key={epoch.id} className="flex-shrink-0 w-44 sm:w-48 lg:w-auto snap-start">
                    <EpochCard
                      epoch={epoch}
                      selected={epoch.id === selectedEpoch.id}
                      onClick={() => setSelectedId(epoch.id)}
                    />
                  </div>
                ))}
              </nav>
            </aside>

            {/* ── RIGHT: detail panel ──────────────────────── */}
            <main className="w-full lg:flex-1 min-w-0 rounded-xl border border-border bg-card p-4 sm:p-6 lg:p-7">
              <DetailPanel
                epoch={selectedEpoch}
                epochAudit={auditEntries.filter((e) => e.epoch_id === selectedEpoch.id)} auditWindowNote={`from the ${auditEntries.length} most recent loaded events`}
              />
            </main>
          </div>
        )}

        {/* ── Full audit table (all epochs) ────────────────── */}
        <section aria-label="Full audit log">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-mono text-foreground/50 uppercase tracking-widest">
              Full audit log · {auditEntries.length} of {auditTotal} entries
            </p>
            <span className="text-xs text-foreground/55 font-mono">
              Showing {auditEntries.length} most recent
            </span>
          </div>

          {auditQuery.isLoading ? (
            <div className="rounded-xl border border-border bg-card divide-y divide-border/60 overflow-hidden" aria-busy="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          ) : auditQuery.isError ? (
            <ErrorCard
              heading="Audit log unavailable"
              body="We couldn't load the full audit log. Try again shortly."
              onRetry={() => void auditQuery.refetch()}
            />
          ) : auditTotal === 0 ? (
            <EmptyState
              heading="No audit entries yet"
              body="Governance events will appear here once activity begins."
              showCorgi={false}
            />
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-5 py-2.5 bg-biscuit/40 border-b border-border">
                <span className="text-[10px] font-semibold text-foreground/50 uppercase tracking-wide">Event</span>
                <span className="text-[10px] font-semibold text-foreground/50 uppercase tracking-wide w-14 text-center">Round</span>
                <span className="text-[10px] font-semibold text-foreground/50 uppercase tracking-wide w-20 text-right">Time</span>
              </div>
              <div className="divide-y divide-border/60">
                {auditEntries.map((entry) => (
                  <AuditRow key={entry.id} entry={entry} />
                ))}
              </div>
              {/* Pagination */}
              <div className="px-5 py-3 border-t border-border/60 flex items-center justify-between">
                <span className="text-xs text-foreground/50 font-mono">{auditTotal} total · {auditEntries.length} shown</span>
                {auditHasMore && (
                  <button
                    type="button"
                    onClick={() => setAuditLimit((l) => l + AUDIT_PAGE_SIZE)}
                    disabled={auditQuery.isFetching}
                    className="text-xs font-medium text-primary hover:text-primary-dark transition-colors disabled:opacity-40"
                  >
                    {auditQuery.isFetching ? "Loading…" : "Load more"}
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

      </Container>
    </AppShell>
  )
}
