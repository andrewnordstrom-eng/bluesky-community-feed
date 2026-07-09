import Link from "next/link"
import { LIVE_FEED_POSTS, LIVE_METRICS_SNAPSHOT, LIVE_RANK_ONE_EXPLANATION } from "@/lib/live-metrics-snapshot"
import { formatUnitIntervalPercent, unitIntervalToPercentValue } from "@/lib/percent"
import { formatSignedScore } from "@/lib/score"

function VoteWeightsUI() {
  const weights = [
    { label: "Recency", value: LIVE_METRICS_SNAPSHOT.weights.recency },
    { label: "Engagement", value: LIVE_METRICS_SNAPSHOT.weights.engagement },
    { label: "Bridging", value: LIVE_METRICS_SNAPSHOT.weights.bridging },
    { label: "Source diversity", value: LIVE_METRICS_SNAPSHOT.weights.source_diversity },
    { label: "Relevance", value: LIVE_METRICS_SNAPSHOT.weights.relevance },
  ]

  return (
    <div className="w-full rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-5 sm:px-6 py-4 border-b border-border/60 bg-card">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#FF6058]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28CA41]" />
          <span className="ml-1 sm:ml-2 text-foreground/45 text-xs font-mono">Live governance weights</span>
        </div>
        <span className="w-fit text-[10px] font-mono text-primary bg-primary/10 px-2.5 py-1 rounded-full border border-primary/15">
          epoch {LIVE_METRICS_SNAPSHOT.epochId} snapshot
        </span>
      </div>
      <div className="px-5 sm:px-6 py-6 flex flex-col gap-4">
        {weights.map((item) => (
          <div key={item.label} className="flex items-center gap-3 sm:gap-4">
            <span className="w-28 sm:w-36 text-foreground/60 text-sm font-medium flex-shrink-0">{item.label}</span>
            <div className="flex-1 h-2 bg-border/60 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-700"
                style={{ width: `${unitIntervalToPercentValue(item.value)}%` }}
              />
            </div>
            <span className="w-10 text-right text-foreground/50 text-sm font-mono font-medium flex-shrink-0">
              {formatUnitIntervalPercent(item.value)}
            </span>
          </div>
        ))}
      </div>
      <div className="px-5 sm:px-6 pb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-foreground/35 text-xs font-mono">
          {LIVE_METRICS_SNAPSHOT.scoredPosts.toLocaleString("en-US")} scored posts use these weights
        </p>
        <Link
          href="/vote"
          className="w-fit text-xs font-medium text-primary border border-primary/25 bg-primary/10 px-3.5 py-1.5 rounded-full hover:bg-primary/15 transition-colors"
        >
          Review voting screen
        </Link>
      </div>
    </div>
  )
}

