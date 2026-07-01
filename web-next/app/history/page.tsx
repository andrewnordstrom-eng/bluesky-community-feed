"use client"

import { useState } from "react"
import Link from "next/link"
import { AppShell } from "@/components/app-shell"
import { WeightBar } from "@/components/ui/weight-bar"
import { ScoreRadar, type RadarSignal } from "@/components/ui/score-radar"
import { StatusChip } from "@/components/ui/status-chip"
import { WeightsSkeleton, EmptyState, ErrorCard, Skeleton } from "@/components/ui/state-kit"

/* ─── Mock data (exact field names from the brief seam) ── */

const WEIGHT_LABELS: Record<string, string> = {
  recency: "Recency",
  engagement: "Engagement",
  bridging: "Bridging",
  source_diversity: "Source diversity",
  relevance: "Relevance",
}

type Phase = "voting" | "review" | "running" | "live" | "waiting" | "closed"

interface Epoch {
  id: number
  status: string
  phase: Phase
  vote_count: number
  subscriber_count: number
  created_at: string
  closed_at: string | null
  weights: Record<string, number>
  prev_weights?: Record<string, number>
  keywords_added?: { include: string[]; exclude: string[] }
  keywords_removed?: { include: string[]; exclude: string[] }
}

interface AuditEntry {
  id: number
  action: string
  actor_did: string | null
  epoch_id: number
  details: Record<string, unknown>
  created_at: string
}

const MOCK_EPOCHS: Epoch[] = [
  {
    id: 47,
    status: "voting",
    phase: "voting",
    vote_count: 312,
    subscriber_count: 480,
    created_at: "2026-06-25T00:00:00Z",
    closed_at: null,
    weights: { recency: 0.35, engagement: 0.25, bridging: 0.20, source_diversity: 0.15, relevance: 0.05 },
    prev_weights: { recency: 0.30, engagement: 0.30, bridging: 0.20, source_diversity: 0.10, relevance: 0.10 },
    keywords_added:   { include: ["ai", "governance"], exclude: [] },
    keywords_removed: { include: [],                   exclude: ["nft", "crypto"] },
  },
  {
    id: 46,
    status: "closed",
    phase: "closed",
    vote_count: 289,
    subscriber_count: 461,
    created_at: "2026-06-18T00:00:00Z",
    closed_at: "2026-06-24T17:00:00Z",
    weights: { recency: 0.30, engagement: 0.30, bridging: 0.20, source_diversity: 0.10, relevance: 0.10 },
    prev_weights: { recency: 0.30, engagement: 0.30, bridging: 0.20, source_diversity: 0.10, relevance: 0.10 },
    keywords_added:   { include: [], exclude: ["nft"] },
    keywords_removed: { include: [], exclude: [] },
  },
  {
    id: 45,
    status: "closed",
    phase: "closed",
    vote_count: 304,
    subscriber_count: 448,
    created_at: "2026-06-11T00:00:00Z",
    closed_at: "2026-06-17T17:00:00Z",
    weights: { recency: 0.30, engagement: 0.30, bridging: 0.20, source_diversity: 0.10, relevance: 0.10 },
    prev_weights: { recency: 0.25, engagement: 0.35, bridging: 0.20, source_diversity: 0.10, relevance: 0.10 },
    keywords_added:   { include: [], exclude: [] },
    keywords_removed: { include: [], exclude: [] },
  },
  {
    id: 44,
    status: "closed",
    phase: "closed",
    vote_count: 271,
    subscriber_count: 431,
    created_at: "2026-06-04T00:00:00Z",
    closed_at: "2026-06-10T17:00:00Z",
    weights: { recency: 0.25, engagement: 0.35, bridging: 0.20, source_diversity: 0.10, relevance: 0.10 },
    prev_weights: { recency: 0.25, engagement: 0.35, bridging: 0.20, source_diversity: 0.10, relevance: 0.10 },
    keywords_added:   { include: [], exclude: [] },
    keywords_removed: { include: [], exclude: [] },
  },
  {
    id: 43,
    status: "closed",
    phase: "closed",
    vote_count: 258,
    subscriber_count: 415,
    created_at: "2026-05-28T00:00:00Z",
    closed_at: "2026-06-03T17:00:00Z",
    weights: { recency: 0.25, engagement: 0.35, bridging: 0.20, source_diversity: 0.10, relevance: 0.10 },
    prev_weights: undefined, // oldest — no diff
    keywords_added:   { include: [], exclude: [] },
    keywords_removed: { include: [], exclude: [] },
  },
]

