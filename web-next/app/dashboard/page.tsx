"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AppShell } from "@/components/app-shell"
import { WeightBar } from "@/components/ui/weight-bar"
import { StatusChip } from "@/components/ui/status-chip"
import { StatClusterSkeleton, WeightsSkeleton, EmptyState, ErrorCard } from "@/components/ui/state-kit"
import { Button } from "@/components/ui/button"

/* ─── Mock data (exact field names from the brief seam) ─── */
const MOCK_STATS = {
  epoch: { id: 47, phase: "voting" },
  feed_stats: {
    total_posts_scored: 1240,
    unique_authors: 318,
    avg_bridging: 0.41,
    median_bridging: 0.39,
    avg_engagement_score: 0.52,
    median_engagement: 0.48,
    avg_total: 0.57,
    median_total: 0.55,
  },
  governance: { votes_this_epoch: 312 },
  metrics: {
    author_gini: 0.34,
    vs_chronological_overlap: 0.61,
    vs_engagement_overlap: 0.44,
  },
}

const MOCK_WEIGHTS = {
  recency: 0.35,
  engagement: 0.25,
  bridging: 0.20,
  source_diversity: 0.15,
  relevance: 0.05,
}

const MOCK_ROUND_DIFF = {
  current_round: 47,
  previous_round: 46,
  voter_count: 312,
  applied_at: "2026-06-25T00:00:00Z",
  weight_changes: [
    { key: "recency",          before: 0.30, after: 0.35, delta: 0.05 },
    { key: "engagement",       before: 0.30, after: 0.25, delta: -0.05 },
    { key: "source_diversity", before: 0.10, after: 0.15, delta: 0.05 },
  ],
  keywords_added:   { include: ["ai"],  exclude: [] },
  keywords_removed: { include: [],      exclude: ["nft"] },
}

const MOCK_LEDGER = [
  { id: 991, action: "weights_applied", epoch_id: 47, created_at: "2026-06-25T00:00:00Z" },
  { id: 990, action: "vote_submitted",  epoch_id: 47, created_at: "2026-06-24T18:32:00Z" },
  { id: 989, action: "epoch_opened",    epoch_id: 47, created_at: "2026-06-24T00:00:00Z" },
  { id: 988, action: "weights_applied", epoch_id: 46, created_at: "2026-06-18T00:00:00Z" },
]

const WEIGHT_LABELS: Record<string, string> = {
  recency: "Recency",
  engagement: "Engagement",
  bridging: "Bridging",
  source_diversity: "Source diversity",
  relevance: "Relevance",
}

type PageState = "loading" | "loaded" | "error"

/* ─── Sub-components ───────────────────────────────────── */

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground/50 uppercase tracking-wide">{label}</span>
      <span className="text-2xl font-mono font-bold text-foreground tabular-nums">{value}</span>
      {sub && <span className="text-xs text-foreground/45 font-mono">{sub}</span>}
    </div>
  )
}

function DeltaChip({ delta }: { delta: number }) {
  const isPos = delta > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-mono font-semibold px-1.5 py-0.5 rounded-md
      ${isPos ? "bg-success/10 text-success" : "bg-tongue/15 text-tongue-foreground"}`}>
      {isPos ? "+" : ""}{(delta * 100).toFixed(0)}pp
    </span>
  )
}

function KeywordChip({ word, variant }: { word: string; variant: "add" | "remove" }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-mono px-2.5 py-0.5 rounded-full border
      ${variant === "add"
        ? "bg-success/10 border-success/25 text-success"
        : "bg-tongue/15 border-tongue/25 text-tongue-foreground line-through"
      }`}>
      {variant === "add" ? "+" : "−"}{word}
    </span>
  )
}

function SectionHeader({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 mb-4 flex-wrap">
      <h2 className="text-sm font-semibold text-foreground/55 uppercase tracking-widest">{label}</h2>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

function ProofRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex-shrink-0 text-primary">{icon}</span>
      <p className="text-sm text-foreground/70 leading-relaxed">{text}</p>
    </div>
  )
}

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

/* ─── Page ─────────────────────────────────────────────── */

