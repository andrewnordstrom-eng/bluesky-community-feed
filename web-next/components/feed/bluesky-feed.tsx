import type { ReactNode } from "react"
import Image from "next/image"
import { ExternalLink, Heart, MessageCircle, Play, Repeat2 } from "lucide-react"

/**
 * Canonical Bluesky-native feed primitives — the SINGLE source of truth for the
 * "Bluesky post + Corgi rank" surfaces (landing teaser, how-it-works replay, and
 * the /demo). Every surface composes these instead of hand-rolling the chrome, so
 * the cards, tabs, dividers, and Corgi rank column can never drift again.
 *
 * The cool Bluesky chrome is fixed here in exact hex; the warm Corgi rank column
 * uses design tokens. Keep Corgi annotations (the rank badge) OUTSIDE the card.
 */

/** Width of the right-hand Corgi rank column — shared by the header and every row.
 *  Narrower on phones so the post text keeps a readable line length. */
export const RANK_COL_CLASS = "grid grid-cols-[minmax(0,1fr)_72px] sm:grid-cols-[minmax(0,1fr)_104px]"

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

function safeHostname(uri: string): string {
  try {
    return new URL(uri).hostname
  } catch {
    return uri
  }
}

export function safeWebUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}

export function languageLabel(languages: readonly string[]): string | null {
  if (languages.length === 0 || languages.some((language) => language.toLowerCase().startsWith("en"))) return null
  const knownLanguages = languages.filter((language) => language.toLowerCase() !== "und")
  if (knownLanguages.length === 0) return "Language not tagged"
  return `Language: ${knownLanguages.join(", ")}`
}

export interface BlueskyPostCardProps {
  readonly authorDisplayName: string
  readonly authorHandle: string
  readonly timeLabel: string
  readonly avatarUrl?: string | null
  readonly bskyUrl?: string | null
  readonly text: string
  readonly replyCount?: number | string | null
  readonly repostCount?: number | string | null
  readonly likeCount?: number | string | null
  /** `compact` shrinks the avatar + hides engagement (for the small landing teaser). */
  readonly density?: "default" | "compact"
  readonly languages?: readonly string[]
  readonly media?: {
    readonly images: readonly { readonly thumb: string; readonly fullsize: string; readonly alt: string; readonly width: number | null; readonly height: number | null }[]
    readonly external: { readonly uri: string; readonly title: string; readonly description: string; readonly thumb: string | null } | null
    readonly quote: { readonly uri: string; readonly authorHandle: string; readonly authorDisplayName: string; readonly text: string } | null
    readonly video: { readonly thumbnail: string | null; readonly width: number | null; readonly height: number | null } | null
  } | null
}

