"use client"

import { motion, useReducedMotion } from "framer-motion"
import { EyeOff } from "lucide-react"
import type {
  ShadowDemoFeed,
  ShadowDemoHiddenFeedItem,
  ShadowDemoPublicFeedItem,
  ShadowDemoRankMovement,
  ShadowDemoScoreComponent,
} from "@/app/demo/shadow-demo-contract"
import { SIGNAL_COLORS, formatRelativeTime } from "@/app/demo/shadow-demo-fixtures"
import { LABELS } from "@/app/demo/shadow-demo-copy"
import { BlueskyFeedFrame, BlueskyPostCard, RANK_COL_CLASS } from "@/components/feed/bluesky-feed"
import { CorgiRankBadge, type RankMovementDir, type RankSignal } from "@/components/feed/corgi-rank-badge"

function toBadgeMovement(movement: ShadowDemoRankMovement): { dir: RankMovementDir; delta: number } {
  const dir: RankMovementDir =
    movement.label === "up" ? "up" : movement.label === "down" ? "down" : movement.label === "new" ? "new" : "held"
  return { dir, delta: Math.abs(movement.delta) }
}

function toSignals(components: readonly ShadowDemoScoreComponent[]): RankSignal[] {
  return components.map((component) => ({
    key: component.key,
    label: component.label,
    color: SIGNAL_COLORS[component.key],
    rawScore: component.rawScore,
    weight: component.weight,
    contribution: component.contribution,
  }))
}

function PublicRow({
  item,
  selected,
  onSelect,
  referenceAt,
  showMovement,
  selectable,
  reduceMotion,
}: {
  readonly item: ShadowDemoPublicFeedItem
  readonly selected: boolean
  readonly onSelect: (uri: string) => void
  readonly referenceAt: string
  readonly showMovement: boolean
  readonly selectable: boolean
  readonly reduceMotion: boolean
}) {
  const post = item.post
  return (
    <motion.article
      layout={!reduceMotion}
      initial={false}
      transition={{ type: "spring", stiffness: 360, damping: 34 }}
      className={`${RANK_COL_CLASS} bg-white ${
        selected ? "relative z-10 shadow-[0_10px_30px_rgba(200,97,44,0.16)] ring-2 ring-inset ring-primary/70" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(post.uri)}
        disabled={!selectable}
        aria-pressed={selected}
        className="w-full text-left transition-colors enabled:hover:bg-[#F8FAFC] disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60"
      >
        <BlueskyPostCard
          authorDisplayName={post.authorDisplayName}
          authorHandle={post.authorHandle}
          timeLabel={formatRelativeTime(post.indexedAt, referenceAt)}
          avatarUrl={post.authorAvatar}
          text={post.text}
          replyCount={post.replyCount}
          repostCount={post.repostCount}
          likeCount={post.likeCount}
        />
      </button>
      <div className="flex items-center justify-center border-l border-border/60 bg-biscuit/25 px-2">
        <CorgiRankBadge
          rank={item.rank}
          score={item.score.total}
          movement={toBadgeMovement(item.movement)}
          previousRank={item.previousRank ?? undefined}
          signals={toSignals(item.score.components)}
          showMovement={showMovement}
          showWhy={false}
        />
      </div>
    </motion.article>
  )
}

function HiddenRow({ item, reduceMotion }: { readonly item: ShadowDemoHiddenFeedItem; readonly reduceMotion: boolean }) {
  return (
    <motion.div
      layout={!reduceMotion}
      initial={false}
      transition={{ type: "spring", stiffness: 360, damping: 34 }}
      className={`${RANK_COL_CLASS} bg-[#F7F9FC] text-[#42576C]`}
    >
      <div className="flex min-w-0 items-center gap-3 px-4 py-3.5">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#E1E8F0] text-[#6F869F]">
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-[#42576C]">{LABELS.withheldRow}</span>
          <span className="mt-0.5 block text-xs text-[#6F869F]">Withheld by a moderation label</span>
        </span>
      </div>
      <div className="flex items-center justify-center border-l border-border/60 bg-biscuit/25 px-2">
        <span className="font-display text-[28px] font-bold leading-none text-foreground/35">{item.rank}</span>
      </div>
    </motion.div>
  )
}

export function CorpusFeed({
  feed,
  communityName,
  epochLabel,
  selectedUri,
  onSelect,
  showMovement,
  selectable,
}: {
  readonly feed: ShadowDemoFeed
  readonly communityName: string
  readonly epochLabel?: string
  readonly selectedUri: string | null
  readonly onSelect: (uri: string) => void
  readonly showMovement: boolean
  readonly selectable: boolean
}) {
  const reduceMotion = useReducedMotion() ?? false
  const referenceAt = feed.corpusHealth.collectedAt

  return (
    <BlueskyFeedFrame communityName={communityName} epochLabel={epochLabel}>
      {feed.items.map((item) =>
        item.visibility === "public" ? (
          <PublicRow
            key={item.post.uri}
            item={item}
            selected={selectedUri === item.post.uri}
            onSelect={onSelect}
            referenceAt={referenceAt}
            showMovement={showMovement}
            selectable={selectable}
            reduceMotion={reduceMotion}
          />
        ) : (
          <HiddenRow key={`hidden-${item.rank}`} item={item} reduceMotion={reduceMotion} />
        ),
      )}
    </BlueskyFeedFrame>
  )
}
