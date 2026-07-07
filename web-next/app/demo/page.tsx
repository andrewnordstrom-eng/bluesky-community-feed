"use client"

import { useState } from "react"
import Link from "next/link"
import { AppShell } from "@/components/app-shell"
import { ScoreBreakdown } from "@/components/ui/score-breakdown"
import { ScoreRadar } from "@/components/ui/score-radar"
import { WeightBar } from "@/components/ui/weight-bar"
import { StatusChip } from "@/components/ui/status-chip"
import { LIVE_FEED_POSTS, LIVE_METRICS_SNAPSHOT, LIVE_RANK_ONE_EXPLANATION } from "@/lib/live-metrics-snapshot"

// ── Live snapshot view-models (API-exact field names) ────────────────────────

const LIVE_STATS = {
  epoch: { id: LIVE_METRICS_SNAPSHOT.epochId, phase: "live" as const },
  feed_stats: {
    total_posts_scored: LIVE_METRICS_SNAPSHOT.scoredPosts,
    unique_authors: LIVE_METRICS_SNAPSHOT.uniqueAuthors,
    avg_bridging: LIVE_METRICS_SNAPSHOT.avgBridging,
    avg_engagement: LIVE_METRICS_SNAPSHOT.avgEngagement,
    median_bridging: LIVE_METRICS_SNAPSHOT.medianBridging,
    median_total: LIVE_METRICS_SNAPSHOT.medianTotal,
  },
  governance: { votes_this_epoch: LIVE_METRICS_SNAPSHOT.votesThisEpoch },
}

const LIVE_WEIGHTS = LIVE_METRICS_SNAPSHOT.weights

const LIVE_TOPICS = LIVE_METRICS_SNAPSHOT.topics

const LIVE_EXPLANATION = {
  post_uri: LIVE_RANK_ONE_EXPLANATION.receiptId,
  author: LIVE_RANK_ONE_EXPLANATION.authorLabel,
  text: LIVE_RANK_ONE_EXPLANATION.text,
  epoch_id: LIVE_RANK_ONE_EXPLANATION.epochId,
  total_score: LIVE_RANK_ONE_EXPLANATION.totalScore,
  rank: LIVE_RANK_ONE_EXPLANATION.rank,
  components: LIVE_RANK_ONE_EXPLANATION.components,
  governance_weights: LIVE_WEIGHTS,
  counterfactual: {
    pure_engagement_rank: LIVE_RANK_ONE_EXPLANATION.counterfactual.pureEngagementRank,
    community_governed_rank: LIVE_RANK_ONE_EXPLANATION.counterfactual.communityGovernedRank,
    difference: LIVE_RANK_ONE_EXPLANATION.counterfactual.difference,
  },
}

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Feed stats",    title: "Live production snapshot" },
  { id: 2, label: "Live feed",     title: "Posts ranked by your community" },
  { id: 3, label: "Topic signal",  title: "What this post matched" },
  { id: 4, label: "Explain a post", title: "See exactly why this post ranked" },
  { id: 5, label: "Counterfactual", title: "What would have happened instead" },
]

// ── Step content components ───────────────────────────────────────────────────