function BlueskyMedia({ media, bskyUrl }: {
  readonly media: NonNullable<BlueskyPostCardProps["media"]>
  readonly bskyUrl: string | null
}) {
  const externalUri = safeWebUrl(media.external?.uri)
  const externalThumb = safeWebUrl(media.external?.thumb)
  const safePostUrl = safeWebUrl(bskyUrl)
  const videoThumbnail = safeWebUrl(media.video?.thumbnail)
  const videoPreview = media.video ? (
    <div className="relative overflow-hidden rounded-xl border border-[#D9E3EE] bg-[#0B0F14]">
      {videoThumbnail ? <Image src={videoThumbnail} alt="Video poster" width={media.video.width ?? 800} height={media.video.height ?? 450} className="max-h-80 w-full object-cover opacity-90" /> : <div className="aspect-video" />}
      <span className="absolute inset-0 flex items-center justify-center"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/65 text-white"><Play className="ml-0.5 h-5 w-5" fill="currentColor" aria-hidden="true" /></span></span>
      <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[11px] font-semibold text-white">
        {safePostUrl ? "Video · open post to play" : "Video preview"}
      </span>
    </div>
  ) : null
  return (
    <div className="mt-3 space-y-2">
      {media.images.length > 0 ? (
        <div className={`grid gap-1 overflow-hidden rounded-xl border border-[#D9E3EE] ${media.images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {media.images.slice(0, 4).map((image, index) => (
            (() => {
              const fullsize = safeWebUrl(image.fullsize)
              const thumb = safeWebUrl(image.thumb)
              return fullsize && thumb ? (
                <a key={`${fullsize}-${index}`} href={fullsize} target="_blank" rel="noreferrer" aria-label={image.alt.trim() || `Open image ${index + 1}`} className="relative block min-h-40 overflow-hidden bg-[#EDF3F8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0085FF]">
                  <Image src={thumb} alt={image.alt} width={image.width ?? 800} height={image.height ?? 600} className="h-full max-h-80 w-full object-cover" />
                </a>
              ) : null
            })()
          ))}
        </div>
      ) : null}
      {media.external && externalUri ? (
        <a href={externalUri} target="_blank" rel="noreferrer" className="flex min-w-0 overflow-hidden rounded-xl border border-[#D9E3EE] text-left transition-colors hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0085FF]">
          {externalThumb ? <Image src={externalThumb} alt="" width={112} height={112} className="h-24 w-24 flex-shrink-0 object-cover sm:h-28 sm:w-28" /> : null}
          <span className="min-w-0 flex-1 px-3 py-2.5">
            <span className="line-clamp-1 text-xs text-[#6F869F]">{safeHostname(externalUri)}</span>
            <span className="mt-0.5 line-clamp-2 text-sm font-semibold leading-5 text-[#0B0F14]">{media.external.title}</span>
            {media.external.description ? <span className="mt-0.5 line-clamp-2 text-xs leading-4 text-[#42576C]">{media.external.description}</span> : null}
          </span>
          <ExternalLink className="mr-3 mt-3 h-4 w-4 flex-shrink-0 text-[#6F869F]" aria-hidden="true" />
        </a>
      ) : null}
      {media.quote ? (
        <div className="rounded-xl border border-[#D9E3EE] px-3 py-2.5">
          <p className="break-words text-sm font-semibold text-[#0B0F14]">{media.quote.authorDisplayName} <span className="break-all font-normal text-[#42576C]">@{media.quote.authorHandle}</span></p>
          <p className="mt-1 line-clamp-4 text-sm leading-5 text-[#0B0F14]">{media.quote.text}</p>
        </div>
      ) : null}
      {videoPreview && safePostUrl ? (
        <a href={safePostUrl} target="_blank" rel="noreferrer" aria-label="Open video post on Bluesky" className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0085FF]">
          {videoPreview}
        </a>
      ) : videoPreview}
    </div>
  )
}

/** A faithful, native-looking Bluesky post card. Presentational; no Corgi styling. */
export function BlueskyPostCard({
  authorDisplayName,
  authorHandle,
  timeLabel,
  avatarUrl,
  bskyUrl = null,
  text,
  replyCount,
  repostCount,
  likeCount,
  density = "default",
  languages = [],
  media = null,
}: BlueskyPostCardProps) {
  const compact = density === "compact"
  const avatarSize = compact ? 34 : 42
  const hasReplyCount = replyCount !== undefined && replyCount !== null
  const hasRepostCount = repostCount !== undefined && repostCount !== null
  const hasLikeCount = likeCount !== undefined && likeCount !== null
  const showActions = hasReplyCount || hasRepostCount || hasLikeCount
  const displayedLanguage = languageLabel(languages)
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
        {!compact && displayedLanguage ? <p className="mt-1 text-[11px] font-medium uppercase text-[#6F869F]">{displayedLanguage}</p> : null}
        {!compact && media ? <BlueskyMedia media={media} bskyUrl={bskyUrl} /> : null}
        {showActions && !compact ? (
          <div className="flex flex-wrap items-center gap-x-7 gap-y-1 pt-3 text-[13px] text-[#6F869F]">
            {hasReplyCount ? <span className="inline-flex items-center gap-1.5 tabular-nums" aria-label={`${formatCount(replyCount)} replies`}>
              <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              {formatCount(replyCount)}
            </span> : null}
            {hasRepostCount ? <span className="inline-flex items-center gap-1.5 tabular-nums" aria-label={`${formatCount(repostCount)} reposts`}>
              <Repeat2 className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              {formatCount(repostCount)}
            </span> : null}
            {hasLikeCount ? <span className="inline-flex items-center gap-1.5 tabular-nums" aria-label={`${formatCount(likeCount)} likes`}>
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
    <div className="flex flex-col items-center justify-center border-l border-border/60 bg-biscuit/25 px-1.5 text-center sm:px-2">
      {/* leading allows a graceful two-line "CORGI / RANK" in the narrow phone rail */}
      <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] leading-[1.4] text-primary/80">{label}</span>
      {sublabel ? <span className="mt-0.5 font-mono text-[9px] leading-none text-foreground/55">{sublabel}</span> : null}
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
          <div className="mt-1 flex items-end gap-4 overflow-x-auto text-[13px] font-semibold text-[#42576C] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-5">
            {tabs.map((tab) => (
              <span
                key={tab}
                ref={
                  tab === communityName
                    ? (el) => {
                        // The active (community) tab is third in Bluesky's order and starts
                        // off-screen on phones — center it by scrolling only the tab strip
                        // (scrollIntoView would also scroll the page itself).
                        const strip = el?.parentElement
                        if (el && strip && strip.scrollWidth > strip.clientWidth) {
                          strip.scrollLeft = Math.max(0, el.offsetLeft - (strip.clientWidth - el.clientWidth) / 2)
                        }
                      }
                    : undefined
                }
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
