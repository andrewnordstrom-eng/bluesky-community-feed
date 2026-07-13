import Link from "next/link"
import { Container } from "@/components/ui/layout"

// These feature rows deliberately DON'T re-show weights + receipts — the
// interactive ReplayTeaser above already does that. They teach the two concepts
// the teaser doesn't dwell on: how different post *types* fare, and the epoch
// governance loop.

function SignalBlendUI() {
  // Signal colors match lib/signals SIGNAL_COLORS (relevance=primary/ginger,
  // source_diversity=#7A9A5E sage, engagement=#BC4B3E brick-red). Tailwind
  // arbitrary classes can't interpolate the constant — keep the hexes in sync.
  const examples = [
    {
      label: "Field note with context",
      detail: "A sighting post with location, correction, and source detail.",
      outcome: "Ranks up",
      signals: [
        { label: "Relevance", widthClass: "w-[92%]", colorClass: "bg-primary" },
        { label: "Diversity", widthClass: "w-[76%]", colorClass: "bg-[#7A9A5E]" },
        { label: "Engagement", widthClass: "w-[54%]", colorClass: "bg-[#BC4B3E]" },
      ],
    },
    {
      label: "Generic hot take",
      detail: "A broad post with lots of reactions but little community context.",
      outcome: "Moves down",
      signals: [
        { label: "Relevance", widthClass: "w-[38%]", colorClass: "bg-primary/45" },
        { label: "Diversity", widthClass: "w-[28%]", colorClass: "bg-[#7A9A5E]/45" },
        { label: "Engagement", widthClass: "w-[88%]", colorClass: "bg-[#BC4B3E]" },
      ],
    },
    {
      label: "Bridge between interests",
      detail: "A post that connects the community topic to adjacent expertise.",
      outcome: "Finds its people",
      signals: [
        { label: "Relevance", widthClass: "w-[70%]", colorClass: "bg-primary" },
        { label: "Diversity", widthClass: "w-[86%]", colorClass: "bg-[#7A9A5E]" },
        { label: "Engagement", widthClass: "w-[46%]", colorClass: "bg-[#BC4B3E]/70" },
      ],
    },
  ] as const

  return (
    <div className="w-full rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-5 sm:px-6 py-4 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-[#FF6058]" />
          <span className="w-2 h-2 rounded-full bg-[#FFBD2E]" />
          <span className="w-2 h-2 rounded-full bg-[#28CA41]" />
          <span className="ml-1 sm:ml-2 text-foreground/55 text-xs font-mono">Signal mix example</span>
        </div>
        <span className="w-fit text-[10px] font-medium text-foreground/55 border border-border/50 px-2.5 py-1 rounded-full">
          illustrative scenario
        </span>
      </div>
      <div className="grid gap-0 divide-y divide-border/40">
        {examples.map((example) => (
          <div key={example.label} className="grid gap-4 px-5 py-5 md:grid-cols-[220px_minmax(0,1fr)_120px] md:items-center">
            <div>
              <p className="text-sm font-semibold text-foreground">{example.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-foreground/55">{example.detail}</p>
            </div>
            <div className="flex flex-col gap-2.5">
              {example.signals.map((signal) => (
                <div key={signal.label} className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3">
                  <span className="text-xs font-medium text-foreground/50">{signal.label}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-border/50">
                    <div className={`h-full rounded-full ${signal.widthClass} ${signal.colorClass}`} />
                  </div>
                </div>
              ))}
            </div>
            <span className="w-fit rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary md:justify-self-end">
              {example.outcome}
            </span>
          </div>
        ))}
      </div>
      <div className="px-5 sm:px-6 py-3.5 border-t border-border/40 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-foreground/55 text-xs font-mono">one governed ranking, multiple signal types</p>
        <Link href="/demo" className="text-xs font-medium text-primary hover:underline underline-offset-2">
          See the receipt demo &rarr;
        </Link>
      </div>
    </div>
  )
}

function CommunityVoteUI() {
  const steps = [
    {
      label: "Proposal",
      text: "A ranking change is proposed before it affects the feed.",
    },
    {
      label: "Community vote",
      text: "Members choose which signals should matter more.",
    },
    {
      label: "Weights update",
      text: "The next epoch applies a visible set of weights.",
    },
    {
      label: "Feed reorders",
      text: "Bluesky receives the same posts in a new order.",
    },
    {
      label: "Receipt stays",
      text: "Corgi keeps the explanation tied to that epoch.",
    },
  ]

  return (
    <div className="w-full rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-5 sm:px-6 py-4 border-b border-border/60">
        <span className="text-foreground/55 text-xs font-mono">Epoch and proposal flow</span>
        <span className="w-fit text-[10px] font-medium text-primary bg-primary/10 border border-primary/15 px-2.5 py-1 rounded-full">
          auditable sequence
        </span>
      </div>
      <div className="px-5 sm:px-6 py-5 grid grid-cols-1 gap-3 md:grid-cols-5">
        {steps.map((step, index) => (
          <div key={step.label} className="relative rounded-xl border border-border/60 bg-background px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[11px] font-mono font-semibold text-primary/70">{String(index + 1).padStart(2, "0")}</span>
                <p className="mt-2 text-foreground/75 text-sm font-semibold leading-snug">{step.label}</p>
              </div>
              {index < steps.length - 1 ? (
                <span className="hidden text-primary/45 md:block" aria-hidden="true">
                  &rarr;
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-foreground/55 text-sm leading-relaxed">{step.text}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-0 border-t border-border/50 md:grid-cols-2">
        <div className="border-b border-border/50 px-5 py-4 md:border-b-0 md:border-r sm:px-6">
          <p className="text-xs font-mono uppercase tracking-[0.18em] text-foreground/55">Before epoch</p>
          <div className="mt-3 space-y-2 text-sm text-foreground/65">
            <p><span className="font-mono text-foreground/55">#1</span> high-engagement general post</p>
            <p><span className="font-mono text-foreground/55">#2</span> useful source-rich explainer</p>
          </div>
        </div>
        <div className="px-5 py-4 sm:px-6">
          <p className="text-xs font-mono uppercase tracking-[0.18em] text-foreground/55">After weights update</p>
          <div className="mt-3 space-y-2 text-sm text-foreground/65">
            <p><span className="font-mono text-primary/70">#1</span> useful source-rich explainer</p>
            <p><span className="font-mono text-foreground/55">#2</span> high-engagement general post</p>
          </div>
        </div>
      </div>
    </div>
  )
}

const features = [
  {
    id: "mixed-feed",
    headline: "The feed is mixed, not topic-siloed.",
    description:
      "A governed recommender has to reconcile recency, engagement, bridging, source diversity, and relevance in one ranking — and the demo shows the live receipts behind it.",
    cta: "Explore the demo feed",
    href: "/demo",
    UI: SignalBlendUI,
  },
  {
    id: "epochs",
    headline: "Epochs turn proposals into auditable changes.",
    description:
      "Corgi's governance loop is proposal, vote, epoch transition, and receipt. The product story stays grounded in that loop instead of promising private communities or made-up vote totals.",
    cta: "See epoch history",
    href: "/history",
    UI: CommunityVoteUI,
  },
]

export function BentoSection() {
  return (
    <section id="features-section" className="w-full">
      {features.map((feature) => (
        <div key={feature.id}>
          <Container className="border-t border-border/60">
          <div className="flex flex-col md:flex-row md:items-start gap-6 md:gap-16 py-10 md:py-14">
            <div className="md:w-[40%] flex-shrink-0">
              <h2 className="text-foreground font-display text-2xl md:text-3xl lg:text-[2rem] font-bold leading-tight tracking-tight text-balance">
                {feature.headline}
              </h2>
            </div>
            <div className="md:flex-1 flex flex-col gap-5 md:pt-1">
              <p className="text-foreground/60 text-base leading-relaxed">
                {feature.description}
              </p>
              <Link
                href={feature.href}
                className="w-fit text-sm font-medium text-primary hover:text-primary-dark transition-colors"
              >
                {feature.cta} &rarr;
              </Link>
            </div>
          </div>
          <div className="pb-10 md:pb-16">
            <feature.UI />
          </div>
          </Container>
        </div>
      ))}
    </section>
  )
}