const MOCK_AUDIT: AuditEntry[] = [
  { id: 991, action: "weights_applied",  actor_did: null,               epoch_id: 47, details: {},                                     created_at: "2026-06-25T00:00:00Z" },
  { id: 990, action: "vote_submitted",   actor_did: "did:plc:abc123",   epoch_id: 47, details: { handle: "maya.bsky.social" },         created_at: "2026-06-24T18:32:00Z" },
  { id: 989, action: "vote_submitted",   actor_did: "did:plc:def456",   epoch_id: 47, details: { handle: "alicia.bsky.social" },       created_at: "2026-06-24T16:11:00Z" },
  { id: 988, action: "epoch_opened",     actor_did: null,               epoch_id: 47, details: {},                                     created_at: "2026-06-24T00:00:00Z" },
  { id: 987, action: "keywords_updated", actor_did: null,               epoch_id: 47, details: { added: ["ai"], removed: ["nft"] },    created_at: "2026-06-25T00:01:00Z" },
  { id: 986, action: "weights_applied",  actor_did: null,               epoch_id: 46, details: {},                                     created_at: "2026-06-18T00:00:00Z" },
  { id: 985, action: "epoch_closed",     actor_did: null,               epoch_id: 46, details: {},                                     created_at: "2026-06-24T17:00:00Z" },
  { id: 984, action: "vote_submitted",   actor_did: "did:plc:ghi789",   epoch_id: 46, details: { handle: "jordyn.bsky.social" },       created_at: "2026-06-23T09:15:00Z" },
]

const ACTION_META: Record<string, { label: string; color: string }> = {
  weights_applied:  { label: "Weights applied",  color: "bg-primary/60"   },
  vote_submitted:   { label: "Vote submitted",   color: "bg-success/60"   },
  epoch_opened:     { label: "Epoch opened",     color: "bg-foreground/25" },
  epoch_closed:     { label: "Epoch closed",     color: "bg-foreground/25" },
  keywords_updated: { label: "Keywords updated", color: "bg-warning/60"   },
}

/* ─── Types ────────────────────────────────────────────── */

type PageState = "loading" | "loaded" | "error" | "empty"

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

