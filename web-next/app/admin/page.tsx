"use client"

import {Fragment, useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { AppShell } from "@/components/app-shell"
import { SignInDialog } from "@/components/sign-in-dialog"
import { useAuth } from "@/components/auth-provider"
import { WeightBar } from "@/components/ui/weight-bar"
import { Button } from "@/components/ui/button"
import { EmptyState, ErrorCard, Skeleton } from "@/components/ui/state-kit"
import { adminApi, type AdminStatus } from "@/lib/api/admin"

// ── Helpers ───────────────────────────────────────────────────────────────────

const SIGNAL_LABELS: Record<string, string> = {
  recency: "Recency", engagement: "Engagement", bridging: "Bridging",
  source_diversity: "Source diversity", relevance: "Relevance",
}

const WEIGHT_KEYS = ["recency", "engagement", "bridging", "source_diversity", "relevance"] as const

function relTime(iso: string | null) {
  if (!iso) return "never"
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  })
}

type CurrentEpoch = NonNullable<AdminStatus["system"]["currentEpoch"]>
type EpochPhase = "running" | "voting" | "review" | "waiting"

/** Read the real `phase` off the current epoch (the status endpoint sends it
 *  even though the client type omits it), falling back to votingOpen/status. */
function epochPhase(epoch: CurrentEpoch | null): EpochPhase {
  if (!epoch) return "waiting"
  const phase = (epoch as { phase?: string }).phase
  if (phase === "results") return "review"
  if (phase === "voting" || phase === "review" || phase === "running") return phase
  if (epoch.votingOpen) return "voting"
  return "running"
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 pb-4 border-b border-border mb-5">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {sub && <p className="text-xs text-foreground/50">{sub}</p>}
    </div>
  )
}

// ── Confirm Modal (Escape-to-close + initial focus on Cancel) ──────────────────