function StepStats() {
  const { feed_stats, epoch, governance } = LIVE_STATS
  const stats = [
    { label: "Posts scored",    value: feed_stats.total_posts_scored.toLocaleString() },
    { label: "Authors",         value: feed_stats.unique_authors.toLocaleString() },
    { label: "Votes this round", value: governance.votes_this_epoch.toLocaleString() },
    { label: "Median score",    value: feed_stats.median_total.toFixed(2) },
  ]
  const health = [
    { label: "Average bridging", value: feed_stats.avg_bridging.toFixed(2), hint: "mean raw bridging score" },
    { label: "Average engagement", value: feed_stats.avg_engagement.toFixed(2), hint: "mean raw engagement score" },
    { label: "Median bridging", value: feed_stats.median_bridging.toFixed(2), hint: "middle raw bridging score" },
  ]
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card px-5 py-4 flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-foreground/40">{s.label}</span>
            <span className="text-2xl font-mono font-bold text-foreground tabular-nums">{s.value}</span>
          </div>
        ))}
      </div>
      <div>
        <p className="text-[10px] font-mono uppercase tracking-widest text-foreground/40 mb-3">Feed health</p>
        <div className="flex flex-col gap-3">
          {health.map((h) => (
            <div key={h.label} className="flex items-center justify-between gap-4 py-2.5 border-b border-border/50 last:border-b-0">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">{h.label}</span>
                <span className="text-xs text-foreground/45">{h.hint}</span>
              </div>
              <span className="text-base font-mono font-semibold text-foreground tabular-nums">{h.value}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 p-4 rounded-xl bg-biscuit/60 text-sm text-foreground/60 leading-relaxed">
        <StatusChip phase={epoch.phase} />
        <span>Round #{epoch.id} is active. Snapshot refreshed from public endpoints on {LIVE_METRICS_SNAPSHOT.collectedAtLabel}.</span>
      </div>
    </div>
  )
}

const LIVE_FEED_VIEW_POSTS = LIVE_FEED_POSTS

function StepFeed() {
  return (
    <div className="flex flex-col gap-3">
      {LIVE_FEED_VIEW_POSTS.map((post) => (
        <div key={post.rank} className="flex items-start gap-4 rounded-xl border border-border bg-card px-5 py-4">
          <span className="text-xl font-mono font-bold text-foreground/25 tabular-nums w-7 flex-shrink-0 pt-0.5">
            {post.rank}
          </span>
          <div className="flex-1 flex flex-col gap-2 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-mono text-foreground/50">@{post.author}</span>
              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/15">
                {post.score.toFixed(2)}
              </span>
            </div>
            <p className="text-sm text-foreground/80 leading-relaxed">{post.text}</p>
          </div>
        </div>
      ))}
      <p className="text-xs text-foreground/40 text-center pt-2">
        Top scored posts from the anonymized {LIVE_METRICS_SNAPSHOT.collectedAtLabel} production transparency receipt.
      </p>
    </div>
  )
}

function StepTopics() {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-foreground/55 leading-relaxed">
        The explained post carried a stored relevance topic breakdown. This is public explanation data for that post, not a claim about all current feed topics.
      </p>
      <div className="flex flex-col">
        {LIVE_TOPICS.map((t) => {
          const boosted  = t.currentWeight > 0.55
          const reduced  = t.currentWeight < 0.45
          const direction = boosted ? "Boosted" : reduced ? "Reduced" : "Neutral"
          const chipColor = boosted
            ? "bg-success/10 text-success border-success/20"
            : reduced
            ? "bg-tongue/15 text-tongue-foreground border-tongue/30"
            : "bg-biscuit text-foreground/50 border-border"
          return (
            <div key={t.slug} className="flex items-center gap-4 py-3.5 border-b border-border/50 last:border-b-0">
              <div className="w-36 flex-shrink-0">
                <span className="text-sm font-medium text-foreground">{t.name}</span>
              </div>
              <div className="flex-1">
                <WeightBar label="" value={t.currentWeight} size="sm" />
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${chipColor}`}>
                {direction}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-6 text-xs text-foreground/40 justify-center">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-tongue/60 inline-block" /> Reduced</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-biscuit border border-border inline-block" /> Neutral</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-success/70 inline-block" /> Boosted</span>
      </div>
    </div>
  )
}

function StepExplain() {
  const { components, total_score, text, author, rank } = LIVE_EXPLANATION
  const radarSignals = components.map((c) => ({
    key: c.key,
    label: c.label,
    post: c.raw_score,
    governance: c.weight,
  }))
  return (
    <div className="flex flex-col gap-6">
      {/* Post being explained */}
      <div className="rounded-xl border border-border bg-card px-5 py-4 flex flex-col gap-2">
        <span className="text-xs font-mono text-foreground/45">@{author} · rank #{rank}</span>
        <p className="text-sm text-foreground/80 leading-relaxed">{text}</p>
      </div>
      {/* Breakdown + radar side-by-side on large */}
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 pt-4 pb-2 border-b border-border">
            <p className="text-[10px] font-mono uppercase tracking-widest text-foreground/40">Score breakdown</p>
          </div>
          <ScoreBreakdown
            components={components}
            total_score={total_score}
            epochLabel={`Round #${LIVE_EXPLANATION.epoch_id} · community weighted`}
          />
        </div>
        <div className="lg:w-72 rounded-xl border border-border bg-card px-4 py-4 flex flex-col gap-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-foreground/40">Signal radar</p>
          <ScoreRadar signals={radarSignals} />
        </div>
      </div>
    </div>
  )
}

function StepCounterfactual() {
  const { counterfactual, total_score, rank } = LIVE_EXPLANATION
  const diff = counterfactual.difference
  const moved = diff > 0 ? "up" : diff < 0 ? "down" : "same"
  const governanceExplanation =
    moved === "up"
      ? "The feed ranked this post higher because the active epoch weights relevance and recency alongside engagement, and the stored explanation exposes each contribution."
      : moved === "down"
        ? "The feed ranked this post lower once relevance and recency were weighted alongside engagement, and the stored explanation exposes each contribution."
        : "The active epoch weights relevance and recency alongside engagement; for this post that produced the same rank, and the stored explanation exposes each contribution."
  const boxes = [
    {
      label: "Engagement-only rank",
      value: `#${counterfactual.pure_engagement_rank}`,
      sub: "If sorted by likes alone",
      color: "text-tongue-foreground",
      bg: "bg-tongue/10 border-tongue/20",
    },
    {
      label: "Community-governed rank",
      value: `#${counterfactual.community_governed_rank}`,
      sub: "With your community's weights applied",
      color: "text-success",
      bg: "bg-success/10 border-success/20",
    },
    {
      label: moved === "up" ? "Positions gained" : moved === "down" ? "Positions lost" : "Rank change",
      value: moved === "up" ? `+${diff}` : moved === "down" ? `${Math.abs(diff)}` : "—",
      sub: moved === "up" ? "Moved up by community governance" : moved === "down" ? "Moved down by community governance" : "No rank movement",
      color: diff > 0 ? "text-success" : diff < 0 ? "text-tongue-foreground" : "text-foreground/40",
      bg: diff > 0 ? "bg-success/10 border-success/20" : diff < 0 ? "bg-tongue/10 border-tongue/20" : "bg-biscuit border-border",
    },
  ]
  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-foreground/55 leading-relaxed max-w-xl">
        This post scored <span className="font-mono font-semibold text-foreground">{total_score.toFixed(2)}</span> and ranked <span className="font-mono font-semibold text-foreground">#{rank}</span>. A pure engagement sort would have placed it at rank #{counterfactual.pure_engagement_rank}.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {boxes.map((box) => (
          <div key={box.label} className={`rounded-xl border ${box.bg} px-5 py-5 flex flex-col gap-2`}>
            <span className="text-[10px] font-mono uppercase tracking-widest text-foreground/40">{box.label}</span>
            <span className={`text-4xl font-mono font-bold tabular-nums ${box.color}`}>{box.value}</span>
            <span className="text-xs text-foreground/50 leading-relaxed">{box.sub}</span>
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-biscuit/60 border border-border px-5 py-4 flex flex-col gap-2">
        <p className="text-sm font-semibold text-foreground">This is what community governance means.</p>
        <p className="text-sm text-foreground/55 leading-relaxed">
          {governanceExplanation}
        </p>
        <Link
          href="/vote"
          className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary-dark transition-colors"
        >
          Cast your vote in Round #{LIVE_EXPLANATION.epoch_id}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Link>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DemoPage() {
  const [step, setStep] = useState(0) // 0-indexed

  const total = STEPS.length
  const current = STEPS[step]
  const isFirst = step === 0
  const isLast = step === total - 1

  const stepContent = [
    <StepStats key="stats" />,
    <StepFeed key="feed" />,
    <StepTopics key="topics" />,
    <StepExplain key="explain" />,
    <StepCounterfactual key="counterfactual" />,
  ]

  return (
    <AppShell user={null}>
      <div className="max-w-4xl mx-auto px-5 py-10 flex flex-col gap-8">

        {/* ── Page header ──────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-widest text-foreground/35">Guided walkthrough</span>
          <h1 className="font-display text-2xl font-bold text-foreground tracking-normal">How Corgi works</h1>
          <p className="text-sm text-foreground/50 leading-relaxed max-w-lg">
            A 5-step tour using a dated live-production receipt. Read-only; your feed is unchanged.
          </p>
        </div>

        {/* ── Step rail ────────────────────────────────────────────── */}
        <nav aria-label="Demo steps" className="flex items-start gap-0 relative">
          {/* connecting line */}
          <div className="absolute top-4 left-4 right-4 h-px bg-border -z-0" aria-hidden="true" />
          {STEPS.map((s, i) => {
            const done    = i < step
            const active  = i === step
            return (
              <button
                key={s.id}
                onClick={() => setStep(i)}
                aria-current={active ? "step" : undefined}
                className="flex-1 flex flex-col items-center gap-2 group relative z-10"
              >
                <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-mono font-bold transition-all
                  ${active  ? "bg-primary border-primary text-primary-foreground shadow-[0_2px_8px_rgba(200,97,44,0.3)]"
                    : done  ? "bg-success border-success text-white"
                    : "bg-card border-border text-foreground/40 group-hover:border-primary/50"}`}
                >
                  {done
                    ? <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    : s.id
                  }
                </div>
                <span className={`text-[10px] font-medium text-center leading-tight hidden sm:block transition-colors
                  ${active ? "text-primary" : done ? "text-success" : "text-foreground/40"}`}>
                  {s.label}
                </span>
              </button>
            )
          })}
        </nav>

        {/* ── Step card ────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card shadow-[0_2px_20px_rgba(46,38,32,0.06)] overflow-hidden">
          {/* Card header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-border">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-mono text-foreground/35 uppercase tracking-widest">Step {step + 1} of {total}</span>
              <h2 className="text-lg font-semibold text-foreground leading-snug">{current.title}</h2>
            </div>
            {/* Step 4 (index 3) vote gate badge */}
            {step === 3 && (
              <span className="text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full bg-biscuit border border-border text-foreground/50 uppercase tracking-wide">
                Read-only
              </span>
            )}
          </div>
          {/* Card body */}
          <div className="px-6 py-6">
            {stepContent[step]}
          </div>
        </div>

        {/* ── Navigation ───────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={isFirst}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-border text-sm font-medium text-foreground/60 hover:text-foreground hover:border-foreground/40 transition-all disabled:opacity-30 disabled:pointer-events-none"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 3L6 8l4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back
          </button>

          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
                className={`rounded-full transition-all ${i === step ? "w-5 h-2 bg-primary" : "w-2 h-2 bg-border hover:bg-foreground/20"}`}
              />
            ))}
          </div>

          {isLast ? (
            <Link
              href="/vote"
              className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-[0_2px_8px_rgba(200,97,44,0.35)] hover:bg-primary-dark hover:shadow-[0_4px_16px_rgba(200,97,44,0.4)] transition-all"
            >
              Cast your vote
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          ) : (
            <button
              onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-[0_2px_8px_rgba(200,97,44,0.35)] hover:bg-primary-dark transition-all"
            >
              Next
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>

        {/* ── Footer note ──────────────────────────────────────────── */}
        <p className="text-center text-xs text-foreground/35 leading-relaxed">
          This walkthrough uses the {LIVE_METRICS_SNAPSHOT.collectedAtLabel} live-production metrics packet. Current feed data is live at{" "}
          <Link href="/dashboard" className="text-primary hover:underline">Overview</Link>.
        </p>
      </div>
    </AppShell>
  )
}
