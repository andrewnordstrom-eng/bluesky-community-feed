"use client"

import { useState } from "react"
import Link from "next/link"
import { AppShell } from "@/components/app-shell"
import { ScoreBreakdown, type ScoreComponent } from "@/components/ui/score-breakdown"
import { ScoreRadar } from "@/components/ui/score-radar"
import { WeightBar } from "@/components/ui/weight-bar"
import { StatusChip } from "@/components/ui/status-chip"

// ── Mock data (seam-exact field names) ───────────────────────────────────────

const MOCK_STATS = {
  epoch: { id: 47, phase: "voting" as const },
  feed_stats: {
    total_posts_scored: 1240,
    unique_authors: 318,
    avg_bridging: 0.41,
    avg_total: 0.57,
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

const MOCK_TOPICS = [
  { slug: "machine-learning", name: "Machine learning", currentWeight: 0.62, communityAvg: 0.55 },
  { slug: "open-source", name: "Open source", currentWeight: 0.71, communityAvg: 0.60 },
  { slug: "science", name: "Science", currentWeight: 0.50, communityAvg: 0.50 },
  { slug: "politics", name: "Politics", currentWeight: 0.32, communityAvg: 0.41 },
  { slug: "sports", name: "Sports", currentWeight: 0.28, communityAvg: 0.35 },
]

const MOCK_EXPLANATION = {
  post_uri: "at://did:plc:abc123/app.bsky.feed.post/xyz789",
  author: "maya.bsky.social",
  text: "New benchmark results show open-source models closing the gap with proprietary ones on reasoning tasks.",
  epoch_id: 47,
  total_score: 0.57,
  rank: 3,
  components: [
    { key: "recency",          label: "Recency",          raw_score: 0.82, weight: 0.35, weighted: 0.287 },
    { key: "engagement",       label: "Engagement",       raw_score: 0.61, weight: 0.25, weighted: 0.153 },
    { key: "bridging",         label: "Bridging",         raw_score: 0.44, weight: 0.20, weighted: 0.088 },
    { key: "source_diversity", label: "Source diversity", raw_score: 0.29, weight: 0.15, weighted: 0.044 },
    { key: "relevance",        label: "Relevance",        raw_score: 0.40, weight: 0.05, weighted: 0.020 },
  ] satisfies ScoreComponent[],
  governance_weights: MOCK_WEIGHTS,
  counterfactual: {
    pure_engagement_rank: 9,
    community_governed_rank: 3,
    difference: 6,
  },
}

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Feed stats",    title: "How the feed performed" },
  { id: 2, label: "Live feed",     title: "Posts ranked by your community" },
  { id: 3, label: "Topic weights", title: "What your community amplifies" },
  { id: 4, label: "Explain a post", title: "See exactly why this post ranked" },
  { id: 5, label: "Counterfactual", title: "What would have happened instead" },
]

// ── Step content components ───────────────────────────────────────────────────

function StepStats() {
  const { feed_stats, epoch, governance, metrics } = MOCK_STATS
  const stats = [
    { label: "Posts scored",    value: feed_stats.total_posts_scored.toLocaleString() },
    { label: "Authors",         value: feed_stats.unique_authors.toLocaleString() },
    { label: "Votes this round", value: governance.votes_this_epoch.toLocaleString() },
    { label: "Avg score",       value: feed_stats.avg_total.toFixed(2) },
  ]
  const health = [
    { label: "vs Chronological", value: `${Math.round(metrics.vs_chronological_overlap * 100)}%`, hint: "posts in common with time-sorted" },
    { label: "vs Engagement-only", value: `${Math.round(metrics.vs_engagement_overlap * 100)}%`, hint: "posts in common with likes-sorted" },
    { label: "Author diversity", value: metrics.author_gini.toFixed(2), hint: "Gini coefficient — lower is more diverse" },
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
        <span>Round #{epoch.id} is currently open for voting. Results update once the round closes.</span>
      </div>
    </div>
  )
}

const MOCK_FEED_POSTS = [
  { rank: 1, author: "alice.bsky.social",  score: 0.74, text: "Open-source models are catching up fast — new reasoning benchmark shows parity with GPT-4." },
  { rank: 2, author: "bob.bsky.social",    score: 0.68, text: "Science funding in the EU set to double over the next decade. Good news for open research." },
  { rank: 3, author: "maya.bsky.social",   score: 0.57, text: "New benchmark results show open-source models closing the gap with proprietary ones." },
  { rank: 4, author: "carlos.bsky.social", score: 0.51, text: "Some really thoughtful work coming out of independent ML labs this week." },
  { rank: 5, author: "dana.bsky.social",   score: 0.44, text: "Bridging score matters more than you'd think — posts that connect different clusters bubble up." },
]

function StepFeed() {
  return (
    <div className="flex flex-col gap-3">
      {MOCK_FEED_POSTS.map((post) => (
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
        Ranked by community-voted weights, not engagement alone.
      </p>
    </div>
  )
}

function StepTopics() {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-foreground/55 leading-relaxed">
        Your community votes to boost or suppress topics. The bar shows the community&apos;s current applied weight — right of centre boosts, left reduces.
      </p>
      <div className="flex flex-col">
        {MOCK_TOPICS.map((t) => {
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
  const { components, total_score, text, author, rank } = MOCK_EXPLANATION
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
            epochLabel="Round #47 · community weighted"
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
  const { counterfactual, total_score, rank } = MOCK_EXPLANATION
  const diff = counterfactual.pure_engagement_rank - counterfactual.community_governed_rank
  const moved = diff > 0 ? "up" : diff < 0 ? "down" : "same"
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
      sub: "With your community&apos;s weights applied",
      color: "text-success",
      bg: "bg-success/10 border-success/20",
    },
    {
      label: "Positions gained",
      value: moved === "up" ? `+${diff}` : moved === "down" ? `${diff}` : "—",
      sub: "Moved up by community governance",
      color: diff > 0 ? "text-success" : diff < 0 ? "text-tongue-foreground" : "text-foreground/40",
      bg: diff > 0 ? "bg-success/10 border-success/20" : diff < 0 ? "bg-tongue/10 border-tongue/20" : "bg-biscuit border-border",
    },
  ]
  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-foreground/55 leading-relaxed max-w-xl">
        This post scored <span className="font-mono font-semibold text-foreground">{total_score.toFixed(2)}</span> and ranked <span className="font-mono font-semibold text-foreground">#{rank}</span>. Without community governance, a pure engagement sort would have placed it much lower.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {boxes.map((box) => (
          <div key={box.label} className={`rounded-xl border ${box.bg} px-5 py-5 flex flex-col gap-2`}>
            <span className="text-[10px] font-mono uppercase tracking-widest text-foreground/40">{box.label}</span>
            <span className={`text-4xl font-mono font-bold tabular-nums ${box.color}`}>{box.value}</span>
            <span className="text-xs text-foreground/50 leading-relaxed" dangerouslySetInnerHTML={{ __html: box.sub }} />
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-biscuit/60 border border-border px-5 py-4 flex flex-col gap-2">
        <p className="text-sm font-semibold text-foreground">This is what community governance means.</p>
        <p className="text-sm text-foreground/55 leading-relaxed">
          The feed ranked this post higher not because it got the most likes, but because your community voted for bridging and source diversity — and this post delivered on both.
        </p>
        <Link
          href="/vote"
          className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary-dark transition-colors"
        >
          Cast your vote in Round #47
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
            A 5-step tour of the transparency loop — from community votes to ranked posts. Read-only; your feed is unchanged.
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
          This walkthrough uses sample data. Your actual feed data is live at{" "}
          <Link href="/dashboard" className="text-primary hover:underline">Overview</Link>.
        </p>
      </div>
    </AppShell>
  )
}
