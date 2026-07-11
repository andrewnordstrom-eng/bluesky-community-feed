import type { ReactNode } from "react"
import Image from "next/image"
import { Heart, MessageCircle, Repeat2 } from "lucide-react"

/**
 * Canonical Bluesky-native feed primitives — the SINGLE source of truth for the
 * "Bluesky post + Corgi rank" surfaces (landing teaser, how-it-works replay, and
 * the /demo). Every surface composes these instead of hand-rolling the chrome, so
 * the cards, tabs, dividers, and Corgi rank column can never drift again.
 *
 * The cool Bluesky chrome is fixed here in exact hex; the warm Corgi rank column
 * uses design tokens. Keep Corgi annotations (the rank badge) OUTSIDE the card.
 */

/** Width of the right-hand Corgi rank column — shared by the header and every row. */
export const RANK_COL_CLASS = "grid grid-cols-[minmax(0,1fr)_104px]"

export function formatCount(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return "0"
  }
  if (typeof value === "string") {
    return value
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`
  }
  return `${value}`
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return "?"
  }
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("")
}

export interface BlueskyPostCardProps {
  readonly authorDisplayName: string
  readonly authorHandle: string
  readonly timeLabel: string
  readonly avatarUrl?: string | null
  readonly text: string
  readonly replyCount?: number | string | null
  readonly repostCount?: number | string | null
  readonly likeCount?: number | string | null
  /** `compact` shrinks the avatar + hides engagement (for the small landing teaser). */
  readonly density?: "default" | "compact"
}

/** A faithful, native-looking Bluesky post card. Presentational; no Corgi styling. */
export function BlueskyPostCard({
  authorDisplayName,
  authorHandle,
  timeLabel,
  avatarUrl,
  text,
  replyCount,
  repostCount,
  likeCount,
  density = "default",
}: BlueskyPostCardProps) {
  const compact = density === "compact"
  const avatarSize = compact ? 34 : 42
  const hasReplyCount = replyCount !== undefined && replyCount !== null
  const hasRepostCount = repostCount !== undefined && repostCount !== null
  const hasLikeCount = likeCount !== undefined && likeCount !== null
  const showActions = hasReplyCount || hasRepostCount || hasLikeCount
  return (
    <div className={`flex min-w-0 items-start gap-3 ${compact ? "px-3.5 py-3" : "px-4 py-3.5"}`}>
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt=""
          width={avatarSize}
          height={avatarSize}
          className="flex-shrink-0 rounded-full object-cover"
          style={{ width: avatarSize, height: avatarSize }}
        />
      ) : (
        <span
          className="flex flex-shrink-0 items-center justify-center rounded-full bg-[#E1E8F0] font-bold text-[#42576C]"
          style={{ width: avatarSize, height: avatarSize, fontSize: compact ? 12 : 14 }}
          aria-hidden="true"
        >
          {initials(authorDisplayName)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className={`flex min-w-0 flex-wrap items-center gap-x-1.5 leading-5 ${compact ? "text-[14px]" : "text-[15px]"}`}>
          <span className="font-bold text-[#0B0F14]">{authorDisplayName}</span>
          <span className="truncate font-normal text-[#42576C]">@{authorHandle}</span>
          <span className="text-[#42576C]">·</span>
          <span className="font-normal text-[#42576C]">{timeLabel}</span>
        </div>
        <p className={`mt-0.5 leading-5 text-[#0B0F14] ${compact ? "text-[14px]" : "text-[15px]"}`}>{text}</p>
        {showActions && !compact ? (
          <div className="flex flex-wrap items-center gap-x-7 gap-y-1 pt-3 text-[13px] text-[#6F869F]">
            {hasReplyCount ? <span className="inline-flex items-center gap-1.5 tabular-nums">
              <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              {formatCount(replyCount)}
            </span> : null}
            {hasRepostCount ? <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Repeat2 className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              {formatCount(repostCount)}
            </span> : null}
            {hasLikeCount ? <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Heart className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              {formatCount(likeCount)}
            </span> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** The "Corgi rank · Epoch N" header cell that labels the rank column once. */
export function RankColumnHeader({ label = "Corgi rank", sublabel }: { readonly label?: string; readonly sublabel?: string }) {
  return (
    <div className="flex flex-col items-center justify-center border-l border-border/60 bg-biscuit/25 px-2 text-center">
      <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] leading-none text-primary/80">{label}</span>
      {sublabel ? <span className="mt-1 font-mono text-[9px] leading-none text-foreground/45">{sublabel}</span> : null}
    </div>
  )
}

/** A single feed row: post card on the left, Corgi rank annotation in the warm right column. */
export function FeedRow({
  children,
  rank,
  selected = false,
  onSelect,
}: {
  readonly children: ReactNode
  readonly rank: ReactNode
  readonly selected?: boolean
  readonly onSelect?: () => void
}) {
  const post = onSelect ? (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="w-full text-left transition-colors enabled:hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60"
    >
      {children}
    </button>
  ) : (
    children
  )
  return (
    <div className={`${RANK_COL_CLASS} bg-white ${selected ? "relative z-10 shadow-[0_10px_30px_rgba(200,97,44,0.14)] ring-2 ring-inset ring-primary/70" : ""}`}>
      {post}
      <div className="flex items-center justify-center border-l border-border/60 bg-biscuit/25 px-2">{rank}</div>
    </div>
  )
}

/** The Bluesky feed frame: butterfly + native tabs + a Corgi rank column header, wrapping rows. */
export function BlueskyFeedFrame({
  communityName,
  epochLabel,
  showRankHeader = true,
  className,
  children,
}: {
  readonly communityName: string
  readonly epochLabel?: string
  readonly showRankHeader?: boolean
  readonly className?: string
  readonly children: ReactNode
}) {
  const tabs = ["Discover", "Following", communityName, "Tools"]
  return (
    <div className={`rounded-[1.25rem] border border-[#D9E3EE] bg-white shadow-[0_1px_3px_rgba(11,15,20,0.05)] ${className ?? ""}`}>
      <div className={`border-b border-[#D9E3EE] ${showRankHeader ? RANK_COL_CLASS : ""}`}>
        <div className="px-4 pt-3">
          <div className="flex h-6 items-center justify-center">
            <Image src="/images/bluesky-butterfly-logo.svg" alt="Bluesky" width={22} height={19} className="h-[19px] w-[22px]" />
          </div>
          <div className="mt-1 flex items-end gap-5 overflow-x-auto text-[13px] font-semibold text-[#42576C]">
            {tabs.map((tab) => (
              <span
                key={tab}
                className={`shrink-0 border-b-2 pb-2.5 ${tab === communityName ? "border-[#0085FF] text-[#0B0F14]" : "border-transparent"}`}
              >
                {tab}
              </span>
            ))}
          </div>
        </div>
        {showRankHeader ? <RankColumnHeader sublabel={epochLabel} /> : null}
      </div>
      <div className="divide-y divide-[#D9E3EE]">{children}</div>
    </div>
  )
}