export default function DashboardPage() {
  const router = useRouter()
  const [pageState, setPageState] = useState<PageState>("loaded")
  const [explainUri, setExplainUri] = useState("")
  const [lastUpdated] = useState(() => new Date())

  const stats = MOCK_STATS
  const weights = MOCK_WEIGHTS
  const diff = MOCK_ROUND_DIFF
  const ledger = MOCK_LEDGER

  return (
    <AppShell user={null}>
      <div className="max-w-5xl mx-auto px-5 py-10 flex flex-col gap-10">

        {/* ── Page header ──────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5">
              <h1 className="font-display text-2xl font-bold text-foreground tracking-tight">
                Transparency overview
              </h1>
              <StatusChip phase={stats.epoch.phase} />
            </div>
            <p className="text-sm text-foreground/55">
              Round #{stats.epoch.id} · {stats.governance.votes_this_epoch} votes ·{" "}
              <span className="font-mono text-xs">
                Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Dev-only state switcher */}
            <div className="hidden" aria-hidden="true">
              {(["loading", "loaded", "error"] as PageState[]).map((s) => (
                <button key={s} onClick={() => setPageState(s)}
                  className={`text-xs px-2 py-1 rounded border ${pageState === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground/50"}`}>
                  {s}
                </button>
              ))}
            </div>
            <Button asChild variant="outline" size="sm"
              className="border-border text-foreground/70 hover:text-foreground hover:bg-biscuit text-xs rounded-full">
              <Link href="/vote">Vote now</Link>
            </Button>
            <Button asChild size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary-dark text-xs rounded-full shadow-[0_2px_8px_rgba(200,97,44,0.3)] transition-all">
              <a href="https://bsky.app" target="_blank" rel="noopener noreferrer">Live feed ↗</a>
            </Button>
          </div>
        </div>

        {/* ── Stat cluster ────────────────────────────────── */}
        <section aria-label="Feed statistics">
          {pageState === "loading" ? (
            <StatClusterSkeleton />
          ) : pageState === "error" ? (
            <ErrorCard heading="Overview unavailable" body="We couldn't load feed statistics." onRetry={() => setPageState("loaded")} />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Posts scored" value={stats.feed_stats.total_posts_scored.toLocaleString()} sub={`Round #${stats.epoch.id}`} />
              <StatCard label="Unique authors" value={stats.feed_stats.unique_authors.toLocaleString()} />
              <StatCard label="Community votes" value={stats.governance.votes_this_epoch.toLocaleString()} sub="this round" />
              <StatCard label="Avg total score" value={stats.feed_stats.avg_total.toFixed(2)} sub={`median ${stats.feed_stats.median_total.toFixed(2)}`} />
            </div>
          )}
        </section>

        {/* ── Feed health strip ────────────────────────────── */}
        {pageState === "loaded" && (
          <section aria-label="Feed health metrics">
            <SectionHeader label="Feed health" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-1">
                <span className="text-xs text-foreground/50 uppercase tracking-wide font-medium">Author concentration</span>
                <span className="text-xl font-mono font-bold text-foreground">{stats.metrics.author_gini.toFixed(2)}</span>
                <span className="text-xs text-foreground/45">Gini coefficient · lower = more diverse</span>
              </div>
              <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-1">
                <span className="text-xs text-foreground/50 uppercase tracking-wide font-medium">vs. Chronological</span>
                <span className="text-xl font-mono font-bold text-foreground">{(stats.metrics.vs_chronological_overlap * 100).toFixed(0)}%</span>
                <span className="text-xs text-foreground/45">Overlap with time-only feed</span>
              </div>
              <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-1">
                <span className="text-xs text-foreground/50 uppercase tracking-wide font-medium">vs. Engagement</span>
                <span className="text-xl font-mono font-bold text-foreground">{(stats.metrics.vs_engagement_overlap * 100).toFixed(0)}%</span>
                <span className="text-xs text-foreground/45">Overlap with engagement-only feed</span>
              </div>
            </div>
          </section>
        )}

        {/* ── Active weights ───────────────────────────────── */}
        <section aria-label="Active community weights">
          <SectionHeader label="Active weight mix" />
          <div className="rounded-xl border border-border bg-card p-6">
            {pageState === "loading" ? (
              <WeightsSkeleton />
            ) : pageState === "error" ? (
              <EmptyState heading="Weights unavailable" body="Could not load the current weight mix." showCorgi={false} />
            ) : (
              <div className="flex flex-col gap-5">
                {Object.entries(weights).map(([key, val]) => (
                  <WeightBar key={key} label={WEIGHT_LABELS[key] ?? key} value={val} />
                ))}
                <p className="text-xs text-foreground/40 italic pt-1 border-t border-border/60">
                  Set by {stats.governance.votes_this_epoch} community votes · Round #{stats.epoch.id}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ── What changed this round ──────────────────────── */}
        <section aria-label="Round diff">
          <SectionHeader
            label={`What changed — round ${diff.previous_round} → ${diff.current_round}`}
            action={<span className="text-xs font-mono text-foreground/40">{diff.voter_count} voters</span>}
          />
          {diff.weight_changes.length === 0 && diff.keywords_added.include.length === 0 && diff.keywords_removed.exclude.length === 0 ? (
            <EmptyState heading="No changes this round" body="Weights and content rules stayed the same from the previous round." showCorgi={false} />
          ) : (
            <div className="rounded-xl border border-border bg-card divide-y divide-border/60">
              {diff.weight_changes.length > 0 && (
                <div className="p-5 flex flex-col gap-3">
                  <p className="text-xs font-semibold text-foreground/50 uppercase tracking-wide">Weight changes</p>
                  <div className="flex flex-col gap-3">
                    {diff.weight_changes.map((wc) => (
                      <div key={wc.key} className="flex items-center justify-between gap-2 sm:gap-4">
                        <span className="text-sm font-medium text-foreground w-24 sm:w-36 flex-shrink-0">{WEIGHT_LABELS[wc.key] ?? wc.key}</span>
                        <div className="flex items-center gap-2 flex-1">
                          <span className="text-xs font-mono text-foreground/45 w-8 text-right">{(wc.before * 100).toFixed(0)}%</span>
                          <div className="flex-1 h-1.5 rounded-full bg-biscuit overflow-hidden relative">
                            <div className="absolute inset-y-0 left-0 rounded-full bg-foreground/20" style={{ width: `${wc.before * 100}%` }} />
                            <div className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all" style={{ width: `${wc.after * 100}%` }} />
                          </div>
                          <span className="text-xs font-mono text-foreground w-8">{(wc.after * 100).toFixed(0)}%</span>
                        </div>
                        <DeltaChip delta={wc.delta} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(diff.keywords_added.include.length > 0 || diff.keywords_removed.exclude.length > 0) && (
                <div className="p-5 flex flex-col gap-3">
                  <p className="text-xs font-semibold text-foreground/50 uppercase tracking-wide">Content rule changes</p>
                  <div className="flex flex-wrap gap-2">
                    {diff.keywords_added.include.map((w) => <KeywordChip key={w} word={w} variant="add" />)}
                    {diff.keywords_removed.exclude.map((w) => <KeywordChip key={w} word={w} variant="remove" />)}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Explain a ranking ────────────────────────────── */}
        <section aria-label="Explain a post ranking">
          <SectionHeader label="Explain a ranking" />
          <div className="rounded-xl border border-border bg-card p-6 flex flex-col gap-4">
            <p className="text-sm text-foreground/60 leading-relaxed">
              Paste an AT-URI or Bluesky post URL to see exactly how it was scored — which signals lifted it and which held it back.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={explainUri}
                onChange={(e) => setExplainUri(e.target.value)}
                placeholder="at://did:plc:… or https://bsky.app/profile/…"
                className="flex-1 min-w-0 h-10 rounded-lg border border-border bg-background px-3.5 text-sm font-mono
                  text-foreground placeholder:text-foreground/35 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
              />
              <Button
                disabled={!explainUri.trim()}
                onClick={() => {
                  const encoded = encodeURIComponent(explainUri.trim())
                  router.push(`/post?uri=${encoded}`)
                }}
                className="bg-primary text-primary-foreground hover:bg-primary-dark rounded-lg px-5 text-sm disabled:opacity-40 transition-all shadow-[0_2px_8px_rgba(200,97,44,0.25)]"
              >
                Explain
              </Button>
            </div>
          </div>
        </section>

        {/* ── Ledger preview ───────────────────────────────── */}
        <section aria-label="Recent ledger activity">
          <SectionHeader
            label="Audit ledger"
            action={
              <Link href="/history" className="text-xs font-medium text-primary hover:text-primary-dark transition-colors">
                Open full ledger →
              </Link>
            }
          />
          {ledger.length === 0 ? (
            <EmptyState heading="No ledger entries yet" body="Audit events will appear here once governance activity begins." showCorgi={false} />
          ) : (
            <div className="rounded-xl border border-border bg-card divide-y divide-border/60 overflow-hidden">
              {ledger.map((entry) => {
                const date = new Date(entry.created_at)
                return (
                  <div key={entry.id} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-biscuit/30 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary/50 flex-shrink-0" aria-hidden="true" />
                      <span className="text-sm text-foreground/70 font-mono">{entry.action}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs font-mono text-foreground/40 hidden sm:block">
                        Round #{entry.epoch_id}
                      </span>
                      <time dateTime={entry.created_at} className="text-xs font-mono text-foreground/45" title={date.toLocaleString()}>
                        {date.toLocaleDateString([], { month: "short", day: "numeric" })}
                      </time>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ── What Corgi exposes (proof card) ──────────────── */}
        <section aria-label="What Corgi exposes">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-lg font-bold text-foreground">
                <em className="not-italic text-primary">No black box.</em> Ever.
              </h2>
              <p className="text-sm text-foreground/60 leading-relaxed max-w-xl">
                Every ranking decision Corgi makes is recorded. Here is exactly what is on public record.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ProofRow icon={<CheckIcon />} text="All community votes, by round" />
              <ProofRow icon={<CheckIcon />} text="The weight applied to every signal" />
              <ProofRow icon={<CheckIcon />} text="Per-post score decomposition" />
              <ProofRow icon={<CheckIcon />} text="Full epoch audit log" />
              <ProofRow icon={<CheckIcon />} text="Keyword include/exclude rules" />
              <ProofRow icon={<CheckIcon />} text="Counterfactual comparisons" />
            </div>
          </div>
        </section>

      </div>
    </AppShell>
  )
}
