"use client"

import Image from "next/image"
import { useMemo, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import {
  ArrowDown,
  ArrowUp,
  Bird,
  Bookmark,
  Code2,
  Database,
  Heart,
  MessageCircle,
  Minus,
  MoreHorizontal,
  Repeat2,
  Share2,
} from "lucide-react"

type SignalKey = "recency" | "engagement" | "bridging" | "sourceDiversity" | "relevance"
type EpochId = "engagement" | "bridge" | "field" | "freshness"
type PostId = "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7"

interface Signal {
  readonly key: SignalKey
  readonly label: string
  readonly shortLabel: string
  readonly description: string
  readonly barClassName: string
}

interface DemoPost {
  readonly id: PostId
  readonly author: string
  readonly handle: string
  readonly time: string
  readonly avatarSrc: string
  readonly text: string
  readonly tags: readonly string[]
  readonly stats: {
    readonly replies: string
    readonly reposts: string
    readonly likes: string
  }
  readonly scores: Record<SignalKey, number>
}

interface Epoch {
  readonly id: EpochId
  readonly eyebrow: string
  readonly label: string
  readonly headline: string
  readonly body: string
  readonly weights: Record<SignalKey, number>
}

interface RankedPost {
  readonly post: DemoPost
  readonly score: number
  readonly rank: number
}

const signals: readonly Signal[] = [
  {
    key: "recency",
    label: "Recency",
    shortLabel: "Fresh",
    description: "How recently the post appeared.",
    barClassName: "bg-[#3B82F6]",
  },
  {
    key: "engagement",
    label: "Engagement",
    shortLabel: "Likes",
    description: "Replies, reposts, likes, and other public attention.",
    barClassName: "bg-[#E65F4F]",
  },
  {
    key: "bridging",
    label: "Bridging",
    shortLabel: "Bridge",
    description: "How well the post connects subgroups inside the community.",
    barClassName: "bg-[#A855F7]",
  },
  {
    key: "sourceDiversity",
    label: "Source diversity",
    shortLabel: "Diverse",
    description: "Whether the feed is hearing from a wider set of sources.",
    barClassName: "bg-[#10B981]",
  },
  {
    key: "relevance",
    label: "Relevance",
    shortLabel: "Match",
    description: "How well the post matches the community's topic.",
    barClassName: "bg-primary",
  },
] as const

const demoPosts: readonly DemoPost[] = [
  {
    id: "P1",
    author: "Maya Keene",
    handle: "@maya-keene.bsky.social",
    time: "14m",
    avatarSrc: "/images/avatars/maya-keene.png",
    text: "Built a tiny script to log neighborhood finch sightings from my morning walks.",
    tags: ["birding", "code", "field notes"],
    stats: { replies: "18", reposts: "42", likes: "164" },
    scores: { recency: 0.72, engagement: 0.42, bridging: 0.92, sourceDiversity: 0.68, relevance: 0.9 },
  },
  {
    id: "P2",
    author: "Claire Rowan",
    handle: "@toastwindow.bsky.social",
    time: "6m",
    avatarSrc: "/images/avatars/claire-rowan.png",
    text: "Rare tanager spotted near the east trailhead this morning.",
    tags: ["sighting", "local", "fresh"],
    stats: { replies: "9", reposts: "25", likes: "112" },
    scores: { recency: 0.96, engagement: 0.35, bridging: 0.28, sourceDiversity: 0.55, relevance: 0.82 },
  },
  {
    id: "P3",
    author: "Arjun Mehta",
    handle: "@arjunmehta.dev",
    time: "31m",
    avatarSrc: "/images/avatars/arjun-mehta.png",
    text: "This CSS bug has haunted me for three days.",
    tags: ["code", "debugging"],
    stats: { replies: "21", reposts: "36", likes: "208" },
    scores: { recency: 0.64, engagement: 0.58, bridging: 0.22, sourceDiversity: 0.42, relevance: 0.48 },
  },
  {
    id: "P4",
    author: "Eli Moreno",
    handle: "@eli-overthinking.bsky.social",
    time: "18m",
    avatarSrc: "/images/avatars/eli-moreno.png",
    text: "Programmers will do anything except go outside.",
    tags: ["joke", "viral"],
    stats: { replies: "86", reposts: "511", likes: "4.2K" },
    scores: { recency: 0.7, engagement: 0.95, bridging: 0.3, sourceDiversity: 0.35, relevance: 0.36 },
  },
  {
    id: "P5",
    author: "Theo Kim",
    handle: "@thocknotes.bsky.social",
    time: "23m",
    avatarSrc: "/images/avatars/theo-kim.png",
    text: "Open-source bird-call classifier dataset just dropped.",
    tags: ["dataset", "birding", "ml"],
    stats: { replies: "32", reposts: "96", likes: "340" },
    scores: { recency: 0.68, engagement: 0.62, bridging: 0.88, sourceDiversity: 0.84, relevance: 0.94 },
  },
  {
    id: "P6",
    author: "Nina Valdez",
    handle: "@ninavaldez.bsky.social",
    time: "1h",
    avatarSrc: "/images/avatars/nina-valdez.png",
    text: "Field notes from a rainy owl survey, plus the messy CSV.",
    tags: ["field notes", "csv", "survey"],
    stats: { replies: "7", reposts: "19", likes: "88" },
    scores: { recency: 0.46, engagement: 0.28, bridging: 0.74, sourceDiversity: 0.72, relevance: 0.86 },
  },
  {
    id: "P7",
    author: "Leila Hart",
    handle: "@leilahart.bsky.social",
    time: "16m",
    avatarSrc: "/images/avatars/leila-hart.png",
    text: "My camera roll is 80% blurry sparrows and 20% screenshots of stack traces.",
    tags: ["birding", "code", "funny"],
    stats: { replies: "15", reposts: "54", likes: "261" },
    scores: { recency: 0.75, engagement: 0.66, bridging: 0.7, sourceDiversity: 0.52, relevance: 0.76 },
  },
] as const

const epochs: readonly Epoch[] = [
  {
    id: "engagement",
    eyebrow: "Epoch 07",
    label: "Engagement-heavy",
    headline: "Likes dominate the feed.",
    body: "This is the failure mode the community wants to fix: the viral joke wins even though it is a weak match.",
    weights: { recency: 0.05, engagement: 0.65, bridging: 0.05, sourceDiversity: 0.05, relevance: 0.2 },
  },
  {
    id: "bridge",
    eyebrow: "Epoch 08",
    label: "Bridge-building policy",
    headline: "The community boosts posts that connect subgroups.",
    body: "The policy rewards posts that carry useful context across both sides of the feed.",
    weights: { recency: 0.15, engagement: 0.1, bridging: 0.35, sourceDiversity: 0.15, relevance: 0.25 },
  },
  {
    id: "field",
    eyebrow: "Epoch 09",
    label: "Field-notes policy",
    headline: "Useful sources get more room.",
    body: "The feed shifts toward relevance and source diversity so datasets, surveys, and field notes do not vanish under jokes.",
    weights: { recency: 0.15, engagement: 0.1, bridging: 0.15, sourceDiversity: 0.3, relevance: 0.3 },
  },
  {
    id: "freshness",
    eyebrow: "Epoch 10",
    label: "Freshness push",
    headline: "Time-sensitive sightings rise.",
    body: "When the community cares about today's field context, fresh sightings move up without making likes the whole policy.",
    weights: { recency: 0.55, engagement: 0.05, bridging: 0.05, sourceDiversity: 0.05, relevance: 0.3 },
  },
] as const

function scorePost(post: DemoPost, epoch: Epoch): number {
  return signals.reduce((total, signal) => {
    return total + post.scores[signal.key] * epoch.weights[signal.key]
  }, 0)
}

function rankPosts(epoch: Epoch): RankedPost[] {
  return demoPosts
    .map((post) => ({
      post,
      score: scorePost(post, epoch),
    }))
    .sort((left, right) => right.score - left.score)
    .map((rankedPost, index) => ({
      ...rankedPost,
      rank: index + 1,
    }))
}

function getEpochById(epochId: EpochId): Epoch {
  const epoch = epochs.find((candidate) => candidate.id === epochId)

  if (epoch === undefined) {
    throw new Error(`Unknown epoch id: ${epochId}`)
  }

  return epoch
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatScore(value: number): string {
  return value.toFixed(3)
}

function getTopPostId(epochId: EpochId): PostId {
  const topPost = rankPosts(getEpochById(epochId))[0]

  if (topPost === undefined) {
    throw new Error(`No ranked posts for epoch: ${epochId}`)
  }

  return topPost.post.id
}

function movementLabel(currentRank: number, previousRank: number | undefined): string | null {
  if (previousRank === undefined) {
    return null
  }

  if (previousRank === currentRank) {
    return "held rank"
  }

  if (previousRank > currentRank) {
    return `up from #${previousRank}`
  }

  return `down from #${previousRank}`
}

function MovementIcon(props: { readonly currentRank: number; readonly previousRank: number | undefined }) {
  if (props.previousRank === undefined || props.previousRank === props.currentRank) {
    return <Minus className="h-3.5 w-3.5" aria-hidden="true" />
  }

  if (props.previousRank > props.currentRank) {
    return <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
  }

  return <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
}

function WeightBars(props: {
  readonly epoch: Epoch
  readonly compact: boolean
  readonly reduceMotion: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      {signals.map((signal) => {
        const weight = props.epoch.weights[signal.key]

        return (
          <div key={signal.key} className="grid grid-cols-[112px_minmax(0,1fr)_42px] items-center gap-3">
            <span className="text-xs font-semibold text-foreground/70">
              {props.compact ? signal.shortLabel : signal.label}
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-border/60">
              <motion.div
                className={`h-full rounded-full ${signal.barClassName}`}
                initial={false}
                animate={{ width: formatPercent(weight) }}
                transition={props.reduceMotion ? { duration: 0 } : { duration: 0.28, ease: "easeOut" }}
              />
            </div>
            <span className="text-right font-mono text-xs font-semibold text-foreground/55">
              {formatPercent(weight)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function FeedCard(props: {
  readonly rankedPost: RankedPost
  readonly previousRank: number | undefined
  readonly selected: boolean
  readonly onSelect: (postId: PostId) => void
  readonly reduceMotion: boolean
}) {
  const post = props.rankedPost.post
  const movement = movementLabel(props.rankedPost.rank, props.previousRank)
  const annotationTone = props.selected
    ? "border-primary bg-primary/[0.06] shadow-[inset_3px_0_0_rgba(200,97,44,0.75)]"
    : "border-primary/20 bg-primary/[0.035]"

  return (
    <motion.article
      layout={!props.reduceMotion}
      initial={false}
      transition={{ type: "spring", stiffness: 360, damping: 34 }}
      className={`grid grid-cols-1 bg-white text-[#0B0F14] transition-shadow sm:grid-cols-[minmax(0,1fr)_112px] ${
        props.selected ? "relative z-10 shadow-[0_10px_28px_rgba(200,97,44,0.14)] ring-2 ring-primary/80" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => props.onSelect(post.id)}
        className="flex min-w-0 items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[#F8FAFC]"
        aria-pressed={props.selected}
      >
        <Image
          src={post.avatarSrc}
          alt=""
          width={42}
          height={42}
          className="h-[42px] w-[42px] flex-shrink-0 rounded-full object-cover"
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[15px] leading-5">
            <span className="font-bold text-[#0B0F14]">{post.author}</span>
            <span className="truncate font-normal text-[#42576C]">{post.handle}</span>
            <span className="text-[#42576C]">·</span>
            <span className="font-normal text-[#42576C]">{post.time}</span>
          </span>
          <span className="mt-0.5 block text-[15px] leading-5 text-[#0B0F14]">{post.text}</span>
          <span className="flex flex-wrap items-center gap-x-7 gap-y-1 pt-3 text-[#6F869F]">
            <span className="inline-flex items-center gap-1.5 text-[13px]">
              <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              {post.stats.replies}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[13px]">
              <Repeat2 className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              {post.stats.reposts}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[13px]">
              <Heart className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              {post.stats.likes}
            </span>
            <span className="inline-flex items-center justify-end">
              <Bookmark className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              <span className="sr-only">Save</span>
            </span>
            <span className="inline-flex items-center justify-end">
              <Share2 className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              <span className="sr-only">Share</span>
            </span>
            <span className="inline-flex items-center justify-end">
              <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              <span className="sr-only">More</span>
            </span>
          </span>
        </span>
      </button>
      <aside className={`flex items-center justify-between gap-2 border-t border-dashed px-4 py-3 sm:flex-col sm:justify-center sm:border-l sm:border-t-0 sm:px-2 sm:text-center ${annotationTone}`}>
        <span className="text-[9px] font-mono font-semibold uppercase tracking-[0.16em] text-primary/55">
          Corgi
        </span>
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/25 bg-white text-xs font-mono font-bold text-primary shadow-sm">
          #{props.rankedPost.rank}
        </span>
        <span className="font-mono text-[11px] font-semibold text-primary">{formatScore(props.rankedPost.score)}</span>
        {movement === null ? null : (
          <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-foreground/55 shadow-sm">
            <MovementIcon currentRank={props.rankedPost.rank} previousRank={props.previousRank} />
            {movement}
          </span>
        )}
      </aside>
    </motion.article>
  )
}

function ReceiptPanel(props: { readonly epoch: Epoch; readonly rankedPost: RankedPost }) {
  const post = props.rankedPost.post

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-card shadow-[0_2px_14px_rgba(46,38,32,0.06)]">
      <div className="border-b border-border/60 px-5 py-4">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/35">Corgi receipt</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between lg:flex-col xl:flex-row">
          <div>
            <h3 className="text-xl font-bold leading-tight text-foreground">Why ranked #{props.rankedPost.rank}</h3>
            <p className="mt-1 text-sm leading-relaxed text-foreground/55">{post.text}</p>
          </div>
          <span className="w-fit rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-mono font-semibold text-primary">
            {formatScore(props.rankedPost.score)}
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 px-5 py-5">
        {signals.map((signal) => {
          const rawScore = post.scores[signal.key]
          const weight = props.epoch.weights[signal.key]
          const contribution = rawScore * weight

          return (
            <div key={signal.key} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-border/70 bg-background px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{signal.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-foreground/45">{signal.description}</p>
              </div>
              <div className="text-right font-mono text-xs text-foreground/55">
                <p>{formatScore(rawScore)}</p>
                <p>x {formatPercent(weight)}</p>
                <p className="mt-1 font-bold text-primary">= {formatScore(contribution)}</p>
              </div>
            </div>
          )
        })}
      </div>
      <div className="border-t border-border/60 px-5 py-4">
        <p className="text-sm leading-relaxed text-foreground/65">
          This post ranks here because the active policy is <span className="font-semibold text-foreground">{props.epoch.label}</span>. Corgi stores the score components so people can inspect the mechanism on Corgi, while Bluesky shows the ordered posts.
        </p>
      </div>
    </div>
  )
}

function CounterfactualComparison() {
  const engagementRanking = rankPosts(getEpochById("engagement")).slice(0, 4)
  const communityRanking = rankPosts(getEpochById("bridge")).slice(0, 4)

  return (
    <section className="mx-auto max-w-[1320px] border-t border-border/60 px-5 py-12 md:px-8 md:py-16 lg:px-12">
      <div className="mx-auto mb-8 max-w-3xl text-center">
        <p className="mb-2 text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/35">Counterfactual</p>
        <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl">
          Same posts. Different policy. Different feed.
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-foreground/55">
          Corgi separates post signals from community values. Changing the policy changes the order without pretending the posts themselves changed.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {[
          { label: "Engagement-heavy ranking", rankedPosts: engagementRanking },
          { label: "Community-governed ranking", rankedPosts: communityRanking },
        ].map((ranking) => (
          <div key={ranking.label} className="rounded-2xl border border-border bg-card p-5 shadow-[0_2px_14px_rgba(46,38,32,0.06)]">
            <h3 className="text-lg font-bold text-foreground">{ranking.label}</h3>
            <div className="mt-4 flex flex-col gap-3">
              {ranking.rankedPosts.map((rankedPost) => (
                <div key={rankedPost.post.id} className="flex items-start gap-3 rounded-xl border border-border/70 bg-background px-4 py-3">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-bold text-primary">
                    #{rankedPost.rank}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-snug text-foreground">{rankedPost.post.text}</p>
                    <p className="mt-1 font-mono text-xs text-foreground/45">score {formatScore(rankedPost.score)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ScoringMath() {
  const bridgeEpoch = getEpochById("bridge")

  return (
    <section className="mx-auto max-w-[1320px] border-t border-border/60 px-5 py-12 md:px-8 md:py-16 lg:px-12">
      <div className="mx-auto mb-8 max-w-3xl text-center">
        <p className="mb-2 text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/35">
          Calculation
        </p>
        <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl">
          Inspect the scoring math.
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-foreground/55">
          The demo keeps raw post scores fixed so you can see the core product idea: community policy weights decide how much each signal counts.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_2px_14px_rgba(46,38,32,0.06)] md:p-6">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-xl border border-border/70 bg-background">
            <div className="border-b border-border/60 px-4 py-3">
              <p className="text-sm font-bold text-foreground">Raw signal scores</p>
              <p className="mt-1 text-xs leading-relaxed text-foreground/48">
                These are the same post scores used by every policy in the walkthrough.
              </p>
            </div>
            <div className="overflow-x-auto px-4">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border/70 text-xs uppercase tracking-[0.14em] text-foreground/40">
                    <th className="py-3 pr-4 font-semibold">Post</th>
                    {signals.map((signal) => (
                      <th key={signal.key} className="px-3 py-3 font-semibold">{signal.shortLabel}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {demoPosts.map((post) => (
                    <tr key={post.id} className="border-b border-border/40 last:border-0">
                      <td className="max-w-[260px] py-3 pr-4 text-foreground/75">{post.text}</td>
                      {signals.map((signal) => (
                        <td key={signal.key} className="px-3 py-3 font-mono text-xs text-foreground/55">
                          {formatScore(post.scores[signal.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border/70 bg-background p-5">
              <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/35">Formula</p>
              <p className="mt-3 font-mono text-sm leading-relaxed text-foreground/75">
                total = sum(raw signal score x active policy weight)
              </p>
              <p className="mt-3 text-sm leading-relaxed text-foreground/55">
                For the bridge-building policy, the weights sum to 100%: recency {formatPercent(bridgeEpoch.weights.recency)}, engagement {formatPercent(bridgeEpoch.weights.engagement)}, bridging {formatPercent(bridgeEpoch.weights.bridging)}, source diversity {formatPercent(bridgeEpoch.weights.sourceDiversity)}, relevance {formatPercent(bridgeEpoch.weights.relevance)}.
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background p-5">
              <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/35">What an epoch means</p>
              <p className="mt-3 text-sm leading-relaxed text-foreground/55">
                An epoch is a stored feed policy from a voting round. The post signals stay the same in this demo, but the active epoch changes how much each signal matters.
              </p>
            </div>
            <div className="rounded-xl border border-primary/15 bg-primary/[0.06] p-5">
              <p className="text-sm leading-relaxed text-foreground/65">
                Demo posts are illustrative; live ranking claims use Corgi receipts and snapshot data.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function HowItWorksReplay() {
  const [activeEpochId, setActiveEpochId] = useState<EpochId>("engagement")
  const [previousEpochId, setPreviousEpochId] = useState<EpochId | null>(null)
  const [selectedPostId, setSelectedPostId] = useState<PostId>(getTopPostId("engagement"))
  const shouldReduceMotion = useReducedMotion()
  const activeEpoch = getEpochById(activeEpochId)
  const previousEpoch = previousEpochId === null ? null : getEpochById(previousEpochId)
  const rankedPosts = useMemo(() => rankPosts(activeEpoch), [activeEpoch])
  const previousRankMap = useMemo(() => {
    if (previousEpoch === null) {
      return new Map<PostId, number>()
    }

    return new Map(rankPosts(previousEpoch).map((rankedPost) => [rankedPost.post.id, rankedPost.rank]))
  }, [previousEpoch])
  const selectedRankedPost = rankedPosts.find((rankedPost) => rankedPost.post.id === selectedPostId) ?? rankedPosts[0]

  if (selectedRankedPost === undefined) {
    return null
  }

  return (
    <>
      <section id="replay" className="mx-auto max-w-[1320px] px-4 py-10 md:px-6 md:py-14 lg:px-8">
        <div className="mb-6 flex flex-col gap-3 text-center">
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/35">Replay a policy change</p>
          <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground md:text-5xl">
            Watch the same posts become a different feed.
          </h2>
          <p className="mx-auto max-w-2xl text-base font-medium leading-relaxed text-foreground/55">
            Corgi scores candidate posts once, then applies the active community policy. Change the epoch and the feed order changes with it.
          </p>
        </div>

        <div className="rounded-3xl border border-border bg-card shadow-[0_8px_40px_rgba(46,38,32,0.12)]">
          <div className="border-b border-border/60 px-4 py-4 sm:px-5">
            <div className="flex flex-wrap gap-2">
              {epochs.map((epoch) => (
                <button
                  key={epoch.id}
                  type="button"
                  onClick={() => {
                    if (epoch.id === activeEpochId) {
                      return
                    }

                    setPreviousEpochId(activeEpochId)
                    setActiveEpochId(epoch.id)
                    setSelectedPostId(getTopPostId(epoch.id))
                  }}
                  aria-pressed={epoch.id === activeEpochId}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                    epoch.id === activeEpochId
                      ? "border-primary bg-primary text-primary-foreground shadow-[0_3px_12px_rgba(200,97,44,0.22)]"
                      : "border-border bg-background text-foreground/65 hover:border-primary/35 hover:text-foreground"
                  }`}
                >
                  {epoch.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-0 xl:grid-cols-[0.82fr_1.1fr_0.92fr]">
            <aside className="border-b border-border/60 bg-background/55 p-4 sm:p-5 xl:border-b-0 xl:border-r">
              <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_2px_14px_rgba(46,38,32,0.06)]">
                <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/35">{activeEpoch.eyebrow}</p>
                <h3 className="mt-2 text-2xl font-bold leading-tight text-foreground">{activeEpoch.label}</h3>
                <p className="mt-2 text-sm leading-relaxed text-foreground/55">{activeEpoch.body}</p>
                <div className="mt-5">
                  <WeightBars epoch={activeEpoch} compact={false} reduceMotion={shouldReduceMotion === true} />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
                    <Bird className="mx-auto h-4 w-4 text-primary" aria-hidden="true" />
                    <p className="mt-1 text-[11px] font-semibold text-foreground/55">birding</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
                    <Code2 className="mx-auto h-4 w-4 text-primary" aria-hidden="true" />
                    <p className="mt-1 text-[11px] font-semibold text-foreground/55">code</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
                    <Database className="mx-auto h-4 w-4 text-primary" aria-hidden="true" />
                    <p className="mt-1 text-[11px] font-semibold text-foreground/55">datasets</p>
                  </div>
                </div>
              </div>
            </aside>

            <div className="border-b border-border/60 bg-white p-0 xl:border-b-0 xl:border-r">
              <div className="border-b border-[#D4DBE2] bg-white px-4 pb-0 pt-3">
                <div className="flex h-8 items-center justify-center">
                  <Image
                    src="/images/bluesky-butterfly-logo.svg"
                    alt="Bluesky"
                    width={28}
                    height={25}
                    priority={true}
                    className="h-[25px] w-[28px]"
                  />
                </div>
                <div className="mt-1 flex min-w-0 items-end gap-5 overflow-x-auto text-[13px] font-semibold text-[#42576C] sm:text-[14px]">
                  {["Discover", "Following", "Birders Who Code", "Tools"].map((tab, index) => (
                    <span key={tab} className={`relative shrink-0 py-3 ${index === 2 ? "text-[#0B0F14]" : ""}`}>
                      {tab}
                      {index === 2 ? <span className="absolute inset-x-0 bottom-0 h-1 rounded-full bg-[#0085FF]" /> : null}
                    </span>
                  ))}
                </div>
              </div>
              <div className="divide-y divide-[#D4DBE2]">
                {rankedPosts.map((rankedPost) => (
                  <FeedCard
                    key={rankedPost.post.id}
                    rankedPost={rankedPost}
                    previousRank={previousRankMap.get(rankedPost.post.id)}
                    selected={rankedPost.post.id === selectedPostId}
                    onSelect={setSelectedPostId}
                    reduceMotion={shouldReduceMotion === true}
                  />
                ))}
              </div>
            </div>

            <div className="bg-card p-4 sm:p-5">
              <ReceiptPanel epoch={activeEpoch} rankedPost={selectedRankedPost} />
            </div>
          </div>

          <div className="border-t border-border/60 px-5 py-4">
            <p className="text-xs leading-relaxed text-foreground/45">
              The rank numbers and receipt panel are Corgi-site annotations for this product demo. Standard Bluesky clients render the ordered posts, not Corgi score panels.
            </p>
          </div>
        </div>
      </section>

      <CounterfactualComparison />
      <ScoringMath />
    </>
  )
}