function ConfirmModal({
  title, body, confirmLabel = "Confirm", danger = false, loading = false, onConfirm, onCancel,
}: {
  title: string; body: string; confirmLabel?: string; danger?: boolean; loading?: boolean
  onConfirm: () => void; onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // Initial focus lands on the safe (Cancel) action, and Escape closes.
    cancelRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) onCancel()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onCancel, loading])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={onCancel} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl flex flex-col gap-4">
        <h3 id="modal-title" className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-foreground/60 leading-relaxed">{body}</p>
        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-full border border-border text-sm font-medium text-foreground/60 hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors disabled:opacity-60 ${
              danger
                ? "bg-status-error text-white hover:bg-[hsl(8,60%,38%)]"
                : "bg-primary text-primary-foreground hover:bg-primary-dark"
            }`}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Panel: Overview ───────────────────────────────────────────────────────────

function PanelOverview({ status }: { status: AdminStatus }) {
  const epoch = status.system.currentEpoch
  const feed = status.system.feed

  if (!epoch) {
    return (
      <div className="flex flex-col gap-6">
        <SectionHeader title="Overview" sub="Live summary of the current round." />
        <EmptyState heading="No active round" body="There is no active governance round to summarise yet." showCorgi={false} />
      </div>
    )
  }

  const participation = feed.subscriberCount > 0
    ? Math.round((epoch.voteCount / feed.subscriberCount) * 100)
    : 0

  const stats = [
    { label: "Total posts scored", value: feed.scoredPosts.toLocaleString() },
    { label: "Votes this round", value: epoch.voteCount.toLocaleString() },
    { label: "Participation", value: `${participation}%` },
    { label: "Subscribers", value: feed.subscriberCount.toLocaleString() },
  ]

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Overview" sub="Live summary of the current round." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card px-4 py-4 flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-foreground/40">{s.label}</span>
            <span className="text-2xl font-mono font-bold text-foreground tabular-nums">{s.value}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-[10px] font-mono uppercase tracking-widest text-foreground/40">Applied weights</p>
        {Object.keys(epoch.weights).length === 0 ? (
          <p className="text-sm text-foreground/45 italic">No weights recorded for this round yet.</p>
        ) : (
          Object.entries(epoch.weights).map(([k, v]) => (
            <WeightBar key={k} label={SIGNAL_LABELS[k] ?? k} value={v} />
          ))
        )}
      </div>
      <div className="rounded-xl bg-biscuit/50 border border-border px-5 py-4 flex flex-col gap-2">
        <p className="text-xs text-foreground/50">
          Voting closes <span className="font-mono text-foreground/70">{fmtDateTime(epoch.votingEndsAt)}</span>
        </p>
      </div>
    </div>
  )
}

// ── Panel: Current Round ──────────────────────────────────────────────────────

function PanelCurrentRound({ status }: { status: AdminStatus }) {
  const queryClient = useQueryClient()
  const epoch = status.system.currentEpoch
  const feed = status.system.feed
  const phase = epochPhase(epoch)
  const [confirm, setConfirm] = useState<null | "open" | "close" | "apply">(null)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "status"] })
    void queryClient.invalidateQueries({ queryKey: ["admin", "epochs"] })
    void queryClient.invalidateQueries({ queryKey: ["admin", "feed-health"] })
  }

  const openMutation = useMutation({ mutationFn: () => adminApi.openVoting(), onSuccess: () => { invalidate(); setConfirm(null) } })
  const closeMutation = useMutation({ mutationFn: () => adminApi.closeVoting(), onSuccess: () => { invalidate(); setConfirm(null) } })
  const applyMutation = useMutation({ mutationFn: () => adminApi.transitionEpoch(), onSuccess: () => { invalidate(); setConfirm(null) } })

  if (!epoch) {
    return (
      <div className="flex flex-col gap-6">
        <SectionHeader title="Current round" sub="Manage the round lifecycle." />
        <EmptyState heading="No active round" body="There is no active round to manage." showCorgi={false} />
      </div>
    )
  }

  const pct = feed.subscriberCount > 0 ? Math.round((epoch.voteCount / feed.subscriberCount) * 100) : 0

  // One row per lifecycle stage (no duplicate `running` row — only one is active).
  const LIFECYCLE: Array<{ phase: EpochPhase; label: string; action?: "open" | "close" | "apply"; actionLabel?: string; danger?: boolean }> = [
    { phase: "running", label: "Running", action: "open", actionLabel: "Open voting" },
    { phase: "voting", label: "Voting", action: "close", actionLabel: "Close voting" },
    { phase: "review", label: "Review", action: "apply", actionLabel: "Apply weights", danger: true },
  ]

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Current round" sub={`Manage the lifecycle of Round #${epoch.id}.`} />

      {/* Participation */}
      <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">Participation</p>
          <span className="text-sm font-mono font-semibold text-foreground tabular-nums">{epoch.voteCount} / {feed.subscriberCount}</span>
        </div>
        <div className="h-2 rounded-full bg-biscuit overflow-hidden">
          <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-foreground/45">{pct}% of members have voted this round.</p>
      </div>

      {/* Lifecycle actions */}
      <div className="flex flex-col gap-3">
        <p className="text-[10px] font-mono uppercase tracking-widest text-foreground/40 mb-1">Lifecycle actions</p>
        {LIFECYCLE.map((lc) => {
          const isCurrentPhase = lc.phase === phase
          return (
            <div key={lc.phase} className={`rounded-xl border px-5 py-4 flex items-center justify-between gap-4 transition-colors
              ${isCurrentPhase ? "border-primary/30 bg-primary/5" : "border-border bg-card opacity-50"}`}>
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isCurrentPhase ? "bg-primary" : "bg-border"}`} />
                <span className="text-sm font-medium text-foreground">{lc.label}</span>
              </div>
              {lc.action && isCurrentPhase && (
                <button
                  onClick={() => setConfirm(lc.action!)}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    lc.danger
                      ? "bg-status-error/10 text-status-error border border-status-error/30 hover:bg-status-error/20"
                      : "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"
                  }`}
                >
                  {lc.actionLabel}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {confirm === "open" && (
        <ConfirmModal
          title={`Open voting for Round #${epoch.id}?`}
          body="This will open the round for member votes."
          confirmLabel="Open voting"
          loading={openMutation.isPending}
          onConfirm={() => openMutation.mutate()}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "close" && (
        <ConfirmModal
          title={`Close voting for Round #${epoch.id}?`}
          body="This will close voting and move the round to review. Members will no longer be able to submit votes."
          confirmLabel="Close voting"
          loading={closeMutation.isPending}
          onConfirm={() => closeMutation.mutate()}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "apply" && (
        <ConfirmModal
          title="Apply aggregated weights to live feed?"
          body="This will apply the community vote results and transition to the next round. This cannot be undone."
          confirmLabel="Apply weights"
          danger
          loading={applyMutation.isPending}
          onConfirm={() => applyMutation.mutate()}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

// ── Panel: Weights Override ───────────────────────────────────────────────────

function PanelWeightsOverride({ status }: { status: AdminStatus }) {
  const queryClient = useQueryClient()
  const epoch = status.system.currentEpoch

  // Seed from the live epoch weights (fall back to a neutral zeroed vector).
  const seed = (): Record<string, number> => {
    const base: Record<string, number> = {}
    for (const k of WEIGHT_KEYS) base[k] = epoch?.weights[k] ?? 0
    return base
  }

  const [weights, setWeights] = useState<Record<string, number>>(seed)
  const [confirm, setConfirm] = useState(false)

  const total = Object.values(weights).reduce((a, b) => a + b, 0)
  const isValid = Math.abs(total - 1) < 0.001

  const overrideMutation = useMutation({
    mutationFn: () => adminApi.updateWeights(weights),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "status"] })
      setConfirm(false)
    },
  })

  function setWeight(key: string, val: number) {
    setWeights((prev) => ({ ...prev, [key]: Math.max(0, Math.min(1, val)) }))
  }

  if (!epoch) {
    return (
      <div className="flex flex-col gap-6">
        <SectionHeader title="Weights override" sub="Manually override the community-voted weights." />
        <EmptyState heading="No active round" body="There is no active round whose weights can be overridden." showCorgi={false} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Weights override" sub="Manually override the community-voted weights. Use with care." />
      <div className="flex flex-col gap-4">
        {WEIGHT_KEYS.map((k) => (
          <div key={k} className="flex items-center gap-4">
            <span className="text-sm font-medium text-foreground w-36 flex-shrink-0">{SIGNAL_LABELS[k] ?? k}</span>
            <input
              type="range"
              min={0} max={100} step={1}
              value={Math.round((weights[k] ?? 0) * 100)}
              onChange={(e) => setWeight(k, Number(e.target.value) / 100)}
              className="flex-1 accent-primary"
              aria-label={SIGNAL_LABELS[k]}
            />
            <span className="text-sm font-mono font-semibold text-foreground tabular-nums w-10 text-right">{Math.round((weights[k] ?? 0) * 100)}%</span>
          </div>
        ))}
      </div>
      <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm transition-colors ${isValid ? "bg-success/10 border-success/20 text-success" : "bg-tongue/10 border-tongue/30 text-tongue-foreground"}`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isValid ? "bg-success" : "bg-tongue"}`} />
        <span className="font-mono font-semibold">{(total * 100).toFixed(0)}%</span>
        <span className="text-foreground/50 ml-1">{isValid ? "weights sum to 100% — ready to apply" : "weights must sum to 100%"}</span>
      </div>
      {overrideMutation.isError && (
        <p className="text-sm text-status-error">Failed to override weights. Please try again.</p>
      )}
      <div className="flex justify-end gap-3">
        <button
          onClick={() => setWeights(seed())}
          className="px-4 py-2 rounded-full border border-border text-sm font-medium text-foreground/60 hover:text-foreground transition-colors"
        >
          Reset to vote results
        </button>
        <button
          disabled={!isValid}
          onClick={() => setConfirm(true)}
          className="px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-40 disabled:pointer-events-none shadow-[0_2px_8px_rgba(200,97,44,0.3)]"
        >
          Override weights
        </button>
      </div>
      {confirm && (
        <ConfirmModal
          title="Override community-voted weights?"
          body="This will immediately replace the aggregated vote weights with the values you've set. Members will see the new weights in the dashboard."
          confirmLabel="Apply override"
          danger
          loading={overrideMutation.isPending}
          onConfirm={() => overrideMutation.mutate()}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  )
}

// ── Panel: Content Filters ────────────────────────────────────────────────────

function PanelContentFilters({ status }: { status: AdminStatus }) {
  const queryClient = useQueryClient()
  const include = status.system.contentRules.includeKeywords
  const exclude = status.system.contentRules.excludeKeywords

  const [addInclude, setAddInclude] = useState("")
  const [addExclude, setAddExclude] = useState("")
  const [removingConfirm, setRemovingConfirm] = useState<{ list: "include" | "exclude"; kw: string } | null>(null)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin", "status"] })

  const addMutation = useMutation({
    mutationFn: ({ list, keyword }: { list: "include" | "exclude"; keyword: string }) => adminApi.addKeyword(list, keyword),
    onSuccess: (_data, vars) => {
      void invalidate()
      if (vars.list === "include") setAddInclude(""); else setAddExclude("")
    },
  })
  const removeMutation = useMutation({
    mutationFn: ({ list, keyword }: { list: "include" | "exclude"; keyword: string }) => adminApi.removeKeyword(list, keyword, true),
    onSuccess: () => { void invalidate(); setRemovingConfirm(null) },
  })

  function submitAdd(list: "include" | "exclude") {
    const val = (list === "include" ? addInclude : addExclude).trim().toLowerCase()
    if (!val) return
    addMutation.mutate({ list, keyword: val })
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Content filters" sub="Keywords boosted or suppressed community-wide." />

      {(["include", "exclude"] as const).map((list) => {
        const keywords = list === "include" ? include : exclude
        const addVal = list === "include" ? addInclude : addExclude
        const setAdd = list === "include" ? setAddInclude : setAddExclude
        const chipBg = list === "include" ? "bg-success/10 border-success/20 text-success" : "bg-tongue/15 border-tongue/30 text-tongue-foreground"
        const prefix = list === "include" ? "+" : "−"

        return (
          <div key={list} className="flex flex-col gap-3">
            <p className="text-[10px] font-mono uppercase tracking-widest text-foreground/40 capitalize">{list} keywords</p>
            <div className="flex flex-wrap gap-2 min-h-[2rem]">
              {keywords.map((kw) => (
                <span key={kw} className={`inline-flex items-center gap-1.5 text-xs font-mono font-medium px-2.5 py-1 rounded-full border ${chipBg}`}>
                  {prefix}{kw}
                  <button
                    onClick={() => setRemovingConfirm({ list, kw })}
                    aria-label={`Remove ${kw}`}
                    className="hover:text-status-error transition-colors"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                      <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </span>
              ))}
              {keywords.length === 0 && <span className="text-xs text-foreground/35 italic">None active</span>}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={addVal}
                onChange={(e) => setAdd(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitAdd(list)}
                placeholder={`Add ${list} keyword…`}
                className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                onClick={() => submitAdd(list)}
                disabled={!addVal.trim() || addMutation.isPending}
                className="px-4 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 text-sm font-medium hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                Add
              </button>
            </div>
          </div>
        )
      })}

      {addMutation.isError && (
        <p className="text-sm text-status-error">Failed to add keyword. Please try again.</p>
      )}

      {removingConfirm && (
        <ConfirmModal
          title={`Remove "${removingConfirm.kw}" from ${removingConfirm.list} list?`}
          body="This keyword will no longer be used to filter feed content."
          confirmLabel="Remove keyword"
          danger
          loading={removeMutation.isPending}
          onConfirm={() => removeMutation.mutate({ list: removingConfirm.list, keyword: removingConfirm.kw })}
          onCancel={() => setRemovingConfirm(null)}
        />
      )}
    </div>
  )
}

// ── Panel: Topics ─────────────────────────────────────────────────────────────

function PanelTopics() {
  const queryClient = useQueryClient()
  const topicsQuery = useQuery({ queryKey: ["admin", "topics"], queryFn: adminApi.getTopics, retry: false })
  const [confirmDisable, setConfirmDisable] = useState<{ slug: string; name: string } | null>(null)

  const disableMutation = useMutation({
    mutationFn: (slug: string) => adminApi.deactivateTopic(slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "topics"] })
      setConfirmDisable(null)
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Topics" sub="Active topic groups used in relevance scoring." />

      {topicsQuery.isLoading ? (
        <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/60" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          ))}
        </div>
      ) : topicsQuery.isError ? (
        <ErrorCard heading="Topics unavailable" body="We couldn't load the topic catalog." onRetry={() => void topicsQuery.refetch()} />
      ) : (topicsQuery.data ?? []).length === 0 ? (
        <EmptyState heading="No topics configured" body="No topic groups have been created yet." showCorgi={false} />
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-biscuit/30">
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-foreground/40 font-normal">Topic</th>
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-foreground/40 font-normal hidden sm:table-cell">Group</th>
                <th className="text-right px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-foreground/40 font-normal">Weight</th>
                <th className="text-right px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-foreground/40 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {(topicsQuery.data ?? []).map((t) => (
                <tr key={t.slug} className="border-b border-border/50 last:border-b-0 hover:bg-biscuit/20 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{t.name}</td>
                  <td className="px-4 py-3 text-foreground/45 text-xs font-mono hidden sm:table-cell">{t.parentSlug ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-foreground/70">
                    {t.currentWeight != null ? `${Math.round(t.currentWeight * 100)}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {t.isActive ? (
                      <button
                        onClick={() => setConfirmDisable({ slug: t.slug, name: t.name })}
                        className="text-xs font-semibold px-3 py-1 rounded-full border bg-success/10 border-success/20 text-success hover:bg-success/20 transition-colors"
                      >
                        Enabled
                      </button>
                    ) : (
                      <span className="text-xs font-semibold px-3 py-1 rounded-full border bg-biscuit border-border text-foreground/45">
                        Disabled
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDisable && (
        <ConfirmModal
          title={`Disable "${confirmDisable.name}"?`}
          body="This topic will no longer affect relevance scoring. Members' topic votes for this group will be ignored."
          confirmLabel="Disable topic"
          danger
          loading={disableMutation.isPending}
          onConfirm={() => disableMutation.mutate(confirmDisable.slug)}
          onCancel={() => setConfirmDisable(null)}
        />
      )}
    </div>
  )
}

// ── Panel: Audit Log ──────────────────────────────────────────────────────────

const AUDIT_PAGE_SIZE = 25

function PanelAuditLog() {
  const [limit, setLimit] = useState(AUDIT_PAGE_SIZE)
  const [expanded, setExpanded] = useState<number | null>(null)
  const auditQuery = useQuery({
    queryKey: ["admin", "audit-log", limit],
    queryFn: () => adminApi.getAuditLog({ limit }),
    retry: false,
    placeholderData: (prev) => prev,
  })

  const entries = auditQuery.data?.entries ?? []
  const total = auditQuery.data?.total ?? 0

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Audit log" sub="All admin actions, newest first." />

      {auditQuery.isLoading ? (
        <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/60" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3.5">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      ) : auditQuery.isError ? (
        <ErrorCard heading="Audit log unavailable" body="We couldn't load the admin audit log." onRetry={() => void auditQuery.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState heading="No audit entries yet" body="Admin actions will appear here once activity begins." showCorgi={false} />
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-biscuit/30">
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-foreground/40 font-normal">Action</th>
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-foreground/40 font-normal hidden md:table-cell">Actor</th>
                <th className="text-right px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-foreground/40 font-normal hidden sm:table-cell">Round</th>
                <th className="text-right px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-foreground/40 font-normal">When</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isExpanded = expanded === entry.id
                const hasDetails = entry.details != null && Object.keys(entry.details).length > 0
                return (
                  <Fragment key={entry.id}>
                    <tr
                      className="border-b border-border/50 last:border-b-0 hover:bg-biscuit/20 transition-colors cursor-pointer"
                      onClick={() => hasDetails && setExpanded(isExpanded ? null : entry.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full flex-shrink-0 bg-primary/50" aria-hidden="true" />
                          <span className="font-mono text-xs text-foreground/80">{entry.action}</span>
                          {hasDetails && (
                            <svg
                              width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"
                              className={`text-foreground/30 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            >
                              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-foreground/50 hidden md:table-cell">
                        {entry.actor ? entry.actor.slice(-8) : <span className="italic text-foreground/30">system</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-foreground/50 hidden sm:table-cell">
                        {entry.epochId != null ? `#${entry.epochId}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-foreground/50 tabular-nums" title={entry.timestamp}>{relTime(entry.timestamp)}</td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${entry.id}-details`} className="border-b border-border/30 bg-biscuit/20">
                        <td colSpan={4} className="px-6 py-3">
                          <pre className="text-xs font-mono text-foreground/60 whitespace-pre-wrap">{JSON.stringify(entry.details, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-border/60 flex items-center justify-between">
            <span className="text-xs text-foreground/40 font-mono">{total} total · {entries.length} shown</span>
            {entries.length < total && (
              <button
                type="button"
                onClick={() => setLimit((l) => l + AUDIT_PAGE_SIZE)}
                disabled={auditQuery.isFetching}
                className="text-xs font-medium text-primary hover:text-primary-dark transition-colors disabled:opacity-40"
              >
                {auditQuery.isFetching ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Panel: Feed Health ────────────────────────────────────────────────────────

function PanelFeedHealth() {
  const healthQuery = useQuery({ queryKey: ["admin", "feed-health"], queryFn: adminApi.getFeedHealth, retry: false })

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Feed health" sub="Ingestion, scoring, and subscriber vitals." />

      {healthQuery.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card px-5 py-4 flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      ) : healthQuery.isError || !healthQuery.data ? (
        <ErrorCard heading="Feed health unavailable" body="We couldn't load feed health metrics." onRetry={() => void healthQuery.refetch()} />
      ) : (
        (() => {
          const h = healthQuery.data
          const metrics = [
            { label: "Total posts", value: h.database.totalPosts.toLocaleString(), hint: `${h.database.postsLast24h.toLocaleString()} in last 24h` },
            { label: "Posts (7d)", value: h.database.postsLast7d.toLocaleString(), hint: "Ingested in the last 7 days" },
            { label: "Posts scored", value: h.scoring.postsScored.toLocaleString(), hint: `Last run ${relTime(h.scoring.lastRun)}` },
            { label: "Posts filtered", value: h.scoring.postsFiltered.toLocaleString(), hint: "Removed by content rules" },
            { label: "Subscribers", value: h.subscribers.total.toLocaleString(), hint: `${h.subscribers.withVotes.toLocaleString()} voted · ${h.subscribers.activeLastWeek.toLocaleString()} active/wk` },
            { label: "Feed size", value: (h.feedSize ?? 0).toLocaleString(), hint: "Posts in the live ranked feed" },
          ]
          return (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {metrics.map((m) => (
                  <div key={m.label} className="rounded-xl border border-border bg-card px-5 py-4 flex flex-col gap-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-foreground/40">{m.label}</span>
                    <span className="text-2xl font-mono font-bold text-foreground tabular-nums">{m.value}</span>
                    <span className="text-xs text-foreground/45 leading-relaxed">{m.hint}</span>
                  </div>
                ))}
              </div>

              {/* Jetstream status strip */}
              <div className={`flex items-center gap-3 px-5 py-4 rounded-xl border text-sm ${h.jetstream.connected ? "bg-success/10 border-success/20 text-success" : "bg-status-error/10 border-status-error/25 text-status-error"}`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${h.jetstream.connected ? "bg-success animate-pulse" : "bg-status-error"}`} aria-hidden="true" />
                <span className="font-semibold">Jetstream {h.jetstream.connected ? "connected" : "disconnected"}</span>
                <span className="text-foreground/50 ml-1">
                  {h.jetstream.connected
                    ? `${h.jetstream.eventsLast5min.toLocaleString()} events in last 5 min`
                    : `down for ${h.jetstream.disconnectedForSeconds ?? 0}s · last event ${relTime(h.jetstream.lastEvent)}`}
                </span>
              </div>
            </>
          )
        })()
      )}
    </div>
  )
}

// ── Panel: Announcements ──────────────────────────────────────────────────────

function PanelAnnouncements() {
  const queryClient = useQueryClient()
  const announcementsQuery = useQuery({ queryKey: ["admin", "announcements"], queryFn: adminApi.getAnnouncements, retry: false })

  const [content, setContent] = useState("")
  const [includeEpochLink, setIncludeEpochLink] = useState(true)
  const [confirmPost, setConfirmPost] = useState(false)

  const postMutation = useMutation({
    mutationFn: () => adminApi.postAnnouncement({ content: content.trim(), includeEpochLink }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "announcements"] })
      setContent("")
      setConfirmPost(false)
    },
  })

  const items = announcementsQuery.data?.announcements ?? []

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Announcements" sub="Community-facing notices posted to the feed's Bluesky account." />

      {/* Composer */}
      <div className="rounded-xl border border-border bg-biscuit/30 p-5 flex flex-col gap-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write an announcement to post to Bluesky…"
          rows={3}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
        />
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-foreground/60">
            <input type="checkbox" checked={includeEpochLink} onChange={(e) => setIncludeEpochLink(e.target.checked)} className="accent-primary" />
            Include a link to the current round
          </label>
          <button
            onClick={() => setConfirmPost(true)}
            disabled={!content.trim() || postMutation.isPending}
            className="px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            Post announcement
          </button>
        </div>
        {postMutation.isError && (
          <p className="text-sm text-status-error">Failed to post the announcement. Please try again.</p>
        )}
      </div>

      {/* List */}
      {announcementsQuery.isLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card px-5 py-4 flex flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      ) : announcementsQuery.isError ? (
        <ErrorCard heading="Announcements unavailable" body="We couldn't load recent announcements." onRetry={() => void announcementsQuery.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState heading="No announcements yet" body="Posted announcements will appear here." showCorgi={false} />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((a) => (
            <div key={a.id} className="rounded-xl border border-border bg-card px-5 py-4 flex items-start gap-4">
              <div className="flex-1 flex flex-col gap-1 min-w-0">
                <p className="text-sm text-foreground/80 leading-relaxed">{a.content}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-mono text-foreground/30">{relTime(a.postedAt)}</span>
                  {a.type && <span className="text-[10px] font-mono text-foreground/30">· {a.type}</span>}
                </div>
              </div>
              {a.postUrl && (
                <a
                  href={a.postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-primary hover:text-primary-dark transition-colors flex-shrink-0"
                >
                  View ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {confirmPost && (
        <ConfirmModal
          title="Post this announcement to Bluesky?"
          body="This will publish the announcement to the feed's Bluesky account, where all members can see it."
          confirmLabel="Post announcement"
          loading={postMutation.isPending}
          onConfirm={() => postMutation.mutate()}
          onCancel={() => setConfirmPost(false)}
        />
      )}
    </div>
  )
}

// ── Phase banner meta ─────────────────────────────────────────────────────────

const PHASE_META: Record<EpochPhase, { label: string; color: string; dot: string }> = {
  running: { label: "Running", color: "bg-success/15 border-success/25 text-success", dot: "bg-success" },
  voting: { label: "Voting open", color: "bg-primary/10 border-primary/20 text-primary", dot: "bg-primary animate-pulse" },
  review: { label: "Under review", color: "bg-warning/15 border-warning/25 text-warning", dot: "bg-warning" },
  waiting: { label: "Waiting", color: "bg-biscuit border-border text-foreground/50", dot: "bg-foreground/30" },
}

// ── Nav items ─────────────────────────────────────────────────────────────────

const NAV_PANELS = [
  { id: "overview", label: "Overview" },
  { id: "current-round", label: "Current round" },
  { id: "weights", label: "Weights override" },
  { id: "filters", label: "Content filters" },
  { id: "topics", label: "Topics" },
  { id: "audit", label: "Audit log" },
  { id: "feed-health", label: "Feed health" },
  { id: "announcements", label: "Announcements" },
]

// ── Authenticated admin console ───────────────────────────────────────────────

function AdminConsole({ status }: { status: AdminStatus }) {
  const [activePanel, setActivePanel] = useState("overview")
  const epoch = status.system.currentEpoch
  const phase = epochPhase(epoch)
  const phaseMeta = PHASE_META[phase]

  const panels: Record<string, React.ReactNode> = {
    "overview": <PanelOverview status={status} />,
    "current-round": <PanelCurrentRound status={status} />,
    "weights": <PanelWeightsOverride status={status} />,
    "filters": <PanelContentFilters status={status} />,
    "topics": <PanelTopics />,
    "audit": <PanelAuditLog />,
    "feed-health": <PanelFeedHealth />,
    "announcements": <PanelAnnouncements />,
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-3.5rem)]">
      {/* ── Governance phase banner ───────────────────────────── */}
      <div className={`w-full border-b px-5 py-2.5 flex items-center gap-3 ${phaseMeta.color}`}>
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${phaseMeta.dot}`} aria-hidden="true" />
        <span className="text-xs font-semibold">
          {epoch ? `Round #${epoch.id} · ${phaseMeta.label}` : "No active round"}
        </span>
        <span className="text-xs opacity-60 hidden sm:block">
          {epoch && phase === "voting" && epoch.votingEndsAt ? `Closes ${fmtDateTime(epoch.votingEndsAt)}` : ""}
        </span>
        {epoch && (
          <span className="ml-auto text-[10px] font-mono opacity-50 hidden md:block">
            {epoch.voteCount} / {status.system.feed.subscriberCount} voted
          </span>
        )}
      </div>

      {/* Mobile panel nav */}
      <div className="md:hidden w-full border-b border-border bg-card px-4 py-3 flex gap-2 overflow-x-auto flex-shrink-0">
        {NAV_PANELS.map((p) => (
          <button
            key={p.id}
            onClick={() => setActivePanel(p.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border
              ${activePanel === p.id
                ? "bg-primary/10 text-primary border-primary/20"
                : "text-foreground/55 border-border hover:text-foreground"
              }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── 2-col layout: sidebar + content ─────────────────────── */}
      <div className="flex flex-1 min-h-0">
        <nav
          className="hidden md:flex flex-col w-52 flex-shrink-0 border-r border-border bg-card px-3 py-5 gap-0.5 sticky top-[calc(3.5rem+2.5rem)] self-start"
          style={{ maxHeight: "calc(100vh - 3.5rem - 2.5rem)", overflowY: "auto" }}
          aria-label="Admin panels"
        >
          <span className="text-[9px] font-mono uppercase tracking-widest text-foreground/30 px-3 pb-2">Admin console</span>
          {NAV_PANELS.map((p) => (
            <button
              key={p.id}
              onClick={() => setActivePanel(p.id)}
              aria-current={activePanel === p.id ? "page" : undefined}
              className={`text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors
                ${activePanel === p.id
                  ? "bg-primary/10 text-primary"
                  : "text-foreground/60 hover:text-foreground hover:bg-biscuit/60"
                }`}
            >
              {p.label}
            </button>
          ))}
        </nav>

        <main className="flex-1 min-w-0 px-4 sm:px-6 py-7 max-w-4xl">
          {panels[activePanel]}
        </main>
      </div>
    </div>
  )
}

// ── Gating UIs ────────────────────────────────────────────────────────────────

function AdminLoading() {
  return (
    <div className="max-w-4xl mx-auto w-full px-5 py-10 flex flex-col gap-6" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-xl" />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { isAuthenticated } = useAuth()
  const [signInOpen, setSignInOpen] = useState(false)

  const statusQuery = useQuery({
    queryKey: ["admin", "status"],
    queryFn: adminApi.getStatus,
    enabled: isAuthenticated,
    retry: false,
  })

  let body: React.ReactNode

  if (!isAuthenticated) {
    body = (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-[440px] flex flex-col items-center text-center gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-xl font-bold text-foreground tracking-normal">Admin sign-in required</h1>
            <p className="text-sm text-foreground/60 leading-relaxed">
              The admin console is restricted to feed operators. Sign in with an authorised Bluesky account to continue.
            </p>
          </div>
          <Button
            onClick={() => setSignInOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary-dark rounded-full px-8 text-sm shadow-[0_2px_8px_rgba(200,97,44,0.3)] hover:shadow-[0_4px_14px_rgba(200,97,44,0.4)] transition-all"
          >
            Connect Bluesky
          </Button>
        </div>
      </div>
    )
  } else if (statusQuery.isLoading) {
    body = <AdminLoading />
  } else if (statusQuery.isError) {
    const code = axios.isAxiosError(statusQuery.error) ? statusQuery.error.response?.status : undefined
    body = code === 401 ? (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-md">
          <EmptyState
            heading="Session expired"
            body="Your session has ended. Sign in again to access the admin console."
            showCorgi={false}
            action={{ label: "Sign in", onClick: () => setSignInOpen(true) }}
          />
        </div>
      </div>
    ) : code === 403 ? (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-md">
          <EmptyState
            heading="Access denied"
            body="Your account isn't authorised to view the admin console. If you believe this is a mistake, contact a feed operator."
            showCorgi={false}
          />
        </div>
      </div>
    ) : (
      <div className="max-w-md mx-auto px-5 py-20">
        <ErrorCard
          heading="Admin console unavailable"
          body="We couldn't load the admin console. Try again in a moment."
          onRetry={() => void statusQuery.refetch()}
        />
      </div>
    )
  } else if (!statusQuery.data?.isAdmin) {
    body = (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-md">
          <EmptyState
            heading="Access denied"
            body="Your account isn't authorised to view the admin console."
            showCorgi={false}
          />
        </div>
      </div>
    )
  } else {
    body = <AdminConsole status={statusQuery.data} />
  }

  return (
    <AppShell>
      {body}
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </AppShell>
  )
}
