const testimonials = [
  {
    quote:
      "I've used a dozen custom Bluesky feeds. Corgi is the first one where I actually understand why a post is ranked where it is. The score breakdown is everything.",
    name: "robin.bsky.social",
    company: "Power user",
    type: "large-ginger",
  },
  {
    quote: "Voted on last week's epoch, saw the feed shift by morning. This is what governance should feel like.",
    name: "dev.bluesky.dev",
    company: "Bluesky developer",
    type: "small-dark",
  },
  {
    quote: "The audit trail is research-grade. I exported three months of epoch data and the schema is clean.",
    name: "researcher.bsky.social",
    company: "Academic researcher",
    type: "small-dark",
  },
  {
    quote: "Finally a feed where the community isn't at the mercy of a single operator's whims.",
    name: "felix.bsky.social",
    company: "Community organiser",
    type: "small-dark",
  },
  {
    quote: "App-password only, revoke anytime. I trusted Corgi before I even read the governance docs.",
    name: "priya.bsky.social",
    company: "Privacy advocate",
    type: "small-dark",
  },
  {
    quote: "My entire group switched to Corgi because we could set our own spam-risk threshold. No more garbage surfacing.",
    name: "lucía.bsky.social",
    company: "Community moderator",
    type: "small-dark",
  },
  {
    quote:
      "The score breakdown widget made me realise I'd been sleeping on reply depth as a quality signal. We voted it up and the feed immediately got better.",
    name: "kai.bsky.social",
    company: "Curator",
    type: "large-light",
  },
]

const TestimonialCard = ({
  quote,
  name,
  company,
  type,
}: {
  quote: string
  name: string
  company: string
  type: string
}) => {
  const isLarge = type.startsWith("large")
  const padding = isLarge ? "p-6" : "p-6"

  let cardClasses = `flex flex-col justify-between items-start overflow-hidden rounded-2xl relative ${padding} shadow-[0_2px_8px_rgba(46,38,32,0.07)]`
  let quoteClasses = ""
  let nameClasses = ""
  let companyClasses = ""
  const cardHeight = isLarge ? "min-h-[280px]" : "min-h-[180px]"

  if (type === "large-ginger") {
    cardClasses += " bg-primary border border-primary/30"
    quoteClasses = "text-primary-foreground text-xl font-medium leading-8"
    nameClasses = "text-primary-foreground text-sm font-semibold"
    companyClasses = "text-primary-foreground/60 text-sm"
  } else if (type === "large-light") {
    cardClasses += " bg-card border border-border"
    quoteClasses = "text-foreground text-xl font-medium leading-8"
    nameClasses = "text-foreground text-sm font-semibold"
    companyClasses = "text-foreground/50 text-sm"
  } else {
    cardClasses += " bg-card border border-border"
    quoteClasses = "text-foreground/80 text-[15px] font-normal leading-6"
    nameClasses = "text-foreground text-sm font-semibold"
    companyClasses = "text-foreground/40 text-sm"
  }

  return (
    <div className={`${cardClasses} ${cardHeight} w-full gap-4`}>
      <p className={`relative z-10 font-normal break-words flex-1 ${quoteClasses}`}>&ldquo;{quote}&rdquo;</p>
      <div className="relative z-10 flex items-center gap-2.5 mt-2">
        <div className="w-8 h-8 rounded-full bg-muted border border-border overflow-hidden flex-shrink-0">
          <svg viewBox="0 0 32 32" className="w-full h-full">
            <rect width="32" height="32" fill="hsl(var(--muted))" />
            <circle cx="16" cy="13" r="6" fill="hsl(var(--border))" />
            <ellipse cx="16" cy="29" rx="11" ry="7" fill="hsl(var(--border))" />
          </svg>
        </div>
        <div className="flex flex-col gap-0">
          <span className={nameClasses}>{name}</span>
          <span className={companyClasses}>{company}</span>
        </div>
      </div>
    </div>
  )
}

export function TestimonialGridSection() {
  return (
    <section id="testimonials-section" className="w-full px-5 overflow-hidden flex flex-col justify-start py-6 md:py-8 lg:py-14">
      <div className="self-stretch py-6 md:py-8 lg:py-14 flex flex-col justify-center items-center gap-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
          <span className="text-primary text-xs font-semibold tracking-wide uppercase">Community voices</span>
        </div>
        <div className="flex flex-col justify-start items-center gap-3">
          <h2 className="text-center text-foreground font-display text-3xl md:text-4xl lg:text-5xl font-semibold leading-tight tracking-tight text-balance">
            What members are saying
          </h2>
          <p className="text-center text-foreground/50 text-base font-medium leading-relaxed max-w-lg">
            From power users to researchers — Corgi&apos;s community is built on trust, not mystery.
          </p>
        </div>
      </div>
      <div className="w-full pt-0.5 pb-4 md:pb-6 lg:pb-10 flex flex-col md:flex-row justify-center items-start gap-4 max-w-[1100px] mx-auto">
        <div className="flex-1 flex flex-col gap-4">
          <TestimonialCard {...testimonials[0]} />
          <TestimonialCard {...testimonials[1]} />
        </div>
        <div className="flex-1 flex flex-col gap-4">
          <TestimonialCard {...testimonials[2]} />
          <TestimonialCard {...testimonials[3]} />
          <TestimonialCard {...testimonials[4]} />
        </div>
        <div className="flex-1 flex flex-col gap-4">
          <TestimonialCard {...testimonials[5]} />
          <TestimonialCard {...testimonials[6]} />
        </div>
      </div>
    </section>
  )
}
