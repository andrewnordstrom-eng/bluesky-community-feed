"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import {
  epochs,
  signals,
  rankPosts,
  getEpochById,
  formatPercent,
  type Epoch,
  type EpochId,
  type PostId,
} from "@/lib/replay-model"
import { BlueskyPostCard, RANK_COL_CLASS, RankColumnHeader } from "@/components/feed/bluesky-feed"
import { CorgiRankBadge } from "@/components/feed/corgi-rank-badge"
import { badgeMovementFor, rankSignalsFor } from "@/components/feed/replay-adapter"
import Image from "next/image"

const FEED_LIMIT = 5

function CompactWeightBars(props: { readonly epoch: Epoch; readonly reduceMotion: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      {signals.map((signal) => {
        const weight = props.epoch.weights[signal.key]
        return (
          <div key={signal.key} className="grid grid-cols-[64px_minmax(0,1fr)_34px] items-center gap-2">
            <span className="text-[11px] font-semibold text-foreground/60">{signal.shortLabel}</span>
            <div className="h-1.5 overflow-hidden rounded-full bg-border/60">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: signal.barColor }}
                initial={false}
                animate={{ width: formatPercent(weight) }}
                transition={props.reduceMotion ? { duration: 0 } : { duration: 0.28, ease: "easeOut" }}
              />
            </div>
            <span className="text-right font-mono text-[11px] font-semibold text-foreground/55">{formatPercent(weight)}</span>
          </div>
        )
      })}
    </div>
  )
}

export function ReplayTeaser() {
  const [activeEpochId, setActiveEpochId] = useState<EpochId>("engagement")
  const [previousEpochId, setPreviousEpochId] = useState<EpochId | null>(null)
  const shouldReduceMotion = useReducedMotion() ?? false
  const activeEpoch = getEpochById(activeEpochId)
  const previousEpoch = previousEpochId === null ? null : getEpochById(previousEpochId)
  const rankedPosts = useMemo(() => rankPosts(activeEpoch), [activeEpoch])
  const previousRankMap = useMemo(() => {
    if (previousEpoch === null) {
      return new Map<PostId, number>()
    }
    return new Map(rankPosts(previousEpoch).map((rankedPost) => [rankedPost.post.id, rankedPost.rank]))
  }, [previousEpoch])
  const visiblePosts = rankedPosts.slice(0, FEED_LIMIT)

  return (
    <div className="w-full max-w-[1120px]">
      <div className="rounded-3xl border border-border bg-card shadow-[0_8px_40px_rgba(46,38,32,0.12)]">
        <div className="border-b border-border/60 px-4 py-4 sm:px-5">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/45">Community policy</p>
            <p className="hidden text-[11px] font-medium text-foreground/40 sm:block">Pick one &mdash; the feed reorders instantly</p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Community ranking policy">
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
                }}
                aria-pressed={epoch.id === activeEpochId}
                className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
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

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.05fr)_minmax(300px,0.8fr)]">
          <div className="bg-white lg:border-r lg:border-border/60">
            <div className={`${RANK_COL_CLASS} border-b border-[#D9E3EE]`}>
              <div className="px-4 pt-3">
                <div className="flex h-6 items-center justify-center">
                  <Image src="/images/bluesky-butterfly-logo.svg" alt="Bluesky" width={24} height={21} className="h-[21px] w-[24px]" />
                </div>
                <div className="mt-1 flex min-w-0 items-end gap-5 overflow-x-auto text-[13px] font-semibold text-[#42576C]">
                  {["Discover", "Following", "Birders Who Code", "Tools"].map((tab) => (
                    <span
                      key={tab}
                      className={`shrink-0 border-b-2 pb-2.5 ${tab === "Birders Who Code" ? "border-[#0085FF] text-[#0B0F14]" : "border-transparent"}`}
                    >
                      {tab}
                    </span>
                  ))}
                </div>
              </div>
              <RankColumnHeader sublabel={activeEpoch.eyebrow} />
            </div>
            <div className="divide-y divide-[#D9E3EE]">
              {visiblePosts.map((rankedPost) => {
                const previousRank = previousRankMap.get(rankedPost.post.id)
                return (
                  <motion.div
                    key={rankedPost.post.id}
                    layout={!shouldReduceMotion}
                    initial={false}
                    transition={{ type: "spring", stiffness: 360, damping: 34 }}
                    className={`${RANK_COL_CLASS} bg-white`}
                  >
                    <BlueskyPostCard
                      authorDisplayName={rankedPost.post.author}
                      authorHandle={rankedPost.post.handle.replace(/^@/, "")}
                      timeLabel={rankedPost.post.time}
                      avatarUrl={rankedPost.post.avatarSrc}
                      text={rankedPost.post.text}
                      replyCount={rankedPost.post.stats.replies}
                      repostCount={rankedPost.post.stats.reposts}
                      likeCount={rankedPost.post.stats.likes}
                    />
                    <div className="flex items-center justify-center border-l border-border/60 bg-biscuit/25 px-2">
                      <CorgiRankBadge
                        rank={rankedPost.rank}
                        score={rankedPost.score}
                        movement={badgeMovementFor(rankedPost.rank, previousRank)}
                        previousRank={previousRank}
                        signals={rankSignalsFor(rankedPost, activeEpoch)}
                        showMovement={previousEpoch !== null}
                        fullReceiptHref="/how-it-works#replay"
                      />
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-4 bg-background/55 p-4 sm:p-5">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-[0_2px_14px_rgba(46,38,32,0.06)]">
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-foreground/45">{activeEpoch.eyebrow}</p>
              <h3 className="mt-1 text-base font-bold leading-tight text-foreground">{activeEpoch.label}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-foreground/55">{activeEpoch.body}</p>
              <div className="mt-3.5">
                <CompactWeightBars epoch={activeEpoch} reduceMotion={shouldReduceMotion} />
              </div>
            </div>

            <p className="text-[11px] leading-relaxed text-foreground/45">
              Tap <span className="font-semibold text-primary">Why</span> on any post for its receipt. Rank badges and receipts are
              Corgi annotations, not native Bluesky chrome.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-foreground/45">
            Illustrative demo &mdash; live ranking claims use Corgi receipts and snapshot data.
          </span>
          <Link href="/how-it-works#replay" className="text-sm font-semibold text-primary hover:underline underline-offset-2">
            See the full math and every receipt &rarr;
          </Link>
        </div>
      </div>
    </div>
  )
}
