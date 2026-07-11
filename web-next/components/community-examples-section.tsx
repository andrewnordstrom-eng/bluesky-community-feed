import { Container } from "@/components/ui/layout"
import { SIGNAL_LABELS } from "@/lib/signals"

// Illustrative Bluesky-native community concepts, labeled only with Corgi's
// canonical ranking signals and the kind of feed noise each policy addresses.
const communityExamples = [
  {
    name: "Birders Who Code",
    initials: "BC",
    signal: SIGNAL_LABELS.bridging,
    description: "Field notes, scripts, and bird-call datasets stay balanced against generic tech jokes.",
    accentClass: "bg-[#CFE1D0] text-[#3E643F]",
  },
  {
    name: "Neighborhood Mutual Aid",
    initials: "MA",
    signal: `${SIGNAL_LABELS.recency} + ${SIGNAL_LABELS.source_diversity}`,
    description: "Urgent local needs and verified updates rise above old viral posts.",
    accentClass: "bg-[#C8DDF2] text-[#284C6D]",
  },
  {
    name: "Open-Source Maintainers",
    initials: "OS",
    signal: SIGNAL_LABELS.relevance,
    description: "Patches, docs, and release notes outrank memes and project drama.",
    accentClass: "bg-[#F0D1A8] text-[#7A4A20]",
  },
  {
    name: "Science & Research Feeds",
    initials: "SR",
    signal: SIGNAL_LABELS.source_diversity,
    description: "Papers, replications, and expert context beat hot takes and hype.",
    accentClass: "bg-[#C6E2EA] text-[#245A68]",
  },
  {
    name: "Local Newsroom & Civic Desk",
    initials: "LC",
    signal: `${SIGNAL_LABELS.recency} + ${SIGNAL_LABELS.source_diversity}`,
    description: "Council meetings, transit, housing, and weather stay findable during a news burst.",
    accentClass: "bg-[#D4DBE2] text-[#3A4A5C]",
  },
  {
    name: "Tabletop Creators",
    initials: "TT",
    signal: SIGNAL_LABELS.relevance,
    description: "Indie releases, actual play, and safety tools don't get buried by fandom noise.",
    accentClass: "bg-[#D8D5F0] text-[#4C4A7B]",
  },
] as const

export function CommunityExamplesSection() {
  return (
    <section>
      <Container className="border-t border-border/60">
      <div className="flex flex-col md:flex-row md:items-start gap-6 md:gap-16 py-10 md:py-14">
        <div className="md:w-[40%] flex-shrink-0">
          <h2 className="text-foreground font-display text-2xl md:text-3xl lg:text-[2rem] font-bold leading-tight tracking-tight text-balance">
            Any community can choose what &ldquo;good&rdquo; means.
          </h2>
        </div>
        <div className="md:flex-1 md:pt-1">
          <p className="text-foreground/60 text-base leading-relaxed">
            Every active community has posts worth surfacing and noise worth sinking &mdash; but &ldquo;good&rdquo; looks
            different to each one. Corgi lets a community set which signals matter, so the right posts rise, generic viral
            drift sinks, and the reason for every change stays inspectable.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 pb-6 md:grid-cols-2 xl:grid-cols-3">
        {communityExamples.map((community) => (
          <article key={community.name} className="rounded-2xl border border-border bg-card p-5 shadow-[0_2px_10px_rgba(46,38,32,0.05)]">
            <div className="flex items-start gap-3">
              <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${community.accentClass}`}>
                {community.initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="text-base font-semibold leading-snug text-foreground">{community.name}</h3>
                  <span className="rounded-full border border-primary/15 bg-primary/10 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide text-primary">
                    {community.signal}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-foreground/60">{community.description}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
      <p className="pb-12 text-xs leading-relaxed text-foreground/45 md:pb-16">
        Example communities, illustrative. Live ranking on Corgi uses anonymized receipts and snapshot data.
      </p>
      </Container>
    </section>
  )
}
