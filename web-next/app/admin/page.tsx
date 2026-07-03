"use client"

import { useState } from "react"
import { AppShell } from "@/components/app-shell"
import { WeightBar } from "@/components/ui/weight-bar"
import { StatusChip } from "@/components/ui/status-chip"
import { ScoreBreakdown } from "@/components/ui/score-breakdown"

// ── Mock admin user ───────────────────────────────────────────────────────────

const MOCK_USER = { handle: "operator.bsky.social", did: "did:plc:admin001", isAdmin: true }

// ── Mock data (seam-exact field names) ───────────────────────────────────────

const MOCK_EPOCH = {
  id: 47,
  phase: "voting" as "voting" | "review" | "running" | "waiting",
  status: "open",
  vote_count: 312,
  subscriber_count: 480,
  voting_ends_at: "2026-07-01T17:00:00Z",
  created_at: "2026-06-25T00:00:00Z",
  weights: { recency: 0.35, engagement: 0.25, bridging: 0.20, source_diversity: 0.15, relevance: 0.05 },
}

const MOCK_PENDING_WEIGHTS = { recency: 0.30, engagement: 0.30, bridging: 0.20, source_diversity: 0.15, relevance: 0.05 }

const MOCK_CONTENT_FILTERS = {
  include_keywords: ["ai", "open-source", "science"],
  exclude_keywords: ["spam", "nsfw"],
}

const MOCK_TOPICS = [
  { slug: "machine-learning", name: "Machine learning", parentSlug: "technology", currentWeight: 0.62, enabled: true },
  { slug: "open-source",      name: "Open source",      parentSlug: "technology", currentWeight: 0.71, enabled: true },
  { slug: "science",          name: "Science",           parentSlug: null,         currentWeight: 0.50, enabled: true },
  { slug: "politics",         name: "Politics",          parentSlug: null,         currentWeight: 0.32, enabled: true },
  { slug: "sports",           name: "Sports",            parentSlug: null,         currentWeight: 0.28, enabled: false },
]

const MOCK_PARTICIPANTS = [
  { did: "did:plc:abc1", handle: "alice.bsky.social", voted_at: "2026-06-26T14:10:00Z", is_banned: false },
  { did: "did:plc:abc2", handle: "bob.bsky.social",   voted_at: "2026-06-26T09:22:00Z", is_banned: false },
  { did: "did:plc:abc3", handle: "spammer.bsky.social", voted_at: null,               is_banned: true  },
]

const MOCK_AUDIT = [
  { id: 995, action: "keyword_added",    actor_did: "did:plc:admin001", epoch_id: 47, details: { keyword: "ai", list: "include" },            created_at: "2026-06-26T15:00:00Z" },
  { id: 994, action: "topic_disabled",   actor_did: "did:plc:admin001", epoch_id: 47, details: { slug: "sports" },                             created_at: "2026-06-26T14:50:00Z" },
  { id: 993, action: "weights_applied",  actor_did: null,               epoch_id: 47, details: {},                                             created_at: "2026-06-25T00:00:00Z" },
  { id: 992, action: "round_opened",     actor_did: "did:plc:admin001", epoch_id: 47, details: {},                                             created_at: "2026-06-25T00:00:00Z" },
  { id: 991, action: "participant_banned", actor_did: "did:plc:admin001", epoch_id: 46, details: { did: "did:plc:abc3" },                      created_at: "2026-06-24T10:00:00Z" },
]

const MOCK_FEED_HEALTH = {
  author_gini: 0.34,
  vs_chronological_overlap: 0.61,
  vs_engagement_overlap: 0.44,
  avg_total: 0.57,
  median_total: 0.55,
  avg_bridging: 0.41,
  total_posts_scored: 1240,
}

