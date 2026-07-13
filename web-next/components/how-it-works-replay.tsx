"use client"

import Image from "next/image"
import { useMemo, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { Code2, Database, FlaskConical } from "lucide-react"
import { BlueskyPostCard, RANK_COL_CLASS, RankColumnHeader } from "@/components/feed/bluesky-feed"
import { CorgiRankBadge } from "@/components/feed/corgi-rank-badge"
import { badgeMovementFor, rankSignalsFor } from "@/components/feed/replay-adapter"
import {
  demoPosts,
  epochs,
  formatPercent,
  formatScore,
  getEpochById,
  getTopPostId,
  rankPosts,
  signals,
  type Epoch,
  type EpochId,
  type PostId,
  type RankedPost,
} from "@/lib/replay-model"
import { Section } from "@/components/ui/layout"

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
                className="h-full rounded-full"
                style={{ backgroundColor: signal.barColor }}
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
  readonly activeEpoch: Epoch
  readonly showMovement: boolean
}) {
  const post = props.rankedPost.post
  return (
    <motion.article
      layout={!props.reduceMotion}
      initial={false}
      transition={{ type: "spring", stiffness: 360, damping: 34 }}
      className={`${RANK_COL_CLASS} bg-white transition-shadow ${
        props.selected ? "relative z-10 shadow-[0_10px_28px_rgba(200,97,44,0.14)] ring-2 ring-inset ring-primary/70" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => props.onSelect(post.id)}
        aria-pressed={props.selected}
        className="w-full text-left transition-colors hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60"
      >
        <BlueskyPostCard
          authorDisplayName={post.author}
          authorHandle={post.handle.replace(/^@/, "")}
          timeLabel={post.time}
          avatarUrl={post.avatarSrc}
          text={post.text}
          replyCount={post.stats.replies}
          repostCount={post.stats.reposts}
          likeCount={post.stats.likes}
        />
      </button>
      <div className="flex flex-col items-center justify-center gap-2 border-l border-border/60 bg-biscuit/25 px-2 py-3">
        <CorgiRankBadge
          rank={props.rankedPost.rank}
          score={props.rankedPost.score}
          movement={badgeMovementFor(props.rankedPost.rank, props.previousRank)}
          previousRank={props.previousRank}
          signals={rankSignalsFor(props.rankedPost, props.activeEpoch)}
          showMovement={props.showMovement}
          showWhy={false}
        />
        <button
          type="button"
          onClick={() => props.onSelect(post.id)}
          aria-pressed={props.selected}
          aria-label={`Inspect ranking for post ranked #${props.rankedPost.rank}`}
          className="rounded-md px-1 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
        >
          Inspect
        </button>
      </div>
    </motion.article>
  )
}

function ReceiptPanel(props: { readonly epoch: Epoch; readonly rankedPost: RankedPost }) {
  const post = props.rankedPost.post

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-card shadow-[0_2px_14px_rgba(46,38,32,0.06)]">
      <div className="border-b border-border/60 px-5 py-4">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/55">Corgi receipt</p>
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
                <p className="mt-1 text-xs leading-relaxed text-foreground/55">{signal.description}</p>
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
    <Section bordered spacing="default">
      <div className="mx-auto mb-8 max-w-3xl text-center">
        <p className="mb-2 text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/55">Counterfactual</p>
        <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl">
          Same posts. Different policy. Different feed.
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-foreground/55">
          Corgi separates post signals from community values. Changing the policy changes the order without pretending the posts themselves changed.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {[
          { label: "Conversation-heavy ranking", rankedPosts: engagementRanking },
          { label: "Corgi Commons policy", rankedPosts: communityRanking },
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
                    <p className="mt-1 font-mono text-xs text-foreground/55">score {formatScore(rankedPost.score)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function ScoringMath() {
  const bridgeEpoch = getEpochById("bridge")

  return (
    <Section bordered spacing="default">
      <div className="mx-auto mb-8 max-w-3xl text-center">
        <p className="mb-2 text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/55">
          Calculation
        </p>
        <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl">
          Inspect the scoring math.
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-foreground/55">
          This illustrative replay keeps raw post scores fixed so you can isolate the policy change. Production rescoring recomputes candidate scores before publication.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_2px_14px_rgba(46,38,32,0.06)] md:p-6">
        {/* min-w-0 on both columns: without it the table's intrinsic width forces
            the whole card past the phone viewport instead of scrolling inside it */}
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="min-w-0 rounded-xl border border-border/70 bg-background">
            <div className="border-b border-border/60 px-4 py-3">
              <p className="text-sm font-bold text-foreground">Raw signal scores</p>
              <p className="mt-1 text-xs leading-relaxed text-foreground/48">
                These are the same post scores used by every policy in the walkthrough.
              </p>
              <p className="mt-1 text-[11px] text-foreground/50 lg:hidden">Swipe sideways to see all five signals.</p>
            </div>
            <div className="overflow-x-auto px-4">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border/70 text-xs uppercase tracking-[0.14em] text-foreground/50">
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

          <div className="flex min-w-0 flex-col gap-4">
            <div className="rounded-xl border border-border/70 bg-background p-5">
              <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/55">Formula</p>
              <p className="mt-3 font-mono text-sm leading-relaxed text-foreground/75">
                total = sum(raw signal score x active policy weight)
              </p>
              <p className="mt-3 text-sm leading-relaxed text-foreground/55">
                For the bridge-building policy, the weights sum to 100%: recency {formatPercent(bridgeEpoch.weights.recency)}, engagement {formatPercent(bridgeEpoch.weights.engagement)}, bridging {formatPercent(bridgeEpoch.weights.bridging)}, source diversity {formatPercent(bridgeEpoch.weights.sourceDiversity)}, relevance {formatPercent(bridgeEpoch.weights.relevance)}.
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background p-5">
              <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/55">Topics shape relevance</p>
              <p className="mt-3 text-sm leading-relaxed text-foreground/55">
                Topic preferences are a separate policy map. They change the relevance signal only; they are not five more global ranking signals.
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background p-5">
              <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/55">Rules shape eligibility</p>
              <p className="mt-3 text-sm leading-relaxed text-foreground/55">
                Adopted include rules act as an allowlist, exclude rules take precedence, and production adoption requires at least 30% support among ballots that submit content rules.
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background p-5">
              <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/55">What an epoch means</p>
              <p className="mt-3 text-sm leading-relaxed text-foreground/55">
                An epoch is a stored feed policy. In production, a closed round is aggregated and reviewed before operator approval applies the complete policy and triggers a rescore.
              </p>
            </div>
            <div className="rounded-xl border border-primary/15 bg-primary/[0.06] p-5">
              <p className="text-sm leading-relaxed text-foreground/65">
                Component scores explain the weighted sum. Publication-time adjustments, such as duplicate-link handling, can still affect final order and are called out in live receipts.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Section>
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
      <Section id="replay" spacing="default">
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
                <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/55">{activeEpoch.eyebrow}</p>
                <h3 className="mt-2 text-2xl font-bold leading-tight text-foreground">{activeEpoch.label}</h3>
                <p className="mt-2 text-sm leading-relaxed text-foreground/55">{activeEpoch.body}</p>
                <div className="mt-5">
                  <WeightBars epoch={activeEpoch} compact={false} reduceMotion={shouldReduceMotion === true} />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
                    <FlaskConical className="mx-auto h-4 w-4 text-primary" aria-hidden="true" />
                    <p className="mt-1 text-[11px] font-semibold text-foreground/55">research</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
                    <Code2 className="mx-auto h-4 w-4 text-primary" aria-hidden="true" />
                    <p className="mt-1 text-[11px] font-semibold text-foreground/55">software</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
                    <Database className="mx-auto h-4 w-4 text-primary" aria-hidden="true" />
                    <p className="mt-1 text-[11px] font-semibold text-foreground/55">data</p>
                  </div>
                </div>
              </div>
            </aside>

            <div className="border-b border-border/60 bg-white p-0 xl:border-b-0 xl:border-r">
              <div className={`${RANK_COL_CLASS} border-b border-[#D9E3EE] bg-white`}>
                <div className="px-4 pb-0 pt-3">
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
                    {["Discover", "Following", "Corgi Commons", "Tools"].map((tab, index) => (
                      <span key={tab} className={`relative shrink-0 py-3 ${index === 2 ? "text-[#0B0F14]" : ""}`}>
                        {tab}
                        {index === 2 ? <span className="absolute inset-x-0 bottom-0 h-1 rounded-full bg-[#0085FF]" /> : null}
                      </span>
                    ))}
                  </div>
                </div>
                <RankColumnHeader sublabel={activeEpoch.eyebrow} />
              </div>
              <div className="divide-y divide-[#D9E3EE]">
                {rankedPosts.map((rankedPost) => (
                  <FeedCard
                    key={rankedPost.post.id}
                    rankedPost={rankedPost}
                    previousRank={previousRankMap.get(rankedPost.post.id)}
                    selected={rankedPost.post.id === selectedPostId}
                    onSelect={setSelectedPostId}
                    reduceMotion={shouldReduceMotion === true}
                    activeEpoch={activeEpoch}
                    showMovement={previousEpoch !== null}
                  />
                ))}
              </div>
            </div>

            <div className="bg-card p-4 sm:p-5">
              <ReceiptPanel epoch={activeEpoch} rankedPost={selectedRankedPost} />
            </div>
          </div>

          <div className="border-t border-border/60 px-5 py-4">
            <p className="text-xs leading-relaxed text-foreground/55">
              Select a post to inspect its ranking. The rank numbers and receipt panel are Corgi-site annotations; standard Bluesky clients render the ordered posts, not Corgi score panels.
            </p>
          </div>
        </div>
      </Section>

      <CounterfactualComparison />
      <ScoringMath />
    </>
  )
}