function weightDiff(epoch: Epoch) {
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

function toRadarSignals(epoch: Epoch): RadarSignal[] {
  return Object.entries(epoch.weights).map(([key, weight]) => ({
    key,
    label: WEIGHT_LABELS[key] ?? key,
    post:       weight, // on the ledger, post = applied weight (no per-post score here)
    governance: weight,
  }))
}

/* ─── Sub-components ───────────────────────────────────── */

function EpochCard({
  epoch,
  selected,
  onClick,
}: {
  epoch: Epoch
  selected: boolean
  onClick: () => void
}) {
  const participation = Math.round((epoch.vote_count / epoch.subscriber_count) * 100)

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
          {/* Top row: round number + phase chip */}
          <div className="flex items-center justify-between gap-2">
            <span className={`text-xl font-mono font-bold leading-none ${selected ? "text-foreground" : "text-foreground/70"}`}>
              #{epoch.id}
            </span>
            <StatusChip phase={epoch.phase} />
          </div>
          {/* Stats row */}
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono text-foreground/50 tabular-nums">
              {epoch.vote_count.toLocaleString()} votes
            </span>
            <span className="font-mono text-foreground/40">
              {participation}%
            </span>
          </div>
          {/* Participation bar */}
          <div className="h-1 rounded-full bg-biscuit overflow-hidden">
            <div
              className={`h-1 rounded-full transition-all ${selected ? "bg-primary" : "bg-primary/40"}`}
              style={{ width: `${participation}%` }}
            />
          </div>
          {/* Date */}
          <time dateTime={epoch.created_at} className="text-[10px] font-mono text-foreground/35">
            {fmtDate(epoch.created_at)}
            {epoch.closed_at ? ` – ${fmtDate(epoch.closed_at)}` : " · active"}
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
}: {
  label: string
  before: number
  after: number
  delta: number
}) {
  const isPos = delta > 0
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <span className="text-sm font-medium text-foreground w-24 sm:w-32 flex-shrink-0">{label}</span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-xs font-mono text-foreground/40 w-7 text-right tabular-nums flex-shrink-0">
          {(before * 100).toFixed(0)}%
        </span>
        {/* Before track */}
        <div className="flex-1 h-2 rounded-full bg-biscuit overflow-hidden relative">
          <div
            className="absolute inset-y-0 left-0 h-2 rounded-full bg-foreground/20 transition-all"
            style={{ width: `${before * 100}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 h-2 rounded-full bg-primary transition-all"
            style={{ width: `${after * 100}%` }}
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

function KeywordDiffRow({ word, variant }: { word: string; variant: "add-include" | "add-exclude" | "remove-include" | "remove-exclude" }) {
  const cfg = {
    "add-include":    { prefix: "+", label: "boost",    cls: "bg-success/10 border-success/25 text-success" },
    "add-exclude":    { prefix: "−", label: "suppress", cls: "bg-tongue/15 border-tongue/25 text-tongue-foreground" },
    "remove-include": { prefix: "+", label: "removed",  cls: "bg-foreground/8 border-border text-foreground/45 line-through" },
    "remove-exclude": { prefix: "−", label: "removed",  cls: "bg-foreground/8 border-border text-foreground/45 line-through" },
  }[variant]
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-mono px-2.5 py-1 rounded-full border ${cfg.cls}`}>
      {cfg.prefix}{word}
      <span className="text-[9px] opacity-60 ml-0.5">{cfg.label}</span>
    </span>
  )
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const meta = ACTION_META[entry.action] ?? { label: entry.action, color: "bg-foreground/20" }
  const hasDetails = Object.keys(entry.details).length > 0
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="group">
      <div className="flex items-start gap-4 px-5 py-3 hover:bg-biscuit/25 transition-colors">
        {/* Action dot */}
        <div className="flex flex-col items-center gap-1 pt-1 flex-shrink-0">
          <div className={`w-2 h-2 rounded-full ${meta.color}`} aria-hidden="true" />
        </div>
        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">{meta.label}</span>
            {entry.actor_did && (
              <span className="text-xs font-mono text-foreground/45 truncate max-w-[200px]">
                {entry.details.handle as string ?? entry.actor_did}
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
          <button
            type="button"
            className="text-xs font-mono text-primary/70 hover:text-primary transition-colors"
            title={`Select epoch #${entry.epoch_id}`}
          >
            #{entry.epoch_id}
          </button>
          <time
            dateTime={entry.created_at}
            className="text-[10px] font-mono text-foreground/35"
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

function DetailPanel({ epoch }: { epoch: Epoch }) {
  const diffs = weightDiff(epoch)
  const hasKeywordChanges =
    (epoch.keywords_added?.include.length ?? 0) +
    (epoch.keywords_added?.exclude.length ?? 0) +
    (epoch.keywords_removed?.include.length ?? 0) +
    (epoch.keywords_removed?.exclude.length ?? 0) > 0

  const radarSignals: RadarSignal[] = Object.entries(epoch.weights).map(([key, w]) => ({
    key,
    label: WEIGHT_LABELS[key] ?? key,
    post: w,
    governance: w,
  }))

  const epochAudit = MOCK_AUDIT.filter((e) => e.epoch_id === epoch.id)

  return (
    <div className="flex flex-col gap-8">

      {/* ── Header ───────────────────────────────────���───── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-normal">
              Round #{epoch.id}
            </h2>
            <StatusChip phase={epoch.phase} />
          </div>
          <p className="text-sm text-foreground/50">
            {epoch.vote_count.toLocaleString()} votes of {epoch.subscriber_count.toLocaleString()} members
            {" · "}{Math.round((epoch.vote_count / epoch.subscriber_count) * 100)}% participation
          </p>
          <p className="text-xs font-mono text-foreground/35 mt-0.5">
            {fmtDate(epoch.created_at, "long")}
            {epoch.closed_at ? ` — ${fmtDate(epoch.closed_at, "long")}` : " · still open"}
          </p>
        </div>
        <Link
          href={`/post/at://demo`}
          className="text-xs font-medium text-primary hover:text-primary-dark transition-colors underline underline-offset-2 flex-shrink-0 mt-1"
        >
          Explain a post →
        </Link>
      </div>

      {/* ── Applied weights + radar ───────────────────────── */}
      <section aria-label="Applied weights">
        <p className="text-[10px] font-mono text-foreground/40 uppercase tracking-widest mb-4">
          Applied weights
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="flex flex-col gap-4">
            {Object.entries(epoch.weights).map(([key, val]) => (
              <WeightBar key={key} label={WEIGHT_LABELS[key] ?? key} value={val} />
            ))}
          </div>
          <div className="flex items-center justify-center">
            <ScoreRadar signals={radarSignals} className="w-full max-w-xs" />
          </div>
        </div>
      </section>

      {/* ── Weight diff vs previous ───────────────────────── */}
      <section aria-label="Weight changes vs previous round">
        <p className="text-[10px] font-mono text-foreground/40 uppercase tracking-widest mb-4">
          {epoch.prev_weights
            ? `Changes vs round #${epoch.id - 1}`
            : `No previous round to compare`}
        </p>
        {!epoch.prev_weights ? (
          <p className="text-sm text-foreground/45 italic">
            This is the oldest round in the ledger — no prior round to diff against.
          </p>
        ) : diffs.length === 0 ? (
          <p className="text-sm text-foreground/45 italic">
            No weight changes from the previous round.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {diffs.map((d) => (
              <WeightDiffRow
                key={d.key}
                label={WEIGHT_LABELS[d.key] ?? d.key}
                before={d.before}
                after={d.after}
                delta={d.delta}
              />
            ))}
          </div>
        )}
      </section>

      {/* Divider */}
      <div className="h-px bg-border/60" />

      {/* ── Keyword diff ─────────────────────────────────── */}
      <section aria-label="Keyword rule changes">
        <p className="text-[10px] font-mono text-foreground/40 uppercase tracking-widest mb-4">
          Content rule changes
        </p>
        {!hasKeywordChanges ? (
          <p className="text-sm text-foreground/45 italic">
            No keyword changes this round.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {epoch.keywords_added?.include.map((w) => (
              <KeywordDiffRow key={`ai-${w}`} word={w} variant="add-include" />
            ))}
            {epoch.keywords_added?.exclude.map((w) => (
              <KeywordDiffRow key={`ae-${w}`} word={w} variant="add-exclude" />
            ))}
            {epoch.keywords_removed?.include.map((w) => (
              <KeywordDiffRow key={`ri-${w}`} word={w} variant="remove-include" />
            ))}
            {epoch.keywords_removed?.exclude.map((w) => (
              <KeywordDiffRow key={`re-${w}`} word={w} variant="remove-exclude" />
            ))}
          </div>
        )}
      </section>

      {/* Divider */}
      <div className="h-px bg-border/60" />

      {/* ── Per-round audit events ────────────────────────── */}
      <section aria-label={`Audit events for round ${epoch.id}`}>
        <p className="text-[10px] font-mono text-foreground/40 uppercase tracking-widest mb-2">
          Audit events · Round #{epoch.id}
        </p>
        {epochAudit.length === 0 ? (
          <EmptyState
            heading="No audit events"
            body="Evaluated the audit log — no events recorded for this round."
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
  const [pageState, setPageState] = useState<PageState>("loaded")
  const [selectedId, setSelectedId] = useState<number>(MOCK_EPOCHS[0].id)

  const epochs = MOCK_EPOCHS
  const selectedEpoch = epochs.find((e) => e.id === selectedId) ?? epochs[0]

  return (
    <AppShell user={null} activePath="/history">
      <div className="max-w-6xl mx-auto px-5 py-10 flex flex-col gap-8">

        {/* ── Page header ──────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-2xl font-bold text-foreground tracking-normal">
              Governance ledger
            </h1>
            <p className="text-sm text-foreground/50 leading-relaxed max-w-lg">
              Every weight change, keyword rule, and governance event — in full, forever. Select a round to inspect it.
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

        {/* ── Dev state switcher (hidden in production) ────── */}
        <div className="flex items-center gap-2 opacity-0 pointer-events-none h-0 overflow-hidden" aria-hidden="true">
          {(["loading", "loaded", "error", "empty"] as PageState[]).map((s) => (
            <button
              key={s}
              onClick={() => setPageState(s)}
              className={`text-xs px-2 py-1 rounded border ${pageState === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground/50"}`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* ── Error state ───────────────────────────────────── */}
        {pageState === "error" && (
          <ErrorCard
            heading="Ledger unavailable"
            body="We couldn't load governance history. The transparency record is still intact — try again shortly."
            onRetry={() => setPageState("loaded")}
          />
        )}

        {/* ── Empty state ───────────────────────────────────── */}
        {pageState === "empty" && (
          <EmptyState
            heading="No rounds yet"
            body="Governance history will appear here once the first round is complete."
            action={{ label: "Go to overview", onClick: () => {} }}
          />
        )}

        {/* ── Main 2-column layout ─────────────────────────── */}
        {(pageState === "loading" || pageState === "loaded") && (
          <div className="flex flex-col lg:flex-row gap-6 items-start">

            {/* ── LEFT: epoch timeline ─────────────────────── */}
            <aside
              className="w-full lg:w-56 lg:flex-shrink-0 flex flex-col gap-2 lg:sticky lg:top-20"
              aria-label="Epoch timeline"
            >
              <p className="text-[10px] font-mono text-foreground/40 uppercase tracking-widest px-1 mb-1">
                Rounds · newest first
              </p>

              {pageState === "loading" ? (
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
              ) : (
                <nav className="flex flex-row lg:flex-col gap-2 overflow-x-auto pb-2 lg:pb-0" aria-label="Select a round">
                  {epochs.map((epoch) => (
                    <div key={epoch.id} className="flex-shrink-0 w-44 sm:w-48 lg:w-auto">
                      <EpochCard
                        epoch={epoch}
                        selected={epoch.id === selectedId}
                        onClick={() => setSelectedId(epoch.id)}
                      />
                    </div>
                  ))}
                </nav>
              )}
            </aside>

            {/* ── RIGHT: detail panel ──────────────────────── */}
            <main className="w-full lg:flex-1 min-w-0 rounded-xl border border-border bg-card p-4 sm:p-6 lg:p-7">
              {pageState === "loading" ? (
                <DetailPanelSkeleton />
              ) : (
                <DetailPanel epoch={selectedEpoch} />
              )}
            </main>

          </div>
        )}

        {/* ── Full audit table (all epochs) ────────────────── */}
        {pageState === "loaded" && (
          <section aria-label="Full audit log">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-mono text-foreground/40 uppercase tracking-widest">
                Full audit log · {MOCK_AUDIT.length} of 120 entries
              </p>
              <span className="text-xs text-foreground/35 font-mono">
                Showing 50 most recent
              </span>
            </div>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-5 py-2.5 bg-biscuit/40 border-b border-border">
                <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wide">Event</span>
                <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wide w-14 text-center">Round</span>
                <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wide w-20 text-right">Time</span>
              </div>
              <div className="divide-y divide-border/60">
                {MOCK_AUDIT.map((entry) => (
                  <AuditRow key={entry.id} entry={entry} />
                ))}
              </div>
              {/* Pagination hint */}
              <div className="px-5 py-3 border-t border-border/60 flex items-center justify-between">
                <span className="text-xs text-foreground/40 font-mono">120 total · 50 shown</span>
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:text-primary-dark transition-colors"
                >
                  Load more
                </button>
              </div>
            </div>
          </section>
        )}

      </div>
    </AppShell>
  )
}
