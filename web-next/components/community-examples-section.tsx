const communityExamples = [
  {
    name: "Birders Who Code",
    interest: "warblers, bug reports, and deploys that failed silently",
    ranking: "boosts field notes, reproducible fixes, and useful corrections",
    accentClass: "bg-[#CFE1D0] text-[#3E643F]",
  },
  {
    name: "Bike Lanes & Baked Goods",
    interest: "cargo bikes, cinnamon rolls, and pedestrian-first errands",
    ranking: "prefers practical routes and real bake notes over generic city takes",
    accentClass: "bg-[#F0D1A8] text-[#7A4A20]",
  },
  {
    name: "TTRPG Transit Nerds",
    interest: "fantasy maps, bus schedules, and fictional city arguments",
    ranking: "surfaces worldbuilding and real route context before meme replies",
    accentClass: "bg-[#D8D5F0] text-[#4C4A7B]",
  },
  {
    name: "Cozy Horror Book Club",
    interest: "haunted paperbacks, tea, blankets, and unsettling recommendations",
    ranking: "lifts thoughtful reviews over spoiler-heavy reaction posts",
    accentClass: "bg-[#F1C8C0] text-[#7A3F35]",
  },
  {
    name: "OSINT Garden Club",
    interest: "geolocation, tomatoes, satellite imagery, and compost discourse",
    ranking: "rewards sourced observations and patient context-building",
    accentClass: "bg-[#C6E2EA] text-[#245A68]",
  },
  {
    name: "Library Cats & Labor",
    interest: "cataloging, collective bargaining, quiet stacks, and local mascots",
    ranking: "moves firsthand organizing updates above broad workplace takes",
    accentClass: "bg-[#D9E3BD] text-[#4B6428]",
  },
  {
    name: "Neighborhood Mutual Aid",
    interest: "storm prep, volunteer rides, pantry restocks, and local alerts",
    ranking: "puts timely needs and trusted local updates before generic city chatter",
    accentClass: "bg-[#C8DDF2] text-[#284C6D]",
  },
] as const

export function CommunityExamplesSection() {
  return (
    <section className="w-full border-t border-border/60 px-5 md:px-8 lg:px-12">
      <div className="flex flex-col md:flex-row md:items-start gap-6 md:gap-16 py-10 md:py-14">
        <div className="md:w-[40%] flex-shrink-0">
          <h2 className="text-foreground font-display text-2xl md:text-3xl lg:text-[2rem] font-bold leading-tight tracking-tight text-balance">
            Any community can make the feed care about its own context.
          </h2>
        </div>
        <div className="md:flex-1 md:pt-1">
          <p className="text-foreground/55 text-base leading-relaxed">
            A Facebook group or subreddit can host discussion. Corgi gives a community control over what rises first: fewer generic viral posts, more local context, more trusted sources, and clearer reasons for why the feed changed.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 pb-6 md:grid-cols-2 xl:grid-cols-3">
        {communityExamples.map((community) => (
          <article key={community.name} className="rounded-2xl border border-border bg-card p-5 shadow-[0_2px_10px_rgba(46,38,32,0.05)]">
            <div className="flex items-start gap-3">
              <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${community.accentClass}`}>
                {community.name.split(" ").map((word) => word[0]).join("").slice(0, 2)}
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold leading-snug text-foreground">{community.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-foreground/55">
                  <span className="font-medium text-foreground/70">Interest:</span> {community.interest}.
                </p>
                <p className="mt-1 text-sm leading-relaxed text-foreground/55">
                  <span className="font-medium text-foreground/70">Corgi ranking:</span> {community.ranking}.
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
      <p className="pb-12 text-xs leading-relaxed text-foreground/40 md:pb-16">
        Demo note: community examples and feed posts are illustrative product scenarios. Live ranking claims on Corgi use anonymized receipts and snapshot data.
      </p>
    </section>
  )
}
