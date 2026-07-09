import Image from "next/image"
import {
  Bookmark,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
} from "lucide-react"

const samplePosts = [
  {
    rank: 1,
    name: "Maya Keene",
    handle: "@maya-keene.bsky.social",
    time: "12m",
    avatarSrc: "/images/avatars/maya-keene.png",
    text: "Ridge lake loop: three swallows, one confusing warbler, and a deploy rollback that finally made the cache bug obvious. Field notes and diff in the thread.",
    stats: { replies: "24", reposts: "58", likes: "312" },
    score: "+18.4",
    reason: "Field note + fix",
    card: {
      imageSrc: "/images/feed/birders-field-notes.png",
      title: "Birders Who Code field notes",
      description: "A shared log for sightings, debugging notes, route context, and corrections from the community.",
    },
  },
  {
    rank: 2,
    name: "Arjun Mehta",
    handle: "@arjunmehta.dev",
    time: "28m",
    avatarSrc: "/images/avatars/arjun-mehta.png",
    text: "Patch is live: map links now keep neighborhood context when people cross-post sightings. Please test it on your next lunch walk.",
    stats: { replies: "11", reposts: "33", likes: "146" },
    score: "+14.9",
    reason: "Useful tool",
  },
  {
    rank: 3,
    name: "Theo Kim",
    handle: "@thocknotes.bsky.social",
    time: "51m",
    avatarSrc: "/images/avatars/theo-kim.png",
    text: "Made a tiny chart of IDs corrected by replies versus photos. Community notes are doing more work than raw likes here.",
    stats: { replies: "8", reposts: "19", likes: "104" },
    score: "+11.6",
    reason: "Community signal",
  },
] as const

function BlueskyActionRow() {
  const actions = [
    { label: "Save", Icon: Bookmark },
    { label: "More", Icon: MoreHorizontal },
  ]

  return (
    <div className="flex items-center justify-end gap-5 text-[#6F869F]" aria-label="Bluesky-style post actions">
      {actions.map(({ label, Icon }) => (
        <span key={label} className="inline-flex items-center gap-1.5 text-[12px] font-medium">
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </span>
      ))}
    </div>
  )
}

type BlueskyOrderedFeedProps = {
  readonly showIntro: boolean
  readonly showDisclosure: boolean
}

export function BlueskyOrderedFeed(props: BlueskyOrderedFeedProps) {
  return (
    <div className="flex flex-col gap-4">
      {props.showIntro ? (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/35">
            Bluesky view
          </p>
          <div className="flex flex-col gap-1">
            <h3 className="text-foreground font-display text-2xl font-bold leading-tight">
              Normal posts, Corgi-ranked order.
            </h3>
            <p className="text-sm leading-relaxed text-foreground/50">
              The feed looks like Bluesky. Corgi changes what appears first.
            </p>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[22px] border border-[#D4DBE2] bg-white text-[#0B0F14] shadow-[0_10px_32px_rgba(11,15,20,0.08)]">
        <div className="flex">
          <div className="min-w-0 flex-1">
            <div className="relative border-b border-[#D4DBE2] bg-white px-4 pb-0 pt-3">
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
              <div className="mt-1 flex min-w-0 items-end gap-3 overflow-x-auto text-[13px] font-semibold text-[#42576C] sm:gap-5 sm:text-[14px]">
                {["Discover", "Following", "Birders Who Code", "Bike Lanes & Bakes"].map((tab, index) => (
                  <span key={tab} className={`relative shrink-0 py-3 ${index === 2 ? "text-[#0B0F14]" : ""}`}>
                    {tab}
                    {index === 2 ? (
                      <span className="absolute inset-x-0 bottom-0 h-1 rounded-full bg-[#0085FF]" />
                    ) : null}
                  </span>
                ))}
              </div>
            </div>

            <div className="divide-y divide-[#D4DBE2]">
              {samplePosts.map((post) => (
                <div key={post.rank} className="grid grid-cols-1 bg-white sm:grid-cols-[minmax(0,1fr)_98px]">
                  <article className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <Image
                        src={post.avatarSrc}
                        alt=""
                        width={42}
                        height={42}
                        className="h-[42px] w-[42px] flex-shrink-0 rounded-full object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[15px] leading-5">
                          <span className="font-bold text-[#0B0F14]">{post.name}</span>
                          <span className="truncate font-normal text-[#42576C]">{post.handle}</span>
                          <span className="text-[#42576C]">·</span>
                          <span className="font-normal text-[#42576C]">{post.time}</span>
                        </div>
                        <p className="mt-0.5 text-[15px] leading-5 text-[#0B0F14]">{post.text}</p>
                        {"card" in post ? (
                          <div className="mt-3 overflow-hidden rounded-xl border border-[#D4DBE2]">
                            <Image
                              src={post.card.imageSrc}
                              alt=""
                              width={720}
                              height={320}
                              className="h-28 w-full object-cover sm:h-36"
                            />
                            <div className="border-t border-[#D4DBE2] px-3 py-2">
                              <p className="text-[14px] font-bold leading-snug text-[#0B0F14]">
                                {post.card.title}
                              </p>
                              <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-[#42576C]">
                                {post.card.description}
                              </p>
                            </div>
                          </div>
                        ) : null}
                        <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-3 pt-3 text-[#6F869F]">
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
                          <BlueskyActionRow />
                        </div>
                      </div>
                    </div>
                  </article>
                  <aside className="flex items-center justify-between gap-2 border-t border-dashed border-primary/25 bg-primary/[0.045] px-4 py-3 text-center sm:flex-col sm:justify-start sm:border-l sm:border-t-0 sm:px-2">
                    <span className="block text-[9px] font-mono font-semibold uppercase tracking-[0.16em] text-primary/50">
                      Corgi
                    </span>
                    <span className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/25 bg-white text-xs font-mono font-bold text-primary shadow-sm sm:mx-auto sm:mt-1">
                      #{post.rank}
                    </span>
                    <span className="block font-mono text-[11px] font-semibold text-primary sm:mt-2">{post.score}</span>
                    <span className="block text-[10px] leading-tight text-foreground/45 sm:mt-1">{post.reason}</span>
                  </aside>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {props.showDisclosure ? (
        <p className="text-xs leading-relaxed text-foreground/45">
          The Corgi score rail is an annotation for this product demo. Standard Bluesky clients render only the ordered posts; Corgi hosts the explanation.
        </p>
      ) : null}
    </div>
  )
}