function ScoreBreakdownUI() {
  return (
    <div className="w-full rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-5 sm:px-6 py-4 border-b border-border/60">
        <span className="text-foreground/45 text-xs font-mono">Anonymized live receipt</span>
        <span className="w-fit text-xs font-mono text-primary font-semibold bg-primary/10 px-2.5 py-1 rounded-full border border-primary/15">
          rank #{LIVE_RANK_ONE_EXPLANATION.rank}
        </span>
      </div>
      <div className="px-5 sm:px-6 py-5 flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-muted flex-shrink-0 overflow-hidden">
            <svg viewBox="0 0 36 36" className="w-full h-full" aria-hidden="true">
              <rect width="36" height="36" fill="hsl(var(--muted))" />
              <circle cx="18" cy="14" r="6" fill="hsl(var(--border))" />
              <ellipse cx="18" cy="32" rx="11" ry="8" fill="hsl(var(--border))" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-foreground font-semibold text-sm">{LIVE_RANK_ONE_EXPLANATION.authorLabel}</p>
            <p className="text-foreground/60 text-sm leading-relaxed mt-1">{LIVE_RANK_ONE_EXPLANATION.text}</p>
          </div>
        </div>
        <div className="bg-background rounded-xl border border-border/70 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 bg-muted/30">
            <span className="text-foreground/50 text-xs font-medium">Why this ranked first</span>
            <span className="text-primary text-xs font-mono font-semibold">
              {formatSignedScore(LIVE_RANK_ONE_EXPLANATION.totalScore)}
            </span>
          </div>
          {LIVE_RANK_ONE_EXPLANATION.components.map((component) => (
            <div
              key={component.key}
              className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-border/30 last:border-0"
            >
              <span className="text-foreground/55 text-xs">{component.label}</span>
              <span className="text-xs font-mono font-semibold text-primary">
                {formatSignedScore(component.weighted)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MixedFeedUI() {
  return (
    <div className="w-full rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-5 sm:px-6 py-4 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-[#FF6058]" />
          <span className="w-2 h-2 rounded-full bg-[#FFBD2E]" />
          <span className="w-2 h-2 rounded-full bg-[#28CA41]" />
          <span className="ml-1 sm:ml-2 text-foreground/45 text-xs font-mono">Snapshot mixed feed</span>
        </div>
        <span className="w-fit text-[10px] font-medium text-foreground/45 border border-border/50 px-2.5 py-1 rounded-full">
          {LIVE_METRICS_SNAPSHOT.uniqueAuthors.toLocaleString("en-US")} anonymized authors
        </span>
      </div>
      <div className="divide-y divide-border/40">
        {LIVE_FEED_POSTS.map((post) => (
          <div key={post.rank} className="px-5 py-4 flex items-start gap-3.5">
            <div className="flex-shrink-0 w-6 text-center text-foreground/25 text-xs font-mono pt-0.5">
              {post.rank}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-foreground font-semibold text-sm">{post.author}</span>
                <span className="text-foreground/35 text-xs">snapshot receipt</span>
              </div>
              <p className="text-foreground/65 text-sm leading-relaxed">{post.text}</p>
            </div>
            <span className="flex-shrink-0 text-xs font-mono font-semibold text-primary pt-0.5">
              {formatSignedScore(post.score)}
            </span>
          </div>
        ))}
      </div>
      <div className="px-5 sm:px-6 py-3.5 border-t border-border/40 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-foreground/35 text-xs font-mono">one governed ranking, multiple signal types</p>
        <Link href="/demo" className="text-xs font-medium text-primary hover:underline underline-offset-2">
          See the receipt demo &rarr;
        </Link>
      </div>
    </div>
  )
}

function CommunityVoteUI() {
  const steps = [
    {
      label: "Proposal",
      text: "A change to ranking weights or rules is made visible before it affects the feed.",
    },
    {
      label: "Vote",
      text: "Community votes are aggregated into the next set of governance weights.",
    },
    {
      label: "Epoch transition",
      text: "The feed applies the new weights at the boundary instead of changing silently midstream.",
    },
    {
      label: "Receipt",
      text: "Weights and post-score explanations remain inspectable after the change.",
    },
  ]

  return (
    <div className="w-full rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-5 sm:px-6 py-4 border-b border-border/60">
        <span className="text-foreground/45 text-xs font-mono">Epoch and proposal flow</span>
        <span className="w-fit text-[10px] font-medium text-primary bg-primary/10 border border-primary/15 px-2.5 py-1 rounded-full">
          auditable sequence
        </span>
      </div>
      <div className="px-5 sm:px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-3">
        {steps.map((step, index) => (
          <div key={step.label} className="rounded-xl border border-border/60 bg-background px-4 py-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-foreground/75 text-sm font-semibold leading-snug">{step.label}</p>
              <span className="text-[11px] font-mono text-foreground/35">{String(index + 1).padStart(2, "0")}</span>
            </div>
            <p className="text-foreground/55 text-sm leading-relaxed">{step.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

const features = [
  {
    id: "weights",
    headline: "Community weights are visible.",
    description:
      "Corgi exposes the ranking weights that drive the feed. The public homepage uses the same live snapshot source as the reviewer demo, so the numbers are receipts instead of marketing decoration.",
    cta: "Review voting screen",
    href: "/vote",
    UI: VoteWeightsUI,
  },
  {
    id: "receipt",
    headline: "Every top post keeps an anonymized receipt.",
    description:
      "The public page can show why a post ranked without leaking raw handles, DIDs, or post URIs. Score components, weights, and totals stay inspectable while the sensitive production content stays redacted.",
    cta: "Open the live receipt",
    href: `/demo#snapshot-rank-${LIVE_RANK_ONE_EXPLANATION.rank}`,
    UI: ScoreBreakdownUI,
  },
  {
    id: "mixed-feed",
    headline: "The feed is mixed, not topic-siloed.",
    description:
      "A governed recommender has to reconcile recency, engagement, bridging, source diversity, and relevance in one ranking. The demo feed shows anonymized production receipts at the same grain reviewers can inspect.",
    cta: "Explore the demo feed",
    href: "/demo",
    UI: MixedFeedUI,
  },
  {
    id: "epochs",
    headline: "Epochs turn proposals into auditable changes.",
    description:
      "Corgi's governance loop is proposal, vote, epoch transition, and receipt. The product story stays grounded in that loop instead of promising private communities or made-up vote totals.",
    cta: "See epoch history",
    href: "/history",
    UI: CommunityVoteUI,
  },
]

export function BentoSection() {
  return (
    <section id="features-section" className="w-full">
      {features.map((feature) => (
        <div
          key={feature.id}
          className="border-t border-border/60 px-5 md:px-8 lg:px-12"
        >
          <div className="flex flex-col md:flex-row md:items-start gap-6 md:gap-16 py-10 md:py-14">
            <div className="md:w-[40%] flex-shrink-0">
              <h2 className="text-foreground font-display text-2xl md:text-3xl lg:text-[2rem] font-bold leading-tight tracking-tight text-balance">
                {feature.headline}
              </h2>
            </div>
            <div className="md:flex-1 flex flex-col gap-5 md:pt-1">
              <p className="text-foreground/55 text-base leading-relaxed">
                {feature.description}
              </p>
              <Link
                href={feature.href}
                className="w-fit text-sm font-medium text-primary hover:text-primary-dark transition-colors"
              >
                {feature.cta} &rarr;
              </Link>
            </div>
          </div>
          <div className="pb-10 md:pb-16">
            <feature.UI />
          </div>
        </div>
      ))}
    </section>
  )
}