const MOCK_ANNOUNCEMENTS = [
  { id: 1, title: "Round #47 voting now open", body: "Cast your vote before July 1st 17:00 UTC.", published: true,  created_at: "2026-06-25T00:00:00Z" },
  { id: 2, title: "New topic group: Science",  body: "We've added a Science topic group.", published: false, created_at: "2026-06-24T09:00:00Z" },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const SIGNAL_LABELS: Record<string, string> = {
  recency: "Recency", engagement: "Engagement", bridging: "Bridging",
  source_diversity: "Source diversity", relevance: "Relevance",
}

const ACTION_COLOR: Record<string, string> = {
  weights_applied:   "bg-success",
  round_opened:      "bg-primary",
  round_closed:      "bg-foreground/40",
  keyword_added:     "bg-warning",
  keyword_removed:   "bg-tongue",
  topic_disabled:    "bg-tongue",
  topic_enabled:     "bg-success",
  participant_banned:"bg-status-error",
  weights_override:  "bg-warning",
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 pb-4 border-b border-border mb-5">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {sub && <p className="text-xs text-foreground/50">{sub}</p>}
    </div>
  )
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────

function ConfirmModal({ title, body, confirmLabel = "Confirm", danger = false, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel?: string; danger?: boolean
  onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={onCancel} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl flex flex-col gap-4">
        <h3 id="modal-title" className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-foreground/60 leading-relaxed">{body}</p>
        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-full border border-border text-sm font-medium text-foreground/60 hover:text-foreground hover:border-foreground/40 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
              danger
                ? "bg-status-error text-white hover:bg-[hsl(8,60%,38%)]"
                : "bg-primary text-primary-foreground hover:bg-primary-dark"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Panel: Overview ───────────────────────────────────────────────────────────

function PanelOverview() {
  const stats = [
    { label: "Total posts scored", value: MOCK_FEED_HEALTH.total_posts_scored.toLocaleString() },
    { label: "Votes this round",   value: MOCK_EPOCH.vote_count.toLocaleString() },
    { label: "Participation",       value: `${Math.round((MOCK_EPOCH.vote_count / MOCK_EPOCH.subscriber_count) * 100)}%` },
    { label: "Avg score",           value: MOCK_FEED_HEALTH.avg_total.toFixed(2) },
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
        {Object.entries(MOCK_EPOCH.weights).map(([k, v]) => (
          <WeightBar key={k} label={SIGNAL_LABELS[k] ?? k} value={v} />
        ))}
      </div>
      <div className="rounded-xl bg-biscuit/50 border border-border px-5 py-4 flex flex-col gap-2">
        <p className="text-xs text-foreground/50">
          Voting closes <span className="font-mono text-foreground/70">{new Date(MOCK_EPOCH.voting_ends_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}</span>
        </p>
      </div>
    </div>
  )
}

// ── Panel: Current Round ──────────────────────────────────────────────────────

function PanelCurrentRound() {
  const [confirm, setConfirm] = useState<null | "close" | "apply">(null)
  const pct = Math.round((MOCK_EPOCH.vote_count / MOCK_EPOCH.subscriber_count) * 100)

  const LIFECYCLE: Array<{ phase: string; label: string; action?: string; danger?: boolean; body: string }> = [
    { phase: "running", label: "Running",  action: "Open voting",    body: "This will open Round #47 for member votes. Confirm to proceed." },
    { phase: "voting",  label: "Voting",   action: "Close voting",   body: "This will close voting for Round #47 and move to review." },
    { phase: "review",  label: "Review",   action: "Apply weights",  body: "This will apply the aggregated vote weights to the live feed. This action cannot be undone." },
    { phase: "running", label: "Live",     body: "Weights are live." },
  ]

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Current round" sub="Manage the lifecycle of Round #47." />

      {/* Participation */}
      <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">Participation</p>
          <span className="text-sm font-mono font-semibold text-foreground tabular-nums">{MOCK_EPOCH.vote_count} / {MOCK_EPOCH.subscriber_count}</span>
        </div>
        <div className="h-2 rounded-full bg-biscuit overflow-hidden">
          <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-foreground/45">{pct}% of members have voted this round.</p>
      </div>

      {/* Lifecycle actions */}
      <div className="flex flex-col gap-3">
        <p className="text-[10px] font-mono uppercase tracking-widest text-foreground/40 mb-1">Lifecycle actions</p>
        {LIFECYCLE.map((lc, i) => {
          const isCurrentPhase = lc.phase === MOCK_EPOCH.phase
          return (
            <div key={i} className={`rounded-xl border px-5 py-4 flex items-center justify-between gap-4 transition-colors
              ${isCurrentPhase ? "border-primary/30 bg-primary/5" : "border-border bg-card opacity-50"}`}>
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isCurrentPhase ? "bg-primary" : "bg-border"}`} />
                <span className="text-sm font-medium text-foreground">{lc.label}</span>
              </div>
              {lc.action && isCurrentPhase && (
                <button
                  onClick={() => setConfirm(i === 1 ? "close" : "apply")}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    lc.danger
                      ? "bg-status-error/10 text-status-error border border-status-error/30 hover:bg-status-error/20"
                      : "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"
                  }`}
                >
                  {lc.action}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {confirm === "close" && (
        <ConfirmModal
          title="Close voting for Round #47?"
          body="This will close voting and move the round to review. Members will no longer be able to submit votes."
          confirmLabel="Close voting"
          onConfirm={() => setConfirm(null)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "apply" && (
        <ConfirmModal
          title="Apply aggregated weights to live feed?"
          body="This will immediately update the feed ranking with the community vote results. This cannot be undone."
          confirmLabel="Apply weights"
          danger
          onConfirm={() => setConfirm(null)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

// ── Panel: Weights Override ───────────────────────────────────────────────────

function PanelWeightsOverride() {
  const [weights, setWeights] = useState({ ...MOCK_PENDING_WEIGHTS })
  const [confirm, setConfirm] = useState(false)
  const total = Object.values(weights).reduce((a, b) => a + b, 0)
  const isValid = Math.abs(total - 1) < 0.001

  function setWeight(key: string, val: number) {
    setWeights((prev) => ({ ...prev, [key]: Math.max(0, Math.min(1, val)) }))
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Weights override" sub="Manually override the community-voted weights. Use with care." />
      <div className="flex flex-col gap-4">
        {Object.entries(weights).map(([k, v]) => (
          <div key={k} className="flex items-center gap-4">
            <span className="text-sm font-medium text-foreground w-36 flex-shrink-0">{SIGNAL_LABELS[k] ?? k}</span>
            <input
              type="range"
              min={0} max={100} step={1}
              value={Math.round(v * 100)}
              onChange={(e) => setWeight(k, Number(e.target.value) / 100)}
              className="flex-1 accent-primary"
              aria-label={SIGNAL_LABELS[k]}
            />
            <span className="text-sm font-mono font-semibold text-foreground tabular-nums w-10 text-right">{Math.round(v * 100)}%</span>
          </div>
        ))}
      </div>
      <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm transition-colors ${isValid ? "bg-success/10 border-success/20 text-success" : "bg-tongue/10 border-tongue/30 text-tongue-foreground"}`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isValid ? "bg-success" : "bg-tongue"}`} />
        <span className="font-mono font-semibold">{(total * 100).toFixed(0)}%</span>
        <span className="text-foreground/50 ml-1">{isValid ? "weights sum to 100% — ready to apply" : "weights must sum to 100%"}</span>
      </div>
      <div className="flex justify-end gap-3">
        <button
          onClick={() => setWeights({ ...MOCK_PENDING_WEIGHTS })}
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
          onConfirm={() => setConfirm(false)}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  )
}

// ── Panel: Content Filters ────────────────────────────────────────────────────

function PanelContentFilters() {
  const [include, setInclude] = useState(MOCK_CONTENT_FILTERS.include_keywords)
  const [exclude, setExclude] = useState(MOCK_CONTENT_FILTERS.exclude_keywords)
  const [addInclude, setAddInclude] = useState("")
  const [addExclude, setAddExclude] = useState("")
  const [removingConfirm, setRemovingConfirm] = useState<{ list: "include" | "exclude"; kw: string } | null>(null)

  function addKw(list: "include" | "exclude") {
    const val = list === "include" ? addInclude.trim().toLowerCase() : addExclude.trim().toLowerCase()
    if (!val) return
    if (list === "include") { setInclude((p) => [...p, val]); setAddInclude("") }
    else { setExclude((p) => [...p, val]); setAddExclude("") }
  }

  function removeKw(list: "include" | "exclude", kw: string) {
    if (list === "include") setInclude((p) => p.filter((k) => k !== kw))
    else setExclude((p) => p.filter((k) => k !== kw))
    setRemovingConfirm(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Content filters" sub="Keywords boosted or suppressed community-wide." />

      {(["include", "exclude"] as const).map((list) => {
        const keywords = list === "include" ? include : exclude
        const addVal   = list === "include" ? addInclude : addExclude
        const setAdd   = list === "include" ? setAddInclude : setAddExclude
        const chipBg   = list === "include" ? "bg-success/10 border-success/20 text-success" : "bg-tongue/15 border-tongue/30 text-tongue-foreground"
        const prefix   = list === "include" ? "+" : "−"

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
                onKeyDown={(e) => e.key === "Enter" && addKw(list)}
                placeholder={`Add ${list} keyword…`}
                className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                onClick={() => addKw(list)}
                disabled={!addVal.trim()}
                className="px-4 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 text-sm font-medium hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                Add
              </button>
            </div>
          </div>
        )
      })}

      {removingConfirm && (
        <ConfirmModal
          title={`Remove "${removingConfirm.kw}" from ${removingConfirm.list} list?`}
          body="This keyword will no longer be used to filter feed content."
          confirmLabel="Remove keyword"
          danger
          onConfirm={() => removeKw(removingConfirm.list, removingConfirm.kw)}
          onCancel={() => setRemovingConfirm(null)}
        />
      )}
    </div>
  )
}

// ── Panel: Topics CRUD ────────────────────────────────────────────────────────

function PanelTopics() {
  const [topics, setTopics] = useState(MOCK_TOPICS)
  const [confirmToggle, setConfirmToggle] = useState<typeof MOCK_TOPICS[0] | null>(null)

  function toggleTopic(slug: string, enabled: boolean) {
    setTopics((prev) => prev.map((t) => t.slug === slug ? { ...t, enabled } : t))
    setConfirmToggle(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Topics" sub="Enable or disable topic groups used in relevance scoring." />
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
            {topics.map((t) => (
              <tr key={t.slug} className="border-b border-border/50 last:border-b-0 hover:bg-biscuit/20 transition-colors">
                <td className="px-4 py-3 font-medium text-foreground">{t.name}</td>
                <td className="px-4 py-3 text-foreground/45 text-xs font-mono hidden sm:table-cell">{t.parentSlug ?? "—"}</td>
                <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-foreground/70">{Math.round(t.currentWeight * 100)}%</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setConfirmToggle(t)}
                    className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${
                      t.enabled
                        ? "bg-success/10 border-success/20 text-success hover:bg-success/20"
                        : "bg-biscuit border-border text-foreground/45 hover:bg-biscuit/80"
                    }`}
                  >
                    {t.enabled ? "Enabled" : "Disabled"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmToggle && (
        <ConfirmModal
          title={`${confirmToggle.enabled ? "Disable" : "Enable"} "${confirmToggle.name}"?`}
          body={confirmToggle.enabled
            ? "This topic will no longer affect relevance scoring. Members' topic votes for this group will be ignored."
            : "This topic will be re-activated and included in relevance scoring."}
          confirmLabel={confirmToggle.enabled ? "Disable topic" : "Enable topic"}
          danger={confirmToggle.enabled}
          onConfirm={() => toggleTopic(confirmToggle.slug, !confirmToggle.enabled)}
          onCancel={() => setConfirmToggle(null)}
        />
      )}
    </div>
  )
}

// ── Panel: Audit Log ──────────────────────────────────────────────────────────

function PanelAuditLog() {
  const [expanded, setExpanded] = useState<number | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Audit log" sub="All admin actions, newest first." />
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
            {MOCK_AUDIT.map((entry) => {
              const isExpanded = expanded === entry.id
              const dot = ACTION_COLOR[entry.action] ?? "bg-foreground/30"
              const hasDetails = Object.keys(entry.details).length > 0
              return (
                <>
                  <tr
                    key={entry.id}
                    className="border-b border-border/50 last:border-b-0 hover:bg-biscuit/20 transition-colors cursor-pointer"
                    onClick={() => hasDetails && setExpanded(isExpanded ? null : entry.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} aria-hidden="true" />
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
                      {entry.actor_did ? entry.actor_did.slice(-8) : <span className="italic text-foreground/30">system</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-foreground/50 hidden sm:table-cell">#{entry.epoch_id}</td>
                    <td className="px-4 py-3 text-right text-xs text-foreground/50 tabular-nums" title={entry.created_at}>{relTime(entry.created_at)}</td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${entry.id}-details`} className="border-b border-border/30 bg-biscuit/20">
                      <td colSpan={4} className="px-6 py-3">
                        <pre className="text-xs font-mono text-foreground/60 whitespace-pre-wrap">{JSON.stringify(entry.details, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Panel: Feed Health ────────────────────────────────────────────────────────

function PanelFeedHealth() {
  const h = MOCK_FEED_HEALTH
  const metrics = [
    { label: "vs Chronological", value: `${Math.round(h.vs_chronological_overlap * 100)}%`, hint: "Overlap with time-sorted feed" },
    { label: "vs Engagement-only", value: `${Math.round(h.vs_engagement_overlap * 100)}%`, hint: "Overlap with likes-sorted feed" },
    { label: "Author Gini", value: h.author_gini.toFixed(2), hint: "Author concentration (lower = more diverse)" },
    { label: "Avg score", value: h.avg_total.toFixed(2), hint: "Mean total post score" },
    { label: "Median score", value: h.median_total.toFixed(2), hint: "Median total post score" },
    { label: "Avg bridging", value: h.avg_bridging.toFixed(2), hint: "Mean bridging signal across posts" },
  ]

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Feed health" sub="Transparency metrics for the current round." />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-xl border border-border bg-card px-5 py-4 flex flex-col gap-1.5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-foreground/40">{m.label}</span>
            <span className="text-2xl font-mono font-bold text-foreground tabular-nums">{m.value}</span>
            <span className="text-xs text-foreground/45 leading-relaxed">{m.hint}</span>
          </div>
        ))}
      </div>

      {/* Gini bar */}
      <div className="flex flex-col gap-2">
        <p className="text-[10px] font-mono uppercase tracking-widest text-foreground/40">Author concentration</p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-foreground/45 w-14">Diverse</span>
          <div className="flex-1 h-2.5 rounded-full bg-biscuit overflow-hidden">
            <div
              className="h-2.5 rounded-full bg-primary transition-all"
              style={{ width: `${h.author_gini * 100}%` }}
            />
          </div>
          <span className="text-xs text-foreground/45 w-14 text-right">Concentrated</span>
        </div>
        <p className="text-xs text-foreground/40 text-center">
          Gini {h.author_gini.toFixed(2)} — {h.author_gini < 0.4 ? "healthy diversity" : "concentration detected"}
        </p>
      </div>
    </div>
  )
}

// ── Panel: Announcements ──────────────────────────────────────────────────────

function PanelAnnouncements() {
  const [items, setItems] = useState(MOCK_ANNOUNCEMENTS)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [draft, setDraft] = useState({ title: "", body: "" })
  const [adding, setAdding] = useState(false)

  function togglePublish(id: number) {
    setItems((prev) => prev.map((a) => a.id === id ? { ...a, published: !a.published } : a))
  }

  function deleteItem(id: number) {
    setItems((prev) => prev.filter((a) => a.id !== id))
    setConfirmDelete(null)
  }

  function addAnnouncement() {
    if (!draft.title.trim() || !draft.body.trim()) return
    setItems((prev) => [{ id: Date.now(), ...draft, published: false, created_at: new Date().toISOString() }, ...prev])
    setDraft({ title: "", body: "" })
    setAdding(false)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-border mb-1">
        <div>
          <h2 className="text-base font-semibold text-foreground">Announcements</h2>
          <p className="text-xs text-foreground/50">Community-facing notices shown on the dashboard.</p>
        </div>
        <button
          onClick={() => setAdding(!adding)}
          className="px-4 py-2 rounded-full bg-primary/10 text-primary border border-primary/20 text-sm font-medium hover:bg-primary/20 transition-colors"
        >
          {adding ? "Cancel" : "+ New"}
        </button>
      </div>

      {adding && (
        <div className="rounded-xl border border-border bg-biscuit/30 p-5 flex flex-col gap-3">
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Title"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <textarea
            value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
            placeholder="Body text"
            rows={3}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={addAnnouncement}
              disabled={!draft.title.trim() || !draft.body.trim()}
              className="px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              Save draft
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {items.map((a) => (
          <div key={a.id} className="rounded-xl border border-border bg-card px-5 py-4 flex items-start gap-4">
            <div className="flex-1 flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{a.title}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${a.published ? "bg-success/10 text-success border-success/20" : "bg-biscuit text-foreground/45 border-border"}`}>
                  {a.published ? "Published" : "Draft"}
                </span>
              </div>
              <p className="text-xs text-foreground/55 leading-relaxed">{a.body}</p>
              <span className="text-[10px] font-mono text-foreground/30">{relTime(a.created_at)}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => togglePublish(a.id)}
                className="text-xs font-medium text-foreground/50 hover:text-primary transition-colors"
              >
                {a.published ? "Unpublish" : "Publish"}
              </button>
              <button
                onClick={() => setConfirmDelete(a.id)}
                aria-label="Delete"
                className="text-foreground/30 hover:text-status-error transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 4h10M6 4V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V4M5 4l.5 8.5a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5L11 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-foreground/35 italic text-center py-8">No announcements yet.</p>}
      </div>

      {confirmDelete !== null && (
        <ConfirmModal
          title="Delete this announcement?"
          body="This announcement will be permanently removed. If published, members will no longer see it."
          confirmLabel="Delete"
          danger
          onConfirm={() => deleteItem(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

// ── Phase banner ──────────────────────────────────────────────────────────────

const PHASE_META = {
  running:  { label: "Running",      color: "bg-success/15 border-success/25 text-success",       dot: "bg-success" },
  voting:   { label: "Voting open",  color: "bg-primary/10 border-primary/20 text-primary",       dot: "bg-primary animate-pulse" },
  review:   { label: "Under review", color: "bg-warning/15 border-warning/25 text-warning",       dot: "bg-warning" },
  waiting:  { label: "Waiting",      color: "bg-biscuit border-border text-foreground/50",         dot: "bg-foreground/30" },
}

// ── Nav items ─────────────────────────────────────────────────────────────────

const NAV_PANELS = [
  { id: "overview",        label: "Overview" },
  { id: "current-round",   label: "Current round" },
  { id: "weights",         label: "Weights override" },
  { id: "filters",         label: "Content filters" },
  { id: "topics",          label: "Topics" },
  { id: "audit",           label: "Audit log" },
  { id: "feed-health",     label: "Feed health" },
  { id: "announcements",   label: "Announcements" },
]

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [activePanel, setActivePanel] = useState("overview")
  const phase = MOCK_EPOCH.phase
  const phaseMeta = PHASE_META[phase]

  const panels: Record<string, React.ReactNode> = {
    "overview":      <PanelOverview />,
    "current-round": <PanelCurrentRound />,
    "weights":       <PanelWeightsOverride />,
    "filters":       <PanelContentFilters />,
    "topics":        <PanelTopics />,
    "audit":         <PanelAuditLog />,
    "feed-health":   <PanelFeedHealth />,
    "announcements": <PanelAnnouncements />,
  }

  return (
    <AppShell user={MOCK_USER}>
      <div className="flex flex-col min-h-[calc(100vh-3.5rem)]">

        {/* ── Governance phase banner ───────────────────────────── */}
        <div className={`w-full border-b px-5 py-2.5 flex items-center gap-3 ${phaseMeta.color}`}>
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${phaseMeta.dot}`} aria-hidden="true" />
          <span className="text-xs font-semibold">Round #{MOCK_EPOCH.id} · {phaseMeta.label}</span>
          <span className="text-xs opacity-60 hidden sm:block">
            {phase === "voting" ? `Closes ${new Date(MOCK_EPOCH.voting_ends_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}` : ""}
          </span>
          <span className="ml-auto text-[10px] font-mono opacity-50 hidden md:block">
            {MOCK_EPOCH.vote_count} / {MOCK_EPOCH.subscriber_count} voted
          </span>
        </div>

        {/* Mobile panel nav — sits above the flex row so it spans full width */}
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

          {/* Sidebar nav — desktop only */}
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

          {/* Panel content */}
          <main className="flex-1 min-w-0 px-4 sm:px-6 py-7 max-w-4xl">
            {panels[activePanel]}
          </main>

        </div>
      </div>
    </AppShell>
  )
}
